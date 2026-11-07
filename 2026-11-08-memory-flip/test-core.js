/* test-core.js — 引擎单元测试（无依赖，node test-core.js） */
'use strict';
const C = require('./core.js');

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`${label}\n   期望 ${e}\n   实际 ${a}`); }
}
function ok(v, label) { eq(!!v, true, label); }
function group(name, fn) {
  const p0 = pass, f0 = fail;
  try { fn(); } catch (err) { fail++; fails.push(`${name} 抛异常: ${err && err.stack}`); }
  console.log(`  ${fail === f0 ? '✅' : '❌'} ${name}  (+${pass - p0}${fail - f0 ? `, -${fail - f0}` : ''})`);
}

function newGame(level, seed) { return C.createGame({ level, seed: seed === undefined ? 12345 : seed }); }

// 造一个可控局面：直接指定 tiles 的 pairId，方便测翻牌逻辑
function rigged(pairs, cols, tileCount) {
  const tiles = [];
  const n = tileCount || pairs.length;
  for (let i = 0; i < n; i++) {
    const p = pairs[i % pairs.length];
    tiles.push({ id: i, face: 'F' + p, pairId: p, removed: false, matched: false });
  }
  return {
    seed: 1, level: 'easy', cols: cols || 4, rows: Math.ceil(tiles.length / (cols || 4)),
    tiles, flipped: [], peeksLeft: 0, peekUntil: null, moves: 0,
    pairsFound: 0, totalPairs: pairs.length / 2, combo: 0, bestCombo: 0, score: 0,
    over: false, won: false, reason: null, log: [], logicalTime: 0,
  };
}

console.log('=== memory-flip core 测试 ===');

group('PRNG 可复现', () => {
  const a = C.makeRng(42), b = C.makeRng(42), c = C.makeRng(43);
  const seqA = [a(), a(), a(), a()], seqB = [b(), b(), b(), b()], seqC = [c(), c(), c(), c()];
  eq(seqA, seqB, '相同种子序列相同');
  ok(JSON.stringify(seqA) !== JSON.stringify(seqC), '不同种子序列不同');
  seqA.forEach(v => ok(v >= 0 && v < 1, 'PRNG 值域 [0,1)'));
});

group('shuffle 是纯函数且是排列', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = C.shuffle(src, C.makeRng(7));
  eq(src, [1, 2, 3, 4, 5, 6, 7, 8], '原数组未被修改');
  eq(out.slice().sort((a, b) => a - b), src, '输出是原集合的一个排列');
  eq(C.shuffle(src, C.makeRng(7)), out, '同种子洗牌结果一致');
});

group('每个难度建局合法', () => {
  Object.keys(C.LEVELS).forEach(lv => {
    const s = newGame(lv, 99);
    const L = C.LEVELS[lv];
    eq(s.tiles.length, L.pairs * 2, `${lv} 牌数 = pairs*2`);
    eq(s.cols, L.cols, `${lv} 列数`);
    eq(s.totalPairs, L.pairs, `${lv} 对数`);
    eq(C.checkInvariants(s), [], `${lv} 不变量全绿`);
    eq(s.over, false, `${lv} 未结束`);
    eq(s.flipped, [], `${lv} 无未决翻牌`);
  });
});

group('建局：同种子可复现，不同种子可不同', () => {
  const a = newGame('hard', 2024), b = newGame('hard', 2024);
  eq(a.tiles.map(t => t.face), b.tiles.map(t => t.face), '同种子牌面顺序一致');
  const c = newGame('hard', 2025);
  ok(JSON.stringify(a.tiles.map(t => t.face)) !== JSON.stringify(c.tiles.map(t => t.face)), '不同种子牌面有差异');
});

group('建局：保证至少一对相邻', () => {
  let allHave = true;
  for (let seed = 1; seed <= 120; seed++) {
    for (const lv of Object.keys(C.LEVELS)) {
      const s = newGame(lv, seed);
      if (!C.hasAdjacentPair(s)) allHave = false;
    }
  }
  ok(allHave, '120 种子 × 4 难度 全部存在相邻对');
  // 反向校验：把一对牌硬塞到对角位置应当被判「无相邻」
  const s = rigged([0, 0, 1, 1], 2);
  eq(C.hasAdjacentPair(s), true, 'rigged 2×2 必相邻');
  const s2 = rigged([0, 1], 3, 6);   // [0,1,1 | 0,0,1] 无相邻同色
  eq(C.hasAdjacentPair(s2), false, '对角布局 → false');
  const s3 = rigged([0, 1, 0, 1], 2); // [0,1 | 0,1] 两个 0 竖直相邻
  eq(C.hasAdjacentPair(s3), true, '2×2 中 0,0 竖着相邻 → true');
});

group('翻第一张：状态只增一张', () => {
  const s = newGame('easy', 5);
  const r = C.flip(s, 0);
  ok(r.ok, '翻牌成功');
  eq(r.event, 'flip', 'event=flip');
  eq(r.state.flipped, [0], 'flipped=[0]');
  eq(r.state.moves, 1, 'moves=1');
  eq(s.flipped, [], '原 state 未被修改（不可变）');
});

group('翻同一张两次被拒', () => {
  const r1 = C.flip(newGame('easy', 5), 0);
  const r2 = C.flip(r1.state, 0);
  eq(r2.ok, false, '被拒');
  eq(r2.why, 'already', '原因 already');
});

group('配对成功：计分、连击、消除', () => {
  const s = rigged([0, 0, 1, 1, 2, 2, 3, 3]);
  // 找 0 的两张
  const ids = s.tiles.filter(t => t.pairId === 0).map(t => t.id);
  let a = C.flip(s, ids[0]);
  a = C.flip(a.state, ids[1]);
  eq(a.event, 'match', 'event=match');
  eq(a.state.pairsFound, 1, 'pairsFound=1');
  eq(a.state.score, 100, '首对 100 分');
  eq(a.state.combo, 1, 'combo=1');
  eq(a.state.tiles[ids[0]].matched, true, '第一张标记 matched');
  eq(a.state.tiles[ids[1]].matched, true, '第二张标记 matched');
  eq(a.state.flipped, [], '翻牌区已清空');
});

group('连击加分：第二对 +150', () => {
  const s = rigged([0, 0, 1, 1, 2, 2, 3, 3]);
  const id = p => s.tiles.filter(t => t.pairId === p).map(t => t.id);
  let st = C.flip(s, id(0)[0]).state;
  st = C.flip(st, id(0)[1]).state;
  st = C.flip(st, id(1)[0]).state;
  const r = C.flip(st, id(1)[1]);
  eq(r.event, 'match', '第二对成功');
  eq(r.state.combo, 2, 'combo=2');
  eq(r.state.bestCombo, 2, 'bestCombo=2');
  eq(r.state.score, 100 + 150, '总分 250');
});

group('配错：扣分、连击清零、牌不消', () => {
  const s = rigged([0, 0, 1, 1]);
  const idOf = f => s.tiles.find(t => t.pairId === f).id;
  const a = C.flip(s, idOf(0));
  const b = C.flip(a.state, s.tiles.find(t => t.pairId === 1).id);
  eq(b.event, 'miss', 'event=miss');
  eq(b.state.score, 0, '分数不为负（0）');
  eq(b.state.pairsFound, 0, '无配对');
  eq(b.state.combo, 0, 'combo 归零');
  eq(b.state.tiles.map(t => t.matched), [false, false, false, false], '没有牌被消除');
  eq(C.checkInvariants(b.state), [], '不变量仍成立');
});

group('翻已配对的牌被拒', () => {
  const s = rigged([0, 0, 1, 1]);
  const ids = s.tiles.filter(t => t.pairId === 0).map(t => t.id);
  let st = C.flip(s, ids[0]).state; st = C.flip(st, ids[1]).state;
  const r = C.flip(st, ids[0]);
  eq(r.ok, false, '被拒');
  eq(r.why, 'matched', '原因 matched');
});

group('翻第二张期间第三张被锁', () => {
  // 本实现在第二张翻开的同一次调用里就判定，所以 locked 只在 flip 内部短暂存在；
  // 这里验证 isLocked 的语义本身。
  const s = rigged([0, 0, 1, 1]);
  const s2 = C.cloneState(s); s2.flipped = [0];
  eq(C.isLocked(s2, 1), false, '只翻一张时不锁');
  s2.flipped = [0, 1];
  eq(C.isLocked(s2, 2), true, '翻两张时锁其他牌');
  eq(C.isLocked(s2, 0), false, '已翻开的牌不算锁');
});

group('通关判定', () => {
  const s = rigged([0, 0]);
  let st = C.flip(s, 0).state;
  const r = C.flip(st, 1);
  eq(r.state.over, true, 'over=true');
  eq(r.state.won, true, 'won=true');
  eq(r.state.reason, 'cleared', 'reason=cleared');
  const after = C.flip(r.state, 0);
  eq(after.ok, false, '结束后不能再翻');
  eq(after.why, 'over', '原因 over');
});

group('揭晓（peek）：扣分 / 次数 -1 / 到期收起', () => {
  const s = newGame('easy', 5);
  const before = s.peeksLeft;
  const r = C.peek(s, 1000);
  ok(r.ok, 'peek 成功');
  eq(r.state.peeksLeft, before - 1, '次数 -1');
  eq(r.state.peekUntil, 1000, 'peekUntil = 逻辑时间 + 持续');
  eq(r.state.score, 0, '分数不跌破 0');
  ok(C.isFaceUp(r.state, 0), '揭晓期间所有牌可见');
  const r2 = C.peek(r.state, 1000);
  eq(r2.ok, false, '揭晓中不能重复');
  const t1 = C.tick(r.state, 400);
  eq(t1.changed, false, '未到期 changed=false');
  ok(t1.state.peekUntil !== null, '仍处于揭晓');
  const t2 = C.tick(t1.state, 700);
  eq(t2.changed, true, '累计 1100ms 到期');
  eq(t2.state.peekUntil, null, '已收起');
  eq(C.isFaceUp(t2.state, 0), false, '收起后不可见');
});

group('揭晓期间翻牌 = 取消揭晓，不计步', () => {
  const s = C.peek(newGame('easy', 5), 1000).state;
  const r = C.flip(s, 3);
  eq(r.event, 'peek-cancel', 'event=peek-cancel');
  eq(r.state.peekUntil, null, '揭晓取消');
  eq(r.state.moves, 0, 'moves 不增加');
  eq(r.state.flipped, [], '没有翻开任何牌');
});

group('无揭晓次数时的 peek 被拒', () => {
  const s = newGame('hard', 5); // peeks = 0
  eq(s.peeksLeft, 0, 'hard 无揭晓');
  eq(C.peek(s, 1000).ok, false, '被拒');
  const s2 = newGame('easy', 5);
  const used = C.peek(s2, 1000).state;
  const used2 = C.peek(C.tick(used, 2000).state, 1000).state;
  eq(used2.peeksLeft, C.LEVELS.easy.peeks - 2, '连续用两次后剩余');
});

group('计时关（crazy）：timeLeft / timedOut', () => {
  const s = newGame('crazy', 5);
  eq(C.timeLeft(s), 180000, '初始 180s');
  eq(C.timedOut(s), false, '未超时');
  const t = C.tick(s, 179999).state;
  eq(C.timedOut(t), false, '差 1ms 未超时');
  const t2 = C.tick(t, 1).state;
  eq(C.timedOut(t2), true, '超时');
  eq(C.timeLeft(t2), 0, '剩余不为负');
  eq(C.timeLeft(newGame('easy', 5)), null, '非计时关返回 null');
});

group('星级', () => {
  const s = rigged([0, 0, 1, 1]);
  let st = C.flip(s, 0).state; st = C.flip(st, 1).state;
  st = C.flip(st, 2).state; st = C.flip(st, 3).state;
  eq(C.stars(st), 3, '零失误 = 3 星');
  const s2 = rigged([0, 0, 1, 1, 2, 2]);
  let a = C.flip(s2, 0).state; a = C.flip(a, 2).state; // 0 vs 1 错（-15）
  a = C.flip(a, 0).state; a = C.flip(a, 1).state;       // 配对 0
  a = C.flip(a, 2).state; a = C.flip(a, 4).state;       // 1 vs 2 配错（-15）
  a = C.flip(a, 2).state; a = C.flip(a, 3).state;       // 配对 1
  eq(a.pairsFound, 2, '成功两对');
  eq(a.log.filter(m => !m.hit).length, 2, '失误恰好 2 次');
  eq(a.won, false, '还有一对没配 → 未通关');
  eq(C.stars(a), 0, '未通关 0 星');

  // 通关但失误 2 次（对数 3）→ 2 星
  const s3 = rigged([0, 0, 1, 1, 2, 2]);
  let b = C.flip(s3, 0).state; b = C.flip(b, 2).state;  // miss
  b = C.flip(b, 0).state; b = C.flip(b, 1).state;       // 对 0
  b = C.flip(b, 2).state; b = C.flip(b, 4).state;       // miss
  b = C.flip(b, 2).state; b = C.flip(b, 3).state;       // 对 1
  b = C.flip(b, 4).state; b = C.flip(b, 5).state;       // 对 2
  eq(b.pairsFound, 3, '三对全找到');
  eq(b.won, true, '三对局通关');
  eq(C.stars(b), 2, '失误 2 ≤ 对数 3 → 2 星');
  // 用对数 2 的场景重算星级边界
  const s4 = rigged([0, 0, 1, 1]);
  let c = C.flip(s4, 0).state; c = C.flip(c, 2).state;   // miss
  c = C.flip(c, 0).state; c = C.flip(c, 1).state;       // 对 0
  c = C.flip(c, 2).state; c = C.flip(c, 3).state;       // 对 1
  eq(c.won, true, '2 对局通关');
  eq(C.stars(c), 3, '失误 1 次仍算 3 星（3 星允许 1 次容错）');
  const s5 = rigged([0, 0, 1, 1]);
  let d = C.flip(s5, 0).state; d = C.flip(d, 2).state;   // miss
  d = C.flip(d, 0).state; d = C.flip(d, 3).state;       // miss
  d = C.flip(d, 0).state; d = C.flip(d, 1).state;       // 对 0
  d = C.flip(d, 2).state; d = C.flip(d, 3).state;       // 对 1
  eq(d.won, true, '失误两次后仍能通关');
  eq(C.stars(d), 2, '失误 2 ≤ 对数 2 → 2 星');
  eq(C.stars(rigged([0, 0])), 0, '未通关 0 星');
});

group('不变量：随机对局 400 局逐步检查', () => {
  let violations = 0, games = 0;
  for (let seed = 1; seed <= 100; seed++) {
    for (const lv of Object.keys(C.LEVELS)) {
      games++;
      let s = newGame(lv, seed);
      // 随机源要分开建：不能和建局共用同一个 rng 实例语义（这里本来也各自新建）
      const rng = C.makeRng((seed * 31) >>> 0);
      let steps = 0;
      while (!s.over && steps < 500) {
        steps++;
        if (C.checkInvariants(s).length) { violations++; console.log('    违例:', C.checkInvariants(s), 'level', lv, 'seed', seed); break; }
        const closed = s.tiles.filter(t => !t.matched && s.flipped.indexOf(t.id) < 0).map(t => t.id);
        const pick = closed[Math.floor(rng() * closed.length)];
        const r = C.flip(s, pick);
        if (!r.ok) { violations++; console.log('    翻牌被拒:', r.why, 'id', pick); break; }
        s = r.state;
      }
      if (C.checkInvariants(s).length) violations++;
    }
  }
  eq(games, 400, '跑了 400 局');
  eq(violations, 0, '不变量违反 0 次');
});

group('不变量检查器本身有效（反向校验）', () => {
  const good = newGame('easy', 5);
  eq(C.checkInvariants(good), [], '正常局面无报错');
  const bad = C.cloneState(good);
  bad.tiles[0].face = '☠';                       // 制造奇数张
  ok(C.checkInvariants(bad).some(e => e.indexOf('奇数张') >= 0), '能抓出奇数张');
  const bad2 = C.cloneState(good);
  bad2.tiles[0].matched = true;                    // 半对已配对
  ok(C.checkInvariants(bad2).length > 0, '能抓出半对');
  const bad3 = C.cloneState(good);
  bad3.tiles.pop();                                // 牌数不符
  ok(C.checkInvariants(bad3).some(e => e.indexOf('牌数') >= 0), '能抓出牌数不符');
});

console.log('');
if (fail) { console.log('失败详情:'); fails.forEach(f => console.log('  · ' + f)); }
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
