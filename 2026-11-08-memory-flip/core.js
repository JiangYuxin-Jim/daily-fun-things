/*
 * core.js — 记忆翻牌游戏纯函数引擎
 * 不碰 DOM、不读 Date.now()、不读 Math.random()。随机源与时钟都靠注入。
 * 浏览器（<script>）与 Node（require）两用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.MemoryCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ───────────────────────── 随机数 ─────────────────────────

  /** mulberry32：可复现的 PRNG，种子相同序列相同 */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fisher–Yates，返回新数组，不改入参 */
  function shuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  // ───────────────────────── 难度 ─────────────────────────

  const LEVELS = {
    easy:   { key: 'easy',   label: '轻松', cols: 4, pairs: 6,  peeks: 3, seconds: 0 },
    normal: { key: 'normal', label: '标准', cols: 4, pairs: 8,  peeks: 1, seconds: 0 },
    hard:   { key: 'hard',   label: '硬核', cols: 5, pairs: 10, peeks: 0, seconds: 0 },
    crazy:  { key: 'crazy',  label: '极限', cols: 6, pairs: 18, peeks: 0, seconds: 0, timed: true, timeLimit: 180 },
  };

  // 牌面都是纯 emoji（无肤色修饰符），避免不同平台字数/宽度差异
  const FACES = [
    '🦊', '🐼', '🐙', '🦄', '🐝', '🦋', '🐳', '🦉',
    '🌵', '🍄', '🌈', '⭐', '🍉', '🍩', '🍿', '🎲',
    '🚀', '🎸', '🔮', '🧩', '🪁', '🫧',
  ];

  /**
   * 洗牌法判重：开局保证「至少一对相邻」，否则开局就注定了盲猜。
   * （相邻 = 网格上上下左右挨着）
   */
  function hasAdjacentPair(state) {
    const { cols, tiles } = state;
    for (let i = 0; i < tiles.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const right = c + 1 < cols ? i + 1 : -1;
      const down = i + cols < tiles.length ? i + cols : -1;
      for (const j of [right, down]) {
        if (j >= 0 && !tiles[i].removed && !tiles[j].removed && tiles[i].face === tiles[j].face) return true;
      }
      void r;
    }
    return false;
  }

  function buildDeck(pairs, rng) {
    const faces = shuffle(FACES, rng).slice(0, pairs);
    const deck = [];
    faces.forEach((face, pairId) => {
      deck.push({ face, pairId }, { face, pairId });
    });
    return shuffle(deck, rng);
  }

  // ───────────────────────── 建局 ─────────────────────────

  /**
   * createGame({ level, seed }) → state
   * state 是不可变思路下的「值」：任何操作都返回新 state（内部做浅拷贝 + 必要深拷贝）
   */
  function createGame(opts) {
    opts = opts || {};
    const levelKey = LEVELS[opts.level] ? opts.level : 'normal';
    const level = LEVELS[levelKey];
    const seed = (opts.seed === undefined || opts.seed === null)
      ? Math.floor(Math.random() * 0xFFFFFFFF)
      : opts.seed >>> 0;
    const rng = makeRng(seed);

    let deck = buildDeck(level.pairs, rng);
    const cols = level.cols;
    const rows = Math.ceil(deck.length / cols);

    let state = {
      seed,
      level: levelKey,
      cols,
      rows,
      tiles: deck.map((d, i) => ({
        id: i,
        face: d.face,
        pairId: d.pairId,
        removed: false,
        matched: false,
      })),
      // 当前翻开但尚未配对的牌 id（长度 0/1/2）
      flipped: [],
      peeksLeft: level.peeks,
      peekUntil: null,     // 揭晓倒计时结束的「逻辑时间」（ms），null = 未揭晓
      moves: 0,            // 累计翻牌次数（每翻一张 +1）
      pairsFound: 0,
      totalPairs: level.pairs,
      combo: 0,            // 连续配对次数（一次失误清零）
      bestCombo: 0,
      score: 0,
      over: false,
      won: false,
      reason: null,
      log: [],
    };

    // 保证至少一对相邻的配对牌：最多重洗 200 次，实在没有就接受（概率极低）
    let guard = 0;
    while (!hasAdjacentPair(state) && guard < 200) {
      const r2 = makeRng((seed + 7919 * (guard + 1)) >>> 0);
      deck = buildDeck(level.pairs, r2);
      state.tiles = deck.map((d, i) => ({
        id: i, face: d.face, pairId: d.pairId, removed: false, matched: false,
      }));
      guard++;
    }

    return state;
  }

  // ───────────────────────── 查询 ─────────────────────────

  function tileAt(state, id) {
    return state.tiles[id] || null;
  }

  function isFaceUp(state, id) {
    const t = state.tiles[id];
    if (!t) return false;
    if (t.matched) return true;
    if (state.peekUntil !== null) return true;
    return state.flipped.indexOf(id) >= 0;
  }

  function isLocked(state, id) {
    // 已有两张翻开时锁住所有牌（等待配对判定/收回）
    return state.flipped.length >= 2 && state.flipped.indexOf(id) < 0;
  }

  // ───────────────────────── 操作 ─────────────────────────

  const SCORE = {
    match: 100,
    comboBonus: 50,   // 每次连击额外 (combo-1)*50
    miss: 15,         // 失误扣分
    peek: 120,        // 揭晓扣分
    winBonusPerSecond: 8,
  };

  /**
   * 翻一张牌。返回 { ok, state, event }
   * event ∈ 'match' | 'miss' | 'flip' | null
   *
   * 说明：配对判定在「翻开第二张」时立即完成并合并到同一次操作里，
   * 所以不会出现「翻开两张还挂在场上等计时器」的中态 —— 这是简化。
   */
  function flip(state, id) {
    if (state.over) return { ok: false, state, event: null, why: 'over' };
    const t = state.tiles[id];
    if (!t) return { ok: false, state, event: null, why: 'no-tile' };
    if (t.matched) return { ok: false, state, event: null, why: 'matched' };
    if (state.flipped.indexOf(id) >= 0) return { ok: false, state, event: null, why: 'already' };
    if (isLocked(state, id)) return { ok: false, state, event: null, why: 'locked' };

    const peekActive = state.peekUntil !== null;
    // 揭晓期间翻牌：不算对局操作，只是擦掉揭晓（玩家主动看，也给个台阶）
    const next = cloneState(state);
    if (peekActive) {
      next.peekUntil = null;
      return { ok: true, state: next, event: 'peek-cancel', why: 'peek' };
    }

    next.flipped = next.flipped.concat(id);
    next.moves += 1;

    if (next.flipped.length < 2) {
      return { ok: true, state: next, event: 'flip' };
    }

    const [a, b] = next.flipped;
    const ta = next.tiles[a], tb = next.tiles[b];
    next.flipped = [];

    if (ta.pairId === tb.pairId && ta.id !== tb.id) {
      ta.matched = true; tb.matched = true;
      next.pairsFound += 1;
      next.combo += 1;
      if (next.combo > next.bestCombo) next.bestCombo = next.combo;
      next.score += SCORE.match + Math.max(0, next.combo - 1) * SCORE.comboBonus;
      next.log.push({ a, b, hit: true });
      if (next.pairsFound >= next.totalPairs) {
        next.over = true; next.won = true; next.reason = 'cleared';
        next.wonAtLogical = state.logicalTime;
      }
      return { ok: true, state: next, event: 'match' };
    }

    next.combo = 0;
    next.score = Math.max(0, next.score - SCORE.miss);
    next.log.push({ a, b, hit: false });
    return { ok: true, state: next, event: 'miss' };
  }

  /** 揭晓全部牌 n 毫秒（逻辑时间由调用方推进） */
  function peek(state, durationMs) {
    if (state.over || state.peeksLeft <= 0 || state.peekUntil !== null) {
      return { ok: false, state, why: state.over ? 'over' : state.peekUntil !== null ? 'active' : 'none-left' };
    }
    const d = durationMs === undefined ? 1200 : durationMs;
    const next = cloneState(state);
    next.peeksLeft -= 1;
    next.flipped = [];
    next.score = Math.max(0, next.score - SCORE.peek);
    // 用「逻辑时间 + 持续」表达，不读真实时钟
    next.peekUntil = (state.logicalTime || 0) + d;
    return { ok: true, state: next };
  }

  /** 推进逻辑时间；揭晓到期就自动收起。返回 { state, changed } */
  function tick(state, ms) {
    const now = (state.logicalTime || 0) + Math.max(0, ms);
    if (state.peekUntil === null) {
      if (now === state.logicalTime) return { state, changed: false };
      const next = cloneState(state); next.logicalTime = now;
      return { state: next, changed: false };
    }
    if (now < state.peekUntil) {
      const next = cloneState(state); next.logicalTime = now;
      return { state: next, changed: false };
    }
    const next = cloneState(state);
    next.logicalTime = now;
    next.peekUntil = null;
    return { state: next, changed: true };
  }

  /** 是否没时间了（仅 crazy 关） */
  function timedOut(state) {
    const lv = LEVELS[state.level];
    if (!lv || !lv.timed) return false;
    return (state.logicalTime || 0) >= lv.timeLimit * 1000;
  }

  /** 剩余毫秒（仅 crazy 关），其余返回 null */
  function timeLeft(state) {
    const lv = LEVELS[state.level];
    if (!lv || !lv.timed) return null;
    return Math.max(0, lv.timeLimit * 1000 - (state.logicalTime || 0));
  }

  /** 三档星级：全无失误 / 失误≤对数 / 其余 */
  function stars(state) {
    if (!state.won) return 0;
    const misses = state.log.filter(m => !m.hit).length;
    if (misses <= 1) return 3;
    if (misses <= state.totalPairs) return 2;
    return 1;
  }

  function cloneState(s) {
    return {
      seed: s.seed,
      level: s.level,
      cols: s.cols,
      rows: s.rows,
      tiles: s.tiles.map(t => ({ id: t.id, face: t.face, pairId: t.pairId, removed: t.removed, matched: t.matched })),
      flipped: s.flipped.slice(),
      peeksLeft: s.peeksLeft,
      peekUntil: s.peekUntil,
      moves: s.moves,
      pairsFound: s.pairsFound,
      totalPairs: s.totalPairs,
      combo: s.combo,
      bestCombo: s.bestCombo,
      score: s.score,
      over: s.over,
      won: s.won,
      reason: s.reason,
      log: s.log.map(m => ({ a: m.a, b: m.b, hit: m.hit })),
      logicalTime: s.logicalTime || 0,
      wonAtLogical: s.wonAtLogical,
    };
  }

  /** 不变量检查（测试与反向校验用） */
  function checkInvariants(state) {
    const errs = [];
    // 1) 每种 face 出现次数为偶数
    const counts = {};
    state.tiles.forEach(t => { counts[t.face] = (counts[t.face] || 0) + 1; });
    Object.keys(counts).forEach(f => { if (counts[f] % 2 !== 0) errs.push('奇数张: ' + f); });
    // 2) pairId 恰好两两成对
    const byPair = {};
    state.tiles.forEach(t => { byPair[t.pairId] = (byPair[t.pairId] || 0) + 1; });
    Object.keys(byPair).forEach(p => { if (byPair[p] !== 2) errs.push('pairId 张数不为 2: ' + p); });
    // 3) 牌数 = totalPairs * 2
    if (state.tiles.length !== state.totalPairs * 2) errs.push('牌数不符');
    // 4) matched 的牌一定成对
    const matchedPairs = {};
    state.tiles.filter(t => t.matched).forEach(t => { matchedPairs[t.pairId] = (matchedPairs[t.pairId] || 0) + 1; });
    Object.keys(matchedPairs).forEach(p => { if (matchedPairs[p] !== 2) errs.push('半对已配对: ' + p); });
    // 5) pairsFound == matched 对数
    if (state.pairsFound !== Object.keys(matchedPairs).length) errs.push('pairsFound 与已配对数不符');
    // 6) flipped 最多 1 张（本实现的简化：翻第二张当场判定）
    if (state.flipped.length > 1) errs.push('flipped 超过 1 张');
    return errs;
  }

  return {
    LEVELS, FACES, SCORE,
    makeRng, shuffle, buildDeck, hasAdjacentPair,
    createGame, flip, peek, tick, timedOut, timeLeft,
    isFaceUp, isLocked, tileAt, stars, checkInvariants, cloneState,
  };
});
