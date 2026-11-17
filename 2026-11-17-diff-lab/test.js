// diff-lab 自检：一次性跑完所有断言
const D = require('./engine.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('✗ ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + `  (得到 ${JSON.stringify(a)}, 期望 ${JSON.stringify(b)})`); }

// ---- 1. 基本差分 ----
{
  const ops = D.diff(['a', 'b', 'c'], ['a', 'x', 'c']);
  const s = D.stats(ops);
  ok(s.ins === 1 && s.del === 1, '一处替换 = 1 增 1 删');
}

// ---- 2. 纯新增 / 纯删除 / 空 ----
{
  let s = D.stats(D.diff([], ['a', 'b']));
  ok(s.ins === 2 && s.del === 0, '纯新增');
  s = D.stats(D.diff(['a', 'b'], []));
  ok(s.del === 2 && s.ins === 0, '纯删除');
  eq(D.diff([], []), [], '两者都空');
}

// ---- 3. 完全相同 ----
{
  const ops = D.diff([1, 2, 3], [1, 2, 3]);
  ok(ops.every(o => o.type === 'eq') && ops.length === 3, '完全相同只出 eq');
  ok(D.summarize('x\ny', 'x\ny').verdict === '完全一样', '摘要判定完全一样');
}

// ---- 4. 编辑脚本可重放（这是最硬的正确性保证） ----
function replay(ops, A, B) {
  // 从脚本还原 A 和 B，必须与原文逐项相等
  const ra = [], rb = [];
  for (const o of ops) {
    if (o.type === 'eq' || o.type === 'del') ra.push(A[o.a]);
    if (o.type === 'eq' || o.type === 'ins') rb.push(B[o.b]);
  }
  return JSON.stringify(ra) === JSON.stringify(A) && JSON.stringify(rb) === JSON.stringify(B);
}
function rnd(n) {
  const chars = 'abcd';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.split('');
}
let replayOk = 0, lcsOk = 0, ROUNDS = 300;
let totalOps = 0;
for (let t = 0; t < ROUNDS; t++) {
  const A = rnd(Math.floor(Math.random() * 14));
  const B = rnd(Math.floor(Math.random() * 14));
  const ops = D.diff(A, B);
  if (replay(ops, A, B)) replayOk++;
  totalOps += ops.length;
  // 对比 DP 求 LCS 长度，Myers 的 eq 数必须等于 LCS
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  if (D.stats(ops).eq === dp[n][m]) lcsOk++;
}
ok(replayOk === ROUNDS, `编辑脚本可重放 ${replayOk}/${ROUNDS} 轮`);
ok(lcsOk === ROUNDS, `最短编辑路径（eq 数 = LCS）${lcsOk}/${ROUNDS} 轮`);

// ---- 5. 中文切词：英文按词、中文逐字 ----
{
  eq(D.tokenizeChars('我爱AI和 code'), ['我', '爱', 'AI', '和', ' ', 'code'], '中英混排切分');
  const inl = D.inlineDiff('今天天气真好', '今天天气很好');
  const del = inl.filter(x => x.type === 'del').map(x => x.text).join('');
  const ins = inl.filter(x => x.type === 'ins').map(x => x.text).join('');
  eq(del, '真', '行内删除只标"真"');
  eq(ins, '很', '行内新增只标"很"');
}

// ---- 6. 行级 + 摘要 ----
{
  const a = '第一行\n第二行\n第三行';
  const b = '第一行\n第二行改\n第三行\n第四行';
  const s = D.summarize(a, b);
  ok(s.oldLines === 3 && s.newLines === 4, '行数统计');
  ok(s.similarity > 0 && s.similarity < 100, '相似度介于 0-100');
  ok(s.verdict.length > 0, '有中文判定');
}

// ---- 7. 并排视图配对 ----
{
  const ops = D.diff(['a', 'b'], ['a', 'x']);
  const rows = D.toSideBySide(ops);
  ok(rows.some(r => r.type === 'mod'), '删除+新增配成一行 mod');
}

// ---- 8. 统一 diff 格式 ----
{
  const u = D.toUnified('a\nb\nc', 'a\nB\nc', 1, 'demo.txt');
  const lines = u.split('\n');
  ok(lines[0] === '--- a/demo.txt' && lines[1] === '+++ b/demo.txt', '统一 diff 头');
  ok(lines[2].startsWith('@@ -'), '有 hunk 头');
  ok(u.includes('-b') && u.includes('+B'), '统一 diff 含删增行');
  // 相同文本应没有 hunk
  ok(D.toUnified('a\nb', 'a\nb', 3).split('\n').length === 2, '相同文本无 hunk');
}

// ---- 9. 大文件性能（2000 行，改动 20 行） ----
{
  const A = [], B = [];
  for (let i = 0; i < 2000; i++) { A.push('line ' + i); B.push('line ' + i); }
  for (let i = 0; i < 20; i++) B[i * 90] = 'changed ' + i;
  const t0 = Date.now();
  const s = D.summarize(A.join('\n'), B.join('\n'));
  const ms = Date.now() - t0;
  ok(s.ins === 20 && s.del === 20, '2000 行 20 处改动统计正确');
  ok(ms < 2000, `2000 行耗时 ${ms}ms < 2000ms`);
  console.log(`  · 2000 行 / 20 处改动耗时 ${ms}ms`);
}

// ---- 10. 粗相似度 ----
{
  ok(D.roughSimilarity('hello world', 'hello world') === 1, '粗相似度 1');
  ok(D.roughSimilarity('abcdef', 'uvwxyz') === 0, '粗相似度 0');
}

console.log(`\ndiff-lab 自检：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 项）`);
process.exit(fail === 0 ? 0 : 1);
