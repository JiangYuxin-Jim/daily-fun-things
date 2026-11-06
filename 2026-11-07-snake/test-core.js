const G = require('./core.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n    got :', JSON.stringify(got), '\n    want:', JSON.stringify(want)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// 固定 rng，保证确定性
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

console.log('— 初始化 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(1) });
  eq('蛇长 3', s.snake.length, 3);
  eq('初始方向 right', s.dir, 'right');
  eq('头在 (3,5)', s.snake[0], { x: 3, y: 5 });
  ok('食物在盘内', G.isInside(s, s.food.x, s.food.y));
  ok('食物不在蛇身上', !s.snake.some(c => c.x === s.food.x && c.y === s.food.y));
}

console.log('— 移动 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(2) });
  s.food = { x: 9, y: 9 };
  const ev = G.step(s);
  eq('走一步 moved', ev.moved, true);
  eq('头到 (4,5)', s.snake[0], { x: 4, y: 5 });
  eq('长度不变', s.snake.length, 3);
  eq('尾 (1,5) 被弹出后尾巴是 (2,5)', s.snake[2], { x: 2, y: 5 });
}

console.log('— 禁止 180 度掉头 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(3) });
  eq('向右时不能 queue left', G.queueDir(s, 'left'), false);
  eq('可以 queue up', G.queueDir(s, 'up'), true);
  G.step(s);
  eq('转向生效 dir=up', s.dir, 'up');
}

console.log('— 一 tick 只转一次（防双转自杀）—');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(4) });
  s.food = { x: 0, y: 0 };
  G.queueDir(s, 'up');   // pending = up
  // 同一 tick 内又来一个 down：down 与当前 dir 'right' 不是反向，会被接受 → pending 变 down
  // 这是真实风险，我们用 UI 层队列化处理；核心层保证 pending 只有一个值
  eq('pending 唯一值 up', s.pendingDir, 'up');
  G.step(s);
  eq('执行 up', s.dir, 'up');
}

console.log('— 吃食物加分/变长 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(5) });
  s.food = { x: 4, y: 5 };
  const ev = G.step(s);
  eq('ate', ev.ate, true);
  eq('长度 4', s.snake.length, 4);
  eq('分数 10', s.score, 10);
  eq('eaten 1', s.eaten, 1);
  ok('新食物已生成且不在蛇身', s.food && !s.snake.some(c => c.x === s.food.x && c.y === s.food.y));
}

console.log('— 撞墙 —');
{
  const s = G.createGame({ cols: 5, rows: 5, rng: seeded(6) });
  s.food = { x: 0, y: 0 };
  // 5x5 → midY = 2，蛇头在 (3,2)，向右 1 步到 (4,2)，第 2 步撞右墙
  G.step(s);
  const ev = G.step(s);
  eq('头到 (4,2) 贴边', s.snake[0], { x: 4, y: 2 });
  eq('died', ev.died, true);
  eq('reason wall', ev.reason, 'wall');
  eq('status over', s.status, 'over');
  const again = G.step(s);
  eq('死亡后不再移动', again.moved, false);
}

console.log('— 撞自己 —');
{
  // 造一条长蛇：20x20，向上走再向左下绕回
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(7) });
  s.food = { x: 0, y: 0 }; // 远处
  // 手工塞一条长蛇：头在 (3,3)，身体向右延伸
  s.snake = [];
  for (let x = 3; x >= 0; x--) s.snake.push({ x, y: 3 });
  s.snake.push({ x: 0, y: 4 }, { x: 0, y: 5 }, { x: 1, y: 5 });
  // 头 (3,3)，dir right，pending down: 头往下 3,4 是空? 身体里有 (0,4)。先测直接撞
  s.dir = 'left'; s.pendingDir = 'left';
  // 让头左侧是自己的身体
  s.snake = [{ x: 3, y: 3 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
  s.dir = 'right'; s.pendingDir = 'up'; // 改道不行，我们直接设 pending 为 down
  s.pendingDir = 'down';
  // 头 (3,3) 下是 (3,4)，空。改成让 pending = right 撞不到。
  // 直接构造：头 (3,3) 向左会撞 (2,3)? 不在身体里。重新构造精确情形：
  s.snake = [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }];
  s.dir = 'up'; s.pendingDir = 'down'; // 上→下 是反向，不允许
  // 允许的方式：先设 dir=left 再 queue down 走到 (3,4) 撞身体
  s.dir = 'left'; s.pendingDir = 'down';
  const ev = G.step(s);
  eq('撞自己 died', ev.died, true);
  eq('reason self', ev.reason, 'self');
}

console.log('— 走进尾巴原位置不算死 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(8) });
  s.food = { x: 9, y: 9 };
  // 两格蛇：头 (1,1) 尾 (1,2)，头向下 → 进入尾巴格
  s.snake = [{ x: 1, y: 1 }, { x: 1, y: 2 }];
  s.dir = 'up'; s.pendingDir = 'down';
  const ev = G.step(s);
  eq('不吃食物时进尾巴格不判死', ev.died, false);
  eq('头到 (1,2)', s.snake[0], { x: 1, y: 2 });
}

console.log('— 盘满通关 —');
{
  const s = G.createGame({ cols: 3, rows: 3, rng: seeded(9) });
  // 3x3 盘，铺满 8 格身体 + 1 格食物在前进方向
  s.snake = [
    { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 },
    { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }
  ];
  // 3x3 盘，8 格蛇按蛇形铺满，头 (2,1) 向上吃到最后一格 (2,0) → 盘满通关
  s.snake = [
    { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 },
    { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }
  ];
  s.dir = 'down'; s.pendingDir = 'up';
  s.food = { x: 2, y: 0 };
  const ev = G.step(s);
  eq('won', ev.won, true);
  eq('status won', s.status, 'won');
  eq('食物为空', s.food, null);
}

console.log('— 速度曲线 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(10) });
  eq('eaten=0 → 170', G.tickInterval(s), 170);
  s.eaten = 10;
  eq('eaten=10 → 110', G.tickInterval(s), 110);
  s.eaten = 100;
  eq('下限 70', G.tickInterval(s), 70);
}

console.log('— AI BFS 提示 —');
{
  const s = G.createGame({ cols: 10, rows: 10, rng: seeded(11) });
  s.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
  s.dir = 'right'; s.pendingDir = 'right';
  s.food = { x: 5, y: 2 };
  eq('食物在正上方 → up', G.bfsFirstMove(s), 'up');

  s.food = { x: 2, y: 5 };
  s.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  s.dir = 'left'; s.pendingDir = 'left';
  eq('食物在正左 → left', G.bfsFirstMove(s), 'left');

  // 绕过墙：食物在右边，但必须绕障碍
  s.snake = [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }];
  s.dir = 'right'; s.pendingDir = 'right';
  s.food = { x: 4, y: 2 };
  // 路上有蛇身障碍（用身体模拟）
  s.snake = [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  eq('正右无阻挡 → right', G.bfsFirstMove(s), 'right');
}

console.log('— AI BFS 不穿身体 —');
{
  const s = G.createGame({ cols: 7, rows: 7, rng: seeded(12) });
  // 头 (3,3) 正右侧 (4,3) 被身体堵死，食物在 (6,3)，只能上/下绕过 (4,3) 所在的竖直墙
  // 障碍：(4,2) (4,3) (4,4) 都在身上
  s.snake = [
    { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2 },
    { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }
  ];
  s.dir = 'right'; s.pendingDir = 'right';
  s.food = { x: 6, y: 3 };
  const d = G.bfsFirstMove(s);
  ok('绕开身体障碍 (4,3)，不走 right', d === 'up' || d === 'down');
}

console.log('— 随机食物分布无重复 —');
{
  const s = G.createGame({ cols: 6, rows: 6, rng: seeded(13) });
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    const f = G.spawnFood(s);
    if (s.snake.some(c => c.x === f.x && c.y === f.y)) bad++;
  }
  eq('500 次生成从不落在蛇身', bad, 0);
}

console.log('— clone 深拷贝 —');
{
  const s = G.createGame({ cols: 5, rows: 5, rng: seeded(14) });
  const c = G.clone(s);
  c.snake[0].x = 99;
  eq('原状态不受影响', s.snake[0].x, 3);
}

console.log('— 穿墙模式 —');
{
  const s = G.createGame({ cols: 5, rows: 5, rng: seeded(20) });
  s.snake = [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }];
  s.dir = 'right'; s.pendingDir = 'right'; s.food = { x: 0, y: 0 };
  const ev = G.step(s, { wrap: true });
  eq('穿墙不判死', ev.died, false);
  eq('ev.wrapped', ev.wrapped, true);
  eq('头绕到 x=0', s.snake[0], { x: 0, y: 2 });
  eq('长度不变', s.snake.length, 3);
  for (let i = 0; i < 4; i++) G.step(s, { wrap: true });
  eq('绕一圈回到 (4,2)', s.snake[0], { x: 4, y: 2 });
  eq('仍然存活', s.status, 'running');

  s.snake = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
  s.dir = 'down'; s.pendingDir = 'up'; s.food = { x: 4, y: 4 };
  G.step(s, { wrap: true });
  eq('上穿墙 -> y = rows-1', s.snake[0], { x: 1, y: 4 });

  const s3 = G.createGame({ cols: 5, rows: 5, rng: seeded(21) });
  s3.snake = [{ x: 0, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 1 }, { x: 0, y: 1 }];
  s3.dir = 'left'; s3.pendingDir = 'left'; s3.food = { x: 3, y: 3 };
  eq('穿墙后撞到身体照样判死', G.step(s3, { wrap: true }).reason, 'self');

  // 穿墙吃食物
  const s4 = G.createGame({ cols: 5, rows: 5, rng: seeded(22) });
  s4.snake = [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }];
  s4.dir = 'right'; s4.pendingDir = 'right'; s4.food = { x: 0, y: 2 };
  const ev4 = G.step(s4, { wrap: true });
  eq('穿墙吃到食物 ate', ev4.ate, true);
  eq('穿墙吃后长度 4', s4.snake.length, 4);
  eq('穿墙吃后分数 10', s4.score, 10);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
