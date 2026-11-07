/* test-solver.js — 记忆大师 AI 反向校验：带「完美记忆」的自动玩家打通 400 局并检查不变量 */
'use strict';
const C = require('./core.js');

/**
 * 完美记忆玩家：
 * - known[pairId] = 记住的牌 id 列表
 * - 策略：① 若已有翻开的一张且它的配对已知 → 配；② 若有已知的两张未消同 pair → 配；
 *         ③ 否则翻一张未知牌。
 * 理论上零失误必通关。任何一次 miss 都说明引擎状态不一致。
 */
function playPerfect(level, seed) {
  let s = C.createGame({ level, seed });
  const known = {};            // pairId -> Set(id)
  const remember = id => {
    const t = s.tiles[id];
    (known[t.pairId] = known[t.pairId] || new Set()).add(id);
  };

  let steps = 0;
  let flips = 0;
  while (!s.over && steps < 2000) {
    steps++;
    const open = s.flipped.slice();
    let pick = -1;

    if (open.length === 1) {
      const t = s.tiles[open[0]];
      const partners = [...(known[t.pairId] || [])].filter(id => id !== open[0] && !s.tiles[id].matched);
      if (partners.length) pick = partners[0];
    }

    if (pick < 0) {
      // 找一对都记住且未消的
      for (const pid of Object.keys(known)) {
        const ids = [...known[pid]].filter(id => !s.tiles[id].matched && open.indexOf(id) < 0);
        if (ids.length >= 2) { pick = ids[0]; break; }
      }
    }

    if (pick < 0) {
      // 翻一张还完全未知、也没翻开过的牌（优先从「有一张已记住的配对」里找，制造配对机会）
      const unseen = s.tiles.filter(t => !t.matched && open.indexOf(t.id) < 0 && !(known[t.pairId] && known[t.pairId].has(t.id))).map(t => t.id);
      if (!unseen.length) break;
      // 先翻「我已经认识它伙伴」的那些，提高命中
      const withPartner = unseen.filter(id => {
        const pid = s.tiles[id].pairId;
        return known[pid] && [...known[pid]].some(x => x !== id && !s.tiles[x].matched);
      });
      pick = (withPartner.length ? withPartner : unseen)[0];
    }

    const r = C.flip(s, pick);
    if (!r.ok) return { ok: false, why: 'flip-rejected:' + r.why, seed, level };
    flips++;
    if (r.event === 'match' || r.event === 'miss' || r.event === 'flip') remember(pick);
    if (r.event === 'miss') {
      // 完美玩家不该失误
      return { ok: false, why: 'unexpected-miss', seed, level, at: flips };
    }
    s = r.state;
    const errs = C.checkInvariants(s);
    if (errs.length) return { ok: false, why: 'invariant:' + errs.join('|'), seed, level };
  }

  return { ok: s.over && s.won, s, flips, steps };
}

console.log('=== 记忆大师 AI 反向校验（完美记忆必通关）===');
let total = 0, wins = 0, bad = [];
const scoreByLevel = {};
const flipsByLevel = {};
for (const lv of Object.keys(C.LEVELS)) {
  scoreByLevel[lv] = 0;
  flipsByLevel[lv] = [];
}
for (let seed = 1; seed <= 100; seed++) {
  for (const lv of Object.keys(C.LEVELS)) {
    total++;
    const r = playPerfect(lv, seed);
    if (r.ok) {
      wins++;
      scoreByLevel[lv] += r.s.score;
      flipsByLevel[lv].push(r.flips);
      // 完美对局星级必须是 3
      if (C.stars(r.s) !== 3) bad.push(`${lv}/${seed} 完美局却没 3 星: ${C.stars(r.s)}`);
      // 连击数 = 对数
      if (r.s.bestCombo !== r.s.totalPairs) bad.push(`${lv}/${seed} bestCombo=${r.s.bestCombo} != ${r.s.totalPairs}`);
      if (r.s.pairsFound !== r.s.totalPairs) bad.push(`${lv}/${seed} pairsFound 不足`);
    } else {
      bad.push(`${lv}/${seed} 失败: ${r.why}`);
    }
  }
}

console.log(`总局数          : ${total}`);
console.log(`完美通关        : ${wins} / ${total}  (${(wins / total * 100).toFixed(1)}%)`);
console.log('问题次数        : ' + bad.length);
if (bad.length) bad.slice(0, 10).forEach(b => console.log('  · ' + b));

console.log('');
console.log('各难度平均：');
for (const lv of Object.keys(C.LEVELS)) {
  const fl = flipsByLevel[lv];
  const avgFlips = fl.reduce((a, b) => a + b, 0) / fl.length;
  console.log(`  ${lv.padEnd(6)} 对数 ${String(C.LEVELS[lv].pairs).padStart(2)}  平均翻牌 ${avgFlips.toFixed(1).padStart(6)}  平均分 ${(scoreByLevel[lv] / fl.length).toFixed(0).padStart(6)}  （理论最少翻牌 ${C.LEVELS[lv].pairs * 2}）`);
}

// 反向校验：故意用「瞎翻」玩家，必须出现失误 → 说明失败路径也是通的
function playRandom(level, seed) {
  let s = C.createGame({ level, seed });
  const rng = C.makeRng(seed * 7 + 3);
  let steps = 0;
  while (!s.over && steps < 2000) {
    steps++;
    const pool = s.tiles.filter(t => !t.matched && s.flipped.indexOf(t.id) < 0).map(t => t.id);
    const r = C.flip(s, pool[Math.floor(rng() * pool.length)]);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}
let missGames = 0, randomWins = 0;
for (let seed = 1; seed <= 200; seed++) {
  const s = playRandom('easy', seed);
  if (s.log.some(m => !m.hit)) missGames++;
  if (s.won) randomWins++;
  if (C.checkInvariants(s).length) bad.push('盲翻不变量违例 seed=' + seed);
}
const avgMiss = (() => {
  let total = 0, n = 0;
  for (let seed = 1; seed <= 200; seed++) { const s = playRandom('easy', seed); total += s.log.filter(m => !m.hit).length; n++; }
  return total / n;
})();
console.log('');
console.log(`盲翻玩家（easy）: 200 局里 ${missGames} 局出现失误，${randomWins} 局侥幸通关`);
console.log(`盲翻平均失误次数: ${avgMiss.toFixed(1)} 次（对照：完美记忆 0 次 / 盲翻最少翻牌 = 无穷次才必通关）`);
console.log(`完美局反例：若全部已知，最少翻牌数 = 对数×2，盲翻平均多翻 ${(avgMiss * 2).toFixed(0)} 次`);
if (missGames === 0) { console.log('⚠️ 盲翻 0 失误，说明判定可能有 bug'); process.exit(1); }

if (bad.length || wins !== total) process.exit(1);
console.log('✅ 全部通过');
