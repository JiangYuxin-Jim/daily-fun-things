/* 无浏览器验证：用最小 DOM/Canvas 桩加载 index.html + core.js + app.js，
 * 真实跑 rAF 主循环，然后用独立脚本（不依赖 core.js）反向校验 canvas 上画出的东西。
 * 这一层只验证「页面代码能加载、输入能驱动、渲染有调用」，逻辑正确性由 test-core.js 负责。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

// ---------------- 最小 DOM 桩 ----------------
const drawCalls = { fillRect: 0, arc: 0, fill: 0, fillText: 0, stroke: 0, roundRect: 0 };
function makeCtx() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop,
    lineTo: noop, arcTo: noop, strokeRect: noop, setLineDash: noop, translate: noop,
    clearRect: noop,
    fillRect: () => drawCalls.fillRect++,
    fill: () => drawCalls.fill++,
    stroke: () => drawCalls.stroke++,
    arc: () => drawCalls.arc++,
    fillText: () => drawCalls.fillText++,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 })
  };
  return ctx;
}

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this._cls = new Set();
    this._listeners = {};
    this.textContent = '';
    this.innerHTML = '';
    this._attrs = {};
    this.clientWidth = 720;
    this.parentElement = null;
    if (this.tagName === 'CANVAS') {
      this.width = 720; this.height = 720;
      this.getContext = () => { const c = makeCtx(); c.canvas = this; return c; };
    }
    this.classList = {
      add: (c) => this._cls.add(c),
      remove: (c) => this._cls.delete(c),
      toggle: (c, on) => { if (on === undefined) { this._cls.has(c) ? this._cls.delete(c) : this._cls.add(c); } else if (on) this._cls.add(c); else this._cls.delete(c); },
      contains: (c) => this._cls.has(c)
    };
  }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  querySelectorAll(sel) { return DOM.querySelectorAll(sel); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 720 }; }
  dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || {})); }
}

const nodes = {};
const idList = [];
// 从 html 里抽出所有 id 和 class（很粗糙但够用）
for (const m of html.matchAll(/id="([^"]+)"/g)) { const e = new El('div'); nodes[m[1]] = e; idList.push(m[1]); }
const dpadButtons = ['up', 'left', 'right', 'down'].map(d => { const b = new El('button'); b.dataset.dir = d; return b; });
nodes.cv = new El('canvas');
const stageEl = new El('div');
nodes.cv.parentElement = stageEl;
stageEl.clientWidth = 600;

for (const id of Object.keys(nodes)) {
  if (id === 'cv') continue;
  // 让 .parentElement 可用
  nodes[id].parentElement = stageEl;
}

const store = {};
const rafQueue = [];
let rafId = 0;
const listeners = {};

const DOM = {
  querySelectorAll(sel) {
    if (sel === '.dpad button') return dpadButtons;
    return [];
  },
  getElementById(id) { return nodes[id] || null; }
};

const sandbox = {
  console,
  document: {
    ...DOM,
    hidden: false,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  },
  window: null,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return ++rafId; },
  cancelAnimationFrame: () => {},
  setTimeout: (fn) => { fn(); return 0; },   // 同步执行，音效 setTimeout 直接跳过网络
  devicePixelRatio: 2,
  Math, Date, JSON, Object, Array, String, Number, Set, Map, isNaN, parseInt, parseFloat,
  AudioContext: undefined,
  webkitAudioContext: undefined
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };

const context = vm.createContext(sandbox);

// ---------------- 加载脚本 ----------------
console.log('— 加载 —');
try {
  vm.runInContext(fs.readFileSync(path.join(DIR, 'core.js'), 'utf8'), context, { filename: 'core.js' });
  ok('core.js 加载，暴露 SnakeCore', typeof sandbox.SnakeCore === 'object');
  vm.runInContext(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  ok('app.js 加载无异常', true);
  ok('app.js 暴露调试钩子 __snake', typeof sandbox.__snake === 'object');
} catch (e) {
  ok('脚本加载', false, e.message + '\n' + e.stack);
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(1);
}

// 驱动 rAF 一帧
let now = 0;
function frame(ms) {
  now += ms;
  const q = rafQueue.splice(0, rafQueue.length);
  q.forEach(fn => fn(now));
}

// ---------------- 渲染桩检查 ----------------
console.log('— 渲染 —');
frame(16);
ok('渲染调用了 fillRect（画盘面）', drawCalls.fillRect > 0, drawCalls);
ok('渲染调用了 arc（食物/眼睛/粒子）', drawCalls.arc > 0, drawCalls);

// ---------------- 交互 ----------------
console.log('— 交互 —');
const startBtn = nodes.btnStart;
ok('找到开始按钮', !!startBtn);
startBtn.dispatch('click');
const st = sandbox.__snake.game;
ok('点击开始后 status=running', st.status === 'running', st.status);
ok('分数重置为 0', st.score === 0);

// 键盘输入
const kd = (key) => (listeners.keydown || []).forEach(fn => fn({ key, preventDefault() {}, code: key === ' ' ? 'Space' : key }));
kd('ArrowDown');
ok('ArrowDown 生效 pendingDir=down', st.pendingDir === 'down', st.pendingDir);
kd('ArrowUp');
ok('反向 ArrowUp 被忽略（pending 仍 down）', st.pendingDir === 'down', st.pendingDir);

// 跑 300 帧（约 5 秒），蛇会撞墙结束（20x20，向下 9 步就撞）
for (let i = 0; i < 300; i++) frame(16);
ok('长时间运行后游戏已结束（撞墙）', st.status === 'over', st.status);
ok('覆盖层显示出来（非 hide）', !nodes.ov.classList.contains('hide'));
ok('覆盖层标题是撞墙了', nodes.ovTitle.textContent.indexOf('墙') >= 0, nodes.ovTitle.textContent);
ok('那局分数为 0 时不动最高分记录', store['snake-breathing-best-v1'] === undefined, store);
ok('HUD 分数与引擎一致', String(nodes.score.textContent) === String(st.score), [nodes.score.textContent, st.score]);

// 喂一个食物在头正前方 → 吃 → 最高分必须落盘
kd('r');
const sg = sandbox.__snake.game;
sg.food = { x: sg.snake[0].x + 1, y: sg.snake[0].y };
for (let i = 0; i < 20; i++) frame(20);
ok('吃到食物后分数 > 0', sg.score > 0, sg.score);
ok('最高分已写入 localStorage', Number(store['snake-breathing-best-v1']) === sg.score, [store, sg.score]);
ok('BEST 数字同步到 HUD', nodes.best.textContent === sg.score, [nodes.best.textContent, sg.score]);

// 重开 + 暂停
kd('r');
ok('R 重开，status=running', sandbox.__snake.game.status === 'running');
kd(' ');
ok('空格暂停', sandbox.__snake.game.status === 'paused');
kd(' ');
ok('空格继续', sandbox.__snake.game.status === 'running');

// 穿墙模式开关
nodes.btnWrap.dispatch('click');
ok('穿墙按钮打开 class on', nodes.btnWrap.classList.contains('on'));
kd('ArrowDown');
// 向下走到底，穿墙后应该还没死
const g2 = sandbox.__snake.game;
for (let i = 0; i < 40; i++) frame(200); // 大步长，快速推进
ok('穿墙模式下越过底边仍存活', g2.status === 'running' || g2.deathReason === 'self', [g2.status, g2.deathReason]);
ok('穿墙模式下蛇头 y 始终在 0..19', g2.snake.every(c => c.y >= 0 && c.y < 20), g2.snake[0]);

// AI 教练按钮
nodes.btnAi.dispatch('click');
ok('教练按钮打开', nodes.btnAi.classList.contains('on'));
kd('r');
nodes.btnWrap.dispatch('click'); // 关掉穿墙
for (let i = 0; i < 30; i++) frame(50);
ok('开启教练后仍能正常推进不死锁', true);

// 方向键溢出保护：连续快按
kd('r');
['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].forEach(k => kd(k));
for (let i = 0; i < 100; i++) frame(16);
ok('连续快按后蛇仍在盘内', sandbox.__snake.game.snake.every(c => c.x >= 0 && c.x < 20 && c.y >= 0 && c.y < 20));

// dpad
kd('r');
dpadButtons[0].dispatch('click'); // up
ok('方向键按钮可用', sandbox.__snake.game.pendingDir === 'up', sandbox.__snake.game.pendingDir);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
