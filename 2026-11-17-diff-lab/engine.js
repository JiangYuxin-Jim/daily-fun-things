/* diff-lab engine — 纯函数，零依赖
 * 用法：浏览器挂 window.DiffLab；Node 里 module.exports
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiffLab = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 1. 文本切分 ---------- */

  // 按行切分，保留行尾信息（用于渲染）
  function toLines(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  }

  // 按字符切分：中文逐字，英文按"词"聚块（连续字母数字下划线算一块），标点单独
  function tokenizeChars(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    let buf = '';
    const flush = () => { if (buf) { out.push(buf); buf = ''; } };
    for (const ch of s) {
      if (/[A-Za-z0-9_\u00C0-\u024F]/.test(ch)) buf += ch;
      else { flush(); out.push(ch); }
    }
    flush();
    return out;
  }

  /* ---------- 2. 核心：Myers O(ND) 差分 ---------- */
  /* 返回 edit script: [{type:'eq'|'del'|'ins', a:i|null, b:j|null}] */

  function diff(a, b) {
    const N = a.length, M = b.length;
    if (N === 0 && M === 0) return [];
    if (N === 0) return b.map((_, j) => ({ type: 'ins', a: null, b: j }));
    if (M === 0) return a.map((_, i) => ({ type: 'del', a: i, b: null }));

    const MAX = N + M;
    const off = MAX;
    const V = new Int32Array(2 * MAX + 2);
    // trace[d] = 第 d 步结束时 k ∈ [-d, d] 的 V 快照
    const trace = [];

    let found = -1;
    for (let d = 0; d <= MAX; d++) {
      trace.push(V.slice(off - d, off + d + 1)); // 长度 2d+1，下标偏移 d
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) x = V[off + k + 1];
        else x = V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
      if (found >= 0) break;
    }

    // 回溯
    const ops = [];
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const snap = trace[d];          // 第 d 步之前（即 d-1 步结束）的状态
      const get = (k) => snap[k + d]; // k ∈ [-d, d]
      const k = x - y;
      let prevK;
      if (k === -d || (k !== d && get(k - 1) < get(k + 1))) prevK = k + 1;
      else prevK = k - 1;
      const prevX = get(prevK);
      const prevY = prevX - prevK;
      // 对角线（相等）
      while (x > prevX && y > prevY) { x--; y--; ops.push({ type: 'eq', a: x, b: y }); }
      if (x === prevX) { y--; ops.push({ type: 'ins', a: null, b: y }); }
      else { x--; ops.push({ type: 'del', a: x, b: null }); }
    }
    // d === 0 剩下的全是相同
    while (x > 0 && y > 0) { x--; y--; ops.push({ type: 'eq', a: x, b: y }); }

    return ops.reverse();
  }

  /* ---------- 3. 统计 ---------- */

  function stats(ops) {
    let ins = 0, del = 0, eq = 0;
    for (const o of ops) {
      if (o.type === 'ins') ins++;
      else if (o.type === 'del') del++;
      else eq++;
    }
    const total = ins + del + eq;
    const sim = total === 0 ? 100 : (2 * eq) / (2 * eq + ins + del) * 100;
    return { ins, del, eq, total, similarity: Math.round(sim * 10) / 10 };
  }

  /* ---------- 4. 行级差分（先按行比，再可选字级细看） ---------- */

  function diffLines(oldText, newText) {
    return diff(toLines(oldText), toLines(newText));
  }

  // 行内字级差分：给渲染层用。返回 [{type, text}]
  function inlineDiff(oldLine, newLine) {
    const ops = diff(tokenizeChars(oldLine), tokenizeChars(newLine));
    const A = tokenizeChars(oldLine), B = tokenizeChars(newLine);
    return ops.map((o) => ({
      type: o.type,
      text: o.type === 'ins' ? B[o.b] : A[o.a],
    }));
  }

  /* ---------- 5. 并排/统一 视图分组 ---------- */

  // 把 op 序列分组为块：{type:'eq'|'change', rows:[{left,right,type}]}
  function toSideBySide(ops) {
    const rows = ops.map((o) => ({ type: o.type === 'eq' ? 'eq' : o.type, a: o.a, b: o.b }));
    // 把相邻的 del/ins 配对成一行显示
    const paired = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type === 'del' && rows[i + 1] && rows[i + 1].type === 'ins') {
        paired.push({ type: 'mod', a: r.a, b: rows[i + 1].b });
        i++;
      } else if (r.type === 'ins' && rows[i + 1] && rows[i + 1].type === 'del') {
        paired.push({ type: 'mod', a: rows[i + 1].a, b: r.b });
        i++;
      } else {
        paired.push(r);
      }
    }
    return paired;
  }

  /* ---------- 6. 相似度（快捷判定是否值得逐行比） ---------- */

  // 用字符 bigram 的 Dice 系数，O(n)，大文件时先粗筛
  function roughSimilarity(a, b) {
    const A = String(a), B = String(b);
    if (!A.length && !B.length) return 1;
    if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
    const m = new Map();
    for (let i = 0; i < A.length - 1; i++) {
      const g = A.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    let hit = 0;
    for (let i = 0; i < B.length - 1; i++) {
      const g = B.slice(i, i + 2);
      const c = m.get(g) || 0;
      if (c > 0) { m.set(g, c - 1); hit++; }
    }
    return (2 * hit) / (A.length - 1 + B.length - 1);
  }

  /* ---------- 7. 亮点：差异摘要 ---------- */

  function summarize(oldText, newText) {
    const s = stats(diffLines(oldText, newText));
    const ol = toLines(oldText).length, nl = toLines(newText).length;
    let verdict;
    if (s.similarity === 100) verdict = '完全一样';
    else if (s.similarity > 90) verdict = '改动很小';
    else if (s.similarity > 60) verdict = '改了不少';
    else if (s.similarity > 25) verdict = '大改';
    else verdict = '基本重写';
    return Object.assign(s, { oldLines: ol, newLines: nl, verdict });
  }

  /* ---------- 8. 统一 diff 输出（类 git 格式） ---------- */

  function toUnified(oldText, newText, ctx, prefix) {
    ctx = ctx == null ? 3 : ctx;
    const A = toLines(oldText), B = toLines(newText);
    const ops = diff(A, B);
    const out = [];
    out.push('--- a' + (prefix ? '/' + prefix : ''));
    out.push('+++ b' + (prefix ? '/' + prefix : ''));

    // 标出需要输出的行
    const keep = new Array(ops.length).fill(false);
    ops.forEach((o, i) => { if (o.type !== 'eq') { for (let d = -ctx; d <= ctx; d++) if (i + d >= 0 && i + d < ops.length) keep[i + d] = true; } });
    if (!keep.some(Boolean)) return out.join('\n');

    let i = 0;
    while (i < ops.length) {
      if (!keep[i]) { i++; continue; }
      let j = i;
      while (j < ops.length && keep[j]) j++;
      // 计算 hunk 起止行号
      let aStart = 1, bStart = 1;
      for (let t = 0; t < i; t++) { if (ops[t].type !== 'ins') aStart++; if (ops[t].type !== 'del') bStart++; }
      const body = [];
      let aCount = 0, bCount = 0;
      for (let t = i; t < j; t++) {
        const o = ops[t];
        if (o.type === 'eq') { body.push(' ' + A[o.a]); aCount++; bCount++; }
        else if (o.type === 'del') { body.push('-' + A[o.a]); aCount++; }
        else { body.push('+' + B[o.b]); bCount++; }
      }
      out.push('@@ -' + aStart + ',' + aCount + ' +' + bStart + ',' + bCount + ' @@');
      out.push(...body);
      i = j;
    }
    return out.join('\n');
  }

  return {
    toLines, tokenizeChars, diff, stats, diffLines, inlineDiff,
    toSideBySide, roughSimilarity, summarize, toUnified,
  };
});
