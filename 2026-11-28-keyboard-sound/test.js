// test.js — 自测：参数映射确定性、PCM 合成、WAV 头、连击与 KPM
const fs = require('fs');
const path = require('path');
const K = require('./synth.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg); }
}

console.log('[1] 预设清单');
const keys = K.presetKeys();
ok(keys.length === 7, '有 7 个音色预设: ' + keys.join(','));

console.log('[2] 参数映射确定性');
const rand = K.mulberry32(42);
const p1 = K.paramsFor('typewriter', { code: 'KeyA', rand: K.mulberry32(42) });
const p2 = K.paramsFor('typewriter', { code: 'KeyA', rand: K.mulberry32(42) });
ok(p1.factor === p2.factor, '同种子 → 同 factor (' + p1.factor.toFixed(4) + ')');
const space = K.paramsFor('thock', { code: 'Space', rand: K.mulberry32(1) });
const normal = K.paramsFor('thock', { code: 'KeyF', rand: K.mulberry32(1) });
ok(space.factor < normal.factor, '空格比普通键低沉 (' + space.factor.toFixed(3) + ' < ' + normal.factor.toFixed(3) + ')');
const c0 = K.paramsFor('bubble', { code: 'KeyG', combo: 0, rand: K.mulberry32(3) });
const c9 = K.paramsFor('bubble', { code: 'KeyG', combo: 24, rand: K.mulberry32(3) });
ok(c9.factor > c0.factor, '连击 24 提高音高 ' + (c9.factor / c0.factor).toFixed(3));

console.log('[3] PCM 合成');
let hasSound = 0;
keys.forEach(function (k) {
  const s = K.render(K.paramsFor(k, { code: 'KeyJ', rand: K.mulberry32(5) }), { rand: K.mulberry32(5) });
  let peak = 0, energy = 0;
  for (let i = 0; i < s.length; i++) { peak = Math.max(peak, Math.abs(s[i])); energy += s[i] * s[i]; }
  const rms = Math.sqrt(energy / s.length);
  ok(peak > 0.2 && peak <= 0.9801 && rms > 0.005, k + ' peak=' + peak.toFixed(3) + ' rms=' + rms.toFixed(4));
  if (peak > 0.2) hasSound++;
});
ok(hasSound === keys.length, '全部预设都有有效波形');

console.log('[4] WAV 导出');
const samples = K.render(K.paramsFor('clack', { code: 'KeyK', rand: K.mulberry32(9) }));
const wav = K.toWavBuffer(samples);
ok(wav.slice(0, 4).toString() === 'RIFF' && wav.slice(8, 12).toString() === 'WAVE', 'WAV 头正确');
ok(wav.readUInt32LE(4) === 36 + samples.length * 2, 'RIFF 尺寸字段正确');
ok(wav.readUInt32LE(24) === K.SR, '采样率 ' + K.SR);
const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'clack-demo.wav'), wav);
ok(fs.statSync(path.join(outDir, 'clack-demo.wav')).size === wav.length, '写出 samples/clack-demo.wav (' + wav.length + ' 字节)');

console.log('[5] 节拍与 KPM');
const t = new K.ComboTracker();
[0, 200, 400, 1000, 1100].forEach(function (ms) { t.hit(ms); });
ok(t.combo === 2, '间隔 1000ms 打断连击后 combo 重置为 2（实际 ' + t.combo + '）');
ok(t.best === 3, '最佳连击 = 3（实际 ' + t.best + '）');
ok(K.kpm(120, 60000) === 120, 'KPM 计算 120/60s = 120');
ok(K.kpm(60, 30000) === 120, 'KPM 计算 60/30s = 120');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
