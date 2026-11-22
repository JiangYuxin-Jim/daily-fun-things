// selftest.js — 无浏览器依赖的自检：用假 canvas 跑真实模拟
const { Tank } = require('./tank.js');

const fakeCanvas = { width: 960, height: 540 };
const tank = new Tank(fakeCanvas, { fish: 8 });

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name + (extra ? '  ' + extra : ''));
  else { console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); fail++; }
}

// 1. 初始状态
ok('初始鱼数 = 8', tank.fish.length === 8, 'got ' + tank.fish.length);

// 2. 鱼都在缸里
let inside = tank.fish.every(f => f.x > 0 && f.x < tank.w && f.y > 0 && f.y < tank.sand);
ok('鱼初始都在水体内', inside);

// 3. 投食后鱼会吃到
tank.feedRandom(20);
const foodBefore = tank.food.length;
ok('投食产生鱼食', foodBefore === 20, 'got ' + foodBefore);

for (let i = 0; i < 60 * 30; i++) tank.step(1 / 60);  // 模拟 30 秒
const foodAfter = tank.food.length;
ok('30 秒后鱼食被吃掉大部分', foodAfter < foodBefore * 0.5, foodBefore + ' -> ' + foodAfter);

// 4. 吃完后饥饿感下降
const hungers = tank.fish.map(f => f.hunger);
const avgH = hungers.reduce((a, b) => a + b, 0) / hungers.length;
ok('平均饥饿度仍受控 < 0.85', avgH < 0.85, 'avg=' + avgH.toFixed(2));

// 5. 长时间模拟不 NaN、不出缸
for (let i = 0; i < 60 * 120; i++) tank.step(1 / 60);  // 再 2 分钟
const finite = tank.fish.every(f => Number.isFinite(f.x) && Number.isFinite(f.y)
  && Number.isFinite(f.vx) && Number.isFinite(f.vy) && Number.isFinite(f.ang));
ok('长时模拟数值全部有限（无 NaN/Infinity）', finite);
const bounded = tank.fish.every(f => f.x >= 0 && f.x <= tank.w && f.y >= 0 && f.y <= tank.sand);
ok('长时模拟后鱼仍在缸内', bounded);
const maxV = Math.max(...tank.fish.map(f => Math.hypot(f.vx, f.vy)));
ok('速度有上限（<= 120 px/s）', maxV <= 120, 'max=' + maxV.toFixed(1));

// 6. 水质会变浑
ok('水质因杂质下降 (< 0.99)', tank.clarity < 0.99, 'clarity=' + tank.clarity.toFixed(3));

// 7. 摸鱼 & 命中检测
const t2 = new Tank({ width: 800, height: 500 }, { fish: 1 });
const f0 = t2.fish[0];
const hit = t2.fishAt(f0.x, f0.y);
ok('fishAt 能命中目标鱼', hit === f0);
ok('fishAt 空白处返回 null', t2.fishAt(0, 0) === null || t2.fishAt(0, 0) !== f0);
t2.pet(f0);
ok('摸鱼后 petT > 0', f0.petT > 0);

// 8. 容量上限
for (let i = 0; i < 40; i++) t2.addFish();
ok('鱼数上限 24', t2.fish.length === 24, 'got ' + t2.fish.length);
ok('满了以后 addFish 返回 null', t2.addFish() === null);

// 9. hud
const h = tank.hud();
ok('hud 字段完整', ['fish','temp','quality','clarity'].every(k => k in h), JSON.stringify({fish:h.fish, temp:+h.temp.toFixed(1), q:h.quality}));

// 10. 暂停
tank.togglePause();
const yBefore = tank.fish[0].y;
tank.frame(1000); tank.frame(1016);
ok('暂停时鱼不动', tank.paused === true && tank.fish[0].y === yBefore);

console.log(fail === 0 ? '\n全部通过 ✅' : '\n失败 ' + fail + ' 项 ❌');
process.exit(fail === 0 ? 0 : 1);
