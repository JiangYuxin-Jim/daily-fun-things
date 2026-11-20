// 核心引擎自检（一次性跑通即可）
const C = require('./cosmos.js');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

// 1. 随机数可复现
const a = C.makeRng(42), b = C.makeRng(42);
ok(a() === b(), '同种子随机数可复现');

// 2. 生成粒子
let ps = C.createParticles(300, 7);
ok(ps.length === 300, '生成 300 个粒子');
ok(ps.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx)), '初值均为有限数');
ok(ps.every(p => Math.hypot(p.x, p.y) <= 0.95), '初始半径不超过 0.95');

// 3. 圆心单粒子受力 = 0（对称性）
let one = [{ x: 0, y: 0, vx: 0, vy: 0, m: 1, hue: 200 },
           { x: -0.5, y: 0, vx: 0, vy: 0, m: 1, hue: 200 },
           { x: 0.5, y: 0, vx: 0, vy: 0, m: 1, hue: 200 }];
C.step(one, { dt: 0.01, G: 1, soft: 0.05 });
ok(Math.abs(one[0].vx) < 1e-12 && Math.abs(one[0].vy) < 1e-12, '圆心粒子受力对称抵消');

// 4. 引力吸引方向正确：两粒子相互靠近
let two = [{ x: -0.5, y: 0, vx: 0, vy: 0, m: 1, hue: 0 },
           { x: 0.5, y: 0, vx: 0, vy: 0, m: 1, hue: 0 }];
const d0 = Math.abs(two[0].x - two[1].x);
C.step(two, { dt: 0.01, G: 1, soft: 0.02 });
const d1 = Math.abs(two[0].x - two[1].x);
ok(d1 < d0, '两粒子在引力下靠近 (' + d0.toFixed(4) + ' → ' + d1.toFixed(4) + ')');

// 5. 长时间稳定：不出现 NaN / 不发散
ps = C.createParticles(300, 99);
for (let i = 0; i < 600; i++) C.step(ps, { dt: 0.012, G: 0.25, soft: 0.03, damping: 0.9995, anchor: 3 });
const s = C.stats(ps);
ok(ps.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx)), '600 步后无 NaN/Inf');
ok(s.maxR < 6, '600 步后未发散 (maxR=' + s.maxR.toFixed(2) + ')');
ok(s.maxR > 0.3, '600 步后仍保持结构 (maxR=' + s.maxR.toFixed(2) + ')');
ok(s.mass > 0, '总质量 ' + s.mass.toFixed(1));

// 6. 搅拌冲量只影响半径内粒子
let sp = [{ x: 0.0, y: 0, vx: 0, vy: 0, m: 1, hue: 0 },
          { x: 0.9, y: 0, vx: 0, vy: 0, m: 1, hue: 0 }];
C.stir(sp, 0.1, 0, 1, 0.3);
ok(sp[0].vx !== 0, '半径内粒子被推动');
ok(sp[1].vx === 0, '半径外粒子不受影响');

// 7. 质心计算
ok(Math.abs(s.comX) < 1e-9 || Number.isFinite(s.comX), '质心为有限数');

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
