// 天氣/災害地圖視覺層：只負責呈現，不改戰鬥數值
'use strict';

var WeatherVisuals = (function () {
  if (typeof window === 'undefined' || typeof Render === 'undefined') return {};
  const cv = document.getElementById('map');
  if (!cv) return {};
  const ctx = cv.getContext('2d');
  const baseDraw = Render.draw;
  let frame = 0;

  function diamond(x, y, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(x, y - hh); ctx.lineTo(x + hw, y); ctx.lineTo(x, y + hh); ctx.lineTo(x - hw, y); ctx.closePath();
  }
  function rgba(kind, a) {
    if (kind === 'fog') return 'rgba(210,215,210,' + a + ')';
    if (kind === 'snow' || kind === 'blizzard') return 'rgba(235,246,255,' + a + ')';
    if (kind === 'ice' || kind === 'freezing_rain') return 'rgba(155,220,235,' + a + ')';
    if (kind === 'flood' || kind === 'storm') return 'rgba(65,145,195,' + a + ')';
    if (kind === 'sandstorm') return 'rgba(190,145,85,' + a + ')';
    if (kind === 'windstorm') return 'rgba(190,205,210,' + a + ')';
    return 'rgba(255,255,255,' + a + ')';
  }
  function currentCameraTile() {
    const x = Math.max(0, Math.min(World.N - 1, Math.round(Render.cam.cx)));
    const y = Math.max(0, Math.min(World.N - 1, Math.round(Render.cam.cy)));
    return World.idx(x, y);
  }
  function drawRegularWeather(now) {
    const i = currentCameraTile();
    const w = RateEarthSystems.weatherAt(i);
    const W = cv.clientWidth || innerWidth, H = cv.clientHeight || innerHeight;
    if (/snow/.test(w.id)) {
      const n = w.id === 'heavy_snow' ? 42 : w.id === 'mid_snow' ? 28 : 18;
      ctx.save(); ctx.fillStyle = 'rgba(245,250,255,.58)';
      for (let k = 0; k < n; k++) {
        const x = (k * 97 + now * (0.012 + (k % 4) * .002)) % (W + 30) - 15;
        const y = (k * 53 + now * (0.025 + (k % 5) * .002)) % (H + 30) - 15;
        ctx.beginPath(); ctx.arc(x, y, 1 + (k % 3) * .45, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (/rain/.test(w.id) || w.id === 'shower') {
      const n = w.id === 'heavy_rain' ? 46 : w.id === 'mid_rain' ? 32 : 20;
      ctx.save(); ctx.strokeStyle = 'rgba(180,215,235,.32)'; ctx.lineWidth = 1;
      for (let k = 0; k < n; k++) {
        const x = (k * 83 + now * .035) % (W + 40) - 20;
        const y = (k * 47 + now * .075) % (H + 40) - 20;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 12); ctx.stroke();
      }
      ctx.restore();
    }
  }
  let eventCacheMinute = -1, eventCache = [];
  function activeEvents() {
    const t = Game.G.time;
    if (eventCacheMinute === t) return eventCache;
    const day = Math.floor(t / 1440), seed = Game.G.seed || 1, out = [];
    for (let st = 0; st < World.states.length; st++) {
      for (const d of [day, day - 1]) {
        const a = RateEarthSystems.specialEventForState(d, st, seed);
        const b = RateEarthSystems.windEventForState ? RateEarthSystems.windEventForState(d, st, seed) : null;
        for (const ev of [a, b]) if (ev && t >= ev.start && t < ev.hazardEnd) out.push(ev);
      }
    }
    eventCacheMinute = t; eventCache = out;
    return out;
  }
  function onView(ev) {
    const p = Render.toScreen(World.X(ev.center) + .5, World.Y(ev.center) + .5);
    const px = ev.radius * Render.cam.tw;
    return p[0] > -px && p[0] < innerWidth + px && p[1] > -px && p[1] < innerHeight + px;
  }
  function drawFrozenRivers(ev) {
    const t = Game.G.time;
    if (t < ev.hazardStart || t >= ev.hazardEnd || (ev.hazard !== 'snow' && ev.hazard !== 'ice')) return;
    const cx = World.X(ev.center), cy = World.Y(ev.center), r = ev.radius;
    const hw = Render.cam.tw / 2, hh = Render.cam.tw / 4;
    ctx.save();
    for (let y = Math.max(0, cy - r); y <= Math.min(World.N - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(World.N - 1, cx + r); x++) {
        const i = World.idx(x, y);
        if (Game.T.terrain[i] !== TERRAIN.WATER || !RateEarthSystems.isFrozenRiver(i)) continue;
        const s = Render.toScreen(x + .5, y + .5);
        diamond(s[0], s[1], hw, hh);
        ctx.fillStyle = 'rgba(220,245,255,.62)'; ctx.fill();
        ctx.strokeStyle = 'rgba(245,255,255,.72)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawEvent(ev, now) {
    if (!onView(ev)) return;
    const t = Game.G.time, hz = t >= ev.hazardStart ? ev.hazard : ev.type;
    const s = Render.toScreen(World.X(ev.center) + .5, World.Y(ev.center) + .5);
    const rx = Math.max(30, ev.radius * Render.cam.tw * .72);
    const ry = Math.max(18, ev.radius * Render.cam.tw * .36);
    ctx.save();
    const g = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], rx);
    g.addColorStop(0, rgba(hz, hz === 'fog' ? .22 : .14));
    g.addColorStop(.7, rgba(hz, hz === 'fog' ? .14 : .08));
    g.addColorStop(1, rgba(hz, 0));
    ctx.translate(s[0], s[1]); ctx.scale(1, ry / rx); ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.setTransform(1,0,0,1,0,0);

    if (hz === 'sandstorm' || hz === 'windstorm') {
      const dir = ev.wind && ev.wind.dir ? ev.wind.dir : { dx: 1, dy: 0 };
      ctx.strokeStyle = rgba(hz, .38); ctx.lineWidth = 1.2;
      for (let k = 0; k < 18; k++) {
        const ox = s[0] - rx + ((k * 67 + now * .05) % (rx * 2));
        const oy = s[1] - ry + ((k * 41 + now * .018) % (ry * 2));
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dir.dx * 28 + 22, oy + dir.dy * 12 + 4); ctx.stroke();
      }
    } else if (hz === 'flood' || hz === 'storm') {
      ctx.strokeStyle = 'rgba(190,225,245,.4)'; ctx.lineWidth = 1;
      for (let k = -2; k <= 2; k++) {
        const yy = s[1] + k * 10 + Math.sin(now / 350 + k) * 3;
        ctx.beginPath(); ctx.moveTo(s[0] - rx * .45, yy); ctx.quadraticCurveTo(s[0], yy - 5, s[0] + rx * .45, yy); ctx.stroke();
      }
    }
    ctx.restore();
    drawFrozenRivers(ev);
  }
  function draw(now) {
    if (typeof Game === 'undefined' || !Game.G || !Game.P || !Game.P.length || typeof RateEarthSystems === 'undefined') return;
    drawRegularWeather(now);
    for (const ev of activeEvents()) drawEvent(ev, now);
    frame++;
  }
  Render.draw = function (now) {
    baseDraw(now);
    draw(now);
  };
  return { draw };
})();
