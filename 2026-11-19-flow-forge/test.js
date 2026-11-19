/* flow-forge 自检：node test.js —— 核心引擎断言 */
const E = require('./engine.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

/* 用固定 id 手工搭图，避免随机 id 影响断言 */
function g(nodes, edges) {
  const o = {};
  nodes.forEach(n => { o[n.id] = Object.assign({ x: 0, y: 0, conf: E.quickConf(n.type) }, n); });
  return { nodes: o, edges: edges || [] };
}

/* --- 1. 新建节点与默认配置 --- */
const n1 = E.newNode('llm', 10, 20);
ok(n1.id && n1.id.startsWith('n'), 'newNode 生成 id');
eq(n1.type, 'llm', 'newNode 类型');
eq(E.tokenCost(n1), 800 + 250, 'llm 默认 token = in+out');
eq(E.tokenCost({ type: 'tool', conf: { outTok: 120 } }), 120, 'tool token = outTok');
eq(E.tokenCost({ type: 'human', conf: {} }), 0, 'human 不花 token');

/* --- 2. 线性链拓扑排序 --- */
const lin = g(
  [{ id: 'a', type: 'start', label: '开始' }, { id: 'b', type: 'llm', label: '规划' }, { id: 'c', type: 'end', label: '结束' }],
  [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
);
const ts = E.topoSort(lin);
ok(ts.ok, '线性链拓扑可解');
eq(ts.order.join(','), 'a,b,c', '线性链顺序正确');
const rlin = E.run(lin);
ok(rlin.ok, '线性链可执行');
eq(rlin.stats.ran, 3, '线性链跑了 3 个节点');
eq(rlin.stats.tokIn, 800, '线性链 inTok 统计');
eq(rlin.stats.parallel, false, '线性链不算并行');

/* --- 3. 环检测 --- */
const cyc = g(
  [{ id: 'a', type: 'start' }, { id: 'b', type: 'llm' }, { id: 'c', type: 'llm' }],
  [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }]
);
const ts2 = E.topoSort(cyc);
eq(ts2.ok, false, '检测到环');
ok(ts2.cycle.length >= 2, '环路径非空', JSON.stringify(ts2.cycle));
const rcyc = E.run(cyc);
eq(rcyc.ok, false, '有环时执行被拒绝');
ok(/循环/.test(rcyc.error), '环错误信息可读');

/* --- 4. 条件分支：选「是」vs 选「否」 --- */
const br = g(
  [
    { id: 'a', type: 'start', label: '开始' },
    { id: 'q', type: 'condition', label: '结果为空？' },
    { id: 'yes', type: 'tool', label: '重搜' },
    { id: 'no', type: 'llm', label: '总结' },
    { id: 'e', type: 'end', label: '结束' }
  ],
  [
    { from: 'a', to: 'q' },
    { from: 'q', to: 'yes', cond: 'true' },
    { from: 'q', to: 'no', cond: 'false' },
    { from: 'yes', to: 'e' },
    { from: 'no', to: 'e' }
  ]
);
const rYes = E.run(br, { q: true });
const ranYes = rYes.events.filter(e => e.kind === 'run').map(e => e.id);
ok(ranYes.indexOf('yes') >= 0, '选「是」时走到重搜分支');
ok(ranYes.indexOf('no') < 0, '选「是」时跳过总结分支');
const rNo = E.run(br, { q: false });
const ranNo = rNo.events.filter(e => e.kind === 'run').map(e => e.id);
ok(ranNo.indexOf('no') >= 0, '选「否」时走到总结分支');
ok(ranNo.indexOf('yes') < 0, '选「否」时跳过重搜分支');
ok(rNo.stats.tok !== rYes.stats.tok, '两条分支 token 不同（300 vs 1050）');
eq(rNo.stats.tok, 1050, '选「否」token = llm 1050');
eq(rYes.stats.tok, 300, '选「是」token = tool 300');

/* --- 5. 并行分支：同时激活数 = 2 --- */
const par = g(
  [{ id: 'a', type: 'start' }, { id: 'b', type: 'tool' }, { id: 'c', type: 'llm' }, { id: 'd', type: 'end' }],
  [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }]
);
const rpar = E.run(par);
eq(rpar.stats.ran, 4, '并行图全部节点执行');
eq(rpar.stats.parallel, true, '识别出并行');
eq(rpar.stats.depth, 3, '关键路径深度 = 3');
eq(rpar.stats.width, 2, '并行宽度 = 2');

/* --- 6. 孤儿节点 --- */
const orphan = g(
  [{ id: 'a', type: 'start' }, { id: 'b', type: 'llm' }, { id: 'z', type: 'llm' }],
  [{ from: 'a', to: 'b' }]
);
const ror = E.run(orphan);
eq(ror.stats.dead.length, 1, '识别出 1 个孤儿节点');
eq(ror.stats.dead[0], 'z', '孤儿节点正确');

/* --- 7. lint 诊断 --- */
const bad = g(
  [{ id: 'a', type: 'llm', label: '裸节点' }],
  []
);
const msgs = E.lint(bad);
ok(msgs.some(m => /开始/.test(m.msg)), 'lint 提示缺开始节点');
ok(msgs.some(m => /出口/.test(m.msg)), 'lint 提示悬空出口');
const okMsgs = E.lint(lin);
ok(okMsgs.some(m => m.level === 'ok'), '健康图给出 ok 结论');

const oneBranch = g(
  [{ id: 's', type: 'start' }, { id: 'q', type: 'condition' }, { id: 'e', type: 'end' }],
  [{ from: 's', to: 'q' }, { from: 'q', to: 'e' }]
);
ok(E.lint(oneBranch).some(m => m.level === 'error' && /两条/.test(m.msg)), 'lint 抓出单分支条件');

/* --- 8. 费用计算与排序 --- */
const st = { tokIn: 10000, tokOut: 4000 };
const one = E.priceRun(st, 'claude-sonnet-4.5', 100);
const expectRun = 10000 / 1e6 * 3 + 4000 / 1e6 * 15;
ok(Math.abs(one.perRun - expectRun) < 1e-12, '单次费用公式', one.perRun);
ok(Math.abs(one.perMonth - expectRun * 100 * 30) < 1e-9, '月费公式');
const ranked = E.allPrices(st, 100);
eq(ranked.length, Object.keys(E.PRICES).length, '全部模型都参与比价');
let sorted = true;
for (let i = 1; i < ranked.length; i++) if (ranked[i].perRun < ranked[i - 1].perRun) sorted = false;
ok(sorted, '比价结果按费用升序');
eq(ranked[0].model, 'deepseek-v3.2', '最便宜的是 deepseek');

/* --- 9. 幽灵图（空图 / 无 start） --- */
const empty = { nodes: {}, edges: [] };
const re = E.run(empty);
eq(re.ok, false, '空图不执行');
eq(E.lint(empty)[0].level, 'warn', '空图给出提示');

/* --- 10. Mermaid 导出 --- */
const mm = E.toMermaid(br);
ok(mm.startsWith('flowchart TD'), 'mermaid 头正确');
ok(mm.indexOf('-->|是|') >= 0, 'mermaid 保留条件标签');
ok(mm.indexOf('q{"结果为空？"}') >= 0, 'mermaid 条件节点用菱形');

/* --- 11. 随机图重放校验：同图同 decision 可复现 --- */
let replay = 0;
for (let t = 0; t < 150; t++) {
  const N = 3 + Math.floor(Math.random() * 6);
  const nodes = [{ id: 'n0', type: 'start' }];
  for (let i = 1; i < N; i++) {
    const t2 = ['llm', 'tool', 'condition', 'human'][Math.floor(Math.random() * 4)];
    nodes.push({ id: 'n' + i, type: t2 });
  }
  // 只连 i -> j (i<j)，天然无环
  const edges = [];
  for (let i = 0; i < N - 1; i++) {
    if (Math.random() < 0.85) edges.push({ from: 'n' + i, to: 'n' + (i + 1), cond: nodes[i + 1].type === 'condition' || Math.random() < 0.5 ? (Math.random() < 0.5 ? 'true' : 'false') : undefined });
    if (Math.random() < 0.3) {
      const j = i + 2 + Math.floor(Math.random() * Math.max(1, N - i - 2));
      if (j < N) edges.push({ from: 'n' + i, to: 'n' + j });
    }
  }
  const gg = g(nodes, edges);
  const dec = {};
  Object.keys(gg.nodes).forEach(id => { if (gg.nodes[id].type === 'condition') dec[id] = Math.random() < 0.5; });
  const r1 = E.run(gg, dec), r2 = E.run(gg, dec);
  if (r1.ok !== r2.ok) { replay++; continue; }
  if (r1.ok && JSON.stringify(r1.stats) !== JSON.stringify(r2.stats)) { replay++; }
}
eq(replay, 0, '150 轮随机图重放结果一致');
pass++; // 随机图没崩就算通过

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
