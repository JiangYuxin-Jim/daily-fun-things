/* test-e2e.js — 用 index.html 里真实的 DOM 结构表格对齐渲染；本文件只验证 HTML 里引用的资源清单与关键元素 id 是否齐全 */
'use strict';
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const requiredIds = ['board', 'overlay', 'v-score', 'v-pairs', 'v-combo', 'v-moves', 'btn-peek',
  'peek-left', 'btn-restart', 'btn-sound', 'best', 'levels', 'ov-title', 'ov-stars', 'ov-score',
  'ov-rec', 'ov-rows', 'ov-close', 'ov-again', 'timebar', 'timefill'];
let ok = 0, bad = [];
requiredIds.forEach(id => {
  if (new RegExp('id="' + id + '"').test(html)) ok++;
  else bad.push('缺少 id: ' + id);
});
['core.js', 'app.js'].forEach(s => {
  if (html.indexOf('src="' + s + '"') >= 0) ok++; else bad.push('未引用 ' + s);
});
// 检查 CSS 里定义了 app.js 会用到的 class
['card', 'flip', 'matched', 'gone', 'miss', 'locked', 'float', 'overlay', 'on', 'warn', 'timebar'].forEach(c => {
  if (new RegExp('\\.' + c + '\\b').test(html)) ok++; else bad.push('CSS 缺少 .' + c);
});
console.log(`HTML 结构检查: ${ok} 通过 / ${bad.length} 失败`);
bad.forEach(b => console.log('  · ' + b));
process.exit(bad.length ? 1 : 0);
