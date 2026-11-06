/* 反向校验：让 AI BFS 自动驾驶跑 200 局，用独立统计确认引擎行为自洽。
 * 判据（不依赖 core.js 内部实现，只看外部可观察量）：
 *   1. 任何一局里蛇身各格坐标必须两两不同（没有重叠）
 *   2. 蛇长 == 3 + 吃掉的食物数
 *   3. 分数 == 10 * 食物数
 *   4. 每步头只移动一格（欧氏距离为 1，或穿墙时跨边）
 *   5. 食物永远不出现在蛇身上
 */
const G = require('./core.js');

function seeded(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

let games = 0, totalScore = 0, totalEaten = 0, deaths = { wall: 0, self: 0 }, maxScore = 0, wins = 0;
const violations = [];

for (let gi = 0; gi < 200; gi++) {
  const s = G.createGame({ cols: 15, rows: 15, rng: seeded(1000 + gi) });
  const startLen = s.snake.length;
  let prevHead = { x: s.snake[0].x, y: s.snake[0].y };
  let steps = 0;
  const MAX_STEPS = 6000;

  while (s.status === 'running' && steps < MAX_STEPS) {
    const d = G.bfsFirstMove(s);
    if (!d) break; // 无路可走，留给随机结束
    G.queueDir(s, d);
    const ev = G.step(s);
    steps++;

    const head = s.snake[0];
    // 1. 身体不重叠
    const seen = new Set();
    for (const c of s.snake) {
      const k = c.y * s.cols + c.x;
      if (seen.has(k)) violations.push(`局${gi} 步${steps}: 蛇身重叠 @${c.x},${c.y}`);
      seen.add(k);
    }
    // 4. 移动一格
    const dx = Math.abs(head.x - prevHead.x), dy = Math.abs(head.y - prevHead.y);
    const okMove = (dx + dy === 1) || ev.wrapped;
    if (!okMove && ev.moved) violations.push(`局${gi} 步${steps}: 头跳格 ${JSON.stringify(prevHead)}→${JSON.stringify(head)}`);
    prevHead = { x: head.x, y: head.y };

    // 2/3. 长度与分数
    if (s.snake.length !== startLen + s.eaten) violations.push(`局${gi}: 长度 ${s.snake.length} ≠ ${startLen}+${s.eaten}`);
    if (s.score !== s.eaten * 10) violations.push(`局${gi}: 分数 ${s.score} ≠ 10*${s.eaten}`);

    // 5. 食物不在蛇身
    if (s.food && s.snake.some(c => c.x === s.food.x && c.y === s.food.y)) {
      violations.push(`局${gi} 步${steps}: 食物落在蛇身上`);
    }
  }

  games++;
  totalScore += s.score;
  totalEaten += s.eaten;
  if (s.status === 'won') wins++;
  else deaths[s.deathReason || 'wall'] = (deaths[s.deathReason || 'wall'] || 0) + 1;
  maxScore = Math.max(maxScore, s.score);
}

console.log('=== AI 自动驾驶 200 局（15×15）===');
console.log('总局数        :', games);
console.log('平均分        :', (totalScore / games).toFixed(1));
console.log('最高分        :', maxScore);
console.log('平均吃掉        :', (totalEaten / games).toFixed(1));
console.log('死因统计      :', JSON.stringify(deaths), ' 通关:', wins);
console.log('不变量违反次数  :', violations.length);
if (violations.length) console.log(violations.slice(0, 10).join('\n'));

process.exit(violations.length ? 1 : 0);
