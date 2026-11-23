/* pixcore.js — 纯算法层，零 DOM 依赖，可在 Node 里直接自测。
 * 数据模型：像素图 = { w, h, data: Uint8ClampedArray(w*h*4) }，RGBA 0-255，a=0 表示透明。
 */
(function (root) {
  'use strict';

  function makeGrid(w, h) {
    return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  function cloneGrid(g) {
    return { w: g.w, h: g.h, data: new Uint8ClampedArray(g.data) };
  }

  function idx(g, x, y) { return (y * g.w + x) * 4; }

  function sameColor(d, a, r, g2, b, al) {
    return d[a] === r && d[a + 1] === g2 && d[a + 2] === b && d[a + 3] === al;
  }

  function inBounds(g, x, y) { return x >= 0 && y >= 0 && x < g.w && y < g.h; }

  function putPixel(g, x, y, rgba) {
    if (!inBounds(g, x, y)) return false;
    var i = idx(g, x, y);
    g.data[i] = rgba[0]; g.data[i + 1] = rgba[1];
    g.data[i + 2] = rgba[2]; g.data[i + 3] = rgba[3];
    return true;
  }

  function getPixel(g, x, y) {
    if (!inBounds(g, x, y)) return [0, 0, 0, 0];
    var i = idx(g, x, y);
    return [g.data[i], g.data[i + 1], g.data[i + 2], g.data[i + 3]];
  }

  /* Bresenham：返回整条线上的所有整数格点 */
  function linePoints(x0, y0, x1, y1) {
    var pts = [];
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    for (;;) {
      pts.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  }

  /* 方框轮廓（含边界），用于 rect 工具 */
  function rectPoints(x0, y0, x1, y1) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    var pts = [];
    for (var x = ax; x <= bx; x++) { pts.push([x, ay]); if (by !== ay) pts.push([x, by]); }
    for (var y = ay + 1; y < by; y++) { pts.push([ax, y]); if (bx !== ax) pts.push([bx, y]); }
    return pts;
  }

  /* 扫描线洪水填充：从 (sx,sy) 出发替换连通且同色的区域。
   * 返回被修改的像素数量。 */
  function floodFill(g, sx, sy, rgba) {
    if (!inBounds(g, sx, sy)) return 0;
    var i0 = idx(g, sx, sy);
    var tr = g.data[i0], tg = g.data[i0 + 1], tb = g.data[i0 + 2], ta = g.data[i0 + 3];
    if (tr === rgba[0] && tg === rgba[1] && tb === rgba[2] && ta === rgba[3]) return 0;

    var w = g.w, h = g.h, d = g.data;
    var stack = [sx, sy];
    var seen = new Uint8Array(w * h);
    var count = 0;
    while (stack.length) {
      var y = stack.pop(), x = stack.pop();
      if (seen[y * w + x]) continue;
      var i = (y * w + x) * 4;
      if (!sameColor(d, i, tr, tg, tb, ta)) continue;
      seen[y * w + x] = 1;
      d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3];
      count++;
      if (x > 0) stack.push(x - 1, y);
      if (x < w - 1) stack.push(x + 1, y);
      if (y > 0) stack.push(x, y - 1);
      if (y < h - 1) stack.push(x, y + 1);
    }
    return count;
  }

  /* 最近邻放大：导出用。返回新的 RGBA Uint8ClampedArray + 尺寸 */
  function scaleNearest(g, k) {
    var W = g.w * k, H = g.h * k;
    var out = new Uint8ClampedArray(W * H * 4);
    for (var y = 0; y < H; y++) {
      var sy = (y / k) | 0;
      for (var x = 0; x < W; x++) {
        var sx = (x / k) | 0;
        var si = (sy * g.w + sx) * 4, di = (y * W + x) * 4;
        out[di] = g.data[si]; out[di + 1] = g.data[si + 1];
        out[di + 2] = g.data[si + 2]; out[di + 3] = g.data[si + 3];
      }
    }
    return { w: W, h: H, data: out };
  }

  /* 缩放（换画布尺寸），最近邻采样 */
  function resizeGrid(g, nw, nh) {
    var out = makeGrid(nw, nh);
    for (var y = 0; y < nh; y++) {
      var sy = Math.min(g.h - 1, ((y + 0.5) * g.h / nh) | 0);
      for (var x = 0; x < nw; x++) {
        var sx = Math.min(g.w - 1, ((x + 0.5) * g.w / nw) | 0);
        var si = (sy * g.w + sx) * 4, di = (y * nw + x) * 4;
        out.data[di] = g.data[si]; out.data[di + 1] = g.data[si + 1];
        out.data[di + 2] = g.data[si + 2]; out.data[di + 3] = g.data[si + 3];
      }
    }
    return out;
  }

  /* 把网格转成 base64（用于 json 存档，体积小且无依赖） */
  function encode(g) {
    var bytes = g.data, s = '';
    for (var i = 0; i < bytes.length; i += 4096) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(bytes).toString('base64');
  }

  function decode(w, h, b64) {
    var bin;
    if (typeof atob === 'function') {
      bin = atob(b64);
      var arr = new Uint8ClampedArray(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return { w: w, h: h, data: arr };
    }
    var buf = Buffer.from(b64, 'base64');
    return { w: w, h: h, data: new Uint8ClampedArray(buf) };
  }

  /* 判断像素图是否全空 */
  function isEmpty(g) {
    for (var i = 3; i < g.data.length; i += 4) if (g.data[i] !== 0) return false;
    return true;
  }

  var api = {
    makeGrid: makeGrid, cloneGrid: cloneGrid, getPixel: getPixel, putPixel: putPixel,
    linePoints: linePoints, rectPoints: rectPoints, floodFill: floodFill,
    scaleNearest: scaleNearest, resizeGrid: resizeGrid, encode: encode, decode: decode,
    isEmpty: isEmpty, inBounds: inBounds, idx: idx
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PixCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
