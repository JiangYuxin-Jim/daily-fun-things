/* 2048 核心引擎 · 浏览器 / Node 通用
 * 设计要点：
 *  - 纯函数式 move(board, dir) 返回 { board, score, moved, merged }，不碰 DOM，便于测试
 *  - 棋盘用一维数组长度 size*size，0 表示空格
 *  - 随机数可注入（rng），测试时用确定性种子
 *  - AI 提示用「期望值贪心 + 角落权重」评分，不是玄学
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Game2048 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 4;
  var DIRS = { left: 0, right: 1, up: 2, down: 3 };

  function createBoard(size) {
    size = size || SIZE;
    var b = new Array(size * size);
    for (var i = 0; i < b.length; i++) b[i] = 0;
    return b;
  }

  function cloneBoard(b) { return b.slice(); }

  /* 把一行（长度为 size 的数组）向左合并
   * 返回 { line, gained, mergedAt: [索引...] }  —— mergedAt 用于动画/高亮
   */
  function slideLine(line) {
    var vals = [], mergedFlags = [];
    for (var i = 0; i < line.length; i++) {
      if (line[i] !== 0) { vals.push(line[i]); mergedFlags.push(false); }
    }
    var out = [], gained = 0, mergedPos = [];
    for (var j = 0; j < vals.length; j++) {
      if (j + 1 < vals.length && vals[j] === vals[j + 1]) {
        var v = vals[j] * 2;
        mergedPos.push(out.length);
        out.push(v);
        gained += v;
        j++; // 跳过被合并的
      } else {
        out.push(vals[j]);
      }
    }
    while (out.length < line.length) out.push(0);
    return { line: out, gained: gained, mergedPos: mergedPos };
  }

  // 取棋盘第 row 行 / 第 col 列（按行方向从左到右读）
  function getRow(b, size, r) {
    var out = [];
    for (var c = 0; c < size; c++) out.push(b[r * size + c]);
    return out;
  }
  function getCol(b, size, c) {
    var out = [];
    for (var r = 0; r < size; r++) out.push(b[r * size + c]);
    return out;
  }
  function setRow(b, size, r, line) {
    for (var c = 0; c < size; c++) b[r * size + c] = line[c];
  }
  function setCol(b, size, c, line) {
    for (var r = 0; r < size; r++) b[r * size + c] = line[r];
  }

  /* 移动一步。dir: 'left'|'right'|'up'|'down'
   * 实现方式：统一转换成「向左滑」，右侧/下侧先反转再滑
   */
  function move(board, dir, size) {
    size = size || Math.round(Math.sqrt(board.length));
    var b = cloneBoard(board);
    var score = 0, moved = false, merged = []; // merged 记录合并后位置的棋盘索引

    var horizontal = (dir === 'left' || dir === 'right');
    var reverse = (dir === 'right' || dir === 'down');

    for (var k = 0; k < size; k++) {
      var line = horizontal ? getRow(b, size, k) : getCol(b, size, k);
      if (reverse) line.reverse();
      var res = slideLine(line);
      if (reverse) res.line.reverse();
      if (reverse) {
        // 反转后 mergedPos 也要映射回原方向
        res.mergedPos = res.mergedPos.map(function (p) { return size - 1 - p; }).sort(function (a, b2) { return a - b2; });
      }
      for (var c = 0; c < size; c++) {
        var idx = horizontal ? (k * size + c) : (c * size + k);
        if (b[idx] !== res.line[c]) moved = true;
      }
      res.mergedPos.forEach(function (p) {
        merged.push(horizontal ? (k * size + p) : (p * size + k));
      });
      if (horizontal) setRow(b, size, k, res.line); else setCol(b, size, k, res.line);
      score += res.gained;
    }
    return { board: b, score: score, moved: moved, merged: merged };
  }

  function emptyCells(board) {
    var out = [];
    for (var i = 0; i < board.length; i++) if (board[i] === 0) out.push(i);
    return out;
  }

  // 在随机空格放一个新块（90% 是 2，10% 是 4）
  // 注意：会原地修改 board，调用方需自行决定是否先复制
  function spawn(board, rng) {
    rng = rng || Math.random;
    var empties = emptyCells(board);
    if (!empties.length) return null;
    var idx = empties[Math.floor(rng() * empties.length)];
    board[idx] = rng() < 0.9 ? 2 : 4;
    return idx;
  }

  function canMove(board, size) {
    size = size || Math.round(Math.sqrt(board.length));
    if (emptyCells(board).length) return true;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var v = board[r * size + c];
        if (c + 1 < size && board[r * size + c + 1] === v) return true;
        if (r + 1 < size && board[(r + 1) * size + c] === v) return true;
      }
    }
    return false;
  }

  function hasWon(board, target) {
    target = target || 2048;
    for (var i = 0; i < board.length; i++) if (board[i] >= target) return true;
    return false;
  }

  function maxTile(board) {
    var m = 0;
    for (var i = 0; i < board.length; i++) if (board[i] > m) m = board[i];
    return m;
  }

  /* ---------- 启发式评估（AI 提示用） ----------
   * 评分 = 空格数 * 空权重
   *      + 单调性（行列保持递增/递减越多越好）
   *      + 平滑度（相邻块差越小越好）
   *      + 最大块在角落的奖励
   */
  var W = { empty: 210, mono: 45, smooth: 12, maxCorner: 400, lost: 900000 };

  function evaluate(b, size) {
    var empties = 0, smooth = 0, mono = 0;
    for (var i = 0; i < b.length; i++) if (b[i] === 0) empties++;
    // 死局重罚：没有空格且无可合并 → 直接判死
    if (empties === 0 && !canMove(b, size)) return -W.lost;

    function log2(v) { return v > 0 ? Math.log(v) / Math.LN2 : 0; }

    // 平滑度
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var v = b[r * size + c];
        if (!v) continue;
        if (c + 1 < size && b[r * size + c + 1]) smooth -= Math.abs(log2(v) - log2(b[r * size + c + 1]));
        if (r + 1 < size && b[(r + 1) * size + c]) smooth -= Math.abs(log2(v) - log2(b[(r + 1) * size + c]));
      }
    }
    // 单调性
    for (var r2 = 0; r2 < size; r2++) {
      var inc = 0, dec = 0;
      for (var c2 = 1; c2 < size; c2++) {
        var a = log2(b[r2 * size + c2 - 1]), bb = log2(b[r2 * size + c2]);
        if (a > bb) dec += bb - a; else inc += a - bb;
      }
      mono += Math.max(inc, dec);
    }
    for (var c3 = 0; c3 < size; c3++) {
      var inc2 = 0, dec2 = 0;
      for (var r3 = 1; r3 < size; r3++) {
        var a2 = log2(b[(r3 - 1) * size + c3]), b3 = log2(b[r3 * size + c3]);
        if (a2 > b3) dec2 += b3 - a2; else inc2 += a2 - b3;
      }
      mono += Math.max(inc2, dec2);
    }
    // 最大块贴角
    var mx = maxTile(b);
    var corners = [b[0], b[size - 1], b[(size - 1) * size], b[b.length - 1]];
    var cornerBonus = corners.indexOf(mx) >= 0 ? W.maxCorner : 0;

    return W.empty * empties + W.mono * mono + W.smooth * smooth + cornerBonus;
  }

  /* 一步前瞻：对每个合法方向试走，取评估值最高的方向 */
  var LEVELS = { left: 0, right: 1, up: 2, down: 3 };
  function bestMove(board, size, rng) {
    size = size || Math.round(Math.sqrt(board.length));
    var best = null, bestScore = -Infinity, detail = [];
    for (var d in LEVELS) {
      var res = move(board, d, size);
      if (!res.moved) { detail.push({ dir: d, score: null, gain: 0, note: '无效' }); continue; }
      // 1-ply 期望值：按概率（90% 出 2 / 10% 出 4）抽样每个空格评估
      var emps = emptyCells(res.board);
      var total = 0, n = 0;
      var trial = emps.slice(0, 12); // 限制宽度控制计算量
      for (var t = 0; t < trial.length; t++) {
        var p = 1 / Math.max(1, trial.length);
        var tb = res.board.slice();
        tb[trial[t]] = 2; total += evaluate(tb, size) * 0.9 * p;
        tb[trial[t]] = 4; total += evaluate(tb, size) * 0.1 * p;
        n += p;
      }
      var sc = n ? total / n : evaluate(res.board, size);
      sc += res.score * 1.2; // 合并收益也算分
      detail.push({ dir: d, score: Math.round(sc), gain: res.score, note: '' });
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    detail.sort(function (x, y) { return (y.score === null ? -Infinity : y.score) - (x.score === null ? -Infinity : x.score); });
    return { dir: best, score: bestScore, detail: detail };
  }

  /* 确定性伪随机（测试用），mulberry32 */
  function seededRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    SIZE: SIZE, DIRS: DIRS,
    createBoard: createBoard, cloneBoard: cloneBoard,
    slideLine: slideLine, move: move,
    emptyCells: emptyCells, spawn: spawn,
    canMove: canMove, hasWon: hasWon, maxTile: maxTile,
    evaluate: evaluate, bestMove: bestMove, seededRng: seededRng
  };
});
