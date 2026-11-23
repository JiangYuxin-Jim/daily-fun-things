/* studio.js — 像素工坊的界面层（只用 pixcore 的纯算法，DOM 只在这里出现） */
(function () {
  'use strict';
  var P = window.PixCore;

  // ---------- 状态 ----------
  var state = {
    size: 16,
    grid: P.makeGrid(16, 16),
    color: [255, 204, 77, 255],
    tool: 'pen',
    mirror: false,
    shade: false,
    zoom: 1,
    undo: [],
    redo: [],
    stroke: null   // 拖拽中的临时笔迹
  };

  var PALETTE = [
    '#000000', '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
    '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57', '#ffffff'
  ];

  var $ = function (id) { return document.getElementById(id); };
  var grid = $('grid'), ctx = grid.getContext('2d');
  var preview = $('preview'), pv = preview.getContext('2d');
  var pvBuf = document.createElement('canvas');

  // ---------- 颜色 ----------
  function hexToRgba(hex) {
    var v = hex.replace('#', '');
    if (v.length === 3) v = v.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
  }
  function rgbaToHex(c) {
    return '#' + [c[0], c[1], c[2]].map(function (n) {
      return ('0' + n.toString(16)).slice(-2);
    }).join('');
  }

  // ---------- 渲染 ----------
  function cellSize() {
    var base = Math.floor(Math.min(560, Math.max(280, window.innerWidth - 380)) / state.size);
    return Math.max(6, base) * state.zoom;
  }

  function layout() {
    var cs = cellSize();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    grid.width = state.size * cs * dpr;
    grid.height = state.size * cs * dpr;
    grid.style.width = (state.size * cs) + 'px';
    grid.style.height = (state.size * cs) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid._cs = cs;
    draw();
  }

  function gridCanvasFor(g, cs) {
    var c = document.createElement('canvas');
    c.width = g.w; c.height = g.h;
    var cx = c.getContext('2d');
    var img = cx.createImageData(g.w, g.h);
    img.data.set(g.data);
    cx.putImageData(img, 0, 0);
    return c;
  }

  function draw() {
    var cs = grid._cs, n = state.size;
    ctx.clearRect(0, 0, n * cs, n * cs);
    var tmp = gridCanvasFor(state.grid, cs);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, n * cs, n * cs);

    // 预览笔迹（直线/方框拖拽时）
    if (state.stroke) {
      ctx.fillStyle = rgbaToHex(state.color);
      state.stroke.forEach(function (p) {
        ctx.fillRect(p[0] * cs, p[1] * cs, cs, cs);
      });
    }

    // 网格线：格子够大才画，避免噪点
    if (cs >= 12) {
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 1; i < n; i++) {
        ctx.moveTo(i * cs + .5, 0); ctx.lineTo(i * cs + .5, n * cs);
        ctx.moveTo(0, i * cs + .5); ctx.lineTo(n * cs, i * cs + .5);
      }
      ctx.stroke();
    }
    updatePreview();
  }

  // ---------- 蹦跳预览（小惊喜） ----------
  var pvT = 0, pvRunning = true;
  function updatePreview() {
    if (pvBuf.width !== state.size) {
      pvBuf.width = state.size; pvBuf.height = state.size;
    }
    var bx = pvBuf.getContext('2d');
    bx.clearRect(0, 0, state.size, state.size);
    bx.putImageData(new ImageData(new Uint8ClampedArray(state.grid.data), state.size, state.size), 0, 0);
  }
  function tick() {
    if (pvRunning) pvT += 0.045;
    var bounce = Math.abs(Math.sin(pvT)) * 6;         // 上下弹
    var squash = 1 + Math.sin(pvT * 2) * 0.04;        // 呼吸缩放
    var empty = P.isEmpty(state.grid);

    pv.clearRect(0, 0, 88, 88);
    // 地面阴影
    if (!empty) {
      var sh = 1 - bounce / 10;
      pv.fillStyle = 'rgba(0,0,0,' + (0.28 * sh).toFixed(3) + ')';
      pv.beginPath();
      pv.ellipse(44, 78, 20 * sh, 4 * sh, 0, 0, Math.PI * 2);
      pv.fill();
    }
    if (!empty) {
      pv.imageSmoothingEnabled = false;
      var s = 64 * squash;
      pv.drawImage(pvBuf, 44 - s / 2, 74 - s - bounce, s, s / squash);
    } else {
      pv.fillStyle = '#333c57';
      pv.font = '11px system-ui';
      pv.textAlign = 'center';
      pv.fillText('空的 :)', 44, 48);
    }
    requestAnimationFrame(tick);
  }

  // ---------- 历史 ----------
  function snapshot() {
    state.undo.push({ w: state.grid.w, h: state.grid.h, data: new Uint8ClampedArray(state.grid.data) });
    if (state.undo.length > 60) state.undo.shift();
    state.redo.length = 0;
    syncHistoryBtns();
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push({ w: state.grid.w, h: state.grid.h, data: new Uint8ClampedArray(state.grid.data) });
    var g = state.undo.pop();
    if (g.w !== state.size) { state.size = g.w; layout(); }
    state.grid = { w: g.w, h: g.h, data: g.data };
    draw(); syncHistoryBtns();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push({ w: state.grid.w, h: state.grid.h, data: new Uint8ClampedArray(state.grid.data) });
    var g = state.redo.pop();
    if (g.w !== state.size) { state.size = g.w; layout(); }
    state.grid = { w: g.w, h: g.h, data: g.data };
    draw(); syncHistoryBtns();
  }
  function syncHistoryBtns() {
    $('undo').disabled = !state.undo.length;
    $('redo').disabled = !state.redo.length;
  }

  // ---------- 坐标 ----------
  function toCell(ev) {
    var r = grid.getBoundingClientRect();
    var cs = grid._cs;
    var x = Math.floor((ev.clientX - r.left) / cs);
    var y = Math.floor((ev.clientY - r.top) / cs);
    if (x < 0 || y < 0 || x >= state.size || y >= state.size) return null;
    return [x, y];
  }

  // ---------- 绘制动作 ----------
  function paint(g, x, y, rgba) {
    P.putPixel(g, x, y, rgba);
    if (state.mirror) P.putPixel(g, g.w - 1 - x, y, rgba);
  }

  function applyBrush(x, y) {
    var rgba = state.tool === 'eraser' ? [0, 0, 0, 0] : state.color;
    paint(state.grid, x, y, rgba);
    // 抖动阴影：右下补一个暗色像素，做出体积感
    if (state.shade && state.tool !== 'eraser') {
      var dark = [rgba[0] * 0.62 | 0, rgba[1] * 0.62 | 0, rgba[2] * 0.62 | 0, rgba[3]];
      if (P.inBounds(state.grid, x + 1, y + 1) && P.getPixel(state.grid, x + 1, y + 1)[3] === 0) {
        paint(state.grid, x + 1, y + 1, dark);
      }
    }
  }

  function strokePoints(x0, y0, x1, y1) {
    if (state.tool === 'line') return P.linePoints(x0, y0, x1, y1);
    if (state.tool === 'rect') return P.rectPoints(x0, y0, x1, y1);
    return null;
  }

  // ---------- 事件 ----------
  var dragging = false, last = null, start = null;

  grid.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    grid.setPointerCapture(ev.pointerId);
    var c = toCell(ev);
    if (!c) return;
    var x = c[0], y = c[1];

    if (ev.button === 2) {              // 右键即橡皮
      var prev = state.tool;
      state.tool = 'eraser';
      snapshot(); applyBrush(x, y); last = [x, y]; dragging = true;
      state.tool = prev; draw();
      return;
    }

    if (state.tool === 'picker') {
      var px = P.getPixel(state.grid, x, y);
      if (px[3] > 0) { state.color = px; $('pick').value = rgbaToHex(px); }
      return;
    }
    if (state.tool === 'fill') {
      snapshot();
      P.floodFill(state.grid, x, y, state.color);
      draw();
      return;
    }
    snapshot();
    start = [x, y]; last = [x, y]; dragging = true;
    if (state.tool === 'pen' || state.tool === 'eraser') { applyBrush(x, y); draw(); }
    else { state.stroke = strokePoints(x, y, x, y); draw(); }
  });

  grid.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    var c = toCell(ev);
    if (!c) return;
    var x = c[0], y = c[1];
    if (last && last[0] === x && last[1] === y) return;

    if (state.tool === 'pen' || state.tool === 'eraser') {
      if (last) {
        // 补上快速划过的中间点，避免断线
        P.linePoints(last[0], last[1], x, y).forEach(function (p) {
          applyBrush(p[0], p[1]);
        });
      } else applyBrush(x, y);
      last = [x, y];
      draw();
    } else {
      last = [x, y];
      state.stroke = strokePoints(start[0], start[1], x, y);
      draw();
    }
  });

  function endStroke() {
    if (!dragging) return;
    dragging = false;
    if (state.stroke) {
      var rgba = state.color;
      state.stroke.forEach(function (p) { paint(state.grid, p[0], p[1], rgba); });
      state.stroke = null;
    }
    last = null; start = null;
    draw();
  }
  grid.addEventListener('pointerup', endStroke);
  grid.addEventListener('pointercancel', endStroke);
  grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- 工具切换 ----------
  var TOOL_KEY = { b: 'pen', e: 'eraser', g: 'fill', l: 'line', r: 'rect', i: 'picker' };
  function setTool(t) {
    state.tool = t;
    Array.prototype.forEach.call($('tools').children, function (b) {
      b.classList.toggle('on', b.dataset.tool === t);
    });
  }
  $('tools').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (b) setTool(b.dataset.tool);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT') return;
    var k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && k === 'z') {
      ev.preventDefault();
      ev.shiftKey ? redo() : undo();
      return;
    }
    if (k === ' ') { ev.preventDefault(); pvRunning = !pvRunning; return; }
    if (TOOL_KEY[k]) { ev.preventDefault(); setTool(TOOL_KEY[k]); }
  });

  // ---------- 调色板 ----------
  function buildPalette() {
    var box = $('pal');
    box.innerHTML = '';
    PALETTE.forEach(function (hex) {
      var d = document.createElement('div');
      d.className = 'sw';
      d.style.background = hex;
      d.title = hex;
      d.dataset.hex = hex;
      d.addEventListener('click', function () { selectHex(hex); });
      box.appendChild(d);
    });
    markSwatch();
  }
  function markSwatch() {
    var cur = rgbaToHex(state.color).toLowerCase();
    Array.prototype.forEach.call($('pal').children, function (d) {
      d.classList.toggle('on', d.dataset.hex.toLowerCase() === cur);
    });
  }
  function selectHex(hex) {
    state.color = hexToRgba(hex);
    $('pick').value = hex;
    markSwatch();
  }
  $('pick').addEventListener('input', function () {
    state.color = hexToRgba(this.value);
    markSwatch();
  });
  $('addSw').addEventListener('click', function () {
    var hex = $('pick').value;
    if (PALETTE.indexOf(hex) === -1) {
      PALETTE.push(hex); buildPalette();
      toast('已存进调色板');
    } else toast('这个颜色已经有了');
  });
  $('mirror').addEventListener('change', function () { state.mirror = this.checked; });
  $('shade').addEventListener('change', function () { state.shade = this.checked; });

  // ---------- 尺寸 ----------
  var SIZES = [8, 16, 24, 32, 48, 64];
  function changeSize(dir) {
    var i = SIZES.indexOf(state.size);
    if (i < 0) i = 1;
    var ni = Math.min(SIZES.length - 1, Math.max(0, i + dir));
    if (ni === i) return;
    var n = SIZES[ni];
    snapshot();
    state.grid = P.resizeGrid(state.grid, n, n);
    state.size = n;
    $('szTxt').textContent = n + ' × ' + n;
    layout();
  }
  $('sz+').addEventListener('click', function () { changeSize(1); });
  $('sz-').addEventListener('click', function () { changeSize(-1); });

  // ---------- 撤销/重做/清空 ----------
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('clear').addEventListener('click', function () {
    if (P.isEmpty(state.grid)) return;
    snapshot();
    state.grid = P.makeGrid(state.size, state.size);
    draw(); toast('已清空（可撤销）');
  });

  // ---------- 导出 ----------
  $('export').addEventListener('click', function () {
    if (P.isEmpty(state.grid)) { toast('画点什么再导出吧'); return; }
    var big = P.scaleNearest(state.grid, 8);
    var c = document.createElement('canvas');
    c.width = big.w; c.height = big.h;
    var cx = c.getContext('2d');
    cx.putImageData(new ImageData(big.data, big.w, big.h), 0, 0);
    c.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pixel-art-' + state.size + 'x' + state.size + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('已导出 PNG');
    }, 'image/png');
  });

  $('savejson').addEventListener('click', function () {
    var obj = { v: 1, w: state.size, h: state.size, data: P.encode(state.grid) };
    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pixel-' + state.size + 'x' + state.size + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('已保存工程文件');
  });
  $('loadjson').addEventListener('click', function () {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(fr.result);
          if (!o.w || !o.h || !o.data) throw new Error('bad');
          var g = P.decode(o.w, o.h, o.data);
          if (g.data.length !== o.w * o.h * 4) throw new Error('bad');
          snapshot();
          state.grid = g; state.size = o.w;
          if (SIZES.indexOf(o.w) === -1) SIZES.push(o.w), SIZES.sort(function (a, b) { return a - b; });
          $('szTxt').textContent = o.w + ' × ' + o.h;
          layout(); toast('已载入工程');
        } catch (e) { toast('文件格式不对'); }
      };
      fr.readAsText(f);
    });
    inp.click();
  });

  // ---------- 滚轮缩放 ----------
  grid.addEventListener('wheel', function (ev) {
    if (!ev.ctrlKey && !ev.metaKey) return;   // 只在按住 Ctrl 时缩放，避免误触
    ev.preventDefault();
    state.zoom = Math.min(2.5, Math.max(0.5, state.zoom + (ev.deltaY < 0 ? 0.15 : -0.15)));
    layout();
  }, { passive: false });

  // ---------- 提示条 ----------
  var toastEl = $('toast'), toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1400);
  }

  // ---------- 启动 ----------
  window.addEventListener('resize', layout);
  buildPalette();
  selectHex('#ffcc4d');
  layout();
  syncHistoryBtns();
  requestAnimationFrame(tick);
})();
