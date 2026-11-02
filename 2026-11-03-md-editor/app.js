/* Markdown 实时编辑器 · 墨池
 * 依赖：marked (本地内置, MIT, v15.0.12)
 * 纯原生 JS，无框架。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 0. 安全渲染：先禁掉原始 HTML，再给玻璃心链接加 target ---------- */
  // marked v15 的 renderer 回调接收到的是 token 对象（{ type, raw, text, href, ... }）
  function makeRenderer() {
    var r = new marked.Renderer();
    r.html = function (token) {
      // 原始 HTML 一律转义展示，避免内联 <script> 注入
      return escapeHtml(token.raw != null ? token.raw : token.text || '');
    };
    r.code = function (token) {
      var lang = (token.lang || '').split(/\s+/)[0];
      var cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
      return '<pre><code' + cls + '>' + escapeHtml(token.text || '') + '</code></pre>\n';
    };
    r.link = function (token) {
      var href = token.href || '';
      var safe = '';
      if (/^(https?:\/\/|mailto:|#|\/|\.\/)/i.test(href)) safe = href;
      var out = '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer"';
      if (token.title) out += ' title="' + escapeHtml(token.title) + '"';
      // token.text 已由 marked 解析为内联 HTML（含转义）
      return out + '>' + (token.text || '') + '</a>';
    };
    return r;
  }

  var renderer = makeRenderer();
  marked.use({ gfm: true, breaks: false, renderer: renderer });

  function render(src) {
    return marked.parse(src);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 1. 文档统计 ---------- */
  function stats(src) {
    var chars = src.length;
    // 中文按字计，英文按词计
    var cjk = (src.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    var words = (src.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
      .match(/[A-Za-z0-9_'\u00c0-\u024f]+/g) || []).length;
    var lines = src === '' ? 0 : src.split('\n').length;
    // 中文 350 字/分钟，英文 200 词/分钟
    var mins = Math.ceil(cjk / 350 + words / 200);
    return { chars: chars, cjk: cjk, words: words, lines: lines, mins: mins, total: cjk + words };
  }

  /* ---------- 2. 大纲 ---------- */
  function outline(md) {
    var items = [];
    var re = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
    var m;
    while ((m = re.exec(md)) !== null) {
      // 跳过代码围栏内的假标题
      var before = md.slice(0, m.index);
      var fences = (before.match(/^```/gm) || []).length;
      if (fences % 2 === 1) continue;
      items.push({ level: m[1].length, text: m[2].replace(/[*_`~]/g, '') });
    }
    return items;
  }

  /* ---------- 3. 状态 ---------- */
  var KEY = 'mo-chi-md-doc-v1';
  var state = { text: '', view: 'split', dirty: false };

  var SAMPLE = [
    '# 墨池 · Markdown 实时编辑器',
    '',
    '左边写，右边即时看到排版结果。**没有服务器，没有账号，没有上传。**',
    '',
    '## 用键盘就能跑完全程',
    '',
    '| 快捷键 | 作用 |',
    '| --- | --- |',
    '| `Ctrl/⌘ + B` | 加粗 |',
    '| `Ctrl/⌘ + I` | 斜体 |',
    '| `Ctrl/⌘ + K` | 插入链接 |',
    '| `Ctrl/⌘ + S` | 导出 .md |',
    '| `Tab` | 缩进两格 |',
    '',
    '## 该有的都有',
    '',
    '- 标题、列表、引用、表格、代码块',
    '- 任务列表：',
    '  - [x] 实时渲染',
    '  - [x] 自动保存在浏览器本地',
    '  - [ ] 等你来写点什么',
    '',
    '> 小惊喜：右上角切到「专注」模式，只剩文字和光。',
    '',
    '```js',
    'const hello = (name) => `你好，${name}`;',
    'console.log(hello("墨池"));',
    '```',
    '',
    '---',
    '',
    '祝你写得顺手。'
  ].join('\n');

  /* ---------- 4. DOM ---------- */
  var editor = $('editor');  var preview = $('preview');
  var outlineEl = $('outline-body');
  var statChars = $('st-words');
  var statLines = $('st-lines');
  var statMins = $('st-mins');
  var savedEl = $('saved');
  var wrap = $('wrap');

  /* ---------- 5. 渲染循环（requestAnimationFrame 合帧） ---------- */
  var pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      doRender();
    });
  }

  function doRender() {
    var src = editor.value;
    state.text = src;
    var html = render(src);
    preview.innerHTML = html;

    var s = stats(src);
    statChars.textContent = s.total;
    statChars.title = '中文字 ' + s.cjk + ' · 英文词 ' + s.words;
    statLines.textContent = s.lines;
    statMins.textContent = s.mins;

    renderOutline(outline(src));
    syncScroll();

    // 本地保存（防抖 400ms 由外部调用方控制）
    state.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  var saveTimer = null;
  function save() {
    try {
      localStorage.setItem(KEY, state.text);
      flashSaved('已保存到本地');
    } catch (e) {
      flashSaved('保存失败（存储已满？）');
    }
  }

  var flashTimer = null;
  function flashSaved(msg) {
    savedEl.textContent = msg;
    savedEl.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { savedEl.classList.remove('on'); }, 1200);
  }

  /* ---------- 6. 大纲 ---------- */
  function renderOutline(items) {
    if (!items.length) {
      outlineEl.innerHTML = '<div class="outline-empty">还没有标题<br>用 # 开头写一行试试</div>';
      return;
    }
    outlineEl.innerHTML = '';
    items.forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'outline-item lv' + it.level;
      a.textContent = it.text;
      a.title = it.text;
      a.href = 'javascript:void 0';
      a.addEventListener('click', function () {
        // 在渲染后的预览里按文本匹配找节点
        jumpToHeading(it.text);
        return false;
      });
      outlineEl.appendChild(a);
    });
  }

  function jumpToHeading(text) {
    var nodes = preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].textContent.trim() === text) {
        nodes[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
        nodes[i].classList.remove('ping');
        void nodes[i].offsetWidth;
        nodes[i].classList.add('ping');
        return;
      }
    }
  }

  /* ---------- 7. 同步滚动（按比例） ---------- */
  var syncing = false;
  function syncScroll() {
    // placeholder hook：滚动监听在下面单独绑定
  }
  editor.addEventListener('scroll', function () {
    if (state.view !== 'split' || syncing) return;
    syncing = true;
    var a = editor;
    var maxA = a.scrollHeight - a.clientHeight;
    var maxB = preview.scrollHeight - preview.clientHeight;
    if (maxA > 0 && maxB > 0) preview.scrollTop = (a.scrollTop / maxA) * maxB;
    syncing = false;
  });
  preview.addEventListener('scroll', function () {
    if (state.view !== 'split' || syncing) return;
    syncing = true;
    var maxA = preview.scrollHeight - preview.clientHeight;
    var maxB = editor.scrollHeight - editor.clientHeight;
    if (maxA > 0 && maxB > 0) editor.scrollTop = (preview.scrollTop / maxA) * maxB;
    syncing = false;
  });

  /* ---------- 8. 输入 ---------- */
  editor.addEventListener('input', scheduleRender);

  function surround(pre, post) {
    var s = editor.selectionStart;
    var e = editor.selectionEnd;
    var v = editor.value;
    var sel = v.slice(s, e);
    // 已包裹则取消
    if (v.slice(s - pre.length, s) === pre && v.slice(e, e + post.length) === post) {
      editor.value = v.slice(0, s - pre.length) + sel + v.slice(e + post.length);
      editor.selectionStart = s - pre.length;
      editor.selectionEnd = e - pre.length;
    } else {
      editor.value = v.slice(0, s) + pre + sel + post + v.slice(e);
      editor.selectionStart = s + pre.length;
      editor.selectionEnd = e + pre.length;
    }
    scheduleRender();
  }

  function prefixLines(prefix) {
    var s = editor.selectionStart;
    var e = editor.selectionEnd;
    var v = editor.value;
    var lineStart = v.lastIndexOf('\n', s - 1) + 1;
    var block = v.slice(lineStart, e);
    var next = block.split('\n').map(function (l) {
      return l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l;
    }).join('\n');
    editor.value = v.slice(0, lineStart) + next + v.slice(e);
    editor.selectionStart = lineStart;
    editor.selectionEnd = lineStart + next.length;
    scheduleRender();
  }

  editor.addEventListener('keydown', function (ev) {
    var mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Tab' && !mod) {
      ev.preventDefault();
      surround('  ', '');
      return;
    }
    if (!mod) return;
    var k = ev.key.toLowerCase();
    if (k === 'b') { ev.preventDefault(); surround('**', '**'); }
    else if (k === 'i') { ev.preventDefault(); surround('*', '*'); }
    else if (k === 'k') { ev.preventDefault(); surround('[', '](https://)'); }
    else if (k === 's') { ev.preventDefault(); exportMd(); }
    else if (k === 'enter') { ev.preventDefault(); prefixLines('> '); }
  });

  /* ---------- 9. 工具栏 ---------- */
  $('tb-bold').onclick = function () { surround('**', '**'); };
  $('tb-italic').onclick = function () { surround('*', '*'); };
  $('tb-h').onclick = function () { prefixLines('## '); };
  $('tb-quote').onclick = function () { prefixLines('> '); };
  $('tb-code').onclick = function () { surround('\n```\n', '\n```\n'); };
  $('tb-link').onclick = function () { surround('[', '](https://)'); };
  $('tb-task').onclick = function () { prefixLines('- [ ] '); };
  $('tb-table').onclick = function () {
    var t = '\n| 列 1 | 列 2 |\n| --- | --- |\n| 值 | 值 |\n';
    var s = editor.selectionStart;
    editor.value = editor.value.slice(0, s) + t + editor.value.slice(s);
    editor.selectionStart = editor.selectionEnd = s + t.length;
    scheduleRender();
    editor.focus();
  };

  /* ---------- 10. 视图切换 ---------- */
  function setView(v) {
    state.view = v;
    wrap.dataset.view = v;
    ['split', 'write', 'read'].forEach(function (m) {
      var b = $('view-' + m);
      b.classList.toggle('active', m === v);
    });
    if (v !== 'write') doRender();
    editor.focus();
  }
  $('view-split').onclick = function () { setView('split'); };
  $('view-write').onclick = function () { setView('write'); };
  $('view-read').onclick = function () { setView('read'); };

  /* ---------- 11. 导入 / 导出 ---------- */
  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function baseName() {
    var first = outline(editor.value)[0];
    var n = first ? first.text : '未命名';
    n = n.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
    return n.slice(0, 40) || '未命名';
  }

  function exportMd() {
    download(baseName() + '.md', editor.value, 'text/markdown;charset=utf-8');
    flashSaved('已导出 .md');
  }

  $('btn-download').onclick = exportMd;

  $('btn-html').onclick = function () {
    var body = render(editor.value);
    var title = baseName();
    var page = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHtml(title) + '</title>\n<style>\n' + STANDALONE_CSS + '\n</style></head>\n' +
      '<body><article class="doc">\n' + body + '\n</article></body></html>\n';
    download(title + '.html', page, 'text/html;charset=utf-8');
    flashSaved('已导出 HTML');
  };

  $('btn-copy').onclick = function () {
    var md = editor.value;
    var done = function () { flashSaved('Markdown 已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(done, function () { fallbackCopy(md, done); });
    } else fallbackCopy(md, done);
  };

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { flashSaved('复制失败'); }
    ta.remove();
  }

  $('file-input').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      editor.value = String(rd.result);
      scheduleRender();
      flashSaved('已导入 ' + f.name);
    };
    rd.readAsText(f, 'utf-8');
    ev.target.value = '';
  });
  $('btn-import').onclick = function () { $('file-input').click(); };

  $('btn-clear').onclick = function () {
    if (!editor.value.trim() || confirm('清空当前文档？此操作不可撤销（导出过就安全）。')) {
      editor.value = '';
      scheduleRender();
      editor.focus();
    }
  };

  /* ---------- 12. 拖拽 .md 到窗口 ---------- */
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { editor.value = String(rd.result); scheduleRender(); flashSaved('已导入 ' + f.name); };
    rd.readAsText(f, 'utf-8');
  });

  /* ---------- 13. 启动 ---------- */
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  editor.value = saved && saved.trim() ? saved : SAMPLE;
  doRender();
  setView('split');

  // 暴露给测试用
  window.__mochi = { render: render, stats: stats, outline: outline, escapeHtml: escapeHtml, setText: function (t) { editor.value = t; doRender(); } };
})();

var STANDALONE_CSS = [
  'html{background:#fbfaf7;color:#1f2328}',
  'body{margin:0;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
  '.doc{max-width:760px;margin:0 auto;padding:56px 24px 96px}',
  'h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .6em;font-weight:700}',
  'h1{font-size:2em;border-bottom:2px solid #1f2328;padding-bottom:.3em}',
  'h2{font-size:1.5em;border-bottom:1px solid #e3e0d8;padding-bottom:.25em}',
  'a{color:#0b6b5e}',
  'code{background:#f0eee8;padding:.15em .35em;border-radius:4px;font-size:.9em;font-family:ui-monospace,Menlo,Consolas,monospace}',
  'pre{background:#1f2328;color:#f0eee8;padding:16px;border-radius:8px;overflow:auto}',
  'pre code{background:none;padding:0;color:inherit}',
  'blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid #d8d3c8;color:#5b6169}',
  'table{border-collapse:collapse;width:100%;margin:1em 0}',
  'th,td{border:1px solid #e3e0d8;padding:8px 12px;text-align:left}',
  'th{background:#f5f3ee}',
  'img{max-width:100%}',
  'hr{border:0;border-top:1px solid #e3e0d8;margin:2em 0}',
  'ul.task-list{list-style:none;padding-left:1.2em}'
].join('\n');
