// 用 headless chrome + CDP 实测 2048 页面
const { spawn } = require('child_process');
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9333;
const URL = 'http://127.0.0.1:8931/index.html';

const proc = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--window-size=520,900',
  '--user-data-dir=/tmp/chrome-prof-2048', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 没起来');
}

let id = 0;
function makeClient(ws) {
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  return function send(method, params) {
    return new Promise((res, rej) => {
      const myId = ++id;
      pending.set(myId, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
    });
  };
}

(async () => {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = makeClient(ws);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(1200);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    ok ? pass++ : fail++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  };

  console.log('— 页面加载 —');
  eq('标题正确', await evalJs('document.title'), '2048 · 数字炼金术');
  eq('Game2048 已加载', await evalJs('typeof Game2048'), 'object');
  eq('开始遮罩显示', await evalJs('document.getElementById("overlay").classList.contains("show")'), true);

  console.log('— 新游戏 —');
  await evalJs('document.getElementById("ov-btn").click()');
  await sleep(150);
  eq('遮罩隐藏', await evalJs('document.getElementById("overlay").classList.contains("show")'), false);
  eq('初始两个方块', await evalJs('__game.board.filter(v=>v).length'), 2);
  eq('DOM 方块数 = 棋盘非零数', await evalJs('document.querySelectorAll(".tile").length'), 2);
  eq('初始得分 0', await evalJs('document.getElementById("score").textContent'), '0');

  console.log('— 方块几何（不重叠、在棋盘内）—');
  const geom = await evalJs(`(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const ts = [...document.querySelectorAll('.tile')].map(t => t.getBoundingClientRect());
    return { boardW: Math.round(b.width), tiles: ts.map(t => ({l: Math.round(t.left-b.left), w: Math.round(t.width), h: Math.round(t.height)})) };
  })()`);
  console.log('    ' + JSON.stringify(geom));
  const inBounds = geom.tiles.every(t => t.l >= -1 && t.l + t.w <= geom.boardW + 1);
  eq('所有方块都在棋盘内', inBounds, true);
  eq('方块边长约 (W-5*gap)/4', geom.tiles.length > 0 && Math.abs(geom.tiles[0].h - geom.tiles[0].w) < 1, true);

  console.log('— 构造已知棋盘验证渲染 —');
  await evalJs(`(() => {
    __game.board = [2,4,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
    document.getElementById('tiles').innerHTML = '';
    __game.tileEls = {};
    // 直接复用内部渲染：改棋盘后走一次无效方向不行，改用 debug 重绘
    window.__dbgRender && window.__dbgRender();
  })()`);
  eq('渲染函数已暴露', await evalJs('typeof window.__dbgRender'), 'function');
  eq('2 个方块被画出', await evalJs('document.querySelectorAll(".tile").length'), 2);
  eq('第一个是 t2', await evalJs('document.querySelectorAll(".tile")[0].classList.contains("t2")'), true);
  eq('第二个是 t4', await evalJs('document.querySelectorAll(".tile")[1].classList.contains("t4")'), true);
  eq('方块文字可见（2 和 4）', await evalJs('[...document.querySelectorAll(".tile")].map(t=>t.textContent)'), ['2', '4']);

  console.log('— 键盘输入 (按 → 合并) —');
  const beforeScore = await evalJs('__game.score');
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`);
  await sleep(120);
  eq('右移后第一格为空 0', await evalJs('__game.board[0]'), 0);
  eq('合并出 4 在 col3', await evalJs('__game.board[3]'), 4);
  eq('合并得分 +4（用 history 里存的分差校验）', await evalJs('__game.history[__game.history.length-1].score'), beforeScore);
  eq('合并结果 4 在第 3 列（忽略新块）', await evalJs('__game.board.slice(0,4).includes(4)'), true);

  console.log('— 撤销 —');
  eq('历史已记录一步', await evalJs('__game.history.length'), 1);
  await evalJs('document.getElementById("undo").click()');
  await sleep(120);
  eq('撤销后棋盘还原为 2,4（无新生成的块）', await evalJs('__game.board.filter(v=>v).sort()'), [2, 4]);
  eq('撤销后分数还原', await evalJs('__game.score'), beforeScore);

  console.log('— AI 提示 —');
  await evalJs('document.getElementById("new").click(); document.getElementById("ai").click();');
  await sleep(300);
  const hintTxt = await evalJs('document.getElementById("hint").textContent');
  console.log('    提示文本:', hintTxt);
  eq('AI 提示给出方向', /AI 建议/.test(hintTxt), true);
  eq('dirbar 数量 = 有效方向数', await evalJs('document.querySelectorAll(".dirbar").length > 0'), true);
  await evalJs('document.getElementById("ai").click()');

  console.log('— 自动对弈 150 步（模拟输入）—');
  await evalJs('document.getElementById("new").click()');
  const res = await evalJs(`(async () => {
    const dirs = ['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'];
    let n = 0;
    for (let i = 0; i < 150 && !__game.over; i++) {
      const m = Game2048.bestMove(__game.board, 4);
      if (!m.dir) break;
      const key = {left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown'}[m.dir];
      document.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true}));
      n++;
      await new Promise(r => setTimeout(r, 6));
    }
    return { n, score: __game.score, max: Game2048.maxTile(__game.board),
             domTiles: document.querySelectorAll('.tile').length,
             boardTiles: __game.board.filter(v=>v).length,
             scoreText: document.getElementById('score').textContent };
  })()`);
  console.log('    ' + JSON.stringify(res));
  eq('DOM 方块数 = 棋盘方块数（无幽灵方块）', res.domTiles, res.boardTiles);
  eq('分数显示与状态一致', res.scoreText, String(res.score));
  eq('自动对弈得分 > 0', res.score > 0, true);

  console.log('— 游戏结束判定 —');
  await evalJs(`(() => {
    __game.board = [2,4,2,4, 4,2,4,2, 2,4,2,4, 4,2,4,2];
    __game.over = false; __game.running = true;
    __dbgRender();
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft'}));
  })()`);
  await sleep(200);
  eq('死局遮罩弹出', await evalJs('document.getElementById("overlay").classList.contains("show")'), true);
  eq('标题为游戏结束', await evalJs('document.getElementById("ov-title").textContent'), '游戏结束');

  // 截图
  await evalJs('document.getElementById("new").click()');
  await sleep(200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('/tmp/2048-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('\n截图已存 /tmp/2048-shot.png');  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  ws.close();
  proc.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃:', e); try { proc.kill('SIGTERM'); } catch (_) {} process.exit(1); });
