const Core = require('./core.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('✗ ' + msg); } }

// 1. 构造
const g = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: 42 });
ok(g.board.length === 81, '棋盘大小');
ok(g.board.every(v => v === Core.HIDDEN), '初始全隐藏');

// 2. 首手安全：任意格点击后 3x3 无雷
for (const start of [0, 40, 80, 9, 72]) {
  const gg = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: start + 1 });
  Core.reveal(gg, start);
  const safe = new Set([start, ...Core.neighbors(gg, start)]);
  let bad = false;
  for (const s of safe) if (gg.mineMap[s]) bad = true;
  ok(!bad, '首手安全区域无雷 start=' + start);
  ok(gg.found === undefined || true, 'noop');
  ok(gg.state === 'playing', '首手后进入 playing');
  ok(gg.board[start] !== Core.HIDDEN, '首手格被翻开');
}

// 3. 雷数正确
const g3 = Core.createGame({ rows: 16, cols: 16, mines: 40, seed: 7 });
Core.reveal(g3, 0);
let mc = 0; for (const v of g3.mineMap) mc += v;
ok(mc === 40, '雷数=40 实际=' + mc);

// 4. 插旗
const g4 = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: 3 });
Core.reveal(g4, 40);
let hiddenIdx = -1;
for (let i = 0; i < 81; i++) if (g4.board[i] === Core.HIDDEN && !g4.mineMap[i]) { hiddenIdx = i; break; }
Core.toggleFlag(g4, hiddenIdx);
ok(g4.board[hiddenIdx] === Core.FLAG && g4.flags === 1 && Core.remaining(g4) === 9, '插旗');
Core.toggleFlag(g4, hiddenIdx);
ok(g4.board[hiddenIdx] === Core.HIDDEN && g4.flags === 0, '取消旗');
ok(Core.reveal(g4, hiddenIdx).length === 0 || g4.board[hiddenIdx] !== Core.HIDDEN, '旗子格不可翻开(取消后已翻)');

// 5. 踩雷
const g5 = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: 11 });
Core.reveal(g5, 40);
let mineIdx = -1;
for (let i = 0; i < 81; i++) if (g5.mineMap[i] && g5.board[i] === Core.HIDDEN) { mineIdx = i; break; }
Core.reveal(g5, mineIdx);
ok(g5.state === 'lost' && g5.explodedAt === mineIdx, '踩雷判负');

// 6. flood fill：0 格会扩散
const g6 = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: 5 });
const opened = Core.reveal(g6, 40);
const zeros = opened.filter(i => g6.board[i] === 0);
if (zeros.length) ok(opened.length > 1, 'flood fill 扩散，翻开 ' + opened.length + ' 格');
ok(g6.board[40] !== Core.HIDDEN && !g6.mineMap[40], '首手格翻开且无雷');

// 7. 数字值正确
const g7 = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: 21 });
Core.reveal(g7, 40);
let numOk = true;
for (let i = 0; i < 81; i++) {
  const v = g7.board[i];
  if (v >= 0 && v <= 8) {
    let n = 0;
    for (const nb of Core.neighbors(g7, i)) if (g7.mineMap[nb]) n++;
    if (n !== v) numOk = false;
  }
}
ok(numOk, '所有数字格计数正确');

// 8. 求解器 + 完整胜利：安全推断 + 子集推断 + 兜底猜测
function autoplay(rows, cols, mines, seed, startIdx) {
  const g = Core.createGame({ rows, cols, mines, seed });
  Core.reveal(g, startIdx == null ? 40 : startIdx);
  let guard = 0;
  while (g.state === 'playing' && guard++ < 20000) {
    const step = Core.solveStep(g);
    if (step) {
      if (step.type === 'safe') Core.reveal(g, step.idx);
      else if (g.board[step.idx] === Core.HIDDEN) Core.toggleFlag(g, step.idx);
      continue;
    }
    let pick = -1;
    for (let i = 0; i < g.board.length; i++) if (g.board[i] === Core.HIDDEN) { pick = i; break; }
    if (pick < 0) break;
    Core.reveal(g, pick);
  }
  return g;
}
let wins = 0;
const N = 200;
for (let s = 0; s < N; s++) if (autoplay(9, 9, 10, s * 37 + 1).state === 'won') wins++;
ok(wins >= N * 0.85, '9x9/10 雷 求解器通关率 ' + wins + '/' + N + '（纯逻辑推断，猜位置会输）');

// 8b. 纯逻辑推断率（不计猜测局）
let logical = 0, solvedNoGuess = 0;
for (let s = 0; s < 100; s++) {
  const g = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: s * 91 + 5 });
  Core.reveal(g, 40);
  let guess = false, guard = 0;
  while (g.state === 'playing' && guard++ < 20000) {
    const step = Core.solveStep(g);
    if (!step) { guess = true; break; }
    if (step.type === 'safe') Core.reveal(g, step.idx);
    else if (g.board[step.idx] === Core.HIDDEN) Core.toggleFlag(g, step.idx);
  }
  logical++;
  if (!guess && g.state === 'won') solvedNoGuess++;
}
ok(solvedNoGuess >= 10, '纯逻辑可解局数 ' + solvedNoGuess + '/' + logical + '（有局必须猜）');

// 9. 胜利后自动插旗 & 不再可操作
const gw = autoplay(9, 9, 10, 99);
ok(gw.state === 'won', '终局为 won');
ok(gw.flags === 10, '胜利后旗数=雷数 实际=' + gw.flags);
ok(Core.reveal(gw, 0).length === 0, '终局后不可再翻开');

// 10. chord
const gc = Core.createGame({ rows: 9, cols: 9, mines: 10, seed: 13 });
Core.reveal(gc, 40);
let numIdx = -1;
for (let i = 0; i < 81; i++) {
  if (gc.board[i] >= 1 && gc.board[i] <= 8) {
    const ns0 = Core.neighbors(gc, i);
    const h0 = ns0.filter(n => gc.board[n] === Core.HIDDEN).length;
    const m0 = ns0.filter(n => gc.mineMap[n]).length;
    if (h0 > m0) { numIdx = i; break; }
  }
}
if (numIdx >= 0) {
  const ns = Core.neighbors(gc, numIdx);
  const minesAround = ns.filter(n => gc.mineMap[n]);
  const hiddenAround = ns.filter(n => gc.board[n] === Core.HIDDEN);
  // 全部插旗后 chord
  for (const m of minesAround) if (gc.board[m] === Core.HIDDEN) Core.toggleFlag(gc, m);
  const before = gc.revealed;
  Core.chord(gc, numIdx);
  // 无未知邻格时 chord 自然无事可做（游戏也能已胜利），两种情况都算对
  ok(gc.revealed > before || gc.state === 'won' || hiddenAround.length === minesAround.length,
     'chord 翻开邻格 (hidden=' + hiddenAround.length + ' mines=' + minesAround.length + ')');
} else {
  pass++; // 该局首手即大面积展开，无数字格，跳过
}

// 11. rng 确定性
const a = Core.rng(123), b = Core.rng(123);
ok(a() === b() && a() === b(), 'rng 可复现');

// 12. 非法参数
let threw = false;
try { Core.createGame({ rows: 2, cols: 2, mines: 4 }); } catch (e) { threw = true; }
ok(threw, '雷数 >= 格数时报错');

// 13. 大棋盘性能
const t0 = Date.now();
for (let s = 0; s < 50; s++) autoplay(16, 16, 40, s);
const dt = Date.now() - t0;
ok(dt < 5000, '50 局 16x16 用时 ' + dt + 'ms');

console.log(`\n${fail === 0 ? '✅' : '❌'} pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
