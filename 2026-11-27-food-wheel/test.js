/* 自测：node test.js —— 只验核心算法 */
var W = require('./wheel.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
  console.log('ok  ' + msg);
}

// 1. 增删与去重
var items = [];
W.DEFAULT_ITEMS.forEach(function (it) { items = W.addItem(items, it.name, it).items; });
assert(items.length === 8, '默认池载入 8 项');
var dup = W.addItem(items, '  麻辣烫 ', {});
assert(!dup.ok && dup.reason === 'duplicate', '重复项被拒绝（含空白归一）');
assert(!W.addItem(items, '   ', {}).ok, '空名字被拒绝');
var long = W.addItem(items, '一二三四五六七八九十一二三四五六七八九十一二三四五', {});
assert(!long.ok && long.reason === 'too-long', '超长名字被拒绝');
items = W.addItem(items, '藏面', { weight: 9, tag: '汤面' }).items;
assert(items.length === 9 && items[8].weight === 9, '加权项可加入');
items = W.setWeight(items, 8, 100);
assert(items[8].weight === 9, '权重被夹到 9');
assert(W.setWeight(items, 99, 3).length === items.length, '越界 setWeight 安全');
assert(W.removeItem(items, 8).length === 8, '删除可用');

// 2. 未就绪
assert(!W.isReady([]) && !W.isReady([items[0]]), '少于 2 项不可转');
assert(W.pickIndex([], Math.random) === -1, '空池返回 -1');

// 3. 加权分布：weight=3 的项出现率应显著高于 weight=1
var seed = 12345;
function rng() { // 简单 LCG，可复现
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
var pool = [
  { name: 'A', weight: 6 },
  { name: 'B', weight: 3 },
  { name: 'C', weight: 1 },
];
var counts = [0, 0, 0], N = 30000;
for (var i = 0; i < N; i++) counts[W.pickIndex(pool, rng)]++;
var ratioA = counts[0] / N, ratioC = counts[2] / N;
console.log('    分布 A/B/C = ' + (ratioA * 100).toFixed(1) + '% / ' +
  (counts[1] / N * 100).toFixed(1) + '% / ' + (ratioC * 100).toFixed(1) + '%');
assert(Math.abs(ratioA - 0.6) < 0.02, '权重6 ≈ 60%');
assert(Math.abs(ratioC - 0.1) < 0.02, '权重1 ≈ 10%');
assert(counts[0] + counts[1] + counts[2] === N, '无漏抽');

// 4. 转盘落点：spinTo 之后指针必须指向目标
var badStop = 0;
for (var t = 0; t < 5000; t++) {
  var pick = Math.floor(rng() * items.length);
  var deg = W.spinTo(items, pick, rng() * 720, rng);
  if (W.itemAtPointer(items, deg) !== pick) badStop++;
}
assert(badStop === 0, '5000 次 spinTo 落点与选中项全部一致');

// 5. 扇区覆盖完整无重叠
var secs = W.sectorAngles(items);
assert(secs.length === items.length, '扇区数 = 项数');
assert(Math.abs(secs[0].start) < 1e-9 && Math.abs(secs[secs.length - 1].end - 360) < 1e-9, '扇区覆盖 0~360');

// 6. 推荐语
assert(/辣/.test(W.quipFor({ name: 'x', tag: '热辣' })), '标签推荐语命中');
assert(W.quipFor({ name: 'x', tag: '' }).length > 0, '无标签有兜底推荐语');

console.log('\n全部通过 ✅');
