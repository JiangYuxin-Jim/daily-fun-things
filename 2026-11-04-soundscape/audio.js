/* ============================================================
 * audio.js — Soundscape 音频引擎（纯 Web Audio 合成，零素材）
 * 挂在全局 window.SS
 * ============================================================ */
(function (global) {
  'use strict';

  const SS = global.SS = global.SS || {};

  /* ---------- 可复现随机数（用于白噪音种子 & 测试） ---------- */
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  SS.makeRng = makeRng;

  /* ---------- 1. 生成噪声缓冲（粉/棕/白） ----------
   * 采样率、声道数、种子都可指定 → 可在 Node 里反向校验
   */
  SS.buildNoise = function buildNoise(kind, lengthSec, sampleRate, seed) {
    const len = Math.max(1, Math.floor(lengthSec * sampleRate));
    const buf = new Float32Array(len);
    const rng = makeRng(seed || 12345);

    if (kind === 'white') {
      for (let i = 0; i < len; i++) buf[i] = rng() * 2 - 1;
    } else if (kind === 'pink') {
      // Paul Kellet 的 economical pink noise filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        buf[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = rng() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        buf[i] = last * 3.5;
      }
    } else {
      throw new Error('unknown noise kind: ' + kind);
    }

    // 归一化到 0.95 峰值，避免不同噪声音量不一致
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(buf[i]));
    if (peak > 0) {
      const g = 0.95 / peak;
      for (let i = 0; i < len; i++) buf[i] *= g;
    }
    return buf;
  };

  /* ---------- 2. 雨滴脉冲序列（用于测试瀑布粒度） ----------
   * 返回每个雨滴的 {t, amp}（t 单位秒）
   */
  SS.buildRainDrops = function buildRainDrops(durationSec, rate, seed) {
    const rng = makeRng(seed || 7);
    const drops = [];
    let t = 0;
    while (t < durationSec) {
      // 指数间隔 → 泊松过程（真实雨滴到达随机、非等距）
      t += -Math.log(1 - rng()) / rate;
      if (t >= durationSec) break;
      // 振幅偏小、偶尔大气泡：指数分布
      drops.push({ t: t, amp: 0.25 + 0.75 * Math.pow(rng(), 2.2) });
    }
    return drops;
  };

  /* ============================================================
   * 以下需要浏览器 AudioContext
   * ============================================================ */
  const ctxState = { ctx: null, master: null, analyser: null, started: false };

  function ensureCtx() {
    if (ctxState.ctx) return ctxState.ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) throw new Error('当前浏览器不支持 Web Audio API');
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);
    ctxState.ctx = ctx;
    ctxState.master = master;
    ctxState.analyser = analyser;
    return ctx;
  }
  SS.ensureCtx = ensureCtx;
  SS.getAnalyser = () => ctxState.analyser;
  SS.getCtx = () => ctxState.ctx;
  // 供 UI 层挂载混音总线的入口（master 之前）
  SS.getDestNode = function () {
    ensureCtx();
    return ctxState.master;
  };

  /* ---------- 循环噪声缓冲（时长 6s，避免可察觉循环点：首尾交叉淡化） ---------- */
  const noiseCache = {};
  function getNoiseBuffer(kind) {
    if (noiseCache[kind]) return noiseCache[kind];
    const ctx = ensureCtx();
    const sr = ctx.sampleRate;
    const sec = 6;
    const data = SS.buildNoise(kind, sec, sr, kind === 'pink' ? 4242 : 1337);
    // 首尾 0.5s 交叉淡化，消除循环接缝的"咔哒"
    const fade = Math.floor(0.5 * sr);
    const n = data.length;
    const out = new Float32Array(n);
    out.set(data);
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      out[i] = data[i] * w + data[n - fade + i] * (1 - w);
    }
    const buf = ctx.createBuffer(1, n, sr);
    buf.copyToChannel(out, 0);
    noiseCache[kind] = buf;
    return buf;
  }

  function noiseSource(kind, loop) {
    const ctx = ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(kind);
    src.loop = !!loop;
    return src;
  }

  function filter(type, freq, q) {
    const ctx = ensureCtx();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  function gain(v) {
    const ctx = ensureCtx();
    const g = ctx.createGain();
    g.gain.value = v == null ? 1 : v;
    return g;
  }

  /* ---------- 3. 每种声音的构造器 ----------
   * 每个返回 { out, stop(), params? }
   */
  SS.sounds = {

    /* 雨：粉噪音 + 宽带滤波 + 高频随机"雨点" */
    rain: function () {
      const ctx = ensureCtx();
      const out = gain(1);
      const src = noiseSource('pink', true);
      const hp = filter('highpass', 400, 0.7);
      const lp = filter('lowpass', 6500, 0.7);
      const body = gain(0.9);
      src.connect(hp); hp.connect(lp); lp.connect(body); body.connect(out);

      // 雨点敲击层：短噪声爆发
      const dropGain = gain(0.5);
      dropGain.connect(out);
      const dropBuf = getNoiseBuffer('white');
      let nextDrop = ctx.currentTime + 0.05;
      const iv = setInterval(() => {
        const now = ctx.currentTime;
        while (nextDrop < now + 0.25) {
          const s = ctx.createBufferSource();
          s.buffer = dropBuf;
          const bp = filter('bandpass', 2200 + Math.random() * 3200, 1.2);
          const g = gain(0.02 + Math.random() * 0.05);
          s.connect(bp); bp.connect(g); g.connect(dropGain);
          s.start(nextDrop, Math.random() * 4, 0.05);
          nextDrop += -Math.log(1 - Math.random()) / 45;
        }
        if (nextDrop < now) nextDrop = now + 0.02;
      }, 120);

      src.start();
      return {
        out: out,
        stop: function () { clearInterval(iv); try { src.stop(); } catch (e) {} }
      };
    },

    /* 海浪：棕噪音 + 慢速 LFO 调制低通频率与音量（0.08Hz ≈ 12s 一浪） */
    waves: function () {
      const ctx = ensureCtx();
      const out = gain(1);
      const src = noiseSource('brown', true);
      const lp = filter('lowpass', 600, 0.9);
      const swell = gain(0.5);
      src.connect(lp); lp.connect(swell);

      // 双 LFO 让浪高不一致
      const lfo1 = ctx.createOscillator();
      lfo1.frequency.value = 0.085;
      const lfo1g = gain(1);
      lfo1.connect(lfo1g);

      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.033;
      const lfo2g = gain(0.55);
      lfo2.connect(lfo2g);

      // 音量调制
      const ampMod = gain(0);
      lfo1g.connect(ampMod.gain);
      lfo2g.connect(ampMod.gain);
      // 偏移到正的基准
      const base = ctx.createConstantSource ? ctx.createConstantSource() : null;
      if (base) {
        base.offset.value = 0.62;
        base.connect(ampMod.gain);
        base.start();
      } else {
        ampMod.gain.value = 0.62;
      }
      swell.connect(ampMod);
      ampMod.connect(out);

      // 亮度随浪高变化
      const brightMod = gain(0);
      lfo1g.connect(brightMod.gain);
      brightMod.connect(lp.frequency);
      lp.frequency.value = 620;

      src.start(); lfo1.start(); lfo2.start();
      return {
        out: out,
        stop: function () {
          try { src.stop(); lfo1.stop(); lfo2.stop(); if (base) base.stop(); } catch (e) {}
        }
      };
    },

    /* 风：棕噪音 + 带通频率漂移 + 阵风包络 */
    wind: function () {
      const ctx = ensureCtx();
      const out = gain(1);
      const src = noiseSource('brown', true);
      const bp = filter('bandpass', 420, 1.6);
      const amp = gain(0.7);
      src.connect(bp); bp.connect(amp); amp.connect(out);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const depth = gain(0);
      lfo.connect(depth);
      depth.connect(bp.frequency);

      const gust = ctx.createOscillator();
      gust.frequency.value = 0.023;
      const gustDepth = gain(0);
      gust.connect(gustDepth);
      gustDepth.connect(amp.gain);

      const base = ctx.createConstantSource ? ctx.createConstantSource() : null;
      if (base) { base.offset.value = 0.72; base.connect(amp.gain); base.start(); }
      else amp.gain.value = 0.72;

      src.start(); lfo.start(); gust.start();
      return {
        out: out,
        stop: function () { try { src.stop(); lfo.stop(); gust.stop(); if (base) base.stop(); } catch (e) {} }
      };
    },

    /* 火：棕噪音低频 + 随机噼啪（短带通脉冲） */
    fire: function () {
      const ctx = ensureCtx();
      const out = gain(1);
      const src = noiseSource('brown', true);
      const lp = filter('lowpass', 900, 0.7);
      const hum = gain(0.75);
      src.connect(lp); lp.connect(hum); hum.connect(out);

      const crackleGain = gain(0.9);
      crackleGain.connect(out);
      const buf = getNoiseBuffer('white');
      let next = ctx.currentTime + 0.1;
      const iv = setInterval(() => {
        const now = ctx.currentTime;
        while (next < now + 0.3) {
          const s = ctx.createBufferSource();
          s.buffer = buf;
          const hp = filter('highpass', 900 + Math.random() * 2500, 0.8);
          const g = gain(0.04 + Math.random() * Math.random() * 0.22);
          s.connect(hp); hp.connect(g); g.connect(crackleGain);
          const dur = 0.01 + Math.random() * 0.045;
          s.start(next, Math.random() * 5, dur);
          next += -Math.log(1 - Math.random()) / 9;
        }
        if (next < now) next = now + 0.03;
      }, 150);

      src.start();
      return {
        out: out,
        stop: function () { clearInterval(iv); try { src.stop(); } catch (e) {} }
      };
    },

    /* 咖啡店：粉噪音低语层（带通 + 缓慢起伏） */
    cafe: function () {
      const ctx = ensureCtx();
      const out = gain(1);
      const src = noiseSource('pink', true);
      const bp = filter('bandpass', 800, 0.8);
      const lp = filter('lowpass', 2600, 0.7);
      const murmur = gain(0.9);
      src.connect(bp); bp.connect(lp); lp.connect(murmur); murmur.connect(out);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.19;
      const d = gain(0);
      lfo.connect(d); d.connect(murmur.gain);
      const base = ctx.createConstantSource ? ctx.createConstantSource() : null;
      if (base) { base.offset.value = 0.9; base.connect(murmur.gain); base.start(); }
      else murmur.gain.value = 0.9;

      src.start(); lfo.start();
      return {
        out: out,
        stop: function () { try { src.stop(); lfo.stop(); if (base) base.stop(); } catch (e) {} }
      };
    },

    /* 钢琴吟唱：五声音阶随机琶音 + 混响 */
    notes: function () {
      const ctx = ensureCtx();
      const out = gain(1);
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(2.6, 1.8);
      const wet = gain(0.55);
      const dry = gain(0.5);
      verb.connect(wet); wet.connect(out);
      dry.connect(out);

      // C 五声音阶（温暖、不会弹错）
      const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];
      let idx = 4;
      let timer = null;

      function pluck(freq, when, vel) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = freq * 2.002;
        const g = ctx.createGain();
        const g2 = ctx.createGain();
        const t = when;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vel, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(vel * 0.25, t + 0.010);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        const lp = filter('lowpass', 2400, 0.6);
        osc.connect(g); g.connect(lp);
        o2.connect(g2); g2.connect(lp);
        lp.connect(dry); lp.connect(verb);
        osc.start(t); osc.stop(t + 2.1);
        o2.start(t); o2.stop(t + 0.9);
      }

      function schedule() {
        if (!ctxState.started) return;
        const now = ctx.currentTime;
        const chordBase = scale[[0, 2, 4, 2][Math.floor(Math.random() * 4)]];
        pluck(chordBase, now + 0.02, 0.30);
        if (Math.random() < 0.6) pluck(chordBase * 1.5 > 1000 ? chordBase : chordBase * 1.5, now + 0.18, 0.18);
        const steps = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < steps; i++) {
          idx += (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
          idx = Math.max(0, Math.min(scale.length - 1, idx));
          pluck(scale[idx], now + 0.5 + i * (0.35 + Math.random() * 0.3), 0.12 + Math.random() * 0.1);
        }
        timer = setTimeout(schedule, 2400 + Math.random() * 2200);
      }
      schedule();

      return {
        out: out,
        stop: function () { clearTimeout(timer); }
      };
    }
  };

  /* 程序生成混响脉冲响应 */
  function makeImpulse(seconds, decay) {
    const ctx = ensureCtx();
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    const rng = makeRng(99);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        d[i] = (rng() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }
  SS.makeImpulse = makeImpulse;

  /* ---------- 4. 总线：主音量（平滑淡入淡出） ---------- */
  SS.setMaster = function (v) {
    if (!ctxState.master) return;
    const ctx = ctxState.ctx;
    ctxState.master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  };

  SS.resume = function () {
    ensureCtx();
    if (ctxState.ctx.state === 'suspended') return ctxState.ctx.resume();
    return Promise.resolve();
  };

  SS.markStarted = function (v) { ctxState.started = !!v; };
  SS.isStarted = () => ctxState.started;

  /* ---------- 5. 频谱快照（供可视化） ---------- */
  SS.getSpectrum = function (bins) {
    const an = ctxState.analyser;
    if (!an) return new Uint8Array(bins || 64).fill(0);
    const arr = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(arr);
    const n = bins || 64;
    const out = new Uint8Array(n);
    const step = arr.length / n;
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) { s += arr[j]; c++; }
      out[i] = c ? Math.round(s / c) : 0;
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SS;
  }
})(typeof window !== 'undefined' ? window : globalThis);
