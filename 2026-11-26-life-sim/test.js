// 自检：语法层 + 引擎实跑 + 可复现性 + 不变量
const LifeSim = require('./life-sim.js');

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓', name);
  else { fails++; console.log('  ✗', name, extra !== undefined ? extra : ''); }
}

// 1) 单人完整一生
const life = LifeSim.runFull(20261126);
ok('年龄在合理区间 (30-110)', life.age >= 30 && life.age <= 110, life.age);
ok('日志有条目', life.log.length > 3, life.log.length);
ok('出生记录在 logs[0]', life.log[0].kind === 'birth');
ok('有总结', !!life.summary && typeof life.summary.score === 'number');
console.log('  示例:', life.age, '岁 ·', life.summary.title, '·', life.summary.score, '分');
console.log('  墓志铭:', life.summary.epitaph);

// 2) 播种可复现
const a = LifeSim.runFull(12345);
const b = LifeSim.runFull(12345);
ok('同种子结果一致', JSON.stringify(a.log.map(x => x.text)) === JSON.stringify(b.log.map(x => x.text)));
const c = LifeSim.runFull(54321);
ok('不同种子结果不同', JSON.stringify(a.log.map(x => x.text)) !== JSON.stringify(c.log.map(x => x.text)));

// 3) 1000 次批量不变量
let minAge = 999, maxAge = 0, bad = 0, sumAge = 0;
const titles = {};
for (let i = 0; i < 1000; i++) {
  const s = LifeSim.runFull(i * 7919 + 1);
  minAge = Math.min(minAge, s.age);
  maxAge = Math.max(maxAge, s.age);
  sumAge += s.age;
  titles[s.summary.title] = (titles[s.summary.title] || 0) + 1;
  for (const k of ['wealth', 'intel', 'charm', 'health', 'happiness']) {
    if (!(s[k] >= 0 && s[k] <= 100)) bad++;
  }
  if (s.summary.score < 0 || s.summary.score > 130) bad++;
  // 每一条日志年龄必须单调不减
  let last = -1;
  for (const l of s.log) { if (l.age < last) bad++; last = l.age; }
}
ok('1000 次全部活着走完', bad === 0, bad);
ok('最长寿命合理 (<=115)', maxAge <= 115, maxAge);
console.log('  寿命区间:', minAge, '-', maxAge, '平均', (sumAge / 1000).toFixed(1));
console.log('  称号分布:', JSON.stringify(titles));

// 4) 中途逐年推进也可以（UI 用）
const s2 = LifeSim.createLife(777);
let steps = 0;
while (s2.alive && steps < 200) { LifeSim.stepYear(s2); steps++; }
ok('逐年推进可用', steps > 0 && steps < 200, steps);

// 5) 关键剧情确实会出现
let gotCollege = 0, gotMarry = 0, gotKid = 0;
for (let i = 0; i < 300; i++) {
  const s = LifeSim.runFull(i + 999);
  if (s.flags.college) gotCollege++;
  if (s.flags.married) gotMarry++;
  if (s.kids > 0) gotKid++;
}
ok('大学事件出现率 >30%', gotCollege / 300 > 0.3, (gotCollege / 300).toFixed(2));
ok('婚姻事件出现率 >20%', gotMarry / 300 > 0.2, (gotMarry / 300).toFixed(2));
ok('生育事件出现率 >15%', gotKid / 300 > 0.15, (gotKid / 300).toFixed(2));

console.log(fails === 0 ? '\n全部通过 ✅' : `\n${fails} 项失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
