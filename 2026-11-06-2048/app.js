/* 2048 界面层：所有规则来自 core.js，这里只负责画和收输入 */
(function () {
  'use strict';
  var G = window.Game2048;
  var SIZE = 4;

  var elBoard = document.getElementById('board');
  var elTiles = document.getElementById('tiles');
  var elScore = document.getElementById('score');
  var elBest = document.getElementById('best');
  var elOverlay = document.getElementById('overlay');
  var elOvTitle = document.getElementById('ov-title');
  var elOvSub = document.getElementById('ov-sub');
  var elOvScore = document.getElementById('ov-score');
  var elOvBtn = document.getElementById('ov-btn');
  var elOvBtn2 = document.getElementById('ov-btn2');
  var elHint = document.getElementById('hint');
  var elDirbars = document.getElementById('dirbars');

  var state = {
    board: G.createBoard(SIZE),
    score: 0,
    best: Number(localStorage.getItem('2048-best') || 0),
    history: [],      // 撤销栈，存 {board, score}
    over: false,
    won: false,
    running: false,
    aiOn: false,
    moves: 0,
    tileEls: {},      // 位置索引 -> DOM 元素（为了移动动画）
  };

  /* ---------- 布局计算 ---------- */
  // .tiles 与 .board 完全重合（inset:0），board 的 padding = gap
  // 所以可用宽度 = 宽 - 2*gap，方块边长 = (可用 - 3*gap) / 4
  function cellGeom() {
    var w = elBoard.clientWidth;
    var gap = parseFloat(getComputedStyle(elBoard).gap) || parseFloat(getComputedStyle(elBoard).paddingLeft) || 0;
    var inner = w - gap * 2;
    var size = (inner - gap * (SIZE - 1)) / SIZE;
    return { size: size, gap: gap, pad: gap };
  }

  function positionTile(el, idx, geom) {
    var r = Math.floor(idx / SIZE), c = idx % SIZE;
    var step = geom.size + geom.gap;
    el.style.width = geom.size + 'px';
    el.style.height = geom.size + 'px';
    el.style.left = (geom.pad + c * step) + 'px';
    el.style.top = (geom.pad + r * step) + 'px';
    el.style.fontSize = Math.max(14, geom.size * (String(el.dataset.v).length > 3 ? 0.24 : 0.34)) + 'px';
  }

  function buildBackground() {
    elBoard.innerHTML = '';
    for (var i = 0; i < SIZE * SIZE; i++) {
      var d = document.createElement('div');
      d.className = 'bgcell';
      elBoard.appendChild(d);
    }
  }

  /* ---------- 渲染 ---------- */
  function render(mergedIdx, newIdx) {
    var geom = cellGeom();
    var seen = {};
    for (var i = 0; i < state.board.length; i++) {
      var v = state.board[i];
      if (!v) continue;
      seen[i] = true;
      var el = state.tileEls[i];
      if (!el) {
        el = document.createElement('div');
        el.dataset.v = v;
        state.tileEls[i] = el;
        elTiles.appendChild(el);
        if (i === newIdx) el.classList.add('pop');
        setTimeout(function (e) { return function () { e.classList.remove('pop'); }; }(el), 180);
      }
      el.className = 'tile ' + (v <= 2048 ? 't' + v : 'tsuper');
      el.dataset.v = v;
      el.textContent = v;
      if (mergedIdx && mergedIdx.indexOf(i) >= 0) {
        el.classList.add('merge');
        (function (e) { setTimeout(function () { e.classList.remove('merge'); }, 220); })(el);
      }
      positionTile(el, i, geom);
    }
    // 清掉已不存在的方块（理论上不会出现，保险）
    for (var k in state.tileEls) {
      if (!seen[k]) { state.tileEls[k].remove(); delete state.tileEls[k]; }
    }
    elScore.textContent = state.score;
    elBest.textContent = state.best;
  }

  function showFloat(gain) {
    var box = elScore.parentNode;
    var f = document.createElement('div');
    f.className = 'float';
    f.textContent = '+' + gain;
    box.appendChild(f);
    setTimeout(function () { f.remove(); }, 720);
  }

  /* ---------- 游戏流程 ---------- */
  function newGame() {
    state.board = G.createBoard(SIZE);
    state.score = 0; state.history = []; state.over = false; state.won = false;
    state.running = true; state.moves = 0;
    elTiles.innerHTML = ''; state.tileEls = {};
    var a = G.spawn(state.board);
    var b = G.spawn(state.board);
    render([], b);
    hideOverlay();
    updateHint();
  }

  function doMove(dir) {
    if (!state.running || state.over) return;
    var res = G.move(state.board, dir, SIZE);
    if (!res.moved) {
      // 撞墙反馈
      elHint.textContent = '这条路走不通，换个方向试试';
      if (!G.canMove(state.board)) { state.over = true; showOver(); }
      return;
    }
    state.history.push({ board: state.board.slice(), score: state.score });
    if (state.history.length > 30) state.history.shift();

    state.board = res.board;
    state.score += res.score;
    state.moves++;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('2048-best', String(state.best));
    }
    if (res.score) showFloat(res.score);

    // 先渲染移动结果，再生成新块（canvas-free 动画：left/top 有 transition）
    render(res.merged);
    if (!state.won && G.hasWon(state.board, 2048)) {
      state.won = true;
      showWin();
      return;
    }
    var ni = G.spawn(state.board);
    render(res.merged, ni);

    if (!G.canMove(state.board)) {
      state.over = true;
      showOver();
    }
    updateHint();
  }

  function showWin() {
    elOvTitle.textContent = '2048 达成！';
    elOvSub.textContent = '继续挑战 4096 / 8192，或者开新局';
    elOvScore.style.display = 'block';
    elOvScore.textContent = state.score;
    elOvBtn.textContent = '新游戏';
    elOvBtn2.style.display = '';
    elOvBtn2.textContent = '继续玩';
    elOverlay.classList.add('show');
  }

  function showOver() {
    elOvTitle.textContent = '游戏结束';
    var maxT = G.maxTile(state.board);
    elOvSub.textContent = state.moves + ' 步 · 最大方块 ' + maxT;
    elOvScore.style.display = 'block';
    elOvScore.textContent = state.score;
    elOvBtn.textContent = '再来一局';
    elOvBtn2.style.display = 'none';
    elOverlay.classList.add('show');
    clearDirbars();
  }

  function hideOverlay() { elOverlay.classList.remove('show'); }

  var HINTS = [
    '把最大的数字钉在一个角落，别让它乱跑',
    '保持一行数字递减，给未来留出合并空间',
    '空格比大数字更值钱——别把棋盘塞满',
    '同一方向连续走，比来回换方向更容易叠出大块',
    '满盘前先想好下一步，别等没路了才想'
  ];
  function updateHint() {
    if (state.aiOn) return updateAi();
    var empty = G.emptyCells(state.board).length;
    if (empty >= 10) elHint.innerHTML = HINTS[state.moves % HINTS.length];
    else if (empty >= 5) elHint.innerHTML = '剩 ' + empty + ' 个空格，开始小心了';
    else elHint.innerHTML = '⚠️ 只剩 ' + empty + ' 个空格';
  }

  /* ---------- AI 提示 ---------- */
  var ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };
  function updateAi() {
    var m = G.bestMove(state.board, SIZE);
    if (!m.dir) { elHint.innerHTML = '没有可走的步了'; clearDirbars(); return; }
    elHint.innerHTML = 'AI 建议：<span class="arrow">' + ARROWS[m.dir] + '</span> 再按一次「提示」可关闭';
    // 方向条：显示每个方向的相对评分
    var valid = m.detail.filter(function (d) { return d.score !== null; });
    var max = Math.max.apply(null, valid.map(function (d) { return d.score; }));
    var min = Math.min.apply(null, valid.map(function (d) { return d.score; }));
    elDirbars.innerHTML = '';
    m.detail.forEach(function (d) {
      if (d.score === null) return;
      var pct = max === min ? 100 : Math.round(30 + 70 * (d.score - min) / (max - min));
      var bar = document.createElement('div');
      bar.className = 'dirbar';
      bar.textContent = ARROWS[d.dir] + ' ' + pct;
      // 四个方向标在棋盘四角，不挡方块也不压按钮
      if (d.dir === 'left')  { bar.style.left = '6px'; bar.style.top = '4px'; }
      if (d.dir === 'right') { bar.style.right = '6px'; bar.style.top = '4px'; }
      if (d.dir === 'up')    { bar.style.left = '50%'; bar.style.top = '4px'; bar.style.transform = 'translateX(-50%)'; }
      if (d.dir === 'down')  { bar.style.left = '50%'; bar.style.bottom = '4px'; bar.style.transform = 'translateX(-50%)'; }
      elDirbars.appendChild(bar);
    });
  }
  function clearDirbars() { elDirbars.innerHTML = ''; }

  /* ---------- 输入 ---------- */
  var KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
    A: 'left', D: 'right', W: 'up', S: 'down',
    h: 'left', l: 'right', k: 'up', j: 'down'
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'r' || e.key === 'R') { newGame(); return; }
    if (e.key === 'u' || e.key === 'U') { undo(); return; }
    var dir = KEYMAP[e.key];
    if (!dir) return;
    e.preventDefault();
    doMove(dir);
  });

  // 触摸滑动
  var touch = null;
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!touch) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 'right' : 'left');
    else doMove(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  function undo() {
    if (!state.history.length) { elHint.textContent = '没有可撤销的步数了'; return; }
    var prev = state.history.pop();
    state.board = prev.board;
    state.score = prev.score;
    state.over = false; state.running = true;
    elTiles.innerHTML = ''; state.tileEls = {};
    render();
    hideOverlay();
    updateHint();
  }

  /* ---------- 按钮 ---------- */
  document.getElementById('new').onclick = newGame;
  document.getElementById('undo').onclick = undo;
  document.getElementById('ai').onclick = function () {
    state.aiOn = !state.aiOn;
    this.classList.toggle('on', state.aiOn);
    if (!state.aiOn) { clearDirbars(); updateHint(); } else updateHint();
  };
  elOvBtn.onclick = function () {
    if (elOvBtn.textContent === '开始游戏') newGame();
    else newGame();
  };
  elOvBtn2.onclick = function () { hideOverlay(); };

  window.addEventListener('resize', function () {
    // 尺寸变化时重新定位所有方块（无动画跳变）
    var geom = cellGeom();
    for (var k in state.tileEls) positionTile(state.tileEls[k], Number(k), geom);
  });

  /* ---------- 启动 ---------- */
  buildBackground();
  elBest.textContent = state.best;
  elOvTitle.textContent = '2048 数字炼金术';
  elOvSub.textContent = '方向键 / WASD / 手指滑动 · R 重开 · U 撤销';
  elOvBtn.textContent = '开始游戏';
  elOverlay.classList.add('show');
  // 暴露给控制台/测试
  window.__game = state;
  window.__newGame = newGame;
  window.__move = doMove;
  window.__dbgRender = function () { elTiles.innerHTML = ''; state.tileEls = {}; render(); };
})();
