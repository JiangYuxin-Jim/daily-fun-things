const P = '/home/admin/code/daily-fun-things/2026-11-09-wordle/';
const vm = require('vm');
const fs = require('fs');
const Core = require(P + 'core.js');
const W = require(P + 'words.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log('FAIL', name, 'got', g, 'want', w); }
}

/* ============ A. 评分算法（手算校验） ============ */
eq('A1 全绿', Core.scoreGuess('apple', 'apple'), [2, 2, 2, 2, 2]);
eq('A2 全灰', Core.scoreGuess('zzzzz', 'apple'), [0, 0, 0, 0, 0]);
eq('A3 仅存在', Core.scoreGuess('abcde', 'fghia'), [1, 0, 0, 0, 0]);
eq('A4 两个正确位', Core.scoreGuess('crane', 'slate'), [0, 0, 2, 0, 2]);
// allee(A,L,L,E,E) vs apple(A,P,P,L,E): a绿; p灰p灰; l(3)黄(答案剩1个l); e(4)绿
eq('A5 重复字母', Core.scoreGuess('allee', 'apple'), [2, 1, 0, 0, 2]);
// apple 只有 1 个 p；poppy 索引 2 的 p 与 apple[2]='p' 同位置 → 绿
// 所以正确结果 [1,0,2,0,0]：poppy[0] 黄、poppy[1]='o' 灰、poppy[2] 绿、poppy[3] 灰、y 灰
eq('A6 猜太多重复字母', Core.scoreGuess('poppy', 'apple'), [1, 0, 2, 0, 0]);
// 绿位与黄位同字母交叉：missy(m,i,s,s,y) 有两个 s；sissy(s,i,s,s,y)
// s(0)黄,i(1)绿,s(2)绿,s(3)黄(第 2 个 s),y(4)绿 → [0,2,2,2,2]
eq('A6b 绿位与黄位同字母', Core.scoreGuess('sissy', 'missy'), [0, 2, 2, 2, 2]);
// eerie(E,E,R,I,E) vs geese(G,E,E,S,E): g灰; e(1)黄; e(2)黄; s灰; e(4)绿
eq('A7 三位 e', Core.scoreGuess('eerie', 'geese'), [1, 2, 0, 0, 2]);
// level vs lever: l,e,v,e 全绿, r灰
eq('A8 全匹配+一个多余', Core.scoreGuess('lever', 'level'), [2, 2, 2, 2, 0]);
eq('A9 长度不符抛错', (() => { try { Core.scoreGuess('abc', 'abcd'); return 'no'; } catch (e) { return 'threw'; } })(), 'threw');
eq('A10 大小写不敏感', Core.scoreGuess('APPLE', 'Apple'), [2, 2, 2, 2, 2]);
eq('A11 isWin', [Core.isWin([2, 2, 2, 2, 2]), Core.isWin([2, 2, 2, 2, 1]), Core.isWin([])], [true, false, false]);

// 不变量反向校验：绿位字母必定相同；灰位字母必定不出现在答案「未变绿」的部分
let revBad = [];
const probes = ['crane', 'slate', 'apple', 'eerie', 'poppy', 'lever', 'sissy', 'added'];
for (const ans of W.ANSWERS) {
  for (const g of probes) {
    const s = Core.scoreGuess(g, ans);
    // 已用绿位占用的位置集合
    const greenPos = new Set();
    for (let i = 0; i < 5; i++) if (s[i] === 2) greenPos.add(i);
    // 该字母在答案中「未被绿位占用」的剩余数量
    const leftInAnswer = ch => {
      let c = 0;
      for (let i = 0; i < 5; i++) if (ans[i] === ch && !greenPos.has(i)) c++;
      return c;
    };
    // 已分配给黄位的数量（按扫描顺序）
    const usedByPresent = {};
    for (let i = 0; i < 5; i++) {
      if (s[i] === 2 && g[i] !== ans[i]) revBad.push(ans + '/' + g + '/green' + i);
      if (s[i] === 1) {
        if (g[i] === ans[i]) revBad.push(ans + '/' + g + '/present-but-green' + i);
        usedByPresent[g[i]] = (usedByPresent[g[i]] || 0) + 1;
        if (usedByPresent[g[i]] > leftInAnswer(g[i])) revBad.push(ans + '/' + g + '/present-over' + i);
      }
      if (s[i] === 0 && leftInAnswer(g[i]) > (usedByPresent[g[i]] || 0)) revBad.push(ans + '/' + g + '/absent' + i);
    }
  }
}
eq('A12 不变量反向校验（' + W.ANSWERS.length * probes.length + ' 局 × 5 格）', revBad.slice(0, 5), []);

/* ============ B. 键盘聚合 ============ */
eq('B1 取最高优先级', (() => {
  const m = Core.keyboardStates([
    { guess: 'crane', states: [2, 0, 1, 0, 0] },
    { guess: 'cried', states: [2, 1, 0, 2, 0] }
  ]);
  return [m.c, m.r, m.a, m.n, m.e, m.i, m.d];
})(), [2, 1, 1, 0, 2, 0, 0]);

/* ============ C. 困难模式 ============ */
eq('C1 空历史不拦截', Core.hardModeViolation('crane', []), null);
eq('C2 违反绿位', Core.hardModeViolation('slate', [{ guess: 'crane', states: [2, 0, 0, 0, 0] }]), '第 1 位必须是 C');
eq('C3 满足绿位', Core.hardModeViolation('slate', [{ guess: 'crane', states: [0, 2, 0, 0, 0] }]), '第 2 位必须是 R');
eq('C4 缺黄字母', Core.hardModeViolation('begin', [{ guess: 'crane', states: [0, 0, 1, 0, 0] }]), '必须包含至少 1 个 "A"');
eq('C5 含黄字母通过', Core.hardModeViolation('about', [{ guess: 'crane', states: [0, 0, 1, 0, 0] }]), null);

/* ============ D. 词库 ============ */
eq('D1 全 5 字母', W.ALL_GUESSES.filter(w => !/^[a-z]{5}$/.test(w)), []);
eq('D2 answers 是 guesses 子集', W.ANSWERS.every(w => W.SET.has(w)), true);
eq('D3 answers 无重复', new Set(W.ANSWERS).size, W.ANSWERS.length);
eq('D4 answers 数量够用', W.ANSWERS.length >= 500, true);
console.log('   词库：答案', W.ANSWERS.length, '| 可猜词', W.ALL_GUESSES.length);

/* ============ F. 候选过滤 / 提示 ============ */
const rowsF = [
  { guess: 'crane', states: Core.scoreGuess('crane', 'grape') },
  { guess: 'shout', states: Core.scoreGuess('shout', 'grape') }
];
const cands = Core.filterCandidates(W.ANSWERS, rowsF);
eq('F1 候选包含真答案', cands.includes('grape'), true);
eq('F2 候选全部与反馈一致', cands.every(w => rowsF.every(r => Core.scoreGuess(r.guess, w).join('') === r.states.join(''))), true);
const sug = Core.suggest(W.ANSWERS, W.ALL_GUESSES, rowsF);
eq('F3 提示候选数一致', sug.candidates, cands.length);
eq('F4 提示词合法', W.SET.has(sug.word), true);
eq('F5 无历史时的提示合法', W.SET.has(Core.suggest(W.ANSWERS, W.ALL_GUESSES, []).word), true);
console.log('   crane/shout 后 AI 建议:', sug.word, '| 剩余候选', sug.candidates);

/* ============ G. 确定性 RNG / 每日题 ============ */
const r1 = Core.makeRng(12345), r2 = Core.makeRng(12345);
eq('G1 同种子同序列', [r1(), r1(), r1()], [r2(), r2(), r2()]);
eq('G2 异种子异序列', Core.makeRng(1)() !== Core.makeRng(2)(), true);
function hashStr(s) {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}
const seen = new Set(), dayMap = new Map();
for (let d = 0; d < 400; d++) {
  const key = new Date(Date.UTC(2026, 10, 9 + d)).toISOString().slice(0, 10);
  const rng = Core.makeRng(hashStr(key + '|jinzi'));
  const w = W.ANSWERS[Math.floor(rng() * W.ANSWERS.length)];
  seen.add(w); dayMap.set(key, w);
}
eq('G3 400 天覆盖足够广', seen.size > 300, true);
eq('G4 同一天重复计算结果一致', (() => {
  const k = '2026-11-09';
  const a = W.ANSWERS[Math.floor(Core.makeRng(hashStr(k + '|jinzi'))() * W.ANSWERS.length)];
  const b = W.ANSWERS[Math.floor(Core.makeRng(hashStr(k + '|jinzi'))() * W.ANSWERS.length)];
  return a === b;
})(), true);
console.log('   400 天共', seen.size, '个不同答案；今天 2026-11-09 =', dayMap.get('2026-11-09'));

/* ============ H. 页面层：vm + DOM 桩 ============ */
function El(tag) {
  const el = {
    tagName: tag, children: [], style: {}, dataset: {}, textContent: '', _html: '',
    classList: {
      _s: new Set(), add() { for (const c of arguments) this._s.add(c); }, remove() { for (const c of arguments) this._s.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(ch) { this.children.push(ch); return ch; },
    addEventListener() {}, get offsetWidth() { return 100; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; if (v === '') el.children.length = 0; }
  });
  return el;
}
function makeCtx() {
  const els = {}, mem = {};
  const ctx = {
    document: {
      getElementById(id) { return els[id] || (els[id] = El('div')); },
      createElement: El, addEventListener() {}, body: El('body'), execCommand() { return true; }
    },
    localStorage: { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } },
    navigator: {}, URLSearchParams, JSON, Math, Object, Array, String, Number, Set, Date, RegExp, Error,
    setTimeout: (f) => { f(); return 0; }, clearTimeout() {},
    location: { search: '' }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['words.js', 'core.js', 'app.js']) vm.runInContext(fs.readFileSync(P + f, 'utf8'), ctx);
  ctx.__mem = mem;
  return ctx;
}
const H = makeCtx();
eq('H1 暴露测试 API', typeof H.Jinzi._onKey, 'function');
H.Jinzi._newGame({ mode: 'practice', hard: false });
eq('H2 练习 8 次机会', H.Jinzi._state().turns, 8);
eq('H3 答案是合法答案词', W.ANSWERS.includes(H.Jinzi._state().answer), true);

H.Jinzi._setCur(H.Jinzi._state().answer);
H.Jinzi._onKey('enter');
eq('H4 输对答案即获胜', [H.Jinzi._state().over, Core.isWin(H.Jinzi._state().rows[0].states)], [true, true]);

const W0 = W.ALL_GUESSES[0]; // 任意合法开局词，不硬编码
H.Jinzi._newGame({ mode: 'practice' });
H.Jinzi._setCur('zzzzz'); H.Jinzi._onKey('enter');
eq('H5 非法词被拒', H.Jinzi._state().rows.length, 0);
H.Jinzi._setCur('abc'); H.Jinzi._onKey('enter');
eq('H6 长度不足被拒', H.Jinzi._state().rows.length, 0);
H.Jinzi._setCur('abc'); H.Jinzi._onKey('back'); H.Jinzi._onKey('back');
eq('H7 退格生效', H.Jinzi._state().cur, 'a');
H.Jinzi._setCur(W.ALL_GUESSES[0]); H.Jinzi._onKey('f');
eq('H8 最多 5 位', H.Jinzi._state().cur, W.ALL_GUESSES[0]);
H.Jinzi._onKey('enter');
eq('H9 合法词入列', H.Jinzi._state().rows.length, 1);

// 输局
H.Jinzi._newGame({ mode: 'practice' });
const ansL = H.Jinzi._state().answer;
const pool = W.ALL_GUESSES.filter(w => w !== ansL);
for (let i = 0; i < 8; i++) { H.Jinzi._setCur(pool[i]); H.Jinzi._onKey('enter'); }
eq('H10 8 次用尽即结束', [H.Jinzi._state().over, H.Jinzi._state().rows.length], [true, 8]);
H.Jinzi._setCur('crane'); H.Jinzi._onKey('enter');
eq('H11 结束后不能再猜', H.Jinzi._state().rows.length, 8);

// 每日
H.Jinzi._newGame({ mode: 'daily' });
const d1 = H.Jinzi._state().answer;
H.Jinzi._newGame({ mode: 'daily' });
eq('H12 每日答案当天固定', [H.Jinzi._state().answer === d1, W.ANSWERS.includes(d1)], [true, true]);
console.log('   今天', H.Jinzi._dateKey(), '= 今词第', H.Jinzi._dayNumber(), '天，题目:', d1);

// 困难模式拦截：先落一手，再找一个违反提示的词，应被拒
H.Jinzi._newGame({ mode: 'practice', hard: true });
const g1 = H.Jinzi._state().answer;
H.Jinzi._setCur(g1); H.Jinzi._onKey('enter');
const rowsH = H.Jinzi._state().rows;
eq('H13a 困难模式首手放行', rowsH.length, 1);
let blocked = false;
if (rowsH.length === 1) {
  const violator = W.ALL_GUESSES.find(w => Core.hardModeViolation(w, rowsH));
  if (violator) {
    H.Jinzi._setCur(violator); H.Jinzi._onKey('enter');
    blocked = H.Jinzi._state().rows.length === 1;
  }
}
eq('H13 困难模式拦截违规词', blocked, true);

// 练习不计入每日统计
const C2 = makeCtx();
C2.Jinzi._newGame({ mode: 'practice' });
C2.Jinzi._setCur(C2.Jinzi._state().answer); C2.Jinzi._onKey('enter');
const saved = JSON.parse(C2.__mem['jinzi.v1']);
eq('H14 练习不计入每日统计', saved.stats.played, 0);

// 每日胜利计连胜
const C3 = makeCtx();
C3.Jinzi._newGame({ mode: 'daily' });
C3.Jinzi._setCur(C3.Jinzi._state().answer); C3.Jinzi._onKey('enter');
const s3 = JSON.parse(C3.__mem['jinzi.v1']).stats;
eq('H15 每日胜利计场次+连胜', [s3.played, s3.wins, s3.streak], [1, 1, 1]);

console.log('\n================  PASS ' + pass + '  FAIL ' + fail + '  ================');
process.exit(fail ? 1 : 0);
