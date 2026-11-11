/* ------------------------------------------------------------------
 * 弹球 · 打砖块 引擎（纯函数 + 可变世界对象）
 * 浏览器 / node 两用，零依赖。
 * 坐标系：原点左上，x 向右，y 向下。单位：逻辑像素。
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const LOGIC_W = 600;
  const LOGIC_H = 760;

  /* ---------------- 关卡生成 ---------------- */
  // 每关一个 pattern 函数：返回 [{c,r}] 或 true/false 表示该格是否有砖
  const PATTERNS = {
    // 满铺矩形，留空行
    solid: function (cols, rows) {
      return function (c, r) { return (c + r) % 7 !== 3; };
    },
    // 金字塔：越靠下越宽
    pyramid: function (cols, rows) {
      return function (c, r) {
        const mid = (cols - 1) / 2;
        return Math.abs(c - mid) <= (r + 1) * (cols / 2 / rows);
      };
    },
    // 棋盘
    checker: function (cols, rows) {
      return function (c, r) { return (c + r) % 2 === 0; };
    },
    // 菱形
    diamond: function (cols, rows) {
      return function (c, r) {
        const mx = (cols - 1) / 2, my = (rows - 1) / 2;
        return (Math.abs(c - mx) / (cols / 2)) + (Math.abs(r - my) / (rows / 2)) <= 1.15;
      };
    },
    // 拱门
    arch: function (cols, rows) {
      return function (c, r) {
        const mx = (cols - 1) / 2, my = (rows - 1) / 2;
        return Math.abs(c - mx) <= (rows - r) * (cols / 2 / rows) - 0.5 + (r < rows / 2 ? 0 : 0);
      };
    },
    // 稀疏随机（带种子）
    sparse: function (cols, rows) {
      let s = 12345;
      const rnd = function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
      const all = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push(rnd() < 0.68);
      return function (c, r) { return all[r * cols + c]; };
    }
  };

  const PATTERN_ORDER = ['pyramid', 'solid', 'checker', 'diamond', 'arch', 'sparse'];

  /**
   * 生成一个关卡的砖块数组。
   * @param {number} level 1-based
   */
  function buildLevel(level) {
    const cols = 10;
    const rows = Math.min(5 + Math.floor((level - 1) / 2), 8);
    const patternName = PATTERN_ORDER[(level - 1) % PATTERN_ORDER.length];
    const pattern = PATTERNS[patternName](cols, rows);

    const padX = 14, padY = 70, gap = 6;
    const bw = (LOGIC_W - padX * 2 - gap * (cols - 1)) / cols;
    const bh = 24;

    const bricks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!pattern(c, r)) continue;
        // HP：随关卡与行号上色，靠上更硬
        let hp = 1;
        if (level >= 3 && r < 2) hp = 2;
        if (level >= 6 && r === 0) hp = 3;
        bricks.push({
          id: bricks.length,
          x: padX + c * (bw + gap),
          y: padY + r * (bh + gap),
          w: bw,
          h: bh,
          hp: hp,
          maxHp: hp,
          row: r,
          col: c,
          alive: true
        });
      }
    }
    return { level: level, cols: cols, rows: rows, pattern: patternName, bricks: bricks };
  }

  /* ---------------- 世界初始化 ---------------- */
  function createWorld(opts) {
    opts = opts || {};
    const level = opts.level || 1;
    const lv = buildLevel(level);
    const paddleW = Math.max(70, 120 - (level - 1) * 8);
    return {
      w: LOGIC_W,
      h: LOGIC_H,
      level: level,
      pattern: lv.pattern,
      bricks: lv.bricks,
      paddle: { x: LOGIC_W / 2 - paddleW / 2, y: LOGIC_H - 46, w: paddleW, h: 14, vx: 0 },
      ball: { x: LOGIC_W / 2, y: LOGIC_H - 80, r: 8, vx: 0, vy: 0, speed: 300, stuck: true },
      particles: [],
      score: opts.score || 0,
      lives: opts.lives == null ? 3 : opts.lives,
      combo: 0,
      bestCombo: 0,
      status: 'ready', // ready | playing | dead | clear | gameover
      time: 0,
      shake: 0,
      flash: 0
    };
  }

  function aliveCount(world) {
    let n = 0;
    for (const b of world.bricks) if (b.alive) n++;
    return n;
  }

  const BASE_SPEED = 300;
  const MAX_SPEED = 620;

  function launch(world) {
    const b = world.ball;
    if (!b.stuck) return false;
    // 角度 ±30° 内随机，避免近乎水平
    const ang = (-Math.PI / 2) + (Math.random() - 0.5) * (Math.PI / 3);
    b.speed = BASE_SPEED + (world.level - 1) * 12;
    b.vx = Math.cos(ang) * b.speed;
    b.vy = Math.sin(ang) * b.speed;
    b.stuck = false;
    world.status = 'playing';
    return true;
  }

  function spawnParticles(world, x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 180;
      world.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 1,
        max: 0.5 + Math.random() * 0.5,
        color: color,
        size: 2 + Math.random() * 3
      });
    }
  }

  const HP_COLORS = ['#7d8590', '#ffd166', '#8ce99a', '#74c0fc'];
  function brickColor(b) {
    const idx = Math.min(b.maxHp, 3);
    return HP_COLORS[idx];
  }

  /* ---------------- 碰撞 ---------------- */
  // 圆与矩形碰撞，返回 {hit, nx, ny, depth} —— nx/ny 为法线方向
  function circleRect(cx, cy, cr, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 > cr * cr) return null;
    let n_x, n_y;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      n_x = dx / d; n_y = dy / d;
    } else {
      // 圆心在矩形内部：选最近的边
      const left = cx - rx, right = rx + rw - cx, top = cy - ry, bot = ry + rh - cy;
      const m = Math.min(left, right, top, bot);
      if (m === left) { n_x = -1; n_y = 0; }
      else if (m === right) { n_x = 1; n_y = 0; }
      else if (m === top) { n_x = 0; n_y = -1; }
      else { n_x = 0; n_y = 1; }
    }
    return { nx: n_x, ny: n_y, depth: cr - Math.sqrt(d2) };
  }

  /* ---------------- 主步进 ----------------
   * 固定步长 + 子步进（防止高速穿透）
   */
  function step(world, dt) {
    dt = Math.min(dt, 1 / 30); // 夹紧，防切页面回来瞬移
    world.time += dt;
    world.flash = Math.max(0, world.flash - dt * 3);
    world.shake = Math.max(0, world.shake - dt * 4);

    // 粒子
    for (let i = world.particles.length - 1; i >= 0; i--) {
      const p = world.particles[i];
      p.life -= dt;
      if (p.life <= 0) { world.particles.splice(i, 1); continue; }
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.995;
    }

    const ball = world.ball;
    const paddle = world.paddle;

    if (ball.stuck) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 2;
      return;
    }

    const totalV = Math.hypot(ball.vx, ball.vy) || 1;

    // 子步进：按位移不超过 r/1.5 切分
    const maxMove = Math.min(ball.r / 1.5, 4);
    const dist = totalV * dt;
    const steps = Math.max(1, Math.ceil(dist / maxMove));
    const sdt = dt / steps;

    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      // 左右墙
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); world.shake = 0.25; }
      if (ball.x + ball.r > world.w) { ball.x = world.w - ball.r; ball.vx = -Math.abs(ball.vx); world.shake = 0.25; }
      // 上墙
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); world.shake = 0.25; }

      // 挡板
      const ph = circleRect(ball.x, ball.y, ball.r, paddle.x, paddle.y, paddle.w, paddle.h);
      if (ph && ball.vy > 0) {
        ball.y = paddle.y - ball.r;
        // 击中点相对位置 -1..1 决定反弹角度
        const rel = Math.max(-1, Math.min(1, (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2)));
        const ang = rel * (Math.PI / 3); // 最多 ±60°
        const sp = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * 1.015);
        ball.vx = Math.sin(ang) * sp;
        ball.vy = -Math.cos(ang) * sp;
        world.shake = 0.18;
        world.combo = 0;
        spawnParticles(world, ball.x, paddle.y - 2, '#74c0fc', 5);
      }

      // 砖块：只检查附近
      let hitBrick = null;
      for (let i = 0; i < world.bricks.length; i++) {
        const b = world.bricks[i];
        if (!b.alive) continue;
        if (ball.x + ball.r < b.x || ball.x - ball.r > b.x + b.w) continue;
        if (ball.y + ball.r < b.y || ball.y - ball.r > b.y + b.h) continue;
        const res = circleRect(ball.x, ball.y, ball.r, b.x, b.y, b.w, b.h);
        if (res) { hitBrick = { brick: b, res: res }; break; }
      }

      if (hitBrick) {
        const b = hitBrick.brick, res = hitBrick.res;
        // 推出穿透
        ball.x += res.nx * (res.depth + 0.5);
        ball.y += res.ny * (res.depth + 0.5);
        // 反射
        if (Math.abs(res.nx) > Math.abs(res.ny)) ball.vx = Math.sign(res.nx) * Math.abs(ball.vx);
        else ball.vy = Math.sign(res.ny) * Math.abs(ball.vy);

        b.hp -= 1;
        world.combo += 1;
        world.bestCombo = Math.max(world.bestCombo, world.combo);
        const gained = 10 * (world.combo > 1 ? Math.min(world.combo, 8) : 1);
        world.score += gained;
        spawnParticles(world, b.x + b.w / 2, b.y + b.h / 2, brickColor(b), 8);
        world.shake = 0.3;
        if (b.hp <= 0) {
          b.alive = false;
          spawnParticles(world, b.x + b.w / 2, b.y + b.h / 2, brickColor(b), 12);
        }
        world.flash = Math.min(1, world.flash + 0.35);
      }

      // 掉出底部
      if (ball.y - ball.r > world.h) {
        world.lives -= 1;
        world.combo = 0;
        spawnParticles(world, ball.x, world.h - 10, '#ff6b6b', 18);
        if (world.lives <= 0) {
          world.status = 'gameover';
          ball.stuck = false;
          ball.vx = 0; ball.vy = 0;
        } else {
          ball.stuck = true;
          ball.vx = 0; ball.vy = 0;
          world.status = 'ready';
        }
        return;
      }
    }

    // 通关
    if (aliveCount(world) === 0 && world.status === 'playing') {
      world.status = 'clear';
      ball.stuck = true;
      ball.vx = 0; ball.vy = 0;
      world.score += 100 + world.lives * 50;
      world.flash = 1;
    }

    // 保底：速度过小或过于水平时纠正
    const sp2 = Math.hypot(ball.vx, ball.vy);
    if (sp2 > 0) {
      const minAng = 0.18; // 弧度，约 10°
      const vyN = Math.abs(ball.vy) / sp2;
      if (vyN < Math.sin(minAng)) {
        const sign = ball.vy >= 0 ? 1 : -1;
        ball.vy = sign * sp2 * Math.sin(minAng);
        const newVx = Math.sqrt(Math.max(0, sp2 * sp2 - ball.vy * ball.vy));
        ball.vx = Math.sign(ball.vx || 1) * newVx;
      }
    }
  }

  /* ---------------- 挡板输入 ---------------- */
  function movePaddle(world, x) {
    const p = world.paddle;
    p.x = Math.max(0, Math.min(world.w - p.w, x - p.w / 2));
  }

  /* ---------------- localStorage 存档 ---------------- */
  const SAVE_KEY = 'breakout-save-v1';
  function loadSave(storage) {
    try {
      const raw = storage.getItem(SAVE_KEY);
      if (!raw) return { best: 0, maxLevel: 1 };
      const o = JSON.parse(raw);
      return { best: o.best | 0, maxLevel: Math.max(1, o.maxLevel | 0) };
    } catch (e) { return { best: 0, maxLevel: 1 }; }
  }
  function saveSave(storage, data) {
    try { storage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  const API = {
    LOGIC_W, LOGIC_H, BASE_SPEED, MAX_SPEED,
    PATTERNS, PATTERN_ORDER,
    buildLevel, createWorld, launch, step, movePaddle, aliveCount,
    circleRect, brickColor, spawnParticles,
    loadSave, saveSave, SAVE_KEY
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Breakout = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
