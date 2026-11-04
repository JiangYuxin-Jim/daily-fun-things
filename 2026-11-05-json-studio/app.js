/* app.js —— JSON 工坊界面逻辑（依赖 core.js 的 JsonCore） */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var input = $('input'), output = $('output'), statusEl = $('status');
  var hlIn = $('hlIn'), errLine = $('errLine');
  var treeView = $('treeView'), tableView = $('tableView'), outTextWrap = $('outTextWrap');
  var viewMode = $('viewMode'), showPaths = $('showPaths'), showPathWrap = $('showPathWrap');

  var state = { value: undefined, hasValue: false, outText: '', repairs: [], lastGood: null };

  /* ---------- 主题示例：故意写成 JSONC，演示一键修复 ---------- */
  var SAMPLE = '// 这个示例故意写得不规范：有注释、尾逗号、单引号和裸键\n'
    + "{\n"
    + '  name: "JSON 工坊",\n'
    + "  version: '1.0.0',\n"
    + '  tags: ["json", "formatter", "offline",],\n'
    + '  features: {\n'
    + '    format: true,       /* 格式化 */\n'
    + '    repair: true,\n'
    + '    flatten: true,\n'
    + '  },\n'
    + '  maintainer: { name: "JiangYuxin", site: "https://jiangyuxin.top" },\n'
    + '  stats: { downloads: 1234567, stars: 42, issues: 0, ratio: 0.98 },\n'
    + '  history: [\n'
    + '    { day: 5, what: "JSON 工坊上线", ok: true },\n'
    + '  ],\n'
    + '};\n';

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 1600);
  }

  function setStatus(kind, text) {
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    statusEl.textContent = text;
  }

  /* ---------- 校验：轻量分词器 ---------- */
  // 返回错误位置（字符下标）或 null。支持 JSON 原始文法（不含注释）。
  function validate(text) {
    var i = 0, n = text.length;
    function ws() {
      while (i < n) {
        var c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13) i++;
        else break;
      }
    }
    function fail(msg) { throw { __jsonErr: true, msg: msg, pos: i }; }
    function lit(s) {
      if (text.substr(i, s.length) !== s) fail('意外的字面量');
      i += s.length;
    }
    function str() {
      var start = i;
      i++; // "
      while (i < n) {
        var c = text[i];
        if (c === '"') { i++; return; }
        if (c === '\\') {
          var e = text[i + 1];
          if (e !== undefined && '"\\/bfnrt'.indexOf(e) >= 0) i += 2;
          else if (e === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(text.substr(i + 2, 4))) fail('\\u 转义需要 4 位十六进制');
            i += 6;
          } else fail('非法转义字符');
          continue;
        }
        var code = text.charCodeAt(i);
        if (code < 0x20) fail('字符串内出现未转义的控制字符');
        i++;
      }
      i = start;
      fail('字符串没有闭合（缺少 "）');
    }
    function num() {
      var rest = text.slice(i);
      var m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
      if (!m || !m[0]) fail('数字格式不对');
      i += m[0].length;
      // 紧跟着数字字符，说明有前导零 / 多个小数点 / 缺指数位数
      if (i < n && /[\d.eE+-]/.test(text[i])) fail('数字格式不对（前导零或多小数点）');
    }
    function value() {
      ws();
      if (i >= n) fail('数据不完整（意外结束）');
      var c = text[i];
      if (c === '{') return obj();
      if (c === '[') return arr();
      if (c === '"') return str();
      if (c === '-' || (c >= '0' && c <= '9')) return num();
      if (c === 't') return lit('true');
      if (c === 'f') return lit('false');
      if (c === 'n') return lit('null');
      fail('这里不该出现 "' + c + '"');
    }
    function obj() {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      while (true) {
        ws();
        if (text[i] !== '"') fail('对象的键必须是双引号字符串');
        str();
        ws();
        if (text[i] !== ':') fail('键后面缺少冒号 :');
        i++;
        value();
        ws();
        if (text[i] === ',') { i++; ws(); if (text[i] === '}') fail('多余的尾逗号'); continue; }
        if (text[i] === '}') { i++; return; }
        fail('对象里缺少逗号或右花括号');
      }
    }
    function arr() {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      while (true) {
        value();
        ws();
        if (text[i] === ',') { i++; ws(); if (text[i] === ']') fail('多余的尾逗号'); continue; }
        if (text[i] === ']') { i++; return; }
        fail('数组里缺少逗号或右方括号');
      }
    }
    try {
      ws();
      value();
      ws();
      if (i < n) fail('JSON 结束后还有多余内容');
      return null;
    } catch (e) {
      if (e && e.__jsonErr) return { pos: e.pos, msg: e.msg };
      throw e;
    }
  }

  /* ---------- 语法高亮（轻量扫描，容错） ---------- */
  var TOKEN_RE = /("(?:\\.|[^"\\])*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}\[\],:])/g;
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function highlight(text) {
    var out = '', last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      if (m.index > last) out += esc(text.slice(last, m.index));
      if (m[1] !== undefined) {
        if (m[2] !== undefined) {
          out += '<span class="t-key">' + esc(m[1]) + '</span><span class="t-punc">' + esc(m[2]) + '</span>';
        } else {
          out += '<span class="t-str">' + esc(m[1]) + '</span>';
        }
      } else if (m[3] !== undefined) out += '<span class="t-num">' + m[3] + '</span>';
      else if (m[4] !== undefined) out += '<span class="t-bool">' + m[4] + '</span>';
      else if (m[5] !== undefined) out += '<span class="t-null">null</span>';
      else if (m[6] !== undefined) out += '<span class="t-punc">' + esc(m[6]) + '</span>';
      last = TOKEN_RE.lastIndex;
      if (m[0] === '') TOKEN_RE.lastIndex++;
    }
    out += esc(text.slice(last));
    return out;
  }

  function showErrLine(res) {
    if (!res) { errLine.style.display = 'none'; return; }
    var before = input.value.slice(0, res.pos);
    var line = before.split('\n').length;
    var lh = 13 * 1.6;
    errLine.style.top = (14 + (line - 1) * lh) + 'px';
    errLine.style.display = 'block';
  }

  /* ---------- 格式化 ---------- */
  function indentOpt() {
    var v = $('indent').value;
    return v === 'tab' ? '\t' : +v;
  }

  function render() {
    var t0 = performance.now();
    var text = input.value;
    hlIn.innerHTML = highlight(text) + '\n';
    syncScroll();
    setInMeta();
    $('errLine').style.display = 'none';

    if (!text.trim()) {
      state.hasValue = false;
      state.outText = '';
      output.textContent = '';
      treeView.innerHTML = tableView.innerHTML = '';
      setStatus('', '等待输入');
      hideRepair();
      updateStats(0, null);
      return;
    }

    var result = formatPipeline(text);
    if (!result.ok) {
      var loc = result.loc || {};
      var where = loc.line != null ? '（第 ' + loc.line + ' 行, 第 ' + loc.column + ' 列）' : '';
      setStatus('bad', '✗ 语法错误' + where);
      showErrLine(loc.pos != null ? { pos: loc.pos } : null);
      output.textContent = '';
      treeView.innerHTML = tableView.innerHTML = '';
      hideRepair();
      if (result.repairs && result.repairs.length) showRepair(result.repairs);
      updateStats(performance.now() - t0, null);
      return;
    }

    state.hasValue = true;
    state.value = result.value;
    state.outText = result.out;
    if (result.repairs.length) {
      setStatus('warn', '✓ 有效（自动修复 ' + result.repairs.length + ' 处）');
      showRepair(result.repairs, true);
    } else {
      setStatus('ok', '✓ 有效 JSON');
      hideRepair();
    }
    output.textContent = result.out;
    renderTreeOrTable(result.value);
    updateStats(performance.now() - t0, JsonCore.stats(result.value));
  }

  function formatPipeline(text) {
    var opt = { indent: indentOpt(), sort: $('sortKeys').checked, js: $('jsStyle').checked };
    var r = JsonCore.repairParse(text);
    if (!r.ok) return { ok: false, loc: r.error, repairs: r.steps };
    // 选 indent 为 '\t' 时 repairParse 里是纯字符串，stringify 支持
    var out = JsonCore.stringify(r.value, opt);
    // 应用修复步骤说明：repairParse 只返回成功的步骤，未成功的步骤也提示出来
    return { ok: true, value: r.value, out: out, repairs: r.steps };
  }

  function showRepair(steps, applied) {
    $('repairText').textContent = (applied ? '已自动修复：' : '可以修复：') + steps.join(' → ');
    $('repairBar').classList.add('show');
    $('btnApplyRepair').style.display = applied ? 'none' : '';
  }
  function hideRepair() { $('repairBar').classList.remove('show'); }

  function updateStats(ms, st) {
    var s = st || { nodes: 0, maxDepth: 0 };
    $('sNodes').textContent = '节点 ' + s.nodes;
    $('sDepth').textContent = '深度 ' + s.maxDepth;
    $('sTime').textContent = ms.toFixed(1) + ' ms';
    if (st) {
      $('sHint').textContent = 'object ' + st.objects + ' · array ' + st.arrays + ' · string ' + st.strings
        + ' · number ' + st.numbers + ' · bool ' + st.booleans + ' · null ' + st.nulls + ' · key ' + st.keys;
    }
  }

  function setInMeta() {
    var v = input.value;
    var lines = v ? v.split('\n').length : 0;
    $('sChars').textContent = v.length;
    $('sLines').textContent = lines;
    $('inMeta').textContent = v.length ? v.length + ' 字符 · ' + lines + ' 行' : '';
  }

  function syncScroll() {
    var w = input.parentNode.querySelector('.hl-wrap');
    if (w) { w.scrollTop = input.scrollTop; w.scrollLeft = input.scrollLeft; }
  }

  /* ---------- 树形视图 ---------- */
  function renderTreeOrTable(v) {
    var mode = viewMode.value;
    outTextWrap.style.display = mode === 'text' ? '' : 'none';
    treeView.style.display = mode === 'tree' ? 'block' : 'none';
    tableView.style.display = mode === 'table' ? 'block' : 'none';
    showPathWrap.style.display = mode === 'text' ? 'none' : 'inline-flex';
    if (mode === 'tree') renderTree(v);
    if (mode === 'table') renderTable(v);
  }

  function valSpan(x) {
    if (x === null) return '<span class="v null">null</span>';
    var t = typeof x;
    if (t === 'string') return '<span class="v">' + esc(JSON.stringify(x)) + '</span>';
    if (t === 'number') return '<span class="v num">' + x + '</span>';
    if (t === 'boolean') return '<span class="v bool">' + x + '</span>';
    return '<span class="v">' + esc(String(x)) + '</span>';
  }

  function renderTree(root) {
    var frag = document.createDocumentFragment();
    var container = document.createElement('div');
    container.className = 'tnode root';
    container.appendChild(buildNode(root, null, '$', true));
    frag.appendChild(container);
    treeView.innerHTML = '';
    treeView.appendChild(frag);
    treeView.classList.toggle('show-paths', showPaths.checked);
  }

  function buildNode(x, key, path, isRoot) {
    var wrap = document.createElement('div');
    var isObj = x !== null && typeof x === 'object';
    if (!isObj) {
      var leaf = document.createElement('div');
      leaf.className = 'leaf';
      var keyHtml = isRoot ? '' : (key === null
        ? ''
        : '<span class="k">' + esc(String(key)) + '</span><span class="colon">: </span>');
      leaf.innerHTML = '<span class="caret" style="visibility:hidden">·</span>' + keyHtml + valSpan(x)
        + '<span class="path">' + esc(path) + '</span>';
      leaf.addEventListener('click', function () { openPath(path); });
      wrap.appendChild(leaf);
      return wrap;
    }
    var isArr = Array.isArray(x);
    var keys = Object.keys(x);
    var head = document.createElement('div');
    head.className = 'trow';
    var label = isRoot ? '$' : (typeof key === 'number' ? '[' + key + ']' : key);
    var open = isArr ? '[' : '{', close = isArr ? ']' : '}';
    head.innerHTML = '<span class="caret">▾</span>'
      + (isRoot ? '<span class="k">root</span> ' : '<span class="k">' + esc(label) + '</span>: ')
      + '<span class="t-punc">' + open + '</span>'
      + ' <span class="cnt">' + keys.length + ' ' + (isArr ? '项' : '键') + '</span>'
      + ' <span class="t-punc">' + close + '</span>'
      + '<span class="path">' + esc(path) + '</span>';
    var kids = document.createElement('div');
    kids.className = 'kids';
    keys.forEach(function (k) {
      var childKey = isArr ? +k : k;
      var childPath = isArr ? path + '[' + k + ']'
        : (/^[A-Za-z_$][\w$]*$/.test(k) ? path + '.' + k : path + '[' + JSON.stringify(k) + ']');
      kids.appendChild(buildNode(x[k], childKey, childPath, false));
    });
    head.addEventListener('click', function (e) {
      if (e.altKey || e.metaKey) { openPath(path); return; }
      wrap.classList.toggle('collapsed');
      head.querySelector('.caret').textContent = wrap.classList.contains('collapsed') ? '▸' : '▾';
    });
    wrap.appendChild(head);
    wrap.appendChild(kids);
    if (keys.length > 20) { wrap.classList.add('collapsed'); head.querySelector('.caret').textContent = '▸'; }
    return wrap;
  }

  function renderTable(v) {
    var rows = JsonCore.flatten(v, { maxDepth: 12 });
    var html = '<table><thead><tr><th>路径</th><th>类型</th><th>值</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var val = r.value !== null && typeof r.value === 'object' ? JSON.stringify(r.value) : r.value;
      html += '<tr><td class="p" title="点击复制路径">' + esc(r.path) + '</td><td>' + r.type + '</td><td class="v">' + esc(String(val)) + '</td></tr>';
    });
    html += '</tbody></table>';
    tableView.innerHTML = html;
    Array.prototype.forEach.call(tableView.querySelectorAll('td.p'), function (td) {
      td.addEventListener('click', function () {
        var p = td.textContent;
        navigator.clipboard && navigator.clipboard.writeText(p);
        toast('已复制路径 ' + p);
      });
    });
  }

  /* ---------- 路径取值弹窗 ---------- */
  function openPath(path) {
    if (!state.hasValue) return;
    var litePath = path.replace(/^\$/, '').replace(/^\./, '');
    $('dlgPath').value = litePath;
    try {
      var v = JsonCore.getByPath(state.value, litePath);
      $('dlgValue').value = typeof v === 'object' ? JsonCore.stringify(v, { indent: 2 }) : JSON.stringify(v);
    } catch (e) {
      $('dlgValue').value = '// ' + e.message;
    }
    if (!$('pathDlg').open) $('pathDlg').showModal();
  }

  /* ---------- 操作 ---------- */
  function fmt() {
    if (!state.hasValue) {
      if (!input.value.trim()) { input.value = SAMPLE; render(); }
      return;
    }
    // 已有效：把输出写回输入，格式化连环操作
    input.value = state.outText;
    render();
  }

  function minify() {
    if (!state.hasValue) return toast('先输入合法 JSON');
    var out = JsonCore.stringify(state.value, { indent: 0, sort: $('sortKeys').checked, js: $('jsStyle').checked });
    state.outText = out;
    output.textContent = out;
    toast('已压缩，节省 ' + Math.max(0, input.value.length - out.length) + ' 字符');
  }

  function escapeStr() {
    var src = state.hasValue ? state.outText : input.value;
    if (!src.trim()) return toast('先输入点东西');
    var out = JSON.stringify(src);
    input.value = out;
    render();
    toast('已转义为 JSON 字符串');
  }

  function unescapeStr() {
    var src = input.value.trim();
    if (!src) return toast('先输入点东西');
    if (!/^"[\s\S]*"$/.test(src)) return toast('内容不是带引号的字符串');
    try {
      var inner = JsonCore.unescapeFromString(src.slice(1, -1));
      input.value = inner;
      render();
      toast('已去除转义');
    } catch (e) { toast('去转义失败：' + e.message); }
  }

  function copy() {
    if (!state.outText) return toast('没有可复制的结果');
    navigator.clipboard.writeText(state.outText).then(function () {
      toast('已复制 ' + state.outText.length + ' 字符');
    }, function () { toast('复制失败，请手动选中'); });
  }

  function download() {
    if (!state.outText) return toast('没有可下载的结果');
    var blob = new Blob([state.outText], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data' + (Date.now() % 100000) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- 事件 ---------- */
  input.addEventListener('input', render);
  input.addEventListener('scroll', syncScroll);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = input.selectionStart, t = input.value;
      // 在 " 包围的字符串里插入 \t，否则插入两个空格
      var inStr = (t.slice(0, s).match(/(^|[^\\])"/g) || []).length % 2 === 1;
      var ins = inStr ? '\\t' : '  ';
      input.value = t.slice(0, s) + ins + t.slice(input.selectionEnd);
      input.selectionStart = input.selectionEnd = s + ins.length;
      render();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); fmt(); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement !== input) {
      e.preventDefault(); fmt();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault(); copy();
    }
  });

  $('btnFormat').addEventListener('click', fmt);
  $('btnMinify').addEventListener('click', minify);
  $('btnEscape').addEventListener('click', escapeStr);
  $('btnUnescape').addEventListener('click', unescapeStr);
  $('btnCopy').addEventListener('click', copy);
  $('btnDownload').addEventListener('click', download);
  $('btnClear').addEventListener('click', function () {
    input.value = ''; render(); input.focus();
  });
  $('btnSample').addEventListener('click', function () {
    input.value = SAMPLE; render(); toast('示例已写入（试试「格式化」看自动修复）');
  });
  $('btnFile').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('文件太大（>5MB）');
    var rd = new FileReader();
    rd.onload = function () { input.value = rd.result; render(); toast('已载入 ' + f.name); };
    rd.readAsText(f, 'utf-8');
    e.target.value = '';
  });
  ['indent', 'sortKeys', 'jsStyle'].forEach(function (id) {
    $(id).addEventListener('change', render);
  });
  viewMode.addEventListener('change', function () { renderTreeOrTable(state.value); });
  showPaths.addEventListener('change', function () { treeView.classList.toggle('show-paths', showPaths.checked); });

  // 拖拽文件
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { input.value = rd.result; render(); toast('已载入 ' + f.name); };
    rd.readAsText(f, 'utf-8');
  });

  $('btnApplyRepair').addEventListener('click', function () {
    var r = JsonCore.repairParse(input.value);
    if (r.ok) {
      input.value = JsonCore.stringify(r.value, { indent: indentOpt(), sort: $('sortKeys').checked, js: $('jsStyle').checked });
      render();
      toast('已修复并格式化');
    } else {
      // 尽力写入部分修复结果，让用户看到修到哪一步
      if (r.partiallyFixed) { input.value = r.partiallyFixed; render(); toast('已修复部分问题，仍有语法错误'); }
    }
  });
  $('btnIgnoreRepair').addEventListener('click', hideRepair);

  // 弹窗
  $('dlgClose').addEventListener('click', function () { $('pathDlg').close(); });
  $('dlgCopyPath').addEventListener('click', function () {
    var p = $('dlgPath').value;
    navigator.clipboard.writeText(p);
    toast('已复制路径 ' + p);
  });
  $('dlgCopyValue').addEventListener('click', function () {
    var v = $('dlgValue').value;
    navigator.clipboard.writeText(v);
    toast('已复制取值');
  });
  $('pathDlg').addEventListener('close', function () { input.focus(); });

  /* 启动 */
  render();
})();
