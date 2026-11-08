/* 今词 app.js —— 界面状态机 */
(function () {
  'use strict';
  var C = window.WordleCore, W = window.WordList;
  var MAX_ROWS = 6;
  var MODES = {
    daily: { label: '每日挑战', turns: 6, hintLimit: 2 },
    practice: { label: '自由练习', turns: 8, hintLimit: 3 }
  };
  var LS = 'jinzi.v1';

  /* ---------------- 存储 ---------------- */
  function loadStore() {
    var def = { stats: { played: 0, wins: 0, streak: 0, best: 0, hist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 } }, daily: {}, lastDaily: null, results: [] };
    try {
      var raw = localStorage.getItem(LS);
      if (!raw) return def;
      var s = JSON.parse(raw);
      s.stats = Object.assign(def.stats, s.stats || {});
      s.stats.hist = Object.assign(def.stats.hist, (s.stats && s.stats.hist) || {});
      s.daily = s.daily || {};
      s.results = s.results || [];
      return s;
    } catch (e) { return def; }
  }
  function saveStore() { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) {} }
  var store = loadStore();

  /* ---------------- 日期 & 每日答案 ---------------- */
  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayNumber() {
    // 从 2026-11-09 起算
    var start = Date.UTC(2026, 10, 9);
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((today - start) / 86400000) + 1;
  }
  function dailyAnswer() {
    var key = dateKey();
    if (store.daily[key]) return store.daily[key];
    // 用日期做种子，保证同一天所有人拿到的题一致
    var rng = C.makeRng(hashStr(dateKey() + '|jinzi'));
    var ans = W.ANSWERS[Math.floor(rng() * W.ANSWERS.length)];
    store.daily[key] = ans;
    // 清掉 3 天前的缓存
    var keys = Object.keys(store.daily).sort();
    while (keys.length > 5) delete store.daily[keys.shift()];
    saveStore();
    return ans;
  }
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  /* ---------------- 状态 ---------------- */
  var S = {
    mode: 'daily',
    hard: false,
    answer: '',
    rows: [],       // {guess, states}
    cur: '',
    over: false,
    turns: 6,
    hintsLeft: 2,
    hintWord: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var board = $('board'), kb = $('keyboard'), overlay = $('overlay'), card = $('card');

  /* ---------------- 新局 ---------------- */
  function newGame(opts) {
    opts = opts || {};
    S.mode = opts.mode || S.mode;
    S.hard = opts.hard === undefined ? S.hard : opts.hard;
    S.turns = MODES[S.mode].turns;
    S.hintsLeft = MODES[S.mode].hintLimit;
    S.answer = S.mode === 'daily' ? dailyAnswer() : W.ANSWERS[Math.floor(Math.random() * W.ANSWERS.length)];
    S.rows = []; S.cur = ''; S.over = false; S.hintWord = null;
    renderAll();
    closeOverlay();
    showToast(S.mode === 'daily' ? '第 ' + dayNumber() + ' 天 · 今日题目已就位' : '自由练习开始');
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    renderBoard(); renderKeyboard(); renderSub();
    $('chipDaily').classList.toggle('on', S.mode === 'daily');
    $('chipPractice').classList.toggle('on', S.mode === 'practice');
    $('chipHard').classList.toggle('on', S.hard);
  }

  function renderBoard() {
    board.innerHTML = '';
    board.style.gridTemplateRows = 'repeat(' + S.turns + ',1fr)';
    board.style.aspectRatio = '5/' + S.turns;
    for (var r = 0; r < S.turns; r++) {
      var row = document.createElement('div');
      row.className = 'row';
      var data = S.rows[r];
      var text = data ? data.guess : (r === S.rows.length ? S.cur : '');
      for (var c = 0; c < 5; c++) {
        var t = document.createElement('div');
        t.className = 'tile';
        if (text[c]) { t.textContent = text[c]; t.classList.add('filled'); }
        if (data) {
          var st = data.states[c];
          t.classList.add(['absent', 'present', 'correct'][st]);
          if (r === S.rows.length - 1 && lastAnimatedRow !== r) t.classList.add('flip');
        }
        row.appendChild(t);
      }
      board.appendChild(row);
    }
  }
  var lastAnimatedRow = -1;

  var ROWS_KB = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function renderKeyboard() {
    var st = C.keyboardStates(S.rows);
    kb.innerHTML = '';
    ROWS_KB.forEach(function (letters, i) {
      var row = document.createElement('div'); row.className = 'krow';
      if (i === 2) row.appendChild(mkKey('↵', 'enter'));
      for (var j = 0; j < letters.length; j++) {
        var k = mkKey(letters[j], letters[j]);
        var s = st[letters[j]];
        if (s !== undefined) k.classList.add(['absent', 'present', 'correct'][s]);
        row.appendChild(k);
      }
      if (i === 2) row.appendChild(mkKey('⌫', 'back'));
      kb.appendChild(row);
    });
  }
  function mkKey(label, action) {
    var b = document.createElement('button');
    b.className = 'key' + (action.length > 1 ? ' wide' : '');
    b.textContent = label;
    b.dataset.act = action;
    b.addEventListener('click', function () { onKey(action); });
    return b;
  }
  function renderSub() {
    var used = S.rows.length;
    $('subLeft').textContent = S.over
      ? (S.rows[S.rows.length - 1] && C.isWin(S.rows[S.rows.length - 1].states) ? '已猜中 🎉' : '本局结束')
      : '第 ' + (used + 1) + ' / ' + S.turns + ' 次 · 提示剩 ' + S.hintsLeft;
    $('subHard').style.visibility = S.hard ? 'visible' : 'hidden';
  }

  /* ---------------- 输入 ---------------- */
  function onKey(k) {
    if (S.over) return;
    if (k === 'enter') return submit();
    if (k === 'back') return backspace();
    if (/^[a-z]$/.test(k) && S.cur.length < 5) {
      S.cur += k;
      paintCurrent();
    }
  }
  function paintCurrent() {
    var rows = board.children;
    var row = rows[S.rows.length];
    if (!row) return;
    for (var c = 0; c < 5; c++) {
      var t = row.children[c];
      if (S.cur[c]) { t.textContent = S.cur[c]; if (!t.classList.contains('filled')) t.classList.add('filled'); }
      else { t.textContent = ''; t.classList.remove('filled'); }
    }
    renderSub();
  }
  function backspace() {
    if (!S.cur) return;
    S.cur = S.cur.slice(0, -1);
    paintCurrent();
  }

  function shake() {
    var row = board.children[S.rows.length];
    if (!row) return;
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  function submit() {
    var g = S.cur;
    if (g.length < 5) { showToast('再输入 ' + (5 - g.length) + ' 个字母'); shake(); return; }
    if (!W.SET.has(g)) { showToast('词库里没有 "' + g.toUpperCase() + '"'); shake(); return; }
    if (S.hard && S.rows.length) {
      var v = C.hardModeViolation(g, S.rows);
      if (v) { showToast('困难模式：' + v); shake(); return; }
    }
    var states = C.scoreGuess(g, S.answer);
    S.rows.push({ guess: g, states: states });
    S.cur = '';
    S.hintWord = null;
    $('hintbar').textContent = '';
    lastAnimatedRow = -1;
    var targetRow = S.rows.length - 1;
    renderBoard();
    // 差时翻转动画
    var rowEl = board.children[targetRow];
    for (var i = 0; i < 5; i++) {
      (function (tile, delay) {
        tile.classList.remove('flip');
        tile.style.animationDelay = delay + 'ms';
        void tile.offsetWidth;
        tile.classList.add('flip');
      })(rowEl.children[i], i * 110);
    }
    var win = C.isWin(states);
    if (win) {
      setTimeout(function () {
        for (var i = 0; i < 5; i++) rowEl.children[i].classList.add('win');
        endGame(true);
      }, 620);
    } else if (S.rows.length >= S.turns) {
      setTimeout(function () { endGame(false); }, 620);
    }
    renderKeyboard(); renderSub();
    live(win ? '猜中了！' : '');
  }

  function live(msg) {
    if (msg) $('live').textContent = msg;
  }

  /* ---------------- 结算 ---------------- */
  function endGame(win) {
    if (S.over) return;
    S.over = true;
    var turns = S.rows.length;
    // 统计（每日挑战才算进战绩，练习不计连击但计入总场次？——练习单独计）
    if (S.mode === 'daily') {
      var st = store.stats;
      st.played++; if (win) { st.wins++; st.streak++; if (st.streak > st.best) st.best = st.streak; } else st.streak = 0;
      var k = String(Math.min(turns, 8));
      st.hist[k] = (st.hist[k] || 0) + 1;
      store.lastDaily = dateKey();
      saveStore();
    }
    store.results.unshift({ date: dateKey(), mode: S.mode, hard: S.hard, word: S.answer, win: win, turns: turns, rows: S.rows.map(function (r) { return { g: r.guess, s: r.states.join('') }; }) });
    store.results = store.results.slice(0, 30);
    saveStore();
    renderSub();
    showResult(win);
  }

  function showResult(win) {
    var st = store.stats;
    var html = '';
    html += '<h2>' + (win ? '🎉 ' + turnsText(S.rows.length) : '😵 差一点') + '</h2>';
    html += '<p>' + (S.mode === 'daily' ? '每日挑战 · 第 ' + dayNumber() + ' 天' : '自由练习') + (S.hard ? ' · 困难模式' : '') + '</p>';
    html += '<div class="answer">' + S.answer.toUpperCase() + '</div>';
    if (S.mode === 'daily') {
      html += '<div class="stats">' +
        '<div class="stat"><b>' + st.played + '</b><span>场次</span></div>' +
        '<div class="stat"><b>' + pct(st.played ? st.wins / st.played : 0) + '</b><span>胜率</span></div>' +
        '<div class="stat"><b>' + st.streak + '</b><span>连胜</span></div>' +
        '<div class="stat"><b>' + st.best + '</b><span>最高连胜</span></div>' +
        '</div>';
      html += '<div class="dist">';
      var max = 1;
      for (var i = 1; i <= 8; i++) max = Math.max(max, st.hist[i] || 0);
      for (var n = 1; n <= 8; n++) {
        var v = st.hist[n] || 0;
        var w = Math.max(6, Math.round(v / max * 100));
        var me = win && n === S.rows.length ? ' me' : '';
        html += '<div class="d"><span style="width:8px">' + n + '</span><div class="bar' + (v ? '' : ' zero') + me + '" style="width:' + w + '%">' + v + '</div></div>';
      }
      html += '</div>';
    } else {
      html += '<p>练习局不记入连胜。猜了 <b style="color:#e7e9ee">' + S.rows.length + '</b> 次' + (win ? '，漂亮。' : '。') + '</p>';
    }
    html += '<p style="font-size:12px">本局路线：' + S.rows.map(function (r) {
      var cls = r.states.map(function (s) { return ['absent', 'present', 'correct'][s]; });
      return '<span class="tl" style="display:inline-flex;margin:0 6px 0 0;vertical-align:middle">' +
        r.guess.split('').map(function (ch, i) { return '<span class="c ' + cls[i] + '"></span>'; }).join('') +
        '</span>';
    }).join('') + '</p>';
    html += '<div class="acts">';
    if (S.mode === 'daily') {
      html += '<button class="primary" onclick="Jinzi.toPractice()">再来一局（练习）</button>';
      html += '<button onclick="Jinzi.share()">复制战绩</button>';
    } else {
      html += '<button class="primary" onclick="Jinzi.again()">再来一局</button>';
      html += '<button onclick="Jinzi.share()">复制战绩</button>';
    }
    html += '</div>';
    card.innerHTML = html;
    overlay.classList.add('show');
  }
  function turnsText(n) { return n === 1 ? '一发入魂！' : n <= 3 ? n + ' 次猜中，很稳' : n + ' 次猜中'; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  /* ---------------- 提示（AI） ---------------- */
  function showHint() {
    if (S.over) return;
    if (S.hintsLeft <= 0) { showToast('提示用完了'); return; }
    var r = C.suggest(W.ANSWERS, W.ALL_GUESSES, S.rows);
    if (!r.word) { showToast(r.reason); return; }
    S.hintsLeft--;
    S.hintWord = r.word;
    $('hintbar').innerHTML = 'AI 建议：<b>' + r.word.toUpperCase() + '</b> · 剩余候选 ' + r.candidates;
    renderSub();
  }

  /* ---------------- 分享 ---------------- */
  function share() {
    var emo = { 0: '⬛', 1: '🟨', 2: '🟩' };
    var head = S.mode === 'daily'
      ? '今词 #' + dayNumber() + ' ' + (S.over && C.isWin(S.rows[S.rows.length - 1].states) ? S.rows.length + '/' + S.turns : 'X/' + S.turns) + (S.hard ? ' *困难' : '')
      : '今词 · 练习 ' + (S.rows.length) + '次';
    var body = S.rows.map(function (r) { return r.states.map(function (s) { return emo[s]; }).join(''); }).join('\n');
    var text = head + '\n' + body + '\njiangyuxin.top/daily-fun-things';
    copy(text);
    showToast('战绩已复制，去粘到聊天里吧');
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---------------- 其它 UI ---------------- */
  var toastTimer;
  function showToast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }
  function closeOverlay() { overlay.classList.remove('show'); }

  function showHelp() {
    card.innerHTML = '<h2>怎么玩</h2>' +
      '<p>用 6 次机会猜出 5 个字母的英文单词。每猜一次，格子会变色：</p>' +
      '<p><span class="chip" style="color:#cfd4de">⬛ 灰</span> 这个词里没有这个字母<br>' +
      '<span class="chip" style="color:#e0b83a">🟨 黄</span> 有，但位置不对<br>' +
      '<span class="chip" style="color:#4fd08a">🟩 绿</span> 位置完全正确</p>' +
      '<p>字母重复时按真实数量算：答案里只有一个 E，你猜了两个 E，只有一个会变黄。</p>' +
      '<p><b style="color:#e7e9ee">每日挑战</b>：一天一题，所有人一样，记录连胜。<br>' +
      '<b style="color:#e7e9ee">自由练习</b>：随机出题，8 次机会。<br>' +
      '<b style="color:#e7e9ee">困难模式</b>：已确认的字母必须用上。</p>' +
      '<p style="font-size:12px">💡 提示按钮会用 AI（信息熵最小化）在词库里算出下一个「最能缩小范围」的词。提示不消耗猜词次数，但有次数上限。</p>' +
      '<div class="acts"><button class="primary" onclick="Jinzi.close()">知道了</button></div>';
    overlay.classList.add('show');
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('keydown', function (e) {
    if (overlay.classList.contains('show')) {
      if (e.key === 'Escape') closeOverlay();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); onKey('enter'); }
    else if (e.key === 'Backspace') { e.preventDefault(); onKey('back'); }
    else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
  });

  $('btnHint').addEventListener('click', showHint);
  $('btnHelp').addEventListener('click', showHelp);
  $('btnStats').addEventListener('click', function () { showResult(S.rows.length ? C.isWin(S.rows[S.rows.length - 1].states) : false); });
  $('chipDaily').addEventListener('click', function () {
    if (S.mode === 'daily' && S.rows.length === 0) return;
    var done = store.lastDaily === dateKey();
    newGame({ mode: 'daily' });
    if (done) showToast('今天已经玩过，重新挑战一次');
  });
  $('chipPractice').addEventListener('click', function () { newGame({ mode: 'practice' }); });
  $('chipHard').addEventListener('click', function () {
    if (S.rows.length > 0) { showToast('困难模式只能在新局开启'); return; }
    S.hard = !S.hard; renderAll();
  });

  /* ---------------- 对外 API（卡片按钮用） ---------------- */
  window.Jinzi = {
    again: function () { newGame({ mode: S.mode }); },
    toPractice: function () { newGame({ mode: 'practice' }); },
    close: closeOverlay,
    share: share,
    // 供测试
    _state: function () { return S; },
    _newGame: newGame,
    _onKey: onKey,
    _submit: submit,
    _setCur: function (w) { S.cur = w; paintCurrent(); },
    _dateKey: dateKey,
    _dayNumber: dayNumber
  };

  /* ---------------- 启动 ---------------- */
  var params = new URLSearchParams(location.search);
  if (params.get('mode') === 'practice') S.mode = 'practice';
  newGame({ mode: S.mode, hard: params.get('hard') === '1' });
  if (store.lastDaily === dateKey()) {
    setTimeout(function () { showToast('今天已经挑战过啦，点「自由练习」继续玩'); }, 900);
  }
})();
