/* git-lab 自检：node test.js */
const path = require('path');
const G = require('./engine.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function exec(state, ...lines) {
  let s = state, outs = [];
  for (const l of lines) {
    const r = G.run(s, l);
    s = r.state; outs.push(r.out);
  }
  return { s, outs };
}

console.log('— 基础线性历史 —');
{
  let { s, outs } = exec(G.newState(),
    'git init', 'git add a.js', 'git commit -m "首个提交"', 'git add b.js', 'git commit -m "第二个"');
  ok(s.commits.length === 2, '两次提交');
  ok(s.branches.main === s.commits[1].id, 'main 指向最新提交');
  ok(s.commits[1].parents[0] === s.commits[0].id, '父子关系正确');
  ok(/\[main [0-9a-f]{7}\]/.test(outs[2]), '提交输出格式正确');
  ok(G.treeOf(s, s.branches.main)['a.js'] !== undefined, '树快照包含早期文件');
}

console.log('— 空提交被拒 —');
{
  let { s, outs } = exec(G.newState(), 'git init', 'git commit -m "空"');
  ok(s.commits.length === 0, '没有暂存时禁止提交');
  ok(/没有暂存/.test(outs[1]), '给出中文提示');
}

console.log('— 快进合并 —');
{
  let { s } = exec(G.newState(),
    'git init', 'git add a', 'git commit -m "A"',
    'git switch -c dev', 'git add b', 'git commit -m "B"',
    'git switch main', 'git merge dev');
  ok(s.branches.main === s.branches.dev, 'main 快进到 dev');
  ok(s.commits.length === 2, '快进不产生新提交');
}

console.log('— 三方合并（无冲突）—');
{
  let { s } = exec(G.newState(),
    'git init', 'git add base.js', 'git commit -m "base"',
    'git switch -c dev', 'git add d.js', 'git commit -m "dev1"',
    'git switch main', 'git add m.js', 'git commit -m "main1"',
    'git merge dev');
  ok(s.commits.length === 4, '产生合并提交');
  ok(s.commits[3].parents.length === 2, '合并提交有两个父');
  const tree = G.treeOf(s, s.branches.main);
  ok(tree['d.js'] !== undefined && tree['m.js'] !== undefined, '合并后两边文件都在');
  ok(s.conflicts.length === 0, '无冲突');
}

console.log('— 合并基计算 —');
{
  let { s } = exec(G.newState(),
    'git init', 'git add a', 'git commit -m "A"',
    'git switch -c dev', 'git add b', 'git commit -m "B"',
    'git switch main', 'git add c', 'git commit -m "C"');
  ok(G.mergeBase(s, s.branches.main, s.branches.dev) === s.commits[0].id, '合并基是共同祖先');
}

console.log('— 已经是最新 —');
{
  let { s, outs } = exec(G.newState(),
    'git init', 'git add a', 'git commit -m "A"',
    'git switch -c dev', 'git merge main');
  ok(/已经是最新/.test(outs[4]), '无需合并时提示');
}

console.log('— 布局不重叠 —');
{
  let { s } = exec(G.newState(),
    'git init', 'git add a', 'git commit -m "A"',
    'git switch -c dev', 'git add b', 'git commit -m "B"',
    'git switch main', 'git add c', 'git commit -m "C"',
    'git merge dev');
  const L = G.layout(s);
  const keys = L.nodes.map(n => n.lane + ':' + n.y);
  ok(new Set(keys).size === keys.length, '节点位置唯一');
  ok(L.edges.every(e => e.from && e.to), '边两端都存在');
  ok(L.nodes.filter(n => n.labels.length).length >= 1, '有分支标签');
}

console.log('— 关卡 1 —');
{
  let { s } = exec(G.newState(), 'git init', 'git add app.js', 'git commit -m "初始化"', 'git branch dev');
  ok(G.LEVELS[0].check(s), '关卡1 通过');
  let { s: s0 } = exec(G.newState(), 'git init');
  ok(!G.LEVELS[0].check(s0), '关卡1 初始不通过');
}

console.log('— 关卡 3 样例走通 —');
{
  let { s } = exec(G.newState(),
    'git init', 'git add app.js', 'git commit -m "初始化"', 'git branch dev',
    'git switch dev', 'git add feature.js', 'git commit -m "加功能"',
    'git switch main', 'git merge dev');
  ok(G.LEVELS[2].check(s), '关卡3 通过');
  ok(!G.LEVELS[1].check(s), '关卡2 在快进后失效（预期）');
}

console.log('— 未知命令 —');
{
  const r = G.run(G.newState(), 'git rebase main');
  ok(/暂不支持/.test(r.out), '未知命令给出提示');
}

console.log('— 确定性哈希 —');
{
  const a = G.newState(), b = G.newState();
  const r1 = G.run(a, 'git init');
  const r2 = G.run(r1.state, 'git add x');
  const c1 = G.run(r2.state, 'git commit -m "x"');
  ok(/^[0-9a-f]{7}$/.test(c1.state.commits[0].id), '哈希为 7 位十六进制');
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
