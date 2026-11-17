// 页面外链 / 关键钩子检查：确保 index.html 引用的本地文件都存在（只跑一次）
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const missing = [];
const srcs = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)].map(m => m[1]);
for (const s of srcs) {
  if (/^https?:/.test(s)) continue;
  if (!fs.existsSync(path.join(__dirname, s))) missing.push(s);
}

const hooks = ['id="taA"', 'id="taB"', 'id="btnCompare"', 'id="codeUnified"', 'id="overview"', 'id="sb"'];
const missingHooks = hooks.filter(h => !html.includes(h));

console.log('本地资源引用:', srcs.join(', ') || '(无)');
console.log('缺失文件:', missing.length ? missing.join(', ') : '无');
console.log('缺失 DOM 钩子:', missingHooks.length ? missingHooks.join(', ') : '无');
process.exit(missing.length + missingHooks.length === 0 ? 0 : 1);
