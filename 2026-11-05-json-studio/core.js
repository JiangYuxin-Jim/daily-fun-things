/* json-core.js —— 纯逻辑，无 DOM 依赖，浏览器与 node 通用 */
(function (root) {
  'use strict';

  /* ---------- 工具 ---------- */
  function tryParse(s) { try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, error: e }; } }

  function indentUnit(indent) {
    return indent === '\t' ? '\t' : new Array((indent | 0) + 1).join(' ');
  }
  function padFn(indent) {
    var unit = indentUnit(indent);
    return function (level) { return indent ? new Array(level + 1).join(unit) : ''; };
  }

  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  /* ---------- 1. 容错修复 ---------- */
  function stripComments(s) {
    // 去掉 // 与 /* */ 注释（跳过字符串内部）
    var out = '', state = 0, i = 0, n = s.length; // state 0 普通 / 1 双引号串 / 2 单引号串
    while (i < n) {
      var c = s[i];
      if (state === 1 || state === 2) {
        out += c;
        if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; }
        if ((state === 1 && c === '"') || (state === 2 && c === "'")) state = 0;
        i++; continue;
      }
      if (c === '"') { state = 1; out += c; i++; continue; }
      if (c === "'") { state = 2; out += c; i++; continue; }
      if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
      out += c; i++;
    }
    return out;
  }

  function convertSingleQuotes(s) {
    var out = '', state = 0, i = 0, n = s.length; // 0 普通 / 1 双引号串 / 2 单引号串
    while (i < n) {
      var c = s[i];
      if (state === 0) {
        if (c === '"') { state = 1; out += c; }
        else if (c === "'") { state = 2; out += '"'; }
        else out += c;
        i++; continue;
      }
      if (state === 1) {
        out += c;
        if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; }
        if (c === '"') state = 0;
        i++; continue;
      }
      // 单引号串内部
      if (c === '\\') {
        var nx = s[i + 1] || '';
        if (nx === "'") out += "'";
        else if (nx === '"') out += '\\"';
        else out += '\\' + nx;
        i += 2; continue;
      }
      if (c === '"') out += '\\"';
      else if (c === "'") { out += '"'; state = 0; }
      else out += c;
      i++;
    }
    return out;
  }

  var BARE_KEY_RE = /(^|[\s,:[{])([A-Za-z_$][\w$]*)(\s*:)/g;
  var TRAILING_COMMA_RE = /,(\s*[}\]])/g;
  var BARE_VALUE_RE = /:\s*([A-Za-z_$][\w$.-]*)(\s*[,}\]])/g;

  function repairParse(src) {
    var steps = [];
    var cur = String(src).replace(/^\uFEFF/, '');
    function attempt(after) {
      var r = tryParse(cur);
      if (r.ok) { steps.push(after); return true; }
      return false;
    }
    if (attempt('原样就是合法 JSON')) return { ok: true, value: tryParse(cur).value, steps: [] };

    var next = stripComments(cur);
    if (next !== cur) { cur = next; if (attempt('移除 // 与 /* */ 注释')) return done(); }

    next = cur.trim().replace(/;+\s*$/, '');
    if (next !== cur) { cur = next; if (attempt('去掉尾部多余分号')) return done(); }

    next = convertSingleQuotes(cur);
    if (next !== cur) { cur = next; if (attempt('单引号字符串 → 双引号')) return done(); }

    next = cur.replace(TRAILING_COMMA_RE, '$1');
    if (next !== cur) { cur = next; if (attempt('移除多余尾逗号')) return done(); }

    next = cur.replace(BARE_KEY_RE, '$1"$2"$3');
    if (next !== cur) { cur = next; if (attempt('裸键名 → 加双引号')) return done(); }

    next = cur.replace(BARE_VALUE_RE, function (m, w, tail) {
      if (/^(true|false|null)$/.test(w)) return m;
      if (/^-?\d/.test(w)) return m;
      return ': "' + w + '"' + tail;
    });
    if (next !== cur) { cur = next; if (attempt('无引号字符串值 → 加双引号')) return done(); }

    next = cur.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    if (next !== cur) {
      cur = next; steps.push('智能引号 → 直引号');
      cur = convertSingleQuotes(cur);
      if (tryParse(cur).ok) return done();
    }

    return { ok: false, error: locateError(src, tryParse(src).error), partiallyFixed: cur, steps: steps };

    function done() { return { ok: true, value: tryParse(cur).value, steps: steps }; }
  }

  /* 错误定位：不依赖引擎文案（新版 V8 已不给 position） */
  function locateError(s, e) {
    var msg = e && e.message ? String(e.message) : '解析失败';
    var pos = null;
    if (/end of JSON input|Unexpected end/i.test(msg)) pos = s.length;
    else {
      // V8 片段：`Unexpected token '}', "{...prefix..." is not valid JSON`
      var m = msg.match(/, "([\s\S]*)" is not valid JSON\s*$/) || msg.match(/is not valid JSON\s*$/) && msg.match(/"([\s\S]*?)"\.\.\. /);
      if (m && msg.indexOf('is not valid JSON') >= 0) {
        var frag = unescapeFragment(m[1]).replace(/[\r\n]+$/, '');
        if (s.indexOf(frag) === 0 && frag.length > 0) pos = frag.length;
      }
      var m2 = msg.match(/position\s+(\d+)/i);
      if (m2) pos = +m2[1];
    }
    if (pos == null) return { message: msg, pos: null, line: null, column: null };
    if (pos > s.length) pos = s.length;
    var line = 1, col = 1;
    for (var i = 0; i < pos; i++) {
      if (s[i] === '\n') { line++; col = 1; } else col++;
    }
    return { message: msg, pos: pos, line: line, column: col };
  }

  function unescapeFragment(f) {
    try { return JSON.parse('"' + f + '"'); } catch (e) { return f; }
  }

  function findErrorPos(s) {
    var r = tryParse(s);
    if (r.ok) return null;
    return locateError(s, r.error);
  }

  /* ---------- 2. 序列化 ---------- */
  function stringify(v, opt) {
    opt = opt || {};
    var indent = opt.indent === undefined ? 2 : opt.indent;
    var text;
    if (opt.js) text = toJS(v, indent, opt.sort) + (opt.trailingComma ? ',' : '');
    else if (opt.sort) text = toJSON(v, indent, true);
    else {
      text = JSON.stringify(v, null, indent);
      if (text === undefined) text = 'undefined';
    }
    return text.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  /* 纯 JSON 手写序列化器：sort 时自己排键（原生会强制数字键排前） */
  function toJSON(v, indent, sort) {
    var pad = padFn(indent), nl = indent ? '\n' : '', sep = indent ? ': ' : ':';
    function rec(x, level) {
      if (x === null) return 'null';
      if (typeof x !== 'object') return JSON.stringify(x);
      if (Array.isArray(x)) {
        if (!x.length) return '[]';
        return '[' + nl + x.map(function (i) { return pad(level + 1) + rec(i, level + 1); }).join(',' + nl) + nl + pad(level) + ']';
      }
      var ks = Object.keys(x);
      if (sort) ks = ks.sort();
      if (!ks.length) return '{}';
      return '{' + nl + ks.map(function (k) {
        return pad(level + 1) + JSON.stringify(k) + sep + rec(x[k], level + 1);
      }).join(',' + nl) + nl + pad(level) + '}';
    }
    return rec(v, 0);
  }

  /* JS 对象字面量：合法标识符裸键、单引号串、数字可带下划线分组 */
  function toJS(v, indent, sort) {
    var pad = padFn(indent), nl = indent ? '\n' : '';
    function jsStr(x) {
      var out = "'";
      for (var i = 0; i < x.length; i++) {
        var c = x[i], code = x.charCodeAt(i);
        if (c === '\\') out += '\\\\';
        else if (c === "'") out += "\\'";
        else if (c === '\n') out += '\\n';
        else if (c === '\r') out += '\\r';
        else if (c === '\t') out += '\\t';
        else if (code < 0x20) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
        else out += c;
      }
      return out + "'";
    }
    function num(x) {
      if (!isFinite(x)) return 'null';
      if (Number.isInteger(x) && Math.abs(x) > 9999) {
        return String(x).replace(/\B(?=(\d{3})+(?!\d))/, '_').replace(/(\d)(?=(\d{3})+$)/g, '$1_').replace(/_$/, '');
      }
      return String(x);
    }
    function rec(x, level) {
      if (x === null) return 'null';
      if (typeof x === 'string') return jsStr(x);
      if (typeof x === 'number') return num(x);
      if (typeof x === 'boolean') return String(x);
      if (typeof x === 'undefined') return 'undefined';
      if (Array.isArray(x)) {
        if (!x.length) return '[]';
        return '[' + nl + x.map(function (i) { return pad(level + 1) + rec(i, level + 1) + ','; }).join(nl) + nl + pad(level) + ']';
      }
      var ks = Object.keys(x);
      if (sort) ks = ks.sort();
      if (!ks.length) return '{}';
      return '{' + nl + ks.map(function (k) {
        var key = IDENT_RE.test(k) ? k : jsStr(k);
        return pad(level + 1) + key + ': ' + rec(x[k], level + 1) + ',';
      }).join(nl) + nl + pad(level) + '}';
    }
    return rec(v, 0);
  }

  function sortKeysDeep(v) {
    if (Array.isArray(v)) return v.map(sortKeysDeep);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = sortKeysDeep(v[k]); });
      return o;
    }
    return v;
  }

  /* ---------- 3. 分析 ---------- */
  function typeName(x) {
    if (x === null) return 'null';
    if (Array.isArray(x)) return 'array';
    return typeof x;
  }

  function stats(v) {
    var s = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, maxDepth: 0, nodes: 0 };
    (function walk(x, d) {
      s.nodes++;
      if (d > s.maxDepth) s.maxDepth = d;
      if (Array.isArray(x)) { s.arrays++; x.forEach(function (i) { walk(i, d + 1); }); }
      else if (x && typeof x === 'object') {
        s.objects++;
        var ks = Object.keys(x); s.keys += ks.length;
        ks.forEach(function (k) { walk(x[k], d + 1); });
      }
      else if (typeof x === 'string') s.strings++;
      else if (typeof x === 'number') s.numbers++;
      else if (typeof x === 'boolean') s.booleans++;
      else s.nulls++;
    })(v, 0);
    return s;
  }

  function escapePathSeg(k) {
    return IDENT_RE.test(k) ? k : '[' + JSON.stringify(k) + ']';
  }

  function flatten(v, opt) {
    opt = opt || {};
    var maxDepth = opt.maxDepth || 8;
    var rows = [];
    (function walk(x, path, d) {
      var isObj = x !== null && typeof x === 'object';
      var isLeaf = !isObj;
      var isEmpty = isObj && Object.keys(x).length === 0;
      if (isLeaf || isEmpty || d >= maxDepth) {
        rows.push({ path: path || '$', type: typeName(x), value: x });
        return;
      }
      Object.keys(x).forEach(function (k) {
        var np;
        if (Array.isArray(x)) np = path + '[' + k + ']';
        else np = path ? path + escapePathSeg(k) : escapePathSeg(k);
        walk(x[k], np, d + 1);
      });
    })(v, '', 0);
    return rows;
  }

  function toCSV(rows) {
    function esc(s) {
      s = s == null ? '' : String(s);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var out = ['path,type,value'];
    rows.forEach(function (r) {
      var val = r.value !== null && typeof r.value === 'object' ? JSON.stringify(r.value) : r.value;
      out.push(esc(r.path) + ',' + esc(r.type) + ',' + esc(val));
    });
    return out.join('\n');
  }

  function parsePath(p) {
    var segs = [], i = 0, n = p.length;
    while (i < n) {
      var c = p[i];
      if (c === '.') { i++; continue; }
      if (c === '[') {
        var end = p.indexOf(']', i);
        if (end < 0) throw new Error('路径括号未闭合');
        var inner = p.slice(i + 1, end).trim();
        if (/^\d+$/.test(inner)) segs.push(+inner);
        else if (/^".*"$/.test(inner)) segs.push(JSON.parse(inner));
        else if (/^'.*'$/.test(inner)) segs.push(inner.slice(1, -1));
        else segs.push(inner);
        i = end + 1; continue;
      }
      var j = i;
      while (j < n && p[j] !== '.' && p[j] !== '[') j++;
      segs.push(p.slice(i, j));
      i = j;
    }
    return segs;
  }

  function getByPath(v, p) {
    var segs = parsePath(p), cur = v;
    for (var i = 0; i < segs.length; i++) {
      if (cur == null) throw new Error('路径在 "' + segs[i] + '" 处中断');
      cur = cur[segs[i]];
    }
    if (cur === undefined) throw new Error('路径不存在');
    return cur;
  }

  /* ---------- 4. 转义 ---------- */
  function escapeForString(v) {
    var s = typeof v === 'string' ? v : stringify(v, { indent: 0 });
    return JSON.stringify(s).slice(1, -1);
  }
  function unescapeFromString(s) {
    var body = s.replace(/(^|[^\\])(\\\\)*"/g, function (m, a, b) { return a + (b || '') + '\\"'; });
    return JSON.parse('"' + body + '"');
  }

  var api = {
    stripComments: stripComments,
    convertSingleQuotes: convertSingleQuotes,
    repairParse: repairParse,
    locateError: locateError,
    findErrorPos: findErrorPos,
    stringify: stringify,
    sortKeysDeep: sortKeysDeep,
    stats: stats,
    flatten: flatten,
    toCSV: toCSV,
    parsePath: parsePath,
    getByPath: getByPath,
    escapeForString: escapeForString,
    unescapeFromString: unescapeFromString,
    typeName: typeName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JsonCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
