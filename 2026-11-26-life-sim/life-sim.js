/*
 * 一命人生模拟器 · life-sim
 * 纯函数式人生引擎：给定种子即可完整重放一生（便于自测）。
 * 浏览器 <script> 与 Node require 双用。
 * 设计目标：每一次选择都真的影响后续事件池，而不是走过场。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LifeSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 随机数：可种子化（mulberry32） ----------
  function makeRng(seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function randInt(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }

  // ---------- 出身设定 ----------
  const ORIGINS = [
    { id: 'city-rich', label: '一线城市 · 富裕家庭', wealth: 80, intel: 55, charm: 50, health: 75, w: 6 },
    { id: 'city-mid', label: '省城 · 普通工薪', wealth: 50, intel: 55, charm: 50, health: 75, w: 24 },
    { id: 'town', label: '县城 · 小店主', wealth: 40, intel: 50, charm: 55, health: 75, w: 25 },
    { id: 'village', label: '山村 · 务农人家', wealth: 20, intel: 50, charm: 45, health: 80, w: 25 },
    { id: 'remote', label: '边疆小镇 · 放牧', wealth: 15, intel: 45, charm: 45, health: 85, w: 10 },
    { id: 'overseas', label: '海外华人 · 移民二代', wealth: 60, intel: 60, charm: 55, health: 75, w: 10 },
  ];
  const TALENTS = [
    { id: 'none', label: '平平无奇', mods: {}, w: 22 },
    { id: 'smart', label: '过目不忘', mods: { intel: 25 }, w: 14 },
    { id: 'strong', label: '身体结实', mods: { health: 20 }, w: 14 },
    { id: 'pretty', label: '人群焦点', mods: { charm: 25 }, w: 14 },
    { id: 'born-saver', label: '天生会攒钱', mods: { wealth: 20 }, w: 12 },
    { id: 'late-bloom', label: '大器晚成', mods: { intel: 10, charm: 10, health: 10 }, w: 12 },
    { id: 'lucky', label: '运气不错', mods: { luck: 20 }, w: 6 },
    { id: 'artist', label: '艺术触觉', mods: { charm: 15, intel: 10 }, w: 6 },
  ];

  function weightedPick(rng, arr) {
    const total = arr.reduce((s, x) => s + (x.w || 1), 0);
    let r = rng() * total;
    for (const x of arr) { r -= (x.w || 1); if (r <= 0) return x; }
    return arr[arr.length - 1];
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- 人生状态 ----------
  function createLife(seed) {
    const rng = makeRng(seed);
    const origin = weightedPick(rng, ORIGINS);
    const talent = weightedPick(rng, TALENTS);
    const s = {
      seed,
      rng,
      age: 0,
      alive: true,
      origin, talent,
      wealth: clamp(origin.wealth + (talent.mods.wealth || 0) + randInt(rng, -8, 8), 1, 100),
      intel: clamp(origin.intel + (talent.mods.intel || 0) + randInt(rng, -8, 8), 1, 100),
      charm: clamp(origin.charm + (talent.mods.charm || 0) + randInt(rng, -8, 8), 1, 100),
      health: clamp(origin.health + (talent.mods.health || 0) + randInt(rng, -6, 6), 1, 100),
      luck: clamp(50 + (talent.mods.luck || 0), 1, 100),
      happiness: 60,
      job: '无',
      flags: {},          // 关键标记：读书、创业、婚姻、子女等
      kids: 0,
      log: [],            // {age, text, kind}
      // 性格只在模拟中影响若干选项的收益，不显示数字前先做隐变量
      ambition: randInt(rng, 20, 90),
      risk: randInt(rng, 20, 90),
    };
    s.log.push({ age: 0, kind: 'birth', text: `出生在「${origin.label}」，天赋是「${talent.label}」。` });
    return s;
  }

  function push(s, text, kind) { s.log.push({ age: s.age, text, kind: kind || 'event' }); }
  function tick(s, effect) {
    // effect: {wealth,intel,charm,health,happiness}
    if (!effect) return;
    for (const k of ['wealth', 'intel', 'charm', 'health', 'happiness']) {
      if (effect[k]) s[k] = clamp(s[k] + effect[k], 0, 100);
    }
  }

  // ---------- 事件池：按年龄与条件筛选 ----------
  // cond(s) => bool；weight 可函数
  const EVENTS = [
    {
      id: 'school-genius', age: [6, 12], cond: s => s.intel > 70,
      text: () => '老师说你脑子转得比同龄人快，跳了一级。',
      effect: { intel: 6, happiness: 6 },
    },
    {
      id: 'bullied', age: [6, 14], cond: s => s.charm < 50,
      text: () => '被同学起哄孤立了一段时间，你学会了安静地观察人。',
      effect: { happiness: -8, intel: 5, charm: -3 },
    },
    {
      id: 'first-book', age: [8, 16], cond: () => true,
      text: () => '在旧书摊上淘到一本改变你想法的小说。',
      effect: { intel: 6, happiness: 5 },
    },
    {
      id: 'sport', age: [10, 18], cond: s => s.health > 65,
      text: () => '进了校队，身体也练得更好。',
      effect: { health: 8, happiness: 6, charm: 4 },
    },
    {
      id: 'family-poor', age: [14, 18], cond: s => s.wealth < 30,
      text: () => '家里出不起学费，你开始边读书边打零工。',
      effect: { wealth: 6, health: -5, intel: 3, happiness: -4 },
    },
    {
      id: 'gaokao', age: [18, 19], cond: s => true, once: true,
      text: (s) => s.intel > 65 ? '你考上了不错的大学，第一次离开家乡。' : s.intel > 45 ? '你上了一所普通院校，日子过得平稳。' : '你没能继续读书，提前进了社会。',
      effect: (s) => s.intel > 65 ? { intel: 8, happiness: 8, wealth: -5 } : s.intel > 45 ? { intel: 4 } : { happiness: -6, wealth: 4 },
      tag: (s) => s.intel > 65 ? { flag: 'college' } : null,
    },
    {
      id: 'first-love', age: [17, 24], cond: s => !s.flags.love, once: true,
      text: (s) => s.charm > 65 ? '你被人认真喜欢着，第一次觉得自己值得。' : '你鼓起勇气表白，结果不了了之。',
      effect: (s) => s.charm > 65 ? { happiness: 12, charm: 4 } : { happiness: -6, charm: 3 },
      tag: (s) => s.charm > 65 ? { flag: 'love' } : null,
    },
    {
      id: 'job-hunt', age: [21, 26], cond: s => !s.flags.working && s.intel > 45, once: true,
      text: (s) => s.flags.college ? '你进了写字楼，成为早高峰里的一员。' : '你在人才市场里泡了三个月，终于找到落脚的活。',
      effect: { wealth: 10, happiness: -2, health: -3 },
      tag: () => ({ flag: 'working' }),
    },
    {
      id: 'startup', age: [24, 34], cond: s => !s.flags.startup && s.wealth > 40 && s.risk > 55, once: true,
      text: (s) => (s.rng() < 0.35 ? '你辞职创业，第一款产品赶上了风口。' : '你辞职创业，烧完积蓄，又回到了打工。'),
      effect: (s) => (s.rng() < 0.4 ? { wealth: 35, happiness: 10, health: -8 } : { wealth: -22, happiness: -10 }),
      tag: () => ({ flag: 'startup' }),
      dynamic: true,
    },
    {
      id: 'marry', age: [25, 36], cond: s => !s.flags.married && s.charm > 45, once: true,
      text: () => '你和一个人决定把后半程绑在一起。',
      effect: { happiness: 14, charm: 4, wealth: -4 },
      tag: () => ({ flag: 'married' }),
    },
    {
      id: 'kids', age: [28, 40], cond: s => s.flags.married && s.kids < 2, weight: 3,
      text: () => '家里添了一个小孩，日子被哭声和笑声填满。',
      effect: { happiness: 8, wealth: -10, health: -4 },
      tag: s => ({ kids: s.kids + 1 }),
    },
    {
      id: 'promotion', age: [28, 45], cond: s => s.flags.working && s.intel > 60, weight: 3,
      text: () => '做了几年事，被提拔成带队的人。',
      effect: { wealth: 12, happiness: 5, health: -4 },
    },
    {
      id: 'burnout', age: [28, 50], cond: s => s.flags.working && s.health < 55,
      text: () => '身体亮起了红灯，你休了一段长假。',
      effect: { health: 8, wealth: -8, happiness: 3 },
    },
    {
      id: 'lottery', age: [20, 70], cond: s => true, weight: 1,
      text: (s) => s.rng() < 0.3 ? '买彩票中了一笔不小的钱，你请全家人吃了顿好的。' : '一直买彩票，从没中过，但买的过程很开心。',
      effect: (s) => s.rng() < 0.4 ? { wealth: 25, happiness: 6 } : { wealth: -1, happiness: 3 },
    },
    {
      id: 'art', age: [22, 55], cond: s => s.talent.id === 'artist' && !s.flags.famous, once: true,
      text: (s) => s.charm > 60 ? '你的作品被更多人看见了，有了自己的小圈子。' : '你的画挂在角落里，只有你自己去看。',
      effect: (s) => s.charm > 60 ? { happiness: 12, charm: 10, wealth: 6 } : { happiness: 4, charm: 4 },
      tag: s => s.charm > 60 ? { flag: 'famous' } : null,
    },
    {
      id: 'travel', age: [25, 60], cond: s => s.wealth > 50, weight: 2,
      text: () => '攒够了钱，去了一次从小心心念念的地方。',
      effect: { happiness: 10, wealth: -8, intel: 3 },
    },
    {
      id: 'parents-away', age: [35, 55], cond: s => s.health > 30, once: true,
      text: () => '父母渐渐老了，你开始频繁往老家跑。',
      effect: { happiness: -10, wealth: -6, charm: 3 },
    },
    {
      id: 'breakdown', age: [18, 70], cond: s => s.health < 25, weight: 4,
      text: () => '身体出了大问题，躺了很久。',
      effect: { health: -12, happiness: -8, wealth: -8 },
    },
    {
      id: 'mentor', age: [20, 40], cond: s => s.intel > 70, once: true,
      text: () => '遇到一个愿意教你的人，很多想不通的事突然通了。',
      effect: { intel: 10, happiness: 6 },
    },
    {
      id: 'calm', age: [45, 75], cond: () => true, weight: 2,
      text: () => '日子慢慢安静下来，你开始喜欢早起散步。',
      effect: { happiness: 5, health: 3 },
    },
  ];

  function eligible(s, ev) {
    if (ev.used) return false;
    if (ev.once && s.flags['ev_' + ev.id]) return false;
    if (s.age < ev.age[0] || s.age > ev.age[1]) return false;
    return ev.cond ? ev.cond(s) : true;
  }

  // 每年推进一岁，产生 0~2 个事件
  function stepYear(s) {
    if (!s.alive) return null;
    s.age += 1;
    // 自然衰老
    if (s.age > 45) s.health = clamp(s.health - Math.floor((s.age - 45) / 12) - 1, 0, 100);
    // 属性自然衰减：让数值不至于一路封顶，越老越难挤出新高
    if (s.age > 30) {
      const decay = s.age > 60 ? 2 : 1;
      s.charm = clamp(s.charm - decay, 0, 100);
      s.wealth = clamp(s.wealth - (s.flags.working ? 0 : decay), 0, 100);
    }
    if (s.age > 20 && s.flags.working) s.wealth = clamp(s.wealth + Math.floor(s.intel / 25), 0, 100);

    const pool = EVENTS.filter(ev => eligible(s, ev));
    const weightOf = ev => (typeof ev.weight === 'number' ? ev.weight : 2);
    const count = s.age < 6 ? 0 : (s.rng() < 0.55 ? 1 : (s.rng() < 0.35 ? 2 : 0));

    for (let i = 0; i < count && pool.length; i++) {
      const total = pool.reduce((acc, ev) => acc + weightOf(ev), 0);
      let r = s.rng() * total;
      let chosen = pool[pool.length - 1];
      for (const ev of pool) { r -= weightOf(ev); if (r <= 0) { chosen = ev; break; } }
      pool.splice(pool.indexOf(chosen), 1);
      if (!chosen) continue;
      const text = typeof chosen.text === 'function' ? chosen.text(s) : chosen.text;
      const effect = typeof chosen.effect === 'function' ? chosen.effect(s) : chosen.effect;
      push(s, text);
      tick(s, effect);
      if (chosen.once) s.flags['ev_' + chosen.id] = true;
      if (chosen.tag) {
        const t = chosen.tag(s);
        if (t) {
          if (t.flag) s.flags[t.flag] = true;
          if (typeof t.kids === 'number') s.kids = t.kids;
        }
      }
      // 同步 job 显示
      if (s.flags.startup) s.job = '创业者';
      else if (s.flags.college && s.flags.working) s.job = '白领';
      else if (s.flags.working) s.job = '打工';
      else if (s.age > 22) s.job = '自由职业';
      else s.job = '学生';
    }

    // 死亡判定：健康归零 或 年龄接近寿命
    const lifespan = 75 + Math.floor(s.health / 12); // 健康越好活得越久
    if (s.health <= 0) { s.alive = false; s.deathReason = s.age < 60 ? '身体先撑不住了' : '安静地走了'; }
    else if (s.age >= lifespan) { s.alive = false; s.deathReason = '活到了自然寿命'; }
    else if (s.age > 40 && s.rng() < 0.0015) { s.alive = false; s.deathReason = '一场意外'; }
    if (!s.alive) push(s, `生命停在 ${s.age} 岁。${s.deathReason}。`, 'death');
    return s;
  }

  // 综合评分与墓志铭
  function summarize(s) {
    const avg = (s.wealth + s.intel + s.charm + s.health + s.happiness) / 5;
    // 分数校准：平均属性 0-100 映射成 0-100，再加人生加分项，最后除以理论满分再乘 100
    const bonus = s.age * 0.35 + s.kids * 2.5 + (s.flags.married ? 4 : 0) + (s.flags.famous ? 5 : 0);
    let score = Math.round((avg / 100) * 62 + bonus);
    let title;
    if (s.age < 25) title = '未竟之人';
    else if (score > 96) title = '传奇一生';
    else if (score > 82) title = '活得漂亮';
    else if (score > 68) title = '稳稳当当';
    else if (score > 52) title = '寻常人家';
    else title = '平凡中也算活过';

    if (s.age < 25) score = Math.min(score, 40);
    score = clamp(score, 0, 130);

    const epitaphPool = [];
    if (s.happiness > 70) epitaphPool.push('这一生，他/她笑得很多。');
    if (s.kids > 0) epitaphPool.push('留下了会一直想念他/她的人。');
    if (s.flags.famous) epitaphPool.push('有人会在很多年后记起这个名字。');
    if (s.wealth > 70) epitaphPool.push('攒下了一些东西，也终于舍得花。');
    if (s.health > 70) epitaphPool.push('身体一直不错，走得很慢很稳。');
    if (s.intel > 75) epitaphPool.push('一辈子都在好奇。');
    if (!epitaphPool.length) epitaphPool.push('来过，看过，然后回去了。');
    const epitaph = pick(s.rng, epitaphPool);
    return { score, title, epitaph };
  }

  // 完整跑完一生（测试 / 一键速通用）
  function runFull(seed, opts) {
    opts = opts || {};
    const maxAge = opts.maxAge || 120;
    const s = createLife(seed);
    while (s.alive && s.age < maxAge) stepYear(s);
    s.summary = summarize(s);
    return s;
  }

  return { createLife, stepYear, summarize, runFull, makeRng, ORIGINS, TALENTS, EVENTS };
});
