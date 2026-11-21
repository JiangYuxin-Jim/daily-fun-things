/* aurora.js — 极光场：程序化 FBM 噪声 aurora 背景
 * 纯计算，可在 node 里 require 自检，也可在浏览器里当普通脚本加载。
 */
(function (root) {
  'use strict';

  // ---------- 可复现随机 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(x, y, seed) {
    // 全部用 Math.imul 保持 32 位整数语义，避免大数乘法丢精度变 NaN
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
    h = h | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 100000) / 100000;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // 值噪声 2D，返回 [0,1)
  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed);
    const d = hash2(xi + 1, yi + 1, seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // 分形布朗运动：多倍频噪声叠加
  function fbm(x, y, seed, octaves, lacunarity, gain) {
    octaves = octaves || 4;
    lacunarity = lacunarity || 2.0;
    gain = gain || 0.5;
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // 极光强度场：u 横向 0..1，v 纵向 0..1（0=天顶，1=地平线）
  // 一条竖向概率带 + 波纹扰动，返回 0..1 的亮度
  function auroraField(u, v, t, seed) {
    const band = 0.15 + 0.55 * fbm(u * 3.0 + t * 0.05, v * 1.2, seed, 4, 2.1, 0.55);
    const wave = 0.10 * Math.sin(u * 18.0 + t * 0.7 + seed % 7) +
                 0.07 * Math.sin(u * 31.0 - t * 1.1);
    const center = band + wave;
    const d = Math.abs(v - center);
    const width = 0.10 + 0.10 * fbm(u * 6.0 - t * 0.15, seed * 0.37, seed + 9, 3, 2.0, 0.5);
    // 竖向高度衰减：越靠近地平线越淡
    const heightAtten = Math.pow(Math.max(0, 1 - v), 1.6);
    // 横向细丝帘幕
    const curtain = 0.65 + 0.35 * fbm(u * 42.0 + t * 0.2, v * 4.0, seed + 5, 3, 2.3, 0.5);
    let intensity = Math.exp(-(d * d) / (2 * width * width)) * curtain * heightAtten;
    return Math.max(0, Math.min(1, intensity));
  }

  // 极光调色：低亮绿 → 中亮青 → 高亮紫/粉
  function auroraColor(intensity, warmth) {
    const stops = [
      { p: 0.0, c: [8, 30, 26] },
      { p: 0.3, c: [26, 210, 130] },
      { p: 0.65, c: [60, 230, 200] },
      { p: 1.0, c: [170, 120, 240] }
    ];
    let i = 0;
    while (i < stops.length - 2 && intensity > stops[i + 1].p) i++;
    const a = stops[i], b = stops[i + 1];
    const k = (intensity - a.p) / (b.p - a.p || 1);
    const mix = (x, y) => Math.round(x + (y - x) * Math.max(0, Math.min(1, k)));
    const r = mix(a.c[0], b.c[0]);
    const g = mix(a.c[1], b.c[1]);
    const bl = mix(a.c[2], b.c[2]);
    // warmth 让整体偏紫粉
    return [
      Math.min(255, Math.round(r + warmth * 60)),
      Math.min(255, Math.round(g - warmth * 40)),
      Math.min(255, Math.round(bl + warmth * 20))
    ];
  }

  // 采样整帧：返回 { w, h, data: Uint8ClampedArray }（RGBA）
  function renderFrame(w, h, t, opts) {
    opts = opts || {};
    const seed = opts.seed || 1337;
    const warmth = opts.warmth == null ? 0.15 : opts.warmth;
    const density = opts.density == null ? 1 : opts.density;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      // 夜空底色：天顶深蓝 → 地平线略亮
      const skyR = 4 + 10 * v, skyG = 6 + 12 * v, skyB = 22 + 18 * v;
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        let inten = auroraField(u, v, t, seed) * density;
        inten = Math.max(0, Math.min(1, inten));
        const c = auroraColor(inten, warmth);
        // 加性混合（屏幕模式）
        const idx = (y * w + x) * 4;
        data[idx] = 255 - (255 - skyR) * (255 - c[0] * inten) / 255;
        data[idx + 1] = 255 - (255 - skyG) * (255 - c[1] * inten) / 255;
        data[idx + 2] = 255 - (255 - skyB) * (255 - c[2] * inten) / 255;
        data[idx + 3] = 255;
      }
    }
    return { w, h, data };
  }

  // 一层亮度：0..255 的灰度图（供降级/测试用）
  function renderLuma(w, h, t, opts) {
    opts = opts || {};
    const seed = opts.seed || 1337;
    const density = opts.density == null ? 1 : opts.density;
    const out = new Float32Array(w * h);
    let sum = 0;
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const val = Math.max(0, Math.min(1, auroraField(x / (w - 1), v, t, seed) * density));
        out[y * w + x] = val;
        sum += val;
      }
    }
    out.mean = sum / (w * h);
    return out;
  }

  const api = { mulberry32, valueNoise, fbm, auroraField, auroraColor, renderFrame, renderLuma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Aurora = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
