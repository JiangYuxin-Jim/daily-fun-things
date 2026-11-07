/* test-browser.js — 用 DOM 桩真跑 app.js，验证交互链路（无浏览器依赖） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const fails = [];
function ok(v, label) { if (v) pass++; else { fail++; fails.push(label); } }
function eq(a, e, label) {
  if (JSON.stringify(a) === JSON.stringify(e)) pass++;
  else { fail++; fails.push(`${label} 期望=${JSON.stringify(e)} 实际=${JSON.stringify(a)}`); }
}

// ───────── 极简 DOM 桩 ─────────
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach(x => x && this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  get value() { return [...this.set].join(' '); }
}

let idSeq = 0;
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList(this);
    this._text = '';
    this._html = '';
    this.listeners = {};
    this.attributes = {};
    this.disabled = false;
    this.offsetWidth = 100;
    this._id = 'el' + (++idSeq);
    this.rect = { left: 10, top: 10, width: 60, height: 60 };
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    // 只为 .stars 容器生成 3 个 span
    if (String(v) === undefined) return;
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev) {
    (this.listeners[t] || []).forEach(fn => fn(Object.assign({ type: t, preventDefault() {} }, ev || {})));
  }
  click() { this.dispatch('click'); }
  getBoundingClientRect() { return this.rect; }
  get outerHTML() { return this._html; }
  focus() {}
}

const byId = {};
function makeEl(id) { return (byId[id] = new El(id === 'board' || id === 'levels' ? 'div' : 'div')); }

['board', 'overlay', 'v-score', 'v-pairs', 'v-combo', 'v-moves', 'btn-peek', 'peek-left',
 'btn-restart', 'btn-sound', 'best', 'levels', 'ov-title', 'ov-stars', 'ov-score', 'ov-rec',
 'ov-rows', 'ov-close', 'ov-again', 'timebar', 'timefill'].forEach(makeEl);

// v-score 等挂在「.stat」下，需要 parentElement 以触发 pop
['v-score', 'v-pairs', 'v-combo', 'v-moves'].forEach(id => { const p = new El('div'); byId[id].parentElement = p; });

// stars 容器预置 3 个 span
const starSpans = [0, 1, 2].map(() => { const s = new El('span'); s.textContent = '★'; return s; });
starSpans.forEach(s => byId['ov-stars'].appendChild(s));
byId['ov-title'].className = 'title';

let rafQueue = [];
let rafTime = 0;
const document = {
  getElementById: id => byId[id] || null,
  createElement: tag => new El(tag),
  body: new El('body'),
  addEventListener(t, fn) { (this._l = this._l || {})[t] = (this._l[t] || []).concat(fn); },
  dispatch(t, ev) { ((this._l || {})[t] || []).forEach(fn => fn(Object.assign({ type: t, preventDefault() {} }, ev || {}))); },
  hidden: false,
};

const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const window = {
  document,
  localStorage,
  AudioContext: null,      // 无音频环境：验证代码能优雅降级
  webkitAudioContext: null,
  requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
};
window.window = window;

const sandbox = {
  window, document, localStorage, console,
  requestAnimationFrame: window.requestAnimationFrame,
  performance: { now: () => rafTime },
  setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number,
  parseInt, parseFloat, isNaN, Error,
};
sandbox.globalThis = sandbox;
sandbox.module = undefined;    // 模拟 <script> 环境：没有 CommonJS 的 module
sandbox.exports = undefined;
// 让沙箱内的 globalThis 就是 window 对象本身，和浏览器一致
vm.createContext(window);
// 注意顺序：先建 context 再补字段，否则会把 globalThis 指向另一个普通对象
Object.assign(window, sandbox, { globalThis: window });

// ───────── 加载脚本 ─────────
function load(file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInContext(code, window, { filename: file });
}

console.log('=== memory-flip 页面层测试（DOM 桩）===');

load('core.js');
ok(!!window.MemoryCore, 'core.js 挂到 window.MemoryCore');
sandbox.MemoryCore = window.MemoryCore;   // <script> 里顶层 var 也是全局，这里补上
void sandbox;
load('app.js');
const api = window.__memoryPrism;
ok(!!api, 'app.js 暴露 __memoryPrism');

// 逐帧推进工具
function frames(n, stepMs) {
  for (let i = 0; i < n; i++) {
    rafTime += (stepMs || 16);
    const q = rafQueue; rafQueue = [];
    q.forEach(fn => fn(rafTime));
  }
}

// 1) 初始化
let s = api.getState();
eq(s.level, 'normal', '默认 normal 难度');
eq(s.tiles.length, 16, 'normal 16 张牌');
eq(byId['board'].children.length, 16, '棋盘渲染出 16 张牌卡');
eq(byId['board'].style.gridTemplateColumns, 'repeat(4, 1fr)', '网格列数 4');
ok(byId['v-pairs'].textContent === '0/8', 'HUD 配对 0/8 实际 ' + byId['v-pairs'].textContent);
eq(byId['levels'].children.length, 4, '4 个难度按钮');
ok(byId['levels'].children[1].classList.contains('on'), 'normal 按钮高亮');

// 2) 点击翻牌：DOM class 翻转
const card0 = byId['board'].children[0];
card0.click();
s = api.getState();
eq(s.flipped, [0], '点了第 0 张 → flipped=[0]');
ok(card0.classList.contains('flip'), '第 0 张卡有 .flip class');
eq(card0.getAttribute('aria-pressed'), 'true', 'aria-pressed=true');

// 3) 再点同一张不生效
card0.click();
eq(api.getState().flipped, [0], '重复点同一张无变化');

// 4) 点配对的那张 → 消除
const partnerId = s.tiles.find(t => t.pairId === s.tiles[0].pairId && t.id !== 0).id;
byId['board'].children[partnerId].click();
s = api.getState();
eq(s.pairsFound, 1, '配对成功 pairsFound=1');
ok(byId['board'].children[0].classList.contains('matched'), '配对牌标 .matched');
ok(byId['board'].children[0].classList.contains('gone'), '配对牌标 .gone');
eq(byId['v-score'].textContent, '100', 'HUD 分数 100');

// 5) 点错扣分
frames(4, 50); // 过掉 busyUntil 锁
const free = s.tiles.filter(t => !t.matched).map(t => t.id);
const a = free[0], b = free.find(id => s.tiles[id].pairId !== s.tiles[a].pairId);
byId['board'].children[a].click();
byId['board'].children[b].click();
s = api.getState();
eq(s.score, 100 - 15, '点错扣 15 → 85');
eq(s.combo, 0, '连击清零');
ok(byId['board'].children[b].classList.contains('miss'), '错误牌加 .miss（动画结束后移除）');

// 6) 揭晓：全部翻开，次数 -1
frames(4, 50);
byId['btn-peek'].click();
s = api.getState();
ok(s.peekUntil !== null, 'peekUntil 已设置');
eq(s.peeksLeft, 0, 'normal 只有 1 次揭晓，用完为 0');
ok(byId['btn-peek'].disabled, '揭晓按钮置灰');
let allUp = true;
for (let i = 0; i < s.tiles.length; i++) if (!byId['board'].children[i].classList.contains('flip')) allUp = false;
ok(allUp, '揭晓时所有牌都显示正面');
ok(byId['board'].classList.contains('locked'), '揭晓时棋盘锁定');

// 7) 揭晓到期自动收起（推进 rAF 逻辑时间）
frames(120, 16); // ≈1.92s > 1.4s
s = api.getState();
eq(s.peekUntil, null, '1.4s 后揭晓自动收起');
ok(!byId['board'].classList.contains('locked'), '棋盘解锁');
const upCount = s.tiles.filter((t, i) => byId['board'].children[i].classList.contains('flip')).length;
eq(upCount, 2, '收起后只剩 2 张已配对的牌是正面');

// 8) 进度条：非计时关不显示
ok(!byId['timebar'].classList.contains('on'), 'normal 不显示计时条');

// 9) 切难度到 crazy → 显示计时条 + 36 张牌
api.startGame('crazy');
s = api.getState();
eq(s.tiles.length, 36, 'crazy 36 张');
eq(byId['board'].children.length, 36, '棋盘重建为 36 张');
eq(byId['board'].style.gridTemplateColumns, 'repeat(6, 1fr)', '6 列');
ok(byId['timebar'].classList.contains('on'), 'crazy 显示计时条');
frames(1, 16);
ok(parseFloat(byId['timefill'].style.width) > 99, '计时条接近满格');

// 10) 计时关超时 → 结束遮罩
for (let i = 0; i < 13000; i++) { rafTime += 16; const q = rafQueue; rafQueue = []; q.forEach(fn => fn(rafTime)); if (api.getState().over) break; }
s = api.getState();
ok(s.over, '计时耗尽后 over=true');
eq(s.reason, 'timeout', 'reason=timeout');
ok(byId['overlay'].classList.contains('on'), '弹出结束遮罩');
eq(byId['ov-title'].textContent, '时间到', '标题=时间到');
eq(byId['ov-title'].className, 'title lose', '标题样式 lose');

// 11) 关闭遮罩 + 重开
byId['ov-close'].click();
ok(!byId['overlay'].classList.contains('on'), '关闭遮罩');
api.startGame('easy');
s = api.getState();
eq(s.over, false, '重开后未结束');
eq(s.tiles.length, 12, 'easy 12 张');

// 12) 完美一局：按引擎已知配对逐个点，验证通关弹窗 + 星级 + 落盘
function playPerfectUI() {
  const pairs = {};
  s = api.getState();
  s.tiles.forEach(t => { (pairs[t.pairId] = pairs[t.pairId] || []).push(t.id); });
  Object.keys(pairs).forEach(pid => {
    const [x, y] = pairs[pid];
    byId['board'].children[x].click();
    byId['board'].children[y].click();
    frames(9, 20); // 过 busyUntil
  });
}
playPerfectUI();
s = api.getState();
ok(s.won, '完美点击后通关');
ok(s.over, 'over=true');
// 通关弹窗延迟 460ms 才弹
const wait = new Promise(res => setTimeout(res, 600));
wait.then(() => {
  ok(byId['overlay'].classList.contains('on'), '通关遮罩弹出');
  eq(byId['ov-title'].textContent, '记忆贯通', '标题=记忆贯通');
  eq(byId['ov-score'].textContent, String(s.score), '弹窗分数与状态一致');
  const lit = starSpans.filter(sp => sp.classList.contains('on')).length;
  eq(lit, 3, '完美局 3 星全亮');
  ok(byId['ov-rec'].classList.contains('on'), '新纪录标记亮起');
  ok(!!store['memory-prism.best.v1'], '最佳成绩写入 localStorage');
  const saved = JSON.parse(store['memory-prism.best.v1']);
  eq(saved.easy.score, s.score, '落盘分数正确');
  eq(saved.easy.moves, 12, '落盘翻牌数 12（每张只翻一次）');
  ok(byId['best'].innerHTML.indexOf('分') > 0, '底栏显示最佳成绩');
  ok(store['memory-prism.settings.v1'], '设置也落盘');

  // 13) 键盘快捷键
  document.dispatch('keydown', { key: '3' }); // 切到 hard
  eq(api.getState().level, 'hard', '键盘 3 切到 hard');
  eq(api.getState().tiles.length, 20, 'hard 20 张');
  document.dispatch('keydown', { key: 'R' });
  eq(api.getState().moves, 0, 'R 重开');
  document.dispatch('keydown', { key: ' ' });
  ok(api.getState().peekUntil === null, 'hard 没有揭晓次数，空格无效');
  document.dispatch('keydown', { key: '1' });
  document.dispatch('keydown', { key: ' ' });
  ok(api.getState().peekUntil !== null, 'easy 空格触发揭晓');

  // 14) 音效降级：无 AudioContext 环境下点牌不崩
  let crashed = false;
  try {
    byId['board'].children[0].click(); // 揭晓中点击 = 取消
    document.dispatch('keydown', { key: '4' });
    byId['board'].children[0].click();
  } catch (e) { crashed = true; }
  ok(!crashed, '无 AudioContext 时交互不抛异常');

  console.log('');
  if (fail) { console.log('失败详情:'); fails.forEach(f => console.log('  · ' + f)); }
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
});
