/* 交互式粒子宇宙 · 核心物理引擎（零依赖，可在 Node 下无 DOM 运行） */
(function (root) {
  'use strict';

  // 可复现的伪随机数（mulberry32）
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 创建 N 个粒子，分布在一个圆盘内（半径 1 归一化）
  // 质量按面积均匀分布：更贴近真实的旋转盘，圆盘自引力 ≈ 常数，不会炸锅
  function createParticles(count, seed) {
    const rng = makeRng(seed || 1);
    const ps = new Array(count);
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 0.85 + 0.04;
      ps[i] = {
        x: Math.cos(ang) * r,
        y: Math.sin(ang) * r,
        vx: -Math.sin(ang) * r * 0.9,
        vy: Math.cos(ang) * r * 0.9,
        m: (0.6 + rng() * 1.4) * (0.35 + r * 1.3),
        hue: 195 + rng() * 130
      };
    }
    return ps;
  }

  // 一步物理：引力（软化的 1/r^2）+ 极轻的阻尼 + 中心软化阱
  // opts: { dt, G, soft, damping, anchor }
  //   anchor>0 时对整团施加指向原点的弱回复力，避免“散成星尘”后失去结构
  function step(particles, opts) {
    const dt = opts.dt;
    const G = opts.G;
    const soft = opts.soft || 0.02;
    const damping = opts.damping || 1;
    const anchor = opts.anchor || 0;
    const n = particles.length;
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      let ax = 0, ay = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const q = particles[j];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d2 = dx * dx + dy * dy + soft * soft;
        const invd = 1 / Math.sqrt(d2);
        const f = (G * q.m) * invd * invd * invd; // /d^3 * d
        ax += dx * f;
        ay += dy * f;
      }
      if (anchor > 0) {
        // 只在外围生效：r < 1 时不加，避免压扁核心
        const r = Math.hypot(p.x, p.y);
        if (r > 1) {
          const k = (anchor * (r - 1)) / r;
          // 硬限速，保证任何参数下都不会飞出去
          p.vx *= 0.98;
          p.vy *= 0.98;
          ax -= p.x * k;
          ay -= p.y * k;
        }
      }
      p.vx = (p.vx + ax * dt) * damping;
      p.vy = (p.vy + ay * dt) * damping;
    }
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    return particles;
  }

  // 鼠标/触屏“搅拌”：对附近粒子施加冲量
  function stir(particles, cx, cy, strength, radius) {
    const r2 = radius * radius;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const w = (1 - d / radius) * strength;
        p.vx += (dx / d) * w;
        p.vy += (dy / d) * w;
      }
    }
  }

  // 统计：总能量 / 转动惯量 / 质心，用于 HUD 与自检
  function stats(particles) {
    let ke = 0, comX = 0, comY = 0, m = 0, maxR = 0;
    for (const p of particles) {
      ke += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
      comX += p.x * p.m;
      comY += p.y * p.m;
      m += p.m;
    }
    if (m > 0) { comX /= m; comY /= m; }
    for (const p of particles) {
      const r = Math.hypot(p.x, p.y);
      if (r > maxR) maxR = r;
    }
    return { kinetic: ke, comX, comY, mass: m, maxR, count: particles.length };
  }

  const api = { makeRng, createParticles, step, stir, stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cosmos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
