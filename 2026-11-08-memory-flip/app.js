/*
 * app.js — 记忆棱镜：渲染 / 输入 / 音效 / 落盘
 * 引擎在 core.js（纯函数）。这里只负责「把状态画出来 + 把点击变成 flip()」。
 */
(function () {
  'use strict';
  const C = (typeof window !== 'undefined' && window.MemoryCore) ||
            (typeof MemoryCore !== 'undefined' ? MemoryCore : null);

  // ───────── 落盘 ─────────
  const LS_BEST = 'memory-prism.best.v1';
  const LS_SETTINGS = 'memory-prism.settings.v1';

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式忽略 */ }
  }

  const best = loadJSON(LS_BEST, {});            // level -> { score, moves, date }
  const settings = loadJSON(LS_SETTINGS, { sound: true, level: 'normal' });

  // ───────── DOM ─────────
  const $ = id => document.getElementById(id);
  const boardEl = $('board');
  const overlay = $('overlay');

  // ───────── 音效（WebAudio 现场合成，零素材）─────────
  const Sound = (function () {
    let ctx = null;
    function ensure() {
      if (!settings.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }
    function tone(freq, dur, type, gain, delay, slideTo) {
      const ac = ensure(); if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.09, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    return {
      flip()   { tone(520, 0.07, 'triangle', 0.05); },
      match(combo) {
        const base = 523.25 * Math.pow(2, Math.min(combo - 1, 7) / 12); // 每次连击升半音，最多升 7 个
        tone(base, 0.12, 'sine', 0.10);
        tone(base * 1.5, 0.16, 'sine', 0.07, 0.06);
      },
      miss()   { tone(220, 0.16, 'sawtooth', 0.05, 0, 150); },
      peek()   { tone(880, 0.09, 'sine', 0.05); tone(1320, 0.1, 'sine', 0.04, 0.05); },
      win()    {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.3, 'sine', 0.09, i * 0.1));
      },
      lose()   { tone(300, 0.55, 'sine', 0.09, 0, 90); },
    };
  })();

  // ───────── 状态 ─────────
  let state = null;
  let levelKey = settings.level && C.LEVELS[settings.level] ? settings.level : 'normal';
  let startWall = 0;         // 真实时间：算用时
  let elapsedMs = 0;
  let busyUntil = 0;         // 配对动画锁：真实时间毫秒

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // ───────── 建棋盘 ─────────
  function startGame(key) {
    levelKey = key || levelKey;
    state = C.createGame({ level: levelKey });
    startWall = now();
    elapsedMs = 0;
    busyUntil = 0;
    hideOverlay();
    renderAll(true);
    settings.level = levelKey;
    saveJSON(LS_SETTINGS, settings);
    updateLevelButtons();
    updateBest();
  }

  function renderAll(rebuild) {
    const L = C.LEVELS[state.level];
    if (rebuild || boardEl.children.length !== state.tiles.length) {
      boardEl.innerHTML = '';
      boardEl.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
      state.tiles.forEach(t => {
        const b = document.createElement('button');
        b.className = 'card';
        b.type = 'button';
        b.dataset.id = String(t.id);
        b.setAttribute('role', 'gridcell');
        b.setAttribute('aria-label', '未翻开的牌');
        b.innerHTML = '<span class="face back"></span><span class="face front">' + escapeHtml(t.face) + '</span>';
        b.addEventListener('click', () => onCardClick(t.id));
        boardEl.appendChild(b);
      });
    }
    syncCards();
    updateHud();
    void L;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  /** 把核心状态映射到 DOM class 上（无差量，直接全量同步，牌数 ≤36 开销可忽略） */
  function syncCards() {
    const peekOn = state.peekUntil !== null;
    for (let i = 0; i < state.tiles.length; i++) {
      const el = boardEl.children[i];
      if (!el) continue;
      const t = state.tiles[i];
      const up = t.matched || peekOn || state.flipped.indexOf(t.id) >= 0;
      el.classList.toggle('flip', up);
      el.classList.toggle('matched', t.matched);
      el.classList.toggle('gone', t.matched);
      el.setAttribute('aria-label', t.matched ? '已配对 ' + t.face : up ? '翻开 ' + t.face : '未翻开的牌');
      el.setAttribute('aria-pressed', up ? 'true' : 'false');
    }
    // 揭晓中整盘不可点
    boardEl.classList.toggle('locked', peekOn && !state.over);
  }

  function updateHud() {
    setText('v-score', state.score);
    setText('v-pairs', state.pairsFound + '/' + state.totalPairs);
    setText('v-combo', '×' + state.combo);
    setText('v-moves', state.moves);
    const peekBtn = $('btn-peek');
    peekBtn.disabled = state.over || state.peeksLeft <= 0 || state.peekUntil !== null;
    $('peek-left').textContent = state.peeksLeft > 0 ? ' ' + state.peeksLeft : ' 无';
    updateTimebar();
  }

  function setText(id, v) {
    const el = $(id);
    if (el && el.textContent !== String(v)) {
      el.textContent = String(v);
      const card = el.parentElement;
      card.classList.remove('pop');
      void card.offsetWidth;
      card.classList.add('pop');
    }
  }

  function updateTimebar() {
    const bar = $('timebar'), fill = $('timefill');
    const left = C.timeLeft(state);
    if (left === null) { bar.classList.remove('on'); return; }
    bar.classList.add('on');
    const L = C.LEVELS[state.level];
    const pct = (left / (L.timeLimit * 1000)) * 100;
    fill.style.width = pct.toFixed(2) + '%';
    bar.classList.toggle('warn', pct < 30);
  }

  // ───────── 交互 ─────────
  function onCardClick(id) {
    if (!state || state.over) return;
    if (now() < busyUntil) return;

    if (state.peekUntil !== null) {
      const r = C.flip(state, id);   // 揭晓期间点牌 = 收起
      if (r.ok) { state = r.state; Sound.flip(); syncCards(); updateHud(); }
      return;
    }

    const r = C.flip(state, id);
    if (!r.ok) return;

    state = r.state;
    syncCards();
    updateHud();

    if (r.event === 'flip') {
      Sound.flip();
    } else if (r.event === 'match') {
      Sound.match(state.combo);
      showFloat(id, state.combo > 1 ? `×${state.combo} 连击` : '+100');
      // 配对动画期间锁一下手速，防止连点导致视觉错位
      busyUntil = now() + 120;
      if (state.over) onWin();
    } else if (r.event === 'miss') {
      Sound.miss();
      const el = boardEl.children[id];
      if (el) { el.classList.add('miss'); setTimeout(() => el.classList.remove('miss'), 400); }
      showFloat(id, '-' + C.SCORE.miss);
      // 下一张要等收牌动画，给点节奏
      busyUntil = now() + 360;
    }
  }

  function showFloat(id, text) {
    const el = boardEl.children[id];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'float';
    d.textContent = text;
    d.style.left = (r.left + r.width / 2) + 'px';
    d.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  function doPeek() {
    if (!state || state.over) return;
    const r = C.peek(state, 1400);
    if (!r.ok) return;
    state = r.state;
    Sound.peek();
    renderAll(true);
    syncCards();
    updateHud();
    // 用 rAF 推进逻辑时间（不用不可控的 setTimeout 链）
    peekStart = now();
  }

  let peekStart = 0;
  function loop() {
    const t = now();
    if (state && !state.over) {
      if (peekStart) {
        const elapsed = Math.max(0, t - peekStart);
        const r = C.tick(state, Math.min(elapsed, 50)); // 每帧最多推进 50ms，避免后台标签页时间跳变
        state = r.state;
        peekStart = t - Math.min(elapsed, 50);
        if (r.changed) {
          peekStart = 0;
          Sound.flip();
        }
        syncCards(); updateHud();
      }
      if (C.LEVELS[state.level].timed) {
        // 计时关：用真实时间累计
        const dt = Math.min(t - (loop._last || t), 200);
        const lr = C.tick(state, dt);
        state = lr.state;
        updateTimebar();
        if (C.timedOut(state)) {
          state.over = true; state.reason = 'timeout';
          Sound.lose();
          showEnd(false);
        }
      }
    }
    loop._last = t;
    requestAnimationFrame(loop);
  }

  // ───────── 结束 ─────────
  function onWin() {
    const ms = now() - startWall;
    elapsedMs = ms;
    Sound.win();
    // 小延时让最后一张牌的动画播完
    setTimeout(() => showEnd(true), 460);
  }

  function showEnd(won) {
    const st = C.stars(state);
    const key = state.level;
    const prev = best[key];
    const isNew = won && (!prev || state.score > prev.score);
    if (isNew) {
      best[key] = { score: state.score, moves: state.moves, date: new Date().toISOString().slice(0, 10) };
      saveJSON(LS_BEST, best);
    }
    updateBest();

    $('ov-title').textContent = won ? '记忆贯通' : '时间到';
    $('ov-title').className = 'title ' + (won ? 'win' : 'lose');
    const starEls = $('ov-stars').children;
    for (let i = 0; i < starEls.length; i++) starEls[i].classList.toggle('on', i < st);
    $('ov-score').textContent = state.score;
    $('ov-rec').classList.toggle('on', !!isNew);

    const secs = (elapsedMs / 1000).toFixed(1);
    const misses = state.log.filter(m => !m.hit).length;
    const perfect = state.moves / 2 === state.totalPairs;
    $('ov-rows').innerHTML =
      (won ? '' : `配对 <b>${state.pairsFound}/${state.totalPairs}</b><br>`) +
      `用时 <b>${secs}s</b> · 翻牌 <b>${state.moves}</b> 次<br>` +
      `失误 <b>${misses}</b> 次 · 最高连击 <b>${state.bestCombo}</b><br>` +
      (won && st === 3 && perfect ? '<span style="color:var(--green)">完美记忆：一次没错、每张只翻一遍</span>' : '');
    overlay.classList.add('on');
  }

  function hideOverlay() { overlay.classList.remove('on'); }

  function updateBest() {
    const b = best[levelKey];
    const L = C.LEVELS[levelKey];
    $('best').innerHTML = b
      ? `${L.label}难度最佳 <b>${b.score}</b> 分 · ${b.moves} 次翻牌 · ${b.date}`
      : `${L.label}难度还没有记录 —— 打一局就上榜`;
  }

  // ───────── 难度 ─────────
  function buildLevels() {
    const box = $('levels');
    box.innerHTML = '';
    Object.keys(C.LEVELS).forEach((k, i) => {
      const b = document.createElement('button');
      b.className = 'lv';
      b.type = 'button';
      b.dataset.level = k;
      b.textContent = `${i + 1} ${C.LEVELS[k].label}`;
      b.addEventListener('click', () => { if (k !== levelKey || state.over) startGame(k); });
      box.appendChild(b);
    });
  }
  function updateLevelButtons() {
    Array.prototype.forEach.call($('levels').children, el => {
      el.classList.toggle('on', el.dataset.level === levelKey);
    });
  }

  // ───────── 绑定 ─────────
  function bind() {
    $('btn-peek').addEventListener('click', doPeek);
    $('btn-restart').addEventListener('click', () => startGame(levelKey));
    $('btn-sound').addEventListener('click', () => {
      settings.sound = !settings.sound;
      saveJSON(LS_SETTINGS, settings);
      $('btn-sound').textContent = settings.sound ? '🔊 音效' : '🔇 静音';
      if (settings.sound) Sound.flip();
    });
    $('btn-sound').textContent = settings.sound ? '🔊 音效' : '🔇 静音';
    $('ov-again').addEventListener('click', () => startGame(levelKey));
    $('ov-close').addEventListener('click', hideOverlay);

    document.addEventListener('keydown', e => {
      if (e.key === ' ') { e.preventDefault(); doPeek(); return; }
      if (e.key === 'r' || e.key === 'R') { startGame(levelKey); return; }
      if (e.key === 'Escape') { hideOverlay(); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) {
        const keys = Object.keys(C.LEVELS);
        if (keys[n - 1]) startGame(keys[n - 1]);
      }
    });

    // 切走标签页时自动收起揭晓，防止「离开时偷看」
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state && state.peekUntil !== null) {
        state = C.tick(state, 1e9).state;
        syncCards(); updateHud();
      }
    });
  }

  // ───────── 启动 ─────────
  buildLevels();
  bind();
  startGame(levelKey);
  requestAnimationFrame(loop);

  // 暴露给测试用
  window.__memoryPrism = {
    getState: () => state,
    setState: s => { state = s; renderAll(true); },
    startGame, doPeek, onCardClick, LEVELS: C.LEVELS,
  };
})();
