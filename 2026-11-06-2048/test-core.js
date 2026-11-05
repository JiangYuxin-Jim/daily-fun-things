const G = require('./core.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n    got :', JSON.stringify(got), '\n    want:', JSON.stringify(want)); }
}

console.log('— slideLine —');
eq('基本合并 2,2,4,4 -> 4,8,0,0', G.slideLine([2, 2, 4, 4]).line, [4, 8, 0, 0]);
eq('一个 2 只能合并一次 2,2,2,0 -> 4,2', G.slideLine([2, 2, 2, 0]).line, [4, 2, 0, 0]);
eq('2,2,2,2 -> 4,4', G.slideLine([2, 2, 2, 2]).line, [4, 4, 0, 0]);
eq('得分 2,2,4,4 = 12', G.slideLine([2, 2, 4, 4]).gained, 12);
eq('空行不动', G.slideLine([0, 0, 0, 0]).line, [0, 0, 0, 0]);
eq('4,0,0,4 -> 8,0,0,0', G.slideLine([4, 0, 0, 4]).line, [8, 0, 0, 0]);

console.log('— move 四向 —');
const b0 = [
  2, 2, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
  4, 4, 4, 4
];
eq('left 第一行', G.move(b0, 'left').board.slice(0, 4), [4, 0, 0, 0]);
eq('left 末行 4x4 -> 8,8', G.move(b0, 'left').board.slice(12), [8, 8, 0, 0]);
eq('right 末行 -> 0,0,8,8', G.move(b0, 'right').board.slice(12), [0, 0, 8, 8]);
eq('left 得分 = 4 + 16', G.move(b0, 'left').score, 20);

const bc = [
  2, 0, 0, 0,
  2, 0, 0, 0,
  2, 0, 0, 0,
  0, 0, 0, 0
];
eq('up 列合并后顶端 = 4,2', [0, 4, 8, 12].map(i => G.move(bc, 'up').board[i]), [4, 2, 0, 0]);
eq('down 列合并后底端', [0, 4, 8, 12].map(i => G.move(bc, 'down').board[i]), [0, 0, 2, 4]);

console.log('— 不变量 —');
const bStill = [2, 4, 0, 8, 4, 2, 0, 16, 8, 4, 0, 32, 16, 8, 2, 64];
// 注意：bStill 前两列已靠左，但第 3 列全空 → up 会变；用满列构造
const bLock = [2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 8];
eq('满盘交错左滑不动', G.move(bLock, 'left').moved, false);
const bMergeLeft = [2, 2, 8, 16, 4, 4, 16, 32, 8, 8, 2, 4, 16, 16, 4, 8];
eq('满盘可合并左滑就动', G.move(bMergeLeft, 'left').moved, true);
const bNoUp = [2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 2, 4, 8, 16];
eq('已顶到顶时 up 不动', G.move(bNoUp, 'up').moved, false);
eq('有变化 moved=true', G.move(b0, 'left').moved, true);
// 总和减少量 = 得分（合并 2+2→4 时总数不变但得 4 分，故用“得分 = 所有合并后块的日志值”校验）
{
  const bOnly = [2, 2, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = G.move(bOnly, 'left');
  eq('合并后布局 4,8', r.board.slice(0, 2), [4, 8]);
  eq('得分确为 4', r.score, 4);
  // 不变量：得分等于所有合并产生的新块之和
  const bMix = [2, 2, 4, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0];
  eq('多次合并得分 = 4 + 16 + 16', G.move(bMix, 'left').score, 36);
}

console.log('— 胜负判定 —');
const full = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
eq('满盘交错 = 必死', G.canMove(full), false);
const fullMerge = [2, 4, 2, 4, 4, 4, 4, 2, 2, 4, 8, 4, 4, 2, 4, 2];
eq('满盘但可合并 = 活着', G.canMove(fullMerge), true);
eq('空格即活着', G.canMove(G.createBoard()), true);
eq('达到 2048 算赢', G.hasWon([0, 0, 0, 0, 0, 2048, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), true);
eq('1024 还没赢', G.hasWon([0, 0, 0, 0, 0, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), false);

console.log('— 随机生成 —');
{
  const b = G.createBoard();
  const rng = G.seededRng(42);
  const idx = G.spawn(b, rng);
  eq('spawn 填了一个非零', b[idx] > 0 && b[idx] % 2 === 0, true);
  eq('spawn 后空格少一个', G.emptyCells(b).length, 15);
  eq('空盘无法 spawn', G.spawn(G.createBoard(1).fill(2)), null);
}

console.log('— AI 自对弈（种子 7，最多 2000 步）—');
{
  const rng = G.seededRng(7);
  const bb = G.createBoard();
  G.spawn(bb, rng); G.spawn(bb, rng);
  let score = 0, steps = 0;
  var b = bb;
  while (steps < 2000 && G.canMove(b)) {
    const m = G.bestMove(b, 4, rng);
    if (!m.dir) break;
    const r = G.move(b, m.dir);
    score += r.score; b = r.board; steps++;
    G.spawn(b, rng);
  }
  console.log('  步数:', steps, '得分:', score, '最大块:', G.maxTile(b));
  eq('AI 能打到 1024 以上', G.maxTile(b) >= 1024, true);
  eq('AI 得有几十步以上', steps > 100, true);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
