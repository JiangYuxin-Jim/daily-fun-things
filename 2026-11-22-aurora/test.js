const A = require('./aurora.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('值为 [0,1] 的随机源');
const rnd = A.mulberry32(42);
let mn = 1, mx = 0;
for (let i = 0; i < 5000; i++) { const r = rnd(); mn = Math.min(mn, r); mx = Math.max(mx, r); }
ok('随机数落在 [0,1)', mn >= 0 && mx < 1, mn + '..' + mx);
ok('同种子可复现', A.mulberry32(42)() === A.mulberry32(42)());

console.log('噪声');
let nmin = 1, nmax = 0;
for (let i = 0; i < 3000; i++) nmin = Math.min(nmin, A.valueNoise(i * 0.13, i * 0.07, 7));
ok('valueNoise ⊂ [0,1)', nmin >= 0 && nmax <= 1);
const f = A.fbm(1.234, 5.678, 99);
ok('fbm 有限且在 [0,1]', isFinite(f) && f >= 0 && f <= 1, f);
ok('fbm 确定性', A.fbm(1.234, 5.678, 99) === f);

console.log('极光场');
let fmin = 1, fmax = 0, nanCount = 0;
for (let v = 0; v <= 1.0001; v += 0.02) for (let u = 0; u <= 1.0001; u += 0.02) {
  const x = A.auroraField(u, v, 3.5, 1337);
  if (!isFinite(x)) nanCount++;
  fmin = Math.min(fmin, x); fmax = Math.max(fmax, x);
}
ok('场值无 NaN/Inf', nanCount === 0);
ok('场值 ∈ [0,1]', fmin >= 0 && fmax <= 1, fmin.toFixed(3) + '..' + fmax.toFixed(3));
ok('存在明显亮区', fmax > 0.3, 'max=' + fmax.toFixed(3));
ok('地平线比天顶暗', A.auroraField(0.5, 0.98, 1, 1337) < A.auroraField(0.5, 0.3, 1, 1337));

console.log('调色');
const c0 = A.auroraColor(0, 0), c1 = A.auroraColor(1, 0);
ok('强度 0 偏暗', c0[1] < 60);
ok('强度 1 偏亮紫', c1[2] > 200 && c1[0] > 120, c1.join(','));
ok('warmth 抬高红通道', A.auroraColor(0.8, 1)[0] >= A.auroraColor(0.8, 0)[0]);

console.log('整帧渲染');
const t0 = Date.now();
const frame = A.renderFrame(64, 40, 2.0, { seed: 5 });
const dt = Date.now() - t0;
ok('像素数正确', frame.data.length === 64 * 40 * 4);
let opaque = true, nonBlack = 0;
for (let i = 0; i < frame.data.length; i += 4) {
  if (frame.data[i + 3] !== 255) opaque = false;
  if (frame.data[i] + frame.data[i + 1] + frame.data[i + 2] > 60) nonBlack++;
}
ok('alpha 全不透明', opaque);
ok('画面非纯黑', nonBlack > frame.data.length / 4 * 0.1, nonBlack + ' px');
ok('64×40 一帧 < 200ms', dt < 200, dt + 'ms');

const luma = A.renderLuma(32, 24, 4.0, { seed: 11 });
ok('luma 均值合理', luma.mean > 0.02 && luma.mean < 0.5, luma.mean.toFixed(4));

// 时间推进：同一位置亮度应随时间变化（极光在动）
const a = A.auroraField(0.4, 0.4, 0, 1337), b = A.auroraField(0.4, 0.4, 5, 1337);
ok('随时间演化', Math.abs(a - b) > 1e-4, Math.abs(a - b).toFixed(5));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
