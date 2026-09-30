// 等角（菱形）地圖渲染：地形貼圖、勢力覆蓋、城池、行軍路線、小地圖
'use strict';

var Render = (function () {
  let cv, ctx, W = 0, H = 0, DPR = 1;
  let N = 0;
  const cam = { cx: 150, cy: 150, tw: 48 };
  let terrainCv = null, overlayCv = null, overlayCtx = null, overlayImg = null;
  let miniCv = null, miniCtx = null, miniBase = null;
  let hover = -1, selected = -1;
  let mode = 'relation'; // relation | alliance
  let showAIMarch = true;
  const fx = [];
  const TEX = 4; // 地形貼圖每格像素

  const REL_COLOR = {
    self: [60, 190, 80], ally: [60, 125, 220], enemy: [215, 60, 50], free: [220, 180, 60], npcCity: [150, 150, 150],
  };

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }

  function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // ============ 地形貼圖 ============
  function buildTerrain() {
    N = World.N;
    const T = World.T;
    terrainCv = document.createElement('canvas');
    terrainCv.width = N * TEX; terrainCv.height = N * TEX;
    const tctx = terrainCv.getContext('2d');
    const img = tctx.createImageData(N * TEX, N * TEX);
    const d = img.data;
    const RES_TINT = [[118, 142, 86], [128, 128, 124], [170, 150, 118], [204, 180, 104]];
    const nz = U.makeNoise(World.seed + 99);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const tr = T.terrain[i];
        let base;
        if (tr === TERRAIN.MOUNTAIN) base = [112, 100, 80];
        else if (tr === TERRAIN.WATER) base = [92, 128, 134];
        else if (tr === TERRAIN.CITY) base = [158, 140, 108];
        else {
          const tint = RES_TINT[T.res[i]];
          const lv = T.lvl[i];
          const k = 0.42;
          const dark = 1 - lv * 0.03;
          base = [(205 * (1 - k) + tint[0] * k) * dark, (190 * (1 - k) + tint[1] * k) * dark, (148 * (1 - k) + tint[2] * k) * dark];
        }
        const big = nz(x * 0.05, y * 0.05, 3) - 0.5;
        for (let py = 0; py < TEX; py++) {
          for (let px = 0; px < TEX; px++) {
            const o = ((y * TEX + py) * N * TEX + (x * TEX + px)) * 4;
            let v = (hash(x * TEX + px, y * TEX + py) - 0.5) * 14 + big * 22;
            if (tr === TERRAIN.MOUNTAIN) v += (hash(x, y) - 0.5) * 20 + (py < 2 ? 10 : -6);
            if (tr === TERRAIN.WATER && ((px + py + x) % 4 === 0)) v += 14;
            if (tr !== TERRAIN.MOUNTAIN && tr !== TERRAIN.WATER && (px === 0 || py === 0)) v -= 9; // 格線
            d[o] = base[0] + v; d[o + 1] = base[1] + v; d[o + 2] = base[2] + v * 0.9; d[o + 3] = 255;
          }
        }
      }
    }
    tctx.putImageData(img, 0, 0);
    overlayCv = document.createElement('canvas');
    overlayCv.width = N; overlayCv.height = N;
    overlayCtx = overlayCv.getContext('2d');
    overlayImg = overlayCtx.createImageData(N, N);
    // 小地圖底圖
    miniBase = document.createElement('canvas');
    miniBase.width = N; miniBase.height = N;
    const mctx = miniBase.getContext('2d');
    const mimg = mctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const tr = T.terrain[i];
      const c = tr === TERRAIN.MOUNTAIN ? [95, 84, 66] : tr === TERRAIN.WATER ? [80, 115, 122] : tr === TERRAIN.CITY ? [140, 120, 90] : [176 - T.lvl[i] * 5, 160 - T.lvl[i] * 5, 118 - T.lvl[i] * 4];
      mimg.data[i * 4] = c[0]; mimg.data[i * 4 + 1] = c[1]; mimg.data[i * 4 + 2] = c[2]; mimg.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(mimg, 0, 0);
    fullOverlay();
  }

  // ============ 勢力覆蓋 ============
  function relColor(i) {
    const g = Game.G;
    const u = Game.P[g.userId];
    const T = Game.T;
    const c = T.city[i];
    let owner = -1, alli = -1;
    if (c >= 0) {
      const city = World.cities[c];
      if (World.isPlayerCity(city)) { owner = city.owner; alli = owner >= 0 ? Game.P[owner].alliance : -1; }
      else { alli = city.alliance; if (alli < 0) return null; }
    } else {
      owner = T.owner[i];
      if (owner < 0) return null;
      alli = Game.P[owner].alliance;
    }
    if (mode === 'alliance') {
      if (owner === u.id) return REL_COLOR.self;
      if (alli >= 0) { let c = alliColCache[alli]; if (!c) c = alliColCache[alli] = hexRgb(g.alliances[alli].color); return c; }
      return NEUTRAL;
    }
    if (owner === u.id) return REL_COLOR.self;
    if (alli >= 0 && alli === u.alliance) return REL_COLOR.ally;
    if (alli < 0) return REL_COLOR.free;
    return REL_COLOR.enemy;
  }
  const alliColCache = {};
  const NEUTRAL = [200, 200, 200];
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function paintTile(i) {
    const c = relColor(i);
    const o = i * 4;
    const d = overlayImg.data;
    if (!c) { d[o + 3] = 0; return; }
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 120;
  }
  function fullOverlay() {
    for (let i = 0; i < N * N; i++) paintTile(i);
    overlayCtx.putImageData(overlayImg, 0, 0);
    Game.G.dirty.length = 0;
  }
  let lastOverlay = 0;
  function updateOverlay(now) {
    if (Game.G.overlayAll) { Game.G.overlayAll = false; fullOverlay(); return; }
    const dirty = Game.G.dirty;
    if (!dirty.length || now - lastOverlay < 120) return;
    lastOverlay = now;
    if (dirty.length > 4000) { fullOverlay(); return; }
    for (const i of dirty) paintTile(i);
    dirty.length = 0;
    overlayCtx.putImageData(overlayImg, 0, 0);
  }
  function setMode(m) { mode = m; fullOverlay(); }

  // ============ 座標 ============
  function origin() {
    const hw = cam.tw / 2, hh = cam.tw / 4;
    return [W / 2 + (-cam.cx + cam.cy) * hw, H / 2 + (-cam.cx - cam.cy) * hh];
  }
  function toScreen(gx, gy) {
    const hw = cam.tw / 2, hh = cam.tw / 4;
    return [W / 2 + ((gx - cam.cx) - (gy - cam.cy)) * hw, H / 2 + ((gx - cam.cx) + (gy - cam.cy)) * hh];
  }
  function toGrid(sx, sy) {
    const a = (sx - W / 2) / (cam.tw / 2), b = (sy - H / 2) / (cam.tw / 4);
    return [cam.cx + (a + b) / 2, cam.cy + (b - a) / 2];
  }
  function tileAt(sx, sy) {
    const [gx, gy] = toGrid(sx, sy);
    const x = Math.floor(gx), y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= N || y >= N) return -1;
    return y * N + x;
  }
  function centerOn(i, tw) {
    cam.cx = World.X(i) + 0.5; cam.cy = World.Y(i) + 0.5;
    if (tw) cam.tw = tw;
  }
  function pan(dx, dy) {
    const a = -dx / (cam.tw / 2), b = -dy / (cam.tw / 4);
    cam.cx += (a + b) / 2; cam.cy += (b - a) / 2;
    clampCam();
  }
  function zoomAt(sx, sy, f) {
    const [gx, gy] = toGrid(sx, sy);
    cam.tw = U.clamp(cam.tw * f, 5, 150);
    const [gx2, gy2] = toGrid(sx, sy);
    cam.cx += gx - gx2; cam.cy += gy - gy2;
    clampCam();
  }
  function clampCam() { cam.cx = U.clamp(cam.cx, 0, N); cam.cy = U.clamp(cam.cy, 0, N); }
  function visibleRange() {
    const pts = [toGrid(0, 0), toGrid(W, 0), toGrid(0, H), toGrid(W, H)];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return [Math.max(0, Math.floor(x0) - 2), Math.min(N - 1, Math.ceil(x1) + 2), Math.max(0, Math.floor(y0) - 2), Math.min(N - 1, Math.ceil(y1) + 3)];
  }
  function onScreen(sx, sy, m) { return sx > -m && sy > -m && sx < W + m && sy < H + m; }

  // ============ 繪製 ============
  function diamond(c, sx, sy, hw, hh) {
    c.beginPath();
    c.moveTo(sx, sy - hh); c.lineTo(sx + hw, sy); c.lineTo(sx, sy + hh); c.lineTo(sx - hw, sy); c.closePath();
  }

  function draw(now) {
    if (!terrainCv) return;
    updateOverlay(now);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 背景
    const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H));
    bg.addColorStop(0, '#2b241a'); bg.addColorStop(1, '#120e09');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const [ox, oy] = origin();
    const hw = cam.tw / 2, hh = cam.tw / 4;
    // 地形
    ctx.save();
    ctx.setTransform(DPR * hw / TEX, DPR * hh / TEX, -DPR * hw / TEX, DPR * hh / TEX, DPR * ox, DPR * oy);
    ctx.imageSmoothingEnabled = cam.tw < 30;
    ctx.drawImage(terrainCv, 0, 0);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const [x0, x1, y0, y1] = visibleRange();
    const T = Game.T;
    const tw = cam.tw;
    // 近景細節（貼圖之上、勢力之下）
    if (tw >= 16) drawDetails(x0, x1, y0, y1, hw, hh, tw);
    // 勢力覆蓋
    ctx.save();
    ctx.setTransform(DPR * hw, DPR * hh, -DPR * hw, DPR * hh, DPR * ox, DPR * oy);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = tw < 12 ? 0.95 : 0.8;
    ctx.drawImage(overlayCv, 0, 0);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (tw >= 30) drawBorders(x0, x1, y0, y1, hw, hh);
    drawAllianceTarget(hw, hh);
    drawCities(hw, hh, tw);
    if (tw < 22) drawStateNames();
    drawMarches(now, hw, hh);
    drawFx(now, hw, hh);
    // 懸停/選取
    if (hover >= 0 && tw >= 10) {
      const [sx, sy] = toScreen(World.X(hover) + 0.5, World.Y(hover) + 0.5);
      diamond(ctx, sx, sy, hw, hh);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (selected >= 0) {
      const c = T.city[selected];
      let sx, sy, s = 1;
      if (c >= 0) { const city = World.cities[c]; [sx, sy] = toScreen(city.cx + 0.5, city.cy + 0.5); s = city.size; }
      else[sx, sy] = toScreen(World.X(selected) + 0.5, World.Y(selected) + 0.5);
      const pulse = 1 + Math.sin(now / 200) * 0.06;
      diamond(ctx, sx, sy, hw * s * pulse, hh * s * pulse);
      ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    drawMini();
  }

  function drawDetails(x0, x1, y0, y1, hw, hh, tw) {
    const T = Game.T;
    const fine = tw >= 38;
    const showLv = tw >= 52;
    // 格線
    if (fine) {
      ctx.strokeStyle = 'rgba(50,35,20,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) { const [ax, ay] = toScreen(x, y0); const [bx, by] = toScreen(x, y1 + 1); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      for (let y = y0; y <= y1 + 1; y++) { const [ax, ay] = toScreen(x0, y); const [bx, by] = toScreen(x1 + 1, y); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fontLv = Math.round(tw * 0.2) + 'px "Noto Serif TC", serif';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        const tr = T.terrain[i];
        const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        if (!onScreen(sx, sy, tw)) continue;
        const h = hash(x, y);
        if (tr === TERRAIN.MOUNTAIN) {
          drawPeak(sx, sy + hh * 0.35, tw * (0.42 + h * 0.2), h);
        } else if (tr === TERRAIN.WATER) {
          if (fine) {
            ctx.strokeStyle = 'rgba(210,235,240,0.45)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(sx - hw * 0.4, sy); ctx.quadraticCurveTo(sx - hw * 0.2, sy - hh * 0.25, sx, sy); ctx.quadraticCurveTo(sx + hw * 0.2, sy + hh * 0.25, sx + hw * 0.4, sy); ctx.stroke();
          }
        } else if (tr === TERRAIN.PLAIN && fine) {
          const r = T.res[i];
          const lv = T.lvl[i];
          if (r === 0) { // 木
            for (let k = 0; k < 2 + (lv > 5 ? 1 : 0); k++) {
              const ox = (hash(x + k, y * 3) - 0.5) * hw * 0.9, oy = (hash(x * 5, y + k) - 0.5) * hh * 0.7;
              const s = tw * 0.07;
              ctx.fillStyle = '#5b4a33'; ctx.fillRect(sx + ox - 0.8, sy + oy, 1.6, s * 1.2);
              ctx.fillStyle = k % 2 ? '#4f6b36' : '#5f7d3f';
              ctx.beginPath(); ctx.arc(sx + ox, sy + oy - s * 0.3, s, 0, 6.283); ctx.fill();
            }
          } else if (r === 1) { // 鐵
            ctx.fillStyle = '#6d6a66';
            const s = tw * 0.08;
            ctx.beginPath(); ctx.moveTo(sx - s * 1.4, sy + s * 0.5); ctx.lineTo(sx - s * 0.4, sy - s); ctx.lineTo(sx + s * 0.8, sy - s * 0.3); ctx.lineTo(sx + s * 1.3, sy + s * 0.6); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#9a9690'; ctx.fillRect(sx - s * 0.3, sy - s * 0.6, s * 0.5, s * 0.3);
          } else if (r === 2) { // 石
            ctx.fillStyle = '#b3a283';
            const s = tw * 0.07;
            ctx.fillRect(sx - s * 1.6, sy - s * 0.2, s * 1.3, s * 0.9);
            ctx.fillRect(sx + s * 0.1, sy - s * 0.6, s * 1.4, s * 1.1);
            ctx.strokeStyle = 'rgba(80,65,45,0.5)'; ctx.lineWidth = 1;
            ctx.strokeRect(sx - s * 1.6, sy - s * 0.2, s * 1.3, s * 0.9); ctx.strokeRect(sx + s * 0.1, sy - s * 0.6, s * 1.4, s * 1.1);
          } else { // 糧
            ctx.strokeStyle = 'rgba(150,120,40,0.7)'; ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let k = -1; k <= 1; k++) { ctx.moveTo(sx - hw * 0.35, sy + k * hh * 0.22); ctx.lineTo(sx + hw * 0.35, sy + k * hh * 0.22 - hh * 0.15); }
            ctx.stroke();
          }
          if (showLv) {
            ctx.font = fontLv;
            ctx.fillStyle = lv >= 7 ? '#8a1c10' : lv >= 5 ? '#5a2d10' : '#3b3020';
            ctx.fillText(lv, sx, sy + hh * 0.52);
          }
        }
      }
    }
  }
  function drawPeak(sx, sy, s, h) {
    const w = s * 0.62;
    ctx.fillStyle = '#8d7c5e';
    ctx.beginPath(); ctx.moveTo(sx - w, sy); ctx.lineTo(sx - w * 0.1, sy - s * 0.95); ctx.lineTo(sx + w * 0.15, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5e5140';
    ctx.beginPath(); ctx.moveTo(sx - w * 0.1, sy - s * 0.95); ctx.lineTo(sx + w, sy); ctx.lineTo(sx + w * 0.15, sy); ctx.closePath(); ctx.fill();
    if (h > 0.55) {
      ctx.fillStyle = '#d8d0bd';
      ctx.beginPath(); ctx.moveTo(sx - w * 0.1, sy - s * 0.95); ctx.lineTo(sx - w * 0.32, sy - s * 0.62); ctx.lineTo(sx + w * 0.05, sy - s * 0.7); ctx.lineTo(sx + w * 0.22, sy - s * 0.6); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,30,20,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(sx - w, sy); ctx.lineTo(sx - w * 0.1, sy - s * 0.95); ctx.lineTo(sx + w, sy); ctx.stroke();
  }

  function terrKey(i) {
    const c = Game.T.city[i];
    if (c >= 0) { const city = World.cities[c]; if (World.isPlayerCity(city)) return 'p' + city.owner; return city.alliance >= 0 ? 'a' + city.alliance : ''; }
    const o = Game.T.owner[i];
    return o >= 0 ? 'p' + o : '';
  }
  function drawBorders(x0, x1, y0, y1, hw, hh) {
    const T = Game.T;
    const segs = new Map();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        const k = terrKey(i);
        if (!k) continue;
        const col = relColor(i);
        if (!col) continue;
        const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        if (!onScreen(sx, sy, cam.tw)) continue;
        let arr = segs.get(col);
        if (!arr) { arr = []; segs.set(col, arr); }
        // 四邊：左上(x-1)、右上(y-1)、右下(x+1)、左下(y+1)
        if (x === 0 || terrKey(i - 1) !== k) arr.push(sx - hw, sy, sx, sy - hh);
        if (y === 0 || terrKey(i - N) !== k) arr.push(sx, sy - hh, sx + hw, sy);
        if (x === N - 1 || terrKey(i + 1) !== k) arr.push(sx + hw, sy, sx, sy + hh);
        if (y === N - 1 || terrKey(i + N) !== k) arr.push(sx, sy + hh, sx - hw, sy);
      }
    }
    ctx.lineWidth = 2;
    for (const [col, a] of segs) {
      ctx.strokeStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      ctx.beginPath();
      for (let k = 0; k < a.length; k += 4) { ctx.moveTo(a[k], a[k + 1]); ctx.lineTo(a[k + 2], a[k + 3]); }
      ctx.stroke();
    }
  }

  function drawAllianceTarget(hw, hh) {
    const g = Game.G;
    const u = Game.P[g.userId];
    if (u.alliance < 0) return;
    const a = g.alliances[u.alliance];
    if (a.target < 0) return;
    const c = World.cities[a.target];
    const [sx, sy] = toScreen(c.cx + 0.5, c.cy + 0.5);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(performance.now() / 60) % 10;
    diamond(ctx, sx, sy, hw * (c.size + 0.6), hh * (c.size + 0.6));
    ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
    if (a.pave && cam.tw >= 20) {
      ctx.strokeStyle = 'rgba(255,215,90,0.9)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      for (const i of a.pave.slice(0, 12)) {
        const [px, py] = toScreen(World.X(i) + 0.5, World.Y(i) + 0.5);
        if (!onScreen(px, py, 40)) continue;
        diamond(ctx, px, py, hw * 0.8, hh * 0.8); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // 旗幟
    const fx0 = sx, fy0 = sy - hh * c.size - 6;
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(fx0 - 1, fy0 - 26, 2, 26);
    ctx.fillStyle = '#d63a2a';
    ctx.beginPath(); ctx.moveTo(fx0 + 1, fy0 - 26); ctx.lineTo(fx0 + 20, fy0 - 20); ctx.lineTo(fx0 + 1, fy0 - 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '10px "Noto Serif TC", serif'; ctx.textAlign = 'left'; ctx.fillText('目標', fx0 + 3, fy0 - 20);
  }

  function relOfPid(pid) {
    const g = Game.G;
    const u = Game.P[g.userId];
    if (pid === u.id) return 'self';
    const q = Game.P[pid];
    if (u.alliance >= 0 && q.alliance === u.alliance) return 'ally';
    if (q.alliance < 0) return 'free';
    return 'enemy';
  }
  function relOfAlli(aid) {
    const u = Game.P[Game.G.userId];
    if (aid < 0) return 'npcCity';
    if (aid === u.alliance) return 'ally';
    return 'enemy';
  }
  function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }

  function drawCities(hw, hh, tw) {
    const g = Game.G;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of World.cities) {
      if (c.dead) continue;
      const [sx, sy] = toScreen(c.cx + 0.5, c.cy + 0.5);
      if (!onScreen(sx, sy, hw * c.size * 2 + 60)) continue;
      const major = c.type === 'capital' || c.type === 'luoyang' || c.type === 'pass';
      if (tw < 9 && c.type === 'main') {
        const rel = relOfPid(c.owner);
        if (rel === 'self') { ctx.fillStyle = '#6dff7a'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 6.283); ctx.fill(); }
        continue;
      }
      if (tw < 12 && !major && c.type !== 'main' && c.type !== 'branch') {
        ctx.fillStyle = c.alliance >= 0 ? rgb(REL_COLOR[relOfAlli(c.alliance)]) : '#e8d8b0';
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
        continue;
      }
      if (c.type === 'fort') { drawFort(c, sx, sy, hw, hh); continue; }
      if (c.type === 'camp') { drawCamp(c, sx, sy, hw, hh); continue; }
      drawCitySprite(c, sx, sy, hw, hh, tw);
      // 標籤
      const pc = c.type === 'main' || c.type === 'branch';
      const showLabel = pc ? tw >= 30 : (major || tw >= 14);
      if (showLabel) {
        let label = c.name, sub = '';
        let col = '#f4e7c5';
        if (pc) {
          const o = Game.P[c.owner];
          label = o.name + (c.type === 'branch' ? '・分城' : '');
          if (c.type === 'branch' && c.building > g.time) sub = '建造中';
          const rel = relOfPid(c.owner);
          col = rel === 'self' ? '#8dff95' : rel === 'ally' ? '#9cc4ff' : rel === 'free' ? '#ffe08a' : '#ff9a8a';
          if (c.type === 'main' && o.captor >= 0) sub = '淪陷';
        } else {
          sub = CFG.CITY_TYPE_NAME[c.type] + ' ' + c.lvl + '級';
          if (c.alliance >= 0) sub = '〔' + g.alliances[c.alliance].name + '〕';
        }
        const fs = pc ? 11 : major ? Math.max(12, Math.min(20, tw * 0.35)) : 12;
        ctx.font = (major ? 'bold ' : '') + fs + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
        const ly = sy - hh * c.size - (pc ? 10 : 16);
        const wlab = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(25,18,10,0.72)';
        roundRect(ctx, sx - wlab / 2, ly - fs * 0.7, wlab, fs * 1.4, 4); ctx.fill();
        ctx.fillStyle = col; ctx.fillText(label, sx, ly);
        if (sub && (tw >= 14 || major)) {
          ctx.font = '10px "Noto Serif TC", serif';
          ctx.fillStyle = c.alliance >= 0 ? rgb(REL_COLOR[relOfAlli(c.alliance)]) : '#e6d3a3';
          if (pc && sub) ctx.fillStyle = '#ff6a5a';
          ctx.fillText(sub, sx, ly + fs * 0.7 + 6);
        }
      }
    }
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function drawCitySprite(c, sx, sy, hw, hh, tw) {
    const s = c.size;
    const W2 = hw * s * 0.92, H2 = hh * s * 0.92;
    const wallH = Math.max(3, tw * (c.type === 'main' || c.type === 'branch' ? 0.18 : 0.26));
    let flag = null;
    if (c.type === 'main' || c.type === 'branch') flag = REL_COLOR[relOfPid(c.owner)];
    else if (c.alliance >= 0) flag = Game.G.userId >= 0 ? REL_COLOR[relOfAlli(c.alliance)] : null;
    // 城內地面
    diamond(ctx, sx, sy, W2, H2);
    ctx.fillStyle = c.type === 'pass' ? '#8f7f62' : '#a8946c';
    ctx.fill();
    // 城牆（立體）
    const wallTop = '#c7b48a', wallL = '#9a8662', wallR = '#7c6a4c';
    ctx.fillStyle = wallL;
    ctx.beginPath(); ctx.moveTo(sx - W2, sy); ctx.lineTo(sx, sy + H2); ctx.lineTo(sx, sy + H2 - wallH); ctx.lineTo(sx - W2, sy - wallH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wallR;
    ctx.beginPath(); ctx.moveTo(sx, sy + H2); ctx.lineTo(sx + W2, sy); ctx.lineTo(sx + W2, sy - wallH); ctx.lineTo(sx, sy + H2 - wallH); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = wallTop; ctx.lineWidth = Math.max(1.2, tw * 0.05);
    diamond(ctx, sx, sy - wallH, W2, H2); ctx.stroke();
    // 城垛
    if (tw >= 20) {
      ctx.fillStyle = wallTop;
      const n = 4 * s;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const px = sx - W2 + W2 * t, py = sy - wallH + H2 * t;
        ctx.fillRect(px - 1.2, py - 3, 2.4, 3);
        const qx = sx + W2 * t, qy = sy - wallH + H2 - H2 * t;
        ctx.fillRect(qx - 1.2, qy - 3, 2.4, 3);
      }
    }
    // 城內建築
    const nb = c.type === 'main' ? 2 : c.type === 'county' ? 3 : c.type === 'pass' ? 2 : 5;
    for (let k = 0; k < nb; k++) {
      const ang = (k / nb) * 6.283 + 0.6;
      const rr = k === 0 ? 0 : 0.42;
      const bx = sx + Math.cos(ang) * W2 * rr, by = sy - wallH * 0.3 + Math.sin(ang) * H2 * rr;
      const bw = tw * (c.type === 'luoyang' ? 0.55 : c.type === 'capital' ? 0.45 : 0.3) * (k === 0 ? 1.3 : 0.85), bh = bw * 0.7;
      // 屋身
      ctx.fillStyle = '#d9c9a0';
      ctx.fillRect(bx - bw / 2, by - bh, bw, bh);
      // 屋頂
      ctx.fillStyle = k === 0 && (c.type === 'luoyang' || c.type === 'capital') ? '#8c2d1e' : '#3c3a3a';
      ctx.beginPath(); ctx.moveTo(bx - bw * 0.7, by - bh); ctx.lineTo(bx, by - bh - bw * 0.45); ctx.lineTo(bx + bw * 0.7, by - bh); ctx.closePath(); ctx.fill();
      if (c.type === 'luoyang' && k === 0) {
        ctx.fillStyle = '#b8932e';
        ctx.fillRect(bx - bw * 0.5, by - bh * 1.9, bw, bh * 0.5);
        ctx.fillStyle = '#8c2d1e';
        ctx.beginPath(); ctx.moveTo(bx - bw * 0.6, by - bh * 1.9); ctx.lineTo(bx, by - bh * 2.4); ctx.lineTo(bx + bw * 0.6, by - bh * 1.9); ctx.closePath(); ctx.fill();
      }
    }
    // 關口城門
    if (c.type === 'pass') {
      ctx.fillStyle = '#3b2c1c';
      ctx.fillRect(sx - tw * 0.12, sy + H2 * 0.3 - wallH, tw * 0.24, wallH);
    }
    // 旗幟
    if (flag) {
      const fx0 = sx + W2 * 0.55, fy0 = sy - wallH - H2 * 0.3;
      ctx.fillStyle = '#4a3520'; ctx.fillRect(fx0, fy0 - tw * 0.4, 1.5, tw * 0.4);
      ctx.fillStyle = rgb(flag);
      ctx.fillRect(fx0 + 1.5, fy0 - tw * 0.4, tw * 0.22, tw * 0.14);
    }
    // 耐久條（受損時）
    if (c.maxDur && c.dur < c.maxDur - 1 && tw >= 14) {
      const bw = Math.max(30, W2 * 1.2);
      const y = sy + H2 + 6;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - bw / 2, y, bw, 4);
      ctx.fillStyle = '#e0a030'; ctx.fillRect(sx - bw / 2, y, bw * c.dur / c.maxDur, 4);
    }
  }
  function drawFort(c, sx, sy, hw, hh) {
    const rel = relOfPid(c.owner);
    const col = REL_COLOR[rel];
    const s = Math.max(5, cam.tw * 0.3);
    ctx.fillStyle = '#6e5a3c';
    ctx.fillRect(sx - s, sy - s * 1.1, s * 2, s * 1.1);
    ctx.fillStyle = '#9b8458';
    ctx.fillRect(sx - s, sy - s * 1.3, s * 2, s * 0.3);
    ctx.fillStyle = rgb(col);
    ctx.fillRect(sx - 1, sy - s * 2.2, s * 0.8, s * 0.5);
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(sx - 1, sy - s * 2.2, 1.5, s);
    if (c.building > Game.G.time && cam.tw >= 20) {
      ctx.font = '10px "Noto Serif TC", serif'; ctx.fillStyle = '#ffe08a'; ctx.fillText('建造中', sx, sy + hh);
    }
  }

  function drawCamp(c, sx, sy, hw, hh) {
    const col = REL_COLOR[relOfPid(c.owner)];
    const s = Math.max(4, cam.tw * 0.26);
    ctx.fillStyle = '#b89a62';
    ctx.beginPath(); ctx.moveTo(sx - s, sy); ctx.lineTo(sx, sy - s * 1.4); ctx.lineTo(sx + s, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a4428';
    ctx.beginPath(); ctx.moveTo(sx - s * 0.25, sy); ctx.lineTo(sx, sy - s * 0.7); ctx.lineTo(sx + s * 0.25, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(col);
    ctx.fillRect(sx, sy - s * 2, s * 0.6, s * 0.4);
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(sx - 0.5, sy - s * 2, 1.2, s * 0.7);
    if (c.building > Game.G.time && cam.tw >= 20) {
      ctx.font = '10px "Noto Serif TC", serif'; ctx.fillStyle = '#ffe08a'; ctx.fillText('搭建中', sx, sy + hh);
    }
  }

  function drawStateNames() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.max(18, Math.min(46, cam.tw * 3.2));
    ctx.font = fs + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
    for (const s of World.states) {
      const [sx, sy] = toScreen(s.sx, s.sy + 5);
      if (!onScreen(sx, sy, 100)) continue;
      ctx.fillStyle = 'rgba(30,20,10,0.55)';
      ctx.fillText(s.name, sx + 2, sy + 2);
      ctx.fillStyle = s.type === 'birth' ? 'rgba(255,240,205,0.85)' : 'rgba(255,215,140,0.95)';
      ctx.fillText(s.name, sx, sy);
    }
  }

  function drawMarches(now, hw, hh) {
    const g = Game.G;
    const t = g.time + g.acc;
    const u = Game.P[g.userId];
    const T = Game.T;
    for (const m of g.marches) {
      const rel = relOfPid(m.pid);
      const mine = rel === 'self';
      // 針對使用者或其盟友的攻擊
      let threat = false;
      if (m.type === 'attack' && !mine) {
        const o = Game.tileOwner(m.to);
        const al = Game.tileAlliance(m.to);
        threat = o === u.id || (u.alliance >= 0 && al === u.alliance);
      }
      if (!showAIMarch && !mine && !threat && rel !== 'ally') continue;
      const [gx, gy] = Game.marchPos(m, t);
      const [cx, cy] = toScreen(gx + 0.5, gy + 0.5);
      const [ex, ey] = toScreen(World.X(m.to) + 0.5, World.Y(m.to) + 0.5);
      if (!onScreen(cx, cy, 30) && !onScreen(ex, ey, 30)) continue;
      const col = threat ? [255, 60, 40] : REL_COLOR[rel === 'free' ? 'free' : rel];
      const w = mine || threat ? 2.4 : cam.tw < 12 ? 1 : 1.5;
      ctx.lineWidth = w;
      // 未走路線（虛線）
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -(now / 40) % 10;
      ctx.strokeStyle = rgb(col, m.type === 'return' ? 0.35 : 0.7);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      // 箭頭
      if (m.type !== 'return' && cam.tw >= 10) {
        const ang = Math.atan2(ey - cy, ex - cx);
        ctx.fillStyle = rgb(col, 0.9);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(ang - 0.4) * 9, ey - Math.sin(ang - 0.4) * 9);
        ctx.lineTo(ex - Math.cos(ang + 0.4) * 9, ey - Math.sin(ang + 0.4) * 9);
        ctx.closePath(); ctx.fill();
      }
      // 部隊標記
      const r = mine || threat ? 5.5 : cam.tw < 12 ? 2.2 : 3.5;
      ctx.fillStyle = rgb(col);
      ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill(); ctx.stroke();
      if (mine && cam.tw >= 14) {
        const p = Game.P[m.pid];
        const team = p.teams[m.team];
        const h = Game.heroByUid(p, team.slots[0]);
        const lab = (h ? Game.tpl(h).name : '部隊') + ' ' + U.fmtDur(m.end - t);
        ctx.font = '11px "Noto Serif TC", serif';
        const wl = ctx.measureText(lab).width + 8;
        ctx.fillStyle = 'rgba(20,40,20,0.8)';
        roundRect(ctx, cx - wl / 2, cy - 22, wl, 15, 3); ctx.fill();
        ctx.fillStyle = '#c8ffc8'; ctx.textAlign = 'center'; ctx.fillText(lab, cx, cy - 14);
      }
    }
  }

  function addFx(tile, kind) { fx.push({ tile, kind, t0: performance.now() }); if (fx.length > 80) fx.shift(); }
  function drawFx(now, hw, hh) {
    const g = Game.G;
    if (g.fx && g.fx.length) { for (const e of g.fx) addFx(e.tile, e.kind); g.fx.length = 0; }
    for (let k = fx.length - 1; k >= 0; k--) {
      const e = fx[k];
      const age = (now - e.t0) / 1000;
      if (age > 1.6) { fx.splice(k, 1); continue; }
      if (e.kind === 'other' && cam.tw < 12) continue;
      const [sx, sy] = toScreen(World.X(e.tile) + 0.5, World.Y(e.tile) + 0.5);
      if (!onScreen(sx, sy, 40)) continue;
      const a = 1 - age / 1.6;
      ctx.font = 'bold ' + Math.round(14 + age * 10) + 'px serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = e.kind === 'win' ? 'rgba(255,220,90,' + a + ')' : e.kind === 'lose' ? 'rgba(255,90,70,' + a + ')' : 'rgba(255,255,255,' + a + ')';
      ctx.fillText('⚔', sx, sy - hh - age * 18);
    }
  }

  // ============ 小地圖 ============
  function initMini(canvas) {
    miniCv = canvas;
    miniCtx = canvas.getContext('2d');
  }
  let miniLast = 0;
  function drawMini() {
    if (!miniCv || !miniBase) return;
    const now = performance.now();
    if (now - miniLast < 250) return;
    miniLast = now;
    const w = miniCv.width, h = miniCv.height;
    const c = miniCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    const s = w / (N * 2) * 2; // 菱形寬 = N*s
    const hw = s / 2, hh = s / 4;
    const ox = w / 2, oy = (h - N * s / 2) / 2;
    c.setTransform(hw, hh, -hw, hh, ox, oy);
    c.imageSmoothingEnabled = true;
    c.drawImage(miniBase, 0, 0);
    c.globalAlpha = 0.9;
    c.drawImage(overlayCv, 0, 0);
    c.globalAlpha = 1;
    // 視窗框
    c.setTransform(1, 0, 0, 1, 0, 0);
    const corners = [toGrid(0, 0), toGrid(W, 0), toGrid(W, H), toGrid(0, H)];
    c.strokeStyle = '#fff'; c.lineWidth = 1.2;
    c.beginPath();
    corners.forEach(([gx, gy], k) => {
      const px = ox + (gx - gy) * hw, py = oy + (gx + gy) * hh;
      if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
    });
    c.closePath(); c.stroke();
    // 使用者主城
    const u = Game.P[Game.G.userId];
    const ux = World.X(u.cityTile) + 0.5, uy = World.Y(u.cityTile) + 0.5;
    c.fillStyle = '#6dff7a';
    c.beginPath(); c.arc(ox + (ux - uy) * hw, oy + (ux + uy) * hh, 3, 0, 6.283); c.fill();
    miniCv._map = { ox, oy, hw, hh };
  }
  function miniToGrid(mx, my) {
    const m = miniCv._map;
    if (!m) return null;
    const a = (mx - m.ox) / m.hw, b = (my - m.oy) / m.hh;
    return [(a + b) / 2, (b - a) / 2];
  }
  // 大地圖（天下）繪製到任意 canvas
  function drawWorldMap(canvas) {
    const c = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#1a140e'; c.fillRect(0, 0, w, h);
    const s = Math.min(w, h * 2) / N;
    const hw = s / 2, hh = s / 4;
    const ox = w / 2, oy = (h - N * s / 2) / 2;
    c.setTransform(hw, hh, -hw, hh, ox, oy);
    c.imageSmoothingEnabled = true;
    c.drawImage(miniBase, 0, 0);
    c.drawImage(overlayCv, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const st of World.states) {
      const px = ox + (st.sx - st.sy) * hw, py = oy + (st.sx + st.sy) * hh + 18;
      c.font = '18px "LXGW WenKai TC", serif';
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillText(st.name, px + 1, py + 1);
      c.fillStyle = '#fff3d6'; c.fillText(st.name, px, py);
    }
    for (const ct of World.cities) {
      if (World.isPlayerCity(ct) || ct.dead) continue;
      const px = ox + (ct.cx + 0.5 - ct.cy - 0.5) * hw, py = oy + (ct.cx + ct.cy + 1) * hh;
      const big = ct.type === 'capital' || ct.type === 'luoyang';
      c.fillStyle = ct.alliance >= 0 ? Game.G.alliances[ct.alliance].color : '#e8d8b0';
      c.strokeStyle = '#111'; c.lineWidth = 1;
      c.beginPath();
      if (ct.type === 'pass') { c.rect(px - 3, py - 3, 6, 6); }
      else c.arc(px, py, big ? 5 : 3, 0, 6.283);
      c.fill(); c.stroke();
      if (big) { c.font = '11px "Noto Serif TC", serif'; c.fillStyle = '#fff'; c.fillText(ct.name, px, py - 11); }
    }
    const u = Game.P[Game.G.userId];
    const ux = World.X(u.cityTile) + 0.5, uy = World.Y(u.cityTile) + 0.5;
    c.fillStyle = '#6dff7a';
    c.beginPath(); c.arc(ox + (ux - uy) * hw, oy + (ux + uy) * hh, 4, 0, 6.283); c.fill();
    canvas._map = { ox, oy, hw, hh };
  }

  return {
    init, initMini, buildTerrain, draw, resize, toScreen, toGrid, tileAt, centerOn, pan, zoomAt, cam,
    setHover(i) { hover = i; }, setSelected(i) { selected = i; }, get selected() { return selected; },
    setMode, get mode() { return mode; }, fullOverlay, miniToGrid, drawWorldMap,
    set showAIMarch(v) { showAIMarch = v; }, get showAIMarch() { return showAIMarch; },
  };
})();
