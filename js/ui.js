// 介面：HUD、土地彈窗、各功能面板、聊天、提示
'use strict';

var UI = (function () {
  const $ = s => document.querySelector(s);
  const E = U.esc;
  // 內嵌頁面中 confirm() 會被封鎖，此時直接視為確定
  const ask = m => (window.self !== window.top) || window.confirm(m);
  let G = null, user = null;
  let chatTab = 'world', chatSeen = -1, chatTabSeen = '';
  let panel = null, panelArg = null, panelTab = null, lastPanelRefresh = 0;
  let tileSel = -1, tilePopMode = 'info';
  let heroSel = 0, heroFilter = 'all';
  let repSel = 0;
  let teamPick = null; // {ti, slot}
  let noticeSeen = 0;
  let selTeam = -1;
  let lastHud = 0;
  let drawResult = null;

  // ================= 啟動 =================
  function init() {
    const sel = $('#in-state');
    STATE_DEFS.forEach((s, i) => { if (s.type === 'birth') sel.insertAdjacentHTML('beforeend', '<option value="' + i + '">' + s.name + '</option>'); });
    sel.selectedIndex = Math.floor(Math.random() * sel.options.length);
    if (Game.hasSave()) {
      $('#start-continue').classList.remove('hidden');
      try {
        const meta = JSON.parse(localStorage.getItem('stzb_meta') || '{}');
        if (meta.name) $('.save-info').textContent = '存檔：' + meta.name + '・' + (meta.clock || '') + '・' + (meta.saved || '');
      } catch (e) { /* */ }
    }
    fillHist('#start-hist-list');
    let auto = false;
    try { auto = sessionStorage.getItem('stzb_autocontinue') === '1'; sessionStorage.removeItem('stzb_autocontinue'); } catch (e) { /* */ }
    if (auto && Game.hasSave()) setTimeout(continueGame, 0);
    document.addEventListener('click', onClick);
    $('#chatform').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    bindMap();
    document.addEventListener('keydown', onKey);
  }

  function startNew() {
    const name = ($('#in-name').value || '無名主公').trim().slice(0, 10);
    const st = +$('#in-state').value;
    const ai = +$('#in-ai').value;
    $('#loading').classList.remove('hidden');
    setTimeout(() => {
      Game.newGame({ userName: name, userState: st, aiCount: ai });
      enterGame();
      Game.save();
      saveMeta();
      toast('歡迎主公【' + name + '】！你的主城位於' + World.states[Game.P[0].state].name + '。先派第一部隊佔領主城周圍的土地吧！', 'good');
      setTimeout(() => openPanel('help'), 400);
    }, 60);
  }
  function continueGame() {
    $('#loading').classList.remove('hidden');
    setTimeout(() => {
      const r = Game.load();
      if (!r) { $('#loading').classList.add('hidden'); alert('讀取存檔失敗'); return; }
      enterGame();
      toast('歡迎回來，主公！天下局勢繼續。', 'good');
    }, 60);
  }
  function enterGame() {
    G = Game.G; user = Game.P[G.userId];
    Render.buildTerrain();
    Render.initMini($('#mini'));
    Render.centerOn(user.cityTile, 56);
    $('#start').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    buildSpeed();
    noticeSeen = G.notices.length;
    chatSeen = -1;
    main.started = true;
  }
  // ================= 存檔紀錄 =================
  function snapshot(kind) {
    if (!G || typeof SaveHist === 'undefined') return Promise.resolve(null);
    try {
      return SaveHist.add({ name: user.name, clock: U.fmtClock(G.time), day: Game.day() + 1, kind }, Game.serialize()).catch(e => { console.warn('snapshot failed', e); return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function fillHist(sel) {
    const box = $(sel);
    if (!box) return;
    if (typeof SaveHist === 'undefined') { box.textContent = '此環境不支援存檔紀錄'; return; }
    SaveHist.list().then(list => {
      const wrap = box.closest('#start-hist');
      if (wrap) wrap.classList.toggle('hidden', !list.length);
      box.innerHTML = list.length ? list.map(x => '<div class="hist-row"><span class="hist-kind k-' + x.kind + '">' + (SaveHist.KIND_NAME[x.kind] || x.kind) + '</span><span class="hist-main"><b>' + E(x.name) + '</b>　' + E(x.clock) + '<br><span class="muted">' + new Date(x.at).toLocaleString() + '　' + Math.round(x.size / 1024) + ' KB</span></span>' +
        '<button class="btn small gold" data-act="histload" data-id="' + x.id + '">讀取</button> <button class="btn small dark" data-act="histdel" data-id="' + x.id + '">刪除</button></div>').join('') : '<div class="muted">尚無存檔紀錄。手動存檔、每過一個遊戲日、重開賽季前都會自動保留一份。</div>';
    }).catch(() => { box.textContent = '此瀏覽器無法使用存檔紀錄（IndexedDB 被停用）'; });
  }
  function loadHist(id) {
    SaveHist.get(id).then(str => {
      if (!str) { toast('找不到這份存檔', 'bad'); return; }
      try { localStorage.setItem('stzb_save', str); } catch (e) { toast('儲存空間不足，無法讀取', 'bad'); return; }
      try { localStorage.removeItem('stzb_meta'); sessionStorage.setItem('stzb_autocontinue', '1'); } catch (e) { /* */ }
      main.started = false; // 避免離開頁面時把目前進度蓋回去
      location.reload();
    }).catch(() => toast('讀取存檔紀錄失敗', 'bad'));
  }

  function saveMeta() {
    try { localStorage.setItem('stzb_meta', JSON.stringify({ name: user.name, clock: U.fmtClock(G.time), saved: new Date().toLocaleString() })); } catch (e) { /* */ }
  }

  // ================= HUD =================
  function buildSpeed() {
    const sp = [0, 1, 2, 5, 10, 20];
    $('#speed').innerHTML = sp.map(v => '<button data-act="speed" data-v="' + v + '">' + (v === 0 ? '暫停' : v + '×') + '</button>').join('');
  }
  function update(now) {
    if (!G) return;
    if (now - lastHud > 200) { lastHud = now; hudTop(); hudTeams(); hudAlert(); hudQuest(); hudBadges(); }
    hudChat();
    hudToasts();
    if (panel && now - lastPanelRefresh > 1000 && !$('#modal').classList.contains('hidden')) {
      lastPanelRefresh = now;
      if (['city', 'teams', 'season', 'alliance', 'quests'].includes(panel) && !teamPick) refreshPanel(true);
    }
    if (tileSel >= 0 && now - (update.tp || 0) > 1000) { update.tp = now; if (tilePopMode === 'info') renderTilePop(); }
    if (G.over && !update.shownOver) { update.shownOver = true; openPanel('settle'); }
  }
  function hudTop() {
    $('.lord-name').textContent = user.name;
    $('#fame').innerHTML = '名望 <b>' + U.fmt(user.fame) + '</b>';
    $('#power').innerHTML = '勢力 <b>' + U.fmt(user.power) + '</b>';
    $('#lands').innerHTML = '領地 <b>' + user.landCount + '/' + user.landCap + '</b>';
    const a = user.alliance >= 0 ? G.alliances[user.alliance] : null;
    $('#alli-tag').innerHTML = a ? '同盟 <b style="color:' + a.color + '">' + E(a.name) + '</b>' : '<span class="warn">未加入同盟</span>';
    let h = '';
    for (const r of CFG.RES) {
      const full = user.res[r] >= user.cap * 0.99;
      h += '<div class="res' + (full ? ' full' : '') + '" title="' + CFG.RES_NAME[r] + '：' + Math.floor(user.res[r]) + '/' + user.cap + '"><i class="ri ' + r + '">' + CFG.RES_SHORT[r] + '</i><b>' + U.fmt(user.res[r]) + '</b><small>+' + U.fmt(user.prod[r]) + '</small></div>';
    }
    const rcap = CFG.reserveCap(user.b.recruit);
    h += '<div class="res' + (user.reserve >= rcap * 0.99 ? ' full' : '') + '" title="預備兵：征兵需消耗預備兵（' + Math.floor(user.reserve) + '/' + rcap + '），募兵所可提高產量與上限"><i class="ri reserve">兵</i><b>' + U.fmt(user.reserve) + '</b><small>+' + U.fmt(CFG.reserveProd(user.b.recruit)) + '</small></div>';
    h += '<div class="res" title="戰法點：用於升級戰法，可由武將轉化取得"><i class="ri skp">法</i><b>' + U.fmt(user.skp) + '</b></div>';
    h += '<div class="res" title="銅幣"><i class="ri copper">銅</i><b>' + U.fmt(user.copper) + '</b><small>+' + U.fmt(user.prod.copper) + '</small><button class="btn small plus" data-act="open" data-panel="recharge" title="儲值">+</button></div>';
    h += '<div class="res" title="金銖"><i class="ri gold">金</i><b>' + U.fmt(user.gold) + '</b><button class="btn small plus" data-act="open" data-panel="recharge" title="儲值">+</button></div>';
    $('#resbar').innerHTML = h;
    const ph = Game.phase();
    $('#clock-time').textContent = U.fmtClock(G.time);
    $('#clock-phase').textContent = '賽季 ' + (Game.day() + 1) + '/' + CFG.SEASON_DAYS + ' 天・' + ph.name;
    document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', G.paused ? +b.dataset.v === 0 : +b.dataset.v === G.speed));
    const gx = U.clamp(Math.floor(Render.cam.cx), 0, World.N - 1), gy = U.clamp(Math.floor(Render.cam.cy), 0, World.N - 1);
    $('#coord').textContent = '(' + gx + ',' + gy + ') ' + World.states[Game.T.state[World.idx(gx, gy)]].name + (user.captor >= 0 ? '　⚠ 淪陷中' : G.time < user.protectEnd ? '　主城保護中' : '');
  }
  const MARCH_NAME = { attack: '出征', return: '回城', move: '調動', garrison: '駐守', farm: '屯田', train: '練兵', sweep: '掃蕩' };
  function statusText(p, t) {
    if (t.rq) return ['recruit', '征兵 ' + U.fmtDur(t.rq.end - G.time)];
    if (t.status === 'march') {
      const m = G.marches.find(x => x.id === t.march);
      if (m) return [m.type === 'return' ? 'back' : 'march', (MARCH_NAME[m.type] || '駐守') + ' ' + U.fmtDur(m.end - G.time)];
    }
    if (t.status === 'garrison') return ['garrison', '駐守(' + World.X(t.gtile) + ',' + World.Y(t.gtile) + ')'];
    if (t.status === 'train') return ['garrison', '練兵 ' + U.fmtDur(t.trainEnd - G.time)];
    if (Game.isHome(p, t.base) && Game.teamWounded(p, t) > 0) return ['recruit', '治療 ' + U.fmtDur(Game.healTime(p, t))];
    if (t.base !== user.cityTile) return ['', '駐紮(' + World.X(t.base) + ',' + World.Y(t.base) + ')'];
    if (Game.teamWounded(p, t) > 0) return ['recruit', '治療 ' + U.fmtDur(Game.healTime(p, t))];
    return ['', '待命'];
  }
  // 兵力條：實兵 + 傷兵（斜紋）
  function troopBar(troops, wnd, cap, style) {
    return '<div class="bar wb"' + (style ? ' style="' + style + '"' : '') + '><i style="width:' + (cap ? troops / cap * 100 : 0) + '%"></i>' + (wnd > 0 ? '<i class="w" style="width:' + (wnd / cap * 100) + '%"></i>' : '') + '</div>';
  }
  function hudTeams() {
    let h = '';
    user.teams.forEach((t, ti) => {
      const hs = Game.teamHeroes(user, t);
      const troops = Game.teamTroops(user, t), cap = Game.teamCapTroops(user, t);
      const [cls, st] = statusText(user, t);
      h += '<div class="tcard' + (selTeam === ti ? ' sel' : '') + '" data-act="teamcard" data-ti="' + ti + '">';
      h += '<div class="th"><span class="tn">第' + '一二三四五'[ti] + '部隊</span><span class="ts ' + cls + '">' + st + '</span></div>';
      h += '<div class="heroes">' + [2, 1, 0].map(s => {
        const x = hs[s];
        if (!x) return '<div class="mini-hero empty">' + Battle.SLOT_NAME[s] + '</div>';
        const tp = Game.tpl(x);
        return '<div class="mini-hero" style="background-color:' + FACTION_COLOR[tp.faction] + faceStyle(tp) + '">' + tp.name + '<span class="lv">Lv' + x.lv + ' ' + tp.troop + '</span></div>';
      }).join('') + '</div>';
      const wnd = Game.teamWounded(user, t);
      h += troopBar(troops, wnd, cap);
      h += '<div class="tinfo"><span>兵 ' + U.fmt(troops) + '/' + U.fmt(cap) + (wnd > 0 ? ' <span class="wtxt">傷' + U.fmt(wnd) + '</span>' : '') + '</span><span>體力 ' + Math.floor(Game.teamMinSta(user, t)) + '</span></div>';
      h += '</div>';
    });
    $('#teampanel').innerHTML = h;
  }
  function hudAlert() {
    const threats = G.marches.filter(m => m.type === 'attack' && m.pid !== user.id && Game.tileOwner(m.to) === user.id);
    const el = $('#alert');
    if (threats.length) {
      const m = threats.sort((a, b) => a.end - b.end)[0];
      const isMain = Game.T.city[m.to] >= 0 && World.cities[Game.T.city[m.to]].type === 'main';
      el.innerHTML = '⚠ ' + threats.length + ' 支敵軍來襲！' + (isMain ? '<b>主城</b>' : '') + ' 最快 ' + U.fmtDur(m.end - G.time) + ' 後抵達 (' + World.X(m.to) + ',' + World.Y(m.to) + ')';
      el.dataset.tile = m.to;
      el.classList.remove('hidden');
    } else el.classList.add('hidden');
  }
  function hudQuest() {
    const q = QUESTS.find(q => !user.quests[q.id]);
    const el = $('#quest-mini');
    if (!q) { el.classList.add('hidden'); return; }
    const done = q.check(user);
    el.innerHTML = '<div class="qt">主線：' + q.name + '</div><div class="' + (done ? 'done' : 'muted') + '">' + q.desc + (done ? '　✔ 可領取' : '') + '</div>';
    el.dataset.act = 'open'; el.dataset.panel = 'quests';
  }
  function hudBadges() {
    const unread = G.reports.filter(r => !r.read).length;
    const b = $('#rep-badge'); b.textContent = unread; b.classList.toggle('hidden', !unread);
    const qn = QUESTS.filter(q => !user.quests[q.id] && q.check(user)).length;
    const qb = $('#quest-badge'); qb.textContent = qn; qb.classList.toggle('hidden', !qn);
    const ab = $('#alli-badge');
    const inv = user.alliance < 0 && G.invites && G.invites.length;
    ab.textContent = inv ? '!' : ''; ab.classList.toggle('hidden', !inv);
  }
  function chatArr(tab) {
    if (tab === 'world') return G.chat.world;
    if (tab === 'ally') return user.alliance >= 0 ? (G.chat.ally[user.alliance] || []) : [];
    return G.news.map(n => ({ t: n.t, from: -1, name: '天下', text: n.text, sys: true })).reverse().concat(G.chat.sys);
  }
  function hudChat() {
    const ver = (G.chatVer || 0) + ':' + chatTab + ':' + user.alliance;
    if (ver === chatSeen) return;
    chatSeen = ver;
    const log = $('#chatlog');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    const arr = chatArr(chatTab).slice(-80);
    log.innerHTML = arr.map(m => {
      const tm = '<span class="tm">' + String(Math.floor(m.t % 1440 / 60)).padStart(2, '0') + ':' + String(Math.floor(m.t % 60)).padStart(2, '0') + '</span>';
      if (m.sys) return '<div class="m sys">' + tm + E(m.text) + '</div>';
      return '<div class="m' + (m.from === user.id ? ' me' : '') + '">' + tm + (m.tag && chatTab === 'world' ? '<span class="tg">〔' + E(m.tag) + '〕</span>' : '') + '<span class="n" data-act="gotoplayer" data-pid="' + m.from + '">' + E(m.name) + '</span>：' + E(m.text) + '</div>';
    }).join('') || '<div class="muted">' + (chatTab === 'ally' ? '尚未加入同盟' : '暫無訊息') + '</div>';
    if (atBottom || chatTabSeen !== chatTab) log.scrollTop = log.scrollHeight;
    chatTabSeen = chatTab;
  }
  function sendChat() {
    const v = $('#chatin').value.trim();
    if (!v) return;
    const r = Game.say(user, chatTab === 'ally' ? 'ally' : 'world', v);
    if (!r.ok) toast(r.msg, 'warn');
    $('#chatin').value = '';
  }
  function hudToasts() {
    while (noticeSeen < G.notices.length) {
      const n = G.notices[noticeSeen++];
      toast(n.text, n.type);
    }
    if (G.notices.length > 40) { G.notices.splice(0, 20); noticeSeen = Math.max(0, noticeSeen - 20); }
  }
  let toastCount = 0;
  function toast(text, type) {
    const box = $('#toasts');
    if (toastCount > 5) box.firstChild && box.removeChild(box.firstChild);
    const d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = text;
    box.appendChild(d);
    toastCount++;
    setTimeout(() => { d.remove(); toastCount--; }, 4200);
  }

  // ================= 地圖操作 =================
  function bindMap() {
    const cv = $('#map');
    let down = null, moved = false;
    const pointers = new Map();
    let pinch = null;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
      down = { x: e.clientX, y: e.clientY }; moved = false;
    });
    cv.addEventListener('pointermove', e => {
      if (!main.started) return;
      if (pointers.has(e.pointerId)) {
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinch) {
          const [a, b] = Array.from(pointers.values());
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          Render.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
          pinch.d = d; moved = true;
          return;
        }
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5)) { moved = true; cv.classList.add('drag'); }
        if (moved) Render.pan(dx, dy);
      } else {
        Render.setHover(Render.tileAt(e.clientX, e.clientY));
      }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      cv.classList.remove('drag');
      if (!main.started) return;
      if (down && !moved && pointers.size === 0) {
        const i = Render.tileAt(e.clientX, e.clientY);
        if (i >= 0) openTile(i, e.clientX, e.clientY);
        else closeTile();
      }
      if (pointers.size === 0) down = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); if (!main.started) return; Render.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    $('#mini').addEventListener('click', e => {
      const r = e.target.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (e.target.width / r.width), my = (e.clientY - r.top) * (e.target.height / r.height);
      const g = Render.miniToGrid(mx, my);
      if (g) { Render.cam.cx = U.clamp(g[0], 0, World.N); Render.cam.cy = U.clamp(g[1], 0, World.N); }
    });
  }
  function onKey(e) {
    if (!main.started) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key;
    const step = 60;
    if (k === 'ArrowLeft' || k === 'a') Render.pan(step, 0);
    else if (k === 'ArrowRight' || k === 'd') Render.pan(-step, 0);
    else if (k === 'ArrowUp' || k === 'w') Render.pan(0, step);
    else if (k === 'ArrowDown' || k === 's') Render.pan(0, -step);
    else if (k === '+' || k === '=') Render.zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
    else if (k === '-') Render.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
    else if (k === ' ') { G.paused = !G.paused; e.preventDefault(); }
    else if (k === 'Escape') { closeModal(); closeTile(); }
    else if (k === 'h') Render.centerOn(user.cityTile);
  }
  function goto(i, tw) { Render.centerOn(i, tw || Math.max(Render.cam.tw, 40)); }

  // ================= 土地彈窗 =================
  function openTile(i, sx, sy) {
    tileSel = i; tilePopMode = 'info';
    Render.setSelected(i);
    const el = $('#tilepop');
    el.classList.remove('hidden');
    renderTilePop();
    const w = 300, h = el.offsetHeight || 260;
    let x = sx + 18, y = sy - h / 2;
    if (x + w > innerWidth - 8) x = sx - w - 18;
    y = U.clamp(y, 70, innerHeight - h - 10);
    el.style.left = Math.max(8, x) + 'px'; el.style.top = y + 'px';
  }
  function closeTile() { tileSel = -1; Render.setSelected(-1); $('#tilepop').classList.add('hidden'); }
  function tileTitle(i) {
    const T = Game.T;
    const c = T.city[i];
    if (c >= 0) {
      const city = World.cities[c];
      if (city.type === 'main') return Game.P[city.owner].name + ' 的主城';
      if (city.type === 'fort') return Game.P[city.owner].name + ' 的要塞';
      if (city.type === 'camp') return Game.P[city.owner].name + ' 的營帳';
      if (city.type === 'branch') return Game.P[city.owner].name + ' 的分城';
      return CFG.CITY_TYPE_NAME[city.type] + '・' + city.name + ' <small>Lv.' + city.lvl + '</small>';
    }
    if (T.terrain[i] === TERRAIN.MOUNTAIN) return '山脈';
    if (T.terrain[i] === TERRAIN.WATER) return '河流';
    return CFG.RES_NAME[CFG.RES[T.res[i]]] + ' <small>Lv.' + T.lvl[i] + '</small>';
  }
  function renderTilePop() {
    const i = tileSel;
    if (i < 0) return;
    const T = Game.T;
    const el = $('#tilepop');
    const c = T.city[i];
    const city = c >= 0 ? World.cities[c] : null;
    let h = '<div class="tp-h"><div><div class="tp-t">' + tileTitle(i) + '</div><div class="tp-c">(' + World.X(i) + ',' + World.Y(i) + ') ' + World.states[T.state[i]].name + '</div></div><button class="x" data-act="closetile">✕</button></div>';
    h += '<div class="tp-b">';
    const owner = Game.tileOwner(i), alli = Game.tileAlliance(i);
    if (T.terrain[i] === TERRAIN.MOUNTAIN || T.terrain[i] === TERRAIN.WATER) {
      h += '<div class="muted">無法通行，也無法佔領。</div></div>';
      el.innerHTML = h; return;
    }
    if (owner >= 0) {
      const o = Game.P[owner];
      h += row('擁有者', '<span class="link" data-act="gotoplayer" data-pid="' + o.id + '">' + E(o.name) + '</span>' + (o.title ? ' <span class="bad">[' + E(o.title) + ']</span>' : '') + (o.alliance >= 0 ? ' 〔' + E(G.alliances[o.alliance].name) + '〕' + (G.alliances[o.alliance].lord >= 0 && G.alliances[G.alliances[o.alliance].lord] ? '<span class="muted">（附庸〔' + E(G.alliances[G.alliances[o.alliance].lord].name) + '〕）</span>' : '') : ''));
    } else if (city && city.alliance >= 0) h += row('佔領同盟', '〔' + E(G.alliances[city.alliance].name) + '〕');
    else h += row('擁有者', '無主之地');
    if (!city) {
      const L = T.lvl[i];
      h += row('產量', CFG.RES_NAME[CFG.RES[T.res[i]]] + ' +' + CFG.LAND_OUTPUT[L] + '/時');
      const g = CFG.GARRISON[L];
      const st = G.landSiege[i];
      h += row('守軍', g[0] + '隊 × ' + g[1] + '將 Lv' + g[2] + '，每將 ' + g[3] + ' 兵' + (st ? ' <span class="warn">(交戰中)</span>' : ''));
      if (!user.firstCap[i]) h += row('首佔名望', '+' + L * CFG.FAME_PER_LVL);
    } else if (city.type === 'main') {
      const o = Game.P[city.owner];
      h += row('耐久', Math.round(city.dur) + '/' + city.maxDur);
      h += row('勢力', U.fmt(o.power) + '　領地 ' + o.landCount);
      if (o.captor >= 0) h += row('狀態', '<span class="bad">淪陷於 ' + E(Game.P[o.captor].name) + '</span>');
      if (G.time < o.protectEnd) h += row('保護', '<span class="good">免戰 ' + U.fmtDur(o.protectEnd - G.time) + '</span>');
    } else if (World.isOutpost(city) || city.type === 'branch') {
      h += row('耐久', Math.round(city.dur) + '/' + city.maxDur + (city.building > G.time ? '　建造中 ' + U.fmtDur(city.building - G.time) : ''));
      if (city.type === 'camp' && city.expire) h += row('剩餘時間', U.fmtDur(Math.max(0, city.expire - G.time)));
      if (city.type === 'branch') h += row('功能', '駐紮、征兵、治療傷兵；四資源 +' + CFG.BRANCH_OUTPUT + '/時');
    } else {
      h += row('耐久', Math.round(city.dur) + '/' + city.maxDur);
      if (city.alliance < 0) {
        const g = CFG.CITY_GARRISON[city.lvl];
        const alive = city.garrison ? city.garrison.filter(s => s.some(x => x > 0)).length : g[0];
        h += row('守軍', alive + '/' + g[0] + ' 隊（Lv' + g[1] + '，每將 ' + g[2] + ' 兵）');
        if (city.resetAt > G.time && city.garrison) h += row('守軍恢復', '<span class="warn">' + U.fmtDur(city.resetAt - G.time) + '</span>');
      }
      h += row('城池積分', CFG.CITY_POINTS[city.type] + '　同盟產量加成');
      const lock = Game.cityLockedDay(city);
      if (lock > Game.day()) h += row('開放', '<span class="warn">第 ' + (lock + 1) + ' 天</span>');
      if (city.type === 'luoyang' && city.alliance >= 0 && city.holdSince >= 0) h += row('霸業', '已堅守 ' + U.fmtDur(G.time - city.holdSince) + ' / 48時');
    }
    // 在此的部隊
    const here = [];
    for (const q of Game.P) for (const t of q.teams) {
      if ((t.status === 'garrison' && t.gtile === i) || (city && t.status === 'idle' && city.tiles.includes(t.base) && q.id === owner)) {
        if (Game.isFriendly(user, i)) here.push(q.name + ' 第' + (t.id + 1) + '隊');
      }
    }
    if (here.length) h += row('駐軍', here.slice(0, 4).join('、') + (here.length > 4 ? '…' : ''));
    h += '</div>';
    // 動作
    if (tilePopMode === 'confirm-branch' || tilePopMode === 'confirm-relocate') {
      h += buildConfirmHtml(i, tilePopMode === 'confirm-branch' ? 'branch' : 'relocate');
    } else if (MARCH_NAME[tilePopMode]) {
      h += teamPickHtml(i, tilePopMode);
    } else {
      h += '<div class="acts">';
      const why = Game.attackBlock(user, i);
      const friendly = Game.isFriendly(user, i);
      if (!friendly) {
        if (!why) h += '<button class="btn red" data-act="tp-mode" data-m="attack">出征</button>';
      } else {
        h += '<button class="btn" data-act="tp-mode" data-m="garrison">駐守</button>';
        if (Game.baseValid(user, i) && i !== user.cityTile) h += '<button class="btn" data-act="tp-mode" data-m="move">調動</button>';
        if (T.owner[i] === user.id && !city) {
          h += '<button class="btn green" data-act="tp-mode" data-m="farm" title="收取此地 ' + CFG.FARM_HOURS + ' 小時產量，消耗 ' + CFG.COST_FARM + ' 體力">屯田</button>';
          h += '<button class="btn green" data-act="tp-mode" data-m="train" title="在此練兵 ' + CFG.TRAIN_MIN + ' 分鐘賺經驗，消耗 ' + CFG.COST_TRAIN + ' 體力">練兵</button>';
          h += '<button class="btn red" data-act="tp-mode" data-m="sweep" title="攻打此地守軍賺經驗，土地不會失去，消耗 ' + CFG.COST_SWEEP + ' 體力">掃蕩</button>';
          h += '<br><button class="btn dark" data-act="abandon">放棄</button>';
          h += '<button class="btn dark" data-act="fort" title="' + costText(CFG.FORT_COST) + '">建要塞</button>';
          h += '<button class="btn dark" data-act="camp" title="' + costText(CFG.CAMP_COST) + '，24 小時後拆除">建營帳</button>';
          h += '<button class="btn dark" data-act="tp-mode" data-m="confirm-branch">建分城</button>';
          h += '<button class="btn dark" data-act="tp-mode" data-m="confirm-relocate">遷城</button>';
        }
      }
      if (city && !World.isPlayerCity(city) && user.alliance >= 0 && G.alliances[user.alliance].leader === user.id && city.alliance !== user.alliance)
        h += '<button class="btn gold" data-act="settarget" data-c="' + city.id + '">設為同盟目標</button>';
      h += '</div>';
      if (!friendly && why) h += '<div class="why">' + why + '</div>';
    }
    el.innerHTML = h;
  }
  function row(a, b) { return '<div class="row"><span>' + a + '</span><span>' + b + '</span></div>'; }
  function estLabel(w) {
    if (w === null) return '<span class="est e3">未知</span>';
    if (w >= 0.85) return '<span class="est e4">輕鬆</span>';
    if (w >= 0.6) return '<span class="est e3">可戰</span>';
    if (w >= 0.3) return '<span class="est e2">危險</span>';
    return '<span class="est e1">極危</span>';
  }
  function moraleTag(m) { return '<span class="morale' + (m < 80 ? ' low' : '') + '" title="士氣影響造成的傷害（' + Math.round(CFG.moraleDmg(m) * 100) + '%）。從越近的主城、要塞或同盟城池出發，士氣越高">士氣' + m + '</span>'; }
  function estWin(team, i, sweep) {
    const T = Game.T;
    const tp = Game.teamPower(user, team) * CFG.moraleDmg(Game.marchMorale(user, team, i));
    const c = T.city[i];
    if (c < 0) {
      if (T.owner[i] >= 0 && !sweep) return null;
      const L = T.lvl[i];
      return AI.winP(tp / (AI.GP[L] * AI.R50[L]));
    }
    const city = World.cities[c];
    if (World.isPlayerCity(city) || city.alliance >= 0) return null;
    const g = CFG.CITY_GARRISON[city.lvl];
    const first = city.garrison ? city.garrison.find(s => s.some(x => x > 0)) : [g[2], g[2], g[2]];
    if (!first) return 1;
    return AI.winP(tp / (Battle.power(Game.npcSquad(city.lvl, 3, g[1], first, 1, true)) * AI.CR50[city.lvl]));
  }
  function costText(c) {
    const nm = Object.assign({ gold: '金銖', copper: '銅幣' }, CFG.RES_SHORT);
    return Object.keys(c).map(r => nm[r] + c[r]).join(' ');
  }
  function buildConfirmHtml(i, kind) {
    const br = kind === 'branch';
    const why = br ? Game.canBranch(user, i) : Game.canRelocate(user, i);
    let h = '<div class="sec-t" style="margin:6px 10px">' + (br ? '建造分城' : '遷城') + '</div><div style="padding:0 10px 8px;font-size:13px">';
    h += br ? '以此格為中心的 3×3 土地建成分城（需君王殿 ' + CFG.BRANCH_PALACE + ' 級、名望 15000；名望 50000 可建第二座；距主城至少 8 格），建造 ' + (CFG.BRANCH_BUILD_MIN / 60) + ' 小時。完成後可駐紮、征兵、治療傷兵，四資源各 +' + CFG.BRANCH_OUTPUT + '/時。'
      : '把主城搬到以此格為中心的 3×3 土地，原主城處變回平地。所有部隊需待命，冷卻 ' + (CFG.RELOCATE_CD_MIN / 60) + ' 小時。';
    h += costHtml(br ? CFG.BRANCH_COST : CFG.RELOCATE_COST);
    if (why) h += '<div class="why">' + why + '</div>';
    h += '<button class="btn gold small" data-act="' + kind + '"' + (why ? ' disabled' : '') + '>確定</button> <button class="btn small dark" data-act="tp-mode" data-m="info">返回</button></div>';
    return h;
  }
  function teamPickHtml(i, mode) {
    const title = '選擇' + MARCH_NAME[mode] + '部隊';
    let h = '<div class="sec-t" style="margin:6px 10px">' + title + '</div><div class="teampick">';
    const T = Game.T;
    if (mode === 'farm') h += '<div class="muted" style="padding:0 10px;font-size:12px">抵達後獲得 ' + CFG.RES_NAME[CFG.RES[T.res[i]]] + ' ' + Game.farmYield(i) + '（此地 ' + CFG.FARM_HOURS + ' 小時產量），之後返回。</div>';
    if (mode === 'train') h += '<div class="muted" style="padding:0 10px;font-size:12px">在此練兵 ' + CFG.TRAIN_MIN + ' 分鐘，每名武將每分鐘 +' + CFG.TRAIN_EXP[T.lvl[i]] + ' 經驗，不會損兵；土地等級越高經驗越多。</div>';
    if (mode === 'sweep') h += '<div class="muted" style="padding:0 10px;font-size:12px">與此地守軍交戰賺經驗，土地不會失去；損失兵力照常計算。</div>';
    let any = false;
    user.teams.forEach((t, ti) => {
      const hs = Game.teamHeroes(user, t);
      if (!hs[0]) return;
      any = true;
      const ready = t.status === 'idle' && !t.rq;
      const eta = Game.marchTime(user, t, Game.baseValid(user, t.base) ? t.base : user.cityTile, i);
      const sta = Math.floor(Game.teamMinSta(user, t));
      const names = hs.filter(Boolean).map(x => Game.tpl(x).name).join('・');
      h += '<div class="tp"><div>第' + (ti + 1) + '隊 ' + names + ' ' + (mode === 'attack' || mode === 'sweep' ? moraleTag(Game.marchMorale(user, t, i)) + ' ' + estLabel(estWin(t, i, mode === 'sweep')) : '') + '</div>';
      h += '<button class="btn small ' + (mode === 'attack' || mode === 'sweep' ? 'red' : '') + '" data-act="dispatch" data-ti="' + ti + '" data-m="' + mode + '"' + (ready ? '' : ' disabled') + '>' + (ready ? '出發' : statusText(user, t)[1]) + '</button>';
      const wnd = Game.teamWounded(user, t);
      h += '<small>兵 ' + U.fmt(Game.teamTroops(user, t)) + (wnd > 0 ? ' <span class="wtxt">(傷' + U.fmt(wnd) + ')</span>' : '') + '　體力 ' + sta + '　行軍 ' + U.fmtDur(eta) + '</small></div>';
    });
    if (!any) h += '<div class="muted">沒有可用部隊，請先到「部隊」配置武將。</div>';
    h += '<button class="btn small dark" data-act="tp-mode" data-m="info">返回</button></div>';
    return h;
  }

  // ================= 點擊分派 =================
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const d = el.dataset;
    switch (act) {
      case 'newgame': startNew(); break;
      case 'continue': continueGame(); break;
      case 'speed': { const v = +d.v; if (v === 0) G.paused = true; else { G.paused = false; G.speed = v; } break; }
      case 'open': openPanel(d.panel, d.arg); break;
      case 'close': closeModal(); break;
      case 'closetile': closeTile(); break;
      case 'tab': panelTab = d.tab; refreshPanel(); break;
      case 'home': goto(user.cityTile, 56); break;
      case 'zoomin': Render.zoomAt(innerWidth / 2, innerHeight / 2, 1.3); break;
      case 'zoomout': Render.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.3); break;
      case 'mapmode': Render.setMode(Render.mode === 'relation' ? 'alliance' : 'relation'); el.classList.toggle('on', Render.mode === 'alliance'); toast(Render.mode === 'alliance' ? '勢力圖：依同盟上色' : '關係圖：綠=我方 藍=盟友 紅=敵對 黃=無盟', 'info'); break;
      case 'aimarch': Render.showAIMarch = !Render.showAIMarch; el.classList.toggle('on', !Render.showAIMarch); toast(Render.showAIMarch ? '顯示所有行軍' : '只顯示我方與相關行軍'); break;
      case 'chattab': chatTab = d.tab; document.querySelectorAll('.chat-tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === chatTab)); chatSeen = -1; break;
      case 'chatfold': $('#chatbox').classList.toggle('fold'); el.textContent = $('#chatbox').classList.contains('fold') ? '▴' : '▾'; break;
      case 'teamcard': {
        const ti = +d.ti; selTeam = ti;
        const t = user.teams[ti];
        if (t.status === 'march') { const m = G.marches.find(x => x.id === t.march); if (m) { const [gx, gy] = Game.marchPos(m, G.time); Render.cam.cx = gx; Render.cam.cy = gy; } }
        else if (t.status === 'garrison' || t.status === 'train') goto(t.gtile);
        else openPanel('teams');
        break;
      }
      case 'tp-mode': tilePopMode = d.m; renderTilePop(); break;
      case 'dispatch': {
        const r = Game.send(user, +d.ti, tileSel, d.m);
        if (r.ok) { toast('第' + (+d.ti + 1) + '部隊出發' + MARCH_NAME[d.m] + '！預計 ' + U.fmtDur(r.march.end - G.time) + ' 後抵達', 'good'); tilePopMode = 'info'; closeTile(); }
        else toast(r.msg, 'warn');
        break;
      }
      case 'abandon': if (ask('確定放棄這塊土地？')) { const r = Game.abandon(user, tileSel); toast(r.ok ? '已放棄土地' : r.msg, r.ok ? 'info' : 'warn'); renderTilePop(); } break;
      case 'fort': { const r = Game.buildFort(user, tileSel); toast(r.ok ? '開始建造要塞（' + CFG.FORT_BUILD_MIN + ' 分鐘）' : r.msg, r.ok ? 'good' : 'warn'); renderTilePop(); break; }
      case 'camp': { const r = Game.buildCamp(user, tileSel); toast(r.ok ? '開始搭建營帳（' + CFG.CAMP_BUILD_MIN + ' 分鐘，' + (CFG.CAMP_LIFE_MIN / 60) + ' 小時後拆除）' : r.msg, r.ok ? 'good' : 'warn'); renderTilePop(); break; }
      case 'branch': { const r = Game.buildBranch(user, tileSel); toast(r.ok ? '開始建造分城（' + (CFG.BRANCH_BUILD_MIN / 60) + ' 小時）' : r.msg, r.ok ? 'good' : 'warn'); tilePopMode = 'info'; renderTilePop(); break; }
      case 'relocate': { const r = Game.relocate(user, tileSel); if (r.ok) { toast('遷城完成！', 'good'); tilePopMode = 'info'; closeTile(); goto(user.cityTile, 56); } else toast(r.msg, 'warn'); break; }
      case 'settarget': {
        const a = G.alliances[user.alliance];
        a.target = +d.c; a.targetSince = G.time; a.phase = 'pave'; a.field = null;
        AI.alliancesThink();
        const c = World.cities[a.target];
        Game.say(user, 'ally', '【盟主令】全盟目標：' + CFG.CITY_TYPE_NAME[c.type] + '【' + c.name + '】(' + c.cx + ',' + c.cy + ')，大家鋪路集結！');
        toast('已設定同盟目標：' + c.name, 'good');
        renderTilePop();
        break;
      }
      case 'gotoplayer': { const p = Game.P[+d.pid]; if (p) { goto(p.cityTile, 48); closeModal(); } break; }
      case 'gototile': { goto(+d.tile, 48); closeModal(); break; }
      case 'recall': { const r = Game.recall(user, +d.ti); toast(r.ok ? '部隊撤回中' : r.msg, r.ok ? 'info' : 'warn'); refreshPanel(); break; }
      case 'recruit': { const r = Game.recruit(user, +d.ti, 1); toast(r.ok ? '開始征兵，需時 ' + U.fmtDur(r.time) : r.msg, r.ok ? 'good' : 'warn'); refreshPanel(); break; }
      case 'recruitall': { let n = 0; user.teams.forEach((t, ti) => { if (Game.recruit(user, ti, 1).ok) n++; }); toast(n ? n + ' 支部隊開始征兵' : '沒有可征兵的部隊（需在主城待命且資源足夠）', n ? 'good' : 'warn'); refreshPanel(); break; }
      case 'autoteam': { const t = user.teams[+d.ti]; for (let s = 0; s < 3; s++) Game.setSlot(user, +d.ti, s, 0); Game.autoFillTeam(user, +d.ti); refreshPanel(); break; }
      case 'slot': teamPick = { ti: +d.ti, slot: +d.slot }; refreshPanel(); break;
      case 'pickhero': {
        const r = Game.setSlot(user, teamPick.ti, teamPick.slot, +d.uid);
        if (!r.ok) toast(r.msg, 'warn');
        teamPick = null; refreshPanel(); break;
      }
      case 'unslot': { const r = Game.setSlot(user, teamPick.ti, teamPick.slot, 0); if (!r.ok) toast(r.msg, 'warn'); teamPick = null; refreshPanel(); break; }
      case 'cancelpick': teamPick = null; refreshPanel(); break;
      case 'teamhome': { const r = Game.send(user, +d.ti, user.cityTile, 'move'); toast(r.ok ? '部隊返回主城' : r.msg, r.ok ? 'info' : 'warn'); refreshPanel(); break; }
      case 'upgrade': { const r = Game.upgradeBuilding(user, d.key); toast(r.ok ? BUILDING_BY_KEY[d.key].name + ' 開始升級' : r.msg, r.ok ? 'good' : 'warn'); refreshPanel(); break; }
      case 'hero': heroSel = +d.uid; refreshPanel(); break;
      case 'hfilter': heroFilter = d.f; refreshPanel(); break;
      case 'addpt': { const r = Game.addPoint(user, heroSel, d.stat, +d.n || 1); if (!r.ok) toast(r.msg, 'warn'); refreshPanel(); break; }
      case 'resetpt': Game.resetPoints(user, heroSel); refreshPanel(); break;
      case 'learn': { const r = Game.learnSkill(user, heroSel, +d.k, d.sid || null); if (!r.ok) toast(r.msg, 'warn'); panelArg = null; refreshPanel(); break; }
      case 'learnpick': panelArg = { learn: +d.k }; refreshPanel(); break;
      case 'skup': { const r = Game.upgradeSkill(user, heroSel, +d.k); if (!r.ok) toast(r.msg, 'warn'); refreshPanel(); break; }
      case 'convert': {
        const h = Game.heroByUid(user, heroSel);
        if (h && ask('轉化會消耗武將【' + Game.tpl(h).name + '】Lv' + h.lv + '，獲得 ' + Math.round(Game.convertValue(h)) + ' 戰法點。確定嗎？')) {
          const r = Game.convertHero(user, heroSel);
          toast(r.ok ? '獲得戰法點 ' + r.pts : r.msg, r.ok ? 'good' : 'warn');
          if (r.ok) heroSel = 0;
          refreshPanel();
        }
        break;
      }
      case 'drill': case 'drillhero': {
        const sid = act === 'drill' ? d.sid : panelArg && panelArg.drill;
        const h = Game.heroByUid(user, +d.uid);
        if (!sid || !h) break;
        if (Game.tpl(h).star >= 4 && !ask('確定消耗' + Game.tpl(h).star + '星武將【' + Game.tpl(h).name + '】演練【' + SKILLS[sid].name + '】？')) break;
        const r = Game.drillSkill(user, sid, +d.uid);
        if (!r.ok) toast(r.msg, 'warn');
        else { toast(r.done ? '演練完成！學會戰法【' + SKILLS[sid].name + '】' : '【' + SKILLS[sid].name + '】演練進度 ' + Math.floor(r.prog) + '%', 'good'); if (r.done) panelArg = null; }
        if (act === 'drill' && r.ok) heroSel = 0;
        refreshPanel();
        break;
      }
      case 'drillpick': panelArg = { drill: d.sid }; refreshPanel(); break;
      case 'drillcancel': panelArg = null; refreshPanel(); break;
      case 'awaken': {
        const h = Game.heroByUid(user, heroSel);
        if (!h) break;
        const fs = Game.awakenFodder(user, h).sort((a, b) => Game.tpl(a).star - Game.tpl(b).star || a.lv - b.lv).slice(0, CFG.AWAKEN_FODDER);
        if (!ask('覺醒【' + Game.tpl(h).name + '】將消耗：' + fs.map(x => Game.tpl(x).star + '★' + Game.tpl(x).name + ' Lv' + x.lv).join('、') + '。確定嗎？')) break;
        const r = Game.awakenHero(user, heroSel, fs.map(x => x.uid));
        toast(r.ok ? Game.tpl(h).name + ' 覺醒成功！' : r.msg, r.ok ? 'good' : 'warn');
        refreshPanel(); break;
      }
      case 'event': {
        const ev = EVENT_SKILLS.find(e => e.id === d.ev);
        if (!ev || !ask('兌換【' + SKILLS[ev.skill].name + '】將消耗：' + ev.heroes.join('、') + '。確定嗎？')) break;
        const r = Game.exchangeEvent(user, d.ev);
        toast(r.ok ? '學會事件戰法【' + SKILLS[r.skill].name + '】' : r.msg, r.ok ? 'good' : 'warn');
        refreshPanel(); break;
      }
      case 'advance': { const r = Game.advanceHero(user, heroSel, +d.f); toast(r.ok ? '進階成功！獲得 10 點屬性點' : r.msg, r.ok ? 'good' : 'warn'); refreshPanel(); break; }
      case 'inherit': {
        const h = Game.heroByUid(user, heroSel);
        if (h && ask('傳承會消耗武將【' + Game.tpl(h).name + '】，並獲得其戰法【' + SKILLS[Game.tpl(h).inherit].name + '】的演練進度。確定嗎？')) {
          const r = Game.inheritHero(user, heroSel);
          toast(r.ok ? (r.prog >= 100 ? '學會戰法【' + SKILLS[r.skill].name + '】' : '【' + SKILLS[r.skill].name + '】演練進度 ' + Math.floor(r.prog) + '%，到「戰法」頁演練') : r.msg, r.ok ? 'good' : 'warn');
          heroSel = 0; refreshPanel();
        }
        break;
      }
      case 'draw': {
        const r = Game.drawPack(user, d.pack);
        if (!r.ok) { toast(r.msg, 'warn'); break; }
        drawResult = r.heroes;
        const best = Math.max(...r.heroes.map(h => Game.tpl(h).star));
        if (best >= 5) toast('恭喜獲得五星武將！', 'good');
        refreshPanel(); break;
      }
      case 'recharge': { const cu = d.kind === 'copper'; Game.recharge(user, +d.amt, d.kind); toast('儲值成功，獲得 ' + U.fmtFull(+d.amt) + (cu ? ' 銅幣' : ' 金銖') + '（模擬）', 'good'); refreshPanel(); break; }
      case 'report': repSel = +d.id; const rp = G.reports.find(r => r.id === repSel); if (rp) rp.read = true; refreshPanel(); break;
      case 'replay': { const rp = G.reports.find(r => r.id === repSel); if (rp) Replay.open(rp, +d.k); break; }
      case 'readall': G.reports.forEach(r => r.read = true); refreshPanel(); break;
      case 'join': { const r = Game.joinAlliance(user, +d.a); toast(r.ok ? '加入同盟成功！' : r.msg, r.ok ? 'good' : 'warn'); G.invites = []; refreshPanel(); break; }
      case 'create': {
        const name = ($('#alli-name-in') || {}).value;
        const r = Game.createAlliance(user, (name || '').trim());
        toast(r.ok ? '同盟〔' + name + '〕創建成功！' : r.msg, r.ok ? 'good' : 'warn'); refreshPanel(); break;
      }
      case 'leave': if (ask('確定退出同盟？')) { const r = Game.leaveAlliance(user); toast(r.ok ? '已退出同盟' : r.msg); refreshPanel(); } break;
      case 'cleartarget': { const a = G.alliances[user.alliance]; a.target = -1; a.field = null; a.pave = null; a.phase = ''; refreshPanel(); break; }
      case 'claim': { const q = QUESTS.find(x => x.id === d.q); const r = Game.claimQuest(user, q); toast(r.ok ? '領取獎勵：' + rewardText(q.reward) : r.msg, r.ok ? 'good' : 'warn'); refreshPanel(); break; }
      case 'olock': Mobile.lock(d.o).then(ok => { toast(ok ? '已鎖定' + (d.o === 'portrait' ? '直屏' : '橫屏') : '此瀏覽器不支援鎖定螢幕方向', ok ? 'good' : 'warn'); refreshPanel(true); }); break;
      case 'ounlock': Mobile.unlock(); toast('已解除方向鎖定', 'info'); refreshPanel(true); break;
      case 'cardart': CardArt.set(el.checked); refreshPanel(); hudTeams(); break;
      case 'save': { const ok = Game.save(); saveMeta(); snapshot('manual').then(id => { toast(ok ? '已存檔' + (id ? '，並加入存檔紀錄' : '') : '存檔失敗（儲存空間不足）', ok ? 'good' : 'bad'); refreshPanel(true); }); break; }
      case 'histload': if (ask('讀取這份存檔紀錄？目前進度會先自動備份。')) { const id = +d.id; (main.started ? snapshot('backup') : Promise.resolve()).then(() => loadHist(id)); } break;
      case 'histdel': if (ask('刪除這份存檔紀錄？')) SaveHist.remove(+d.id).then(() => { fillHist('#save-hist'); fillHist('#start-hist-list'); }); break;
      case 'restart': if (ask('確定放棄目前進度，重新開始新賽季？（目前進度會保留在存檔紀錄）')) snapshot('backup').then(() => { main.started = false; Game.clearSave(); location.reload(); }); break;
      case 'worldclick': break;
      case 'newseason': snapshot('backup').then(() => { main.started = false; Game.clearSave(); location.reload(); }); break;
    }
  }
  function rewardText(r) {
    const nm = Object.assign({ gold: '金銖', copper: '銅幣' }, CFG.RES_NAME);
    return Object.keys(r).map(k => nm[k] + r[k]).join(' ');
  }

  // ================= 面板 =================
  const PANEL_TITLE = { city: '主城內政', heroes: '武將', teams: '部隊', recruit: '招募', skills: '戰法', reports: '戰報', alliance: '同盟', world: '天下大勢', rank: '排行榜', season: '賽季', quests: '任務', settings: '設定', help: '新手指南', recharge: '儲值', settle: '賽季結算' };
  function openPanel(name, arg) {
    panel = name; panelArg = arg || null; panelTab = null; teamPick = null; drawResult = null;
    if (name === 'heroes' && !heroSel && user.heroes.length) heroSel = user.heroes[0].uid;
    $('#modal .win-title span').textContent = PANEL_TITLE[name] || '';
    $('#modal').classList.remove('hidden');
    closeTile();
    refreshPanel();
  }
  function closeModal() { $('#modal').classList.add('hidden'); panel = null; teamPick = null; }
  function refreshPanel(soft) {
    if (!panel) return;
    const body = $('#modal .win-body');
    const st = body.scrollTop;
    let inner = null;
    const scrollers = {};
    body.querySelectorAll('[data-keep]').forEach(el => { scrollers[el.dataset.keep] = el.scrollTop; });
    const f = PANELS[panel];
    body.innerHTML = f ? f() : '';
    body.querySelectorAll('[data-keep]').forEach(el => { if (scrollers[el.dataset.keep] !== undefined) el.scrollTop = scrollers[el.dataset.keep]; });
    if (soft) body.scrollTop = st;
    if (panel === 'settings') fillHist('#save-hist');
    if (panel === 'world') {
      const cv = $('#bigworld');
      if (cv) {
        cv.width = cv.clientWidth; cv.height = cv.clientHeight;
        Render.drawWorldMap(cv);
        cv.onclick = e => {
          const r = cv.getBoundingClientRect();
          const m = cv._map;
          const a = (e.clientX - r.left - m.ox) / m.hw, b = (e.clientY - r.top - m.oy) / m.hh;
          const gx = (a + b) / 2, gy = (b - a) / 2;
          if (gx >= 0 && gy >= 0 && gx < World.N && gy < World.N) { Render.cam.cx = gx; Render.cam.cy = gy; Render.cam.tw = Math.max(Render.cam.tw, 24); closeModal(); }
        };
      }
    }
    lastPanelRefresh = performance.now();
  }

  // 官網卡圖：只有本機版（index.html 引用 js/cardart.js 且在本機執行）才會有網址
  function artUrl(t, size) {
    return t && t.icon && typeof CardArt !== 'undefined' && CardArt.on ? CardArt.url(t.icon, size) : '';
  }
  // 率土式卡面：左上統御與陣營印、右上兵種、右側直書姓名、下緣星級與等級；外框顏色依星級
  function heroCardHtml(h, opts) {
    opts = opts || {};
    const t = Game.tpl(h);
    const col = FACTION_COLOR[t.faction];
    const art = artUrl(t, 'medium');
    const style = '--fc:' + col + ';--fc2:' + shade(col, -55);
    return '<div class="hcard q' + t.star + (art ? ' has-art' : '') + (opts.sel ? ' sel' : '') + (opts.cls ? ' ' + opts.cls : '') + '" style="' + style + '"' + (opts.act ? ' data-act="' + opts.act + '" data-uid="' + h.uid + '"' + (opts.extra || '') : '') + ' title="' + t.name + '　' + '★'.repeat(t.star) + '　' + t.faction + '・' + t.troop + '兵　統御 ' + t.cost + '">' +
      '<div class="hc-art"><span class="hc-glyph">' + t.name.slice(0, 1) + '</span>' + (art ? '<img src="' + art + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest(\'.hcard\').classList.remove(\'has-art\');this.remove()">' : '') + '</div>' +
      '<div class="hc-cost">' + t.cost.toFixed(1) + '</div><div class="hc-fac">' + t.faction + '</div><div class="hc-troop">' + t.troop + '</div>' +
      '<div class="hc-name">' + t.name + '</div>' +
      (h.team >= 0 && !opts.noTeam ? '<span class="inteam">' + (h.team + 1) + '隊</span>' : '') + (h.adv ? '<span class="adv">' + '◆'.repeat(h.adv) + '</span>' : '') +
      '<div class="hc-foot"><span class="hc-stars">' + '★'.repeat(t.star) + '</span><span class="hc-lv">Lv.' + h.lv + '</span></div></div>';
  }
  function faceStyle(t) {
    const a = artUrl(t, 'small');
    return a ? ';background-image:linear-gradient(90deg,rgba(0,0,0,.15),rgba(0,0,0,.72)),url(' + a + ');background-size:cover;background-position:center 20%' : '';
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = U.clamp((n >> 16) + amt, 0, 255), g = U.clamp(((n >> 8) & 255) + amt, 0, 255), b = U.clamp((n & 255) + amt, 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function costHtml(cost) {
    const nm = Object.assign({ gold: '金銖', copper: '銅幣' }, CFG.RES_SHORT);
    return '<div class="cost">' + Object.keys(cost).map(r => {
      const have = r === 'gold' || r === 'copper' ? user[r] : user.res[r];
      return '<span class="' + (have < cost[r] ? 'no' : '') + '">' + nm[r] + ' ' + U.fmt(cost[r]) + '</span>';
    }).join('') + '</div>';
  }
  function tabs(list, cur) {
    return '<div class="tabs">' + list.map(([k, n]) => '<button data-act="tab" data-tab="' + k + '" class="' + (k === cur ? 'on' : '') + '">' + n + '</button>').join('') + '</div>';
  }

  const PANELS = {
    city() {
      let h = '<div class="stats-grid">';
      const c = World.cities[user.city];
      const stat = [
        ['主城座標', '(' + World.X(user.cityTile) + ',' + World.Y(user.cityTile) + ') ' + World.states[user.state].name],
        ['城池耐久', Math.round(c.dur) + '/' + c.maxDur],
        ['名望', U.fmtFull(user.fame)], ['領地', user.landCount + '/' + user.landCap],
        ['資源上限', U.fmtFull(user.cap)], ['統御上限', Game.costCap(user).toFixed(1)],
        ['部隊數', user.teams.length + '/5'], ['武將帶兵上限', '+' + user.b.barracks * 200],
        ['同盟加成', '+' + Math.round(Game.allianceBonus(user) * 100) + '%'], ['主城狀態', user.captor >= 0 ? '<span class="bad">淪陷(' + U.fmtDur(user.captureEnd - G.time) + ')</span>' : G.time < user.protectEnd ? '<span class="good">保護中 ' + U.fmtDur(user.protectEnd - G.time) + '</span>' : '正常'],
      ];
      for (const r of CFG.RES) stat.push([CFG.RES_NAME[r] + '產量', '+' + U.fmtFull(user.prod[r]) + '/時']);
      stat.push(['銅幣稅收', '+' + U.fmtFull(user.prod.copper) + '/時']);
      h += stat.map(([a, b]) => '<div><span>' + a + '</span><span>' + b + '</span></div>').join('') + '</div>';
      h += '<div class="sec-t">建造隊列（' + user.bq.length + '/2）</div><div class="queue">';
      h += user.bq.map(q => '<div class="qitem">' + BUILDING_BY_KEY[q.key].name + ' → ' + q.lv + ' 級　<span class="warn">' + U.fmtDur(q.end - G.time) + '</span></div>').join('') || '<span class="muted">空閒中</span>';
      h += '</div><div class="sec-t">城內建築</div><div class="bgrid">';
      for (const bd of BUILDINGS) {
        const lv = user.b[bd.key];
        const allowed = buildingMaxAllowed(bd.key, user.b.palace);
        const to = lv + 1;
        const inQ = user.bq.some(q => q.key === bd.key);
        h += '<div class="bcard"><div class="bh"><span class="bn">' + bd.name + '</span><span class="bl">' + lv + '/' + bd.max + ' 級</span></div><div class="bd">' + bd.desc + '</div>';
        if (lv >= bd.max) h += '<div class="good">已滿級</div>';
        else if (allowed === 0 || to > allowed) h += '<div class="muted">需要君王殿 ' + (bd.key === 'palace' ? '' : Math.max(bd.req, to - 1) + ' 級') + '</div>';
        else {
          h += costHtml(buildingCost(bd.key, to)) + '<div class="muted" style="font-size:12px">需時 ' + U.fmtDur(buildingTime(bd.key, to)) + '</div>';
          if (bd.key === 'palace') { const need = Math.max(0, to - 2); h += '<div class="muted" style="font-size:12px">需四種資源建築 ≥ ' + need + ' 級</div>'; }
          h += '<button class="btn small" data-act="upgrade" data-key="' + bd.key + '"' + (inQ ? ' disabled' : '') + '>' + (inQ ? '升級中' : '升級') + '</button>';
        }
        h += '</div>';
      }
      return h + '</div>';
    },

    heroes() {
      const list = user.heroes.slice().sort((a, b) => Game.tpl(b).star - Game.tpl(a).star || b.lv - a.lv);
      const flt = heroFilter;
      const shown = list.filter(h => flt === 'all' || (flt === 'team' ? h.team >= 0 : (flt.length === 1 && '漢魏蜀吳群'.includes(flt) ? Game.tpl(h).faction === flt : Game.tpl(h).troop === flt)));
      let h = '<div class="hero-layout"><div style="display:flex;flex-direction:column;min-height:0">';
      h += '<div class="filter">' + [['all', '全部'], ['team', '上陣'], ['漢', '漢'], ['魏', '魏'], ['蜀', '蜀'], ['吳', '吳'], ['群', '群'], ['騎', '騎兵'], ['步', '步兵'], ['弓', '弓兵']].map(([k, n]) => '<button data-act="hfilter" data-f="' + k + '" class="' + (flt === k ? 'on' : '') + '">' + n + '</button>').join('') + '<span class="muted" style="margin-left:8px">共 ' + user.heroes.length + ' 名</span></div>';
      h += '<div class="hero-list" data-keep="hl">' + shown.map(x => heroCardHtml(x, { act: 'hero', sel: x.uid === heroSel })).join('') + '</div></div>';
      h += '<div class="hdetail">' + heroDetail() + '</div></div>';
      return h;
    },

    teams() {
      let h = '<div style="display:flex;justify-content:space-between;align-items:center"><div class="muted">統御上限 ' + Game.costCap(user).toFixed(1) + '（統帥廳可提升）｜ 校場 ' + user.b.drill + ' 級：可配置 ' + user.teams.length + ' 支部隊</div><button class="btn" data-act="recruitall">全部征兵</button></div>';
      if (teamPick) {
        const t = user.teams[teamPick.ti];
        const cur = Game.heroByUid(user, t.slots[teamPick.slot]);
        h += '<div class="sec-t">為第' + (teamPick.ti + 1) + '部隊・' + Battle.SLOT_NAME[teamPick.slot] + ' 選擇武將</div>';
        h += '<div><button class="btn small dark" data-act="cancelpick">取消</button> ' + (cur ? '<button class="btn small" data-act="unslot">下陣</button>' : '') + '</div>';
        const cands = user.heroes.slice().sort((a, b) => Game.tpl(b).star - Game.tpl(a).star || b.lv - a.lv);
        h += '<div class="picker">' + cands.map(x => heroCardHtml(x, { act: 'pickhero' })).join('') + '</div>';
        return h;
      }
      user.teams.forEach((t, ti) => {
        const [cls, st] = statusText(user, t);
        const rc = Game.recruitCost(user, t, 1);
        h += '<div class="team-row"><div class="trh"><span class="trn">第' + '一二三四五'[ti] + '部隊　<span class="ts ' + cls + '" style="font-size:13px">' + st + '</span></span>';
        h += '<span>';
        if (t.status === 'march' || t.status === 'garrison' || t.status === 'train') h += '<button class="btn small dark" data-act="recall" data-ti="' + ti + '">撤回</button> ';
        if (t.status === 'idle' && t.base !== user.cityTile) h += '<button class="btn small dark" data-act="teamhome" data-ti="' + ti + '">回主城</button> ';
        h += '<button class="btn small" data-act="autoteam" data-ti="' + ti + '">自動配將</button></span></div>';
        h += '<div style="display:flex;gap:14px;flex-wrap:wrap"><div class="slots">';
        for (const s of [0, 1, 2]) {
          const x = Game.heroByUid(user, t.slots[s]);
          h += '<div class="slot"><div class="sl">' + Battle.SLOT_NAME[s] + '</div>';
          h += x ? heroCardHtml(x, { act: 'slot', extra: ' data-ti="' + ti + '" data-slot="' + s + '"', noTeam: true }) : '<div class="hcard empty" data-act="slot" data-ti="' + ti + '" data-slot="' + s + '">＋</div>';
          if (x) {
            const cap = Game.heroCap(user, x);
            h += troopBar(x.troops, x.wnd, cap, 'margin-top:3px') + '<div class="muted" style="font-size:11px;text-align:center">' + x.troops + '/' + cap + (x.wnd > 0 ? ' <span class="wtxt">傷' + x.wnd + '</span>' : '') + '　體力' + Math.floor(Game.getSta(x)) + '</div>';
          }
          h += '</div>';
        }
        h += '</div><div class="team-side">';
        h += '<div class="stats-grid" style="grid-template-columns:1fr">';
        h += '<div><span>統御</span><span>' + Game.teamCost(user, t).toFixed(1) + '/' + Game.costCap(user).toFixed(1) + '</span></div>';
        h += '<div><span>總兵力</span><span>' + U.fmtFull(Game.teamTroops(user, t)) + '/' + U.fmtFull(Game.teamCapTroops(user, t)) + '</span></div>';
        h += '<div><span>行軍速度</span><span>' + Math.round(Game.teamSpeed(user, t)) + '（每格 ' + CFG.minPerTile(Game.teamSpeed(user, t)).toFixed(1) + ' 分）</span></div>';
        h += '<div><span>戰力評估</span><span>' + U.fmt(Game.teamPower(user, t)) + '</span></div>';
        const hs = Game.teamHeroes(user, t).filter(Boolean);
        if (hs.length === 3) {
          const tf = hs.map(x => Game.tpl(x));
          const bonus = [];
          if (tf.every(x => x.faction === tf[0].faction)) bonus.push(tf[0].faction + '陣營加成');
          if (tf.every(x => x.troop === tf[0].troop)) bonus.push(tf[0].troop + '兵加成');
          if (bonus.length) h += '<div><span>陣容加成</span><span class="good">' + bonus.join('、') + '</span></div>';
        }
        h += '</div>';
        const wnd = Game.teamWounded(user, t);
        if (wnd > 0) h += '<div class="wtxt" style="margin-top:6px;font-size:13px">傷兵 ' + U.fmtFull(wnd) + (t.status === 'idle' && Game.isHome(user, t.base) ? '：治療中，約 ' + U.fmtDur(Game.healTime(user, t)) + '（消耗少量資源）' : '：回主城或分城待命即可治療') + '</div>';
        if (Object.keys(rc.add).length) {
          h += '<div class="sec-t" style="font-size:15px">征兵（補滿）</div>' + costHtml(rc.cost) + '<div class="cost"><span class="' + (user.reserve < rc.men ? 'no' : '') + '">預備兵 ' + U.fmt(rc.men) + '</span></div><div class="muted" style="font-size:12px">需時 ' + U.fmtDur(rc.time) + '（資源或預備兵不足時按比例征兵）</div>';
          h += '<button class="btn green small" data-act="recruit" data-ti="' + ti + '"' + (t.status !== 'idle' || t.rq || !Game.isHome(user, t.base) ? ' disabled' : '') + '>征兵</button>';
        } else h += '<div class="good" style="margin-top:8px">' + (wnd > 0 ? '其餘兵力已滿' : '兵力已滿') + '</div>';
        h += '</div></div></div>';
      });
      h += '<div class="muted">提示：戰鬥損失的兵力約一半會成為<span class="wtxt">傷兵</span>，部隊回主城待命時自動治療，比征兵便宜且不耗預備兵。出征距離越遠士氣越低（6 格外每格 -1.5，最低 40），傷害隨之下降；善用要塞與同盟城池作為前線駐地。<br>大營陣亡即戰敗。前鋒放防禦高的近戰武將，大營放攻擊距離遠的核心武將。三人同陣營或同兵種有額外加成。騎克步、步克弓、弓克騎。</div>';
      return h;
    },

    recruit() {
      let h = '<div class="packs">';
      for (const pk of CFG.PACKS) {
        h += '<div class="pack"><div class="pn">' + pk.name + '</div><div class="pr">' + pk.rates.map(([s, r]) => s + '★ ' + (r * 100).toFixed(1) + '%').join('　') + (pk.count ? '<br>五連抽保底四星' : '') + '</div>' + costHtml(pk.price) + '<br><button class="btn big ' + (pk.price.gold ? 'red' : '') + '" data-act="draw" data-pack="' + pk.key + '">招募' + (pk.count ? '五次' : '') + '</button></div>';
      }
      h += '</div>';
      if (drawResult) h += '<div class="sec-t">招募結果</div><div class="draw-result">' + drawResult.map((x, k) => heroCardHtml(x, { cls: 's' + Game.tpl(x).star, noTeam: true }).replace('class="hcard', 'style="animation-delay:' + (k * 0.12) + 's" class="hcard')).join('') + '</div>';
      h += '<div class="muted" style="margin-top:14px">金銖每日自動發放 ' + CFG.DAILY_GOLD + '，完成任務也可獲得。重複的武將可在「武將」頁面進階（+10 屬性點）或傳承戰法。</div>';
      return h;
    },

    recharge() {
      let h = '<div class="muted">本遊戲為單機模擬，「儲值」不需付費，僅為體驗課長玩法。</div><div class="packs" style="margin-top:12px">';
      for (const [amt, lab] of [[680, '小月卡'], [3280, '中額禮包'], [6480, '648 大禮包']]) h += '<div class="pack"><div class="pn">' + lab + '</div><div class="pr">獲得 ' + amt + ' 金銖</div><button class="btn gold big" data-act="recharge" data-amt="' + amt + '">儲值</button></div>';
      h += '<div class="pack"><div class="pn">銅幣禮包</div><div class="pr">獲得 500,000 銅幣</div><button class="btn gold big" data-act="recharge" data-kind="copper" data-amt="500000">儲值</button></div>';
      return h + '</div><div style="margin-top:10px">目前金銖：' + U.fmtFull(user.gold) + '</div>';
    },

    skills() {
      let h = '<div class="muted">戰法來源：武將自帶戰法、傳承（消耗三星以上武將）。B 級戰法傳承即可學會；A 級傳承得 ' + CFG.INHERIT_PROG.A + '%、S 級得 ' + CFG.INHERIT_PROG.S + '% 演練進度，需消耗其他武將<b>演練</b>至 100% 才能學習。<br>戰法 1~10 級，效果 ' + Math.round(CFG.skillScale(1) * 100) + '%~100%，以<b>戰法點</b>升級；戰法點來自<b>轉化</b>武將與每日發放。武將 5 級開啟第二戰法欄、20 級或覺醒後開啟第三戰法欄。</div>';
      h += '<div class="sec-t">戰法點 ' + U.fmtFull(user.skp) + '</div>';
      const drills = Object.keys(user.libp);
      h += '<div class="sec-t">事件戰法</div><div class="muted" style="font-size:12px">集齊指定武將（需未上陣，兌換時消耗）即可直接學會，不需演練。</div>';
      for (const ev of EVENT_SKILLS) {
        const sk = SKILLS[ev.skill];
        if (!sk) continue;
        const st = Game.eventStatus(user, ev);
        h += '<div class="drill"><span style="min-width:88px">' + ev.name + '</span><span class="q-' + sk.q + '" style="min-width:80px" title="' + E(sk.desc) + '">【' + sk.name + '】</span><span style="flex:1">' + ev.heroes.map(n => '<span class="' + (st.missing.includes(n) ? 'muted' : 'good') + '">' + n + '</span>').join('、') + '</span>' +
          (st.done ? '<span class="good">已擁有</span>' : '<button class="btn small gold" data-act="event" data-ev="' + ev.id + '"' + (st.missing.length ? ' disabled' : '') + '>兌換</button>') + '</div>';
      }
      h += '<div class="sec-t">研究中（演練）</div>';
      if (!drills.length) h += '<div class="muted">沒有研究中的戰法。傳承 A/S 級戰法後會出現在這裡。</div>';
      for (const sid of drills) {
        const sk = SKILLS[sid];
        h += '<div class="drill"><span class="q-' + sk.q + '" style="min-width:88px">' + sk.name + '</span><div class="bar"><i style="width:' + user.libp[sid] + '%"></i></div><span>' + Math.floor(user.libp[sid]) + '%</span><button class="btn small" data-act="drillpick" data-sid="' + sid + '">演練</button></div>';
      }
      if (panelArg && panelArg.drill && user.libp[panelArg.drill] !== undefined) {
        const sid = panelArg.drill;
        const idle = user.heroes.filter(x => x.team < 0).sort((a, b) => Game.tpl(a).star - Game.tpl(b).star || a.lv - b.lv);
        h += '<div class="sec-t" style="font-size:15px">選擇演練素材：【' + SKILLS[sid].name + '】 <button class="btn small dark" data-act="drillcancel">取消</button></div>';
        h += '<div class="muted" style="font-size:12px">每名武將依星級增加進度：' + [1, 2, 3, 4, 5].map(k => k + '★ +' + CFG.DRILL_PROG[k] + '%').join('　') + '（素材武將會被消耗）</div>';
        h += '<div class="picker">' + (idle.map(x => heroCardHtml(x, { act: 'drillhero', noTeam: true })).join('') || '<div class="muted">沒有閒置武將</div>') + '</div>';
      }
      h += '<div class="sec-t">已學會</div>';
      h += '<table class="tbl" style="margin-top:8px"><tr><th>戰法</th><th>類型</th><th>品質</th><th>說明</th><th>使用武將</th></tr>';
      const TY = { active: '主動', passive: '被動', command: '指揮', pursuit: '追擊' };
      for (const sid of user.lib) {
        const s = SKILLS[sid];
        const users = user.heroes.filter(x => x.sk.includes(sid)).map(x => Game.tpl(x).name + ' Lv' + (x.sl[x.sk.indexOf(sid)] || 1));
        h += '<tr><td class="q-' + s.q + '">' + s.name + '</td><td>' + TY[s.type] + (s.chance ? ' ' + Math.round(s.chance * 100) + '%' : '') + (s.prep ? ' 準備' + s.prep : '') + '</td><td class="q-' + s.q + '">' + s.q + '</td><td>' + s.desc + (s.troops ? '（限' + s.troops.join('/') + '）' : '') + '</td><td class="muted">' + (users.join('、') || '-') + '</td></tr>';
      }
      return h + '</table>';
    },

    reports() {
      const reps = G.reports;
      if (!repSel && reps.length) repSel = reps[0].id;
      const cur = reps.find(r => r.id === repSel);
      if (cur) cur.read = true;
      let h = '<div class="rep-layout"><div class="rep-list" data-keep="rl"><div style="padding:4px"><button class="btn small dark" data-act="readall">全部已讀</button></div>';
      h += reps.map(r => '<div class="ritem' + (r.id === repSel ? ' sel' : '') + (r.read ? '' : ' unread') + '" data-act="report" data-id="' + r.id + '"><span class="rr ' + (r.win ? 'good' : 'bad') + '">' + (r.asDef ? (r.win ? '守住' : '失守') : (r.win ? '勝' : '敗')) + '</span>' +
        (r.asDef ? '【防守】' : '') + E(r.target) + ' <span class="muted">(' + World.X(r.tile) + ',' + World.Y(r.tile) + ')</span><br><span class="muted" style="font-size:11px">' + U.fmtClock(r.t) + '　' + E(r.atkName) + ' vs ' + E(r.defName || '守軍') + '</span></div>').join('') || '<div class="muted" style="padding:8px">暫無戰報</div>';
      h += '</div><div class="rep-detail">';
      if (cur) {
        h += '<div class="sec-t">' + E(cur.target) + ' <span class="link" data-act="gototile" data-tile="' + cur.tile + '">(' + World.X(cur.tile) + ',' + World.Y(cur.tile) + ')</span>　<span class="' + (cur.win ? 'good' : 'bad') + '">' + E(cur.result) + '</span></div>';
        cur.battles.forEach((b, k) => {
          h += '<div class="bside"><div class="col">' + b.A.slice().sort((x, y) => y.slot - x.slot).map(bu).join('') + '</div><div class="vs">VS</div><div class="col">' + b.D.slice().sort((x, y) => x.slot - y.slot).map(bu).join('') + '</div></div>';
          h += '<div class="muted" style="text-align:center">第 ' + (k + 1) + ' 場：對陣 ' + E(b.def) + '　' + (b.winner === 'atk' ? '<span class="good">進攻方勝</span>' : b.winner === 'def' ? '<span class="bad">防守方勝</span>' : '<span class="warn">平局</span>') + '（' + b.rounds + ' 回合）' + (b.morale !== undefined && b.morale < 100 ? '　進攻方' + moraleTag(b.morale) : '') +
            (Replay.canReplay(b) ? '　<button class="btn small gold" data-act="replay" data-k="' + k + '">▶ 戰鬥回放</button>' : '') + '</div>';
          if (b.log && b.log.length) h += '<div class="blog">' + b.log.map(l => '<div class="' + l.c + '">' + E(l.t) + '</div>').join('') + '</div>';
        });
      } else h += '<div class="muted">選擇一份戰報查看詳情</div>';
      return h + '</div></div>';
    },

    alliance() {
      if (user.alliance < 0) {
        let h = '';
        const inv = (G.invites || []).filter(x => G.alliances[x.a] && !G.alliances[x.a].dead);
        if (inv.length) h += '<div class="target-box"><b>同盟邀請：</b>' + inv.map(x => { const a = G.alliances[x.a]; return '〔' + E(a.name) + '〕（' + a.members.length + '人，' + World.states[a.state].name + '）<button class="btn small gold" data-act="join" data-a="' + a.id + '">接受</button>'; }).join('　') + '</div>';
        h += '<div class="sec-t">創建同盟</div><div style="display:flex;gap:6px;align-items:center"><input id="alli-name-in" maxlength="8" placeholder="同盟名稱(1~8字)" style="background:#efe2c2;border:1px solid #8d6b33;padding:5px"><button class="btn red" data-act="create">創建（銅幣 10000）</button></div>';
        if (user.copper < CFG.ALLIANCE_CREATE_COST.copper) h += '<div class="warn" style="margin-top:4px">目前銅幣 ' + U.fmtFull(Math.floor(user.copper)) + '，不足 10000。升級民居可提高銅幣收入，或 <span class="link" data-act="open" data-panel="recharge">模擬儲值銅幣</span>。</div>';
        h += '<div class="sec-t">加入同盟</div><table class="tbl"><tr><th>同盟</th><th>盟主</th><th>人數</th><th>城池</th><th>勢力</th><th>主要州</th><th></th></tr>';
        const al = G.alliances.filter(a => !a.dead).sort((a, b) => (b.state === user.state) - (a.state === user.state) || b.power - a.power);
        for (const a of al) {
          h += '<tr><td style="color:' + a.color + '">〔' + E(a.name) + '〕</td><td>' + E(Game.P[a.leader].name) + '</td><td>' + a.members.length + '/' + CFG.ALLIANCE_MAX + '</td><td>' + a.cities.length + '</td><td>' + U.fmt(a.power) + '</td><td>' + World.states[a.state].name + (a.state === user.state ? ' <span class="good">(同州)</span>' : '') + '</td><td><button class="btn small" data-act="join" data-a="' + a.id + '"' + (a.members.length >= CFG.ALLIANCE_MAX ? ' disabled' : '') + '>申請加入</button></td></tr>';
        }
        return h + '</table>' + (al.length ? '' : '<div class="muted">目前還沒有同盟，AI 盟主們正在組建中……</div>');
      }
      const a = G.alliances[user.alliance];
      const tab = panelTab || 'info';
      let h = '<div class="alli-head"><div class="alli-flag" style="background:' + a.color + '">' + E(a.name.slice(0, 1)) + '</div><div><div class="alli-name">〔' + E(a.name) + '〕</div><div class="muted">盟主 ' + E(Game.P[a.leader].name) + '　成員 ' + a.members.length + '/' + CFG.ALLIANCE_MAX + '　城池 ' + a.cities.length + '　積分 ' + Game.alliancePoints(a) + '　勢力 ' + U.fmt(a.power) + '</div><div class="muted">城池產量加成 +' + Math.round(Game.allianceBonus(user) * 100) + '%</div></div><div style="margin-left:auto"><button class="btn small dark" data-act="leave">退出同盟</button></div></div>';
      h += tabs([['info', '戰略'], ['members', '成員'], ['cities', '城池']], tab);
      if (tab === 'info') {
        if (a.target >= 0) {
          const c = World.cities[a.target];
          h += '<div class="target-box"><b>當前目標：</b>' + CFG.CITY_TYPE_NAME[c.type] + '【' + c.name + '】Lv.' + c.lvl + ' <span class="link" data-act="gototile" data-tile="' + c.tiles[(c.tiles.length / 2) | 0] + '">(' + c.cx + ',' + c.cy + ')</span>　階段：' + (a.phase === 'siege' ? '<span class="bad">攻城中</span>' + (a.rallyAt > G.time ? '（集結倒數 ' + U.fmtDur(a.rallyAt - G.time) + '）' : '') : '<span class="warn">鋪路中</span>') + '<br>耐久 ' + Math.round(c.dur) + '/' + c.maxDur;
          if (a.leader === user.id) h += ' <button class="btn small dark" data-act="cleartarget">取消目標</button>';
          h += '<div class="muted" style="margin-top:4px">鋪路：佔領通往目標的土地（地圖上黃色虛線格）。路通後全盟集結，先擊敗守軍，再以兵力拆除耐久。</div></div>';
        } else h += '<div class="target-box">目前沒有同盟目標。' + (a.leader === user.id ? '你是盟主：點選地圖上的城池，選「設為同盟目標」。' : '等待盟主下令。') + '</div>';
        h += '<div class="sec-t">同盟頻道（最近）</div><div class="blog" style="max-height:260px">' + (G.chat.ally[a.id] || []).slice(-30).map(m => '<div>' + (m.sys ? '<span class="warn">' + E(m.text) + '</span>' : '<span class="good">' + E(m.name) + '</span>：' + E(m.text)) + '</div>').join('') + '</div>';
      } else if (tab === 'members') {
        const ms = a.members.map(id => Game.P[id]).sort((x, y) => y.power - x.power);
        h += '<table class="tbl"><tr><th>#</th><th>主公</th><th>職位</th><th>勢力</th><th>名望</th><th>領地</th><th>所在州</th><th>主城</th></tr>';
        ms.forEach((q, k) => { h += '<tr class="' + (q.id === user.id ? 'me' : '') + '"><td>' + (k + 1) + '</td><td>' + E(q.name) + '</td><td>' + (a.leader === q.id ? '<span class="warn">盟主</span>' : '成員') + '</td><td>' + U.fmt(q.power) + '</td><td>' + U.fmt(q.fame) + '</td><td>' + q.landCount + '</td><td>' + World.states[q.state].name + '</td><td><span class="link" data-act="gotoplayer" data-pid="' + q.id + '">(' + World.X(q.cityTile) + ',' + World.Y(q.cityTile) + ')</span>' + (q.captor >= 0 ? ' <span class="bad">淪陷</span>' : '') + '</td></tr>'; });
        h += '</table>';
      } else {
        h += '<table class="tbl"><tr><th>城池</th><th>類型</th><th>等級</th><th>州</th><th>耐久</th><th>座標</th></tr>';
        for (const cid of a.cities) { const c = World.cities[cid]; h += '<tr><td>' + c.name + '</td><td>' + CFG.CITY_TYPE_NAME[c.type] + '</td><td>' + c.lvl + '</td><td>' + World.states[c.state].name + '</td><td>' + Math.round(c.dur) + '/' + c.maxDur + '</td><td><span class="link" data-act="gototile" data-tile="' + c.tiles[(c.tiles.length / 2) | 0] + '">(' + c.cx + ',' + c.cy + ')</span></td></tr>'; }
        h += '</table>' + (a.cities.length ? '' : '<div class="muted">尚未佔領城池</div>');
      }
      return h;
    },

    world() {
      let h = '<div class="legend"><span><i style="background:#3cbe50"></i>我方</span>';
      for (const a of G.alliances.filter(x => !x.dead).sort((x, y) => y.power - x.power).slice(0, 12)) h += '<span><i style="background:' + a.color + '"></i>〔' + E(a.name) + '〕' + a.cities.length + '城</span>';
      h += '</div><canvas id="bigworld" class="big-world" style="height:calc(100% - 40px)"></canvas>';
      const prev = Render.mode;
      if (prev !== 'alliance') { Render.setMode('alliance'); setTimeout(() => Render.setMode(prev), 50); }
      return h;
    },

    rank() {
      const tab = panelTab || 'power';
      let h = tabs([['power', '勢力榜'], ['fame', '名望榜'], ['kills', '殺敵榜'], ['alli', '同盟榜']], tab);
      if (tab === 'alli') {
        const al = G.alliances.filter(a => !a.dead).sort((a, b) => Game.alliancePoints(b) - Game.alliancePoints(a) || b.power - a.power);
        h += '<table class="tbl"><tr><th>#</th><th>同盟</th><th>盟主</th><th>人數</th><th>城池</th><th>積分</th><th>勢力</th></tr>';
        al.forEach((a, k) => { h += '<tr class="' + (a.id === user.alliance ? 'me' : '') + '"><td>' + (k + 1) + '</td><td style="color:' + a.color + '">〔' + E(a.name) + '〕</td><td>' + E(Game.P[a.leader].name) + '</td><td>' + a.members.length + '</td><td>' + a.cities.length + '</td><td>' + Game.alliancePoints(a) + '</td><td>' + U.fmt(a.power) + '</td></tr>'; });
        return h + '</table>';
      }
      const key = tab === 'power' ? p => p.power : tab === 'fame' ? p => p.fame : p => p.stats.kills;
      const ps = Game.P.slice().sort((a, b) => key(b) - key(a));
      const myRank = ps.indexOf(user) + 1;
      h += '<div class="muted">你的排名：第 ' + myRank + ' 名</div><table class="tbl"><tr><th>#</th><th>主公</th><th>同盟</th><th>' + { power: '勢力', fame: '名望', kills: '殺敵' }[tab] + '</th><th>領地</th><th>所在州</th></tr>';
      ps.slice(0, 100).forEach((q, k) => { h += '<tr class="' + (q.id === user.id ? 'me' : '') + '"><td>' + (k + 1) + '</td><td><span class="link" data-act="gotoplayer" data-pid="' + q.id + '">' + E(q.name) + '</span></td><td>' + (q.alliance >= 0 ? '〔' + E(G.alliances[q.alliance].name) + '〕' : '-') + '</td><td>' + U.fmtFull(key(q)) + '</td><td>' + q.landCount + '</td><td>' + World.states[q.state].name + '</td></tr>'; });
      return h + '</table>';
    },

    season() {
      const d = Game.day();
      let h = '<div class="timeline">';
      CFG.PHASES.forEach((p, k) => {
        const next = CFG.PHASES[k + 1];
        const cur = d >= p.day && (!next || d < next.day);
        h += '<div class="phase' + (cur ? ' cur' : d >= p.day ? ' past' : '') + '"><div class="pn">' + p.name + '</div><div class="pd">第 ' + (p.day + 1) + ' 天起</div><div class="pd">' + p.desc + '</div></div>';
      });
      h += '</div>';
      const ly = World.cities.find(c => c.type === 'luoyang');
      h += '<div class="stats-grid">';
      h += '<div><span>賽季進度</span><span>第 ' + (d + 1) + ' / ' + CFG.SEASON_DAYS + ' 天</span></div>';
      h += '<div><span>洛陽</span><span>' + (ly.alliance >= 0 ? '〔' + E(G.alliances[ly.alliance].name) + '〕堅守 ' + U.fmtDur(G.time - ly.holdSince) + '/48時' : (Game.cityLockedDay(ly) > d ? '第 15 天開放' : '無主')) + '</span></div>';
      h += '<div><span>已被佔領城池</span><span>' + World.cities.filter(c => !World.isPlayerCity(c) && c.alliance >= 0).length + '</span></div>';
      h += '<div><span>存活同盟</span><span>' + G.alliances.filter(a => !a.dead).length + '</span></div></div>';
      h += '<div class="sec-t">勝利條件</div><div class="muted">① 佔領洛陽並堅守 48 小時，成就「霸業」，賽季提前結束。<br>② 第 ' + CFG.SEASON_DAYS + ' 天結算時，城池積分最高的同盟為本季霸主（縣城10、關口20、郡城30、州府100、洛陽500）。</div>';
      h += '<div class="sec-t">同盟積分</div><table class="tbl"><tr><th>#</th><th>同盟</th><th>積分</th><th>城池</th><th>人數</th></tr>';
      G.alliances.filter(a => !a.dead).sort((a, b) => Game.alliancePoints(b) - Game.alliancePoints(a)).slice(0, 10).forEach((a, k) => { h += '<tr class="' + (a.id === user.alliance ? 'me' : '') + '"><td>' + (k + 1) + '</td><td style="color:' + a.color + '">〔' + E(a.name) + '〕</td><td>' + Game.alliancePoints(a) + '</td><td>' + a.cities.length + '</td><td>' + a.members.length + '</td></tr>'; });
      h += '</table><div class="sec-t">天下大事</div><div class="blog" style="max-height:200px">' + G.news.slice(0, 30).map(n => '<div><span class="muted">' + U.fmtClock(n.t) + '</span> ' + E(n.text) + '</div>').join('') + '</div>';
      return h;
    },

    quests() {
      let h = '';
      for (const q of QUESTS) {
        const done = q.check(user), got = user.quests[q.id];
        h += '<div class="quest"><div><div class="qn">' + q.name + '</div><div class="muted">' + q.desc + '　獎勵：' + rewardText(q.reward) + '</div></div>' + (got ? '<span class="muted">已領取</span>' : '<button class="btn small ' + (done ? 'gold' : '') + '" data-act="claim" data-q="' + q.id + '"' + (done ? '' : ' disabled') + '>' + (done ? '領取' : '未完成') + '</button>') + '</div>';
      }
      return h;
    },

    settings() {
      let h = '<div class="sec-t">存檔</div><button class="btn" data-act="save">立即存檔</button> <span class="muted">（每分鐘自動存檔；關閉頁面時天下暫停）</span>';
      h += '<div class="sec-t">存檔紀錄</div><div class="muted" style="font-size:12px;margin-bottom:4px">保留手動存檔（20 份）、每個遊戲日的自動備份（10 份）與重開賽季前的備份（5 份），可讀回任一份。</div><div id="save-hist" class="hist-list">讀取中…</div>';
      if (typeof Mobile !== 'undefined' && Mobile.canLock) h += '<div class="sec-t">螢幕方向</div><div class="muted" style="font-size:12px;margin-bottom:4px">鎖定後轉動手機畫面也不會跟著旋轉（會進入全螢幕，離開全螢幕即解除）。' + (Mobile.locked ? '目前鎖定：' + (Mobile.locked === 'portrait' ? '直屏' : '橫屏') : '') + '</div><button class="btn small" data-act="olock" data-o="landscape">鎖定橫屏</button> <button class="btn small" data-act="olock" data-o="portrait">鎖定直屏</button> <button class="btn small dark" data-act="ounlock">解除鎖定</button>';
      h += '<div class="sec-t">遊戲速度</div><div class="muted">1× = 每真實秒過 1 遊戲分鐘。畫面右上可切換 1×/2×/5×/10×/20×。空白鍵暫停。</div>';
      h += '<div class="sec-t">操作</div><div class="muted">拖曳平移地圖・滾輪縮放・點擊土地查看/出征・WASD/方向鍵移動・H 回主城・Esc 關閉視窗</div>';
      if (typeof CardArt !== 'undefined') h += '<div class="sec-t">武將卡圖</div><label class="muted"><input type="checkbox" data-act="cardart"' + (CardArt.on ? ' checked' : '') + '> 顯示官網武將卡圖（執行時直接從《率土之濱》官網載入，只在這個瀏覽器生效，不存檔、不上傳）</label>';
      h += '<div class="sec-t">其他</div><button class="btn" data-act="open" data-panel="help">新手指南</button> <button class="btn red" data-act="restart">重新開始新賽季</button>';
      return h;
    },

    help() {
      const L = s => '<div class="sec-t">' + s + '</div>';
      return '<div style="line-height:1.9">' +
        L('一、開荒') +
        '・點擊主城周圍的土地，選「出征」派部隊佔領。只能攻打與<b>自己或同盟領地相鄰</b>的土地；跨州要經過<b>關口</b>。<br>' +
        '・土地 1~9 級，等級越高守軍越強、產量越高（6 級以上有兩隊守軍）。先打 1~3 級地讓武將升級，再挑戰高級地；出征選單會標示勝算與士氣。<br>' +
        '・領地數量受<b>名望</b>限制；首次佔領土地、升級建築、參與攻城可提高名望。領地滿了就「放棄」低級地換高級地。<br>' +
        '・前 ' + CFG.PROTECT_DAYS + ' 天主城受新手保護，別人打不了你。' +
        L('二、內政建築') +
        '・「主城」頁升級建築：伐木場/煉鐵場/採石場/農場提高產量，民居產銅幣，倉庫提高存量，校場增加部隊（最多 5 支），兵營提高帶兵上限，統帥廳提高統御，城牆提高主城耐久與城防，尚武/鐵壁/軍機/疾風營提升全武將屬性。<br>' +
        '・君王殿決定其他建築上限，升級需要四種資源建築達到一定等級。建造隊列同時 2 個。<br>' +
        '・<b>預備兵</b>：征兵要消耗預備兵，由<b>募兵所</b>每小時產出（' + CFG.reserveProd(0) + ' + 400×等級），並有上限。' +
        L('三、經濟行動（在自己的土地上點選）') +
        '・<b>屯田</b>：派部隊到自己的土地，抵達後一次收取該地 ' + CFG.FARM_HOURS + ' 小時產量，消耗 ' + CFG.COST_FARM + ' 體力。缺哪種資源就屯哪種地。<br>' +
        '・<b>練兵</b>：部隊在自己的土地練兵 ' + CFG.TRAIN_MIN + ' 分鐘，每分鐘獲得經驗（土地越高級越多），不會損兵，消耗 ' + CFG.COST_TRAIN + ' 體力。<br>' +
        '・<b>掃蕩</b>：攻打自己土地的守軍賺經驗，土地不會丟，但損兵照算，消耗 ' + CFG.COST_SWEEP + ' 體力。滿地時練武將的好方法。' +
        L('四、據點：要塞・營帳・分城・遷城') +
        '・<b>要塞</b>：在自己的土地建造（' + CFG.FORT_BUILD_MIN + ' 分鐘，最多 ' + CFG.FORT_MAX + ' 座），部隊可「調動」過去駐紮、從那裡出征。<br>' +
        '・<b>營帳</b>：便宜、' + CFG.CAMP_BUILD_MIN + ' 分鐘搭好的臨時駐地（最多 ' + CFG.CAMP_MAX + ' 座），' + (CFG.CAMP_LIFE_MIN / 60) + ' 小時後自動拆除，適合臨時推進。<br>' +
        '・<b>分城</b>：以自己的一格為中心、周圍 3×3 都是自己的空地時可建（君王殿 ' + CFG.BRANCH_PALACE + ' 級、名望 15000；名望 50000 可建第二座；距主城至少 8 格，建造 ' + (CFG.BRANCH_BUILD_MIN / 60) + ' 小時）。分城可駐紮、<b>征兵、治療傷兵</b>，四資源各 +' + CFG.BRANCH_OUTPUT + '/時，那 9 格也不再佔領地名額。會被敵人攻打摧毀。<br>' +
        '・<b>遷城</b>：把主城搬到 3×3 都是自己空地的位置（金銖 ' + CFG.RELOCATE_COST.gold + '、銅幣 ' + CFG.RELOCATE_COST.copper + '，冷卻 ' + (CFG.RELOCATE_CD_MIN / 60) + ' 小時，所有部隊需待命）。' +
        L('五、武將') +
        '・「招募」抽武將：名將卡包用金銖，良將卡包用銅幣；五連抽保底四星。金銖每日發放 ' + CFG.DAILY_GOLD + '。<br>' +
        '・武將每 10 級得 10 屬性點，加點可隨時<b>免費重置</b>。同名武將可<b>進階</b>（+10 屬性點，最多 5 次）。<br>' +
        '・<b>覺醒</b>：四星以上武將消耗 3 名星級 ≥ 本身 -1 的閒置武將，立即開啟第三戰法欄、基礎屬性 +' + Math.round(CFG.AWAKEN_STAT * 100) + '%、再 +' + CFG.AWAKEN_POINTS + ' 屬性點。<br>' +
        '・多餘武將可<b>轉化</b>為戰法點，或當作演練、覺醒、事件戰法的素材。' +
        L('六、部隊與戰鬥') +
        '・每支部隊 3 名武將：<b>大營</b>（陣亡即敗）、中軍、前鋒。統御(cost)總和不可超過上限。前鋒放耐打的近戰，大營放攻擊距離遠的核心。<br>' +
        '・兵種克制：騎克步、步克弓、弓克騎。三人同陣營全屬性 +8%，三人同兵種攻防 +6%。<br>' +
        '・戰鬥：準備回合發動指揮/被動戰法，之後最多 8 回合依速度行動（主動戰法 → 普攻 → 追擊戰法）；8 回合未分勝負為平局。<br>' +
        '・<b>戰鬥回放</b>：在「戰報」每一場戰鬥旁按「▶ 戰鬥回放」，以戰場畫面重看戰鬥：雙方士兵方陣、武將頭像與兵力、發動戰法的字幕、箭矢與法術、傷害/治療數字、狀態與潰敗。右下「結算」看雙方損失、「武將詳情」看狀態與完整紀錄（點紀錄可跳到該步）、「▶▶」切換速度；左下可暫停與逐步（←/→、空白鍵、Esc 也可操作）。<br>' +
        '・<b>士氣</b>：從出發地（主城、分城、要塞、營帳、同盟城池）算距離，' + CFG.MORALE_FREE_TILES + ' 格外每格 -' + CFG.MORALE_PER_TILE + '，最低 ' + CFG.MORALE_MIN + '；士氣越低傷害越低（40 時只剩 58%）。遠征前先調動到前線據點。<br>' +
        '・<b>傷兵</b>：損失的兵力約一半變傷兵，部隊在主城或分城待命時自動治療（便宜、不耗預備兵）；其餘要「征兵」補充。<br>' +
        '・體力：出征、掃蕩消耗 20，屯田 30，每小時恢復 20。' +
        L('七、戰法') +
        '・戰法 1~10 級，以<b>戰法點</b>升級（1 級效果 ' + Math.round(CFG.skillScale(1) * 100) + '%、10 級 100%）。戰法點來自轉化武將與每日發放 ' + CFG.DAILY_SKP + '；更換或遺忘戰法返還 50%。<br>' +
        '・武將 5 級開第二戰法欄，20 級或覺醒後開第三戰法欄。<br>' +
        '・<b>傳承</b>三星以上武將取得其戰法：B/C/D 級直接學會，A 級 50%、S 級 25%，其餘需消耗其他武將<b>演練</b>至 100%。<br>' +
        '・<b>事件戰法</b>：在「戰法」頁集齊指定武將兌換，直接學會。' +
        L('八、同盟與攻城') +
        '・加入同盟後，同盟領地也可作為進攻起點。盟主設定目標後，全盟<b>鋪路</b>至城池旁，再<b>集結</b>同時出兵。<br>' +
        '・攻城：先擊敗城池守軍（' + CFG.GARRISON_RESET_MIN + ' 分鐘內未拆完耐久守軍會恢復），再用兵力拆除耐久，歸零即佔領。城池提供同盟全員產量加成與賽季積分。<br>' +
        '・主城被攻破會<b>淪陷</b>，' + CFG.CAPTURE_HOURS + ' 小時內上繳 20% 資源。' +
        L('九、賽季') +
        '・第 1~3 天開荒（主城保護）；第 4 天開放出生州關口；第 9 天開放司隸；第 15 天開放洛陽。<br>' +
        '・佔領洛陽並堅守 48 小時即成就霸業；或於第 30 天依同盟城池積分決定霸主。' +
        L('十、AI 主公') +
        '・天下共有 ' + (G.aiCount || 150) + ' 位 AI 主公，有新手、休閒、普通、老手與課長，會開荒、結盟、鋪路、攻城、搶地、報復、屯田練兵、建營帳分城，也會在頻道聊天。你在線時他們與你同時行動，離線時天下暫停。<br>' +
        '・AI 各有<b>個性</b>：<b>火爆</b>的會跟鄰居結仇、在世界頻道互嗆並互搶地；每季有幾位<b>好戰者</b>專門打人、攻打主城；<b>叛徒</b>會在同盟交戰時倒戈投敵（標記 [叛徒]）；<b>龜縮</b>的只種田不打架；<b>梟雄</b>會收服附近弱盟為<b>附庸</b>，附庸聽其號令、跟打同一座城。<br>' +
        '・<b>你當盟主時</b>，附近的 AI 會陸續申請加入你的同盟，並依你設定的目標鋪路、集結攻城（點城池選「設為同盟目標」）。小心盟裡混進叛徒。' +
        L('操作') +
        '・拖曳 / WASD / 方向鍵平移，滾輪或雙指縮放；H 回主城；空白鍵暫停；右上可調速度。</div>';
    },

    settle() {
      const a = G.alliances[G.winner];
      let h = '<div class="settle"><div class="title-seal">賽季結算</div><h2>' + (a ? '〔' + E(a.name) + '〕' : '天下未定') + '</h2><div class="muted">' + (G.endReason === '霸業' ? '堅守洛陽，成就霸業' : '城池積分第一，為本季霸主') + '</div>';
      const my = user.alliance >= 0 ? G.alliances[user.alliance] : null;
      h += '<div class="stats-grid" style="max-width:520px;margin:18px auto;text-align:left">';
      h += '<div><span>我的同盟</span><span>' + (my ? '〔' + E(my.name) + '〕' + (my.id === G.winner ? ' <span class="good">霸主！</span>' : '') : '無') + '</span></div>';
      h += '<div><span>名望</span><span>' + U.fmtFull(user.fame) + '</span></div><div><span>領地</span><span>' + user.landCount + '</span></div>';
      h += '<div><span>殺敵</span><span>' + U.fmtFull(user.stats.kills) + '</span></div><div><span>參與攻城</span><span>' + user.stats.cities + '</span></div>';
      const rank = Game.P.slice().sort((x, y) => y.power - x.power).indexOf(user) + 1;
      h += '<div><span>勢力排名</span><span>第 ' + rank + ' 名</span></div></div>';
      h += '<button class="btn big red" data-act="newseason">開啟新賽季</button> <button class="btn big dark" data-act="close">留在本季觀看</button></div>';
      return h;
    },
  };
  function bu(u) {
    const col = FACTION_COLOR[u.faction] || '#6d6177';
    return '<div class="bu" style="border-top:3px solid ' + col + faceStyle(HERO_BY_NAME[u.name]) + '"><b>' + E(u.name) + '</b>Lv' + u.lv + ' ' + u.troop + '<br><span class="' + (u.end > 0 ? '' : 'bad') + '">' + u.end + '</span><span class="muted">/' + u.start + '</span></div>';
  }

  function heroDetail() {
    const h = Game.heroByUid(user, heroSel);
    if (!h) return '<div class="muted">選擇武將查看詳情</div>';
    const t = Game.tpl(h);
    const s = Game.heroStats(user, h);
    const fp = Game.freePoints(h);
    let o = '<div class="hd-top">' + heroCardHtml(h, { noTeam: true }) + '<div><div class="hd-name">' + t.name + '</div><div class="muted">' + '★'.repeat(t.star) + '　' + t.faction + '・' + t.troop + '兵　統御 ' + t.cost + '　攻擊距離 ' + t.range + '</div>' + (t.icon ? '' : '<div class="muted" style="font-size:11px">非官方武將（本作自訂數值）</div>');
    o += '<div>等級 ' + h.lv + (h.lv < CFG.HERO_MAX_LV ? '　<span class="muted">經驗 ' + Math.floor(h.exp) + '/' + CFG.expNeed(h.lv) + '</span>' : '　<span class="warn">已滿級</span>') + '</div>';
    o += '<div class="bar exp"><i style="width:' + (h.lv >= CFG.HERO_MAX_LV ? 100 : h.exp / CFG.expNeed(h.lv) * 100) + '%"></i></div>';
    o += '<div class="muted" style="margin-top:3px">兵力 ' + h.troops + '/' + Game.heroCap(user, h) + (h.wnd > 0 ? ' <span class="wtxt">傷兵 ' + h.wnd + '</span>' : '') + '　體力 ' + Math.floor(Game.getSta(h)) + '/' + CFG.STAMINA_MAX + '</div>';
    o += '<div class="muted">' + (h.team >= 0 ? '所屬：第' + (h.team + 1) + '部隊' : '未上陣') + (h.adv ? '　進階 ' + h.adv + '/5' : '') + (h.awk ? '　<span class="good">已覺醒</span>' : '') + '</div></div></div>';
    o += '<div class="sec-t">屬性' + (fp > 0 ? ' <span class="good" style="font-size:13px">可分配 ' + fp + ' 點</span>' : '') + '</div>';
    for (const [k, n, g] of [['atk', '攻擊', 'atkG'], ['def', '防禦', 'defG'], ['int', '謀略', 'intG'], ['spd', '速度', 'spdG']]) {
      o += '<div class="attr"><span class="muted">' + n + '</span><span class="v">' + s[k].toFixed(1) + ' <span class="g">(+' + t[g] + '/級' + (h.pts[k] ? '，加點 ' + h.pts[k] : '') + ')</span></span><span>' + (fp > 0 ? '<button class="btn small pbtn" data-act="addpt" data-stat="' + k + '">+1</button> <button class="btn small pbtn" style="width:32px" data-act="addpt" data-stat="' + k + '" data-n="' + fp + '">+' + fp + '</button>' : '') + '</span></div>';
    }
    o += '<div class="attr"><span class="muted">攻城</span><span class="v">' + s.siege + ' <span class="g">(+' + (t.siegeG || 0) + '/級)</span></span><span></span></div>';
    if (h.pts.atk + h.pts.def + h.pts.int + h.pts.spd > 0) o += '<button class="btn small dark" data-act="resetpt">重置加點</button>';
    o += '<div class="sec-t">戰法 <span class="muted" style="font-size:13px">戰法點 ' + U.fmtFull(user.skp) + '</span></div>';
    const TY = { active: '主動', passive: '被動', command: '指揮', pursuit: '追擊' };
    for (let k = 0; k < 3; k++) {
      const sid = h.sk[k];
      const unl = Game.slotUnlocked(h, k);
      if (!unl) { o += '<div class="skslot locked"><span class="muted">' + (k === 1 ? '5 級解鎖' : '20 級或覺醒後解鎖') + '</span></div>'; continue; }
      if (sid) {
        const sk = SKILLS[sid];
        const lv = h.sl[k] || 1;
        const up = lv < CFG.SKILL_MAX_LV ? CFG.skillUpCost(sk.q, lv) : 0;
        o += '<div class="skslot"><span class="sn q-' + sk.q + '">' + sk.name + '</span><span class="sklv">Lv' + lv + '/' + CFG.SKILL_MAX_LV + '　效果 ' + Math.round(CFG.skillScale(lv) * 100) + '%</span><span class="st">' + TY[sk.type] + (sk.chance ? ' ' + Math.round(sk.chance * 100) + '%' : '') + '</span>' + (k === 0 ? '<span class="st" style="background:#6e2a1a">自帶</span>' : ' <button class="btn small dark" data-act="learnpick" data-k="' + k + '">更換</button> <button class="btn small dark" data-act="learn" data-k="' + k + '" data-sid="">遺忘</button>') +
          (up ? ' <button class="btn small ' + (user.skp >= up ? 'green' : '') + '" data-act="skup" data-k="' + k + '"' + (user.skp >= up ? '' : ' disabled') + '>升級（' + up + ' 點）</button>' : ' <span class="good" style="font-size:12px">已滿級</span>') +
          '<div class="sd">' + sk.desc + '（數值為 10 級效果）</div></div>';
      } else o += '<div class="skslot"><button class="btn small" data-act="learnpick" data-k="' + k + '">學習戰法</button></div>';
    }
    if (panelArg && panelArg.learn) {
      o += '<div class="sec-t" style="font-size:15px">選擇要學習的戰法</div><div class="muted" style="font-size:12px">新學的戰法從 1 級開始；更換或遺忘會返還原戰法 ' + Math.round(CFG.SKILL_REFUND * 100) + '% 已投入戰法點。</div>';
      const opts = user.lib.filter(id => !h.sk.includes(id)).map(id => SKILLS[id]).filter(sk => !sk.troops || sk.troops.includes(t.troop));
      o += opts.map(sk => '<div class="skslot" style="cursor:pointer" data-act="learn" data-k="' + panelArg.learn + '" data-sid="' + sk.id + '"><span class="sn q-' + sk.q + '">' + sk.name + '</span><span class="st">' + TY[sk.type] + '</span><div class="sd">' + sk.desc + '</div></div>').join('') || '<div class="muted">沒有可學習的戰法（可透過傳承獲得，A/S 級戰法需演練至 100%）</div>';
    }
    // 進階/傳承
    const dupes = user.heroes.filter(x => x !== h && x.t === h.t && x.team < 0);
    o += '<div class="sec-t">覺醒</div>';
    if (h.awk) o += '<div class="good" style="font-size:13px">已覺醒：第三戰法欄開啟、基礎屬性 +' + Math.round(CFG.AWAKEN_STAT * 100) + '%、屬性點 +' + CFG.AWAKEN_POINTS + '</div>';
    else if (t.star < CFG.AWAKEN_MIN_STAR) o += '<div class="muted" style="font-size:12px">四星以上武將才能覺醒。</div>';
    else {
      const fd = Game.awakenFodder(user, h);
      o += '<div class="muted" style="font-size:12px">消耗 ' + CFG.AWAKEN_FODDER + ' 名 ' + (t.star - 1) + ' 星以上閒置武將（優先使用星級、等級最低者）：立即開啟第三戰法欄、基礎屬性 +' + Math.round(CFG.AWAKEN_STAT * 100) + '%、屬性點 +' + CFG.AWAKEN_POINTS + '。目前可用素材 ' + fd.length + ' 名。</div>';
      o += '<button class="btn small gold" data-act="awaken"' + (fd.length >= CFG.AWAKEN_FODDER ? '' : ' disabled') + '>覺醒</button>';
    }
    o += '<div class="sec-t">進階・傳承・轉化</div>';
    if (dupes.length && h.adv < 5) o += '<button class="btn small gold" data-act="advance" data-f="' + dupes[0].uid + '">進階（消耗同名武將，+10 屬性點）</button> ';
    else o += '<span class="muted" style="font-size:12px">擁有同名武將時可進階。</span> ';
    if (h.team < 0) {
      const sk0 = SKILLS[t.inherit];
      if (t.star >= 3) {
        if (user.lib.includes(t.inherit)) o += '<button class="btn small dark" disabled>已擁有【' + sk0.name + '】</button> ';
        else o += '<button class="btn small dark" data-act="inherit">傳承【' + sk0.name + '】（演練 +' + CFG.INHERIT_PROG[sk0.q] + '%）</button> ';
      }
      o += '<button class="btn small dark" data-act="convert">轉化為戰法點（+' + Math.round(Game.convertValue(h)) + '）</button>';
      const drills = Object.keys(user.libp);
      if (drills.length) {
        o += '<div class="muted" style="margin-top:6px;font-size:12px">作為演練素材（+' + CFG.DRILL_PROG[t.star] + '%）：</div>';
        o += drills.map(sid => '<button class="btn small" style="margin:2px" data-act="drill" data-sid="' + sid + '" data-uid="' + h.uid + '">' + SKILLS[sid].name + ' ' + Math.floor(user.libp[sid]) + '%</button>').join('');
      }
    } else o += '<div class="muted" style="font-size:12px">武將下陣後才能傳承、轉化或作為演練素材。</div>';
    return o;
  }

  return { init, update, toast, openPanel, closeModal, closeTile, saveMeta, snapshot, get user() { return user; } };
})();
