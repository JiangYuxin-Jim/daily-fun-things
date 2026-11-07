
/* arena-visual.js — 测试专用：在无浏览器环境下用 canvas 重绘一帧「视觉探针」。
 * 不是游戏本体的一部分，不参与运行时；只用来在 CI/无头机器上验证配色与布局坐标。 */
var ARENA = { run: function (window, document, console) {
const P = {"--bg": "#0b0e17", "--bg2": "#121829", "--panel": "rgba(255,255,255,.045)", "--line": "rgba(255,255,255,.09)", "--txt": "#e8ecf8", "--dim": "#8b95b5", "--gold": "#ffc861", "--cyan": "#5ee7ff", "--pink": "#ff6bd6", "--green": "#55e6a5", "--red": "#ff6b6b"};
const api = window.__memoryPrism;
const MC = window.MemoryCore;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPrism(ctx, W, H, state, opts) {
  opts = opts || {};
  let g = ctx.createRadialGradient(W * 0.18, -H * 0.1, 0, W * 0.18, -H * 0.1, W * 1.1);
  g.addColorStop(0, "#1c2a4d"); g.addColorStop(0.62, "#0b0e17"); g.addColorStop(1, P["--bg"]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.88, H * 1.08, 0, W * 0.88, H * 1.08, W * 0.75);
  g.addColorStop(0, "#2a1740"); g.addColorStop(0.6, "#0b0e17"); g.addColorStop(1, P["--bg"]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  g = ctx.createLinearGradient(cx - 150, 0, cx + 150, 0);
  g.addColorStop(0, P["--cyan"]); g.addColorStop(0.46, "#a78bfa"); g.addColorStop(1, P["--pink"]);
  ctx.fillStyle = g;
  ctx.font = '800 30px "Noto Sans CJK SC"';
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText("记 忆 棱 镜", cx, 52);
  ctx.fillStyle = P["--dim"];
  ctx.font = '12px "Noto Sans CJK SC"';
  ctx.fillText("MEMORY PRISM · 翻牌配对，但记住的是节奏", cx, 76);

  const hudY = 96, gap = 8, pad = 20;
  const bw = (W - pad * 2 - gap * 3) / 4, bh = 54;
  const stats = [
    ["得分", String(state.score), P["--gold"]],
    ["配对", state.pairsFound + "/" + state.totalPairs, P["--txt"]],
    ["连击", "×" + state.combo, P["--pink"]],
    ["翻牌", String(state.moves), P["--txt"]]
  ];
  stats.forEach(function (s, i) {
    const x = pad + i * (bw + gap);
    ctx.fillStyle = P["--panel"]; roundRect(ctx, x, hudY, bw, bh, 12); ctx.fill();
    ctx.strokeStyle = P["--line"]; ctx.lineWidth = 1; roundRect(ctx, x, hudY, bw, bh, 12); ctx.stroke();
    ctx.fillStyle = P["--dim"]; ctx.font = '11px "Noto Sans CJK SC"'; ctx.textAlign = "center";
    ctx.fillText(s[0], x + bw / 2, hudY + 19);
    ctx.fillStyle = s[2]; ctx.font = '800 20px "Noto Sans CJK SC"';
    ctx.fillText(s[1], x + bw / 2, hudY + 43);
  });

  const boardTop = hudY + bh + 22;
  const cols = state.cols, rows = state.rows, cellGap = 8;
  const cell = Math.floor((W - pad * 2 - cellGap * (cols - 1)) / cols);
  const boardW = cell * cols + cellGap * (cols - 1);
  const bx = (W - boardW) / 2;

  state.tiles.forEach(function (t, i) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = bx + c * (cell + cellGap), y = boardTop + r * (cell + cellGap);
    const up = t.matched || state.flipped.indexOf(t.id) >= 0 || opts.peek;
    if (up) {
      ctx.fillStyle = t.matched ? "rgba(85,230,165,.16)" : "#1c2540";
      roundRect(ctx, x, y, cell, cell, 14); ctx.fill();
      if (t.matched) {
        ctx.strokeStyle = "rgba(85,230,165,.55)"; ctx.lineWidth = 1.5;
        ctx.shadowColor = "rgba(85,230,165,.5)"; ctx.shadowBlur = 18;
        roundRect(ctx, x, y, cell, cell, 14); ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = "rgba(94,231,255,.22)"; ctx.lineWidth = 1;
        roundRect(ctx, x, y, cell, cell, 14); ctx.stroke();
      }
      ctx.font = Math.floor(cell * 0.5) + 'px "Noto Color Emoji"';
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";
      ctx.fillText(t.face, x + cell / 2, y + cell / 2 + 2);
      ctx.textBaseline = "alphabetic";
    } else {
      const gg = ctx.createLinearGradient(x, y, x + cell, y + cell);
      gg.addColorStop(0, "#1e2842"); gg.addColorStop(0.6, "#151d33"); gg.addColorStop(1, "#221a3a");
      ctx.fillStyle = gg; roundRect(ctx, x, y, cell, cell, 14); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.lineWidth = 1;
      roundRect(ctx, x, y, cell, cell, 14); ctx.stroke();
      const rg = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell * 0.22);
      rg.addColorStop(0, "rgba(94,231,255,.20)");
      rg.addColorStop(0.5, "rgba(167,139,250,.12)");
      rg.addColorStop(1, "rgba(255,107,214,0)");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(94,231,255,.14)"; ctx.lineWidth = 1;
      roundRect(ctx, x + cell * 0.07, y + cell * 0.07, cell * 0.86, cell * 0.86, 10); ctx.stroke();
    }
  });

  const btnY = boardTop + rows * (cell + cellGap) + 16;
  const btns = [["👁 揭晓 1", true], ["↺ 重开", false], ["🔊 音效", false]];
  let total = 0;
  const widths = btns.map(function (b) {
    ctx.font = '600 13px "Noto Sans CJK SC"';
    const w = ctx.measureText(b[0]).width + 30; total += w + 8; return w;
  });
  total -= 8;
  let x = (W - total) / 2;
  btns.forEach(function (b, i) {
    ctx.fillStyle = b[1] ? "rgba(70,120,255,.16)" : P["--panel"];
    roundRect(ctx, x, btnY, widths[i], 36, 10); ctx.fill();
    ctx.strokeStyle = b[1] ? "rgba(120,160,255,.4)" : P["--line"]; ctx.lineWidth = 1;
    roundRect(ctx, x, btnY, widths[i], 36, 10); ctx.stroke();
    ctx.fillStyle = P["--txt"]; ctx.font = '600 13px "Noto Sans CJK SC"';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b[0], x + widths[i] / 2, btnY + 19);
    ctx.textBaseline = "alphabetic";
    x += widths[i] + 8;
  });

  ctx.fillStyle = P["--gold"];
  ctx.font = '800 20px "Noto Sans CJK SC"'; ctx.textAlign = "center";
  ctx.shadowColor = "rgba(255,200,97,.65)"; ctx.shadowBlur = 14;
  ctx.fillText("×3 连击", W * 0.76, btnY - 16);
  ctx.shadowBlur = 0;
}

function runShots() {
  api.startGame("normal");
  let s = api.getState();
  const pairs = {};
  s.tiles.forEach(function (t) { (pairs[t.pairId] = pairs[t.pairId] || []).push(t.id); });
  const keys = Object.keys(pairs);
  for (let k = 0; k < 3; k++) {
    s = MC.flip(s, pairs[keys[k]][0]).state;
    s = MC.flip(s, pairs[keys[k]][1]).state;
  }
  s = MC.flip(s, pairs[keys[3]][0]).state;
  api.setState(s);
  s = api.getState();

  const W = 700, H = 860;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  drawPrism(ctx, W, H, s, {});
  const img = ctx.getImageData(0, 0, W, H).data;
  let nonBg = 0;
  for (let i = 0; i < img.length; i += 4) {
    // 背景色 #0b0e17 附近就算「空」；比它明显亮的一律计入
    if (img[i] > 24 || img[i + 1] > 30 || img[i + 2] > 50) nonBg++;
  }
  const ratio = nonBg / (W * H);
  if (ratio < 0.05) throw new Error("画布几乎是空的，渲染未生效 ratio=" + ratio);
  if (ratio > 0.9) throw new Error("画布几乎全亮，疑似坐标错误 ratio=" + ratio);
  console.log("render ok: nonBgRatio=" + ratio.toFixed(3) + " tiles=" + s.tiles.length +
              " score=" + s.score + " combo=" + s.combo + " pairs=" + s.pairsFound);
  window.__shot = c.toDataURL("image/png");
  return "done";
}

return runShots();
}};
