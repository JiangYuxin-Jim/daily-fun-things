/* synth.js — 键盘音效引擎核心
 * 不依赖 Web Audio 也能算：这里负责「按键 → 声音参数」的映射、
 * PCM 合成（WAV 导出）、以及节拍/连击判定。
 * 浏览器端用同一份参数喂给 Web Audio；Node 端直接合成 PCM 做自测与导出。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBSynth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 音色预设 ----------
  // 每种音色用「打击声(click) + 尾音(tail)」两层描述
  var PRESETS = {
    typewriter: {
      name: '复古打字机',
      desc: '机械弹簧 + 金属撞击，闷响后带一点回弹',
      click: { freq: 1800, decay: 0.028, noise: 0.85, hp: 700, amp: 0.9, sweep: -900 },
      tail: { freq: 260, decay: 0.09, noise: 0.25, hp: 120, amp: 0.35, sweep: -120 },
      pitchJitter: 0.06,
      seed: 11
    },
    thock: {
      name: '麻将 thock',
      desc: '闷厚木质低频，越敲越上瘾',
      click: { freq: 520, decay: 0.05, noise: 0.6, hp: 80, amp: 1.0, sweep: -260 },
      tail: { freq: 150, decay: 0.16, noise: 0.1, hp: 40, amp: 0.5, sweep: -60 },
      pitchJitter: 0.03,
      seed: 23
    },
    clack: {
      name: '青轴 clack',
      desc: '清脆高频，室友的噩梦',
      click: { freq: 3200, decay: 0.02, noise: 0.95, hp: 1600, amp: 0.95, sweep: -1400 },
      tail: { freq: 900, decay: 0.05, noise: 0.3, hp: 500, amp: 0.3, sweep: -400 },
      pitchJitter: 0.05,
      seed: 37
    },
    bubble: {
      name: '气泡啵啵',
      desc: '圆润上滑的电子啵，敲字像在捏泡泡',
      click: { freq: 420, decay: 0.055, noise: 0.05, hp: 60, amp: 0.85, sweep: 620 },
      tail: { freq: 900, decay: 0.06, noise: 0.0, hp: 200, amp: 0.25, sweep: 300 },
      pitchJitter: 0.09,
      seed: 53
    },
    laser: {
      name: '激光束',
      desc: '高频下坠扫频，科幻感拉满',
      click: { freq: 2400, decay: 0.07, noise: 0.2, hp: 900, amp: 0.8, sweep: -2000 },
      tail: { freq: 700, decay: 0.1, noise: 0.0, hp: 200, amp: 0.2, sweep: -500 },
      pitchJitter: 0.04,
      seed: 71
    },
    woodblock: {
      name: '木鱼',
      desc: '一声一声，敲着敲着心就静了',
      click: { freq: 1150, decay: 0.035, noise: 0.25, hp: 300, amp: 0.9, sweep: -500 },
      tail: { freq: 470, decay: 0.13, noise: 0.02, hp: 100, amp: 0.45, sweep: -120 },
      pitchJitter: 0.02,
      seed: 89
    },
    spacebar: {
      name: '老式空格砰',
      desc: '只有空格这种大键位才配得上的沉重',
      click: { freq: 130, decay: 0.11, noise: 0.7, hp: 30, amp: 1.0, sweep: -60 },
      tail: { freq: 70, decay: 0.2, noise: 0.08, hp: 20, amp: 0.4, sweep: -20 },
      pitchJitter: 0.02,
      seed: 101
    }
  };

  // ---------- 可复现随机数 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // 键位分组：不同大键位的音高偏移（让左右手/大键有区分感）
  var GROUP_SHIFT = {
    normal: 0,
    space: -0.55,
    enter: -0.4,
    backspace: -0.3,
    modifier: -0.15,
    arrow: 0.12
  };

  function keyGroup(code) {
    if (!code) return 'normal';
    if (code === 'Space') return 'space';
    if (code === 'Enter' || code === 'NumpadEnter') return 'enter';
    if (code === 'Backspace' || code === 'Delete') return 'backspace';
    if (/^(Shift|Control|Alt|Meta|CapsLock|Tab)/.test(code)) return 'modifier';
    if (/^(Arrow|Page|Home|End)/.test(code)) return 'arrow';
    return 'normal';
  }

  /** 按键 → 声音参数（含音高抖动、键位偏移、连击加成） */
  function paramsFor(presetName, opts) {
    opts = opts || {};
    var p = PRESETS[presetName] || PRESETS.thock;
    var rand = opts.rand || Math.random;
    var group = keyGroup(opts.code);
    var shift = GROUP_SHIFT[group] || 0;
    var jitter = 1 + (rand() * 2 - 1) * p.pitchJitter;
    var combo = opts.combo || 0;
    // 连击加成：最多把音高拉高 12%
    var comboBoost = Math.min(combo, 24) / 24 * 0.12;
    var factor = Math.pow(2, shift + comboBoost) * jitter;
    var vel = typeof opts.velocity === 'number' ? opts.velocity : 1;
    function vary(layer) {
      return {
        freq: layer.freq * factor,
        sweep: layer.sweep * factor,
        decay: layer.decay,
        noise: layer.noise,
        hp: layer.hp * factor,
        amp: layer.amp * vel
      };
    }
    return {
      preset: presetName,
      group: group,
      factor: factor,
      click: vary(p.click),
      tail: vary(p.tail)
    };
  }

  // ---------- PCM 合成 ----------
  var SR = 44100;

  function renderLayer(layer, len, rand) {
    var buf = new Float32Array(len);
    var phase = 0;
    for (var i = 0; i < len; i++) {
      var t = i / SR;
      var env = Math.exp(-t / layer.decay);
      if (env < 0.0005) break;
      var f = layer.freq + layer.sweep * t;
      if (f < 20) f = 20;
      phase += 2 * Math.PI * f / SR;
      var tone = Math.sin(phase);
      var n = layer.noise > 0 ? (rand() * 2 - 1) : 0;
      buf[i] = (tone * (1 - layer.noise) + n * layer.noise) * env * layer.amp;
    }
    return buf;
  }

  /** 把一组参数渲染成 {left: Float32Array, right} 的立体声样本 */
  function render(params, opts) {
    opts = opts || {};
    var rand = opts.rand || mulberry32((PRESETS[params.preset] || {}).seed || 7);
    var dur = 0.35;
    var len = Math.floor(SR * dur);
    var a = renderLayer(params.click, len, rand);
    var b = renderLayer(params.tail, len, rand);
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) out[i] = a[i] + b[i] * 0.9;
    // 归一化，避免削顶
    var peak = 0;
    for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0.98) {
      var k = 0.98 / peak;
      for (i = 0; i < len; i++) out[i] *= k;
    }
    return out;
  }

  function toWavBuffer(samples, sampleRate) {
    sampleRate = sampleRate || SR;
    var n = samples.length;
    var buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + n * 2, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);          // PCM
    buf.writeUInt16LE(1, 22);          // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(n * 2, 40);
    for (var i = 0; i < n; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    return buf;
  }

  /** 把预设里「名字里带 p 的那种」…… 中文名拼音首字母，用于彩蛋 */
  function presetKeys() { return Object.keys(PRESETS); }

  // ---------- 节奏/连击统计 ----------
  function ComboTracker() {
    this.last = 0;
    this.combo = 0;
    this.best = 0;
    this.window = 420; // ms 内算连击
  }
  ComboTracker.prototype.hit = function (now) {
    if (now - this.last <= this.window) this.combo++;
    else this.combo = 1;
    this.last = now;
    if (this.combo > this.best) this.best = this.combo;
    return this.combo;
  };
  ComboTracker.prototype.reset = function () { this.last = 0; this.combo = 0; };

  /** 每分钟击键数 */
  function kpm(counts, spanMs) {
    if (!spanMs || spanMs <= 0) return 0;
    return Math.round(counts / (spanMs / 60000));
  }

  return {
    PRESETS: PRESETS,
    SR: SR,
    paramsFor: paramsFor,
    render: render,
    renderLayer: renderLayer,
    toWavBuffer: toWavBuffer,
    mulberry32: mulberry32,
    keyGroup: keyGroup,
    ComboTracker: ComboTracker,
    kpm: kpm,
    presetKeys: presetKeys
  };
});
