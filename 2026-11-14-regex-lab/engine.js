/* regex-lab engine — 本地运行，零依赖
 * 匹配执行：用 JavaScript 原生 RegExp（V8，工业级回溯引擎）
 * 附加价值：
 *   1) 中文错误翻译（原生报错是英文）
 *   2) 静态风险体检（嵌套量词 / 重叠分支 / 灾难性回溯预警）
 *   3) 中文结构解释器（把正则拆成可读的步骤说明）
 *   4) 高亮分段 + 捕获组表
 */

const MAX_STEPS = 200000;

class RegexError extends Error {
  constructor(msg, pattern, pos) {
    super(msg);
    this.name = 'RegexError';
    this.pattern = pattern;
    this.pos = pos;
  }
}

/* ---------------- 静态分析（不执行，只读语法） ---------------- */
// 返回 { tokens: [...], issues: [...] }
function scan(pattern) {
  const tokens = [];
  const issues = [];
  const stack = [];
  let i = 0;
  let groupDepth = 0;
  const push = (type, text, extra) => tokens.push(Object.assign({ type, text, depth: stack.length }, extra || {}));

  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      const nx = pattern[i + 1];
      if (nx === undefined) { issues.push({ level: 'error', msg: '结尾的孤立反斜杠', pos: i }); i++; continue; }
      const isClassEsc = /[dDwWsSbB]/.test(nx);
      const isAnchor = nx === 'b' || nx === 'B';
      const isBackref = /[1-9]/.test(nx);
      const kind = isClassEsc ? (isAnchor ? 'anchor' : 'class') : isBackref ? 'backref' : 'escape';
      push(kind, '\\' + nx, { value: nx });
      i += 2;
      continue;
    }
    if (ch === '[') {
      const start = i;
      i++;
      let negate = false;
      if (pattern[i] === '^') { negate = true; i++; }
      let closed = false;
      let body = '';
      while (i < pattern.length) {
        if (pattern[i] === '\\') { body += pattern.slice(i, i + 2); i += 2; continue; }
        if (pattern[i] === ']') { closed = true; i++; break; }
        body += pattern[i];
        i++;
      }
      if (!closed) issues.push({ level: 'error', msg: '字符类缺少结束的 ]', pos: start });
      if (body === '') issues.push({ level: 'warn', msg: '空字符类 [] 不会匹配任何字符', pos: start });
      push('class', pattern.slice(start, i), { negate, body });
      continue;
    }
    if (ch === '(') {
      let kind = 'capture';
      let j = i + 1;
      let name = null;
      let look = null;
      if (pattern[j] === '?') {
        const c = pattern[j + 1];
        if (c === ':') { kind = 'group'; j += 2; }
        else if (c === '=') { kind = 'look'; look = 'ahead'; j += 2; }
        else if (c === '!') { kind = 'look'; look = 'negAhead'; j += 2; }
        else if (c === '<' && (pattern[j + 2] === '=' || pattern[j + 2] === '!')) { kind = 'look'; look = pattern[j + 2] === '=' ? 'behind' : 'negBehind'; j += 3; }
        else if (c === '<') {
          const close = pattern.indexOf('>', j);
          if (close < 0) { issues.push({ level: 'error', msg: '命名分组缺少 >', pos: i }); }
          else { name = pattern.slice(j + 2, close); j = close + 1; kind = 'capture'; }
        } else {
          issues.push({ level: 'error', msg: '不支持的组语法 (?' + (c || '') + '，本工具只支持 (…) (?:…) (?<name>…) (?= ) (?! ) (?<= ) (?<! )', pos: i });
          j += 1;
        }
      }
      groupDepth++;
      stack.push({ pos: i, kind, name, look });
      push('open', pattern.slice(i, j), { kind, name, look, groupIndex: kind === 'capture' ? countCaptures(tokens) + 1 : null });
      i = j;
      continue;
    }
    if (ch === ')') {
      if (!stack.length) issues.push({ level: 'error', msg: '多余的 )', pos: i });
      else stack.pop();
      groupDepth = Math.max(0, groupDepth - 1);
      push('close', ')');
      i++;
      continue;
    }
    if (ch === '|') { push('alt', '|'); i++; continue; }
    if (ch === '*' || ch === '+' || ch === '?') {
      const before = tokens[tokens.length - 1];
      if (!before || before.type === 'open' || before.type === 'alt') {
        issues.push({ level: 'error', msg: "量词 " + ch + " 前面没有可重复的内容", pos: i });
      }
      let mode = '贪婪';
      let end = i + 1;
      if (pattern[end] === '?') { mode = '懒惰'; end++; }
      else if (pattern[end] === '+') { mode = '占有'; end++; }
      push('quant', pattern.slice(i, end), { min: ch === '+' ? 1 : 0, max: ch === '?' ? 1 : Infinity, mode });
      if (before && before.type === 'quant') issues.push({ level: 'warn', msg: '连续两个量词（如 a**），第二个会被忽略或报错', pos: i });
      i = end;
      continue;
    }
    if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (!m) { push('char', ch, { literal: true }); i++; continue; }
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : (m[3] === '' ? Infinity : Number(m[3]));
      const before = tokens[tokens.length - 1];
      if (!before || before.type === 'open' || before.type === 'alt') issues.push({ level: 'error', msg: '量词 ' + m[0] + ' 前面没有可重复的内容', pos: i });
      if (max < min) issues.push({ level: 'error', msg: '量词上界小于下界 ' + m[0], pos: i });
      let mode = '贪婪';
      let end = i + m[0].length;
      if (pattern[end] === '?') { mode = '懒惰'; end++; }
      else if (pattern[end] === '+') { mode = '占有'; end++; }
      push('quant', pattern.slice(i, end), { min, max, mode });
      i = end;
      continue;
    }
    if (ch === '^' || ch === '$') { push('anchor', ch, { value: ch }); i++; continue; }
    if (ch === '.') { push('dot', '.'); i++; continue; }
    push('char', ch, { literal: true });
    i++;
  }
  if (stack.length) {
    issues.push({ level: 'error', msg: '有 ' + stack.length + ' 个分组没有闭合的 )', pos: stack[stack.length - 1].pos });
  }
  return { tokens, issues };
}

function countCaptures(tokens) {
  let n = 0;
  for (const t of tokens) if (t.type === 'open' && t.kind === 'capture') n++;
  return n;
}

/* 回溯风险启发式：嵌套量词 / 相邻可重叠量词 / 未锚定的 (x+)+ */
function riskScan(pattern) {
  const tips = [];
  const { tokens } = scan(pattern);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'quant') continue;
    // 找量词作用的对象
    let j = i - 1;
    let atomEnd = j;
    if (tokens[j] && tokens[j].type === 'close') {
      let depth = 0;
      for (; j >= 0; j--) {
        if (tokens[j].type === 'close') depth++;
        else if (tokens[j].type === 'open') { depth--; if (depth === 0) break; }
      }
    }
    let innerQuant = false;
    if (tokens[j] && tokens[j].type === 'open') {
      for (let k = j + 1; k < atomEnd; k++) if (tokens[k].type === 'quant') innerQuant = true;
    }
    const unbounded = t.max === Infinity;
    if (innerQuant && unbounded && t.mode !== '占有') {
      tips.push({
        level: 'danger',
        msg: '疑似灾难性回溯：外层 ' + t.text + ' 包住了内层量词（第 ' + (t.depth + 1) + ' 层分组）。当输入很长且匹配失败时，回溯次数会指数爆炸。',
        fix: '改用占有量词或原子组（如 (?:a++)+ 或 (?:a|b)+），或先收窄字符范围再重复。',
      });
    }
    if (tokens[j] && tokens[j].type === 'class' && unbounded) {
      // 相邻两个同字符类量词
      const prev = tokens[i - 2];
      if (prev && prev.type === 'quant' && tokens[j - 1]) {
        tips.push({ level: 'warn', msg: '相邻两个量词作用在同一位置，考虑合并成一个。', fix: '例如 \\s+\\s+ 可以写成 \\s+。' });
      }
    }
  }
  // 贪婪 + 后跟相同字符类
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].type === 'quant' && tokens[i].max === Infinity && tokens[i].mode === '贪婪') {
      const head = tokens[i - 1];
      const tail = tokens[i + 1];
      if (head && head.type === 'class' && tail && tail.type === 'class' && head.text === tail.text) {
        tips.push({ level: 'warn', msg: '同一个字符类被重复匹配又紧跟相同字符类，' + tail.text + ' 永远吃不到：' + head.text + tokens[i].text + tail.text, fix: '把后一个 ' + tail.text + ' 去掉。' });
      }
    }
  }
  return tips;
}

/* ---------------- 中文报错 ---------------- */
const ERROR_MAP = [
  [/Invalid regular expression: \/(.*?)\/: Unterminated group/i, '分组没有闭合：少了一个 )'],
  [/Unterminated character class/i, '字符类没有闭合：少了一个 ]'],
  [/Nothing to repeat/i, '量词前面没有可重复的内容（比如开头就是 * 或 +）'],
  [/Invalid quantifier/i, '量词写法不合法'],
  [/Lone quantifier brackets/i, '只有量词符号，没有可重复的对象'],
  [/Invalid group/i, '分组写法不合法'],
  [/Invalid capture group name/i, '命名分组名字不合法（只能用字母、数字、_ 和 $，且不能以数字开头）'],
  [/Duplicate capture group name/i, '两个分组用了同一个名字'],
  [/Invalid escape/i, '非法的转义序列'],
  [/Invalid Unicode escape/i, '非法的 \\u 转义'],
  [/Invalid character class/i, '字符类范围写反了（比如 [z-a]）'],
  [/Lone quantifier/i, '量词位置不合法'],
  [/Invalid property name/i, '\\p{…} 属性名不存在'],
  [/Unmatched .\)/i, '多了一个 )'],
  [/Invalid flags/i, '标志位不合法'],
  [/Invalid named reference/i, '命名反向引用 \\k<name> 找不到对应分组'],
];

function translateError(err) {
  const msg = String(err && err.message || err);
  for (const [re, zh] of ERROR_MAP) {
    if (re.test(msg)) return { zh, raw: msg };
  }
  return { zh: '正则无法编译', raw: msg };
}

/* ---------------- 编译 ---------------- */
function buildMatcher(pattern, flagsStr = '') {
  const flags = ['g', 'i', 'm', 's', 'u', 'y'].filter((f) => flagsStr.includes(f)).join('');
  const unknown = flagsStr.split('').filter((c) => !'gimsuy'.includes(c));
  if (unknown.length) {
    throw new RegexError('未知标志 ' + JSON.stringify(unknown[0]) + '（可用：g i m s u y）', pattern, 0);
  }
  const staticInfo = scan(pattern);
  const fatal = staticInfo.issues.find((x) => x.level === 'error');
  if (fatal) throw new RegexError(fatal.msg, pattern, fatal.pos);

  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    const t = translateError(e);
    throw new RegexError(t.zh + '\n原始信息：' + t.raw, pattern, 0);
  }

  function toResult(input, m) {
    const groups = [];
    for (let i = 1; i < m.length; i++) groups.push(m[i]);
    const named = {};
    if (m.groups) for (const k of Object.keys(m.groups)) named[k] = m.groups[k];
    return {
      index: m.index,
      end: m.index + m[0].length,
      match: m[0],
      groups,
      named,
      captures: groups.map((g, i) => {
        if (g === undefined) return null;
        // 位置信息：从 match 内二次定位（原生接口不直接给子组位置时退化为文本）
        const at = m.index + m[0].indexOf(g);
        return { start: at, end: at + g.length, text: g };
      }),
    };
  }

  function matchAt(input, startAt = 0) {
    const local = new RegExp(pattern, flags.replace(/[gy]/g, ''));
    const m = local.exec(startAt > 0 ? input.slice(startAt) : input);
    if (!m) return null;
    if (startAt > 0) m.index += startAt;
    return toResult(input, m);
  }

  function search(input) {
    return matchAt(input, 0);
  }

  function execAll(input) {
    if (!re.global) {
      const one = matchAt(input, 0);
      return one ? [one] : [];
    }
    const global = new RegExp(pattern, flags);
    const out = [];
    let m;
    let guard = 0;
    while ((m = global.exec(input)) !== null) {
      out.push(toResult(input, m));
      if (m[0] === '') global.lastIndex++;
      if (++guard > 100000) break;
    }
    return out;
  }

  function fullMatch(input) {
    const anchored = new RegExp('^(?:' + pattern + ')$', flags.replace(/[gy]/g, ''));
    const m = anchored.exec(input);
    if (!m) return null;
    return { index: 0, end: input.length, match: m[0], groups: m.slice(1), named: m.groups || {}, captures: [] };
  }

  return {
    match: matchAt,
    search,
    execAll,
    fullMatch,
    matchCount: (s) => execAll(s).length,
    flags: { global: re.global, ignoreCase: re.ignoreCase, multiline: re.multiline, dotAll: re.dotAll, unicode: re.unicode },
    source: pattern,
  };
}

/* ---------------- 高亮分段 ---------------- */
function segment(text, matches) {
  if (!matches || !matches.length) return [{ text, hit: false, matchIndex: -1 }];
  const parts = [];
  let cursor = 0;
  matches.forEach((m, idx) => {
    if (m.index > cursor) parts.push({ text: text.slice(cursor, m.index), hit: false, matchIndex: -1 });
    if (m.end > m.index) parts.push({ text: text.slice(m.index, m.end), hit: true, matchIndex: idx });
    cursor = Math.max(cursor, m.end);
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false, matchIndex: -1 });
  return parts;
}

/* ---------------- 中文解释器（基于 token 流） ---------------- */
function explain(pattern, flagsStr = '') {
  const { tokens, issues } = scan(pattern);
  const lines = [];
  let groupNo = 0;
  let curAtom = null;

  const qtyText = (t) => {
    const parts = [];
    if (t.min === 0 && t.max === Infinity) parts.push('0 次或多次');
    else if (t.min === 1 && t.max === Infinity) parts.push('1 次或多次');
    else if (t.min === t.max) parts.push('恰好 ' + t.min + ' 次');
    else if (t.max === Infinity) parts.push('至少 ' + t.min + ' 次');
    else parts.push(t.min + ' 到 ' + t.max + ' 次');
    if (t.mode === '懒惰') parts.push('懒惰：尽可能少吃');
    if (t.mode === '占有') parts.push('占有：不回溯');
    return parts.join('，');
  };

  tokens.forEach((t, idx) => {
    const pad = '  '.repeat(t.depth);
    if (t.type === 'char') {
      lines.push({ depth: t.depth, main: pad + '字面量 “' + t.text + '”', sub: '精确匹配这个字符' });
      curAtom = { kind: 'char', text: t.text };
    } else if (t.type === 'dot') {
      lines.push({ depth: t.depth, main: pad + '任意字符 .', sub: '除换行外任意一个字符' });
      curAtom = { kind: 'dot', text: '.' };
    } else if (t.type === 'class') {
      const setDesc = t.negate ? '不能是 ' + t.body : '可以是 ' + t.body;
      lines.push({ depth: t.depth, main: pad + '字符类 ' + t.text, sub: setDesc + ' 中的任意一个字符' });
      curAtom = { kind: 'class', text: t.text };
    } else if (t.type === 'escape') {
      lines.push({ depth: t.depth, main: pad + '转义 ' + t.text, sub: '匹配特定字符' });
      curAtom = { kind: 'escape', text: t.text };
    } else if (t.type === 'anchor') {
      lines.push({ depth: t.depth, main: pad + '锚点 ' + t.text, sub: t.text === '^' ? '要求这里是行首（零宽）' : '要求这里是行尾（零宽）' });
      curAtom = null;
    } else if (t.type === 'alt') {
      lines.push({ depth: t.depth, main: pad + '或者 |', sub: '左右各是一支，任一支匹配成功即可' });
      curAtom = null;
    } else if (t.type === 'open') {
      if (t.kind === 'capture') {
        groupNo++;
        lines.push({ depth: t.depth, main: pad + '捕获组 #' + groupNo + (t.name ? ' (命名 ' + t.name + ')' : ''), sub: '括号内匹配到的文本会被单独记下来' });
        t.groupIndex = groupNo;
      } else if (t.kind === 'group') {
        lines.push({ depth: t.depth, main: pad + '非捕获组 (?:…)', sub: '只想分组、不想记下内容时用它' });
      } else {
        const map = { ahead: '肯定先行断言 (?=…)', negAhead: '否定先行断言 (?!…)', behind: '肯定后行断言 (?<=…)', negBehind: '否定后行断言 (?<!…)' };
        lines.push({ depth: t.depth, main: pad + map[t.look], sub: '零宽条件：只看右边/左边有没有指定内容，自己不消耗字符' });
      }
      curAtom = { kind: 'group', text: '' };
    } else if (t.type === 'close') {
      lines.push({ depth: t.depth, main: pad + '分组结束 )', sub: '' });
      curAtom = { kind: 'group', text: '' };
    } else if (t.type === 'quant') {
      const target = curAtom ? (curAtom.kind === 'group' ? '前面的分组' : '前面的 “' + curAtom.text + '”') : '前面内容';
      lines.push({ depth: t.depth, main: pad + '重复 ' + t.text + ' → 对' + target + '重复 ' + qtyText(t), sub: '' });
    } else if (t.type === 'backref') {
      lines.push({ depth: t.depth, main: pad + '反向引用 ' + t.text, sub: '这里必须出现与第 ' + t.value + ' 组完全相同的文本' });
      curAtom = { kind: 'backref', text: t.text };
    }
  });

  const flagNotes = [];
  if (flagsStr.includes('g')) flagNotes.push('g 全局：找出全部匹配，而不是遇到第一个就停');
  if (flagsStr.includes('i')) flagNotes.push('i 忽略大小写');
  if (flagsStr.includes('m')) flagNotes.push('m 多行：^ 和 $ 匹配每一行的开头/结尾');
  if (flagsStr.includes('s')) flagNotes.push('s 让 . 也能匹配换行');
  if (flagsStr.includes('u')) flagNotes.push('u 按 Unicode 码点处理');
  return { lines, flagNotes, issues };
}

/* ---------------- 片段库 ---------------- */
const CHEATSHEET = [
  { cat: '常用格式', name: '邮箱（宽松）', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', flags: 'g', sample: '联系 alice.w@example.com 或 bob_99@mail.org' },
  { cat: '常用格式', name: '手机号（中国大陆）', pattern: '(?<!\\d)1[3-9]\\d{9}(?!\\d)', flags: 'g', sample: '电话13812345678，备用 13900001111，短号 1234' },
  { cat: '常用格式', name: '网址 URL', pattern: 'https?://[^\\s<>"\']+', flags: 'g', sample: '见 https://github.com/JiangYuxin-Jim 和 http://a.co/x' },
  { cat: '常用格式', name: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g', sample: 'gateway 192.168.1.1, dns 8.8.8.8' },
  { cat: '常用格式', name: '十六进制颜色', pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b', flags: 'g', sample: 'color: #fff; background: #1a2b3c;' },
  { cat: '常用格式', name: '日期 YYYY-MM-DD', pattern: '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})', flags: 'g', sample: '从 2026-11-14 到 2026-12-01' },
  { cat: '常用格式', name: '时间 HH:MM', pattern: '\\b(?:[01]\\d|2[0-3]):[0-5]\\d\\b', flags: 'g', sample: '班车 08:30 出发，21:05 返回' },
  { cat: '字符串处理', name: '首尾空白', pattern: '^\\s+|\\s+$', flags: 'gm', sample: '  第一行  \n\t第二行\t\n' },
  { cat: '字符串处理', name: '重复单词', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi', sample: 'this is is a real real test' },
  { cat: '字符串处理', name: '连续空行', pattern: '(?:\\r?\\n){3,}', flags: 'g', sample: 'a\n\n\n\nb' },
  { cat: '字符串处理', name: 'HTML 标签', pattern: '<\\/?[a-zA-Z][^>]*>', flags: 'g', sample: '<div class="x"><b>嗨</b></div>' },
  { cat: '字符串处理', name: '中文字符', pattern: '[\\u4e00-\\u9fa5]', flags: 'g', sample: '你好 hello 世界' },
  { cat: '字符串处理', name: '驼峰拆分', pattern: '([a-z0-9])([A-Z])', flags: 'g', sample: 'myHTTPName userID' },
  { cat: '命名与括号', name: '括号内内容', pattern: '\\(([^()]*)\\)', flags: 'g', sample: '函数 f(a, b) 调用 g(x)' },
  { cat: '命名与括号', name: '配对引号', pattern: '(["\'])(.*?)\\1', flags: 'g', sample: 'say "hello" and \'bye\'' },
  { cat: '命名与括号', name: 'Markdown 链接', pattern: '\\[([^\\]]+)\\]\\(([^)]+)\\)', flags: 'g', sample: '看 [文档](https://a.io/x) 和 [仓库](https://b.io)' },
  { cat: '陷阱示例', name: '嵌套量词（回溯炸弹）', pattern: '(a+)+$', flags: 'g', sample: 'aaaaaaaaaaaaaaaaaaaaab' },
  { cat: '陷阱示例', name: '贪婪 vs 懒惰', pattern: '<.+?>', flags: 'g', sample: '<a><b>贪婪会吞掉全部</b></a>' },
];

module.exports = {
  RegexError,
  MAX_STEPS,
  buildMatcher,
  scan,
  riskScan,
  segment,
  explain,
  translateError,
  CHEATSHEET,
};

/* 浏览器兼容：index.html 通过 <script src="engine.js"> 加载时挂到 window */
if (typeof window !== 'undefined') {
  window.REGEX_LAB = Object.assign({}, window.REGEX_LAB || {}, module.exports);
}
