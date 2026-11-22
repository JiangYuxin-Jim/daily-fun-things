/* tank.js — 桌面虚拟鱼缸的核心模拟
 * 无依赖。浏览器里用 <canvas>，Node 里可用假 ctx 跑自检（见 selftest.js）。
 * 设计要点：
 *  - 鱼用「分离/对齐/聚群」三力 + 气泡/边界避让，纯向量积分，无外部库
 *  - 鱼食下沉后鱼会朝它游，吃到就饱食度+；太久没人喂 -> 饥饿 -> 靠近水底
 *  - 水质 = 鱼越多/时间越久越浑；喂多了更浑（食物残渣）
 *  - 水面气泡、水草摆动、光柱，全部程序化绘制，零素材
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  const NAMES = ['小橘', '锦鲤', '豆豆', '蓝波', '闪电', '胖丁', '银线', '小满', '青瓷', '咕噜',
    '月牙', '葡萄', '芒果', '老张', '团子', '飞鱼', '琥珀', '小旋', '沉舟', '浮生'];

  const KINDS = [
    // body / fin / belly
    { body: '#ff8f4d', fin: '#ffb877', belly: '#ffe0c4', tag: '金鱼' },
    { body: '#4bb6ff', fin: '#8fd8ff', belly: '#d9f2ff', tag: '蓝箭' },
    { body: '#f2d24b', fin: '#fff0a8', belly: '#fff9d9', tag: '柠檬' },
    { body: '#e2649a', fin: '#ffa8c9', belly: '#ffe2ee', tag: '绯月' },
    { body: '#63d6b0', fin: '#a8f0dc', belly: '#ddfff4', tag: '翡翠' },
    { body: '#b39bff', fin: '#d8ccff', belly: '#eee8ff', tag: '紫烟' },
    { body: '#dfe7ee', fin: '#ffffff', belly: '#ffffff', tag: '白云' }
  ];

  class Fish {
    constructor(w, h, kind) {
      this.kind = kind || pick(KINDS);
      this.name = pick(NAMES) + '#' + ((Math.random() * 90 + 10) | 0);
      this.x = rnd(0.15, 0.85) * w;
      this.y = rnd(0.2, 0.8) * h;
      this.vx = rnd(-30, 30);
      this.vy = rnd(-12, 12);
      this.size = rnd(0.8, 1.45);
      this.len = 26 * this.size;
      this.ang = Math.atan2(this.vy, this.vx);
      this.phase = Math.random() * TAU;
      this.speed = rnd(26, 44);
      this.hunger = Math.random();      // 0 饱 -> 1 饿
      this.petT = 0;                    // 被摸后的余韵
      this.wander = rnd(0, TAU);
      this.depthPref = rnd(0.15, 0.9);  // 偏好水深
    }
  }

  class Tank {
    constructor(canvas, opts) {
      this.cv = canvas;
      this.ctx = canvas.getContext ? canvas.getContext('2d') : null;
      this.headless = !this.ctx;
      this.w = (canvas && canvas.width) || 960;
      this.h = (canvas && canvas.height) || 540;
      this.baseW = this.w; this.baseH = this.h;
      this.time = 0;
      this.paused = false;
      this.fish = [];
      this.food = [];
      this.bubbles = [];
      this.weeds = [];
      this.motes = [];
      this.waste = 0;          // 杂质累积 0..1
      this.temp = 24;
      this.clarity = 1;
      this.lastTs = 0;
      this._raf = null;
      this.cols = [{x:0.16,h:0.5,c:'#1f7a5a'},{x:0.36,h:0.34,c:'#2d9c6d'},
                   {x:0.62,h:0.44,c:'#1b6b57'},{x:0.82,h:0.28,c:'#33a97b'},{x:0.94,h:0.38,c:'#22795f'}]
        .map(k => ({ x: k.x * this.w, h: k.h * this.h, c: k.c, ph: Math.random() * TAU, sway: rnd(0.7, 1.5) }));

      this.setSize(this.w, this.h);
      const n = (opts && opts.fish) || 7;
      for (let i = 0; i < n; i++) this.fish.push(new Fish(this.w, this.h));
      for (let i = 0; i < 26; i++) this.bubbles.push(this.newBubble());
      for (let i = 0; i < 70; i++) this.motes.push({ x: Math.random() * this.w, y: Math.random() * this.h,
        r: rnd(0.6, 1.9), sp: rnd(2, 9), ph: Math.random() * TAU });
    }

    setSize(w, h) {
      this.w = w; this.h = h;
      this.weeds = this.cols.map(c => ({ x: c.x / this.baseW * w, h: c.h / this.baseH * h,
        c: c.c, ph: c.ph, sway: c.sway }));
      this.sand = h * 0.9;
    }

    newBubble() {
      return { x: rnd(0.04, 0.96) * this.w, y: rnd(0.4, 1) * this.h, r: rnd(1.2, 4), sp: rnd(14, 38) };
    }

    addFish() {
      if (this.fish.length >= 24) return null;
      const f = new Fish(this.w, this.h);
      this.fish.push(f);
      return f;
    }

    feedAt(x, y) {
      for (let i = 0; i < 4; i++) {
        this.food.push({ x: x + rnd(-9, 9), y: y + rnd(-9, 9), vy: 0, r: rnd(1.6, 2.6), eaten: false });
      }
      this.waste = clamp(this.waste + 0.006, 0, 1);
    }

    feedRandom(n) {
      const count = n || 14;
      const cx = rnd(0.2, 0.8) * this.w, cy = this.h * 0.06;
      for (let i = 0; i < count; i++) {
        this.food.push({ x: clamp(cx + rnd(-70, 70), 6, this.w - 6), y: cy + rnd(0, 26),
          vy: 0, r: rnd(1.6, 2.8), eaten: false });
      }
      this.waste = clamp(this.waste + count * 0.0022, 0, 1);
      return count;
    }

    fishAt(x, y) {
      let best = null, bd = 1e9;
      for (const f of this.fish) {
        const d = Math.hypot(f.x - x, f.y - y);
        if (d < f.len * 0.9 && d < bd) { bd = d; best = f; }
      }
      return best;
    }

    pet(f) { f.petT = 1.6; f.hunger = clamp(f.hunger - 0.15, 0, 1); }

    togglePause() { this.paused = !this.paused; return this.paused; }

    hud() {
      const avg = this.fish.length ? this.fish.reduce((s, f) => s + f.hunger, 0) / this.fish.length : 0;
      const q = this.clarity > 0.8 ? '清洁' : this.clarity > 0.55 ? '一般' : this.clarity > 0.32 ? '浑浊' : '该换水了';
      return { fish: this.fish.length, temp: this.temp, quality: q, clarity: this.clarity, avgHunger: avg };
    }

    /* ---------- 模拟一步，dt 秒 ---------- */
    step(dt) {
      dt = clamp(dt, 0, 0.05);
      this.time += dt;

      // 水质缓慢变差（鱼多更快）
      this.waste = clamp(this.waste + dt * (0.0006 + this.fish.length * 0.00018), 0, 1);
      this.clarity += ((1 - this.waste * 0.85) - this.clarity) * Math.min(1, dt * 0.5);
      this.temp += ((24 + Math.sin(this.time * 0.13) * 0.6) - this.temp) * Math.min(1, dt * 0.3);

      // 鱼食下沉
      for (const p of this.food) {
        if (p.eaten) continue;
        p.vy = Math.min(p.vy + dt * 22, 26);
        p.y += p.vy * dt;
        p.x += Math.sin(this.time * 2 + p.y * 0.05) * dt * 6;
        if (p.y > this.sand - 2) { p.y = this.sand - 2; p.vy = 0; p.rest = (p.rest || 0) + dt; }
      }
      // 沉底太久融化（少量杂质）
      for (const p of this.food) if (p.rest > 6) { p.eaten = true; this.waste = clamp(this.waste + 0.004, 0, 1); }
      this.food = this.food.filter(p => !p.eaten);

      const fishes = this.fish;
      const W = this.w, H = this.h;

      for (let i = 0; i < fishes.length; i++) {
        const f = fishes[i];
        let ax = 0, ay = 0;

        // 1) 分离 + 对齐（只看近邻）
        let nNear = 0, avx = 0, avy = 0;
        for (let j = 0; j < fishes.length; j++) {
          if (i === j) continue;
          const o = fishes[j];
          const dx = f.x - o.x, dy = f.y - o.y;
          const d2 = dx * dx + dy * dy;
          const R = 70 * f.size;
          if (d2 < R * R && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (1 - d / R);
            ax += (dx / d) * push * 90;
            ay += (dy / d) * push * 90;
            avx += o.vx; avy += o.vy; nNear++;
          }
        }
        if (nNear) {
          ax += (avx / nNear - f.vx) * 0.55;
          ay += (avy / nNear - f.vy) * 0.55;
        }

        // 2) 找吃的
        let target = null, td = 1e9;
        if (f.hunger > 0.18) {
          for (const p of this.food) {
            if (p.eaten) continue;
            const d = Math.hypot(p.x - f.x, p.y - f.y);
            if (d < td) { td = d; target = p; }
          }
        }
        if (target && td < 320) {
          const d = Math.max(td, 1);
          ax += (target.x - f.x) / d * 150;
          ay += (target.y - f.y) / d * 150;
          if (td < f.len * 0.55) { target.eaten = true; f.hunger = clamp(f.hunger - 0.3, 0, 1); }
        }

        // 3) 漫游（Perlin 味的手写噪声）+ 深度偏好
        f.wander += dt * rnd(-3, 3);
        ax += Math.cos(f.wander * 1.7 + f.phase) * 26;
        ay += Math.sin(f.wander * 1.1 + f.phase) * 14;
        const wantY = H * (f.hunger > 0.7 ? 0.8 : f.depthPref);
        ay += (wantY - f.y) * 0.35;

        // 4) 边界（水面不能出去）
        const pad = 46 * f.size;
        if (f.x < pad) ax += (pad - f.x) * 6;
        if (f.x > W - pad) ax -= (f.x - (W - pad)) * 6;
        if (f.y < pad) ay += (pad - f.y) * 6;
        if (f.y > this.sand - pad * 0.6) ay -= (f.y - (this.sand - pad * 0.6)) * 7;

        // 5) 被摸了就怯生生加速一下
        if (f.petT > 0) { f.petT -= dt; ax += rnd(-40, 40); ay += rnd(-30, 30); }

        // 饥饿缓慢增长
        f.hunger = clamp(f.hunger + dt * 0.012, 0, 1);

        // 积分：给加速度一点噪声，鱼看起来不那么机械
        f.vx += ax * dt;
        f.vy += ay * dt;
        const sp = Math.hypot(f.vx, f.vy);
        const maxSp = f.speed * (target && td < 220 ? 1.9 : 1) * (f.petT > 0 ? 1.6 : 1);
        const minSp = f.speed * 0.35;
        if (sp > maxSp) { f.vx = f.vx / sp * maxSp; f.vy = f.vy / sp * maxSp; }
        else if (sp < minSp && sp > 0.01) { f.vx = f.vx / sp * minSp; f.vy = f.vy / sp * minSp; }

        f.x += f.vx * dt;
        f.y += f.vy * dt;

        // 硬边界兜底
        f.x = clamp(f.x, 10, W - 10);
        f.y = clamp(f.y, 10, this.sand - 8);

        // 朝向平滑跟随速度
        if (sp > 3) {
          const want = Math.atan2(f.vy, f.vx);
          let diff = ((want - f.ang + Math.PI * 3) % TAU) - Math.PI;
          f.ang += diff * Math.min(1, dt * 6);
        }
        f.phase += dt * (4 + sp * 0.08);
      }

      // 气泡
      for (const b of this.bubbles) {
        b.y -= b.sp * dt;
        b.x += Math.sin(this.time * 1.5 + b.y * 0.02) * dt * 7;
        if (b.y < -6) { const nb = this.newBubble(); b.x = nb.x; b.y = this.sand - rnd(0, 20); b.r = nb.r; b.sp = nb.sp; }
      }
      // 悬浮微尘
      for (const m of this.motes) {
        m.y -= m.sp * dt * 0.25;
        m.x += Math.sin(this.time * 0.8 + m.ph) * dt * 4;
        if (m.y < 0) { m.y = this.h; m.x = Math.random() * this.w; }
      }
    }

    /* ---------- 绘制 ---------- */
    draw() {
      const c = this.ctx;
      if (!c) return;
      const W = this.w, H = this.h, t = this.time;

      // 背景渐变（越浑越绿）
      const murk = 1 - this.clarity;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgb(' + (26 + murk * 14) + ',' + (108 - murk * 18) + ',' + (140 - murk * 44) + ')');
      g.addColorStop(0.55, 'rgb(' + (16 + murk * 10) + ',' + (68 - murk * 12) + ',' + (98 - murk * 30) + ')');
      g.addColorStop(1, 'rgb(' + (8 + murk * 8) + ',' + (34 - murk * 6) + ',' + (52 - murk * 14) + ')');
      c.fillStyle = g; c.fillRect(0, 0, W, H);

      // 光柱
      c.save();
      c.globalAlpha = 0.06 + Math.sin(t * 0.6) * 0.015;
      for (let i = 0; i < 4; i++) {
        const x = W * (0.14 + i * 0.24) + Math.sin(t * 0.3 + i) * 22;
        c.beginPath();
        c.moveTo(x, 0); c.lineTo(x + 90, 0); c.lineTo(x + 210, H); c.lineTo(x + 40, H);
        c.closePath();
        const lg = c.createLinearGradient(0, 0, 0, H);
        lg.addColorStop(0, 'rgba(190,240,255,1)'); lg.addColorStop(1, 'rgba(190,240,255,0)');
        c.fillStyle = lg; c.fill();
      }
      c.restore();

      // 沙底
      const s = this.sand;
      c.beginPath();
      c.moveTo(0, H);
      c.lineTo(0, s);
      for (let x = 0; x <= W; x += 24) {
        c.lineTo(x, s + Math.sin(x * 0.012 + 1.2) * 7 + Math.sin(x * 0.035) * 3);
      }
      c.lineTo(W, H); c.closePath();
      const sg = c.createLinearGradient(0, s - 10, 0, H);
      sg.addColorStop(0, '#e6d2a4'); sg.addColorStop(1, '#8f7a52');
      c.fillStyle = sg; c.fill();

      // 水草
      for (const wd of this.weeds) {
        const segs = 9;
        c.beginPath();
        c.moveTo(wd.x, s + 4);
        for (let i = 1; i <= segs; i++) {
          const p = i / segs;
          const sway = Math.sin(t * 1.1 + wd.ph + p * 2.6) * 16 * p * wd.sway;
          c.lineTo(wd.x + sway + Math.sin(i * 2.1 + wd.ph) * 4, s + 4 - wd.h * p);
        }
        c.strokeStyle = wd.c; c.lineWidth = 5; c.lineCap = 'round';
        c.stroke();
      }

      // 悬浮微尘
      c.fillStyle = 'rgba(220,245,255,.22)';
      for (const m of this.motes) { c.beginPath(); c.arc(m.x, m.y, m.r, 0, TAU); c.fill(); }

      // 气泡
      for (const b of this.bubbles) {
        c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU);
        c.strokeStyle = 'rgba(220,250,255,.45)'; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, TAU);
        c.fillStyle = 'rgba(255,255,255,.5)'; c.fill();
      }

      // 鱼食
      for (const p of this.food) {
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU);
        c.fillStyle = '#f6c453'; c.fill();
        c.strokeStyle = 'rgba(255,240,190,.7)'; c.lineWidth = .8; c.stroke();
      }

      // 鱼
      for (const f of this.fish) drawFish(c, f, t);

      // 水面
      c.beginPath(); c.moveTo(0, 0);
      for (let x = 0; x <= W; x += 16) {
        c.lineTo(x, 10 + Math.sin(x * 0.014 + t * 1.4) * 4 + Math.sin(x * 0.05 - t) * 1.6);
      }
      c.lineTo(W, 0); c.closePath();
      c.fillStyle = 'rgba(160,225,245,.16)'; c.fill();

      // 玻璃反光
      const gg = c.createLinearGradient(0, 0, W, H);
      gg.addColorStop(0, 'rgba(255,255,255,.055)');
      gg.addColorStop(0.35, 'rgba(255,255,255,0)');
      gg.addColorStop(1, 'rgba(255,255,255,.03)');
      c.fillStyle = gg; c.fillRect(0, 0, W, H);

      // 浑浊雾
      if (murk > 0.02) {
        c.fillStyle = 'rgba(110,150,90,' + (murk * 0.17) + ')';
        c.fillRect(0, 0, W, H);
      }
    }

    frame(ts) {
      if (!this.lastTs) this.lastTs = ts;
      const dt = Math.min((ts - this.lastTs) / 1000, 0.06);
      this.lastTs = ts;
      if (!this.paused) this.step(dt);
      this.draw();
    }

    start() {
      if (this.headless) return;
      const loop = ts => { this.frame(ts); this._raf = root.requestAnimationFrame(loop); };
      this._raf = root.requestAnimationFrame(loop);
    }
  }

  function drawFish(c, f, t) {
    const len = f.len, hgt = len * 0.46;
    c.save();
    c.translate(f.x, f.y);
    c.rotate(f.ang);
    const dir = Math.cos(f.ang) >= 0 ? 1 : -1;
    c.scale(1, dir > 0 ? 1 : 1); // 保持鱼身不倒挂
    if (dir < 0) c.rotate(0);

    // 尾巴
    const wag = Math.sin(f.phase) * 0.42;
    c.save();
    c.translate(-len * 0.42, 0);
    c.rotate(wag);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(-len * 0.3, -hgt * 0.85, -len * 0.55, -hgt * 0.15);
    c.quadraticCurveTo(-len * 0.42, 0, -len * 0.55, hgt * 0.15);
    c.quadraticCurveTo(-len * 0.3, hgt * 0.85, 0, 0);
    c.fillStyle = f.kind.fin; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    c.restore();

    // 背鳍
    c.beginPath();
    c.moveTo(-len * 0.2, -hgt * 0.35);
    c.quadraticCurveTo(-len * 0.05, -hgt * 1.15, len * 0.14, -hgt * 0.32);
    c.closePath();
    c.fillStyle = f.kind.fin; c.globalAlpha = 0.8; c.fill(); c.globalAlpha = 1;

    // 身体
    c.beginPath();
    c.ellipse(0, 0, len * 0.52, hgt * 0.5, 0, 0, TAU);
    const bg = c.createLinearGradient(0, -hgt * 0.5, 0, hgt * 0.5);
    bg.addColorStop(0, f.kind.body);
    bg.addColorStop(1, f.kind.belly);
    c.fillStyle = bg; c.fill();

    // 胸鳍
    c.beginPath();
    c.ellipse(len * 0.04, hgt * 0.16, len * 0.14, hgt * 0.16, 0.5 + Math.sin(f.phase * 1.3) * 0.3, 0, TAU);
    c.fillStyle = f.kind.fin; c.globalAlpha = 0.75; c.fill(); c.globalAlpha = 1;

    // 眼睛
    const ex = len * 0.3, ey = -hgt * 0.13;
    c.beginPath(); c.arc(ex, ey, len * 0.085, 0, TAU);
    c.fillStyle = '#fff'; c.fill();
    c.beginPath(); c.arc(ex + len * 0.02, ey, len * 0.048, 0, TAU);
    c.fillStyle = '#10222c'; c.fill();
    c.beginPath(); c.arc(ex + len * 0.035, ey - len * 0.02, len * 0.017, 0, TAU);
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fill();

    // 被摸时冒出爱心
    if (f.petT > 0.9) {
      c.globalAlpha = (f.petT - 0.9) / 0.7;
      c.fillStyle = '#ff7fa8';
      c.font = (len * 0.5 | 0) + 'px sans-serif';
      c.fillText('♥', len * 0.1, -hgt * 1.4);
      c.globalAlpha = 1;
    }
    c.restore();
  }

  root.Tank = Tank;
  root.Fish = Fish;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Tank, Fish };
})(typeof window !== 'undefined' ? window : globalThis);
