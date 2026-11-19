/* flow-forge engine —— Agent 工作流可视化内核（纯函数，无 DOM 依赖）
 * 图结构：nodes: {id: {id, type, label, x, y, conf?}}
 *         edges: [{from, to, cond?}]   cond 为 'true' | 'false' | undefined
 * 引擎职责：拓扑排序成通路、检测环、逐次执行并记录追踪、估算 token 与费用。
 */
(function (root) {
  'use strict';

  var TYPES = {
    start:    { label: '开始',     icon: '▶',  color: '#7dd3fc', extra: false },
    llm:      { label: '大模型',   icon: '🧠', color: '#c4b5fd', extra: false },
    tool:     { label: '工具调用', icon: '🔧', color: '#fcd34d', extra: false },
    condition:{ label: '条件分支', icon: '◇',  color: '#fca5a5', extra: false },
    human:    { label: '人工确认', icon: '✋', color: '#86efac', extra: false },
    end:      { label: '结束',     icon: '⏹', color: '#94a3b8', extra: false }
  };

  // 每个 LLM 节点：系统提示 + 上下文的 token 量。tool 节点：返回结果的 token 量。
  // 缺省值给一个保守估计，用户可以按节点改。
  var DEFAULTS = { llm: 800, tool: 300, human: 0, condition: 0, start: 0, end: 0 };

  var PRICES = {
    'claude-sonnet-4.5': { in: 3, out: 15, name: 'Claude Sonnet 4.5' },
    'gpt-5':             { in: 1.25, out: 10, name: 'GPT-5' },
    'gemini-2.5-pro':    { in: 1.25, out: 10, name: 'Gemini 2.5 Pro' },
    'deepseek-v3.2':     { in: 0.28, out: 0.42, name: 'DeepSeek v3.2' },
    'qwen3-max':         { in: 1.2, out: 6, name: 'Qwen3-Max' }
  };

  /* ---------- 基础工具 ---------- */

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function newNode(type, x, y, label) {
    var id = 'n' + Math.random().toString(36).slice(2, 8);
    return {
      id: id,
      type: type,
      label: label || (TYPES[type] ? TYPES[type].label : '节点'),
      x: x || 60,
      y: y || 60,
      conf: quickConf(type)
    };
  }

  // 根据节点类型自动写一段「配置」草稿，用户可改文字内容，tokens 自动估算
  function quickConf(type) {
    switch (type) {
      case 'llm': return { model: 'deepseek-v3.2', inTok: 800, outTok: 250, sys: '你是一个严谨的助手。' };
      case 'tool': return { name: 'web_search', inTok: 0, outTok: 300, sys: '{"query": "..."}' };
      case 'condition': return { expr: '上一步结果是否为空？' };
      case 'human': return { sys: '请确认该操作是否执行。' };
      default: return {};
    }
  }

  function tokenCost(node) {
    var c = node.conf || {};
    if (node.type === 'llm') return (num(c.inTok, DEFAULTS.llm) + num(c.outTok, 0));
    if (node.type === 'tool') return num(c.outTok, DEFAULTS.tool);
    return 0;
  }

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  /* ---------- 图分析 ---------- */

  function outgoing(g, id) { return (g.edges || []).filter(function (e) { return e.from === id; }); }
  function incoming(g, id) { return (g.edges || []).filter(function (e) { return e.to === id; }); }

  // Kahn 拓扑排序；有环则返回 { ok:false, cycle:[...] }
  function topoSort(g) {
    var ids = Object.keys(g.nodes || {});
    var indeg = {};
    ids.forEach(function (i) { indeg[i] = 0; });
    (g.edges || []).forEach(function (e) {
      if (indeg[e.to] !== undefined) indeg[e.to]++;
    });
    var q = ids.filter(function (i) { return indeg[i] === 0; });
    q.sort();
    var order = [];
    while (q.length) {
      var cur = q.shift();
      order.push(cur);
      outgoing(g, cur).forEach(function (e) {
        if (indeg[e.to] === undefined) return;
        indeg[e.to]--;
        if (indeg[e.to] === 0) q.push(e.to);
      });
    }
    if (order.length !== ids.length) {
      var rest = ids.filter(function (i) { return order.indexOf(i) < 0; });
      return { ok: false, cycle: findCycle(g, rest) };
    }
    return { ok: true, order: order };
  }

  // 在剩余节点里随手走一圈找到实际环
  function findCycle(g, candidates) {
    var inSet = {};
    candidates.forEach(function (i) { inSet[i] = true; });
    var start = candidates[0];
    if (!start) return [];
    var seen = {}, path = [], cur = start;
    while (cur && !seen[cur] && inSet[cur] !== false) {
      seen[cur] = true;
      path.push(cur);
      var outs = outgoing(g, cur).filter(function (e) { return inSet[e.to]; });
      if (!outs.length) break;
      cur = outs[0].to;
      if (cur === start) { path.push(start); break; }
    }
    return path;
  }

  // 从 start 出发能到达的所有节点
  function reachable(g, from) {
    var seen = {}, stack = [from];
    while (stack.length) {
      var c = stack.pop();
      if (seen[c]) continue;
      seen[c] = true;
      outgoing(g, c).forEach(function (e) { if (!seen[e.to]) stack.push(e.to); });
    }
    return seen;
  }

  function findStart(g) {
    var ids = Object.keys(g.nodes || {});
    for (var i = 0; i < ids.length; i++) {
      if (g.nodes[ids[i]].type === 'start') return ids[i];
    }
    // 没有 start 就从入度为 0 的第一个节点起跑
    var zero = ids.filter(function (i) { return incoming(g, i).length === 0; });
    return zero[0] || ids[0] || null;
  }

  /* ---------- 执行追踪 ---------- */

  // decisions: { condNodeId: true|false } —— 条件节点走哪边，默认 true
  function run(g, decisions) {
    decisions = decisions || {};
    var ev = [];
    var ts = topoSort(g);
    if (!ts.ok) {
      return { ok: false, error: '检测到循环依赖，无法拓扑排序', cycle: ts.cycle, events: [], stats: null };
    }
    var start = findStart(g);
    if (!start) return { ok: false, error: '图里还没有节点', events: [], stats: null };

    var reach = reachable(g, start);
    var dead = Object.keys(g.nodes || {}).filter(function (i) { return !reach[i]; });

    var order = ts.order, visited = {}, active = 0;
    var widths = widthOf(g, order);
    var tokIn = 0, tokOut = 0, toolCalls = 0, llmCalls = 0, humanWalls = 0;
    var routes = {};

    for (var k = 0; k < order.length; k++) {
      var id = order[k];
      if (!reach[id]) continue;
      var n = g.nodes[id];
      var ins = incoming(g, id).filter(function (e) { return reach[e.from]; });
      // 只有所有有效前驱都跑过、且没有一条路「明确拒绝」时节点才真的被激活
      var activated = ins.length === 0;
      var blocked = false;
      for (var j = 0; j < ins.length; j++) {
        var e = ins[j];
        if (!visited[e.from]) continue;
        if (e.from === start || routes[e.from + '>' + id] !== false) { activated = true; }
        if (routes[e.from + '>' + id] === false && ins.length === 1) blocked = true;
      }
      if (blocked) { ev.push({ id: id, kind: 'skip', label: n.label, note: '分支未选中，跳过' }); continue; }
      if (!activated) { ev.push({ id: id, kind: 'skip', label: n.label, note: '前驱未执行，跳过' }); continue; }
      visited[id] = true;
      active++;

      var tk = tokenCost(n);
      var note = '';
      if (n.type === 'llm') { llmCalls++; tokIn += num((n.conf||{}).inTok, DEFAULTS.llm); tokOut += num((n.conf||{}).outTok, 0); note = '模型直读上下文'; }
      if (n.type === 'tool') { toolCalls++; tokOut += num((n.conf||{}).outTok, DEFAULTS.tool); note = '工具结果写回上下文'; }
      if (n.type === 'human') { humanWalls++; note = '流程在此挂起等人'; }
      if (n.type === 'condition') {
        var take = decisions[id] === false ? false : true;
        note = '走「' + (take ? '是' : '否') + '」分支';
        outgoing(g, id).forEach(function (oe) {
          var isT = oe.cond !== 'false';
          routes[id + '>' + oe.to] = (isT === take);
        });
      }
      ev.push({
        id: id, kind: 'run', type: n.type, label: n.label,
        inTok: n.type === 'llm' ? num((n.conf||{}).inTok, DEFAULTS.llm) : 0,
        outTok: n.type === 'llm' ? num((n.conf||{}).outTok, 0) : (n.type === 'tool' ? num((n.conf||{}).outTok, DEFAULTS.tool) : 0),
        tok: tk, note: note
      });
    }

    var stats = {
      nodes: Object.keys(g.nodes || {}).length,
      ran: active,
      skipped: order.length - active + dead.length,
      dead: dead,
      tokIn: tokIn,
      tokOut: tokOut,
      tok: tokIn + tokOut,
      toolCalls: toolCalls,
      llmCalls: llmCalls,
      humanWalls: humanWalls,
      depth: widths.depth,       // 关键路径长度 = 串行最少步数
      width: widths.width,       // 某一时刻最多同时跑的节点数
      parallel: widths.width > 1
    };
    return { ok: true, events: ev, stats: stats, order: order };
  }

  /* 关键路径深度 与 最大并行宽度（节点耗时各算 1 单位） */
  function widthOf(g, order) {
    var endOf = {};
    order.forEach(function (id) {
      if (endOf[id]) return;
      var ins = incoming(g, id).filter(function (e) { return endOf[e.from] !== undefined; });
      var t = 0;
      ins.forEach(function (e) { if (endOf[e.from] > t) t = endOf[e.from]; });
      endOf[id] = t + 1;
    });
    // horizon = 全部节点收尾时刻（算并行宽度用）
    var horizon = 0, depth = 0;
    order.forEach(function (id) {
      if (endOf[id] > horizon) horizon = endOf[id];
      // 关键路径 = 从入口到某个「无出口」节点的最长链
      if (!outgoing(g, id).length && endOf[id] > depth) depth = endOf[id];
    });
    if (!depth) depth = horizon;
    var width = 1;
    for (var t = 1; t <= horizon; t++) {
      var c = 0;
      order.forEach(function (id) { if (endOf[id] === t) c++; });
      if (c > width) width = c;
    }
    return { depth: depth, width: width };
  }

  /* ---------- 费用 ---------- */

  function priceRun(stats, model, runsPerDay) {
    var p = PRICES[model] || PRICES['deepseek-v3.2'];
    runsPerDay = num(runsPerDay, 100);
    var perRun = (stats.tokIn / 1e6) * p.in + (stats.tokOut / 1e6) * p.out;
    return {
      model: model, name: p.name,
      perRun: perRun,
      perDay: perRun * runsPerDay,
      perMonth: perRun * runsPerDay * 30
    };
  }

  function allPrices(stats, runsPerDay) {
    return Object.keys(PRICES).map(function (m) { return priceRun(stats, m, runsPerDay); })
      .sort(function (a, b) { return a.perRun - b.perRun; });
  }

  /* ---------- 诊断：给出可执行的改进建议 ---------- */

  function lint(g) {
    var out = [];
    var ids = Object.keys(g.nodes || {});
    if (!ids.length) return [{ level: 'warn', msg: '还是空图，先拖几个节点进来。' }];

    var ts = topoSort(g);
    if (!ts.ok) out.push({ level: 'error', msg: '存在循环依赖：' + ts.cycle.join(' → ') + '。Agent 会无限打转。' });

    if (!ids.some(function (i) { return g.nodes[i].type === 'start'; }))
      out.push({ level: 'warn', msg: '没有「开始」节点，入口不确定。' });
    if (!ids.some(function (i) { return g.nodes[i].type === 'end'; }))
      out.push({ level: 'warn', msg: '没有「结束」节点，流程不会收敛。' });

    var start = findStart(g);
    if (start) {
      var reach = reachable(g, start);
      var dead = ids.filter(function (i) { return !reach[i]; });
      if (dead.length) out.push({ level: 'warn', msg: '有 ' + dead.length + ' 个节点从开始节点走不到（孤儿节点）。' });
    }

    // 悬空出口
    ids.forEach(function (id) {
      var n = g.nodes[id];
      if (n.type === 'end') return;
      if (!outgoing(g, id).length) out.push({ level: 'warn', msg: '「' + n.label + '」没有出口，流程会断在这里。' });
    });

    // 条件节点必须有两条分支
    ids.forEach(function (id) {
      var n = g.nodes[id];
      if (n.type !== 'condition') return;
      var outs = outgoing(g, id);
      if (outs.length < 2) out.push({ level: 'error', msg: '条件「' + n.label + '」只有 ' + outs.length + ' 条分支，至少要两条。' });
    });

    // token 大头提示
    var t = run(g);
    if (t.ok && t.stats.tok > 0) {
      var biggest = null;
      t.events.forEach(function (e) {
        if (!biggest || e.tok > biggest.tok) { if (e.tok > 0) biggest = e; }
      });
      if (biggest) {
        out.push({ level: 'info', msg: 'Token 大户是「' + biggest.label + '」（约 ' + biggest.tok + ' tokens／次）。' });
      }
      if (t.stats.humanWalls > 2) out.push({ level: 'info', msg: '人工确认点有 ' + t.stats.humanWalls + ' 处，跑批时会很卡。' });
      if (t.stats.tok > 20000) out.push({ level: 'info', msg: '单次约 ' + t.stats.tok + ' tokens，一天 100 次就是 ' + Math.round(t.stats.tok * 100 / 1000) + 'k tokens，先想清楚值不值。' });
    }
    var hasHard = out.some(function (m) { return m.level === 'error' || m.level === 'warn'; });
    if (!hasHard) out.unshift({ level: 'ok', msg: '结构健康：入口清楚、无环、每个节点都有出口。' });
    return out;
  }

  /* ---------- 序列化：把图导出成 Mermaid / ASCII ---------- */

  function toMermaid(g) {
    var lines = ['flowchart TD'];
    Object.keys(g.nodes || {}).forEach(function (id) {
      var n = g.nodes[id];
      var shape = n.type === 'condition' ? ['{', '}'] : (n.type === 'start' || n.type === 'end' ? ['([', '])'] : ['[', ']']);
      lines.push('  ' + id + shape[0] + '"' + String(n.label).replace(/"/g, "'") + '"' + shape[1]);
    });
    (g.edges || []).forEach(function (e) {
      var lab = e.cond === 'true' ? '|是|' : (e.cond === 'false' ? '|否|' : '');
      lines.push('  ' + e.from + ' -->' + lab + ' ' + e.to);
    });
    return lines.join('\n');
  }

  var api = {
    TYPES: TYPES, PRICES: PRICES, DEFAULTS: DEFAULTS,
    newNode: newNode, quickConf: quickConf, tokenCost: tokenCost,
    topoSort: topoSort, reachable: reachable, findStart: findStart,
    outgoing: outgoing, incoming: incoming,
    run: run, priceRun: priceRun, allPrices: allPrices, lint: lint, widthOf: widthOf,
    toMermaid: toMermaid, clone: clone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FlowEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
