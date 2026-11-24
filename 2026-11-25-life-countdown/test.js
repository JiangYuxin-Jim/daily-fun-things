const L = require('./life.js');
const assert = require('assert');

// 1. 基本计算：1990-01-01 出生，寿命 80，今天 2020-01-01
const r = L.compute({ birth: '1990-01-01', expectancy: 80, today: new Date(2020, 0, 1) });
assert.strictEqual(r.livedDays, 30 * 365 + 7); // 1992..2016 共 7 个闰日
assert.strictEqual(r.totalDays, 80 * 365 + 20); // 1990-2070 共 20 个闰日
assert.strictEqual(r.leftDays, r.totalDays - r.livedDays);
assert.ok(r.pct > 0.37 && r.pct < 0.38, 'pct=' + r.pct);
console.log('✓ 基本天数', r.livedDays, '/', r.totalDays, (r.pct * 100).toFixed(2) + '%');

// 2. 生日倒计时
const b = L.compute({ birth: '2000-03-15', expectancy: 85, today: new Date(2026, 0, 1) });
assert.strictEqual(b.nextBirthday, '2026-03-15');
assert.strictEqual(b.nextBirthdayIn, 73);
console.log('✓ 下一个生日', b.nextBirthday, '还有', b.nextBirthdayIn, '天');

// 3. 2/29 出生不崩
const leap = L.compute({ birth: '2000-02-29', expectancy: 80, today: new Date(2026, 1, 28) });
assert.ok(leap.nextBirthdayIn >= 1);
console.log('✓ 闰日生日 OK，下一个生日', leap.nextBirthday, '还有', leap.nextBirthdayIn, '天');

// 4. 未来日期 / 超龄都不出负数
const fut = L.compute({ birth: '2030-01-01', expectancy: 80, today: new Date(2026, 0, 1) });
assert.strictEqual(fut.livedDays, 0);
const old = L.compute({ birth: '1900-01-01', expectancy: 80, today: new Date(2026, 0, 1) });
assert.strictEqual(old.leftDays, 0);
assert.strictEqual(old.pct, 1);
console.log('✓ 边界：未来=0，超龄=100%');

// 5. 非法输入抛错
assert.throws(() => L.compute({ birth: '2020-02-30', expectancy: 80 }));
assert.throws(() => L.compute({ birth: 'abc', expectancy: 80 }));
console.log('✓ 非法日期被拒');

// 6. 周网格一致性
assert.strictEqual(r.livedWeeks * 7 <= r.livedDays, true);
assert.ok(r.totalWeeks >= r.livedWeeks);
console.log('✓ 周网格', r.livedWeeks, '/', r.totalWeeks);

// 7. 数字格式化
assert.strictEqual(L.fmtNum(1234567), '1,234,567');
console.log('✓ 千分位格式化');

// 8. 打印一份示例
const demo = L.compute({ birth: '1995-06-18', expectancy: 82, today: new Date(2026, 10, 25) });
console.log('\n示例：1995-06-18 出生，预期 82 岁');
console.log('  已活 %d 天（%s%%），还剩 %d 天 ≈ %d 年',
  demo.livedDays, (demo.pct * 100).toFixed(1), demo.leftDays, Math.floor(demo.yearsLeft));
console.log('  剩余夏天 %d 个，剩余满月 %d 次，剩余周末 %d 天',
  demo.left.summers, demo.left.fullMoons, demo.left.weekends);
console.log('\n全部测试通过 ✅');
