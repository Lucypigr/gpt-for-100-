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

  // 特殊天氣公開規則：開服第一週不出現；暴雪/凍雨/暴雨持續3~6小時，
  // 2小時後形成災害，天氣結束2小時後災害消失；霧持續2~3小時，
  // 1小時後形成大霧，天氣結束1小時後大霧消失。
  // 官方/攻略未公開「特殊天氣觸發機率」與「局部區域半徑」，因此本專案只讓
  // 持續時間、延遲與效果跟公開規則一致；觸發排程與範圍採固定種子生成，不冒充官方機率。
  const SPECIAL = {
    blizzard: { name: '局部暴雪', icon: '🌨', hazard: 'snow', hazardName: '積雪', durMin: 180, durMax: 360, delay: 120, tail: 120 },
    freezing_rain: { name: '局部凍雨', icon: '🧊', hazard: 'ice', hazardName: '冰凍', durMin: 180, durMax: 360, delay: 120, tail: 120 },
    fog: { name: '局部霧', icon: '🌫', hazard: 'fog', hazardName: '大霧', durMin: 120, durMax: 180, delay: 60, tail: 60 },
    storm: { name: '局部暴雨', icon: '⛈', hazard: 'flood', hazardName: '洪災', durMin: 180, durMax: 360, delay: 120, tail: 120 },
  };
  const HAZARD_MORALE = { fog: -10, ice: -10, snow: -10, flood: -20, sandstorm: -20, windstorm: -20 };
  const WIND_DIRS = [
    { name: '北風', dx: 0, dy: -1 }, { name: '東北風', dx: 1, dy: -1 },
    { name: '東風', dx: 1, dy: 0 }, { name: '東南風', dx: 1, dy: 1 },
    { name: '南風', dx: 0, dy: 1 }, { name: '西南風', dx: -1, dy: 1 },
    { name: '西風', dx: -1, dy: 0 }, { name: '西北風', dx: -1, dy: -1 },
  ];
  // 原作只描述「北部/南部」形成條件，沒有公開一張可直接映射到本專案十三州的清單。
  // 這裡依三國地理把本地圖州域分組；災害效果數值保持原作公開值。
  const NORTH_STATES = new Set(['涼州', '并州', '冀州', '幽州', '青州', '雍州', '兗州', '司隸']);
  const WIND_HAZARDS = {
    sandstorm: { name: '局部大風', icon: '🌪', hazard: 'sandstorm', hazardName: '沙塵暴' },
    windstorm: { name: '局部大風', icon: '💨', hazard: 'windstorm', hazardName: '風災' },
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
  function windFor(day, stateId, seed) {
    const h = hash32(seed || 1, day + 11003, stateId + 401);
    const h2 = hash32(seed || 1, day + 13007, stateId + 503);
    return { level: h % 6, dir: WIND_DIRS[h2 % WIND_DIRS.length], exactGeneration: false };
  }
  function windAt(tile, dayOffset) {
    if (typeof Game === 'undefined' || !Game.G || !Game.T || tile < 0) return { level: 0, dir: WIND_DIRS[0], exactGeneration: false };
    return windFor(Game.day() + (dayOffset || 0), Game.T.state[tile] || 0, Game.G.seed || 1);
  }

  function eventTypeFor(day, stateId, seed) {
    if (day < 7) return null; // 開服/新賽季第一週不產生特殊天氣
    const base = weatherIdFor(day, stateId, seed);
    const roll = hash32(seed || 1, day + 3001, stateId + 97) % 100;
    const s = seasonForDay(day).id;
    if (base === 'heavy_snow' || base === 'mid_snow' || base === 'light_snow') return roll < 36 ? 'blizzard' : null;
    if (base === 'heavy_rain' || base === 'mid_rain' || base === 'light_rain' || base === 'shower') return roll < 34 ? 'storm' : null;
    // 低溫陰濕區域可能形成凍雨；本專案以冬季陰/多雲作為觸發條件。
    if (s === 'winter' && (base === 'overcast' || base === 'cloudy')) return roll < 24 ? 'freezing_rain' : null;
    if ((base === 'overcast' || base === 'cloudy') && windFor(day, stateId, seed).level <= 1) return roll < 28 ? 'fog' : null;
    return null;
  }
  function specialEventForState(day, stateId, seed) {
    const type = eventTypeFor(day, stateId, seed);
    if (!type) return null;
    const def = SPECIAL[type];
    const h1 = hash32(seed || 1, day + 7001, stateId + 211);
    const h2 = hash32(seed || 1, day + 9001, stateId + 307);
    const dur = def.durMin + (h1 % (def.durMax - def.durMin + 1));
    // 事件在當日內開始；開始時刻並非官方公開數值，因此採種子固定排程。
    const maxStart = Math.max(1, 1440 - dur);
    const start = day * 1440 + (h2 % maxStart);
    const end = start + dur;
    const st = typeof World !== 'undefined' && World.states ? World.states[stateId] : null;
    let center = -1;
    if (st && st.cities && st.cities.length && World.cities) {
      const cid = st.cities[h1 % st.cities.length];
      const city = World.cities[cid];
      if (city) center = World.idx(city.cx, city.cy);
    }
    if (center < 0 && st) center = World.idx(Math.round(st.sx), Math.round(st.sy));
    const radius = 8 + (h2 % 6); // 局部範圍未公開，以固定8~13格模擬
    return {
      type, name: def.name, icon: def.icon, hazard: def.hazard, hazardName: def.hazardName,
      day, stateId, start, end, hazardStart: start + def.delay, hazardEnd: end + def.tail,
      center, radius, exactDuration: true,
    };
  }
  function windEventForState(day, stateId, seed) {
    if (day < 7) return null;
    const base = weatherIdFor(day, stateId, seed);
    if (!['clear', 'cloudy', 'overcast'].includes(base)) return null;
    const wind = windFor(day, stateId, seed);
    if (wind.level < 4) return null;
    const st = typeof World !== 'undefined' && World.states ? World.states[stateId] : null;
    if (!st) return null;
    const s = seasonForDay(day).id;
    const north = NORTH_STATES.has(st.name);
    let type = null;
    if (north && (s === 'spring' || s === 'winter')) type = 'sandstorm';
    if (!north && (s === 'summer' || s === 'autumn')) type = 'windstorm';
    if (!type) return null;
    // 官方只公開「有一定機率」及效果，未公開自動風災的觸發率、持續時長與局部半徑。
    // 因此觸發/時段/範圍採種子固定模擬；下方 +30%、50格、1格防守範圍才是公開原值。
    const roll = hash32(seed || 1, day + 17011, stateId + 601) % 100;
    if (roll >= 48) return null;
    const h1 = hash32(seed || 1, day + 19001, stateId + 701);
    const h2 = hash32(seed || 1, day + 21001, stateId + 809);
    const dur = 300; // 模擬5小時窗口，不宣稱為官方自動風災持續時間
    const start = day * 1440 + (h2 % (1440 - dur));
    let center = -1;
    if (st.cities && st.cities.length && World.cities) {
      const city = World.cities[st.cities[h1 % st.cities.length]];
      if (city) center = World.idx(city.cx, city.cy);
    }
    if (center < 0) center = World.idx(Math.round(st.sx), Math.round(st.sy));
    const radius = 8 + (h1 % 6);
    const def = WIND_HAZARDS[type];
    return {
      type, name: def.name, icon: def.icon, hazard: def.hazard, hazardName: def.hazardName,
      day, stateId, start, end: start + dur, hazardStart: start, hazardEnd: start + dur,
      center, radius, wind, exactDuration: false,
    };
  }
  function inEventArea(tile, ev) {
    if (!ev || tile < 0 || ev.center < 0) return false;
    return Game.T.state[tile] === ev.stateId && World.dist(tile, ev.center) <= ev.radius;
  }
  function specialAt(tile, atTime) {
    if (typeof Game === 'undefined' || !Game.G || tile < 0) return null;
    const t = atTime === undefined ? Game.G.time : atTime;
    // 災害尾段可能跨到隔日，所以同時檢查今天與昨天事件。
    const d = Math.floor(t / 1440), st = Game.T.state[tile] || 0, seed = Game.G.seed || 1;
    for (const day of [d, d - 1]) {
      const events = [specialEventForState(day, st, seed), windEventForState(day, st, seed)];
      for (const ev of events) {
        if (!ev || !inEventArea(tile, ev)) continue;
        if (t >= ev.start && t < ev.hazardEnd) return ev;
      }
    }
    return null;
  }
  function hazardAt(tile, atTime) {
    const t = atTime === undefined ? (Game.G ? Game.G.time : 0) : atTime;
    const ev = specialAt(tile, t);
    if (!ev || t < ev.hazardStart || t >= ev.hazardEnd) return null;
    return { id: ev.hazard, name: ev.hazardName, event: ev };
  }
  function specialPhaseAt(tile, atTime) {
    const t = atTime === undefined ? (Game.G ? Game.G.time : 0) : atTime;
    const ev = specialAt(tile, t);
    if (!ev) return null;
    const hz = hazardAt(tile, t);
    return { event: ev, hazard: hz, weatherActive: t >= ev.start && t < ev.end };
  }
  function commandBlock(tile, type) {
    const hz = hazardAt(tile);
    if (!hz) return '';
    if (hz.id === 'flood') return '洪災中，所有土地指令暫時無法使用';
    if (hz.id === 'snow' && (type === 'farm' || type === 'train')) return '積雪冬歇中，無法屯田或練兵';
    return '';
  }
  function windCommandBlock(p, team, target) {
    if (!p || !team || target < 0) return '';
    const from = Game.baseValid(p, team.base) ? team.base : p.cityTile;
    const hz = hazardAt(target) || hazardAt(from);
    if (!hz || (hz.id !== 'sandstorm' && hz.id !== 'windstorm')) return '';
    return World.dist(from, target) > 50 ? hz.name + '「難行」：出發地行軍距離上限為 50' : '';
  }
  function actionTimeFactor(tile, type) {
    const hz = hazardAt(tile);
    if (!hz || (hz.id !== 'sandstorm' && hz.id !== 'windstorm')) return 1;
    return type === 'farm' || type === 'train' || type === 'stratagem' ? 1.30 : 1;
  }
  function moralePenalty(tile, isBuilding) {
    const hz = hazardAt(tile);
    if (!hz) return 0;
    if (hz.id === 'flood') return isBuilding ? -20 : 0;
    if ((hz.id === 'fog' || hz.id === 'ice' || hz.id === 'snow' || hz.id === 'sandstorm' || hz.id === 'windstorm') && isBuilding) return 0;
    return HAZARD_MORALE[hz.id] || 0;
  }
  function adjustMorale(base, tile, isBuilding) { return Math.max(0, (base === undefined ? 100 : base) + moralePenalty(tile, isBuilding)); }
  function hidesMarchInFog(m, gx, gy, user) {
    if (!m || !user || m.pid === user.id) return false;
    const x = Math.round(gx), y = Math.round(gy);
    if (!World.inb(x, y)) return false;
    const tile = World.idx(x, y), hz = hazardAt(tile);
    if (!hz || hz.id !== 'fog') return false;
    // 大霧下建築僅保留中心視野：敵軍只有進入我方建築中心時才重新顯示。
    const cid = Game.T.city[tile];
    if (cid >= 0) {
      const city = World.cities[cid];
      if (city && city.owner === user.id && tile === World.idx(city.cx, city.cy)) return false;
    }
    return true;
  }
  function isStateBoundaryRiver(tile) {
    if (typeof Game === 'undefined' || !Game.T || Game.T.terrain[tile] !== TERRAIN.WATER) return false;
    const states = new Set();
    const tmp = [];
    World.neighbors8(tile, tmp);
    for (const n of tmp) if (Game.T.terrain[n] !== TERRAIN.WATER) states.add(Game.T.state[n]);
    return states.size > 1;
  }
  function isFrozenRiver(tile, atTime) {
    if (typeof Game === 'undefined' || !Game.G || !Game.T || tile < 0 || Game.T.terrain[tile] !== TERRAIN.WATER) return false;
    const t = atTime === undefined ? Game.G.time : atTime;
    if (seasonForDay(Math.floor(t / 1440)).id !== 'winter') return false;
    if (isStateBoundaryRiver(tile)) return false;
    const hz = hazardAt(tile, t);
    return !!hz && (hz.id === 'snow' || hz.id === 'ice');
  }
  function thawRiverOwnership() {
    if (!Game.P || !Game.P.length) return;
    const drop = [];
    for (const p of Game.P) for (const i of p.lands) {
      if (Game.T.terrain[i] === TERRAIN.WATER && !isFrozenRiver(i)) drop.push(i);
    }
    for (const i of drop) if (Game.tileOwner(i) >= 0) Game.setOwner(i, -1);
  }
  function envLabelAt(tile) {
    const w = weatherAt(tile), sp = specialPhaseAt(tile);
    if (!sp) return w.icon + w.name;
    if (sp.hazard) return sp.event.icon + sp.event.name + '／' + sp.hazard.name;
    if (sp.weatherActive) return sp.event.icon + sp.event.name;
    return w.icon + w.name;
  }
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
      const tile0 = tileOfResult(args, null);
      const blocked = commandBlock(tile0, 'build');
      if (blocked) return { ok: false, msg: blocked };
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

    const origPassable = World.isPassable;
    World.isPassable = function (i) { return origPassable(i) || isFrozenRiver(i); };

    const origSend = Game.send;
    Game.send = function (p, ti, target, type) {
      const blocked = commandBlock(target, type);
      if (blocked) return { ok: false, msg: blocked };
      const team = p && p.teams ? p.teams[ti] : null;
      const windBlocked = windCommandBlock(p, team, target);
      if (windBlocked) return { ok: false, msg: windBlocked };
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

    patchBuild('buildFort', args => +args[1]);
    patchBuild('buildCamp', args => +args[1]);
    patchBuild('buildBranch', args => +args[1]);
    const origAbandon = Game.abandon;
    if (typeof origAbandon === 'function') Game.abandon = function (p, tile) {
      const blocked = commandBlock(tile, 'abandon');
      return blocked ? { ok: false, msg: blocked } : origAbandon(p, tile);
    };
    const origRelocate = Game.relocate;
    if (typeof origRelocate === 'function') Game.relocate = function (p, tile) {
      const blocked = commandBlock(tile, 'relocate');
      return blocked ? { ok: false, msg: blocked } : origRelocate(p, tile);
    };

    const origAdvance = Game.advance;
    Game.advance = function (minutes) {
      const before = Game.G.time || 0;
      const beforeDay = Game.day();
      const r = origAdvance(minutes);
      const elapsed = Math.max(0, (Game.G.time || 0) - before);
      // 內部 startReturn() 不走匯出的 marchTime；每次 advance 後補套一次天氣倍率。
      for (const m of Game.G.marches || []) applyMarchWeather(m);
      // 風阻：練兵消費時間 +30%。屯田在本專案目前是抵達即結算，沒有獨立作業倒數，
      // 因此不偽造一個「官方屯田基礎時間」；待屯田流程改為有作業期後可直接套 actionTimeFactor()。
      for (const p of Game.P) for (const tm of p.teams) {
        if (tm.status === 'train') {
          if (!tm._rateWindTrain) {
            const f = actionTimeFactor(tm.gtile, 'train');
            if (f > 1 && tm.trainEnd > Game.G.time) tm.trainEnd = Game.G.time + (tm.trainEnd - Game.G.time) * f;
            tm._rateWindTrain = f;
          }
        } else delete tm._rateWindTrain;
      }
      // 河流只在冬季豪雪/凍雨災害中保持可佔領；災害/冬季結束即解凍並移除河面領地。
      if (!Game.G.rateEnv) Game.G.rateEnv = { version: 1 };
      if ((Game.G.rateEnv.lastThawSweep || -999) + 10 <= Game.G.time) {
        Game.G.rateEnv.lastThawSweep = Game.G.time;
        thawRiverOwnership();
      }
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
    let html = '<div style="display:flex;justify-content:space-between;align-items:center"><b>斥候偵查</b><span class="muted">' + envLabelAt(i) + '</span></div>';
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
      const w = weatherAt(i), n = weatherAt(i, 1), s = season(), sp = specialPhaseAt(i), wind = windAt(i), windNext = windAt(i, 1);
      const row = document.createElement('div');
      row.className = 'row rate-weather-row';
      let nowText = w.icon + w.name;
      let tip = w.desc;
      if (sp) {
        if (sp.hazard) {
          const left = Math.max(0, sp.event.hazardEnd - Game.G.time);
          nowText = sp.event.icon + sp.event.name + '／<b class="warn">' + sp.hazard.name + '</b> ' + U.fmtDur(left);
          tip += '；災害：' + sp.hazard.name;
        } else if (sp.weatherActive) {
          const left = Math.max(0, sp.event.end - Game.G.time);
          nowText = sp.event.icon + sp.event.name + ' ' + U.fmtDur(left);
          tip += '；特殊天氣正在形成災害';
        }
      }
      row.innerHTML = '<span>天時</span><span title="' + esc(tip) + '">' + s.icon + s.name + '季　' + nowText + '　' + wind.dir.name + ' ' + wind.level + '級 <small class="muted">明日 ' + n.icon + n.name + '／' + windNext.dir.name + windNext.level + '級</small></span>';
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
    const w = weatherAt(u.cityTile), n = weatherAt(u.cityTile, 1), s = season(), sp = specialPhaseAt(u.cityTile), wind = windAt(u.cityTile), windNext = windAt(u.cityTile, 1);
    const key = Game.day() + ':' + w.id + ':' + s.id + ':' + wind.level + ':' + wind.dir.name + ':' + (sp ? sp.event.type + ':' + (sp.hazard ? sp.hazard.id : 'forming') : 'none');
    let el = document.getElementById('rate-env');
    if (!el) {
      el = document.createElement('div'); el.id = 'rate-env';
      el.style.cssText = 'font-size:11px;line-height:1.25;margin-top:2px;cursor:help;white-space:nowrap';
      clock.insertBefore(el, document.getElementById('speed'));
    }
    if (key !== lastHudKey) {
      lastHudKey = key;
      let cur = w.icon + w.name;
      if (sp && sp.hazard) cur = sp.event.icon + sp.event.name + '／' + sp.hazard.name;
      else if (sp && sp.weatherActive) cur = sp.event.icon + sp.event.name;
      el.innerHTML = '<b>' + s.icon + s.name + '季</b>　' + cur + '　' + wind.dir.name + wind.level + '級 <span style="opacity:.72">｜明日 ' + n.icon + n.name + '／' + windNext.dir.name + windNext.level + '級</span>';
      el.title = s.desc + '；目前天氣：' + w.desc + (sp ? '；' + sp.event.name + (sp.hazard ? '已形成' + sp.hazard.name : '正在持續') : '');
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

  return { SEASONS, WEATHER, SPECIAL, HAZARD_MORALE, WIND_DIRS, WIND_HAZARDS, seasonForDay, weatherIdFor, weatherAt, windFor, windAt, eventTypeFor, specialEventForState, windEventForState, specialAt, hazardAt, specialPhaseAt, commandBlock, windCommandBlock, actionTimeFactor, moralePenalty, adjustMorale, hidesMarchInFog, isStateBoundaryRiver, isFrozenRiver, envLabelAt, marchFactor, buildFactor, scoutData, installGamePatches };
})();
