/* git-lab engine — 纯函数 Git 模型，无 DOM 依赖，可在 Node 中测试 */
(function (root) {
  'use strict';

  // ---------- 基础工具 ----------
  function h(n) {
    // 确定性短哈希：为了可读性用 7 位十六进制
    let s = 2166136261 >>> 0;
    const str = 'g' + n + ':' + (root.__seed || '');
    for (let i = 0; i < str.length; i++) {
      s ^= str.charCodeAt(i);
      s = Math.imul(s, 16777619) >>> 0;
      s ^= s >>> 13;
      s = Math.imul(s, 0x5bd1e995) >>> 0;
      s ^= s >>> 15;
    }
    let out = '';
    let x = s;
    for (let i = 0; i < 7; i++) {
      out += '0123456789abcdef'[(x >>> (i * 4 % 28)) & 15];
      x = Math.imul(x ^ (x >>> 7), 2246822519) >>> 0;
    }
    return out;
  }

  function clone(state) {
    return {
      n: state.n,
      commits: state.commits.map(c => ({ ...c, parents: c.parents.slice() })),
      branches: { ...state.branches },
      head: { ...state.head },
      index: { ...state.index },
      conflicts: state.conflicts.slice(),
      detached: !!state.detached,
      log: state.log.slice(-30)
    };
  }

  function newState() {
    return {
      n: 0,
      commits: [],          // {id, msg, parents:[id], files:{path:content}}
      branches: { main: null },
      head: { branch: 'main', commit: null },
      index: {},            // 工作区 + 暂存区（简化：合并为一个 index）
      conflicts: [],
      detached: false,
      log: []
    };
  }

  function tip(state) {
    return state.head.commit;
  }

  function commitFiles(state, id) {
    const c = state.commits.find(x => x.id === id);
    return c ? c.files : {};
  }

  function treeOf(state, id) {
    // 收集从根到 id 的完整文件快照
    const seen = new Set();
    let files = {};
    const walk = (cid) => {
      if (!cid || seen.has(cid)) return;
      seen.add(cid);
      const c = state.commits.find(x => x.id === cid);
      if (!c) return;
      c.parents.forEach(walk);
      Object.assign(files, c.files);
    };
    walk(id);
    return files;
  }

  function status(state) {
    const headFiles = treeOf(state, tip(state));
    const staged = [], untracked = [];
    Object.keys(state.index).forEach(f => {
      if (state.conflicts.indexOf(f) >= 0) return;
      const inHead = Object.prototype.hasOwnProperty.call(headFiles, f);
      if (!inHead) untracked.push(f);
      else if (headFiles[f] !== state.index[f]) staged.push(f);
    });
    return { staged, untracked, conflicts: state.conflicts.slice(), headFiles };
  }

  // ---------- 命令实现 ----------
  const commands = {};

  commands.init = (state) => {
    return { out: '初始化空的 Git 仓库\n已创建分支 main', state };
  };

  commands.status = (state) => {
    const s = status(state);
    const lines = [];
    lines.push('位于分支 ' + (state.detached ? '(分离头指针)' : state.head.branch));
    if (state.conflicts.length) {
      lines.push('存在冲突：');
      state.conflicts.forEach(c => lines.push('  两者皆改: ' + c));
      return { out: lines.join('\n'), state };
    }
    if (s.staged.length) {
      lines.push('要提交的变更：');
      s.staged.forEach(f => lines.push('  修改: ' + f));
    } else lines.push('无要提交的变更');
    if (s.untracked.length) {
      lines.push('未跟踪的文件（需要 git add）：');
      s.untracked.forEach(f => lines.push('  ' + f));
    }
    return { out: lines.join('\n'), state };
  };

  commands.add = (state, args) => {
    const what = args.join(' ');
    if (!what) return { out: '用法: git add <文件|.>', state };
    const files = what === '.' ? Object.keys(state.index) : args.filter(a => !a.startsWith('-'));
    files.forEach(f => {
      // 每次 add 都把该文件的内容版本推进一版，所以 merge 时才能出现真实冲突
      state.n++;
      state.index[f] = 'v' + state.n;
    });
    if (!files.length) return { out: '错误: 没有可暂存的文件', state };
    return { out: '暂存区已更新', state };
  };

  commands.commit = (state, args) => {
    const flagIdx = args.indexOf('-m');
    const msg = flagIdx >= 0 ? args.slice(flagIdx + 1).join(' ').replace(/^["']|["']$/g, '') : '';
    if (!msg) return { out: '错误: 需要 -m "提交说明"', state };
    const s = status(state);
    const toCommit = s.staged.concat(s.untracked);
    if (!toCommit.length) return { out: '错误: 没有暂存任何文件（先 git add）', state };
    state.n++;
    const id = h(state.n);
    const parent = tip(state);
    const files = {};
    toCommit.forEach(f => { files[f] = state.index[f]; });
    state.commits.push({ id, msg, parents: parent ? [parent] : [], files });
    if (state.detached) {
      state.head.commit = id;
    } else {
      state.branches[state.head.branch] = id;
      state.head.commit = id;
    }
    // 清理已提交的暂存项
    toCommit.forEach(f => { delete state.index[f]; });
    return { out: '[' + state.head.branch + ' ' + id + '] ' + msg, state };
  };

  commands.branch = (state, args) => {
    const name = args.filter(a => !a.startsWith('-'))[0];
    if (!name) {
      const lines = Object.keys(state.branches).sort().map(b =>
        (b === state.head.branch ? '* ' : '  ') + b + ' -> ' + (state.branches[b] || '(空)'));
      return { out: lines.join('\n'), state };
    }
    if (state.branches[name] !== undefined) return { out: '错误: 分支 ' + name + ' 已存在', state };
    state.branches[name] = tip(state);
    return { out: '已创建分支 ' + name, state };
  };

  function switchTo(state, name) {
    if (name === '-') name = state.prevBranch || 'main';
    if (state.branches[name] === undefined) return { out: '错误: 分支 ' + name + ' 不存在', state };
    state.prevBranch = state.head.branch;
    state.head = { branch: name, commit: state.branches[name] };
    state.detached = false;
    return { out: '切换到分支 ' + name, state };
  }

  commands.checkout = (state, args) => {
    const flags = args.filter(a => a.startsWith('-') && a !== '-');
    let name = args.filter(a => a !== '-' && !a.startsWith('-'))[0];
    if (flags.some(f => f === '-b' || f === '-c')) {
      if (!name) return { out: '用法: git checkout -b <新分支>', state };
      if (state.branches[name] !== undefined) return { out: '错误: 分支 ' + name + ' 已存在', state };
      state.branches[name] = tip(state);
      const r = switchTo(state, name);
      r.out = '已创建并切换到新分支 ' + name;
      return r;
    }
    if (!name && args.includes('-')) name = '-';
    if (!name) return { out: '用法: git checkout <分支>', state };
    return switchTo(state, name);
  };

  commands.switch = (state, args) => {
    const flags = args.filter(a => a.startsWith('-'));
    const name = args.filter(a => !a.startsWith('-'))[0];
    if (flags.includes('-c') || flags.includes('-C')) {
      if (!name) return { out: '用法: git switch -c <新分支>', state };
      if (state.branches[name] !== undefined) return { out: '错误: 分支 ' + name + ' 已存在', state };
      state.branches[name] = tip(state);
      const r = switchTo(state, name);
      r.out = '已创建并切换到新分支 ' + name;
      return r;
    }
    if (!name) return { out: '用法: git switch <分支>', state };
    return switchTo(state, name);
  };

  function ancestorSet(state, id) {
    const set = new Set();
    const walk = (c) => {
      if (!c || set.has(c)) return;
      set.add(c);
      const cm = state.commits.find(x => x.id === c);
      if (cm) cm.parents.forEach(walk);
    };
    walk(id);
    return set;
  }

  function mergeBase(state, a, b) {
    if (!a || !b) return null;
    const A = ancestorSet(state, a);
    // BFS 从 b 往上找第一个在 A 中的
    const q = [b], seen = new Set();
    while (q.length) {
      const c = q.shift();
      if (seen.has(c)) continue;
      seen.add(c);
      if (A.has(c)) return c;
      const cm = state.commits.find(x => x.id === c);
      if (cm) cm.parents.forEach(p => q.push(p));
    }
    return null;
  }

  commands.merge = (state, args) => {
    const name = args.filter(a => !a.startsWith('-'))[0];
    if (!name) return { out: '用法: git merge <分支>', state };
    if (state.branches[name] === undefined) return { out: '错误: 分支 ' + name + ' 不存在', state };
    const ours = tip(state), theirs = state.branches[name];
    if (!theirs) return { out: '错误: 该分支还没有提交', state };
    if (!ours) {
      state.branches[state.head.branch] = theirs;
      state.head.commit = theirs;
      return { out: '快进合并到 ' + theirs, state, fastForward: true };
    }
    if (ancestorSet(state, ours).has(theirs)) {
      return { out: '已经是最新的（无需合并）', state, upToDate: true };
    }
    if (ancestorSet(state, theirs).has(ours)) {
      state.branches[state.head.branch] = theirs;
      state.head.commit = theirs;
      return { out: '快进合并: ' + ours.slice(0, 7) + '..' + theirs, state, fastForward: true };
    }
    // 三方合并
    const base = mergeBase(state, ours, theirs);
    const F = { o: treeOf(state, ours), t: treeOf(state, theirs), b: treeOf(state, base) };
    const paths = new Set([...Object.keys(F.o), ...Object.keys(F.t), ...Object.keys(F.b)]);
    const merged = {}, conflicts = [];
    paths.forEach(p => {
      const o = F.o[p], t = F.t[p], b = F.b[p];
      if (o === t) merged[p] = o;
      else if (o === b) merged[p] = t;
      else if (t === b) merged[p] = o;
      else conflicts.push(p);
    });
    state.n++;
    const id = h(state.n);
    if (conflicts.length) {
      state.conflicts = conflicts;
      return { out: '自动合并失败；冲突文件：\n  ' + conflicts.join('\n  ') + '\n解决后在控制台输入 git merge --continue',
        state, conflict: true };
    }
    const files = {};
    Object.keys(merged).forEach(p => { if (merged[p] !== F.o[p]) files[p] = merged[p]; });
    state.commits.push({ id, msg: "合并分支 '" + name + "'", parents: [ours, theirs], files });
    state.branches[state.head.branch] = id;
    state.head.commit = id;
    return { out: '合并提交 ' + id + '（三方合并，父提交 ' + ours + ' + ' + theirs + '）', state, mergeCommit: true };
  };

  function run(state, input) {
    const line = String(input || '').trim();
    if (!line) return { out: '', state: clone(state) };
    if (line === 'clear') return { out: 'CLEAR', state };
    if (line === 'help' || line === '?') return { out: HELP, state: clone(state) };
    const parts = line.split(/\s+/);
    if (parts[0] !== 'git') return { out: '只支持 git 命令（输入 help 看清单）', state: clone(state) };
    let cmd = parts[1] || '';
    const args = parts.slice(2);
    if (cmd === 'merge' && args[0] === '--continue') {
      if (state.conflicts.length) return { out: '错误: 仍有冲突未解决: ' + state.conflicts.join(', '), state: clone(state) };
      return { out: '没有进行中的合并', state: clone(state) };
    }
    const fn = commands[cmd];
    if (!fn) return { out: '暂不支持: git ' + cmd + '（输入 help 看清单）', state: clone(state) };
    const next = clone(state);
    const r = fn(next, args);
    state.log.push({ in: line, out: r.out });
    return { out: r.out, state: r.state, meta: r };
  }

  const HELP = [
    '可用命令：',
    '  git init                       初始化仓库',
    '  git add <文件|.>               暂存',
    '  git commit -m "说明"           提交',
    '  git branch                     列出分支',
    '  git branch <名字>              新建分支',
    '  git checkout <分支|-b 新分支>  切换 / 新建并切换',
    '  git switch <分支|-c 新分支>    同上（新语法）',
    '  git merge <分支>               合并（快进 / 三方 / 冲突）',
    '  git status                     查看状态',
    '  注意：这个模拟器用命令代替「改文件」，',
    '  add 的文件内容记为一次修改快照。'
  ].join('\n');

  // 关卡：从零一路走到合并，每一步校验分支图状态
  const LEVELS = require_levels();

  function require_levels() {
    return [
      {
        id: 1, title: '第一颗提交', hint: '初始化仓库，新建任务分支',
        goal: '让 main 有 1 个提交，并且分支 dev 存在并指向同一个提交',
        check: s => s.commits.length >= 1 && s.branches.dev !== undefined && s.branches.main === s.branches.dev,
        sample: 'git init\ngit add app.js\ngit commit -m "初始化"\ngit branch dev'
      },
      {
        id: 2, title: '分岔路口', hint: '在 dev 上往前走一步',
        goal: 'dev 比 main 多 1 个提交，且 main 未前进',
        check: s => {
          const d = s.branches.dev, m = s.branches.main;
          if (!d || !m || d === m) return false;
          return ancestorSet(s, d).has(m) && s.commits.find(c => c.id === d).parents[0] === m;
        },
        sample: 'git switch dev\ngit add feature.js\ngit commit -m "加功能"'
      },
      {
        id: 3, title: '快进合并', hint: '切回 main 再合并 dev',
        goal: 'main 与 dev 指向同一提交，且提交消息为「加功能」',
        check: s => {
          const d = s.branches.dev, m = s.branches.main;
          if (!d || d !== m) return false;
          const c = s.commits.find(x => x.id === m);
          return !!c && s.commits.length === 2;
        },
        sample: 'git switch main\ngit merge dev'
      },
      {
        id: 4, title: '真正的分叉', hint: '在 main 上再提交一次，然后对比后面那次合并',
        goal: '存在一个提交同时有两个父提交（合并提交）',
        check: s => s.commits.some(c => c.parents.length === 2),
        sample: 'git add hotfix.js\ngit commit -m "热修"\ngit merge dev'
      },
      {
        id: 5, title: '冲突现场', hint: '两边都改同一个文件',
        goal: '触发一次三方合并，并且最终通过 merge --continue 生成合并提交',
        check: s => s.commits.some(c => c.parents.length === 2 && /合并/.test(c.msg)),
        sample: '（进阶：两个分支各自 add 同名文件、commit，再 merge）'
      }
    ];
  }

  // 分支图布局：按提交顺序做拓扑分层
  function layout(state) {
    const byId = {};
    state.commits.forEach(c => { byId[c.id] = c; });
    const order = [];
    const seen = new Set();
    const visit = (id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const c = byId[id];
      if (!c) return;
      c.parents.forEach(visit);
      order.push(id);
    };
    state.commits.forEach(c => visit(c.id));

    // 每列的占用：贪心把同一条线的提交放同一列
    const col = {};
    let maxCol = 0;
    order.forEach(id => {
      const c = byId[id];
      let c0 = -1;
      if (c.parents.length === 1 && col[c.parents[0]] !== undefined) c0 = col[c.parents[0]];
      if (c.parents.length > 1) {
        const first = col[c.parents[0]];
        c0 = first !== undefined ? first : 0;
      }
      if (c0 < 0) {
        const used = new Set();
        order.forEach(o => { if (col[o] !== undefined) used.add(col[o]); });
        c0 = 0;
        while (used.has(c0)) c0++;
      }
      col[id] = c0;
      maxCol = Math.max(maxCol, c0);
    });

    // 按列渲染：col 0 是 main 主线
    const rows = {};
    const nodeList = order.map((id, i) => ({ id, col: col[id], row: 0, i }));

    // y 坐标：尝试让主分支在 col 0，其他分支在 col 1..n
    const branchCol = {};
    Object.keys(state.branches).sort().forEach((b, i) => { branchCol[b] = i; });

    const pos = {};
    const laneLast = {};
    nodeList.forEach((n) => {
      const lane = n.col;
      const prev = laneLast[lane] === undefined ? -1 : laneLast[lane];
      const y = prev + 1;
      pos[n.id] = { lane, y };
      laneLast[lane] = y;
    });

    // 压缩每条 lane 的 y 值，避免空洞
    const lanes = {};
    Object.keys(pos).forEach(id => {
      const p = pos[id];
      if (!lanes[p.lane]) lanes[p.lane] = [];
      lanes[p.lane].push(id);
    });

    const nodes = Object.keys(pos).map(id => {
      const c = byId[id];
      const labels = Object.keys(state.branches).filter(b => state.branches[b] === id);
      const isHead = state.head.commit === id;
      return { id, lane: pos[id].lane, y: pos[id].y, msg: c.msg, parents: c.parents, labels, isHead };
    });
    const edges = [];
    state.commits.forEach(c => c.parents.forEach(p => {
      if (pos[c.id] && pos[p]) {
        edges.push({ from: c.id, to: p, fl: pos[c.id].lane, tl: pos[p].lane, fx: pos[c.id].y, tx: pos[p].y });
      }
    }));
    return { nodes, edges, maxLane: maxCol, branchCol };
  }

  const api = { newState, run, layout, status, treeOf, mergeBase, ancestorSet, h, LEVELS, HELP, commands, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GitLab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
