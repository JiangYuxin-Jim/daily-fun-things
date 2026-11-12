/* 提示词工坊 · Prompt Forge 核心引擎
 * 纯函数、无依赖，浏览器与 Node 共用（UMD 风格）
 * 功能：诊断(analyze) → 优化(improve) → 对比(diff)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PromptForge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 规则库 ----------
  // 每条规则：id / label / test(text, ctx) / weight(扣分) / advise(ctx) -> 建议文本
  const RULES = [
    {
      id: 'empty',
      label: '内容为空',
      test: (t) => t.trim().length === 0,
      weight: 100,
      advise: () => '先写下你想让模型做什么。'
    },
    {
      id: 'too-short',
      label: '过于简短（少于 15 字）',
      test: (t, c) => c.len > 0 && c.len < 15,
      weight: 15,
      advise: () => '太短的信息量不够。补上「目标 + 对象 + 期望形式」。'
    },
    {
      id: 'no-role',
      label: '缺少角色设定',
      test: (t, c) => !c.hasRole,
      weight: 12,
      advise: () => '加一句角色：如「你是一位资深产品经理」「你是一名严谨的代码审查员」。'
    },
    {
      id: 'no-task',
      label: '缺少明确的动作动词',
      test: (t, c) => !c.hasTask,
      weight: 20,
      advise: () => '用动词开头说清楚任务：改写 / 列出 / 对比 / 找出 / 生成 / 评审……'
    },
    {
      id: 'no-format',
      label: '未指定输出格式',
      test: (t, c) => !c.hasFormat,
      weight: 14,
      advise: () => '指定输出结构：Markdown 表格 / JSON / 分点列表 / 不超过 N 字。'
    },
    {
      id: 'no-constraint',
      label: '没有长度或范围约束',
      test: (t, c) => !c.hasConstraint,
      weight: 10,
      advise: () => '加约束：字数上限、受众水平、必须包含/避免的内容。'
    },
    {
      id: 'no-context',
      label: '缺少背景上下文',
      test: (t, c) => !c.hasContext && c.len > 15,
      weight: 10,
      advise: () => '说明背景：谁会用这个结果、在什么场景、前置条件是什么。'
    },
    {
      id: 'vague',
      label: '存在模糊词',
      test: (t, c) => c.vague.length > 0,
      weight: 12,
      advise: (c) => `把模糊词换成具体标准：「${c.vague.slice(0, 4).join('、')}」分别指什么？给出可判断的阈值。`
    },
    {
      id: 'polite-noise',
      label: '充数客套话',
      test: (t, c) => c.noise.length > 0,
      weight: 5,
      advise: (c) => `这些客套话不增加信息量，可删：「${c.noise.slice(0, 3).join('」「')}」。`
    },
    {
      id: 'many-asks',
      label: '一次塞了太多任务',
      test: (t, c) => c.asks >= 4,
      weight: 8,
      advise: () => '任务过多容易漏项。拆成几步，或明确要求「先做第 1 步再等我确认」。'
    },
    {
      id: 'no-example',
      label: '缺少示例（few-shot）',
      test: (t, c) => !c.hasExample && c.len > 40,
      weight: 6,
      advise: () => '给 1 个输入→输出的示例，效果通常比多写三句描述更明显。'
    },
    {
      id: 'double-question',
      label: '连续多个问号，意图发散',
      test: (t, c) => c.questions >= 3,
      weight: 7,
      advise: () => '锁定核心问题，其余作为「顺便谈谈」。'
    }
  ];

  const ROLE_RE = /(你是|你作为|扮演|作为一个|身为|you are|act as)/i;
  const TASK_RE = /(请|帮我|给我|列出|写|生成|改写|翻译|总结|概括|分析|对比|比较|找出|提取|整理|设计|解释|评估|评审|检查|优化|拆解|规划|list|write|generate|summarize|analy[sz]e|explain|compare|translate|extract|review|design)/i;
  const FORMAT_RE = /(json|markdown|表格|列表|分点|条目|bullet|不少于|不超过|字数|字以内|格式|格式为|结构为|模板|大纲|步骤|编号|table|format)/i;
  const CONSTRAINT_RE = /(\d+\s*(字|词|条|点|行|个)|以内|不超过|最多|至少|必须|不要|避免|禁止|不得|只能|仅限|简|详细|入门|专业|面向)/i;
  const CONTEXT_RE = /(背景|场景|目前|现在|因为|由于|目的是|用于|用来|目标是|上下文|已有|基于|现有|请考虑|假设|假定|context|background|scenario|given)/i;
  const EXAMPLE_RE = /(例如|比如|示例|例子|参考|如：|e\.g\.|for example|示例：)/i;
  const VAGUE_WORDS = ['好一点', '更好', '优化一下', '一些', '什么的', '之类的', '差不多', '尽量', '适当', '合理', '高质量', '有趣', '好看', '舒服', '优化下', '改进', '不错', '大概', '等等', '稍微'];
  const NOISE_RE = /(请问|麻烦你|不好意思|如果可以的话|不知道你能不能|谢谢|非常感谢|不胜感激|拜托|亲|亲爱的|please kindly|I would appreciate|thank you)/gi;
  const ASKS_RE = /(，然后|，再|并且|同时|另外|还有|以及|接着|最后)/g;

  function countMatches(text, re) {
    re.lastIndex = 0;
    let n = 0;
    let m;
    while ((m = re.exec(text)) !== null) { n++; if (m.index === re.lastIndex) re.lastIndex++; }
    return n;
  }

  // ---------- 诊断 ----------
  function analyze(text) {
    const t = String(text == null ? '' : text);
    const c = {
      len: t.replace(/\s/g, '').length,
      hasRole: ROLE_RE.test(t),
      hasTask: TASK_RE.test(t),
      hasFormat: FORMAT_RE.test(t),
      hasConstraint: CONSTRAINT_RE.test(t),
      hasContext: CONTEXT_RE.test(t),
      hasExample: EXAMPLE_RE.test(t),
      vague: VAGUE_WORDS.filter((w) => t.indexOf(w) >= 0),
      noise: (t.match(NOISE_RE) || []),
      asks: 1 + countMatches(t, ASKS_RE),
      questions: countMatches(t, /[?？]/g),
      chars: t.length
    };

    const issues = [];
    for (const r of RULES) {
      if (r.test(t, c)) issues.push({ id: r.id, label: r.label, weight: r.weight, advise: r.advise(c) });
    }

    let score = 100;
    for (const i of issues) score -= i.weight;
    // 加分项：结构清晰、长度适中
    if (/^[\s\S]*\n\s*[-*\d]/.test(t)) score += 4;
    if (c.len >= 40 && c.len <= 600) score += 3;
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score,
      grade: score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D',
      issues,
      stats: {
        chars: c.chars,
        words: t.split(/\s+/).filter(Boolean).length,
        estTokens: estimateTokens(t)
      }
    };
  }

  // 粗略 token 估计：中文约 1 字 1 token，英文约 4 字符 1 token
  function estimateTokens(t) {
    if (!t) return 0;
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    const rest = t.replace(/[\u4e00-\u9fff]/g, '');
    return cjk + Math.ceil(rest.length / 4);
  }

  // ---------- 优化 ----------
  const DEFAULT_ROLE = '你是一位经验丰富、表达严谨的领域专家';

  function cleanNoise(text) {
    return text
      .replace(NOISE_RE, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[\s，,、]+/gm, '')
      .trim();
  }

  function improve(text, opts) {
    opts = opts || {};
    const role = (opts.role || '').trim() || DEFAULT_ROLE;
    const format = (opts.format || '').trim() || 'Markdown 小标题 + 分点列表';
    const audience = (opts.audience || '').trim() || '有一定基础但需要清晰解释的读者';
    const lengthLimit = (opts.lengthLimit || '').trim() || '300 字以内';
    const strict = !!opts.strict;

    const raw = String(text || '').trim();
    if (!raw) return '';
    const a = analyze(raw);
    const body = cleanNoise(raw);

    const lines = [];
    lines.push(`# 角色`);
    lines.push(role + '。');
    lines.push('');
    lines.push('# 任务');
    lines.push(body);
    lines.push('');
    lines.push('# 背景');
    lines.push('（在这里补充：使用者是谁、前置条件、结果将被用来做什么。）');
    lines.push('');
    lines.push('# 要求');
    lines.push(`- 受众：${audience}`);
    lines.push(`- 篇幅：${lengthLimit}`);
    lines.push(`- 输出格式：${format}`);
    lines.push('- 先给结论，再展开理由；不确定的地方明确标注「待确认」，不要编造。');
    if (a.issues.some((i) => i.id === 'vague')) {
      lines.push('- 避免「更好/优化/一些」这类模糊表述，每个判断都要给出可验证的依据。');
    }
    if (a.issues.some((i) => i.id === 'many-asks')) {
      lines.push('- 任务较多：先列出执行步骤清单，再按顺序逐条完成，每条独立成段。');
    }
    if (strict) {
      lines.push('- 严格模式：不要寒暄、不要复述我的问题、不要输出与任务无关的内容。');
    }
    lines.push('');
    lines.push('# 输出格式');
    lines.push(format.startsWith('```') ? format : format);
    if (a.issues.some((i) => i.id === 'no-example')) {
      lines.push('');
      lines.push('# 示例（按此风格回答）');
      lines.push('输入：……');
      lines.push('输出：……');
    }
    return lines.join('\n');
  }

  // ---------- 轻量 diff（行级 LCS） ----------
  function diffLines(a, b) {
    const A = a.split('\n');
    const B = b.split('\n');
    const n = A.length;
    const m = B.length;
    // 大文本降级为逐行标号对比，避免 O(n*m) 爆炸
    if (n * m > 400000) {
      return B.map((l) => ({ type: 'add', text: l }));
    }
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++; }
      else { out.push({ type: 'add', text: B[j] }); j++; }
    }
    while (i < n) out.push({ type: 'del', text: A[i++] });
    while (j < m) out.push({ type: 'add', text: B[j++] });
    return out;
  }

  return { analyze, improve, cleanNoise, diffLines, estimateTokens, RULES, DEFAULT_ROLE };
});
