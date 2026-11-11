/* 弹球 · 打砖块 —— 渲染与交互层 */
(function () {
  'use strict';
  const B = window.Breakout;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const stage = document.getElementById('stage');

  const $ = id => document.getElementById(id);
  const hLevel = $('hLevel'), hScore = $('hScore'), hLives = $('hLives'), hBest = $('hBest');
  const ovStart = $('ovStart'), ovPause = $('ovPause'), ovClear = $('ovClear'), ovOver = $('ovOver');
  const toast = $('toast');

  const store = window.localStorage;
  let save = B.loadSave(store);

  // ---- 高分屏适配 ----
  let dpr = 1, viewW = 0, viewH = 0, scale = 1, offX = 0, offY = 0;

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = r.width; viewH = r.height;
    cv.width = Math.round(viewW * dpr);
    cv.height = Math.round(viewH * dpr);
    // 保持逻辑比例，留黑边居中
    const sx = viewW / B.LOGIC_W, sy = viewH / B.LOGIC_H;
    scale = Math.min(sx, sy);
    offX = (viewW - B.LOGIC_W * scale) / 2;
    offY = (viewH - B.LOGIC_H * scale) / 2;
  }
  window.addEventListener('resize', resize);

  // ---- 世界状态 ----
  let world = null;
  let paused = false;
  let running = false;
  let last = 0;
  let keys = { left: false, right: false };
  let pointerX = null;
  let livesShown = 3;

  function newGame(level) {
    world = B.createWorld({ level: level || 1, score: 0, lives: 3 });
    livesShown = world.lives;
    paused = false;
    running = true;
    hideAll();
    syncHud();
    last = performance.now();
  }

  function nextLevel(level) {
    const carryScore = world.score;
    const carryLives = world.lives;
    world = B.createWorld({ level: level, score: carryScore, lives: carryLives });
    paused = false;
    running = true;
    hideAll();
    syncHud();
    last = performance.now();
  }

  function hideAll() {
    [ovStart, ovPause, ovClear, ovOver].forEach(o => o.classList.remove('show'));
  }

  function syncHud() {
    if (!world) return;
    hLevel.textContent = world.level;
    hScore.textContent = world.score;
    hLives.textContent = '❤'.repeat(Math.max(0, livesShown));
    hBest.textContent = save.best;
  }

  function showToast(txt) {
    toast.textContent = txt;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 700);
  }

  function commitBest() {
    if (!world) return;
    if (world.score > save.best) save.best = world.score;
    if (world.level > save.maxLevel) save.maxLevel = world.level;
    B.saveSave(store, save);
    syncHud();
  }

  // ---- 输入 ----
  function toLogicX(clientX) {
    const r = stage.getBoundingClientRect();
    return (clientX - r.left - offX) / scale;
  }

  stage.addEventListener('pointermove', e => {
    if (!world || !running) return;
    pointerX = toLogicX(e.clientX);
    B.movePaddle(world, pointerX);
    if (e.pointerType !== 'mouse') e.preventDefault();
  }, { passive: false });

  stage.addEventListener('pointerdown', e => {
    if (!world || !running) return;
    pointerX = toLogicX(e.clientX);
    B.movePaddle(world, pointerX);
    tryLaunch();
  });

  stage.addEventListener('pointerleave', () => { pointerX = null; });

  function tryLaunch() {
    if (!world) return;
    if (world.status === 'ready') B.launch(world);
  }

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { keys.left = true; e.preventDefault(); }
    if (k === 'arrowright' || k === 'd') { keys.right = true; e.preventDefault(); }
    if (k === ' ') { e.preventDefault(); tryLaunch(); }
    if (k === 'p') { e.preventDefault(); togglePause(); }
    if (k === 'r') { e.preventDefault(); if (running) { commitBest(); newGame(1); } }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = false;
    if (k === 'arrowright' || k === 'd') keys.right = false;
  });

  function togglePause() {
    if (!running || !world) return;
    if (world.status === 'gameover' || world.status === 'clear') return;
    paused = !paused;
    ovPause.classList.toggle('show', paused);
    if (!paused) last = performance.now();
  }

  // ---- 按钮 ----
  $('btnStart').onclick = () => newGame(1);
  $('btnPause').onclick = () => togglePause();
  $('btnResume').onclick = () => togglePause();
  $('btnRestart').onclick = () => { commitBest(); newGame(1); };
  $('btnNext').onclick = () => nextLevel(world.level + 1);
  $('btnAgain').onclick = () => { commitBest(); newGame(1); };

  // ---- 渲染 ----
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function brickStyle(b) {
    const base = B.brickColor(b);
    // 受损砖变暗
    const dmg = (b.maxHp - b.hp) / b.maxHp;
    return { base: base, alpha: 0.55 + 0.45 * (1 - dmg) };
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    // 场地底色
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    let sx = 0, sy = 0;
    if (world && world.shake > 0) {
      sx = (Math.random() - 0.5) * world.shake * 7;
      sy = (Math.random() - 0.5) * world.shake * 7;
    }
    ctx.translate(offX + sx, offY + sy);
    ctx.scale(scale, scale);

    // 裁剪到逻辑区域
    ctx.beginPath();
    ctx.rect(0, 0, B.LOGIC_W, B.LOGIC_H);
    ctx.clip();

    // 网格背景
    ctx.strokeStyle = 'rgba(116,192,252,.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= B.LOGIC_W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, B.LOGIC_H); ctx.stroke();
    }
    for (let y = 0; y <= B.LOGIC_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(B.LOGIC_W, y); ctx.stroke();
    }

    if (world) {
      // 砖块
      for (const b of world.bricks) {
        if (!b.alive) continue;
        const st = brickStyle(b);
        ctx.globalAlpha = st.alpha;
        // 主体
        const grd = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        grd.addColorStop(0, st.base);
        grd.addColorStop(1, 'rgba(0,0,0,.35)');
        ctx.fillStyle = grd;
        roundRect(b.x, b.y, b.w, b.h, 5);
        ctx.fill();
        // 高光
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        roundRect(b.x + 2, b.y + 2, b.w - 4, 5, 3);
        ctx.fill();
        // 血量角标
        if (b.maxHp > 1) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(10,14,20,.75)';
          ctx.font = 'bold 10px ui-monospace,monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.hp, b.x + b.w - 6, b.y + b.h / 2 + 1);
        }
      }
      ctx.globalAlpha = 1;

      // 粒子
      for (const p of world.particles) {
        const a = Math.max(0, Math.min(1, p.life / p.max));
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 挡板
      const p = world.paddle;
      const pg = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
      pg.addColorStop(0, '#8ce99a');
      pg.addColorStop(1, '#40c057');
      ctx.fillStyle = pg;
      ctx.shadowColor = 'rgba(140,233,154,.5)';
      ctx.shadowBlur = 16;
      roundRect(p.x, p.y, p.w, p.h, 7);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 球
      const ball = world.ball;
      const bg = ctx.createRadialGradient(ball.x - 2, ball.y - 3, 1, ball.x, ball.y, ball.r * 1.6);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.5, '#a5d8ff');
      bg.addColorStop(1, 'rgba(116,192,252,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();

      // 未发射提示箭头
      if (ball.stuck && world.status === 'ready') {
        const t = (Math.sin(world.time * 4) + 1) / 2;
        ctx.globalAlpha = 0.35 + t * 0.5;
        ctx.strokeStyle = '#74c0fc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y - 22 - t * 8);
        ctx.lineTo(ball.x - 7, ball.y - 12 - t * 8);
        ctx.moveTo(ball.x, ball.y - 22 - t * 8);
        ctx.lineTo(ball.x + 7, ball.y - 12 - t * 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 底部危险线
      ctx.strokeStyle = 'rgba(255,107,107,.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(0, B.LOGIC_H - 2);
      ctx.lineTo(B.LOGIC_W, B.LOGIC_H - 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 命中白光
      if (world.flash > 0) {
        ctx.fillStyle = 'rgba(200,230,255,' + (world.flash * 0.06) + ')';
        ctx.fillRect(0, 0, B.LOGIC_W, B.LOGIC_H);
      }
    }

    ctx.restore();
  }

  // ---- 主循环 ----
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (world && running && !paused) {
      // 键盘推动挡板
      const kv = 620;
      if (keys.left || keys.right) {
        pointerX = null;
        const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        B.movePaddle(world, world.paddle.x + world.paddle.w / 2 + dir * kv * dt);
      }

      const prevLives = world.lives;
      if (world.status === 'playing') B.step(world, dt);
      else {
        // ready / clear / gameover 状态下也让粒子与时间推进
        B.step(world, dt);
      }

      if (world.lives !== prevLives) syncHud();
      if (world.score !== syncHud._s) { syncHud._s = world.score; hScore.textContent = world.score; }

      // 连击提示
      if (world.combo >= 3 && world.combo !== syncHud._c) {
        showToast('连击 ×' + world.combo);
      }
      syncHud._c = world.combo;

      if (world.status === 'clear' && !ovClear.classList.contains('show')) {
        commitBest();
        $('clearScore').textContent = world.score;
        $('clearSub').textContent = '第 ' + world.level + ' 关完成 · 剩余 ' + world.lives + ' 命 · 最高连击 ' + world.bestCombo;
        ovClear.classList.add('show');
        running = false;
      }
      if (world.status === 'gameover' && !ovOver.classList.contains('show')) {
        commitBest();
        $('overScore').textContent = world.score;
        $('overSub').textContent = '到达第 ' + world.level + ' 关 · 最高连击 ' + world.bestCombo +
          (world.score >= save.best ? ' · 🏆 新纪录！' : ' · 最高纪录 ' + save.best);
        ovOver.classList.add('show');
        running = false;
      }
    }
    draw();
  }

  // ---- 启动 ----
  resize();
  world = B.createWorld({ level: 1 });
  hBest.textContent = save.best;
  requestAnimationFrame(loop);
})();
