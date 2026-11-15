// 自检脚本：node test.js
const assert = require('assert');
const T = require('./engine.js');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ` (got ${a}, want ${b})`); pass++; }

// 1. 空文本
eq(T.estimateTokens('').tokens, 0, '空文本 0 token');
eq(T.estimateTokens(null).tokens, 0, 'null 安全');

// 2. 纯英文：4 字符≈1 token
const en = T.estimateTokens('The quick brown fox jumps over the lazy dog');
// 9 个词，共 43 字符 → 约 ceil 每词长度/4
ok(en.tokens >= 9 && en.tokens <= 18, '英文 9 词估算落在 9~18: ' + en.tokens);
eq(en.latin > 30, true, '统计到英文字母');

// 3. 纯中文：1 字≈1 token
const zh = T.estimateTokens('今天天气真好我们一起去公园散步吧');
eq(zh.cjk, 16, '识别 16 个汉字');
eq(zh.tokens, 16, '中文 16 字 = 16 token');

// 4. 中英混排
const mix = T.estimateTokens('用 Node.js 写一个 server');
eq(mix.cjk, 4, '混排识别 4 汉字');
ok(mix.tokens >= 4, '混排 token 数不小于汉字数');

// 5. 成本计算：1000 in + 500 out，gpt 价 in=1.25 out=10
const p = { in: 1.25, out: 10, cached: 0.125 };
const c = T.computeCost(p, { inputTokens: 1000, outputTokens: 500 });
eq(Math.round(c.perCall * 1e6), Math.round(1000 * 1.25 / 1e6 * 1e6 + 500 * 10 / 1e6 * 1e6), '单次成本正确');
ok(Math.abs(c.perCall - (1000 * 1.25 + 500 * 10) / 1e6) < 1e-12, '单次成本精确值');

// 6. 多次调用线性
const c10 = T.computeCost(p, { inputTokens: 1000, outputTokens: 500, calls: 10 });
ok(Math.abs(c10.total - c.perCall * 10) < 1e-12, '10 次调用 = 10 倍');

// 7. 缓存：
const cc = T.computeCost(p, { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 800 });
// 200*1.25 + 800*0.125 = 250 + 100 = 350 → /1e6
ok(Math.abs(cc.perCall - 350 / 1e6) < 1e-12, '缓存价生效: ' + cc.perCall);
ok(Math.abs(cc.cacheSaved - 800 * (1.25 - 0.125) / 1e6) < 1e-12, '省下的钱正确');

// 8. 缓存数超过输入 → 截断到输入
const over = T.computeCost(p, { inputTokens: 100, outputTokens: 0, cachedInputTokens: 999 });
ok(Math.abs(over.perCall - 100 * 0.125 / 1e6) < 1e-12, '缓存超额被截断');

// 9. 无缓存价格字段时退回普通价
const noCache = T.computeCost({ in: 2, out: 4, cached: null }, { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 1000 });
ok(Math.abs(noCache.perCall - 2000 / 1e6) < 1e-12, '无缓存价按原价');

// 10. 预算反推
const b = T.budgetBreakdown(p, 5, { inputTokens: 1000, outputTokens: 500 });
eq(b.calls, Math.floor(5 / c.perCall), '预算 5 美元可跑次数');

// 11. 负数/非法输入被吃掉
const bad = T.computeCost(p, { inputTokens: -5, outputTokens: 'abc' });
eq(bad.perCall, 0, '非法输入不产生成本');

// 12. 金额格式化
eq(T.money(0), '$0', 'money 0');
eq(T.money(0.0012), '$0.00120', 'money 小值');
ok(T.money(12.3456).startsWith('$12.3'), 'money 大值');

// 13. 模型表完整性
eq(T.MODELS.length >= 10, true, '至少 10 个模型');
T.MODELS.forEach(m => {
  ok(typeof m.in === 'number' && typeof m.out === 'number', m.name + ' 价格是数字');
  ok(m.out >= m.in, m.name + ' 输出价不低于输入价');
});

// 14. 长文本估算（1 万字中文）
const long = '测'.repeat(10000);
eq(T.estimateTokens(long).tokens, 10000, '一万汉字 = 一万 token');

// 15. 换行/空白也计 token
const ws = T.estimateTokens('\n\n\n\n    ');
ok(ws.tokens > 0, '纯空白也有 token 开销: ' + ws.tokens);

console.log(`\n✅ ${pass} 项断言全绿`);
console.log('示例：16 汉字 → ' + T.estimateTokens('今天天气真好我们一起去公园散步吧').tokens + ' tokens');
console.log('示例：GPT-5.1 1000 in / 500 out → ' + T.money(c.perCall));
