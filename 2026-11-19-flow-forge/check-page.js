// 页面钩子检查：本地资源存在 + 关键 DOM 钩子齐全（只跑一次）
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const missing = [];
const srcs = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)].map(m => m[1]);
for (const s of srcs) {
  if (/^https?:/.test(s)) continue;
  if (!fs.existsSync(path.join(__dirname, s))) missing.push(s);
}

const hooks = ['id="cv"', 'id="palette"', 'id="tbInspect"', 'id="tbStats"', 'id="tbLint"',
  'id="btnRun"', 'id="btnLint"', 'id="btnMermaid"', 'id="btnJSON"', 'id="exSel"'];
const missingHooks = hooks.filter(h => !html.includes(h));

// 内联脚本粗检查：不允许出现明显占位垃圾
const junk = /costume|undefined\(/.test(html);

console.log('本地资源引用:', srcs.join(', ') || '(无)');
console.log('缺失文件:', missing.length ? missing.join(', ') : '无');
console.log('缺失 DOM 钩子:', missingHooks.length ? missingHooks.join(', ') : '无');
console.log('可疑残留:', junk ? '有' : '无');
process.exit(missing.length + missingHooks.length + (junk ? 1 : 0) === 0 ? 0 : 1);
