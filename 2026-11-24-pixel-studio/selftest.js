/* selftest.js — 核心算法自检（node selftest.js） */
const P = require('./pixcore.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], NONE = [0, 0, 0, 0];

console.log('[line] Bresenham');
{
  const pts = P.linePoints(0, 0, 5, 0);
  ok('横向直线 6 个点', pts.length === 6 && eq(pts[0], [0, 0]) && eq(pts[5], [5, 0]), pts);
  const d = P.linePoints(0, 0, 3, 3);
  ok('对角直线 4 个点且连续', d.length === 4 && eq(d[3], [3, 3]), d);
  const rev = P.linePoints(5, 5, 0, 0);
  ok('反向绘制端点正确', eq(rev[0], [5, 5]) && eq(rev[rev.length - 1], [0, 0]));
  const steep = P.linePoints(0, 0, 2, 7);
  ok('陡峭线覆盖率正确', steep.length === 8, steep.length);
}

console.log('[rect] 方框轮廓');
{
  const r = P.rectPoints(0, 0, 3, 3);
  ok('4x4 方框 12 个点（去重前）', r.length === 12, r.length);
  const fwd = P.rectPoints(0, 0, 2, 2).slice().sort();
  const r2 = P.rectPoints(2, 2, 0, 0); // 反向拖拽
  ok('反向拖拽结果一致', eq(r2.slice().sort(), fwd), r2);
}

console.log('[fill] 洪水填充');
{
  const g = P.makeGrid(8, 8);
  // 画一个闭合红框，外部填充蓝，内部应保持透明
  P.rectPoints(2, 2, 5, 5).forEach(([x, y]) => P.putPixel(g, x, y, RED));
  const n = P.floodFill(g, 0, 0, BLUE);
  ok('外部填充了像素', n > 0, n);
  ok('角点变蓝', eq(P.getPixel(g, 0, 0), BLUE));
  ok('内部未被填充（框是闭合的）', eq(P.getPixel(g, 3, 3), NONE), P.getPixel(g, 3, 3));
  ok('边框仍是红色', eq(P.getPixel(g, 2, 2), RED));
  ok('同色再填返回 0', P.floodFill(g, 0, 0, BLUE) === 0);
  // 涂满整个格子
  const g2 = P.makeGrid(4, 4);
  const m = P.floodFill(g2, 0, 0, RED);
  ok('全透明区域填满 16 格', m === 16, m);
}

console.log('[scale] 最近邻放大');
{
  const g = P.makeGrid(2, 2);
  P.putPixel(g, 0, 0, RED);
  P.putPixel(g, 1, 1, BLUE);
  const big = P.scaleNearest(g, 3);
  ok('尺寸 6x6', big.w === 6 && big.h === 6);
  ok('左上 3x3 全红', eq(P.getPixel(big, 0, 0), RED) && eq(P.getPixel(big, 2, 2), RED));
  ok('右下 3x3 全蓝', eq(P.getPixel(big, 5, 5), BLUE) && eq(P.getPixel(big, 3, 3), BLUE));
  ok('右上透明', eq(P.getPixel(big, 5, 0), NONE));
}

console.log('[resize] 画布缩放');
{
  const g = P.makeGrid(16, 16);
  P.putPixel(g, 0, 0, RED);
  const s = P.resizeGrid(g, 32, 32);
  ok('放大到 32x32', s.w === 32 && s.h === 32 && s.data.length === 32 * 32 * 4);
  ok('左上区域仍是红', P.getPixel(s, 0, 0)[3] > 0);
  const down = P.resizeGrid(g, 8, 8);
  ok('缩小到 8x8 不丢失结构', down.w === 8 && down.data.length === 8 * 8 * 4);
}

console.log('[codec] 存档编解码');
{
  const g = P.makeGrid(5, 5);
  for (let i = 0; i < 25; i++) P.putPixel(g, i % 5, (i / 5) | 0, [i * 10, 255 - i * 10, (i * 37) % 256, 255]);
  const b64 = P.encode(g);
  const back = P.decode(5, 5, b64);
  ok('往返完全一致', eq(Array.from(back.data), Array.from(g.data)));
}

console.log('[misc] 边界与空判断');
{
  const g = P.makeGrid(4, 4);
  ok('空图 is empty', P.isEmpty(g));
  P.putPixel(g, 3, 3, RED);
  ok('有像素即非空', !P.isEmpty(g));
  ok('越界写入返回 false', P.putPixel(g, 9, 9, RED) === false);
  ok('越界读取返回全 0', eq(P.getPixel(g, -1, 0), [0, 0, 0, 0]));
  ok('cloneGrid 不影响原图', (() => {
    const c = P.cloneGrid(g); c.data[0] = 99; return g.data[0] === 0;
  })());
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
