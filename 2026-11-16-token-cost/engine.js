/* ============================================================
 * token-cost engine —— 纯函数，无 DOM 依赖
 * 可在 Node 中 require 做自检，也可在浏览器中当 window.TokenCost 用
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TokenCost = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 模型价格表（USD / 1M tokens） ----------------
   * 单位统一为「美元 / 百万 token」。
   * 价格为 2026 年参考值，随时可能变化，页面里可手动改。
   * cached = 命中缓存后的输入单价；无缓存概念的模型填 null。
   */
  const MODELS = [
    { id: 'gpt-5.1',       name: 'GPT-5.1',            in: 1.25, out: 10.0,  cached: 0.125 },
    { id: 'gpt-5.1-mini',  name: 'GPT-5.1 mini',       in: 0.25, out: 2.0,   cached: 0.025 },
    { id: 'claude-opus-4.5',  name: 'Claude Opus 4.5',  in: 5.0,  out: 25.0,  cached: 0.5 },
    { id: 'claude-sonnet-4.5',name: 'Claude Sonnet 4.5',in: 3.0,  out: 15.0,  cached: 0.3 },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', in: 1.0,  out: 5.0,   cached: 0.1 },
    { id: 'gemini-3-pro',  name: 'Gemini 3 Pro',       in: 2.0,  out: 12.0,  cached: 0.5 },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash',in: 0.3,  out: 2.5,   cached: 0.075 },
    { id: 'deepseek-v4',   name: 'DeepSeek V4',        in: 0.28, out: 1.12,  cached: 0.028 },
    { id: 'qwen3-max',     name: 'Qwen3 Max',          in: 0.86, out: 3.44,  cached: null },
    { id: 'glm-4.6',       name: 'GLM-4.6',            in: 0.6,  out: 2.2,   cached: 0.11 },
    { id: 'llama-4-405b',  name: 'Llama 4 405B',       in: 3.5,  out: 3.5,   cached: null },
    { id: 'custom',        name: '自定义…',             in: 1.0,  out: 4.0,   cached: 0.1 },
  ];

  /* ---------------- CJK / 符号分类 ---------------- */
  // 基本 CJK 及扩展区、日文假名、韩文
  const CJK_RE = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
  const WS_RE = /\s/;

  /**
   * 启发式 token 估算。没有任何真 tokenizer 能离线通用，
   * 所以用「分类 + 密度」估算，误差通常在 ±15% 内。
   * @param {string} text
   * @returns {{tokens:number, cjk:number, latin:number, space:number, punct:number, lines:number}}
   */
  function estimateTokens(text) {
    if (!text) return { tokens: 0, cjk: 0, latin: 0, space: 0, punct: 0, lines: 0 };
    let cjk = 0, latin = 0, punct = 0, spaces = 0, digits = 0;
    let asciiRun = 0;       // 当前连续 ASCII 单词长度
    let tokenSum = 0;

    const flushRun = () => {
      if (asciiRun > 0) {
        // 英文词大致 4 字符/token，短词至少 1 token
        tokenSum += Math.max(1, Math.ceil(asciiRun / 4));
        asciiRun = 0;
      }
    };

    for (const ch of text) {
      if (WS_RE.test(ch)) {
        flushRun(); spaces++;
        // 换行/缩进本身也吃 token：约每 4 个空白 1 token
        continue;
      }
      if (CJK_RE.test(ch)) {
        flushRun();
        cjk++;
        tokenSum += 1;      // 一个汉字 ≈ 1 token（多数 BPE 对中文约 1.0~1.3）
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) { asciiRun++; latin++; continue; }
      if (/[0-9]/.test(ch)) {
        digits++;
        if (asciiRun === 0) { tokenSum += 1; } // 数字串单独计
        else asciiRun++;
        continue;
      }
      // 标点与符号
      flushRun();
      punct++;
      tokenSum += 1;
    }
    flushRun();
    tokenSum += Math.ceil(spaces / 4);

    return {
      tokens: tokenSum,
      cjk, latin, space: spaces, punct,
      digits,
      lines: text.split('\n').length,
    };
  }

  /**
   * 计算单次调用成本（不做缓存，缓存用 computeCost 的 cachedInputTokens）
   * @param {{in:number,out:number,cached?:number|null}} price USD/1M
   * @param {{inputTokens:number, outputTokens:number, cachedInputTokens?:number, calls?:number}} usage
   */
  function computeCost(price, usage) {
    const inputTokens = num(usage.inputTokens);
    const outputTokens = num(usage.outputTokens);
    const calls = Math.max(1, num(usage.calls, 1));
    let cached = num(usage.cachedInputTokens);
    cached = Math.min(cached, inputTokens);
    const fresh = inputTokens - cached;
    const cachedPrice = price.cached == null ? price.in : price.cached;

    const inCost = (fresh * price.in + cached * cachedPrice) / 1e6;
    const outCost = (outputTokens * price.out) / 1e6;
    const perCall = inCost + outCost;

    return {
      perCall,
      total: perCall * calls,
      inputCost: inCost * calls,
      outputCost: outCost * calls,
      cacheSaved: (cached * (price.in - cachedPrice)) / 1e6 * calls,
      freshInputTokens: fresh,
      cachedInputTokens: cached,
      calls,
    };
  }

  /**
   * 反推：给定预算能跑多少次 / 每次能喂多少输入
   */
  function budgetBreakdown(price, budgetUSD, usage) {
    const c = computeCost(price, usage);
    if (c.perCall <= 0) return { calls: Infinity, perCall: 0 };
    return { calls: Math.floor(budgetUSD / c.perCall), perCall: c.perCall };
  }

  function num(v, dflt) {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return dflt === undefined ? 0 : dflt;
    return n;
  }

  /** 金额格式化：小于 1 美分时给更多小数位 */
  function money(usd) {
    if (!isFinite(usd)) return '∞';
    const a = Math.abs(usd);
    if (a === 0) return '$0';
    if (a < 0.0001) return '$' + usd.toExponential(2);
    if (a < 0.01) return '$' + usd.toFixed(5);
    if (a < 1) return '$' + usd.toFixed(4);
    if (a < 1000) return '$' + usd.toFixed(2);
    return '$' + usd.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function numFmt(n) {
    if (!isFinite(n)) return '∞';
    return Math.round(n).toLocaleString('en-US');
  }

  /** 常见中文场景的「日均 token」参考值，用于估算月账单 */
  const SCENARIOS = [
    { id: 'chat',    name: '日常问答',     inPerCall: 800,   outPerCall: 400,  callsPerDay: 30 },
    { id: 'writing', name: '长文写作',     inPerCall: 3000,  outPerCall: 2000, callsPerDay: 10 },
    { id: 'code',    name: '代码补全/审查', inPerCall: 12000, outPerCall: 1500, callsPerDay: 60 },
    { id: 'rag',     name: 'RAG 文档问答', inPerCall: 20000, outPerCall: 600,  callsPerDay: 200 },
    { id: 'agent',   name: 'Agent 多轮任务',inPerCall: 45000, outPerCall: 3000, callsPerDay: 25 },
  ];

  return {
    MODELS, SCENARIOS,
    estimateTokens, computeCost, budgetBreakdown,
    money, numFmt, CJK_RE,
  };
});
