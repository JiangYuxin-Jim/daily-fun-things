/* flow-forge 内置示例图（纯数据，无 DOM 依赖）
 * 用法：FlowEngine.run(Graphs.review()) 等
 */
(function (root) {
  'use strict';

  function N(id, type, label, x, y, conf) {
    var base = {
      llm: { model: 'deepseek-v3.2', inTok: 1200, outTok: 300, sys: '你是一个严谨的助手。' },
      tool: { name: 'web_search', inTok: 0, outTok: 400, sys: '{"query": "..."}' },
      condition: { expr: '结果是否为空？' },
      human: { sys: '请确认该操作是否执行。' }
    }[type] || {};
    return { id: id, type: type, label: label, x: x, y: y, conf: Object.assign({}, base, conf || {}) };
  }

  // 客服三件套：RAG 检索 → 生成 → 人工兜底
  function support() {
    return {
      name: '客服知识助手',
      nodes: {
        s: N('s', 'start', '用户提问', 60, 200),
        q: N('q', 'condition', '问题分类：能否自动答？', 240, 190),
        r: N('r', 'tool', '知识库检索', 460, 80, { name: 'kb_search', outTok: 900 }),
        a: N('a', 'llm', '基于资料作答', 680, 80, { inTok: 2400, outTok: 320 }),
        h: N('h', 'human', '转人工客服', 460, 320),
        e: N('e', 'end', '回复用户', 900, 200)
      },
      edges: [
        { from: 's', to: 'q' },
        { from: 'q', to: 'r', cond: 'true' },
        { from: 'q', to: 'h', cond: 'false' },
        { from: 'r', to: 'a' },
        { from: 'a', to: 'e' },
        { from: 'h', to: 'e' }
      ]
    };
  }

  // 数据报表：并行取数 → 汇总 → 出结论
  function report() {
    return {
      name: '日报自动生成',
      nodes: {
        s: N('s', 'start', '每天 9:00 触发', 60, 200),
        a: N('a', 'tool', '拉取销售数据', 260, 90, { name: 'db_query', outTok: 1200 }),
        b: N('b', 'tool', '拉取流量数据', 260, 300, { name: 'ga_api', outTok: 800 }),
        m: N('m', 'llm', '合并归纳要点', 520, 190, { inTok: 3200, outTok: 600 }),
        c: N('c', 'condition', '异常？', 740, 190),
        h: N('h', 'human', '人工复核', 940, 80),
        e: N('e', 'end', '发出日报', 1140, 210)
      },
      edges: [
        { from: 's', to: 'a' },
        { from: 's', to: 'b' },
        { from: 'a', to: 'm' },
        { from: 'b', to: 'm' },
        { from: 'm', to: 'c' },
        { from: 'c', to: 'h', cond: 'true' },
        { from: 'c', to: 'e', cond: 'false' },
        { from: 'h', to: 'e' }
      ]
    };
  }

  // 反例：自主 Agent 死循环（环形依赖会被抓出来）
  function loop() {
    return {
      name: '反例：自嗨 Agent',
      nodes: {
        s: N('s', 'start', '开始', 60, 180),
        p: N('p', 'llm', '制定计划', 240, 180),
        t: N('t', 'tool', '执行工具', 440, 180),
        w: N('w', 'llm', '总结结果', 640, 180),
        e: N('e', 'end', '结束', 860, 180)
      },
      edges: [
        { from: 's', to: 'p' },
        { from: 'p', to: 't' },
        { from: 't', to: 'w' },
        { from: 'w', to: 'p' },
        { from: 'w', to: 'e' }
      ]
    };
  }

  var all = { support: support, report: report, loop: loop };
  if (typeof module !== 'undefined' && module.exports) module.exports = all;
  root.FlowGraphs = all;
})(typeof window !== 'undefined' ? window : globalThis);
