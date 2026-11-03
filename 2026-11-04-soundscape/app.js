/* ============================================================
 * app.js — Soundscape UI 层：混音台、预设、可视化、睡眠定时
 * ============================================================ */
(function () {
  'use strict';

  const SS = window.SS;

  /* ---------- 声音目录 ---------- */
  const CATALOG = [
    { id: 'rain',  name: '雨',     icon: '🌧️', hue: 205, def: 70, hint: '窗外下了一场不会停的雨' },
    { id: 'waves', name: '海浪',   icon: '🌊', hue: 190, def: 65, hint: '十二秒一个浪，拍在礁石上' },
    { id: 'wind',  name: '风',     icon: '🍃', hue: 150, def: 50, hint: '穿过山谷的穿堂风' },
    { id: 'fire',  name: '篝火',   icon: '🔥', hue: 25,  def: 60, hint: '柴火噼啪，火星乱蹦' },
    { id: 'cafe',  name: '咖啡店', icon: '☕', hue: 35,  def: 55, hint: '隔壁桌低声聊天的模糊人声' },
    { id: 'notes', name: '琴音',   icon: '🎹', hue: 270, def: 45, hint: '五声音阶随机琶音，永远不会弹错' }
  ];

  /* ---------- 预设 ---------- */
  const PRESETS = [
    { id: 'rainy-night', name: '雨夜书房',   desc: '下雨 + 远得像隔壁的琴音，写东西专用', mix: { rain: 80, notes: 30 } },
    { id: 'seaside',     name: '海边小屋',   desc: '海浪 + 风，一秒到垦丁',               mix: { waves: 85, wind: 30 } },
    { id: 'cafe-corner', name: '咖啡馆角落', desc: '咖啡店低语 + 一点雨，假装在外面工作',   mix: { cafe: 70, rain: 25 } },
    { id: 'campfire',    name: '露营篝火',   desc: '篝火 + 夜风，适合发呆',               mix: { fire: 75, wind: 35 } },
    { id: 'deep-focus',  name: '深度专注',   desc: '几乎没有旋律，只有稳定的雨幕',         mix: { rain: 90 } },
    { id: 'sleep',       name: '睡前',       desc: '海浪 + 极轻琴音，音量建议调低',         mix: { waves: 60, notes: 15 } }
  ];

  /* ---------- 状态 ---------- */
  const state = {
    levels: {},
    nodes: {},
    master: 0.8,
    playing: false,
    bus: null,
    timerEnd: 0,
    timerHandle: null,
    activeTimer: 0
  };
  CATALOG.forEach(s => { state.levels[s.id] = 0; });

  const $ = sel => document.querySelector(sel);
  const grid = $('#grid');
  const presetRow = $('#presets');
  const viz = $('#viz');
  const vctx = viz.getContext('2d');
  const sliders = {};

  /* ================= 混音通道 UI ================= */
  CATALOG.forEach(s => {
    const card = document.createElement('div');
    card.className = 'ch';
    card.style.setProperty('--hue', s.hue);
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="ch-top">
        <span class="ch-icon" title="点我静音/恢复">${s.icon}</span>
        <span class="ch-name">${s.name}</span>
        <span class="ch-val" id="val-${s.id}">0</span>
      </div>
      <input type="range" min="0" max="100" value="0" step="1"
             class="ch-slider" id="sl-${s.id}" aria-label="${s.name} 音量">
      <div class="ch-hint">${s.hint}</div>`;
    grid.appendChild(card);

    const slider = card.querySelector('input');
    const valEl = card.querySelector('.ch-val');

    function set(card, v) {
      state.levels[s.id] = v;
      valEl.textContent = v;
      card.classList.toggle('on', v > 0);
      applyLevel(s.id, v);
      updatePresetHighlight();
    }
    const val = v => set(card, v);

    slider.addEventListener('input', () => val(+slider.value));

    card.addEventListener('wheel', e => {
      if (!state.playing) return;
      e.preventDefault();
      const nv = Math.max(0, Math.min(100, state.levels[s.id] + (e.deltaY < 0 ? 4 : -4)));
      slider.value = nv; val(nv);
    }, { passive: false });

    sliders[s.id] = { slider, set: nv => { slider.value = nv; val(nv); } };

    card.querySelector('.ch-icon').addEventListener('click', () => {
      if (state.levels[s.id] > 0) {
        card.dataset.last = state.levels[s.id];
        sliders[s.id].set(0);
      } else {
        sliders[s.id].set(+(card.dataset.last || s.def));
      }
    });
  });

  /* ================= 音频应用 ================= */
  function ensureBus() {
    if (state.bus) return state.bus;
    const ctx = SS.getCtx();
    state.bus = ctx.createGain();
    state.bus.gain.value = 1;
    state.bus.connect(SS.getDestNode());
    return state.bus;
  }

  // 平方曲线：感知音量更接近线性
  const curve = v => Math.pow(v / 100, 2);

  function applyLevel(id, v) {
    const node = state.nodes[id];
    if (!node || !SS.getCtx()) return;
    node.out.gain.setTargetAtTime(curve(v), SS.getCtx().currentTime, 0.08);
  }

  function buildNode(id) {
    if (state.nodes[id]) return state.nodes[id];
    const node = SS.sounds[id]();
    ensureBus();
    // sounds 返回的 out 其实就是 gain 节点
    node.out.gain.value = 0;
    node.out.connect(state.bus);
    state.nodes[id] = node;
    return node;
  }

  function teardown() {
    Object.keys(state.nodes).forEach(id => {
      try { state.nodes[id].stop(); } catch (e) {}
      try { state.nodes[id].out.disconnect(); } catch (e) {}
      delete state.nodes[id];
    });
    if (state.bus) { try { state.bus.disconnect(); } catch (e) {} state.bus = null; }
  }

  /* ================= 播放控制 ================= */
  async function play() {
    if (state.playing) return;
    SS.ensureCtx();
    await SS.resume();

    // 整体从 0 淡入
    SS.setMaster(0);
    CATALOG.forEach(s => buildNode(s.id));
    CATALOG.forEach(s => applyLevel(s.id, state.levels[s.id]));
    SS.markStarted(true);

    state.playing = true;
    SS.setMaster(state.master);

    document.body.classList.add('playing');
    $('#playBtn').innerHTML = '⏸ <span>暂停</span>';
    $('#playBtn').classList.add('active');
    renderStatus();
  }

  function pause() {
    if (!state.playing) return;
    SS.markStarted(false);
    const now = SS.getCtx().currentTime;
    // 0.35s 淡出后拆除，避免"咔"声
    SS.setMaster(0);
    CATALOG.forEach(s => {
      if (state.nodes[s.id]) {
        state.nodes[s.id].out.gain.cancelScheduledValues(now);
        state.nodes[s.id].out.gain.setTargetAtTime(0, now, 0.06);
      }
    });
    setTimeout(teardown, 420);

    state.playing = false;
    document.body.classList.remove('playing');
    $('#playBtn').innerHTML = '▶ <span>开始聆听</span>';
    $('#playBtn').classList.remove('active');
    renderStatus();
  }

  $('#playBtn').addEventListener('click', () => (state.playing ? pause() : play()));

  /* ================= 预设 ================= */
  PRESETS.forEach(p => {
    const el = document.createElement('button');
    el.className = 'preset';
    el.dataset.preset = p.id;
    const parts = Object.entries(p.mix).map(([k, v]) => {
      const s = CATALOG.find(c => c.id === k);
      return `<span class="pill" style="--hue:${s.hue}">${s.icon} ${s.name} <b>${v}</b></span>`;
    }).join('');
    el.innerHTML = `<div class="preset-name">${p.name}</div>
                    <div class="preset-desc">${p.desc}</div>
                    <div class="preset-mix">${parts}</div>`;
    el.addEventListener('click', () => {
      CATALOG.forEach(s => sliders[s.id].set(p.mix[s.id] || 0));
      if (!state.playing) play();
    });
    presetRow.appendChild(el);
  });

  function updatePresetHighlight() {
    document.querySelectorAll('.preset').forEach(el => {
      const p = PRESETS.find(x => x.id === el.dataset.preset);
      const match = CATALOG.every(s => (p.mix[s.id] || 0) === state.levels[s.id]);
      el.classList.toggle('current', match);
    });
  }

  function renderStatus() {
    const active = CATALOG.filter(s => state.levels[s.id] > 0);
    $('#status').textContent = state.playing
      ? (active.length ? `${active.length} 轨混音中` : '正在播放（所有轨道已静音）')
      : '已暂停';
  }

  /* ================= 主音量 ================= */
  const master = $('#master');
  master.value = Math.round(state.master * 100);
  $('#masterVal').textContent = Math.round(state.master * 100) + '%';
  master.addEventListener('input', () => {
    state.master = +master.value / 100;
    $('#masterVal').textContent = master.value + '%';
    if (state.playing) SS.setMaster(state.master);
  });

  $('#stopAll').addEventListener('click', () => {
    CATALOG.forEach(s => sliders[s.id].set(0));
    renderStatus();
  });

  /* ================= 睡眠定时 ================= */
  document.querySelectorAll('.timer-btn').forEach(b => {
    b.addEventListener('click', () => {
      const min = +b.dataset.min;
      if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
      document.querySelectorAll('.timer-btn').forEach(x => x.classList.remove('active'));

      if (min === 0 || state.activeTimer === min) {
        state.activeTimer = 0;
        $('#timerLeft').textContent = '';
        return;
      }
      state.activeTimer = min;
      b.classList.add('active');
      state.timerEnd = Date.now() + min * 60000;
      tick();
      state.timerHandle = setInterval(tick, 500);
    });
  });

  function tick() {
    const left = Math.max(0, state.timerEnd - Date.now());
    if (left <= 0) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
      state.activeTimer = 0;
      $('#timerLeft').textContent = '';
      document.querySelectorAll('.timer-btn').forEach(x => x.classList.remove('active'));
      fadeOutAndPause(12);
      return;
    }
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    $('#timerLeft').textContent = `⏳ ${m}:${String(s).padStart(2, '0')}`;
  }

  function fadeOutAndPause(sec) {
    if (!state.playing) return;
    const target = state.master;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      SS.setMaster(target * (1 - step / sec));
      if (step >= sec) { clearInterval(iv); pause(); SS.setMaster(target); }
    }, 1000);
  }

  /* ================= 快捷键 ================= */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.code === 'Space') {
      e.preventDefault();
      $('#playBtn').click();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 6) {
      const s = CATALOG[n - 1];
      sliders[s.id].set(state.levels[s.id] > 0 ? 0 : s.def);
      renderStatus();
    }
    if (e.key === 'm' || e.key === 'M') {
      master.value = master.value > 0 ? 0 : 80;
      master.dispatchEvent(new Event('input'));
    }
  });

  /* ================= 可视化 ================= */
  const parts = [];
  function resize() {
    const r = viz.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    viz.width = Math.max(1, Math.floor(r.width * dpr));
    viz.height = Math.max(1, Math.floor(r.height * dpr));
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function draw() {
    const w = viz.clientWidth, h = viz.clientHeight;
    vctx.clearRect(0, 0, w, h);

    const BINS = 48;
    const spec = state.playing ? SS.getSpectrum(BINS) : new Uint8Array(BINS);
    let sum = 0;
    for (let i = 0; i < BINS; i++) sum += spec[i];
    const energy = sum / (BINS * 255);

    if (energy > 0.01) {
      const g = vctx.createRadialGradient(w / 2, h * 0.6, 10, w / 2, h * 0.6, Math.max(w, h) * 0.6);
      g.addColorStop(0, `rgba(120,180,255,${0.05 + energy * 0.16})`);
      g.addColorStop(1, 'rgba(120,180,255,0)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, w, h);
    }

    const bw = w / BINS;
    for (let i = 0; i < BINS; i++) {
      const v = spec[i] / 255;
      const bh = v * h * 0.5;
      vctx.fillStyle = `hsla(${200 + i * 2}, 90%, ${55 + v * 20}%, ${0.1 + v * 0.45})`;
      vctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    }

    if (state.playing && energy > 0.02) {
      const spawn = Math.min(4, Math.floor(energy * 14));
      for (let i = 0; i < spawn; i++) {
        parts.push({
          x: Math.random() * w, y: -8,
          vy: 0.6 + Math.random() * 2.2,
          r: 0.8 + Math.random() * 2.4,
          hue: 190 + Math.random() * 90, life: 1
        });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.y += p.vy; p.life -= 0.0025;
      if (p.y > h + 10 || p.life <= 0) { parts.splice(i, 1); continue; }
      vctx.beginPath();
      vctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      vctx.fillStyle = `hsla(${p.hue}, 90%, 72%, ${0.5 * p.life})`;
      vctx.fill();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  renderStatus();
  window.addEventListener('pointerdown', () => SS.resume(), { once: true });
})();
