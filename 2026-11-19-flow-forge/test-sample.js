/* flow-forge 示例图自检：node test-sample.js */
const E = require('./engine.js');
const G = require('./sample.js');
let pass = 0, fail = 0;
function ok(c, n, x) { if (c) pass++; else { fail++; console.log('✗ ' + n + (x ? '  → ' + x : '')); } }

const sup = G.support();
const rs = E.run(sup, { q: true });
ok(rs.ok, '客服图可执行');
ok(rs.stats.ran === 5, '客服图走「能自动答」分支跑了 5 个节点', rs.stats.ran);
ok(rs.stats.toolCalls === 1, '客服图有 1 次工具调用');
const rs2 = E.run(sup, { q: false });
ok(rs2.stats.humanWalls === 1, '客服图走「否」分支时有人工挂起');
ok(rs2.stats.toolCalls === 0, '客服图转人工时不检索知识库', rs2.stats.toolCalls);
ok(E.lint(sup).every(m => m.level === 'ok' || m.level === 'info'), '客服图 lint 无 error/warn',
  JSON.stringify(E.lint(sup)));

const rep = G.report();
const rr = E.run(rep, { c: false });
ok(rr.ok, '日报图可执行');
ok(rr.stats.parallel === true, '日报图识别出并行取数');
ok(rr.stats.width >= 2, '日报图并行宽度 >= 2', rr.stats.width);
ok(rr.stats.depth === 6, '日报图关键路径 = 6', rr.stats.depth);

const lp = G.loop();
const rl = E.run(lp);
ok(rl.ok === false, '反例环形图被拒绝执行');
ok(E.lint(lp).some(m => m.level === 'error' && /循环/.test(m.msg)), 'lint 报出循环依赖');

const price = E.priceRun(rs.stats, 'deepseek-v3.2', 200);
ok(price.perRun > 0 && price.perMonth > price.perDay, '费用推演递增');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
