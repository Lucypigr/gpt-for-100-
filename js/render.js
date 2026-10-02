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
  let detailSprites = null;
  let terrainArt = null;
  const cityArt = {};
  const fx = [];
  const TEX = 4; // 地形貼圖每格像素

  const REL_COLOR = {
    self: [53, 201, 175], ally: [74, 157, 219], enemy: [215, 76, 59], free: [215, 177, 74], npcCity: [150, 150, 150],
  };

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    for (const [kind, path] of [['capital', 'assets/city-capital.png'], ['town', 'assets/city-town.png']]) {
      const art = new Image();
      art.src = path;
      cityArt[kind] = art;
    }
    terrainArt = new Image();
    terrainArt.src = 'assets/terrain-details.png';
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
    const RES_TINT = [[107, 154, 78], [139, 158, 119], [169, 168, 130], [204, 180, 89]];
    const nz = U.makeNoise(World.seed + 99);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const tr = T.terrain[i];
        let base;
        if (tr === TERRAIN.MOUNTAIN) base = [118, 125, 94];
        else if (tr === TERRAIN.WATER) base = [53, 145, 156];
        else if (tr === TERRAIN.CITY) base = [172, 169, 119];
        else {
          const tint = RES_TINT[T.res[i]];
          const lv = T.lvl[i];
          const k = 0.3;
          const dark = 1 - lv * 0.009;
          base = [(169 * (1 - k) + tint[0] * k) * dark, (189 * (1 - k) + tint[1] * k) * dark, (111 * (1 - k) + tint[2] * k) * dark];
          if ((x > 0 && T.terrain[i - 1] === TERRAIN.WATER) || (y > 0 && T.terrain[i - N] === TERRAIN.WATER) ||
              (x < N - 1 && T.terrain[i + 1] === TERRAIN.WATER) || (y < N - 1 && T.terrain[i + N] === TERRAIN.WATER)) {
            base = base.map((v, channel) => v * 0.72 + [207, 194, 132][channel] * 0.28);
          }
        }
        const big = nz(x * 0.055, y * 0.055, 3) - 0.5;
        for (let py = 0; py < TEX; py++) {
          for (let px = 0; px < TEX; px++) {
            const o = ((y * TEX + py) * N * TEX + (x * TEX + px)) * 4;
            let v = (hash(x * TEX + px, y * TEX + py) - 0.5) * 11 + big * 28;
            if (tr === TERRAIN.MOUNTAIN) v += (hash(x, y) - 0.5) * 17 + (py < 2 ? 7 : -5);
            if (tr === TERRAIN.WATER) v += Math.sin((x * TEX + px + y * 2) * 0.45) * 5 + (py === 0 ? 8 : 0);
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
    buildDetailSprites();
    fullOverlay();
  }

  // A small atlas keeps close-up foliage and farmland detailed without drawing
  // hundreds of individual leaves on every animation frame.
  function buildDetailSprites() {
    function sprite(draw) {
      const canvas = document.createElement('canvas');
      canvas.width = 96; canvas.height = 72;
      draw(canvas.getContext('2d'));
      return canvas;
    }
    function tree(c, x, y, s, light, dark) {
      c.fillStyle = 'rgba(39,55,26,.24)';
      c.beginPath(); c.ellipse(x + s * .38, y + s * .25, s * .72, s * .18, 0, 0, 6.283); c.fill();
      c.fillStyle = '#5a4730'; c.fillRect(x - s * .08, y - s * .46, s * .16, s * .63);
      c.fillStyle = dark;
      c.beginPath(); c.ellipse(x + s * .09, y - s * .65, s * .55, s * .58, -.2, 0, 6.283); c.fill();
      c.fillStyle = light;
      c.beginPath(); c.ellipse(x - s * .18, y - s * .9, s * .43, s * .39, -.3, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(206,218,130,.48)';
      c.beginPath(); c.ellipse(x - s * .28, y - s * 1.02, s * .17, s * .09, -.4, 0, 6.283); c.fill();
    }
    const forest = [
      sprite(c => { tree(c, 32, 58, 20, '#659647', '#3d6d3b'); tree(c, 64, 55, 25, '#668f43', '#315b36'); tree(c, 47, 65, 17, '#84a64c', '#507741'); }),
      sprite(c => { tree(c, 29, 55, 23, '#799e53', '#476e3e'); tree(c, 55, 59, 18, '#5c873d', '#365e36'); tree(c, 75, 58, 20, '#6d9349', '#3e6739'); }),
      sprite(c => { tree(c, 42, 58, 27, '#769a4b', '#426b3a'); tree(c, 72, 62, 19, '#88a750', '#4c7541'); }),
    ];
    const field = sprite(c => {
      c.fillStyle = 'rgba(77,70,27,.16)';
      c.beginPath(); c.ellipse(48, 55, 42, 12, 0, 0, 6.283); c.fill();
      c.fillStyle = '#b7a64d';
      c.beginPath(); c.moveTo(8, 51); c.lineTo(48, 33); c.lineTo(88, 51); c.lineTo(48, 68); c.closePath(); c.fill();
      c.fillStyle = '#d5c663';
      for (let k = 0; k < 6; k++) {
        c.beginPath(); c.moveTo(14 + k * 7, 49 - k * 2.5); c.lineTo(48 + k * 6, 61 - k * 2);
        c.lineTo(51 + k * 6, 59 - k * 2); c.lineTo(18 + k * 7, 47 - k * 2.5); c.closePath(); c.fill();
      }
      c.strokeStyle = '#8b823c'; c.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(17, 47 + k * 5); c.lineTo(50, 34 + k * 5); c.stroke(); }
    });
    const rock = sprite(c => {
      c.fillStyle = 'rgba(51,52,42,.24)';
      c.beginPath(); c.ellipse(51, 59, 39, 10, 0, 0, 6.283); c.fill();
      for (const [x, y, s] of [[28, 53, 17], [54, 50, 23], [72, 58, 12]]) {
        c.fillStyle = '#727b6b';
        c.beginPath(); c.moveTo(x - s, y); c.lineTo(x - s * .3, y - s * .8); c.lineTo(x + s * .55, y - s * .65); c.lineTo(x + s, y); c.closePath(); c.fill();
        c.fillStyle = '#b7bc9e';
        c.beginPath(); c.moveTo(x - s, y); c.lineTo(x - s * .3, y - s * .8); c.lineTo(x + s * .1, y - s * .42); c.lineTo(x + s * .1, y); c.closePath(); c.fill();
      }
    });
    const scrub = sprite(c => {
      for (const [x, y, s] of [[27, 55, 8], [47, 62, 6], [69, 54, 10]]) {
        c.fillStyle = 'rgba(47,78,37,.25)';
        c.beginPath(); c.ellipse(x + 2, y + 2, s * 1.2, s * .35, 0, 0, 6.283); c.fill();
        c.fillStyle = '#648a43';
        c.beginPath(); c.ellipse(x, y - s * .4, s, s * .6, 0, 0, 6.283); c.fill();
        c.fillStyle = '#95af60';
        c.beginPath(); c.ellipse(x - s * .25, y - s * .65, s * .45, s * .24, 0, 0, 6.283); c.fill();
      }
    });
    detailSprites = { forest, field, rock, scrub };
  }

  function drawTerrainSprite(kind, x, y, w, h, variant) {
    if (terrainArt && terrainArt.complete && terrainArt.naturalWidth) {
      const half = terrainArt.naturalWidth / 2;
      const pos = { forest: [0, 0], rock: [1, 0], field: [0, 1], scrub: [1, 1] }[kind];
      if (variant % 2) { ctx.save(); ctx.translate(x * 2, 0); ctx.scale(-1, 1); }
      ctx.drawImage(terrainArt, pos[0] * half, pos[1] * half, half, half, x - w / 2, y - h * 0.82, w, h);
      if (variant % 2) ctx.restore();
    } else {
      const sprite = kind === 'forest' ? detailSprites.forest[variant % detailSprites.forest.length] : detailSprites[kind];
      ctx.drawImage(sprite, x - w / 2, y - h * 0.82, w, h);
    }
  }

  // 效能優先：每塊資源地最多只畫 1 個圖案。
  // 1級保持乾淨；2~9級只用圖案大小區分，不再重複繪製多顆石頭/樹木。
  function drawSimpleResourceLand(res, lv, sx, sy, tw, variant) {
    if (lv <= 1) return;
    const level = Math.max(2, Math.min(9, lv | 0));
    const size = 0.46 + (level - 2) * 0.045;
    const kind = res === 0 ? 'forest' : res === 3 ? 'field' : 'rock';
    const family = res === 3 ? 1.05 : res === 2 ? 0.98 : res === 1 ? 0.90 : 1;

    ctx.save();
    if (res === 1) ctx.filter = 'brightness(.66) saturate(.55) contrast(1.22)';
    else if (res === 2) ctx.filter = 'brightness(1.10) saturate(.46) contrast(.96)';

    const w = tw * size * family;
    const h = tw * size * (kind === 'field' ? .62 : .70);
    drawTerrainSprite(kind, sx, sy, w, h, variant);
    ctx.restore();
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
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 69;
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

  // 只畫螢幕可見土地的細邊界；比全地圖格線省很多，也不會蓋過資源/城池。
  function drawVisibleTileGrid(x0, x1, y0, y1, hw, hh, tw) {
    const touchDevice = (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window);
    if (tw < 26 || (touchDevice && tw < 55)) return;
    ctx.save();
    ctx.strokeStyle = tw >= 55 ? 'rgba(54,45,29,.28)' : 'rgba(54,45,29,.20)';
    ctx.lineWidth = tw >= 70 ? 1.15 : 0.8;
    ctx.beginPath();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        if (!onScreen(sx, sy, tw)) continue;
        ctx.moveTo(sx, sy - hh);
        ctx.lineTo(sx + hw, sy);
        ctx.lineTo(sx, sy + hh);
        ctx.lineTo(sx - hw, sy);
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.restore();
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
    ctx.globalAlpha = tw < 12 ? 0.95 : 0.72;
    ctx.drawImage(overlayCv, 0, 0);
    ctx.restore();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawVisibleTileGrid(x0, x1, y0, y1, hw, hh, tw);
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
    const fine = tw >= 32;
    const showLv = tw >= 80;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        const tr = T.terrain[i];
        const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        if (!onScreen(sx, sy, tw)) continue;
        const h = hash(x, y);
        if (tr === TERRAIN.MOUNTAIN) {
          if (terrainArt && terrainArt.complete && terrainArt.naturalWidth) {
            if (h > 0.25) drawTerrainSprite('rock', sx, sy + hh * 0.35, tw * (0.83 + h * 0.17), tw * (0.63 + h * 0.14), Math.floor(h * 10));
          } else drawPeak(sx, sy + hh * 0.5, tw * (0.52 + h * 0.16), h);
        } else if (tr === TERRAIN.WATER) {
          if (fine && h > 0.55) {
            ctx.strokeStyle = 'rgba(217,244,224,0.55)'; ctx.lineWidth = Math.max(1, tw * 0.018);
            ctx.beginPath(); ctx.moveTo(sx - hw * 0.37, sy - hh * 0.12); ctx.quadraticCurveTo(sx - hw * 0.13, sy - hh * 0.32, sx + hw * 0.05, sy - hh * 0.13); ctx.stroke();
            ctx.strokeStyle = 'rgba(18,98,114,0.32)';
            ctx.beginPath(); ctx.moveTo(sx - hw * 0.08, sy + hh * 0.28); ctx.lineTo(sx + hw * 0.36, sy + hh * 0.12); ctx.stroke();
          }
          if (fine) drawShore(x, y, sx, sy, hw, hh);
        } else if (tr === TERRAIN.PLAIN && fine) {
          const r = T.res[i];
          const lv = T.lvl[i];
          // 1級不畫；2~9級只畫單一簡圖，大小隨等級增加。
          drawSimpleResourceLand(r, lv, sx, sy, tw, Math.floor(h * 10));
          if (showLv && lv >= 5) {
            ctx.fillStyle = 'rgba(27,35,21,0.68)';
            ctx.beginPath(); ctx.arc(sx + hw * 0.38, sy + hh * 0.5, 8, 0, 6.283); ctx.fill();
            ctx.font = 'bold 10px "Noto Serif TC", serif'; ctx.fillStyle = '#f6e3ae';
            ctx.fillText(lv, sx + hw * 0.38, sy + hh * 0.5);
          }
        }
      }
    }
  }
  function drawShore(x, y, sx, sy, hw, hh) {
    const T = Game.T.terrain;
    const edges = [
      [x > 0 && T[y * N + x - 1] !== TERRAIN.WATER, sx - hw, sy, sx, sy - hh],
      [y > 0 && T[(y - 1) * N + x] !== TERRAIN.WATER, sx, sy - hh, sx + hw, sy],
      [x < N - 1 && T[y * N + x + 1] !== TERRAIN.WATER, sx + hw, sy, sx, sy + hh],
      [y < N - 1 && T[(y + 1) * N + x] !== TERRAIN.WATER, sx, sy + hh, sx - hw, sy],
    ];
    ctx.lineCap = 'round';
    for (const [land, x1, y1, x2, y2] of edges) {
      if (!land) continue;
      ctx.strokeStyle = 'rgba(211,221,161,.52)'; ctx.lineWidth = Math.max(3, cam.tw * 0.09);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - hh * 0.12, x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(232,241,202,.68)'; ctx.lineWidth = Math.max(1, cam.tw * 0.023); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  function drawPeak(sx, sy, s, h) {
    const w = s * 0.67, summit = sy - s * (0.85 + h * 0.22);
    ctx.fillStyle = 'rgba(36,51,31,0.3)';
    ctx.beginPath(); ctx.ellipse(sx + w * .18, sy + s * .07, w, s * .2, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#879078';
    ctx.beginPath(); ctx.moveTo(sx - w, sy); ctx.lineTo(sx - w * .14, summit); ctx.lineTo(sx + w * .25, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5f6a60';
    ctx.beginPath(); ctx.moveTo(sx - w * .14, summit); ctx.lineTo(sx + w, sy); ctx.lineTo(sx + w * .25, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8b5a0';
    ctx.beginPath(); ctx.moveTo(sx - w * .14, summit); ctx.lineTo(sx - w * .39, summit + s * .36); ctx.lineTo(sx - w * .1, summit + s * .23); ctx.lineTo(sx + w * .06, summit + s * .38); ctx.lineTo(sx + w * .2, summit + s * .3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(39,50,41,.32)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - w * .42, sy - s * .18); ctx.lineTo(sx - w * .05, summit + s * .34); ctx.lineTo(sx + w * .18, sy - s * .12); ctx.stroke();
  }

  function terrKey(i) {
    const c = Game.T.city[i];
    if (c >= 0) { const city = World.cities[c]; if (World.isPlayerCity(city)) return 'p' + city.owner; return city.alliance >= 0 ? 'a' + city.alliance : ''; }
    const o = Game.T.owner[i];
    return o >= 0 ? 'p' + o : '';
  }
  function drawBorders(x0, x1, y0, y1, hw, hh) {
    const segs = new Map();
    const grid = new Map();
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
        let inner = grid.get(col);
        if (!inner) { inner = []; grid.set(col, inner); }
        inner.push(sx - hw, sy, sx, sy - hh, sx, sy - hh, sx + hw, sy);
        // 四邊：左上(x-1)、右上(y-1)、右下(x+1)、左下(y+1)
        if (x === 0 || terrKey(i - 1) !== k) arr.push(sx - hw, sy, sx, sy - hh);
        if (y === 0 || terrKey(i - N) !== k) arr.push(sx, sy - hh, sx + hw, sy);
        if (x === N - 1 || terrKey(i + 1) !== k) arr.push(sx + hw, sy, sx, sy + hh);
        if (y === N - 1 || terrKey(i + N) !== k) arr.push(sx, sy + hh, sx - hw, sy);
      }
    }
    ctx.lineWidth = Math.max(1.1, cam.tw * 0.024);
    for (const [col, a] of grid) {
      ctx.strokeStyle = rgb(col, 0.52);
      ctx.beginPath();
      for (let k = 0; k < a.length; k += 4) { ctx.moveTo(a[k], a[k + 1]); ctx.lineTo(a[k + 2], a[k + 3]); }
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(2.3, cam.tw * 0.047);
    ctx.shadowBlur = 6;
    for (const [col, a] of segs) {
      ctx.strokeStyle = rgb(col, 0.95);
      ctx.shadowColor = rgb(col, 0.75);
      ctx.beginPath();
      for (let k = 0; k < a.length; k += 4) { ctx.moveTo(a[k], a[k + 1]); ctx.lineTo(a[k + 2], a[k + 3]); }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
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
        const fs = pc ? Math.max(11, Math.min(16, tw * 0.21)) : major ? Math.max(12, Math.min(20, tw * 0.3)) : 12;
        ctx.font = (major ? 'bold ' : '') + fs + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
        const art = c.type === 'pass' ? null : cityArt[(pc || c.type === 'capital' || c.type === 'luoyang') ? 'capital' : 'town'];
        const ly = art && art.complete && art.naturalWidth && tw >= 24
          ? sy - tw * (c.size * 0.74 + 0.18)
          : sy - hh * c.size - (tw >= 28 ? Math.min(48, tw * 0.52) : 16);
        const wlab = ctx.measureText(label).width + 18;
        ctx.fillStyle = 'rgba(22,28,20,0.85)';
        roundRect(ctx, sx - wlab / 2, ly - fs * 0.8, wlab, fs * 1.6, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(207,177,105,0.72)'; ctx.lineWidth = 1;
        ctx.stroke();
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
  function drawHall(x, y, w, h, roof, ornate) {
    // The front wall is below a two-sided tiled roof, so even small towns read
    // as buildings rather than flat markers when the camera is zoomed in.
    const eave = w * 0.18;
    ctx.fillStyle = 'rgba(34,35,29,0.24)';
    ctx.fillRect(x - w * 0.47 + 3, y - h * 0.62 + 4, w, h * 0.64);
    ctx.fillStyle = ornate ? '#b99d70' : '#b9ac86';
    ctx.fillRect(x - w * 0.46, y - h * 0.65, w * 0.92, h * 0.65);
    ctx.fillStyle = '#735d45';
    for (let k = -1; k <= 1; k++) ctx.fillRect(x + k * w * 0.25 - w * 0.035, y - h * 0.61, w * 0.07, h * 0.6);
    ctx.fillStyle = '#3b332c';
    ctx.fillRect(x - w * 0.12, y - h * 0.52, w * 0.24, h * 0.52);
    ctx.fillStyle = '#4d4938';
    ctx.fillRect(x - w * 0.38, y - h * 0.47, w * 0.12, h * 0.25);
    ctx.fillRect(x + w * 0.26, y - h * 0.47, w * 0.12, h * 0.25);
    ctx.fillStyle = roof;
    ctx.beginPath(); ctx.moveTo(x - w * 0.5 - eave, y - h * 0.65); ctx.lineTo(x, y - h * 1.17); ctx.lineTo(x + w * 0.5 + eave, y - h * 0.65);
    ctx.lineTo(x + w * 0.48, y - h * 0.48); ctx.lineTo(x, y - h * 0.94); ctx.lineTo(x - w * 0.48, y - h * 0.48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ornate ? '#724f42' : '#757e70';
    ctx.beginPath(); ctx.moveTo(x - w * 0.5 - eave, y - h * 0.65); ctx.lineTo(x, y - h * 1.17); ctx.lineTo(x, y - h * 0.94); ctx.lineTo(x - w * 0.48, y - h * 0.48); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ornate ? '#d7b46a' : '#c4bb9a'; ctx.lineWidth = Math.max(1, w * 0.035);
    ctx.beginPath(); ctx.moveTo(x - w * 0.5 - eave, y - h * 0.65); ctx.lineTo(x, y - h * 1.17); ctx.lineTo(x + w * 0.5 + eave, y - h * 0.65); ctx.stroke();
    if (w > 17) {
      ctx.strokeStyle = ornate ? 'rgba(32,31,28,.48)' : 'rgba(43,52,48,.43)'; ctx.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        ctx.beginPath(); ctx.moveTo(x - w * (0.5 + t * 0.18), y - h * (0.65 - t * 0.11));
        ctx.lineTo(x, y - h * (1.17 - t * 0.23));
        ctx.lineTo(x + w * (0.5 + t * 0.18), y - h * (0.65 - t * 0.11)); ctx.stroke();
      }
    }
    if (ornate && w > 23) {
      ctx.strokeStyle = 'rgba(219,190,118,.52)'; ctx.lineWidth = 1;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath(); ctx.moveTo(x + k * w * 0.13, y - h * 0.81 - (2 - Math.abs(k)) * h * 0.12);
        ctx.lineTo(x + k * w * 0.13 + w * 0.1, y - h * 0.67); ctx.stroke();
      }
    }
  }
  function drawCitySprite(c, sx, sy, hw, hh, tw) {
    const s = c.size;
    const W2 = hw * s * 0.92, H2 = hh * s * 0.92;
    const wallH = Math.max(3, tw * (c.type === 'main' || c.type === 'branch' ? 0.24 : 0.27));
    let flag = null;
    if (c.type === 'main' || c.type === 'branch') flag = REL_COLOR[relOfPid(c.owner)];
    else if (c.alliance >= 0) flag = Game.G.userId >= 0 ? REL_COLOR[relOfAlli(c.alliance)] : null;
    const art = c.type === 'pass' ? null : cityArt[(c.type === 'main' || c.type === 'branch' || c.type === 'capital' || c.type === 'luoyang') ? 'capital' : 'town'];
    const useArt = tw >= 24 && art && art.complete && art.naturalWidth;
    if (useArt) {
      const width = tw * s * 1.08;
      ctx.fillStyle = 'rgba(25,41,26,.23)';
      ctx.beginPath(); ctx.ellipse(sx + tw * .08, sy + H2 * .42, width * .43, H2 * .8, 0, 0, 6.283); ctx.fill();
      ctx.drawImage(art, sx - width / 2, sy + H2 + tw * .2 - width, width, width);
    } else {
    // Ground shadow and raised stone platform.
    diamond(ctx, sx + tw * 0.08, sy + H2 * 0.18, W2 * 1.08, H2 * 1.08);
    ctx.fillStyle = 'rgba(31,42,26,.28)'; ctx.fill();
    diamond(ctx, sx, sy, W2, H2);
    ctx.fillStyle = c.type === 'pass' ? '#948968' : '#aaab7a';
    ctx.fill();
    diamond(ctx, sx, sy - wallH * 0.3, W2 * 0.78, H2 * 0.78);
    ctx.fillStyle = '#bdac7e'; ctx.fill();
    ctx.strokeStyle = 'rgba(243,224,172,.5)'; ctx.lineWidth = 1; ctx.stroke();
    // 城牆（立體）
    const wallTop = '#d2c49e', wallL = '#9a8b69', wallR = '#726c58';
    ctx.fillStyle = wallL;
    ctx.beginPath(); ctx.moveTo(sx - W2, sy); ctx.lineTo(sx, sy + H2); ctx.lineTo(sx, sy + H2 - wallH); ctx.lineTo(sx - W2, sy - wallH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wallR;
    ctx.beginPath(); ctx.moveTo(sx, sy + H2); ctx.lineTo(sx + W2, sy); ctx.lineTo(sx + W2, sy - wallH); ctx.lineTo(sx, sy + H2 - wallH); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = wallTop; ctx.lineWidth = Math.max(1.2, tw * 0.052);
    diamond(ctx, sx, sy - wallH, W2, H2); ctx.stroke();
    ctx.strokeStyle = 'rgba(74,66,47,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - W2, sy); ctx.lineTo(sx, sy + H2); ctx.lineTo(sx + W2, sy); ctx.stroke();
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
    if (tw >= 22) {
      const grand = c.type === 'main' || c.type === 'branch' || c.type === 'capital' || c.type === 'luoyang';
      const ornate = grand || c.type === 'commandery';
      const roof = ornate ? '#55453d' : '#5b625e';
      // Houses behind the central hall, then a gate and two corner towers.
      drawHall(sx - W2 * 0.42, sy - H2 * 0.3 - wallH * 0.32, tw * 0.3, tw * 0.3, roof, false);
      drawHall(sx + W2 * 0.4, sy - H2 * 0.25 - wallH * 0.32, tw * 0.3, tw * 0.3, roof, false);
      drawHall(sx, sy - H2 * 0.2 - wallH * 0.38, tw * (grand ? 0.8 : 0.55), tw * (grand ? 0.8 : 0.53), roof, ornate);
      if (grand && tw >= 38) drawHall(sx, sy - H2 * 0.24 - wallH * 0.38 - tw * 0.62, tw * 0.46, tw * 0.42, '#514039', true);
      if (s >= 3) {
        drawHall(sx - W2 * 0.38, sy + H2 * 0.28 - wallH * 0.3, tw * 0.29, tw * 0.26, '#5c5d51', false);
        drawHall(sx + W2 * 0.38, sy + H2 * 0.28 - wallH * 0.3, tw * 0.29, tw * 0.26, '#5c5d51', false);
      }
      drawHall(sx - W2 * 0.68, sy + H2 * 0.05 - wallH * 0.35, tw * 0.22, tw * 0.26, '#51544e', false);
      drawHall(sx + W2 * 0.67, sy + H2 * 0.05 - wallH * 0.35, tw * 0.22, tw * 0.26, '#51544e', false);
      ctx.fillStyle = '#514a37';
      ctx.fillRect(sx - tw * 0.13, sy + H2 * 0.68 - wallH, tw * 0.26, wallH * 0.96);
      ctx.fillStyle = '#252a25';
      ctx.fillRect(sx - tw * 0.085, sy + H2 * 0.69 - wallH * 0.65, tw * 0.17, wallH * 0.65);
      drawHall(sx, sy + H2 * 0.58 - wallH, tw * 0.38, tw * 0.27, '#52473f', false);
    }
    }
    // 關口城門
    if (c.type === 'pass' && !useArt) {
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
    if (c.rateAltar) {
      // 祭壇：石台、四角柱與中央火盆，讓地圖上一眼能和要塞區分。
      ctx.fillStyle = '#76654d';
      ctx.beginPath(); ctx.ellipse(sx, sy - s * 0.05, s * 1.15, s * 0.52, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3e3327'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#9a8768';
      for (const dx of [-0.72, 0.72]) for (const dy of [-0.28, 0.28]) ctx.fillRect(sx + s * dx - 1.5, sy + s * dy - s * 0.9, 3, s * 0.9);
      ctx.fillStyle = '#4b3b2b'; ctx.fillRect(sx - s * 0.28, sy - s * 0.62, s * 0.56, s * 0.24);
      ctx.fillStyle = '#d97726'; ctx.beginPath(); ctx.arc(sx, sy - s * 0.72, s * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f5c45e'; ctx.beginPath(); ctx.arc(sx, sy - s * 0.8, s * 0.11, 0, Math.PI * 2); ctx.fill();
      if (cam.tw >= 18) {
        ctx.font = '10px "Noto Serif TC", serif'; ctx.fillStyle = '#ffe9b0'; ctx.textAlign = 'center';
        ctx.fillText('祭壇', sx, sy + s * 0.95);
      }
      return;
    }
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
    const crowded = g.marches.length > 450 && cam.tw < 18;
    const optionalStride = crowded ? Math.max(2, Math.ceil(g.marches.length / 280)) : 1;
    let optionalIndex = 0;
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
      // 大地圖縮遠且後期行軍數暴增時，完整繪出玩家/盟友/威脅，
      // 其他 AI 行軍做抽樣顯示，避免數百上千條虛線每幀重畫造成卡頓。
      if (crowded && !mine && !threat && rel !== 'ally' && (optionalIndex++ % optionalStride) !== 0) continue;
      const [gx, gy] = Game.marchPos(m, t);
      if (typeof RateEarthSystems !== 'undefined' && RateEarthSystems.hidesMarchInFog && RateEarthSystems.hidesMarchInFog(m, gx, gy, u)) continue;
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
