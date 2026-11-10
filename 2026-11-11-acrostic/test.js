const C = require('./core.js');

const cases = ['今天很好', '江雨欣', '每日小作品', '风花雪月', '清风明月', '夜深了', '努力加油'];
console.log('字库:', Object.keys(C.POOL).length, '词:', C.BIGRAMS.size, '韵部:', C.RHYMES.length);

let fail = 0, wordHit = 0, wordSpots = 0, rhHit = 0, rhTotal = 0;
for (const t of cases) {
  const clean = Array.from(t).filter(c => /[\u4e00-\u9fa5]/.test(c)).join('');
  if (clean.length < 2) continue;
  for (const len of [5, 7]) {
    for (const seed of [1, 2]) {
      const r = C.compose(clean, { len, seed });
      const head = r.lines.map(l => l[0]).join('');
      if (head !== clean) { console.log('HEAD MISMATCH', t, head); fail++; }
      if (!r.lines.every(l => l.length === len)) { console.log('LEN MISMATCH', t, len); fail++; }
      const sc = C.rhymeScore(r);
      rhHit += sc.hit; rhTotal += sc.total;
      if (sc.hit !== sc.total) { console.log('韵脚未命中:', t, len, r.poem.replace(/\n/g, ' / ')); fail++; }
      // 成词率
      for (const line of r.lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          wordSpots++;
          if (C.BIGRAMS.has(line[i] + line[i + 1])) wordHit++;
        }
      }
      if (seed === 1) console.log(`【${clean}】${len}言 · ${r.rhymeLabel}\n` + r.lines.map(l => '  ' + l).join('\n'));
    }
  }
}
// 可复现 / 变化
const a = C.compose('今天很好', { len: 5, seed: 7 }).poem;
const b = C.compose('今天很好', { len: 5, seed: 7 }).poem;
if (a !== b) { console.log('不可复现!'); fail++; }
if (a === C.compose('今天很好', { len: 5, seed: 8 }).poem) { console.log('seed 无效!'); fail++; }
// 异常路径
try { C.compose('a'); fail++; console.log('未抛错'); } catch (e) { console.log('单字拦截 OK:', e.message); }
try { C.compose('一二三四五六七八九'); fail++; } catch (e) { console.log('超长拦截 OK:', e.message); }
// 指定韵部
const rr = C.compose('星辰大海', { len: 7, rhyme: 'a' });
console.log('指定韵部 a →', rr.rhyme, rr.rhymeLabel, rr.lines.map(l => l.slice(-1)).join(''));

console.log(`\n成词率 ${wordHit}/${wordSpots} = ${(wordHit / wordSpots * 100).toFixed(1)}%  押韵 ${rhHit}/${rhTotal}`);
console.log(fail === 0 ? 'ALL OK ✅' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
