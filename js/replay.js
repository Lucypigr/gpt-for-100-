// 戰鬥回放：戰場畫面（仿率土戰鬥介面）——雙方士兵方陣、武將頭像與兵力、戰法字幕、投射物、傷害數字
// 依戰報的結構化事件逐步重現（行動者、目標、戰法、傷害/治療、狀態、陣亡），可暫停、逐步、調速、跳轉
'use strict';

var Replay = (function () {
  const E = U.esc;
  const SLOT = ['大營', '中軍', '前鋒'];
  const DELAY = { round: 1100, cast: 1000, prep: 700, dmg: 620, heal: 600, buff: 420, st: 480, ev: 500, ctl: 600, dead: 800, end: 1500 };
  const FIGS = 24; // 滿兵時每隊顯示的士兵數
  // 戰場位置（0~1，相對畫布）：我方左下、敵方右上，前鋒靠中間
  const POS = { 0: [0.15, 0.80], 1: [0.27, 0.69], 2: [0.39, 0.59], 3: [0.86, 0.34], 4: [0.74, 0.41], 5: [0.62, 0.49] };

  let rep = null, bt = null, units = null, steps = null, pos = -1, timer = 0, playing = false, speed = 1;
  let el = null, cv = null, ctx = null, bg = null, W = 0, H = 0, dpr = 1, raf = 0;
  let st = null, disp = {}, fxs = [], showDetail = false, showResult = false;
  const imgs = {};

  // ---------- 資料 ----------
  function artOf(name, size) {
    const t = typeof HERO_BY_NAME !== 'undefined' ? HERO_BY_NAME[name] : null;
    return t && t.icon && typeof CardArt !== 'undefined' && CardArt.on ? CardArt.url(t.icon, size) : '';
  }
  function img(name) {
    const url = artOf(name, 'small');
    if (!url) return null;
    let m = imgs[url];
    if (!m) { m = imgs[url] = new Image(); m.onerror = () => { m.bad = true; }; m.src = url; }
    return m.complete && !m.bad && m.naturalWidth ? m : null;
  }
  // 由事件序列重建第 i 步之後的狀態（可倒退、跳轉）
  function stateAt(i) {
    const s = {};
    for (const k in units) s[k] = { n: units[k].start, dead: false, sts: [], prep: '' };
    let round = -1, end = null;
    for (let j = 0; j <= i && j < steps.length; j++) {
      const e = steps[j].e;
      if (e.k === 'round') {
        round = e.r;
        if (e.r >= 2) for (const k in s) s[k].sts = s[k].sts.filter(x => x.left >= 99 || --x.left > 0);
      } else if ((e.k === 'dmg' || e.k === 'heal') && s[e.d]) {
        s[e.d].n = e.n;
        if (e.n > 0) s[e.d].dead = false;
      } else if (e.k === 'dead' && s[e.d]) {
        s[e.d].dead = true; s[e.d].n = 0; s[e.d].sts = []; s[e.d].prep = '';
      } else if ((e.k === 'st' || e.k === 'buff') && s[e.d]) {
        const list = s[e.d].sts.filter(x => x.s !== e.s);
        const bad = e.k === 'st' ? (e.ctl || e.bad) : !e.up;
        list.push({ s: e.s, left: e.dur || 1, bad: bad ? 1 : 0, ctl: e.ctl ? 1 : 0 });
        s[e.d].sts = list;
      } else if (e.k === 'prep' && s[e.a]) {
        s[e.a].prep = e.s;
      } else if (e.k === 'cast' && s[e.a] && s[e.a].prep === e.s) {
        s[e.a].prep = '';
      } else if (e.k === 'end') end = e.w;
    }
    return { s, round, end };
  }

  // ---------- 開關 ----------
  function open(report, battleIdx) {
    rep = report; bt = report.battles[battleIdx];
    units = {};
    for (const u of bt.A) units[u.slot] = Object.assign({ side: 0, seed: u.slot * 7 + 1 }, u);
    for (const u of bt.D) units[3 + u.slot] = Object.assign({ side: 1, seed: u.slot * 11 + 5 }, u);
    steps = [];
    bt.log.forEach((l, i) => { if (l.e) steps.push({ e: l.e, t: l.t, c: l.c, li: i }); });
    pos = -1; fxs = []; showDetail = false; showResult = false;
    if (!el) {
      el = document.createElement('div');
      el.id = 'replay';
      el.addEventListener('click', onClick);
      document.body.appendChild(el);
      window.addEventListener('resize', () => { if (el && !el.classList.contains('hidden')) resize(); });
    }
    el.classList.remove('hidden');
    build();
    resize();
    jump(-1);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    setTimeout(play, 500);
  }
  function close() {
    stop();
    cancelAnimationFrame(raf);
    if (el) el.classList.add('hidden');
  }

  // ---------- HTML 外框 ----------
  function build() {
    const aName = rep.atkName || '進攻方', dName = bt.def || '防守方';
    el.innerHTML = '<div class="rp-stage"><canvas></canvas>' +
      '<div class="rp-top"><div class="rp-tb l"><div class="rp-tbar"><i></i><b></b></div><div class="rp-tn">' + E(aName) + '</div></div>' +
      '<div class="rp-vs">⚔</div>' +
      '<div class="rp-tb r"><div class="rp-tbar"><i></i><b></b></div><div class="rp-tn">' + E(dName) + '</div></div>' +
      '<button class="rp-back" data-rp="close" title="返回（Esc）">↩</button></div>' +
      '<div class="rp-roundtag"></div>' +
      '<div class="rp-caption"></div>' +
      '<div class="rp-ctrl">' +
      '<button data-rp="first" title="回到開頭">⏮</button><button data-rp="prev" title="上一步（←）">◀</button>' +
      '<button data-rp="toggle" class="main"></button>' +
      '<button data-rp="next" title="下一步（→）">▶</button><button data-rp="last" title="跳到結尾">⏭</button>' +
      '<span class="rp-count"></span></div>' +
      '<div class="rp-btns"><button data-rp="result">結算</button><button data-rp="detail">武將詳情</button><button data-rp="speed" class="spd"></button></div>' +
      '<div class="rp-detail hidden"></div><div class="rp-result hidden"></div></div>';
    cv = el.querySelector('canvas');
    ctx = cv.getContext('2d');
  }
  function resize() {
    const r = el.querySelector('.rp-stage').getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, r.width); H = Math.max(240, r.height);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    bg = makeBg();
  }

  // ---------- 背景（天空、遠山、草原沙地）----------
  function makeBg() {
    const c = document.createElement('canvas');
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const horizon = H * 0.26;
    let gr = g.createLinearGradient(0, 0, 0, horizon);
    gr.addColorStop(0, '#b9b49d'); gr.addColorStop(1, '#d6cdac');
    g.fillStyle = gr; g.fillRect(0, 0, W, horizon + 2);
    const rnd = mulberry(7);
    // 兩層遠山
    [[0.7, '#8d8a74', 0.16], [1, '#76735d', 0.1]].forEach(([k, col, amp], li) => {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, horizon + 4);
      let y = horizon - H * amp * 0.5;
      for (let x = 0; x <= W + 20; x += 18) {
        y += (rnd() - 0.5) * H * 0.035 * k;
        y = Math.max(horizon - H * amp, Math.min(horizon - H * 0.02, y));
        g.lineTo(x, y + li * H * 0.03);
      }
      g.lineTo(W, horizon + 4); g.closePath(); g.fill();
    });
    // 地面
    gr = g.createLinearGradient(0, horizon, 0, H);
    gr.addColorStop(0, '#a39871'); gr.addColorStop(0.4, '#8c8058'); gr.addColorStop(1, '#6d6244');
    g.fillStyle = gr; g.fillRect(0, horizon, W, H - horizon);
    // 塵土、草叢、碎石
    for (let i = 0; i < W * H / 260; i++) {
      const x = rnd() * W, y = horizon + Math.pow(rnd(), 0.8) * (H - horizon);
      const s = 0.4 + (y - horizon) / (H - horizon) * 1.6;
      const r = rnd();
      g.fillStyle = r < 0.45 ? 'rgba(60,52,30,0.25)' : r < 0.8 ? 'rgba(200,188,140,0.22)' : 'rgba(90,100,50,0.35)';
      if (r >= 0.8) { g.fillRect(x, y - 2 * s, 0.9 * s, 2.2 * s); g.fillRect(x + 1.4 * s, y - 1.6 * s, 0.9 * s, 1.8 * s); }
      else g.fillRect(x, y, 1.6 * s, 0.9 * s);
    }
    // 淡淡的霧
    gr = g.createLinearGradient(0, horizon - 10, 0, horizon + H * 0.18);
    gr.addColorStop(0, 'rgba(220,210,180,0.55)'); gr.addColorStop(1, 'rgba(220,210,180,0)');
    g.fillStyle = gr; g.fillRect(0, horizon - 10, W, H * 0.2);
    return c;
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- 座標 ----------
  function anchor(k) { const p = POS[k]; return [p[0] * W, p[1] * H]; }
  function scaleAt(y) { return (0.55 + 0.75 * (y / H)) * Math.min(1.25, Math.max(0.7, W / 1000)); }

  // ---------- 繪製 ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!ctx || !st) return;
    // 兵力平滑過渡
    for (const k in units) {
      const tgt = st.s[k].n;
      if (disp[k] === undefined) disp[k] = tgt;
      disp[k] += (tgt - disp[k]) * 0.18;
      if (Math.abs(tgt - disp[k]) < 1) disp[k] = tgt;
    }
    fxs = fxs.filter(f => now - f.t0 < f.dur);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bg, 0, 0, W, H);
    // 由遠到近畫部隊
    const order = Object.keys(units).map(Number).sort((a, b) => POS[a][1] - POS[b][1]);
    for (const k of order) drawSquad(k, now);
    for (const f of fxs) if (f.kind === 'proj') drawProj(f, now);
    for (const k of order) drawBadge(k, now);
    for (const f of fxs) if (f.kind !== 'proj') drawFx(f, now);
    updateHud();
  }
  function offsetOf(k, now) {
    let dx = 0, dy = 0;
    for (const f of fxs) {
      const t = (now - f.t0) / f.dur;
      if (f.kind === 'lunge' && f.a === k) {
        const [ax, ay] = anchor(k), [bx, by] = anchor(f.d);
        const m = Math.sin(Math.min(1, t) * Math.PI) * 0.32;
        dx += (bx - ax) * m; dy += (by - ay) * m;
      } else if (f.kind === 'hit' && f.d === k && t < 1) {
        dx += Math.sin(t * 40) * 4 * (1 - t);
      }
    }
    return [dx, dy];
  }
  function drawSquad(k, now) {
    const u = units[k], s0 = st.s[k];
    const [ax, ay] = anchor(k);
    const [ox, oy] = offsetOf(k, now);
    const cx = ax + ox, cy = ay + oy;
    const sc = scaleAt(ay);
    let n = u.start ? Math.ceil(FIGS * Math.max(0, disp[k]) / u.start) : 0;
    let fade = 1;
    const dying = fxs.find(f => f.kind === 'die' && f.d === k);
    if (dying) { fade = 1 - Math.min(1, (now - dying.t0) / dying.dur); n = Math.max(n, 6); }
    else if (s0.dead) n = 0;
    if (!n) return;
    const hit = fxs.some(f => f.kind === 'hit' && f.d === k && now - f.t0 < 260);
    const rnd = mulberry(u.seed * 131);
    const dir = u.side === 0 ? 1 : -1;
    ctx.globalAlpha = fade;
    // 影子
    ctx.fillStyle = 'rgba(40,32,18,0.28)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 4 * sc, 58 * sc, 16 * sc, -0.35, 0, Math.PI * 2); ctx.fill();
    const figs = [];
    for (let i = 0; i < FIGS; i++) {
      const col = i % 6, row = (i / 6) | 0;
      const jx = (rnd() - 0.5) * 5, jy = (rnd() - 0.5) * 4;
      if (i >= n) continue;
      figs.push([cx + ((col - 2.5) * 13 + row * 7 * dir) * sc + jx * sc, cy + ((row - 1.5) * 8 - (col - 2.5) * 3.2 * dir) * sc + jy * sc, i]);
    }
    figs.sort((a, b) => a[1] - b[1]);
    for (const [x, y, i] of figs) drawFig(x, y, sc, u, dir, now + i * 97, hit);
    ctx.globalAlpha = 1;
  }
  function drawFig(x, y, s, u, dir, t, hit) {
    const body = hit ? '#b8342a' : u.side === 0 ? '#34445e' : '#5e2b22';
    const trim = u.side === 0 ? '#aab6c6' : '#d2a67a';
    const bob = Math.sin(t / 220) * 0.6 * s;
    if (u.troop === '騎') {
      // 馬
      ctx.fillStyle = hit ? '#8a3a2a' : '#5b4430';
      ctx.beginPath(); ctx.ellipse(x, y - 4 * s, 5.5 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x + dir * 4 * s - 1 * s, y - 8 * s, 2 * s, 4 * s);
      ctx.fillStyle = '#3d2e20';
      ctx.fillRect(x - 4 * s, y - 2 * s, 1 * s, 3 * s); ctx.fillRect(x + 3 * s, y - 2 * s, 1 * s, 3 * s);
      y -= 5 * s;
    } else {
      ctx.fillStyle = '#2a2218';
      ctx.fillRect(x - 1.4 * s, y - 3.2 * s, 1 * s, 3.2 * s); ctx.fillRect(x + 0.4 * s, y - 3.2 * s, 1 * s, 3.2 * s);
    }
    ctx.fillStyle = body;
    ctx.fillRect(x - 1.9 * s, y - 8 * s + bob, 3.8 * s, 5 * s);
    ctx.fillStyle = trim;
    ctx.beginPath(); ctx.arc(x, y - 9.4 * s + bob, 1.6 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d9d2c0'; ctx.lineWidth = Math.max(0.6, 0.6 * s);
    ctx.beginPath();
    if (u.troop === '弓') { ctx.arc(x + dir * 2.4 * s, y - 7 * s + bob, 2.6 * s, dir > 0 ? -1.3 : 1.84, dir > 0 ? 1.3 : 4.44); }
    else { ctx.moveTo(x + dir * 1 * s, y - 3 * s + bob); ctx.lineTo(x + dir * 4.5 * s, y - 13 * s + bob); }
    ctx.stroke();
  }
  function drawBadge(k, now) {
    const u = units[k], s0 = st.s[k];
    const [ax, ay] = anchor(k);
    const [ox, oy] = offsetOf(k, now);
    const sc = Math.max(0.85, scaleAt(ay));
    const x = ax + ox * 0.6 - 10 * sc, y = ay + oy * 0.6 - 44 * sc;
    const r = 17 * sc;
    const col = (typeof FACTION_COLOR !== 'undefined' && FACTION_COLOR[u.faction]) || '#6d6177';
    const acting = fxs.some(f => (f.kind === 'lunge' || f.kind === 'aura') && f.a === k);
    ctx.globalAlpha = s0.dead ? 0.55 : 1;
    // 兵力標籤
    const label = String(Math.round(Math.max(0, disp[k])));
    ctx.font = 'bold ' + Math.round(12 * sc) + 'px "Noto Serif TC", serif';
    const lw = ctx.measureText(label).width + 22 * sc;
    ctx.fillStyle = 'rgba(30,20,12,0.82)';
    ctx.fillRect(x + r * 0.6, y - 9 * sc, lw + r * 0.5, 18 * sc);
    ctx.fillStyle = u.side === 0 ? '#5aa0ff' : '#ff6a5a';
    ctx.fillRect(x + r * 0.6, y + 7 * sc, (lw + r * 0.5) * Math.max(0, disp[k]) / (u.start || 1), 2 * sc);
    ctx.fillStyle = '#d8c28e';
    ctx.font = Math.round(10 * sc) + 'px "Noto Serif TC", serif';
    ctx.fillText(u.troop || '', x + r + 3 * sc, y + 4 * sc);
    ctx.fillStyle = s0.dead ? '#aaa' : '#fff2d6';
    ctx.font = 'bold ' + Math.round(12 * sc) + 'px "Noto Serif TC", serif';
    ctx.fillText(label, x + r + 16 * sc, y + 4.5 * sc);
    // 頭像
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.clip();
    const im = img(u.name);
    if (im) ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
    else {
      ctx.fillStyle = '#fff3da'; ctx.font = Math.round(18 * sc) + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
      ctx.textAlign = 'center'; ctx.fillText(u.name.slice(0, 1), x, y + 6 * sc); ctx.textAlign = 'left';
    }
    if (s0.dead) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore();
    ctx.lineWidth = acting ? 3 : 2;
    ctx.strokeStyle = acting ? '#ffd98a' : u.side === 0 ? '#7fb0ff' : '#e0645a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    // 名字、位置、狀態
    ctx.textAlign = 'center';
    ctx.font = Math.round(10.5 * sc) + 'px "Noto Serif TC", serif';
    const nm = SLOT[u.slot] + '・' + u.name;
    const nw = ctx.measureText(nm).width + 8;
    ctx.fillStyle = 'rgba(25,16,8,0.7)'; ctx.fillRect(x - nw / 2, y + r + 2, nw, 14 * sc);
    ctx.fillStyle = s0.dead ? '#999' : '#f0dfb8'; ctx.fillText(nm, x, y + r + 12 * sc);
    let sy = y + r + 18 * sc;
    if (s0.dead) { ctx.fillStyle = '#ff5a4a'; ctx.fillText('潰敗', x, sy + 8 * sc); }
    else {
      const tags = s0.sts.slice(-3).map(z => [z.s + (z.left < 99 ? z.left : ''), z.ctl ? '#8a3aa8' : z.bad ? '#8a4a1a' : '#2f6d33']);
      if (s0.prep) tags.push(['準備【' + s0.prep + '】', '#8c6a1e']);
      ctx.font = Math.round(9.5 * sc) + 'px "Noto Serif TC", serif';
      let tx = x - tags.reduce((w, [t]) => w + ctx.measureText(t).width + 8, 0) / 2;
      for (const [t, c] of tags) {
        const tw = ctx.measureText(t).width + 6;
        ctx.fillStyle = c; ctx.fillRect(tx, sy, tw, 12 * sc);
        ctx.fillStyle = '#fff'; ctx.fillText(t, tx + tw / 2, sy + 9.5 * sc);
        tx += tw + 2;
      }
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
  function badgePos(k) { const [ax, ay] = anchor(k); const sc = Math.max(0.85, scaleAt(ay)); return [ax - 10 * sc, ay - 44 * sc, sc]; }
  function drawProj(f, now) {
    const t = Math.min(1, (now - f.t0) / f.dur);
    const [ax, ay] = anchor(f.a), [bx, by] = anchor(f.d);
    for (let i = 0; i < f.n; i++) {
      const tt = Math.max(0, Math.min(1, t * 1.25 - i * 0.05));
      if (tt <= 0 || tt >= 1) continue;
      const jx = ((i * 37) % 11 - 5) * 3, jy = ((i * 53) % 9 - 4) * 2;
      const x = ax + jx + (bx - ax) * tt, y = ay - 10 + jy + (by - ay) * tt - Math.sin(tt * Math.PI) * 60;
      if (f.style === 'int') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, 'rgba(210,235,255,1)'); g.addColorStop(1, 'rgba(80,140,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      } else if (f.style === 'fire') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 8);
        g.addColorStop(0, 'rgba(255,240,160,1)'); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      } else {
        const dx = (bx - ax), dy = (by - ay) - Math.cos(tt * Math.PI) * 60 * Math.PI;
        const L = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = '#3b2d1c'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dx / L * 9, y - dy / L * 9); ctx.stroke();
      }
    }
  }
  function drawFx(f, now) {
    const t = Math.min(1, (now - f.t0) / f.dur);
    if (f.kind === 'float') {
      const [x, y, sc] = badgePos(f.d);
      ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, t - 0.6) / 0.4;
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + Math.round((f.big ? 22 : 15) * sc) + 'px "Noto Serif TC", serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const yy = y - 26 * sc - t * 34 - (f.row || 0) * 18;
      ctx.strokeText(f.text, x + (f.dx || 0), yy); ctx.fillStyle = f.color; ctx.fillText(f.text, x + (f.dx || 0), yy);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    } else if (f.kind === 'aura') {
      const [ax, ay] = anchor(f.a); const sc = scaleAt(ay);
      ctx.strokeStyle = 'rgba(255,215,120,' + (1 - t) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(ax, ay + 4 * sc, (40 + t * 40) * sc, (12 + t * 12) * sc, -0.35, 0, Math.PI * 2); ctx.stroke();
    } else if (f.kind === 'heal') {
      const [ax, ay] = anchor(f.d); const sc = scaleAt(ay);
      for (let i = 0; i < 14; i++) {
        const x = ax + ((i * 29) % 70 - 35) * sc, y = ay - ((i * 17) % 20) * sc - t * 40 * sc;
        ctx.fillStyle = 'rgba(120,255,140,' + (1 - t) + ')'; ctx.fillRect(x, y, 2.5 * sc, 2.5 * sc);
      }
    } else if (f.kind === 'burn') {
      const [ax, ay] = anchor(f.d); const sc = scaleAt(ay);
      for (let i = 0; i < 10; i++) {
        const x = ax + ((i * 31) % 80 - 40) * sc, y = ay - ((i * 13) % 12) * sc - t * 20 * sc;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7 * sc);
        g.addColorStop(0, 'rgba(255,220,120,' + (1 - t) + ')'); g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7 * sc, 0, Math.PI * 2); ctx.fill();
      }
    } else if (f.kind === 'banner') {
      // 戰法字幕：頭像＋戰法名
      const [x, y, sc] = badgePos(f.a);
      const a = t < 0.12 ? t / 0.12 : 1 - Math.max(0, t - 0.75) / 0.25;
      ctx.globalAlpha = a;
      ctx.font = 'bold ' + Math.round(19 * sc) + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
      const tw = ctx.measureText(f.text).width;
      const bw = tw + 58 * sc, bh = 34 * sc;
      const bx = Math.min(W - bw - 6, Math.max(6, x - bw / 2 + 20 * sc)), by = y - 70 * sc;
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, 'rgba(60,20,70,0.92)'); g.addColorStop(1, 'rgba(120,60,110,0.85)');
      ctx.fillStyle = g; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = f.q === 'S' ? '#ff9a4a' : '#e8c77a'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
      const u = units[f.a];
      ctx.save(); ctx.beginPath(); ctx.arc(bx + 19 * sc, by + bh / 2, 14 * sc, 0, Math.PI * 2); ctx.clip();
      const im = img(u.name);
      ctx.fillStyle = (typeof FACTION_COLOR !== 'undefined' && FACTION_COLOR[u.faction]) || '#6d6177';
      ctx.fillRect(bx, by, 38 * sc, bh);
      if (im) ctx.drawImage(im, bx + 5 * sc, by + bh / 2 - 14 * sc, 28 * sc, 28 * sc);
      else { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = Math.round(15 * sc) + 'px serif'; ctx.fillText(u.name.slice(0, 1), bx + 19 * sc, by + bh / 2 + 5 * sc); ctx.textAlign = 'left'; }
      ctx.restore();
      ctx.font = 'bold ' + Math.round(19 * sc) + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
      ctx.fillStyle = '#fff1c8'; ctx.fillText(f.text, bx + 42 * sc, by + bh / 2 + 7 * sc);
      ctx.globalAlpha = 1;
    } else if (f.kind === 'center') {
      const a = t < 0.15 ? t / 0.15 : 1 - Math.max(0, t - 0.6) / 0.4;
      ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.font = 'bold ' + Math.round(Math.min(W / 12, 46)) + 'px "LXGW WenKai TC", "Noto Serif TC", serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,15,5,0.8)';
      ctx.strokeText(f.text, W / 2, H * 0.52); ctx.fillStyle = f.color || '#ffe3a0'; ctx.fillText(f.text, W / 2, H * 0.52);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }

  // ---------- 事件動畫 ----------
  function addFx(kind, o, dur) { fxs.push(Object.assign({ kind, t0: performance.now(), dur: dur / Math.sqrt(speed) }, o)); }
  function floatAt(k, text, color, big) {
    const same = fxs.filter(f => f.kind === 'float' && f.d === k).length;
    addFx('float', { d: k, text, color, big, row: same % 3, dx: (same % 2 ? 14 : -6) }, 1300);
  }
  function animate(e) {
    const u = e.a !== undefined ? units[e.a] : null;
    if (e.k === 'round') addFx('center', { text: e.r === 0 ? '準備回合' : '第 ' + e.r + ' 回合' }, 1100);
    else if (e.k === 'cast') { addFx('banner', { a: e.a, text: e.s, q: e.q }, 1300); addFx('aura', { a: e.a }, 800); }
    else if (e.k === 'prep') floatAt(e.a, '準備【' + e.s + '】', '#ffd98a');
    else if (e.k === 'dmg') {
      if (e.a !== undefined && !e.dot) {
        const ranged = e.t === 1 || (u && u.troop === '弓') || e.s !== '普通攻擊' && e.s !== '反擊';
        if (ranged && e.a !== e.d) addFx('proj', { a: e.a, d: e.d, n: e.t === 1 ? 4 : 7, style: e.t === 1 ? (/火|焚|燒/.test(e.s) ? 'fire' : 'int') : 'arrow' }, 520);
        else if (e.a !== e.d) addFx('lunge', { a: e.a, d: e.d }, 520);
      }
      if (e.dot) addFx('burn', { d: e.d }, 700);
      setTimeout(() => { addFx('hit', { d: e.d }, 380); floatAt(e.d, '-' + e.v, e.dot ? '#ff9a4a' : e.t === 1 ? '#8fc0ff' : '#ff5a4a', e.v >= 500); }, e.a !== undefined && !e.dot ? 260 / Math.sqrt(speed) : 0);
    } else if (e.k === 'heal') { addFx('heal', { d: e.d }, 900); floatAt(e.d, '+' + e.v, '#7dff8a'); }
    else if (e.k === 'st') floatAt(e.d, e.s, e.ctl || e.bad ? '#e3a6ff' : '#9ef0a0');
    else if (e.k === 'buff') floatAt(e.d, e.s, e.up ? '#9ef0a0' : '#ffb08a');
    else if (e.k === 'ev') floatAt(e.d, e.s || '規避', '#f0f0f0');
    else if (e.k === 'ctl') floatAt(e.a, e.s, '#e3a6ff');
    else if (e.k === 'dead') { addFx('die', { d: e.d }, 800); floatAt(e.d, '潰敗', '#ff4a3a', true); }
    else if (e.k === 'end') addFx('center', { text: e.w === 'atk' ? '進攻方勝利' : e.w === 'def' ? '防守方勝利' : '平局', color: e.w === 'draw' ? '#f0e6c8' : '#ffd24a' }, 2200);
  }

  // ---------- HUD ----------
  function updateHud() {
    let a = 0, as = 0, d = 0, ds = 0;
    for (const k in units) { const u = units[k]; if (u.side === 0) { a += Math.max(0, disp[k]); as += u.start; } else { d += Math.max(0, disp[k]); ds += u.start; } }
    const bars = el.querySelectorAll('.rp-tbar');
    bars[0].querySelector('i').style.width = (as ? a / as * 100 : 0) + '%';
    bars[0].querySelector('b').textContent = Math.round(a) + ' / ' + as;
    bars[1].querySelector('i').style.width = (ds ? d / ds * 100 : 0) + '%';
    bars[1].querySelector('b').textContent = Math.round(d) + ' / ' + ds;
  }
  function renderUi() {
    el.querySelector('.rp-roundtag').textContent = st.round < 0 ? '戰鬥開始' : st.round === 0 ? '準備回合' : '第 ' + st.round + ' / 8 回合';
    const cur = steps[pos];
    el.querySelector('.rp-caption').innerHTML = cur ? '<span class="' + cur.c + '">' + E(cur.t) + '</span>' : '';
    el.querySelector('[data-rp="toggle"]').textContent = playing ? '⏸' : (pos >= steps.length - 1 ? '↻' : '▶');
    el.querySelector('.spd').textContent = '▶▶ ×' + speed;
    el.querySelector('.rp-count').textContent = Math.max(0, pos + 1) + '/' + steps.length;
    const det = el.querySelector('.rp-detail');
    det.classList.toggle('hidden', !showDetail);
    if (showDetail) {
      const row = k => {
        const u = units[k]; if (!u) return '';
        const s = st.s[k];
        return '<tr class="' + (s.dead ? 'dead' : '') + '"><td>' + (u.side ? '敵' : '我') + '・' + SLOT[u.slot] + '</td><td>' + E(u.name) + ' <small>Lv' + u.lv + ' ' + E(u.troop || '') + '</small></td><td>' + Math.max(0, s.n) + '/' + u.start + '</td><td>' +
          (s.dead ? '<span class="bad">潰敗</span>' : s.sts.map(z => '<span class="tag ' + (z.ctl ? 'ctl' : z.bad ? 'bad' : 'good') + '">' + E(z.s) + (z.left < 99 ? z.left : '') + '</span>').join('') + (s.prep ? '<span class="tag prep">準備' + E(s.prep) + '</span>' : '')) + '</td></tr>';
      };
      det.innerHTML = '<table>' + [0, 1, 2, 3, 4, 5].map(row).join('') + '</table><div class="rp-log">' +
        steps.map((x, i) => '<div class="' + x.c + (i === pos ? ' cur' : '') + '" data-rp="goto" data-i="' + i + '">' + E(x.t) + '</div>').join('') + '</div>';
      const c = det.querySelector('.rp-log .cur');
      if (c) { const box = det.querySelector('.rp-log'); box.scrollTop = c.offsetTop - box.offsetTop - box.clientHeight / 2; }
    }
    const res = el.querySelector('.rp-result');
    res.classList.toggle('hidden', !showResult);
    if (showResult) {
      const fin = stateAt(steps.length - 1);
      const w = bt.winner === 'atk' ? '進攻方勝利' : bt.winner === 'def' ? '防守方勝利' : '平局';
      const side = sd => '<div class="col"><div class="hd">' + (sd ? E(bt.def) : E(rep.atkName)) + '</div>' + [0, 1, 2].map(sl => {
        const k = sd * 3 + sl, u = units[k]; if (!u) return '';
        const n = Math.max(0, fin.s[k].n);
        return '<div class="ln"><span>' + SLOT[sl] + '・' + E(u.name) + '</span><span>' + n + '/' + u.start + ' <span class="bad">-' + (u.start - n) + '</span></span></div>';
      }).join('') + '</div>';
      res.innerHTML = '<div class="ttl">' + w + '</div><div class="muted">共 ' + bt.rounds + ' 回合</div><div class="cols">' + side(0) + side(1) + '</div>' +
        '<button data-rp="replay">↻ 重看</button> <button data-rp="close">返回戰報</button>';
    }
  }

  // ---------- 播放控制 ----------
  function jump(i) {
    pos = Math.max(-1, Math.min(steps.length - 1, i));
    st = stateAt(pos);
    for (const k in units) disp[k] = st.s[k].n;
    fxs = [];
    renderUi();
  }
  function stepFwd() {
    if (pos >= steps.length - 1) return;
    pos++;
    st = stateAt(pos);
    animate(steps[pos].e);
    renderUi();
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing) return;
    if (pos >= steps.length - 1) { playing = false; showResult = true; renderUi(); return; }
    const wait = pos < 0 ? 300 : (DELAY[steps[pos].e.k] || 500);
    timer = setTimeout(() => { stepFwd(); schedule(); }, wait / speed);
  }
  function play() { if (!el || el.classList.contains('hidden')) return; if (pos >= steps.length - 1) jump(-1); showResult = false; playing = true; renderUi(); schedule(); }
  function stop() { playing = false; clearTimeout(timer); }
  function toggle() { if (playing) { stop(); renderUi(); } else play(); }

  function onClick(ev) {
    const t = ev.target.closest('[data-rp]');
    if (!t) return;
    const act = t.dataset.rp;
    if (act === 'close') close();
    else if (act === 'toggle') toggle();
    else if (act === 'next') { stop(); stepFwd(); }
    else if (act === 'prev') { stop(); jump(pos - 1); }
    else if (act === 'first') { stop(); jump(-1); }
    else if (act === 'last') { stop(); jump(steps.length - 1); }
    else if (act === 'speed') { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; renderUi(); if (playing) schedule(); }
    else if (act === 'detail') { showDetail = !showDetail; renderUi(); }
    else if (act === 'result') { stop(); jump(steps.length - 1); showResult = true; renderUi(); }
    else if (act === 'replay') { showResult = false; jump(-1); play(); }
    else if (act === 'goto') { stop(); jump(+t.dataset.i - 1); stepFwd(); }
  }
  document.addEventListener('keydown', e => {
    if (!el || el.classList.contains('hidden')) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    // 回放開啟時攔下快捷鍵，避免地圖同時平移或暫停遊戲
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === ' ') toggle();
    else if (e.key === 'ArrowRight') { stop(); stepFwd(); }
    else if (e.key === 'ArrowLeft') { stop(); jump(pos - 1); }
  }, true);

  function canReplay(battle) { return !!(battle && battle.log && battle.log.some(l => l.e)); }
  return { open, close, canReplay };
})();
