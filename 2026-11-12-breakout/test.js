/* 核心引擎自检：node test.js */
const B = require('./core.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

console.log('\n[1] 关卡生成');
for (let lv = 1; lv <= 12; lv++) {
  const L = B.buildLevel(lv);
  const n = L.bricks.length;
  ok(n > 0, 'L' + lv + ' 有砖块 (' + n + ' 块, ' + L.pattern + ')');
  const inBounds = L.bricks.every(b => b.x >= 0 && b.x + b.w <= B.LOGIC_W && b.y >= 0 && b.y + b.h < B.LOGIC_H / 2);
  ok(inBounds, 'L' + lv + ' 砖块都在场地上半部且不越界');
  ok(L.bricks.every(b => b.hp >= 1), 'L' + lv + ' 所有砖 hp>=1');
}
const L1 = B.buildLevel(1), L1b = B.buildLevel(1);
eq(JSON.stringify(L1.bricks.map(b => [b.x, b.y, b.hp])), JSON.stringify(L1b.bricks.map(b => [b.x, b.y, b.hp])), '同关卡生成结果确定（可复现）');

console.log('\n[2] 圆矩形碰撞');
ok(B.circleRect(50, 50, 5, 0, 0, 100, 100) !== null, '圆心在矩形内 → 命中');
ok(B.circleRect(103, 50, 5, 0, 0, 100, 100) !== null, '右边缘擦碰 → 命中');
ok(B.circleRect(110, 50, 5, 0, 0, 100, 100) === null, '远处 → 不命中');
const r1 = B.circleRect(103, 50, 5, 0, 0, 100, 100);
eq(r1.nx, 1, '右侧法线 nx=+1');
const r2 = B.circleRect(50, -3, 5, 0, 0, 100, 100);
eq(r2.ny, -1, '上方法线 ny=-1');
const r3 = B.circleRect(50, 50, 5, 0, 0, 100, 100);
ok(r3 !== null && Math.abs(r3.nx) + Math.abs(r3.ny) === 1, '圆心在内部 → 法线为轴向单位向量');

console.log('\n[3] 开局与发射');
const w = B.createWorld({ level: 1 });
eq(w.ball.stuck, true, '开局球吸附在挡板');
eq(w.status, 'ready', '开局状态 ready');
eq(w.lives, 3, '开局长 3 命');
ok(B.launch(w) === true, '发射成功');
eq(w.ball.stuck, false, '发射后球脱离');
eq(w.status, 'playing', '发射后状态 playing');
ok(w.ball.vy < 0, '发射方向朝上');
const angDeg = Math.abs(Math.atan2(w.ball.vx, -w.ball.vy)) * 180 / Math.PI;
ok(angDeg <= 31, '发射角度在 ±30° 内 (' + angDeg.toFixed(1) + '°)');

console.log('\n[4] 吸附跟随挡板');
const w2 = B.createWorld({ level: 1 });
B.movePaddle(w2, 300);
B.step(w2, 1 / 60);
ok(Math.abs(w2.ball.x - (w2.paddle.x + w2.paddle.w / 2)) < 1e-6, '未发射时球跟随挡板中心');

console.log('\n[5] 挡板边界夹紧');
B.movePaddle(w2, -500);
eq(w2.paddle.x, 0, '挡板左边界夹紧');
B.movePaddle(w2, 99999);
eq(w2.paddle.x + w2.paddle.w, B.LOGIC_W, '挡板右边界夹紧（不越界）');

console.log('\n[6] 高速不穿透（子步进验证）');
let penetrated = 0;
for (let trial = 0; trial < 200; trial++) {
  const ww = B.createWorld({ level: 1 });
  ww.bricks.forEach(b => { b.hp = 99; b.maxHp = 99; });
  B.launch(ww);
  // 强制高速度 + 近垂直穿过砖块区
  const sp = 3000;
  ww.ball.x = 300; ww.ball.y = 400;
  ww.ball.vx = 0; ww.ball.vy = -sp;
  ww.paddle.x = -1000; // 让挡板失效，避免干扰
  let hit = false;
  for (let i = 0; i < 40; i++) {
    B.step(ww, 1 / 60);
    if (ww.combo > 0) hit = true;
  }
  if (!hit) penetrated++;
}
ok(penetrated === 0, '200 次 3000px/s 垂直穿越均命中砖块（穿透 ' + penetrated + ' 次）');

console.log('\n[7] 得分与连击');
{
  const ww = B.createWorld({ level: 1 });
  B.launch(ww);
  // 放到某砖块正下方，向上打
  const b = ww.bricks[Math.floor(ww.bricks.length / 2)];
  ww.ball.x = b.x + b.w / 2;
  ww.ball.y = b.y + b.h + 40;
  ww.ball.vx = 0; ww.ball.vy = -400;
  ww.paddle.x = -2000;
  const before = ww.score;
  B.step(ww, 1 / 60);
  ok(ww.score > before, '击中砖块得分增加 (' + before + ' → ' + ww.score + ')');
  ok(ww.combo >= 1, '连击计数增加');
}

console.log('\n[8] 掉球扣命');
{
  const ww = B.createWorld({ level: 1 });
  B.launch(ww);
  ww.ball.y = B.LOGIC_H + 50;
  ww.ball.vx = 0; ww.ball.vy = 500;
  B.step(ww, 1 / 60);
  eq(ww.lives, 2, '掉球后 3 命 → 2 命');
  eq(ww.ball.stuck, true, '掉球后球重新吸附');
  eq(ww.status, 'ready', '掉球后状态回到 ready');
}
{
  const ww = B.createWorld({ level: 1, lives: 1 });
  B.launch(ww);
  ww.ball.y = B.LOGIC_H + 50; ww.ball.vy = 500;
  B.step(ww, 1 / 60);
  eq(ww.lives, 0, '最后一命掉落 → 0');
  eq(ww.status, 'gameover', '最后一命掉落 → gameover');
}

console.log('\n[9] 通关判定');
{
  const ww = B.createWorld({ level: 1 });
  B.launch(ww);
  ww.bricks.forEach(b => { b.alive = false; });
  const sc = ww.score;
  B.step(ww, 1 / 60);
  eq(ww.status, 'clear', '砖全清 → clear');
  ok(ww.score > sc, '通关有奖励分 (' + sc + ' → ' + ww.score + ')');
}

console.log('\n[10] 挡板反弹角度');
{
  // 打在挡板边缘 → 反弹角明显
  const ww = B.createWorld({ level: 1 });
  B.launch(ww);
  ww.ball.y = ww.paddle.y - ww.ball.r - 1;
  ww.ball.x = ww.paddle.x + ww.paddle.w - 4;
  ww.ball.vx = 0; ww.ball.vy = 300;
  B.step(ww, 1 / 60);
  ok(ww.ball.vy < 0, '击中挡板后向上反弹');
  ok(ww.ball.vx > 0, '打右半边 → 向右飞出');
}

console.log('\n[11] 角度保底（不会无限水平）');
{
  const ww = B.createWorld({ level: 1 });
  B.launch(ww);
  ww.ball.vx = 500; ww.ball.vy = -2;
  B.step(ww, 1 / 120);
  const ang = Math.abs(Math.atan2(ww.ball.vy, ww.ball.vx)) * 180 / Math.PI;
  ok(ang > 5, '近水平球被纠正 (角度 ' + ang.toFixed(1) + '°)');
}

console.log('\n[12] 长时间稳定性（模拟 3000 帧，球不出界）');
{
  const ww = B.createWorld({ level: 5 });
  B.launch(ww);
  let out = 0, nan = 0;
  ww.paddle.x = -2000; // 不接球，只测边界
  for (let i = 0; i < 3000; i++) {
    // 伪 AI：挡板跟着球
    ww.paddle.x = Math.max(0, Math.min(B.LOGIC_W - ww.paddle.w, ww.ball.x - ww.paddle.w / 2));
    B.step(ww, 1 / 60);
    if (!isFinite(ww.ball.x) || !isFinite(ww.ball.y)) { nan++; break; }
    if (ww.ball.x < -1 || ww.ball.x > B.LOGIC_W + 1) out++;
    if (ww.status === 'clear' || ww.status === 'gameover') break;
  }
  eq(nan, 0, '坐标始终有限（无 NaN）');
  eq(out, 0, '球 3000 帧内不越左右边界');
  ok(ww.score > 0, '3000 帧内至少得过分 (' + ww.score + ')');
}

console.log('\n[13] 存档');
{
  const mem = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } };
  const s0 = B.loadSave(mem);
  eq(s0.best, 0, '空存档 best=0');
  B.saveSave(mem, { best: 1234, maxLevel: 7 });
  const s1 = B.loadSave(mem);
  eq(s1.best, 1234, '存档 best 回读正确');
  eq(s1.maxLevel, 7, '存档 maxLevel 回读正确');
  mem._d[B.SAVE_KEY] = '{{{broken';
  const s2 = B.loadSave(mem);
  eq(s2.best, 0, '坏存档不崩溃，回落到默认值');
}

console.log('\n--------------------------------------------------');
console.log(fail === 0 ? `全部通过 ✅  ${pass} 项` : `失败 ${fail} 项 / 共 ${pass + fail} 项 ❌`);
process.exit(fail === 0 ? 0 : 1);
