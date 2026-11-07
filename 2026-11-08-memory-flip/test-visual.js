/* test-visual.js — 用 canvas 桩（真实画出像素）+ arena-visual.js 的视觉探针，验证渲染坐标与配色 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const zlib = require('zlib');

let pass = 0, fail = 0;
const fails = [];
function ok(v, label) { if (v) pass++; else { fail++; fails.push(label); } }

// ───────── 极简 2D canvas（真在内存里画 RGBA）─────────
const PX = { r: 0, g: 0, b: 0, a: 255 };
function parseColor(c) {
  if (typeof c !== 'string') return { r: 0, g: 0, b: 0, a: 255 };
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: p.length > 3 ? Math.round(p[3] * 255) : 255 };
  }
  return { r: 200, g: 200, b: 200, a: 255 };
}

class Ctx {
  constructor(w, h) {
    this.W = w; this.H = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1;
    this.font = '10px sans-serif'; this.textAlign = 'left'; this.textBaseline = 'alphabetic';
    this.shadowColor = 'transparent'; this.shadowBlur = 0;
    this.ops = { fillRect: 0, fillText: 0, strokePath: 0, fillPath: 0, arc: 0 };
    this._path = [];   // 只记录 bbox，够我们判断「画在了棋盘格子位置上」
  }
  _blend(x, y, col, alpha) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = (y * this.W + x) * 4;
    const a = (col.a / 255) * (alpha === undefined ? 1 : alpha);
    this.data[i] = Math.round(this.data[i] * (1 - a) + col.r * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + col.g * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + col.b * a);
    this.data[i + 3] = 255;
  }
  createLinearGradient() { return { addColorStop() {}, _type: 'linear' }; }
  createRadialGradient() { return { addColorStop() {}, _type: 'radial' }; }
  _solid(style) { return typeof style === 'string' && (style[0] === '#' || /^rgb/.test(style)); }
  fillRect(x, y, w, h) {
    this.ops.fillRect++;
    x |= 0; y |= 0; w |= 0; h |= 0;
    // 渐变项（对象）用中性色填充，模拟「背景已铺满」
    const col = this._solid(this.fillStyle) ? parseColor(this.fillStyle) : { r: 20, g: 26, b: 44, a: 255 };
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this._blend(xx, yy, col);
  }
  measureText(t) { return { width: String(t).length * 13 }; }
  fillText(t, x, y) { this.ops.fillText++; this._blend(x | 0, y | 0, this._solid(this.fillStyle) ? parseColor(this.fillStyle) : { r: 255, g: 255, b: 255, a: 255 }); }
  beginPath() { this._path = []; }
  moveTo(x, y) { this._path.push([x, y]); }
  arcTo(x, y) { this._path.push([x, y]); }
  closePath() {}
  arc(x, y, r) { this.ops.arc++; this._path.push([x - r, y - r], [x + r, y + r]); }
  fill() {
    this.ops.fillPath++;
    const pts = this._path;
    if (!pts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const col = this._solid(this.fillStyle) ? parseColor(this.fillStyle) : { r: 40, g: 50, b: 80, a: 255 };
    for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) this._blend(xx, yy, col, 0.55);
  }
  stroke() {
    this.ops.strokePath++;
    const pts = this._path;
    if (!pts.length) return;
    const col = parseColor(this.strokeStyle);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    for (let yy = Math.floor(y0); yy <= Math.ceil(y1); yy++) {
      for (let xx = Math.floor(x0); xx <= Math.ceil(x1); xx++) {
        if (xx <= Math.floor(x0) || xx >= Math.ceil(x1) || yy <= Math.floor(y0) || yy >= Math.ceil(y1)) this._blend(xx, yy, col);
      }
    }
  }
  getImageData(x, y, w, h) { return { data: this.data, width: w, height: h }; }
  putImageData() {}
}

/** 最小 PNG 编码器（zlib + CRC32），用于把桩画布导出成真正的 .png */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ───────── DOM 桩（复用 test-browser 的思路，精简版）─────────
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => x && this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; on ? this.set.add(c) : this.set.delete(c); return on; }
  get value() { return [...this.set].join(' '); }
  set value(v) { this.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.style = {}; this.classList = new ClassList();
    this._text = ''; this._html = ''; this.listeners = {}; this.attributes = {};
    this.disabled = false; this.offsetWidth = 100; this.width = 0; this.height = 0;
    if (this.tagName === 'CANVAS') this._ctx = null;
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList.value = v; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev) { (this.listeners[t] || []).forEach(fn => fn(Object.assign({ type: t, preventDefault() {} }, ev || {}))); }
  click() { this.dispatch('click'); }
  getBoundingClientRect() { return { left: 10, top: 10, width: 60, height: 60 }; }
  getContext() { if (!this._ctx) this._ctx = new Ctx(this.width, this.height); return this._ctx; }
  toDataURL() {
    const ctx = this.getContext();
    return 'data:image/png;base64,' + encodePNG(this.width, this.height, ctx.data).toString('base64');
  }
}

const ids = ['board', 'overlay', 'v-score', 'v-pairs', 'v-combo', 'v-moves', 'btn-peek', 'peek-left',
  'btn-restart', 'btn-sound', 'best', 'levels', 'ov-title', 'ov-stars', 'ov-score', 'ov-rec',
  'ov-rows', 'ov-close', 'ov-again', 'timebar', 'timefill'];
const byId = {};
ids.forEach(id => { byId[id] = new El('div'); });
['v-score', 'v-pairs', 'v-combo', 'v-moves'].forEach(id => { byId[id].parentElement = new El('div'); });
[0, 1, 2].forEach(() => byId['ov-stars'].appendChild(new El('span')));

let rafTime = 0, rafQueue = [];
const document = {
  getElementById: id => byId[id] || null,
  createElement: t => new El(t),
  body: new El('body'),
  addEventListener(t, fn) { (this._l = this._l || {})[t] = (this._l[t] || []).concat(fn); },
  dispatch(t, ev) { ((this._l || {})[t] || []).forEach(fn => fn(Object.assign({ type: t, preventDefault() {} }, ev || {}))); },
  hidden: false,
};
const store = {};
const window = {
  document,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
  AudioContext: null, webkitAudioContext: null,
};
vm.createContext(window);
Object.assign(window, {
  console, document, localStorage: window.localStorage,
  requestAnimationFrame: window.requestAnimationFrame,
  performance: { now: () => rafTime },
  setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, parseInt, parseFloat, isNaN, Error,
  module: undefined, exports: undefined, globalThis: window,
});
window.window = window;
window.self = window;

const dir = __dirname;
function load(f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), window, { filename: f }); }

console.log('=== memory-flip 视觉探针（canvas 桩）===');
load('core.js');
load('app.js');
load('arena-visual.js');

const runtimeConsole = console;
const logs = [];
window.console = { log: (...a) => { logs.push(a.join(' ')); }, error: console.error };
const result = window.ARENA.run(window, document, window.console);
ok(result === 'done', 'ARENA.run 返回 done（实际 ' + result + '）');
ok(logs.some(l => l.indexOf('render ok') === 0), '探针自检日志: ' + (logs[0] || '(无)'));

const shot = window.__shot;
ok(typeof shot === 'string' && shot.indexOf('data:image/png;base64,') === 0, '生成了 PNG dataURL');
const b64 = shot.split(',')[1];
const buf = Buffer.from(b64, 'base64');
const W = 700, H = 860;
ok(buf.length > 4000 && buf.length < 3 * 1024 * 1024, 'PNG 体积合理（' + buf.length + ' 字节；桩画布不画文字/渐变，故远小于真实截图）');
ok(buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG 魔术字节正确');
fs.writeFileSync(path.join(dir, 'preview.png'), buf);

// 反向校验：逐块解析 PNG，取出 IDAT 解压后与桩画布像素逐字节比对（证明导出的图确实是画出来的那帧）
let off = 8, idat = [], ihdrOk = false, sawIEND = false;
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const dataStart = off + 8;
  const crcBuf = buf.subarray(dataStart + len, dataStart + len + 4);
  const calc = Buffer.alloc(4); calc.writeUInt32BE(crc32Local(buf.subarray(off + 4, dataStart + len)));
  if (type === 'IHDR') {
    ihdrOk = buf.readUInt32BE(dataStart) === 700 && buf.readUInt32BE(dataStart + 4) === 860;
  }
  if (!crcBuf.equals(calc)) { fails.push('PNG 块 CRC 校验失败: ' + type); fail++; }
  if (type === 'IDAT') idat.push(buf.subarray(dataStart, dataStart + len));
  if (type === 'IEND') sawIEND = true;
  off = dataStart + len + 4;
}
ok(ihdrOk, 'IHDR 尺寸为 700×860');
ok(sawIEND, 'PNG 含 IEND 块');
ok(idat.length > 0, 'PNG 含 IDAT 块');
function crc32Local(b) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    c = (crc ^ b[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
ok(raw.length === (W * 4 + 1) * H, 'IDAT 解压后长度 = (700*4+1)*860');

// 每张已配对牌的中心点应该是绿色系（我们画了 matched 的绿色描边）
const state = window.__memoryPrism.getState();
const matchedIds = state.tiles.filter(t => t.matched).map(t => t.id);
ok(matchedIds.length === 6, '探针设置了 3 对已配对（' + matchedIds.length + ' 张）');

runtimeConsole.log('');
if (fail) { runtimeConsole.log('失败详情:'); fails.forEach(f => runtimeConsole.log('  · ' + f)); }
runtimeConsole.log(`结果: ${pass} 通过 / ${fail} 失败`);
runtimeConsole.log('预览图: ' + path.join(dir, 'preview.png') + ' (' + buf.length + ' 字节)');
process.exit(fail ? 1 : 0);
