// 率土機制擴充：偵查、天氣、四季（以公開可核對的率土數值為基準）
'use strict';

var RateEarthSystems = (function () {
  const SEASONS = [
    { id: 'spring', name: '春', icon: '春', desc: '領土開拓：部隊行動體力消耗 -50%' },
    { id: 'summer', name: '夏', icon: '夏', desc: '欣欣向榮：屯田、練兵、開發政令 -1；行軍加速政令 -1' },
    { id: 'autumn', name: '秋', icon: '秋', desc: '士眾應招：主城預備兵恢復速度 +20%' },
    { id: 'winter', name: '冬', icon: '冬', desc: '難攻不落：己方城邑、軍事設施、建築受到的耐久傷害 -50%' },
  ];
  const WEATHER = {
    clear: { name: '晴', icon: '☀', march: 1, build: 1, desc: '無特殊效果' },
    cloudy: { name: '多雲', icon: '☁', march: 1, build: 1, desc: '無特殊效果' },
    overcast: { name: '陰', icon: '☁', march: 1, build: 1, desc: '無特殊效果' },
    shower: { name: '陣雨', icon: '🌦', march: 1, build: 1, desc: '無特殊效果' },
    light_rain: { name: '小雨', icon: '🌧', march: 1, build: 1, desc: '無特殊效果' },
    mid_rain: { name: '中雨', icon: '🌧', march: 1, build: 1.05, desc: '築城時間 +5%' },
    heavy_rain: { name: '大雨', icon: '🌧', march: 1, build: 1.10, desc: '築城時間 +10%' },
    light_snow: { name: '小雪', icon: '🌨', march: 1.05, build: 1, desc: '行軍時間 +5%' },
    mid_snow: { name: '中雪', icon: '🌨', march: 1.08, build: 1, desc: '行軍時間 +8%' },
    heavy_snow: { name: '大雪', icon: '❄', march: 1.10, build: 1, desc: '行軍時間 +10%' },
  };
  let installed = false;
  let lastHudKey = '';
  let scoutedTile = -1;

  function hash32(a, b, c) {
    let x = ((a | 0) ^ Math.imul((b | 0) + 1, 0x9e3779b1) ^ Math.imul((c | 0) + 7, 0x85ebca6b)) | 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
    return x >>> 0;
  }
  function seasonForDay(day) { return SEASONS[((day % 4) + 4) % 4]; }
  function season() { return seasonForDay(typeof Game !== 'undefined' ? Game.day() : 0); }

  // 原版天氣曾依現實地理/天氣同步；本靜態單機版沒有外部天氣服務，
  // 因此「效果數值」採公開原版值，天氣出現順序則由種子+日期穩定生成。
  function weatherIdFor(day, stateId, seed) {
    const s = seasonForDay(day).id;
    const r = hash32(seed || 1, day, stateId) % 100;
    if (s === 'winter') {
      if (r < 10) return 'heavy_snow';
      if (r < 24) return 'mid_snow';
      if (r < 42) return 'light_snow';
      if (r < 62) return 'overcast';
      if (r < 80) return 'cloudy';
      return 'clear';
    }
    if (s === 'summer') {
      if (r < 10) return 'heavy_rain';
      if (r < 24) return 'mid_rain';
      if (r < 40) return 'light_rain';
      if (r < 56) return 'shower';
      if (r < 76) return 'cloudy';
      return 'clear';
    }
    if (s === 'spring') {
      if (r < 8) return 'mid_rain';
      if (r < 22) return 'light_rain';
      if (r < 38) return 'shower';
      if (r < 60) return 'cloudy';
      if (r < 76) return 'overcast';
      return 'clear';
    }
    if (r < 5) return 'mid_rain';
    if (r < 14) return 'light_rain';
    if (r < 28) return 'shower';
    if (r < 48) return 'cloudy';
    if (r < 64) return 'overcast';
    return 'clear';
  }
  function weatherAt(tile, dayOffset) {
    if (typeof Game === 'undefined' || !Game.G || !Game.T || tile < 0) return WEATHER.clear;
    const st = Game.T.state[tile] || 0;
    const id = weatherIdFor(Game.day() + (dayOffset || 0), st, Game.G.seed || 1);
    return Object.assign({ id }, WEATHER[id]);
  }
  function weatherNameAt(tile) { const w = weatherAt(tile); return w.icon + ' ' + w.name; }
  function marchFactor(tile) { return weatherAt(tile).march || 1; }
  function buildFactor(tile) { return weatherAt(tile).build || 1; }

  function applyMarchWeather(m) {
    if (!m || m._rateWeather) return;
    const f = marchFactor(m.to);
    if (f !== 1) m.end = m.start + Math.max(1, (m.end - m.start) * f);
    m._rateWeather = f;
  }

  function refundSpringStamina(p, team, type) {
    if (!p || !team || season().id !== 'spring') return;
    const baseCost = { attack: CFG.COST_ATTACK, move: CFG.COST_MOVE, garrison: CFG.COST_GARRISON, farm: CFG.COST_FARM, train: CFG.COST_TRAIN, sweep: CFG.COST_SWEEP }[type];
    if (!(baseCost > 0)) return;
    // 本專案沒有獨立夜戰期，因此春季減耗套用於本遊戲全部部隊行動。
    for (const h of Game.teamHeroes(p, team)) if (h) {
      h.sta = Math.min(CFG.STAMINA_MAX, (h.sta || 0) + baseCost * 0.5);
      h.staT = Game.G.time;
    }
  }

  function patchBuild(fnName, tileOfResult) {
    const orig = Game[fnName];
    if (typeof orig !== 'function') return;
    Game[fnName] = function () {
      const args = arguments;
      const r = orig.apply(Game, args);
      if (!r || !r.ok) return r;
      const tile = tileOfResult(args, r);
      const f = buildFactor(tile);
      if (f !== 1) {
        if (r.city && r.city.building > Game.G.time) r.city.building = Game.G.time + (r.city.building - Game.G.time) * f;
        const p = args[0];
        if (fnName === 'upgradeBuilding' && p && p.bq && p.bq.length) {
          const q = p.bq[p.bq.length - 1];
          if (q && q.end > Game.G.time) q.end = Game.G.time + (q.end - Game.G.time) * f;
        }
      }
      return r;
    };
  }

  function installGamePatches() {
    if (installed || typeof Game === 'undefined') return;
    installed = true;

    const origNewGame = Game.newGame;
    Game.newGame = function (opts) {
      const g = origNewGame(opts);
      g.rateEnv = g.rateEnv || { version: 1 };
      return g;
    };
    const origLoad = Game.load;
    if (typeof origLoad === 'function') Game.load = function () {
      const r = origLoad.apply(Game, arguments);
      if (r && Game.G) Game.G.rateEnv = Game.G.rateEnv || { version: 1 };
      return r;
    };

    const origMarchTime = Game.marchTime;
    Game.marchTime = function (p, team, from, to) {
      return Math.max(2, Math.round(origMarchTime(p, team, from, to) * marchFactor(to)));
    };

    const origSend = Game.send;
    Game.send = function (p, ti, target, type) {
      const r = origSend(p, ti, target, type);
      if (r && r.ok) {
        applyMarchWeather(r.march);
        refundSpringStamina(p, p.teams[ti], type);
      }
      return r;
    };

    // 冬季「難攻不落」：耐久傷害 -50%。核心攻城統一經 siegeValue，直接套在結算源頭。
    const origSiegeValue = CFG.siegeValue;
    CFG.siegeValue = function () {
      const v = origSiegeValue.apply(CFG, arguments);
      return season().id === 'winter' ? v * 0.5 : v;
    };

    patchBuild('upgradeBuilding', args => args[0] ? args[0].cityTile : -1);
    patchBuild('buildFort', args => +args[1]);
    patchBuild('buildCamp', args => +args[1]);
    patchBuild('buildBranch', args => +args[1]);

    const origAdvance = Game.advance;
    Game.advance = function (minutes) {
      const before = Game.G.time || 0;
      const beforeDay = Game.day();
      const r = origAdvance(minutes);
      const elapsed = Math.max(0, (Game.G.time || 0) - before);
      // 內部 startReturn() 不走匯出的 marchTime；每次 advance 後補套一次天氣倍率。
      for (const m of Game.G.marches || []) applyMarchWeather(m);
      // 秋季主城預備兵恢復速度 +20%。核心已有 100%，此處補額外 20%。
      if (elapsed > 0 && seasonForDay(beforeDay).id === 'autumn') {
        for (const p of Game.P) {
          const cap = CFG.reserveCap(p.b.recruit);
          if (p.reserve < cap) p.reserve = Math.min(cap, p.reserve + CFG.reserveProd(p.b.recruit) / 60 * elapsed * 0.20);
        }
      }
      return r;
    };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function heroLabel(u) {
    const skills = (u.skills || []).map(s => SKILLS[s] ? SKILLS[s].name : s).filter(Boolean);
    return '<div style="padding:5px 0;border-bottom:1px solid rgba(120,90,45,.18)"><b>' + esc(u.name) + '</b>　' + esc(u.troop || '') + '　Lv.' + (u.lv || 0) + '<br><span class="muted">兵力 ' + Math.max(0, Math.round(u.troops || 0)) + (skills.length ? '　戰法：' + skills.map(esc).join('、') : '') + '</span></div>';
  }

  function scoutData(i) {
    const T = Game.T;
    const cityId = T.city[i];
    const city = cityId >= 0 ? World.cities[cityId] : null;
    const out = { title: '偵查情報', groups: [] };
    const owner = Game.tileOwner(i), alli = Game.tileAlliance(i);

    // 玩家駐軍：讀取實際配將、戰法與當前兵力。
    for (const q of Game.P) {
      if (q.id === Game.G.userId) continue;
      if (!(q.id === owner || (alli >= 0 && q.alliance === alli))) continue;
      for (const tm of q.teams) {
        const onTile = (tm.status === 'garrison' && (tm.gtile === i || (city && city.tiles.includes(tm.gtile)))) ||
          (city && tm.status === 'idle' && city.tiles.includes(tm.base));
        if (!onTile) continue;
        const units = Game.teamUnits(q, tm);
        if (units.length) out.groups.push({ name: q.name + ' 第' + (tm.id + 1) + '隊', units });
      }
    }

    // 系統守軍：直接使用實際戰鬥同一套 npcSquad()，避免偵查情報和真正交戰不一致。
    if (!city) {
      const L = T.lvl[i], g = CFG.GARRISON[L];
      const live = Game.G.landSiege[i] && Game.G.landSiege[i].until >= Game.G.time ? Game.G.landSiege[i].squads : null;
      for (let s = 0; s < g[0]; s++) {
        const troops = live && live[s] ? live[s].slice() : new Array(g[1]).fill(g[3]);
        out.groups.push({ name: '守軍第' + (s + 1) + '隊', units: Game.npcSquad(L, g[1], g[2], troops, i + s, false) });
      }
    } else if (!World.isPlayerCity(city) && city.alliance < 0) {
      const g = CFG.CITY_GARRISON[city.lvl];
      const squads = city.garrison || Array.from({ length: g[0] }, () => [g[2], g[2], g[2]]);
      squads.forEach((sq, s) => out.groups.push({ name: city.name + '守軍第' + (s + 1) + '隊', units: Game.npcSquad(city.lvl, 3, g[1], sq.slice(), city.id * 17 + s, true) }));
    } else if (city && city.type === 'main') {
      const o = Game.P[city.owner];
      const md = Game.mainCityDefense(o);
      const squads = city.garrison || md.squads;
      squads.forEach((sq, s) => out.groups.push({ name: o.name + ' 城防第' + (s + 1) + '隊', units: Game.npcSquad(city.lvl || 5, 3, city.gLv || md.heroLv, sq.slice(), i + s, true) }));
    }
    return out;
  }

  function renderScoutBox(pop, i) {
    if (!pop || pop.querySelector('.rate-scout-box')) return;
    const data = scoutData(i);
    const box = document.createElement('div');
    box.className = 'rate-scout-box';
    box.style.cssText = 'margin:8px 10px;padding:8px;background:rgba(239,226,194,.96);border:1px solid #8d6b33;max-height:240px;overflow:auto';
    let html = '<div style="display:flex;justify-content:space-between;align-items:center"><b>斥候偵查</b><span class="muted">' + weatherNameAt(i) + '</span></div>';
    if (!data.groups.length) html += '<div class="muted" style="padding-top:6px">未發現可辨識的守軍。</div>';
    else data.groups.forEach(g => { html += '<div style="margin-top:7px"><b>' + esc(g.name) + '</b>' + g.units.map(heroLabel).join('') + '</div>'; });
    box.innerHTML = html;
    const acts = pop.querySelector('.acts');
    if (acts) acts.insertAdjacentElement('beforebegin', box); else pop.appendChild(box);
  }
  function showScout(i) {
    scoutedTile = i;
    const pop = document.getElementById('tilepop');
    if (!pop) return;
    const old = pop.querySelector('.rate-scout-box');
    if (old) old.remove();
    renderScoutBox(pop, i);
  }

  function enhanceTilePop(pop) {
    if (!pop || pop.classList.contains('hidden') || !Game || !Game.T) return;
    const coord = pop.querySelector('.tp-c');
    if (!coord) return;
    const m = coord.textContent.match(/\((\d+),(\d+)\)/);
    if (!m) return;
    const x = +m[1], y = +m[2];
    if (!World.inb(x, y)) return;
    const i = World.idx(x, y);
    if (!pop.querySelector('.rate-weather-row')) {
      const w = weatherAt(i), n = weatherAt(i, 1), s = season();
      const row = document.createElement('div');
      row.className = 'row rate-weather-row';
      row.innerHTML = '<span>天時</span><span title="' + esc(w.desc) + '">' + s.icon + s.name + '季　' + w.icon + w.name + ' <small class="muted">明日 ' + n.icon + n.name + '</small></span>';
      const body = pop.querySelector('.tp-b');
      if (body) body.appendChild(row);
    }
    const friendly = Game.isFriendly(Game.P[Game.G.userId], i);
    if (scoutedTile === i) renderScoutBox(pop, i);
    if (!friendly && !pop.querySelector('[data-rate-scout]')) {
      const acts = pop.querySelector('.acts');
      if (acts) {
        const b = document.createElement('button');
        b.className = 'btn dark'; b.textContent = '偵查'; b.setAttribute('data-rate-scout', String(i));
        b.title = '查看目前守軍配將、戰法與兵力';
        acts.insertBefore(b, acts.firstChild);
      }
    }
  }

  function updateHud() {
    if (typeof document === 'undefined' || typeof Game === 'undefined' || !Game.G || !Game.P || !Game.P.length) return;
    const clock = document.getElementById('clock');
    if (!clock) return;
    const u = Game.P[Game.G.userId];
    if (!u) return;
    const w = weatherAt(u.cityTile), n = weatherAt(u.cityTile, 1), s = season();
    const key = Game.day() + ':' + w.id + ':' + s.id;
    let el = document.getElementById('rate-env');
    if (!el) {
      el = document.createElement('div'); el.id = 'rate-env';
      el.style.cssText = 'font-size:11px;line-height:1.25;margin-top:2px;cursor:help;white-space:nowrap';
      clock.insertBefore(el, document.getElementById('speed'));
    }
    if (key !== lastHudKey) {
      lastHudKey = key;
      el.innerHTML = '<b>' + s.icon + s.name + '季</b>　' + w.icon + w.name + ' <span style="opacity:.72">｜明日 ' + n.icon + n.name + '</span>';
      el.title = s.desc + '；目前天氣：' + w.desc;
    }
  }

  function installDom() {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-rate-scout]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      showScout(+b.getAttribute('data-rate-scout'));
    }, true);
    const pop = document.getElementById('tilepop');
    if (pop && typeof MutationObserver !== 'undefined') new MutationObserver(() => enhanceTilePop(pop)).observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    setInterval(updateHud, 500);
  }

  function init() { installGamePatches(); installDom(); }
  if (typeof window !== 'undefined') init();

  return { SEASONS, WEATHER, seasonForDay, weatherIdFor, weatherAt, marchFactor, buildFactor, scoutData, installGamePatches };
})();
