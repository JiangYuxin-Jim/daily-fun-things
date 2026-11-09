/* 雷区 · 界面层 */
(function () {
  'use strict';
  const C = window.MinesCore;
  const LEVELS = [
    { key: 'easy', name: '初级 9×9 / 10', rows: 9, cols: 9, mines: 10 },
    { key: 'mid', name: '中级 16×16 / 40', rows: 16, cols: 16, mines: 40 },
    { key: 'hard', name: '高级 16×30 / 99', rows: 16, cols: 30, mines: 99 }
  ];

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const mineCountEl = $('mineCount');
  const timeEl = $('time');
  const faceEl = $('face');
  const modal = $('modal');
  const toastEl = $('toast');

  let level = LEVELS[0];
  let g = null;
  let cells = [];
  let timer = null;
  let hintIdx = -1;
  let longPressTimer = null;
  let flagsBefore = 0;

  // ---------- 布局 ----------
  function buildLevels() {
    const wrap = $('levels');
    LEVELS.forEach((lv) => {
      const b = document.createElement('button');
      b.className = 'diff' + (lv.key === level.key ? ' on' : '');
      b.textContent = lv.name;
      b.onclick = () => {
        level = lv;
        [...wrap.children].forEach((c) => c.classList.remove('on'));
        b.classList.add('on');
        reset();
      };
      wrap.appendChild(b);
    });
  }

  function reset() {
    clearInterval(timer); timer = null;
    if (g) saveBest(g, true);
    g = C.createGame({ rows: level.rows, cols: level.cols, mines: level.mines });
    hintIdx = -1;
    modal.classList.remove('show');
    faceEl.textContent = '🙂';
    render(true);
    updateHud();
  }

  function cellSize() {
    const maxW = Math.min(window.innerWidth - 48, 1100);
    const size = Math.floor((maxW - (g.cols - 1) * 2 - 14) / g.cols);
    return Math.max(18, Math.min(30, size));
  }

  function buildGrid() {
    boardEl.innerHTML = '';
    const s = cellSize();
    boardEl.style.gridTemplateColumns = `repeat(${g.cols}, ${s}px)`;
    cells = [];
    for (let i = 0; i < g.rows * g.cols; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.style.width = s + 'px';
      d.style.height = s + 'px';
      d.style.fontSize = Math.max(11, Math.round(s * 0.52)) + 'px';
      d.dataset.i = i;
      boardEl.appendChild(d);
      cells.push(d);
    }
  }

  // ---------- 渲染 ----------
  function paintCell(i, animate) {
    const el = cells[i];
    const v = g.board[i];
    el.className = 'cell';
    el.textContent = '';
    if (v === C.FLAG) {
      el.classList.add('flag');
      el.textContent = g.state === 'lost' && !g.mineMap[i] ? '✕' : '🚩';
      if (g.state === 'lost' && !g.mineMap[i]) el.classList.add('wrong');
    } else if (v === C.HIDDEN) {
      if (g.state === 'lost' && g.mineMap[i]) { el.classList.add('open'); el.textContent = '💣'; }
    } else {
      el.classList.add('open');
      if (v > 0) { el.textContent = v; el.classList.add('n' + v); }
      if (animate) el.classList.add('pop');
      if (g.mineMap[i]) { el.textContent = '💣'; }
    }
    if (i === g.explodedAt) el.classList.add('boom');
    if (i === hintIdx) el.classList.add('hint');
  }

  function render(full) {
    if (!g) return;
    for (let i = 0; i < g.board.length; i++) paintCell(i, !full);
  }

  function updateHud() {
    const left = C.remaining(g);
    mineCountEl.textContent = (left < 0 ? '💣 0' : '💣 ' + left);
    timeEl.textContent = '⏱ ' + String(C.elapsed(g)).padStart(3, '0');
    mineCountEl.style.color = left < 0 ? '#f85149' : '';
  }

  let lastSec = -1;
  function tick() {
    const s = C.elapsed(g);
    if (s === lastSec) return;
    lastSec = s;
    timeEl.textContent = '⏱ ' + String(s).padStart(3, '0');
  }

  // ---------- 交互 ----------
  function clearHint() {
    if (hintIdx >= 0 && cells[hintIdx]) {
      cells[hintIdx].classList.remove('hint');
      hintIdx = -1;
    }
  }

  function onReveal(i) {
    clearHint();
    const opened = C.reveal(g, i);
    if (!opened.length) return;
    render(opened.length > 40);
    updateHud();
    if (g.state === 'playing' && !timer) timer = setInterval(tick, 200);
    if (g.state === 'lost') {
      clearInterval(timer); timer = null;
      faceEl.textContent = '😵';
      setTimeout(() => { render(false); updateHud(); }, 400);
      setTimeout(() => showEnd(false), 700);
    } else if (g.state === 'won') {
      clearInterval(timer); timer = null;
      faceEl.textContent = '😎';
      updateHud();
      setTimeout(() => showEnd(true), 350);
    }
  }

  function onFlag(i) {
    clearHint();
    if ((g.state === 'playing' || g.state === 'ready') && C.toggleFlag(g, i)) {
      paintCell(i, false);
      updateHud();
    }
  }

  function onClick(e) {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const i = +cell.dataset.i;
    if (e.button === 2 || e.ctrlKey || e.metaKey) { onFlag(i); return; }
    if (g.board[i] >= 0 && g.board[i] <= 8) {
      const opened = C.chord(g, i);
      if (opened.length) { render(); updateHud(); checkAfterOpened(); }
      return;
    }
    onReveal(i);
  }

  function checkAfterOpened() {
    if (g.state === 'lost') {
      faceEl.textContent = '😵';
      setTimeout(() => { render(false); updateHud(); showEnd(false); }, 500);
    } else if (g.state === 'won') {
      faceEl.textContent = '😎';
      clearInterval(timer); timer = null;
      updateHud();
      setTimeout(() => showEnd(true), 300);
    }
  }

  function onDblClick(e) {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const i = +cell.dataset.i;
    if (g.board[i] >= 0 && g.board[i] <= 8) {
      const opened = C.chord(g, i);
      if (opened.length) { render(); updateHud(); checkAfterOpened(); }
    }
  }

  // 长按 = 插旗（移动端）
  function attachPointer() {
    boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
    boardEl.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.cell');
      if (e.button === 2) { e.preventDefault(); onFlag(+cell.dataset.i); return; }
    });
    boardEl.addEventListener('click', onClick);
    boardEl.addEventListener('dblclick', onDblClick);

    boardEl.addEventListener('touchstart', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        onFlag(+cell.dataset.i);
        if (navigator.vibrate) navigator.vibrate(18);
      }, 380);
    }, { passive: true });
    const cancel = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
    boardEl.addEventListener('touchend', cancel);
    boardEl.addEventListener('touchmove', cancel);
    boardEl.addEventListener('touchcancel', cancel);
  }

  // ---------- 提示 ----------
  function doHint() {
    if (g.state === 'won' || g.state === 'lost') return;
    clearHint();
    if (g.firstMove) { toast('先随便点一下开局吧'); return; }
    // 优先用推断：safe → 直接高亮；mine → 插旗
    let step = C.solveStep(g);
    if (step && step.type === 'safe') {
      hintIdx = step.idx;
      paintCell(hintIdx, false);
      return;
    }
    if (step && step.type === 'mine') {
      C.toggleFlag(g, step.idx);
      paintCell(step.idx, false);
      updateHud();
      toast('这一格是雷，已自动插旗');
      return;
    }
    // 无确定推断：找出「风险最低」的未知格（近似：邻接数字约束之和最小）
    let best = -1, bestRisk = Infinity;
    for (let i = 0; i < g.board.length; i++) {
      if (g.board[i] !== C.HIDDEN) continue;
      const ns = C.neighbors(g, i);
      let risk = 0, known = false;
      for (const n of ns) {
        const v = g.board[n];
        if (v >= 1 && v <= 8) {
          let f = 0, un = 0;
          for (const m of C.neighbors(g, n)) {
            if (g.board[m] === C.FLAG) f++;
            else if (g.board[m] === C.HIDDEN) un++;
          }
          if (un > 0) { risk += (v - f) / un; known = true; }
        }
      }
      if (!known) risk = 0.3;
      if (risk < bestRisk) { bestRisk = risk; best = i; }
    }
    if (best >= 0) { hintIdx = best; paintCell(best, false); }
  }

  function doAutoFlag() {
    if (g.state === 'won' || g.state === 'lost') return;
    if (g.firstMove) { toast('先随便点一下开局吧'); return; }
    let n = 0, guard = 0;
    while (guard++ < 200) {
      const st = C.solveStep(g);
      if (!st || st.type !== 'mine') break;
      if (g.board[st.idx] === C.HIDDEN && C.toggleFlag(g, st.idx)) { n++; paintCell(st.idx, false); }
    }
    updateHud();
    toast(n ? `插了 ${n} 面旗` : '暂时没有可 100% 确定的雷');
  }

  // ---------- 结算 ----------
  function keyOf(g) { return g.rows + 'x' + g.cols + '_' + g.mines; }
  function saveBest(gg, silent) {
    if (gg.state !== 'won') return;
    const t = C.elapsed(gg);
    let best = {};
    try { best = JSON.parse(localStorage.getItem('minecraft.best') || '{}'); } catch (e) { best = {}; }
    const k = keyOf(gg);
    if (!best[k] || t < best[k]) {
      best[k] = t;
      try { localStorage.setItem('minecraft.best', JSON.stringify(best)); } catch (e) {}
      if (!silent) { /* 玩法外记录 */ }
    }
  }

  function bestOf(gg) {
    try {
      const b = JSON.parse(localStorage.getItem('minecraft.best') || '{}');
      return b[keyOf(gg)] || null;
    } catch (e) { return null; }
  }

  function showEnd(won) {
    if (won) saveBest(g, false);
    const t = C.elapsed(g);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    $('mTitle').textContent = won ? '🎉 通关！' : '💥 踩雷了';
    $('mTime').textContent = mm + ':' + ss;
    const best = bestOf(g);
    $('mDesc').textContent = won
      ? (best && best < t ? `最佳纪录 ${Math.floor(best / 60)}:${String(best % 60).padStart(2, '0')}` : '刷新了个人最快纪录！') +
        ` · 揭开 ${g.revealed}/${g.rows * g.cols - g.mines}`
      : `已揭开 ${g.revealed}/${g.rows * g.cols - g.mines} 格，再试一次？`;
    modal.classList.add('show');
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  // ---------- 启动 ----------
  buildLevels();
  attachPointer();
  $('face').onclick = reset;
  $('btnRestart').onclick = reset;
  $('btnHint').onclick = doHint;
  $('btnAuto').onclick = doAutoFlag;
  $('mBtn').onclick = reset;
  window.addEventListener('resize', () => { if (g) { buildGrid(); render(true); } });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') reset();
    if (e.key === 'h' || e.key === 'H') doHint();
  });
  reset();
})();
