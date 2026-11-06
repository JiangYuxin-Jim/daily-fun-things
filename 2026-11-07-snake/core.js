/* Snake core engine — 纯函数，浏览器 (window.SnakeCore) 与 node (module.exports) 两用。
 * 不碰 DOM、不碰 canvas、不用 Date.now / Math.random（随机源可注入），
 * 所以整条逻辑可以在 node 里被确定性地测试。
 */
(function (root) {
  'use strict';

  var DIRS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1  },
    left:  { x: -1, y: 0  },
    right: { x: 1,  y: 0  }
  };
  var OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  var DIR_ORDER = ['up', 'right', 'down', 'left'];

  function isOpposite(a, b) { return OPPOSITE[a] === b; }

  function key(c, w) { return c.y * w + c.x; }

  /* 创建游戏状态
   * opts: { cols, rows, rng }  rng 为可选 () => [0,1)
   */
  function createGame(opts) {
    opts = opts || {};
    var cols = opts.cols || 20;
    var rows = opts.rows || 20;
    var rng = opts.rng || Math.random;
    var midY = Math.floor(rows / 2);
    var snake = [
      { x: Math.min(3, cols - 1), y: midY },
      { x: Math.min(2, cols - 1), y: midY },
      { x: Math.min(1, cols - 1), y: midY }
    ];
    var state = {
      cols: cols,
      rows: rows,
      rng: rng,
      snake: snake,
      dir: 'right',
      pendingDir: 'right',
      food: null,
      score: 0,
      eaten: 0,
      ticks: 0,
      status: 'running', // running | paused | over | won
      deathReason: null, // 'wall' | 'self' | null
      lastGrow: false
    };
    state.food = spawnFood(state);
    return state;
  }

  function occupySet(state) {
    var s = new Set();
    for (var i = 0; i < state.snake.length; i++) s.add(key(state.snake[i], state.cols));
    return s;
  }

  /* 随机空格上放食物；满了返回 null（通关） */
  function spawnFood(state) {
    var used = occupySet(state);
    var empty = [];
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        if (!used.has(y * state.cols + x)) empty.push({ x: x, y: y });
      }
    }
    if (empty.length === 0) return null;
    var idx = Math.floor(state.rng() * empty.length) % empty.length;
    return empty[idx];
  }

  /* 排队转向：一 tick 内最多生效一次，且不能 180 度掉头 */
  function queueDir(state, dir) {
    if (!DIRS[dir]) return false;
    if (state.status !== 'running' && state.status !== 'paused') return false;
    // 关键：反查 pendingDir 而不是 dir。否则 up→right→down 在同一 tick 内
    // 会以 dir=right 判 down 合法，实际推进时 down 与马上要执行的 right 形成 180° 掉头自杀。
    if (isOpposite(state.pendingDir, dir)) return false;
    if (dir === state.pendingDir) return false;
    state.pendingDir = dir;
    return true;
  }

  /* 推进一步。返回事件：{ moved, ate, died, won, reason, wrapped }
   * opts.wrap = true 时穿墙（从对面进来）
   */
  function step(state, opts) {
    opts = opts || {};
    if (state.status !== 'running') {
      return { moved: false, ate: false, died: false, won: false, reason: state.status, wrapped: false };
    }
    state.dir = state.pendingDir;
    state.ticks++;
    var head = state.snake[0];
    var d = DIRS[state.dir];
    var nx = head.x + d.x;
    var ny = head.y + d.y;
    var wrapped = false;

    if (opts.wrap) {
      if (nx < 0 || nx >= state.cols || ny < 0 || ny >= state.rows) wrapped = true;
      nx = (nx + state.cols) % state.cols;
      ny = (ny + state.rows) % state.rows;
    } else if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) {
      state.status = 'over';
      state.deathReason = 'wall';
      return { moved: false, ate: false, died: true, won: false, reason: 'wall', wrapped: false };
    }

    var ate = !!state.food && state.food.x === nx && state.food.y === ny;
    // 尾巴这一 tick 会离开（除非正在吃），所以可以走进尾巴所在格
    var willGrow = ate;
    var body = willGrow ? state.snake : state.snake.slice(0, state.snake.length - 1);
    for (var i = 0; i < body.length; i++) {
      if (body[i].x === nx && body[i].y === ny) {
        state.status = 'over';
        state.deathReason = 'self';
        return { moved: false, ate: false, died: true, won: false, reason: 'self', wrapped: false };
      }
    }

    state.snake.unshift({ x: nx, y: ny });
    if (ate) {
      state.score += 10;
      state.eaten++;
      state.lastGrow = true;
      state.food = spawnFood(state);
      if (!state.food) {
        state.status = 'won';
        return { moved: true, ate: true, died: false, won: true, reason: 'filled', wrapped: wrapped };
      }
    } else {
      state.snake.pop();
      state.lastGrow = false;
    }
    return { moved: true, ate: ate, died: false, won: false, reason: null, wrapped: wrapped };
  }

  /* 当前速度（毫秒/格）：吃得越多越快，有下限 */
  function tickInterval(state, cfg) {
    cfg = cfg || {};
    var base = cfg.base || 170;
    var floor = cfg.floor || 70;
    var stepMs = cfg.step || 6;
    return Math.max(floor, base - state.eaten * stepMs);
  }

  function isInside(state, x, y) {
    return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
  }

  function clone(state) {
    var s = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) s[k] = state[k];
    s.snake = state.snake.map(function (c) { return { x: c.x, y: c.y }; });
    s.food = state.food ? { x: state.food.x, y: state.food.y } : null;
    return s;
  }

  /* ---- AI 提示：BFS 找头部到食物的最短路径，选第一步方向 ---- */
  function bfsFirstMove(state) {
    if (!state.food || state.status === 'over' || state.status === 'won') return null;
    var w = state.cols, h = state.rows;
    var blocked = occupySet(state);
    // 尾巴会移动，视为可走
    var tail = state.snake[state.snake.length - 1];
    if (state.snake.length > 1) blocked.delete(key(tail, w));

    var start = state.snake[0];
    var startK = key(start, w);
    var prev = new Map();
    prev.set(startK, null);
    var q = [start];
    var target = key(state.food, w);
    var found = false;
    while (q.length) {
      var cur = q.shift();
      var curK = key(cur, w);
      if (curK === target) { found = true; break; }
      for (var i = 0; i < DIR_ORDER.length; i++) {
        var name = DIR_ORDER[i];
        var dd = DIRS[name];
        var nx = cur.x + dd.x, ny = cur.y + dd.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var nk = key({ x: nx, y: ny }, w);
        if (prev.has(nk)) continue;
        if (blocked.has(nk)) continue;
        if (isOpposite(state.dir, name) && curK === startK) continue; // 不能立刻掉头
        prev.set(nk, curK);
        q.push({ x: nx, y: ny });
      }
    }
    if (!found) return null;
    // 回溯到第一步
    var node = target;
    var guard = 0;
    while (prev.get(node) !== startK && guard++ < w * h * 4) {
      node = prev.get(node);
      if (node === null || node === undefined) return null;
    }
    var first = { x: node % w, y: Math.floor(node / w) };
    for (var dn in DIRS) {
      if (start.x + DIRS[dn].x === first.x && start.y + DIRS[dn].y === first.y) return dn;
    }
    return null;
  }

  var api = {
    DIRS: DIRS,
    OPPOSITE: OPPOSITE,
    isOpposite: isOpposite,
    createGame: createGame,
    spawnFood: spawnFood,
    queueDir: queueDir,
    step: step,
    tickInterval: tickInterval,
    isInside: isInside,
    clone: clone,
    bfsFirstMove: bfsFirstMove
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SnakeCore = api;
})(typeof self !== 'undefined' ? self : this);
