/*!
 * wordle 核心引擎 —— 纯函数，无 DOM / 无随机全局状态
 * 浏览器：window.WordleCore ；Node：module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ABSENT = 0, PRESENT = 1, CORRECT = 2;
  var STATE_NAME = { 0: 'absent', 1: 'present', 2: 'correct' };
  function nameToCode(n) {
    if (typeof n === 'number') return n;
    return n === 'correct' ? CORRECT : n === 'present' ? PRESENT : ABSENT;
  }

  /* ---------- 确定性随机（mulberry32） ---------- */
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 评分：两遍扫描处理重复字母 ---------- */
  function scoreGuess(guess, answer) {
    guess = String(guess).toLowerCase();
    answer = String(answer).toLowerCase();
    var n = answer.length;
    if (guess.length !== n) throw new Error('length mismatch');
    var out = new Array(n).fill(ABSENT);
    var pool = {};
    var i, k;
    for (i = 0; i < n; i++) {
      if (guess.charAt(i) === answer.charAt(i)) out[i] = CORRECT;
      else { k = answer.charAt(i); pool[k] = (pool[k] || 0) + 1; }
    }
    for (i = 0; i < n; i++) {
      if (out[i] === CORRECT) continue;
      k = guess.charAt(i);
      if (pool[k] > 0) { out[i] = PRESENT; pool[k] = pool[k] - 1; }
    }
    return out;
  }

  function isWin(states) {
    if (!states) return false;
    for (var i = 0; i < states.length; i++) if (states[i] !== CORRECT) return false;
    return states.length > 0;
  }

  function statesToCodes(states) {
    return states.map(function (s) { return nameToCode(s); });
  }

  /* ---------- 键盘字母状态聚合（优先级 correct > present > absent） ---------- */
  function keyboardStates(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      for (var i = 0; i < row.guess.length; i++) {
        var ch = row.guess[i], s = nameToCode(row.states[i]);
        if (!(ch in map) || s > map[ch]) map[ch] = s;
      }
    });
    return map;
  }

  /* ---------- 困难模式：已揭示提示必须复用 ---------- */
  function hardModeViolation(guess, rows) {
    var n = guess.length;
    var correct = {}, minCount = {};
    (rows || []).forEach(function (row) {
      var per = {};
      for (var j = 0; j < n; j++) {
        var s = nameToCode(row.states[j]);
        if (s === CORRECT) correct[j] = row.guess[j];
        if (s >= PRESENT) per[row.guess[j]] = (per[row.guess[j]] || 0) + 1;
      }
      // 单调收紧：同一字母在历史里被揭到的最大「黄+绿」总数即数量下限
      Object.keys(per).forEach(function (k) {
        minCount[k] = Math.max(minCount[k] || 0, per[k]);
      });
    });
    for (var pos in correct) {
      if (guess[+pos] !== correct[pos]) {
        return '第 ' + (+pos + 1) + ' 位必须是 ' + correct[pos].toUpperCase();
      }
    }
    for (var k in minCount) {
      var have = 0;
      for (var t = 0; t < n; t++) if (guess[t] === k) have++;
      // 某行揭到 k 的「黄+绿」共 c 个，则答案至少有 max(绿位, c) 个 k
      var need = Math.max(minCount[k] || 0, 0);
      if (have < need) {
        return '必须包含至少 ' + need + ' 个 "' + k.toUpperCase() + '"';
      }
    }
    return null;
  }

  function patternOf(guess, answer) {
    return scoreGuess(guess, answer).join('');
  }

  /* 预拆成字符码数组，避免热循环里反复 charCodeAt */
  var codeCache = Object.create(null);
  function letterCodes(w) {
    var c = codeCache[w];
    if (c) return c;
    c = new Uint8Array(5);
    for (var i = 0; i < 5; i++) c[i] = w.charCodeAt(i);
    codeCache[w] = c;
    return c;
  }

  /** 快速模式码：每格 2 bit（0灰 1黄 2绿）拼成整数，比字符串快一个量级，且可直接桶计数 */
  function patternCode(guess, answer) {
    return patternCodeSlow(letterCodes(guess), letterCodes(answer));
  }

  // 用「版本号 + 惰性清零」代替每次 fill，热路径里省掉 26 次写入
  var REM = new Int8Array(26);
  var REM_VER = new Int32Array(26);
  var REM_GEN = 1;
  var REM_INIT = false;
  function remReset() {
    if (!REM_INIT) { REM.fill(0); REM_INIT = true; REM_GEN = 1; return; }
    REM_GEN++;
    if (REM_GEN > 2000000000) { REM.fill(0); REM_VER.fill(0); REM_GEN = 1; }
  }
  function remAdd(x) { if (REM_VER[x] !== REM_GEN) { REM_VER[x] = REM_GEN; REM[x] = 0; } REM[x]++; }
  function remTake(x) { if (REM_VER[x] !== REM_GEN) { REM_VER[x] = REM_GEN; REM[x] = 0; } REM[x]--; }
  function remGet(x) { return REM_VER[x] === REM_GEN ? REM[x] : 0; }

  function patternCodeSlow(g, a) {
    remReset();
    var i, x, code = 0;
    for (i = 0; i < 5; i++) { x = a[i] - 97; if (x >= 0 && x < 26) remAdd(x); }
    // 第一遍：绿位
    for (i = 0; i < 5; i++) {
      if (g[i] === a[i]) { code |= 2 << (i * 2); x = a[i] - 97; if (x >= 0 && x < 26) remTake(x); }
    }
    // 第二遍：黄位
    for (i = 0; i < 5; i++) {
      if ((code >> (i * 2)) & 3) continue;
      x = g[i] - 97;
      if (x >= 0 && x < 26 && remGet(x) > 0) { remTake(x); code |= 1 << (i * 2); }
    }
    return code;
  }

  /** 模式码反解成状态数组（调试/展示用） */
  function codeToStates(code) {
    var out = [];
    for (var i = 0; i < 5; i++) out.push((code >> (i * 2)) & 3);
    return out;
  }

  function rowsToCodes(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var st = rows[i].states, c = 0;
      for (var j = 0; j < 5; j++) c |= nameToCode(st[j]) << (j * 2);
      out.push(c);
    }
    return out;
  }

  /* ---------- 开场词分析：把答案池按反馈分桶，桶越碎越好 ---------- */
  function rankOpening(tries, pool) {
    var res = [];
    for (var i = 0; i < tries.length; i++) {
      var g = tries[i];
      var buckets = {};
      for (var j = 0; j < pool.length; j++) {
        var p = patternOf(g, pool[j]);
        buckets[p] = (buckets[p] || 0) + 1;
      }
      var total = 0, worst = 0;
      Object.keys(buckets).forEach(function (k) {
        var c = buckets[k];
        total += c * c;
        if (c > worst) worst = c;
      });
      res.push({ word: g, avgLeft: total / pool.length, worst: worst, buckets: Object.keys(buckets).length });
    }
    res.sort(function (a, b) {
      if (a.avgLeft !== b.avgLeft) return a.avgLeft - b.avgLeft;
      return a.worst - b.worst;
    });
    return res;
  }

  /* ---------- 预计算模式矩阵（带索引版）---------
     BGM[tryIdx * A + ansIdx]，A = baseAnswers.length，只构建一次；
     候选池只存索引，熵计算时按索引查表，O(1)。 ---------- */
  var BGM = null, BG_A = 0, BG_BASE = null;
  var IDX = Object.create(null);
  function ensureMatrix(tries, baseAnswers) {
    if (BGM && BG_BASE === baseAnswers) return BGM;
    var t = tries.length, a = baseAnswers.length;
    var m = new Uint16Array(t * a);
    IDX = Object.create(null);
    var codes = new Array(baseAnswers.length);
    for (var j = 0; j < a; j++) { codes[j] = letterCodes(baseAnswers[j]); IDX[baseAnswers[j]] = j; }
    for (var i = 0; i < t; i++) {
      var g = letterCodes(tries[i]);
      var base = i * a;
      for (var k = 0; k < a; k++) m[base + k] = patternCodeSlow(g, codes[k]);
    }
    BGM = m; BG_A = a; BG_BASE = baseAnswers;
    return m;
  }

  /* ---------- 求解器：过滤 + 最小化期望剩余候选 ---------- */
  function filterCandidates(pool, rows) {
    if (!rows || !rows.length) return pool.slice();
    var codes = rowsToCodes(rows);
    return pool.filter(function (w) {
      for (var i = 0; i < rows.length; i++) {
        if (patternCode(rows[i].guess, w) !== codes[i]) return false;
      }
      return true;
    });
  }

  /* 桶计数用 Int32Array 直方图：1024 个模式码 → 计数，避免对象/字符串开销 */
  var BUCKET = new Int32Array(1024);
  function entropyPick(tries, candidates) {
    if (candidates.length <= 2) return { word: candidates[0], exp: 1 };
    var n = candidates.length;
    var bestWord = null, bestScr = Infinity, bestIsCand = false;
    var candSet = Object.create(null);
    for (var x = 0; x < n; x++) candSet[candidates[x]] = true;
    // 若候选池就是全量词库，按字母序位置建索引；否则回退到逐词计算
    var isWhole = candidates.length === tries.length;
    var mat = isWhole ? ensureMatrix(tries, candidates) : null;
    var idxs = null;
    if (mat) {
      idxs = new Int32Array(n);
      for (var q = 0; q < n; q++) idxs[q] = IDX[candidates[q]];
    }
    for (var i = 0; i < tries.length; i++) {
      var g = tries[i];
      BUCKET.fill(0);
      if (mat) {
        var base = i * BG_A;
        for (var j = 0; j < n; j++) BUCKET[mat[base + idxs[j]]]++;
      } else {
        for (var j2 = 0; j2 < n; j2++) BUCKET[patternCode(g, candidates[j2])]++;
      }
      var total = 0;
      for (var k = 0; k < 1024; k++) { var c = BUCKET[k]; if (c) total += c * c; }
      var exp = total / n;
      var isCand = candSet[g] === true;
      if (exp < bestScr - 1e-12 || (exp <= bestScr + 1e-12 && isCand && !bestIsCand)) {
        bestScr = exp; bestWord = g; bestIsCand = isCand;
      }
    }
    return { word: bestWord || candidates[0], exp: bestScr };
  }

  /** 完整对局模拟（给定真实答案），返回每轮猜词 */
  function solve(answer, tries, maxTurns) {
    maxTurns = maxTurns || 6;
    var rows = [];
    var filtered = tries;
    for (var t = 0; t < maxTurns; t++) {
      var word;
      if (t > 0) filtered = filterCandidates(filtered, [rows[rows.length - 1]]);
      if (!filtered.length) return { solved: false, turns: t, rows: rows, error: 'no candidates left' };
      word = filtered.length === 1 ? filtered[0] : entropyPick(tries, filtered).word;
      var states = scoreGuess(word, answer);
      rows.push({ guess: word, states: states });
      if (isWin(states)) return { solved: true, turns: t + 1, rows: rows };
    }
    return { solved: false, turns: maxTurns, rows: rows };
  }

  /** 玩家提示：不知道答案，只按历史反馈贪心挑信息量最大的词 */
  function suggest(pool, tries, rows) {
    var cands = filterCandidates(pool, rows || []);
    if (!cands.length) return { word: null, candidates: 0, reason: '没有匹配的词（答案可能不在词库里）' };
    if (cands.length === 1) return { word: cands[0], candidates: 1, reason: '只剩一个可能' };
    var pick = entropyPick(tries, cands);
    return { word: pick.word, candidates: cands.length, reason: '期望剩余候选 ' + pick.exp.toFixed(2) };
  }

  return {
    ABSENT: ABSENT, PRESENT: PRESENT, CORRECT: CORRECT, STATE_NAME: STATE_NAME,
    nameToCode: nameToCode,
    makeRng: makeRng,
    scoreGuess: scoreGuess,
    isWin: isWin,
    statesToCodes: statesToCodes,
    keyboardStates: keyboardStates,
    hardModeViolation: hardModeViolation,
    patternOf: patternOf,
    patternCode: patternCode,
    codeToStates: codeToStates,
    rowsToCodes: rowsToCodes,
    rankOpening: rankOpening,
    filterCandidates: filterCandidates,
    entropyPick: entropyPick,
    solve: solve,
    suggest: suggest
  };
});
