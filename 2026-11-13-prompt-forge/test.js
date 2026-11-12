// 自检：验证打分、优化、diff 三条主线
const P = require('./engine.js');
const assert = require('assert');

// 1. 空输入
let a = P.analyze('');
assert.ok(a.issues.some((i) => i.id === 'empty'), 'empty 应被识别');
assert.strictEqual(a.score, 0);

// 2. 烂提示词应该低分
const bad = '请问你能帮我优化一下这个东西吗，让它更好一些，谢谢';
a = P.analyze(bad);
assert.ok(a.score < 55, '烂提示词分数应低于 55，实际 ' + a.score);
assert.ok(a.issues.some((i) => i.id === 'vague'), '应识别模糊词');
assert.ok(a.issues.some((i) => i.id === 'polite-noise'), '应识别客套话');

// 3. 好提示词应该高分
const good = [
  '你是一位资深前端工程师。',
  '背景：我用 Vue3 写了一个 3000 行的表单组件，现在渲染很慢。',
  '任务：分析性能瓶颈并给出改造方案。',
  '要求：面向有 2 年经验的开发者，500 字以内，必须包含可复现的排查步骤。',
  '输出格式：Markdown 表格，列为「问题 / 证据 / 改法 / 收益」。',
  '例如：……'
].join('\n');
a = P.analyze(good);
assert.ok(a.score >= 85, '好提示词分数应 >= 85，实际 ' + a.score);
assert.strictEqual(a.grade, 'S');

// 4. 优化：客套话被清掉、结构被补齐
const out = P.improve(bad, { role: '你是一位产品文案专家' });
assert.ok(out.indexOf('产品文案专家') >= 0, '应写入角色');
assert.ok(out.indexOf('# 任务') >= 0 && out.indexOf('# 要求') >= 0, '应有结构');
assert.ok(out.indexOf('请问') < 0, '客套话应清除');
assert.ok(!P.analyze(out).issues.some((i) => i.id === 'no-context'), '优化稿应已补齐背景段');
assert.ok(P.analyze(out).score > P.analyze(bad).score, '优化后分数应提升');

// 5. 严格模式多一条约束
const strictOut = P.improve(bad, { strict: true });
assert.ok(strictOut.indexOf('严格模式') >= 0, '严格模式应生效');

// 6. diff：行级 LCS 正确性
const d = P.diffLines('a\nb\nc', 'a\nx\nc');
assert.deepStrictEqual(d.filter((x) => x.type === 'same').map((x) => x.text), ['a', 'c']);
assert.deepStrictEqual(d.filter((x) => x.type === 'del').map((x) => x.text), ['b']);
assert.deepStrictEqual(d.filter((x) => x.type === 'add').map((x) => x.text), ['x']);

// 7. token 估计
assert.ok(P.estimateTokens('你好世界') === 4);
assert.ok(P.estimateTokens('hello world') >= 2);

console.log('✅ 全部自检通过');
console.log('烂提示词得分：', P.analyze(bad).score, ' 好提示词得分：', P.analyze(good).score);
console.log('----- 优化后预览 -----');
console.log(out);
