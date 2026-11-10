/* 藏头诗机 · 纯函数引擎（浏览器 / node 两用）
 * 无外部依赖：内置意象字库 + 双字词库 + 宽韵表。
 * 思路：每句首字固定，其余按「双字词接龙」推进 —— 已定字之后优先接成词的下一个字，
 *       成词失败时退化为单字加权抽取；偶数句句尾强制押韵；全诗不重字。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AcrosticCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 宽韵表（今音近似归并，只收单念押韵的字）----------
  const RHYMES = [
    { name: 'an', label: '寒山韵', chars: '山关寒还颜间天年眠川前然烟闲欢残安散畔慢岸雁远愿暖看' },
    { name: 'ao', label: '萧条韵', chars: '高霄遥朝桥萧条寥笑少老好道草照晓鸟' },
    { name: 'ing', label: '青星韵', chars: '青明清星晴庭亭听影景醒静井' },
    { name: 'iang', label: '江乡韵', chars: '香长乡江光霜凉窗望阳芳伤茫' },
    { name: 'ong', label: '东风韵', chars: '空东风红中同钟浓松穹雄' },
    { name: 'i', label: '诗枝韵', chars: '诗时枝知思期迟稀离溪' },
    { name: 'ou', label: '秋流韵', chars: '秋流舟楼愁游悠休留头' },
    { name: 'u', label: '书如韵', chars: '书如初孤雨舞古去处暮路独' },
    { name: 'a', label: '花家韵', chars: '花家霞涯沙华茶佳节斜夜' },
    { name: 'en', label: '春尘韵', chars: '人春深尘神晨门村魂' },
    { name: 'in', label: '心音韵', chars: '心音林吟阴琴襟' },
    { name: 'iu', label: '酒久韵', chars: '酒久有手后守' },
    { name: 'ei', label: '飞归韵', chars: '飞归稀衣微非悲醉泪' },
    { name: 'ue', label: '雪月韵', chars: '雪月夜别绝歇' }
  ];

  const RHYME_OF = {};
  RHYMES.forEach((g, i) => { for (const ch of g.chars) if (!(ch in RHYME_OF)) RHYME_OF[ch] = i; });

  // ---------- 意象字库 ----------
  const POOL = {};
  const GROUPS = [
    ['风花雪月云雨霜露霞烟岚雾溪泉涧谷峰峦川河海湖江浪潮波岸堤桥野原林松柏竹柳梅兰菊荷莲草木叶枝根萍苔藤', 'n'],
    ['春夏秋冬晨昏夕晓夜暮朝午晚宵旦昼岁年日时月旬季候寒暑冷暖温凉热', 'n'],
    ['山石岩崖洞壑岭径路关城楼台阁亭榭渡舟帆桅篙渔樵农耕织', 'n'],
    ['光照映飞洒落升沉悬垂浮流涌卷展散聚叠起穿入出', 'v'],
    ['望见闻听看观临登涉渡泛游踏归去来往还留待问寻识忆念', 'v'],
    ['笑吟唱舞醉卧眠饮酌赋咏书题写画绣抚捻弄弹吹拂', 'v'],
    ['清幽静远淡雅浓浅深高低广长苍茫旷空寂渺辽微细', 'a'],
    ['孤独闲半满新故旧余几多千上万数无有', 'a'],
    ['心安意情思梦魂愁欢悲喜恨忆愿期盼慰怜爱', 'e'],
    ['诗词歌赋文章墨纸笺笔砚书卷画篇曲韵句字语声律', 'n'],
    ['盏杯壶觞樽瓶席酒茶香炉案琴箫笛筝钟鼓磬', 'n'],
    ['人间世尘俗身客乡途程江湖心事怀抱胸臆', 'b'],
    ['闲静悠然从容自在逍遥恬淡欢温软轻柔和暖', 'e']
  ];
  GROUPS.forEach(([chars, tag]) => { for (const c of chars) if (!POOL[c]) POOL[c] = tag; });
  RHYMES.forEach(g => { for (const c of g.chars) if (!POOL[c]) POOL[c] = 'n'; });
  const ALL_CHARS = Object.keys(POOL);
  const RHYME_CHARS = RHYMES.map(g => ALL_CHARS.filter(c => g.chars.includes(c)));

  // ---------- 双字词库（也可当“上半句”用）----------
  const BIGRAMS = new Set();
  const BIGRAM_RAW = [
    '清风 明月 青山 白云 流水 落花 飞鸟 孤舟 寒江 夜雨 秋风 春水 斜阳 远山 孤灯 长夜 小桥 人家 古道 西风',
    '暮色 晨光 星光 荷塘 梅雪 竹影 松风 石径 烟波 诗酒 笔墨 琴声 茶香 书卷 画卷 歌声 琴韵 云烟 山水 江湖',
    '归途 故乡 心事 轻风 微雨 静夜 闲云 幽径 雅意 淡墨 柔光 清欢 寂寥 悠然 逍遥 远望 低吟 漫步 静坐 独坐',
    '记得 不知 何时 何处 依旧 从来 独自 谁人 一夜 十年 半生 满城 千山 万里 三更 又是 还有 却见 唯余 且听',
    '且看 莫问 休道 静听 闲读 偶得 入梦 成诗 随风 于今 在野 临江 登楼 泛舟 踏月 寻梅 听雨 观潮 赏雪 归来',
    '心中 梦里 眼前 天边 心头 眉间 尘世 人间 往事 流年 旧梦 新愁 余音 故人 酒醒 花开 月落 云起 雨歇 雪停',
    '灯残 茶凉 一枝 半盏 孤影 残月 新晴 初雪 晚钟 归鸦 野渡 空山 幽谷 深巷 苍苔 青阶 一叶 半窗 满庭 孤城',
    '斜照 微风 春深 秋深 夜凉 春寒 梦回 夜静 夜深 山深 江阔 天高 云深 月明 风清 花开 雪落 雨来 春归 秋至',
    '不言 未语 无声 未央 如昨 如烟 似水 如雪 无形 空留 犹记 尚余 长忆 早知 已远 将近 渐远 初醒 半醉 独行',
    '闲看 静思 低语 轻叹 回首 莫愁 无眠 有梦 多情 易老 难留 常忆 难忘 共饮 同游 相期 相思 遥望 西沉 东流',
    '点滴 细数 轻读 慢书 缓行 急雨 疏星 淡云 薄雾 浓阴 浅草 深林 寒烟 暖风 翠柳 红梅 碧波 青瓦 白衣 红尘',
    '老去 白头 少年 女儿 丈夫 游子 归客 渔火 江枫 客船 钟声 橹声 马蹄 灯火 市井 田家 篱落 柴门 木窗 纸伞'
  ];
  BIGRAM_RAW.join(' ').split(/\s+/).forEach(w => {
    const cs = Array.from(w);
    if (cs.length === 2 && POOL[cs[0]] && POOL[cs[1]]) BIGRAMS.add(w);
  });
  // 反向索引：字 → 以它开头的词的第二个字
  const NEXT = {};
  for (const w of BIGRAMS) {
    const a = w[0], b = w[1];
    (NEXT[a] = NEXT[a] || []).push(b);
  }

  // ---------- 可复现伪随机 ----------
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a ^= a << 13; a >>>= 0;
      a ^= a >>> 17;
      a ^= a << 5; a >>>= 0;
      return a / 4294967296;
    };
  }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  // ---------- 生成一句 ----------
  function makeLine(first, len, rhymeSet, rng, globalUsed, needRhymeAtEnd) {
    // 束搜索：每步保留 K 条候选。每个状态记录已用字、累计分
    const K = 12;
    const runs = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = searchLine(first, len, rhymeSet, rng, globalUsed, needRhymeAtEnd, K);
      if (!r) continue;
      runs.push(r);
      const last = r.chars[r.chars.length - 1];
      if (!needRhymeAtEnd || rhymeSet.includes(last)) break;
    }
    if (!runs.length) return null;
    // 优先选句尾真押韵的
    const ok = runs.find(r => !needRhymeAtEnd || rhymeSet.includes(r.chars[r.chars.length - 1]));
    return ok || runs[0];
  }

  function searchLine(first, len, rhymeSet, rng, globalUsed, needRhymeAtEnd, K) {
    let beam = [{ chars: [first], used: new Set(globalUsed).add(first), score: 0 }];
    for (let depth = 1; depth < len; depth++) {
      const isEnd = depth === len - 1;
      const wantRhyme = isEnd && needRhymeAtEnd;
      const usedAll = new Set(globalUsed);
      for (const st of beam) { for (const c of st.chars) usedAll.add(c); }
      const usedByAll = usedAll;
      if (wantRhyme && rhymeSet.length) {
        for (const c of rhymeSet) usedByAll.add(c);
      }
      // 句尾押韵优先取韵字池，不足时允许全池
      let basePool = ALL_CHARS;
      if (wantRhyme && rhymeSet.length) {
        const rh = rhymeSet.filter(c => !usedByAll.has(c));
        if (rh.length) basePool = rhymeSet;
      }
      const next = [];
      for (const st of beam) {
        const prev = st.chars[depth - 1];
        for (const ch of basePool) {
          if (ch === prev || st.used.has(ch)) continue;
          let s = 1;
          const tag = POOL[ch];
          s += (tag === 'n' ? 0.35 : tag === 'v' ? 0.3 : tag === 'a' ? 0.25 : tag === 'e' ? 0.28 : 0.1);
          // 成词：与上一字
          if (BIGRAMS.has(prev + ch)) s += 3.0;
          // 句尾韵字
          if (wantRhyme) { if (rhymeSet.includes(ch)) s += 4.0; else s -= 3.0; }
          // 前瞻：这一字能否引出下一个词
          if (!isEnd && NEXT[ch]) {
            const nx = NEXT[ch];
            // 只看后面还有没有可用字（不重复、不撞句尾处不强制）
            const avail = nx.some(c => !usedAll.has(c) && c !== ch);
            if (avail) s += 0.8; else s -= 2.5;
          }
          // 位置节奏：第 2/4/6 字（1 基）偏实词
          if (depth % 2 === 1 && (tag === 'n' || tag === 'v')) s += 0.25;
          next.push({ chars: st.chars.concat(ch), used: new Set(st.used).add(ch), score: st.score + s });
        }
      }
      if (!next.length) return null;
      // 排序前加微小随机量，避免每次输出完全雷同
      next.forEach(n => { n.score += rng() * 1.2; });
      next.sort((a, b) => b.score - a.score);
      beam = next.slice(0, K);
    }
    return beam[0];
  }

  function compose(text, opts) {
    opts = opts || {};
    const raw = String(text || '').trim();
    const chars = Array.from(raw).filter(c => /[\u4e00-\u9fa5]/.test(c));
    if (!chars.length) throw new Error('请输入至少 2 个汉字');
    if (chars.length === 1 && !opts.allowSingle) throw new Error('单字藏头只能生成一句，请至少输入 2 个字');
    if (chars.length > 8) throw new Error('最多支持 8 个字');
    const len = opts.len === 7 ? 7 : 5;
    const seed = opts.seed === undefined ? 20261111
      : (typeof opts.seed === 'string' ? hashStr(opts.seed) : opts.seed);
    const rng = makeRng((seed ^ hashStr(chars.join('') + len + (opts.rhyme || ''))) >>> 0);

    let rhymeIdx = -1;
    if (opts.rhyme) rhymeIdx = RHYMES.findIndex(g => g.name === opts.rhyme);
    if (rhymeIdx < 0) for (const c of chars) if (c in RHYME_OF) { rhymeIdx = RHYME_OF[c]; break; }
    if (rhymeIdx < 0) rhymeIdx = Math.floor(rng() * RHYMES.length);

    const group = RHYMES[rhymeIdx];
    const rhymeSet = RHYME_CHARS[rhymeIdx];
    const globalUsed = new Set(chars);
    const lines = [];
    for (let i = 0; i < chars.length; i++) {
      // 偶数句（第 2/4/6 句）押韵；单句藏头也押韵
      const needRhyme = chars.length === 1 || (i + 1) % 2 === 0;
      const best = makeLine(chars[i], len, rhymeSet, rng, globalUsed, needRhyme);
      if (!best) throw new Error('字库不足以生成诗句，换个韵部试试');
      lines.push(best.chars.join(''));
      for (const c of best.chars) globalUsed.add(c);
    }

    const endRhymes = [];
    for (let i = 0; i < lines.length; i++) {
      if (i % 2 === 0 && lines.length > 1) continue; // 只检查偶数句
      const last = lines[i][lines[i].length - 1];
      endRhymes.push({
        ch: last,
        rhyme: RHYME_OF[last] !== undefined ? RHYMES[RHYME_OF[last]].name : null,
        label: RHYME_OF[last] !== undefined ? RHYMES[RHYME_OF[last]].label : '—'
      });
    }

    return {
      head: chars.join(''),
      lines, len,
      rhyme: group.name,
      rhymeLabel: group.label,
      rhymeChars: group.chars,
      endRhymes,
      poem: lines.join('\n')
    };
  }

  function rhymeScore(result) {
    if (!result || !result.endRhymes.length) return { hit: 0, total: 0 };
    let hit = 0;
    for (const e of result.endRhymes) if (e.rhyme === result.rhyme) hit++;
    return { hit, total: result.endRhymes.length };
  }

  return { compose, rhymeScore, makeLine, RHYMES, RHYME_OF, POOL, BIGRAMS, hashStr, makeRng };
});
