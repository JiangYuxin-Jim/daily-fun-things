/* 雷区 · minesweeper engine — 纯函数，浏览器 / Node 两用
 * 棋盘状态用 Int8Array 存储：
 *   0..8  = 已揭开，值为周围雷数（含 0）
 *   9     = 未揭开
 *   10    = 已插旗
 * 雷位单独用 Uint8Array 保存（1=雷）。
 */
(function (root) {
  'use strict';

  const HIDDEN = 9;
  const FLAG = 10;

  function idx(w, r, c) { return r * w + c; }

  /** 确定性伪随机（mulberry32），便于测试复现 */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createGame(opts) {
    const rows = opts.rows, cols = opts.cols, mines = opts.mines;
    if (rows < 1 || cols < 1) throw new Error('棋盘尺寸非法');
    if (mines >= rows * cols) throw new Error('雷数必须小于格子数');
    return {
      rows, cols, mines,
      seed: opts.seed != null ? opts.seed >>> 0 : (Date.now() >>> 0),
      rand: rng(opts.seed != null ? opts.seed : Date.now()),
      board: new Int8Array(rows * cols).fill(HIDDEN),
      mineMap: new Uint8Array(rows * cols),
      firstMove: true,
      placed: false,
      state: 'ready', // ready | playing | won | lost
      flags: 0,
      revealed: 0,
      startTime: 0,
      endTime: 0,
      explodedAt: -1
    };
  }

  function neighbors(g, i) {
    const { rows, cols } = g;
    const r = (i / cols) | 0, c = i % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        out.push(nr * cols + nc);
      }
    }
    return out;
  }

  /** 布雷：首次点击及其 8 邻域保证无雷（安全首手） */
  function placeMines(g, safeIdx) {
    const total = g.rows * g.cols;
    const safe = new Set([safeIdx, ...neighbors(g, safeIdx)]);
    // 如果安全区大到雷放不下，退化为只保护点击格
    let banned = safe;
    if (total - banned.size < g.mines) banned = new Set([safeIdx]);
    const pool = [];
    for (let i = 0; i < total; i++) if (!banned.has(i)) pool.push(i);
    // Fisher-Yates 部分洗牌
    for (let i = 0; i < g.mines; i++) {
      const j = i + Math.floor(g.rand() * (pool.length - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      g.mineMap[pool[i]] = 1;
    }
    g.placed = true;
  }

  function countAdj(g, i) {
    let n = 0;
    const ns = neighbors(g, i);
    for (let k = 0; k < ns.length; k++) if (g.mineMap[ns[k]]) n++;
    return n;
  }

  /** 翻开一格；返回实际翻开的格子索引数组（含 flood fill） */
  function reveal(g, i) {
    if (g.state === 'won' || g.state === 'lost') return [];
    if (g.board[i] === FLAG) return [];
    if (g.board[i] !== HIDDEN) return [];

    if (g.firstMove) {
      placeMines(g, i);
      g.firstMove = false;
      g.state = 'playing';
      g.startTime = Date.now();
    }

    if (g.mineMap[i]) {
      g.board[i] = HIDDEN; // 踩雷格单独标记
      g.explodedAt = i;
      g.state = 'lost';
      g.endTime = Date.now();
      return [i];
    }

    const opened = [];
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop();
      if (g.board[cur] !== HIDDEN) continue;
      const n = countAdj(g, cur);
      g.board[cur] = n;
      opened.push(cur);
      g.revealed++;
      if (n === 0) {
        const ns = neighbors(g, cur);
        for (let k = 0; k < ns.length; k++) {
          if (g.board[ns[k]] === HIDDEN) stack.push(ns[k]);
        }
      }
    }
    checkWin(g);
    return opened;
  }

  function toggleFlag(g, i) {
    if (g.state === 'won' || g.state === 'lost') return false;
    if (g.board[i] === HIDDEN) {
      g.board[i] = FLAG; g.flags++;
      return true;
    }
    if (g.board[i] === FLAG) {
      g.board[i] = HIDDEN; g.flags--;
      return true;
    }
    return false;
  }

  /** 双击 chord：已揭开数字格，若周围旗数 == 数字，则翻开其余邻格 */
  function chord(g, i) {
    if (g.board[i] < 0 || g.board[i] > 8) return [];
    const ns = neighbors(g, i);
    let f = 0;
    for (const n of ns) if (g.board[n] === FLAG) f++;
    if (f !== g.board[i]) return [];
    let opened = [];
    for (const n of ns) {
      if (g.board[n] === HIDDEN) opened = opened.concat(reveal(g, n));
    }
    return opened;
  }

  function checkWin(g) {
    if (g.revealed === g.rows * g.cols - g.mines) {
      g.state = 'won';
      g.endTime = Date.now();
      // 自动把剩余雷插旗
      for (let i = 0; i < g.board.length; i++) {
        if (g.board[i] === HIDDEN) { g.board[i] = FLAG; g.flags++; }
      }
    }
  }

  function remaining(g) { return g.mines - g.flags; }

  /** 求解器：用「单格安全判定」逻辑逐步推理，测试 & 提示用 */
  function solveStep(g) {
    const hidden = [];
    for (let i = 0; i < g.board.length; i++) if (g.board[i] === HIDDEN) hidden.push(i);
    if (hidden.length === 0) return null;

    const cons = [];
    // 1) 单格约束：旗数 == 数字 → 其余邻格安全；旗数+未知 == 数字 → 全是雷
    for (let i = 0; i < g.board.length; i++) {
      const v = g.board[i];
      if (v < 0 || v > 8 || v === 0) continue;
      const ns = neighbors(g, i);
      let flags = 0, un = [];
      for (const n of ns) {
        if (g.board[n] === FLAG) flags++;
        else if (g.board[n] === HIDDEN) un.push(n);
      }
      if (un.length === 0) continue;
      const rem = v - flags;
      if (rem === 0) return { type: 'safe', idx: un[0] };
      if (rem === un.length) return { type: 'mine', idx: un[0] };
      cons.push({ un, rem });
    }
    // 2) 两格子集推断 A ⊂ B：差集雷数已知 → 确定安全/雷
    for (const A of cons) {
      for (const B of cons) {
        if (A === B || A.un.length > B.un.length) continue;
        if (!A.un.every((x) => B.un.indexOf(x) >= 0)) continue;
        const diff = B.un.filter((x) => A.un.indexOf(x) < 0);
        if (!diff.length) continue;
        const d = B.rem - A.rem;
        if (d === 0) return { type: 'safe', idx: diff[0] };
        if (d === diff.length) return { type: 'mine', idx: diff[0] };
      }
    }
    // 3) 全局推断：剩余雷数
    const rem = remaining(g);
    if (rem === hidden.length) return { type: 'mine', idx: hidden[0] };
    if (rem === 0) return { type: 'safe', idx: hidden[0] };
    return null; // 需要猜
  }

  function elapsed(g) {
    if (!g.startTime) return 0;
    const end = g.endTime || Date.now();
    return Math.max(0, Math.round((end - g.startTime) / 1000));
  }

  const api = { HIDDEN, FLAG, createGame, reveal, toggleFlag, chord, neighbors, solveStep, remaining, elapsed, idx, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MinesCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
