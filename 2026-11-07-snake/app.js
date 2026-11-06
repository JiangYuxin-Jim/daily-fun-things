/* Snake UI — 渲染 + 输入 + 节奏控制。逻辑全部来自 core.js（可单测）。 */
(function () {
  'use strict';
  var S = window.SnakeCore;
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  var COLS = 20, ROWS = 20;
  var BEST_KEY = 'snake-breathing-best-v1';

  // ---------- 状态 ----------
  var game = null;
  var wrapping = false;
  var aiOn = false;
  var soundOn = localStorage.getItem('snake-sound') !== 'off';
  var acc = 0;            // 累积时间
  var lastTs = 0;
  var raf = 0;
  var particles = [];     // 吃食物粒子
  var popups = [];        // 飘分
  var best = +(localStorage.getItem(BEST_KEY) || 0);
  var shake = 0;
  var deathFlash = 0;
  var hintDir = null;
  var hintTimer = 0;
  var pulseT = 0;

  $('best').textContent = best;

  // ---------- 音效：WebAudio 现场合成，零素材 ----------
  var actx = null;
  function ac() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur, type, vol, slideTo) {
    if (!soundOn) return;
    var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, a.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + 0.02);
  }
  function sfxEat() { beep(660, 0.09, 'triangle', 0.1, 990); }
  function sfxDie() {
    beep(220, 0.35, 'sawtooth', 0.09, 70);
    setTimeout(function () { beep(140, 0.4, 'square', 0.05, 50); }, 70);
  }
  function sfxTurn() { beep(420, 0.03, 'sine', 0.03); }

  // ---------- 布局 ----------
  var CSS = { pad: 10, gap: 2, cell: 0 };
  function layout() {
    var w = cv.width;
    var inner = w - CSS.pad * 2;
    CSS.cell = (inner - CSS.gap * (COLS - 1)) / COLS;
  }
  layout();

  function cellRect(x, y) {
    return {
      x: CSS.pad + x * (CSS.cell + CSS.gap),
      y: CSS.pad + y * (CSS.cell + CSS.gap),
      s: CSS.cell
    };
  }

  // ---------- 绘制 ----------
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

  function drawBoard() {
    var w = cv.width;
    ctx.clearRect(0, 0, w, w);
    // 底
    var g = ctx.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, '#08121c');
    g.addColorStop(1, '#0a0d18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    // 格线
    ctx.fillStyle = 'rgba(90,180,170,.055)';
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var r = cellRect(x, y);
        roundRect(r.x, r.y, r.s, r.s, Math.max(2, r.s * 0.22));
        ctx.fill();
      }
    }
    // 穿墙模式：边框换成青色虚线
    if (wrapping) {
      ctx.save();
      ctx.strokeStyle = 'rgba(89,216,255,.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.strokeRect(CSS.pad - 4, CSS.pad - 4, w - (CSS.pad - 4) * 2, w - (CSS.pad - 4) * 2);
      ctx.restore();
    }
  }

  function drawFood(t) {
    if (!game || !game.food) return;
    var r = cellRect(game.food.x, game.food.y);
    var cx = r.x + r.s / 2, cy = r.y + r.s / 2;
    var breathe = 1 + Math.sin(t / 320) * 0.09;
    var rad = r.s * 0.3 * breathe;
    ctx.save();
    // 光晕
    var gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.s * 1.15);
    gg.addColorStop(0, 'rgba(255,93,122,.42)');
    gg.addColorStop(0.5, 'rgba(255,93,122,.12)');
    gg.addColorStop(1, 'rgba(255,93,122,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(cx, cy, r.s * 1.15, 0, Math.PI * 2); ctx.fill();
    // 果肉
    var g2 = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.35, rad * 0.1, cx, cy, rad);
    g2.addColorStop(0, '#ffb3c1');
    g2.addColorStop(0.55, '#ff5d7a');
    g2.addColorStop(1, '#c81f45');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    // 小高光
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.arc(cx - rad * 0.32, cy - rad * 0.38, rad * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawSnake(t) {
    if (!game) return;
    var sn = game.snake;
    // 从尾到头画，头压在上面
    for (var i = sn.length - 1; i >= 0; i--) {
      var c = sn[i];
      var r = cellRect(c.x, c.y);
      var frac = i / Math.max(1, sn.length - 1);        // 0=头 1=尾
      var inset = r.s * (0.02 + frac * 0.13);
      var size = r.s - inset * 2;
      var isHead = i === 0;
      // 呼吸波：沿线传播的亮度
      var wave = Math.sin(t / 260 - i * 0.55) * 0.5 + 0.5;
      var alpha = isHead ? 1 : 0.92 - frac * 0.28 + wave * 0.08;
      var col = isHead ? '47,227,168' : '32,190,145';
      var lum = isHead ? 6 : Math.round(wave * 22);
      ctx.save();
      if (game.status === 'over') {
        ctx.globalAlpha = 0.35;
      }
      // 外发光（头更亮）
      if (isHead || i < 4) {
        ctx.shadowColor = 'rgba(47,227,168,' + (isHead ? 0.85 : 0.35) + ')';
        ctx.shadowBlur = isHead ? 22 : 10;
      }
      ctx.fillStyle = 'rgb(' + (col.split(',').map(function (v, k) {
        return k === 2 ? +v + lum : v;
      }).join(',')) + ')';
      ctx.globalAlpha *= alpha;
      roundRect(r.x + inset, r.y + inset, size, size, size * 0.34);
      ctx.fill();
      ctx.restore();

      // 头部眼睛
      if (isHead) {
        ctx.save();
        ctx.globalAlpha = game.status === 'over' ? 0.5 : 1;
        var d = S.DIRS[game.dir];
        var ex = r.x + r.s / 2 + d.x * r.s * 0.16;
        var ey = r.y + r.s / 2 + d.y * r.s * 0.16;
        var px = -d.y, py = d.x; // 垂直方向
        var off = r.s * 0.17, er = Math.max(1.4, r.s * 0.085);
        ctx.fillStyle = '#04140f';
        ctx.beginPath(); ctx.arc(ex + px * off, ey + py * off, er, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex - px * off, ey - py * off, er, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawHint() {
    if (!hintDir || !game || game.status !== 'running') return;
    var r = cellRect(game.snake[0].x, game.snake[0].y);
    var d = S.DIRS[hintDir];
    var cx = r.x + r.s / 2, cy = r.y + r.s / 2;
    ctx.save();
    ctx.globalAlpha = 0.85 * (0.6 + 0.4 * Math.sin(Date.now() / 180));
    ctx.strokeStyle = '#59d8ff';
    ctx.lineWidth = Math.max(2, r.s * 0.09);
    ctx.lineCap = 'round';
    var a = r.s * 1.15;
    ctx.beginPath();
    ctx.moveTo(cx + d.x * a * 0.35, cy + d.y * a * 0.35);
    ctx.lineTo(cx + d.x * a, cy + d.y * a);
    ctx.stroke();
    // 箭头
    var px = -d.y, py = d.x;
    ctx.beginPath();
    ctx.moveTo(cx + d.x * a + px * a * 0.28, cy + d.y * a + py * a * 0.28);
    ctx.lineTo(cx + d.x * a * 1.35, cy + d.y * a * 1.35);
    ctx.lineTo(cx + d.x * a - px * a * 0.28, cy + d.y * a - py * a * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 0.0009 * dt; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (var j = popups.length - 1; j >= 0; j--) {
      var q = popups[j];
      q.y -= dt * 0.035; q.life -= dt;
      if (q.life <= 0) { popups.splice(j, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = '#ff8fa3';
      ctx.font = 'bold ' + Math.round(cv.width * 0.032) + 'px ui-monospace,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(q.text, q.x, q.y);
      ctx.restore();
    }
  }

  function burst(x, y) {
    var center = cellRect(x, y);
    var cx = center.x + center.s / 2, cy = center.y + center.s / 2;
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      var sp = 0.08 + Math.random() * 0.16;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 3,
        life: 380 + Math.random() * 260, max: 640,
        color: i % 3 === 0 ? '#ffb3c1' : (i % 3 === 1 ? '#ff5d7a' : '#ffd166')
      });
    }
    popups.push({ x: cx, y: cy - 6, text: '+10', life: 620, max: 620 });
  }

  // ---------- 主循环 ----------
  function resize() {
    // 画布物理分辨率跟随容器宽度，保持 1:1 方形
    var stageW = cv.parentElement.clientWidth || 720;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var size = Math.round(stageW * dpr);
    if (cv.width !== size) { cv.width = size; cv.height = size; layout(); }
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dt = Math.min(80, ts - lastTs);
    lastTs = ts;
    pulseT = ts;

    resize();

    if (game && game.status === 'running') {
      acc += dt;
      var interval = S.tickInterval(game);
      var steps = 0;
      while (acc >= interval && steps < 4 && game.status === 'running') {
        acc -= interval;
        steps++;
        doStep();
        interval = S.tickInterval(game);
      }
      if (aiOn) {
        hintTimer -= dt;
        if (hintTimer <= 0) { hintDir = S.bfsFirstMove(game); hintTimer = 120; }
      }
    } else {
      acc = 0;
    }

    render(dt);
  }

  function doStep() {
    if (!game || game.status !== 'running') return;
    var foodBefore = game.food ? { x: game.food.x, y: game.food.y } : null;
    var ev = S.step(game, { wrap: wrapping });

    if (ev.died) {
      sfxDie();
      shake = 1;
      deathFlash = 1;
      onDeath();
      return;
    }
    if (ev.ate && foodBefore) {
      burst(foodBefore.x, foodBefore.y);
      sfxEat();
      if (ev.won) { onWin(); updateHud(); return; }
    }
    updateHud();
  }

  function render(dt) {
    ctx.save();
    if (shake > 0) {
      var m = shake * 10;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      shake = Math.max(0, shake - dt / 260);
    }
    drawBoard();
    drawFood(pulseT);
    if (game) drawSnake(pulseT);
    drawHint();
    drawParticles(dt);
    if (deathFlash > 0) {
      ctx.fillStyle = 'rgba(255,70,100,' + (deathFlash * 0.22) + ')';
      ctx.fillRect(0, 0, cv.width, cv.width);
      deathFlash = Math.max(0, deathFlash - dt / 420);
    }
    ctx.restore();
  }

  // ---------- HUD / 覆盖层 ----------
  function updateHud() {
    if (!game) return;
    $('score').textContent = game.score;
    $('len').textContent = game.snake.length;
    var itv = S.tickInterval(game);
    $('spd').textContent = (170 / itv).toFixed(1) + '×';
    if (game.score > best) {
      best = game.score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
      $('best').textContent = best;
    } else if (best > 0) {
      $('best').textContent = best;
    }
  }

  function showOverlay(title, text, scoreStr, isNew) {
    $('ovTitle').textContent = title;
    $('ovText').innerHTML = text;
    $('ovScore').style.display = scoreStr != null ? 'block' : 'none';
    $('ovScore').textContent = scoreStr || '';
    $('ovNew').style.display = isNew ? 'block' : 'none';
    $('ov').classList.remove('hide');
  }
  function hideOverlay() { $('ov').classList.add('hide'); }

  function onDeath() {
    var isNew = game.score > 0 && game.score >= best;
    showOverlay(
      game.deathReason === 'self' ? '咬到自己了' : '撞墙了',
      game.deathReason === 'self' ? '头撞上身体 —— 转身前先看清楚尾巴。<br>按 <kbd>R</kbd> 或点按钮再来一局。'
                                  : '墙不是可选项。<br>按 <kbd>R</kbd> 或点按钮再来一局。',
      game.score, isNew
    );
    $('btnStart').textContent = '再来一局';
    updateHud();
  }

  function onWin() {
    showOverlay('盘无虚席', '你把整个棋盘填满了 —— 这基本不可能。<br>截个图留念吧，然后重开。', game.score, true);
    $('btnStart').textContent = '再来一局';
    confetti();
  }

  function confetti() {
    for (var i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * cv.width, y: -20,
        vx: (Math.random() - 0.5) * 0.12, vy: Math.random() * 0.18,
        r: 2 + Math.random() * 4, life: 1600, max: 1600,
        color: ['#2fe3a8', '#59d8ff', '#ffd166', '#ff5d7a'][i % 4]
      });
    }
  }

  // ---------- 控制 ----------
  function startGame() {
    game = S.createGame({ cols: COLS, rows: ROWS });
    acc = 0; lastTs = 0;
    particles.length = 0; popups.length = 0;
    hintDir = null; hintTimer = 0;
    hideOverlay();
    updateHud();
    $('btnPause').textContent = '⏸ 暂停';
    ac();
  }

  function togglePause() {
    if (!game || (game.status !== 'running' && game.status !== 'paused')) return;
    if (game.status === 'running') {
      game.status = 'paused';
      showOverlay('已暂停', '喝口水。<br>按 <kbd>空格</kbd> 或点按钮继续。');
      $('btnStart').textContent = '继续';
      $('btnPause').textContent = '▶ 继续';
    } else {
      game.status = 'running';
      lastTs = 0;
      hideOverlay();
      $('btnPause').textContent = '⏸ 暂停';
    }
  }

  function turn(dir) {
    if (!game) return;
    if (game.status === 'paused') return;
    if (game.status !== 'running') return;
    if (S.queueDir(game, dir)) {
      sfxTurn();
      if (aiOn) { hintDir = S.bfsFirstMove(game); hintTimer = 400; }
    }
  }

  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right'
  };
  window.addEventListener('keydown', function (e) {
    if (KEYMAP[e.key]) {
      e.preventDefault();
      if (!game || game.status === 'over' || game.status === 'won') {
        // 结束后按方向键直接重开
        startGame();
      }
      turn(KEYMAP[e.key]);
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!game || game.status === 'over' || game.status === 'won') startGame();
      else togglePause();
      return;
    }
    if (e.key === 'r' || e.key === 'R') { startGame(); return; }
    if (e.key === 'Escape' && game && game.status === 'running') togglePause();
  }, { passive: false });

  // 触摸滑动
  var touchStart = null;
  cv.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  cv.addEventListener('touchend', function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) { touchStart = null; return; }
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
    else turn(dy > 0 ? 'down' : 'up');
    touchStart = null;
  }, { passive: true });

  Array.prototype.forEach.call(document.querySelectorAll('.dpad button'), function (b) {
    b.addEventListener('click', function () { turn(b.dataset.dir); });
  });

  $('btnStart').addEventListener('click', function () {
    if (game && game.status === 'paused') togglePause();
    else startGame();
  });
  $('btnPause').addEventListener('click', togglePause);

  $('btnAi').addEventListener('click', function () {
    aiOn = !aiOn;
    $('btnAi').classList.toggle('on', aiOn);
    hintDir = null;
    hintTimer = 0;
    $('tip').textContent = aiOn ? '教练已开启：青色箭头是 BFS 算出的最短路径方向（不保证不死）' : '纯前端 · 零依赖 · 不上传任何数据';
  });

  $('btnWrap').addEventListener('click', function () {
    wrapping = !wrapping;
    $('btnWrap').classList.toggle('on', wrapping);
  });

  $('btnSound').addEventListener('click', function () {
    soundOn = !soundOn;
    localStorage.setItem('snake-sound', soundOn ? 'on' : 'off');
    $('btnSound').textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) sfxTurn();
  });
  $('btnSound').textContent = soundOn ? '🔊' : '🔇';

  // 切走页面自动暂停
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game && game.status === 'running') togglePause();
  });

  // 站立画面也画一个盘面
  game = S.createGame({ cols: COLS, rows: ROWS });
  updateHud();
  raf = requestAnimationFrame(frame);
  window.addEventListener('resize', resize);

  window.__snake = {
    get game() { return game; },
    start: startGame,
    turn: turn
  };
})();
