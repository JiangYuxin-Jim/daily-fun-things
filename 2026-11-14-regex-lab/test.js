const { buildMatcher, scan, riskScan, segment, explain, translateError, CHEATSHEET, RegexError } = require('./engine.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; fails.push(msg); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  ok(sa === sb, msg + '  期望 ' + sb + ' 实际 ' + sa);
}

// 1. 基本匹配与捕获
{
  const m = buildMatcher('(\\w+)@(\\w+)', 'g').search('mail: bob@host');
  ok(m && m.match === 'bob@host', '搜索到 bob@host');
  eq(m.groups, ['bob', 'host'], '捕获组');
  eq(m.index, 6, '起始位置');
}
{
  const m = buildMatcher('(?<y>\\d{4})-(?<m>\\d{2})', 'g').search('2026-11');
  eq(m.named, { y: '2026', m: '11' }, '命名分组');
}

// 2. 全局匹配
eq(buildMatcher('\\d+', 'g').execAll('a1b22c333').map((x) => x.match), ['1', '22', '333'], '全局数字');
eq(buildMatcher('[a-c]+', 'g').execAll('xxabcdzz').map((x) => x.match), ['abc'], '字符类范围');
eq(buildMatcher('\\bcat\\b', 'g').execAll('cat concat cat.').map((m) => m.index), [0, 11], '单词边界');
eq(buildMatcher('^\\s+|\\s+$', 'gm').execAll('  a  \n  b  \n').length, 4, '多行首尾空白');

// 3. 断言 / 引用
eq(buildMatcher('(?<=\\$)\\d+', 'g').execAll('$5 and 6').map((m) => m.match), ['5'], '后行断言');
eq(buildMatcher('(?<!\\d)1[3-9]\\d{9}(?!\\d)', 'g').execAll('电话13812345678，另一个113812345678').length, 1, '手机号片段');
eq(buildMatcher('\\b(\\w+)\\s+\\1\\b', 'gi').execAll('this is is a real real test').map((m) => m.match), ['is is', 'real real'], '重复单词');

// 4. 贪婪 vs 懒惰
eq(buildMatcher('<.+>', 'g').search('<a><b>').match, '<a><b>', '贪婪吃掉全部');
eq(buildMatcher('<.+?>', 'g').search('<a><b>').match, '<a>', '懒惰只吃最少');

// 5. 错误翻译
let errMsg = '';
try { buildMatcher('(abc', ''); } catch (e) { errMsg = e instanceof RegexError ? e.message : 'wrong type'; }
ok(errMsg.includes('分组没有闭合'), '少右括号报中文错: ' + errMsg);
errMsg = '';
try { buildMatcher('[a-', ''); } catch (e) { errMsg = e.message; }
ok(errMsg.length > 0, '未闭合字符类应报错: ' + errMsg);
errMsg = '';
try { buildMatcher('*abc', ''); } catch (e) { errMsg = e.message; }
ok(errMsg.includes('前面没有可重复的内容'), '开头量词报中文错: ' + errMsg);
errMsg = '';
try { buildMatcher('abc', 'x'); } catch (e) { errMsg = e.message; }
ok(errMsg.includes('未知标志'), '未知标志报错: ' + errMsg);

// 6. 静态体检
{
  const tips = riskScan('(a+)+$');
  ok(tips.some((t) => t.level === 'danger'), '嵌套量词识别为危险');
  ok(riskScan('^\\d{4}-\\d{2}$').length === 0, '普通正则无风险提示');
  const s = scan('(abc');
  ok(s.issues.some((i) => i.level === 'error' && i.msg.includes('没有闭合')), '扫描发现未闭合分组');
  ok(scan('[z-a]').issues.length >= 0, '字符类扫描不崩溃');
}

// 7. 解释器
{
  const { lines, flagNotes } = explain('(?<y>\\d{4})-(\\w+)+', 'gi');
  ok(lines.some((l) => l.main.includes('捕获组 #1')), '解释器标注捕获组');
  ok(lines.some((l) => l.main.includes('重复')), '解释器标注量词');
  ok(flagNotes.length === 2, '标志位说明');
  const plain = explain('a.c');
  ok(plain.lines.some((l) => l.main.includes('任意字符')), '解释 . 为任意字符');
}

// 8. 高亮分段
{
  const text = 'a1b22c';
  const ms = buildMatcher('\\d+', 'g').execAll(text);
  const parts = segment(text, ms);
  eq(parts.map((p) => p.text).join(''), text, '分段重组原文一致');
  eq(parts.filter((p) => p.hit).map((p) => p.text), ['1', '22'], '高亮片段');
}

// 9. 片段库全量可编译 + 有示例
CHEATSHEET.forEach((c) => {
  let good = true;
  try { buildMatcher(c.pattern, c.flags); } catch (e) { good = false; fails.push('片段 ' + c.name + ' 编译失败: ' + e.message); }
  ok(good, '片段可编译 ' + c.name);
  ok(typeof c.sample === 'string' && c.sample.length > 0, '片段有示例 ' + c.name);
});
{
  const email = buildMatcher('[\\w.+-]+@[\\w-]+\\.[\\w.]+', 'g');
  eq(email.execAll('a@b.com, c.d@e.org').map((m) => m.match), ['a@b.com', 'c.d@e.org'], '邮箱片段命中');
  const md = buildMatcher('\\[([^\\]]+)\\]\\(([^)]+)\\)', 'g');
  eq(md.execAll('[a](b)').map((m) => m.groups), [['a', 'b']], 'markdown 链接片段');
}

// 10. 中文与全匹配
eq(buildMatcher('天气', 'g').execAll('今天天气不错').map((m) => m.index), [2], '中文字面量');
ok(buildMatcher('\\d{3}').fullMatch('123') !== null, 'fullMatch 命中');
eq(buildMatcher('\\d{3}').fullMatch('1234'), null, 'fullMatch 长度不符');

// 11. 原始错误翻译表可用
{
  const t = translateError(new Error('Invalid regular expression: /(/: Unterminated group'));
  ok(t.zh.includes('分组没有闭合'), '错误翻译表命中');
}

console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log(fails.slice(0, 20).join('\n'));
  process.exit(1);
}
