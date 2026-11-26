/* 今天吃什么 · 核心引擎
 * 纯逻辑，不碰 DOM：候选池管理 + 加权抽签 + 转盘指针落点计算
 * 浏览器 window.FoodWheel = FoodWheel；Node 下 module.exports（供自测脚本使用）
 */
(function (root) {
  'use strict';

  // 默认候选池：早餐 / 正餐 / 宵夜混在一起也太多了，先给一个「正餐」起步池
  var DEFAULT_ITEMS = [
    { name: '麻辣烫', weight: 3, tag: '热辣' },
    { name: '兰州拉面', weight: 3, tag: '汤面' },
    { name: '黄焖鸡米饭', weight: 2, tag: '下饭' },
    { name: '沙县小吃', weight: 1, tag: '省钱' },
    { name: '日式咖喱', weight: 2, tag: '浓郁' },
    { name: '饺子', weight: 2, tag: '家常' },
    { name: '烤肉拌饭', weight: 2, tag: '管饱' },
    { name: '酸菜鱼', weight: 1, tag: '约人' },
  ];

  var MIN_ITEMS = 2;
  var MAX_ITEMS = 24;

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function normalizeName(s) {
    return String(s == null ? '' : s).replace(/[\s\u3000]+/g, ' ').trim();
  }

  // ---- 候选池 ----
  // 返回 { ok, items, reason }
  function addItem(items, name, opts) {
    opts = opts || {};
    var clean = normalizeName(name);
    if (!clean) return { ok: false, items: items, reason: 'empty' };
    if (clean.length > 24) return { ok: false, items: items, reason: 'too-long' };
    if (items.length >= MAX_ITEMS) return { ok: false, items: items, reason: 'full' };
    var lower = clean.toLowerCase();
    for (var i = 0; i < items.length; i++) {
      if (normalizeName(items[i].name).toLowerCase() === lower) {
        return { ok: false, items: items, reason: 'duplicate' };
      }
    }
    var next = items.slice();
    next.push({
      name: clean,
      weight: clamp(Number(opts.weight) || 1, 1, 9),
      tag: normalizeName(opts.tag) || '',
    });
    return { ok: true, items: next, reason: '' };
  }

  function removeItem(items, index) {
    if (index < 0 || index >= items.length) return items.slice();
    var next = items.slice();
    next.splice(index, 1);
    return next;
  }

  function setWeight(items, index, weight) {
    if (index < 0 || index >= items.length) return items.slice();
    var next = items.slice();
    next[index] = {
      name: next[index].name,
      weight: clamp(Number(weight) || 1, 1, 9),
      tag: next[index].tag,
    };
    return next;
  }

  function isReady(items) {
    return !!items && items.length >= MIN_ITEMS;
  }

  // ---- 抽签 ----
  // rng: 返回 [0,1) 的函数（默认 Math.random，可注入固定种子复现）
  function pickIndex(items, rng) {
    if (!isReady(items)) return -1;
    rng = rng || Math.random;
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(1, Number(items[i].weight) || 1);
    var r = rng() * total;
    for (i = 0; i < items.length; i++) {
      var w = Math.max(1, Number(items[i].weight) || 1);
      if (r < w) return i;
      r -= w;
    }
    return items.length - 1; // 浮点兜底
  }

  // 各扇区角度（等宽，因为视觉宽度一致，权重只影响概率，通过「多段 tick」体现）
  function sectorAngles(items) {
    var n = items.length;
    var each = 360 / n;
    return items.map(function (_, i) {
      return { start: i * each, end: (i + 1) * each, mid: i * each + each / 2 };
    });
  }

  // 计算最终旋转角度：让 index 扇区中心停在指针位置（指针在正上方 = -90°）
  // 返回 deg（绝对角度，可累加），带一点随机偏移避免每次落在正中
  function spinTo(items, index, currentDeg, rng) {
    if (index < 0 || index >= items.length) return currentDeg;
    rng = rng || Math.random;
    var sectors = sectorAngles(items);
    var each = 360 / items.length;
    // 扇区 i 的中间角 mid（0 = 指针位置方向），偏移 ±40% 扇区宽
    var jitter = (rng() * 0.8 - 0.4) * each;
    var target = sectors[index].mid + jitter;
    var turns = 5 + Math.floor(rng() * 3); // 5~7 圈
    var base = Math.ceil(currentDeg / 360) * 360;
    return base + turns * 360 + target;
  }

  function itemAtPointer(items, deg) {
    var n = items.length;
    if (!n) return -1;
    var norm = ((deg % 360) + 360) % 360;
    var each = 360 / n;
    return Math.floor(norm / each) % n;
  }

  // ---- 小惊喜：口味标签推荐一句话 ----
  var QUIPS = {
    '热辣': '今天需要一点刺激，辣到出汗的那种。',
    '汤面': '一碗热的，胃先被安抚了。',
    '下饭': '只求干饭效率，米饭是最好的配角。',
    '省钱': '钱包在微笑，今天不乱花。',
    '浓郁': '让味道重一点，日子才有存在感。',
    '家常': '吃点熟悉的，不用做决定也很好。',
    '管饱': '碳水才是正事，别想别的了。',
    '约人': '这个适合叫上人一起，一个人吃有点亏。',
  };
  function quipFor(item) {
    if (!item) return '';
    return QUIPS[item.tag] || '就它了，别再纠结。';
  }

  var api = {
    DEFAULT_ITEMS: DEFAULT_ITEMS,
    MIN_ITEMS: MIN_ITEMS,
    MAX_ITEMS: MAX_ITEMS,
    normalizeName: normalizeName,
    addItem: addItem,
    removeItem: removeItem,
    setWeight: setWeight,
    isReady: isReady,
    pickIndex: pickIndex,
    sectorAngles: sectorAngles,
    spinTo: spinTo,
    itemAtPointer: itemAtPointer,
    quipFor: quipFor,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FoodWheel = api;
})(typeof window !== 'undefined' ? window : this);
