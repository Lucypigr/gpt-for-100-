// 遊戲核心：玩家、武將、部隊、行軍、戰鬥結算、攻城、同盟、賽季、存檔
'use strict';

var Game = (function () {
  const G = {};
  let T = null, P = null, landPos = null;
  const tmp8 = [];

  // ================= 初始化 =================
  function newGame(opts) {
    opts = opts || {};
    const seed = opts.seed || (Date.now() & 0x7fffffff);
    U.setSeed(seed ^ 0x5bd1e995);
    const aiN = opts.aiCount === undefined ? CFG.AI_COUNT : opts.aiCount;
    const mapN = opts.mapN || CFG.mapSizeFor(aiN);
    World.generate(seed, mapN, CFG.MAP_GEN_VER);
    T = World.T;
    Object.assign(G, {
      version: 1, seed, time: 0, acc: 0, speed: 1, paused: false,
      players: [], alliances: [], marches: [], nextMarch: 1, reports: [], nextReport: 1,
      chat: { world: [], sys: [], ally: {} }, notices: [], news: [],
      landSiege: {}, over: false, winner: -1, userId: 0, dirty: [], fx: [], lastDay: 0, rankCache: null, invites: [],
      aiCount: aiN, mapN, genVer: CFG.MAP_GEN_VER,
    });
    P = G.players;
    landPos = new Int32Array(World.N * World.N).fill(-1);
    const used = new Set();
    // 使用者
    const birthStates = World.states.filter(s => s.type === 'birth').map(s => s.id);
    const userState = opts.userState !== undefined ? opts.userState : U.pick(birthStates);
    const user = createPlayer(0, opts.userName || '主公', false, null, userState);
    used.add(user.name);
    // AI 玩家
    const profiles = AI.makeProfiles(G.aiCount);
    for (let k = 0; k < G.aiCount; k++) {
      const st = birthStates[k % birthStates.length];
      createPlayer(k + 1, U.playerName(used), true, profiles[k], st);
    }
    for (const p of P) { if (p.ai) AI.init(p); }
    AI.setupLeaders();
    sys('world', '【賽季開始】天下大亂，群雄並起！' + P.length + ' 位主公齊聚十三州，逐鹿中原。');
    sys('world', '【天下大勢】開荒期：主城受新手保護 ' + CFG.PROTECT_DAYS + ' 天。第 4 天開放出生州關口，第 9 天開放司隸，第 15 天開放洛陽。');
    recomputeAll();
    return G;
  }

  function createPlayer(id, name, ai, prof, stateId) {
    let center = World.findSpawn(stateId, U.rnd, P);
    if (center < 0) {
      for (const s of World.states) { if (s.type !== 'birth') continue; center = World.findSpawn(s.id, U.rnd, P); if (center >= 0) { stateId = s.id; break; } }
    }
    const b = {};
    for (const bd of BUILDINGS) b[bd.key] = 0;
    b.palace = 1;
    const p = {
      id, name, ai, prof, alliance: -1, role: 0,
      state: stateId, city: -1, cityTile: center,
      res: { wood: 6000, iron: 6000, stone: 6000, grain: 8000 }, copper: 8000, gold: CFG.START_GOLD,
      b, bq: [], heroes: [], hid: 1, teams: [], lib: BASIC_SKILLS.slice(), libp: {}, skp: CFG.SKP_START, reserve: CFG.RESERVE_START,
      fame: 0, lands: [], landCount: 0, landProd: [0, 0, 0, 0], firstCap: {},
      captor: -1, captureEnd: 0, protectEnd: CFG.PROTECT_DAYS * 1440,
      stats: { draws: 0, kills: 0, lost: 0, landsTaken: 0, maxLandLv: 0, cities: 0, battles: 0, wins: 0, cityDmg: 0 },
      power: 0, prod: {}, cap: 0, quests: {}, grudge: {}, forts: [], nextThink: 0, lastLoss: -1, lastDaily: 0,
    };
    P[id] = p;
    const c = World.placeMainCity(center, id, name);
    p.city = c.id;
    c.maxDur = mainCityMaxDur(p); c.dur = c.maxDur;
    p.teams.push(newTeam(0, p));
    // 初始武將
    const st4 = HEROES.filter(h => h.star === 4), st3 = HEROES.filter(h => h.star === 3), st2 = HEROES.filter(h => h.star === 2);
    const give = [U.pick(st4), U.pick(st3), U.pick(st3), U.pick(st3), U.pick(st2), U.pick(st2)];
    for (const t of give) addHero(p, t.id);
    // 自動編入第一隊
    autoFillTeam(p, 0);
    for (const uid of p.teams[0].slots) { const h = heroByUid(p, uid); if (h) h.troops = Math.floor(heroCap(p, h) * 0.8); }
    for (const c2 of c.tiles) markDirty(c2);
    recompute(p);
    return p;
  }
  function newTeam(i, p) { return { id: i, slots: [0, 0, 0], status: 'idle', base: p.cityTile, march: 0, gtile: -1, rq: null }; }

  // ================= 武將 =================
  function addHero(p, tid) {
    const t = HEROES[tid];
    const h = { uid: p.hid++, t: tid, lv: 1, exp: 0, troops: 0, wnd: 0, sta: CFG.STAMINA_MAX, staT: G.time || 0, pts: { atk: 0, def: 0, int: 0, spd: 0 }, adv: 0, sk: [t.skill, null, null], sl: [1, 1, 1], awk: 0, team: -1 };
    p.heroes.push(h);
    return h;
  }
  function heroByUid(p, uid) { if (!uid) return null; for (const h of p.heroes) if (h.uid === uid) return h; return null; }
  function tpl(h) { return HEROES[h.t]; }
  function heroCap(p, h) { return CFG.heroTroopCap(h.lv, p.b.barracks); }
  // 可征兵空間（傷兵佔用帶兵名額，治療後歸隊）
  function heroRoom(p, h) { return Math.max(0, heroCap(p, h) - h.troops - (h.wnd || 0)); }
  function freePoints(h) {
    const total = Math.floor(h.lv / 10) * CFG.POINTS_PER_10LV + h.adv * 10 + (h.awk ? CFG.AWAKEN_POINTS : 0);
    return total - (h.pts.atk + h.pts.def + h.pts.int + h.pts.spd);
  }
  function heroStats(p, h) {
    const t = tpl(h), L = h.lv - 1, aw = h.awk ? 1 + CFG.AWAKEN_STAT : 1;
    return {
      atk: (t.atk + t.atkG * L) * aw + h.pts.atk + p.b.shangwu * 4,
      def: (t.def + t.defG * L) * aw + h.pts.def + p.b.tiebi * 4,
      int: (t.int + t.intG * L) * aw + h.pts.int + p.b.junji * 4,
      spd: (t.spd + t.spdG * L) * aw + h.pts.spd + p.b.jifeng * 4,
      siege: Math.round(t.siege + (t.siegeG || 0) * L), range: t.range,
    };
  }
  function getSta(h) { return Math.min(CFG.STAMINA_MAX, h.sta + (G.time - h.staT) * CFG.STAMINA_REGEN_H / 60); }
  function useSta(h, n) { h.sta = getSta(h) - n; h.staT = G.time; }
  function gainExp(p, h, e) {
    if (h.lv >= CFG.HERO_MAX_LV) return;
    h.exp += e;
    while (h.lv < CFG.HERO_MAX_LV && h.exp >= CFG.expNeed(h.lv)) {
      h.exp -= CFG.expNeed(h.lv);
      h.lv++;
      if (p.id === G.userId && (h.lv % 5 === 0)) notify(p.id, tpl(h).name + ' 升至 ' + h.lv + ' 級' + (h.lv % 10 === 0 ? '，獲得 10 點屬性點' : ''), 'good');
    }
    if (h.lv >= CFG.HERO_MAX_LV) h.exp = 0;
  }
  function slotUnlocked(h, k) { return k === 0 || (k === 1 && h.lv >= 5) || (k === 2 && (h.lv >= 20 || !!h.awk)); }
  // 覺醒
  function awakenFodder(p, h) {
    const need = tpl(h).star - 1;
    return p.heroes.filter(x => x !== h && x.team < 0 && tpl(x).star >= need);
  }
  function awakenHero(p, uid, fodderUids) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    if (h.awk) return err('已覺醒');
    if (tpl(h).star < CFG.AWAKEN_MIN_STAR) return err('四星以上武將才能覺醒');
    const pool = awakenFodder(p, h);
    let fs = fodderUids ? fodderUids.map(u => pool.find(x => x.uid === u)).filter(Boolean) : pool.sort((a, b) => tpl(a).star - tpl(b).star || a.lv - b.lv).slice(0, CFG.AWAKEN_FODDER);
    if (fs.length < CFG.AWAKEN_FODDER) return err('需要 ' + CFG.AWAKEN_FODDER + ' 名 ' + (tpl(h).star - 1) + ' 星以上的閒置武將');
    for (const f of fs.slice(0, CFG.AWAKEN_FODDER)) removeHero(p, f);
    h.awk = 1;
    return ok();
  }
  // 事件戰法
  function eventStatus(p, ev) {
    const used = new Set();
    const missing = [];
    for (const name of ev.heroes) {
      const c = p.heroes.filter(x => x.team < 0 && !used.has(x) && tpl(x).name === name).sort((a, b) => a.lv - b.lv)[0];
      if (c) used.add(c); else missing.push(name);
    }
    return { done: p.lib.includes(ev.skill), missing, use: [...used] };
  }
  function exchangeEvent(p, evId) {
    const ev = EVENT_SKILLS.find(e => e.id === evId);
    if (!ev || !SKILLS[ev.skill]) return err('事件不存在');
    const st = eventStatus(p, ev);
    if (st.done) return err('已擁有此戰法');
    if (st.missing.length) return err('缺少閒置武將：' + st.missing.join('、'));
    for (const h of st.use) removeHero(p, h);
    delete p.libp[ev.skill];
    p.lib.push(ev.skill);
    return ok({ skill: ev.skill });
  }

  // ================= 部隊 =================
  function teamCount(p) { return Math.min(5, 1 + p.b.drill); }
  function syncTeams(p) { while (p.teams.length < teamCount(p)) p.teams.push(newTeam(p.teams.length, p)); }
  function costCap(p) { return CFG.BASE_COST_CAP + 0.5 * p.b.command; }
  function teamHeroes(p, team) { return team.slots.map(u => heroByUid(p, u)); }
  function teamCost(p, team) { let c = 0; for (const h of teamHeroes(p, team)) if (h) c += tpl(h).cost; return c; }
  function teamTroops(p, team) { let c = 0; for (const h of teamHeroes(p, team)) if (h) c += h.troops; return c; }
  function teamCapTroops(p, team) { let c = 0; for (const h of teamHeroes(p, team)) if (h) c += heroCap(p, h); return c; }
  function teamMinSta(p, team) { let s = 999; for (const h of teamHeroes(p, team)) if (h) s = Math.min(s, getSta(h)); return s === 999 ? 0 : s; }
  function teamSpeed(p, team) { let s = 999; for (const h of teamHeroes(p, team)) if (h) s = Math.min(s, heroStats(p, h).spd); return s === 999 ? 60 : s; }
  // 陣容加成：三人同陣營 全屬性+8%；三人同兵種 攻防+6%
  function teamBonus(p, team) {
    const hs = teamHeroes(p, team).filter(Boolean);
    if (hs.length < 3) return { f: 0, t: 0 };
    const t0 = tpl(hs[0]);
    return { f: hs.every(h => tpl(h).faction === t0.faction) ? 0.08 : 0, t: hs.every(h => tpl(h).troop === t0.troop) ? 0.06 : 0 };
  }
  function teamUnits(p, team, morale) {
    const out = [];
    const bn = teamBonus(p, team);
    team.slots.forEach((uid, slot) => {
      const h = heroByUid(p, uid);
      if (!h) return;
      const s = heroStats(p, h), t = tpl(h);
      const fa = 1 + bn.f, ta = 1 + bn.t;
      const skills = [], skl = [];
      h.sk.forEach((sid, k) => { if (sid) { skills.push(sid); skl.push(h.sl[k]); } });
      out.push({ name: t.name, faction: t.faction, troop: t.troop, troops: h.troops, atk: s.atk * fa * ta, def: s.def * fa * ta, int: s.int * fa, spd: s.spd * fa, range: s.range, siege: s.siege, skills, skl, morale: morale === undefined ? 100 : morale, slot, lv: h.lv, ref: h });
    });
    return out;
  }
  function teamPower(p, team) { return Battle.power(teamUnits(p, team)); }
  function teamReady(p, team, staNeed) {
    if (team.status !== 'idle' || team.rq) return false;
    const base = heroByUid(p, team.slots[0]);
    if (!base || base.troops <= 0) return false;
    return teamMinSta(p, team) >= (staNeed || CFG.COST_ATTACK);
  }

  function setSlot(p, ti, slot, uid) {
    const team = p.teams[ti];
    if (!team) return err('部隊不存在');
    if (team.status !== 'idle' || team.rq) return err('部隊出征或征兵中，無法調整');
    if (team.base !== p.cityTile) return err('部隊需在主城才能調整陣容');
    const h = uid ? heroByUid(p, uid) : null;
    if (uid && !h) return err('武將不存在');
    if (h) {
      if (h.team >= 0 && h.team !== ti) {
        const ot = p.teams[h.team];
        if (ot.status !== 'idle' || ot.rq || ot.base !== p.cityTile) return err('該武將所在部隊忙碌中');
      }
      for (let k = 0; k < 3; k++) {
        if (k === slot) continue;
        const o = heroByUid(p, team.slots[k]);
        if (o && o.uid !== h.uid && tpl(o).name === tpl(h).name) return err('同一部隊不可有同名武將');
      }
      const old = heroByUid(p, team.slots[slot]);
      let c = teamCost(p, team) - (old ? tpl(old).cost : 0) + tpl(h).cost;
      if (h.team === ti) c -= tpl(h).cost; // 同隊換位
      if (c > costCap(p) + 1e-6) return err('超過統御上限 ' + costCap(p).toFixed(1));
      // 從原部隊移除
      if (h.team >= 0) { const ot = p.teams[h.team]; for (let k = 0; k < 3; k++) if (ot.slots[k] === h.uid) ot.slots[k] = 0; }
    }
    const old = heroByUid(p, team.slots[slot]);
    if (old) old.team = -1;
    team.slots[slot] = h ? h.uid : 0;
    if (h) h.team = ti;
    return ok();
  }

  function autoFillTeam(p, ti) {
    const team = p.teams[ti];
    const free = p.heroes.filter(h => h.team < 0).sort((a, b) => heroScore(p, b) - heroScore(p, a));
    for (let slot = 0; slot < 3; slot++) {
      if (team.slots[slot]) continue;
      for (const h of free) {
        if (h.team >= 0) continue;
        if (setSlot(p, ti, slot, h.uid).ok) break;
      }
    }
  }
  function heroScore(p, h) {
    const t = tpl(h);
    return t.star * 40 + h.lv * 6 + h.adv * 8;
  }

  // 征兵
  function recruitCost(p, team, frac) {
    const c = { wood: 0, iron: 0, grain: 0 }, add = {};
    let maxT = 0, men = 0;
    for (const h of teamHeroes(p, team)) {
      if (!h) continue;
      const need = Math.floor(heroRoom(p, h) * (frac || 1));
      if (need <= 0) continue;
      add[h.uid] = need;
      men += need;
      const m = tpl(h).cost / 3;
      for (const r in c) c[r] += need * CFG.RECRUIT_COST[r] * m;
      maxT = Math.max(maxT, need / CFG.recruitRate(p.b.recruit));
    }
    for (const r in c) c[r] = Math.ceil(c[r]);
    return { cost: c, add, men, time: Math.ceil(maxT) };
  }
  function recruit(p, ti, frac) {
    const team = p.teams[ti];
    if (!team) return err('部隊不存在');
    if (team.status !== 'idle' || team.rq) return err('部隊忙碌中');
    if (!isHome(p, team.base)) return err('需回到主城或分城才能征兵');
    let rc = recruitCost(p, team, frac);
    if (!Object.keys(rc.add).length) {
      for (const h of teamHeroes(p, team)) if (h && h.wnd > 0) return err('傷兵治療中，無需征兵');
      return err('兵力已滿');
    }
    if (!canAfford(p, rc.cost) || rc.men > p.reserve) {
      // 依資源與預備兵比例征兵
      let f = 1;
      for (const r in rc.cost) if (rc.cost[r] > 0) f = Math.min(f, p.res[r] / rc.cost[r]);
      f = Math.min(f, p.reserve / rc.men);
      f = Math.floor(f * 100) / 100 * (frac || 1);
      if (f < 0.05) return err(p.reserve / rc.men < 0.05 ? '預備兵不足' : '資源不足');
      rc = recruitCost(p, team, f);
      if (!Object.keys(rc.add).length || !canAfford(p, rc.cost) || rc.men > p.reserve) return err('資源或預備兵不足');
    }
    pay(p, rc.cost);
    p.reserve -= rc.men;
    team.rq = { end: G.time + Math.max(1, rc.time), add: rc.add };
    return ok({ time: rc.time });
  }

  // 傷兵：部隊在主城待命時自動治療（消耗少量資源，不消耗預備兵）
  function healTick(p) {
    const rate = CFG.recruitRate(p.b.recruit) * CFG.HEAL_SPEED;
    for (const tm of p.teams) {
      if (tm.status !== 'idle' || !isHome(p, tm.base)) continue;
      for (const uid of tm.slots) {
        const h = heroByUid(p, uid);
        if (!h || !(h.wnd > 0)) continue;
        const n = Math.min(h.wnd, Math.ceil(rate));
        const m = tpl(h).cost / 3 * CFG.HEAL_COST * n;
        const c = { wood: CFG.RECRUIT_COST.wood * m, iron: CFG.RECRUIT_COST.iron * m, grain: CFG.RECRUIT_COST.grain * m };
        if (!canAfford(p, c)) continue;
        pay(p, c);
        h.wnd -= n; h.troops += n;
        if (h.wnd <= 0) { h.wnd = 0; if (p.id === G.userId && !teamWounded(p, tm)) notify(p.id, '第' + (tm.id + 1) + '部隊傷兵治療完畢', 'good'); }
      }
    }
  }
  function teamWounded(p, team) { let c = 0; for (const h of teamHeroes(p, team)) if (h) c += h.wnd || 0; return c; }
  function healTime(p, team) {
    let w = 0;
    for (const h of teamHeroes(p, team)) if (h) w = Math.max(w, h.wnd || 0);
    return Math.ceil(w / (CFG.recruitRate(p.b.recruit) * CFG.HEAL_SPEED));
  }
  // 戰後把兵力寫回武將，損失的一部分轉為傷兵
  function applyLosses(p, units, outcome) {
    const rate = CFG.WOUND_RATE[outcome];
    for (const u of units) {
      const h = u.ref;
      if (!h) continue;
      const lost = Math.max(0, h.troops - Math.max(0, u.troops));
      h.troops = Math.max(0, u.troops);
      if (p && lost > 0) h.wnd = Math.min(heroCap(p, h) - h.troops, (h.wnd || 0) + Math.round(lost * rate));
    }
  }

  // ================= 資源 =================
  function canAfford(p, c) {
    for (const r in c) {
      if (r === 'gold' || r === 'copper') { if (p[r] < c[r]) return false; }
      else if ((p.res[r] || 0) < c[r]) return false;
    }
    return true;
  }
  function pay(p, c) { for (const r in c) { if (r === 'gold' || r === 'copper') p[r] -= c[r]; else p.res[r] -= c[r]; } }
  function gain(p, c) {
    for (const r in c) {
      if (r === 'gold' || r === 'copper') p[r] += c[r];
      else p.res[r] = Math.min(Math.max(p.cap, p.res[r]), p.res[r] + c[r]);
    }
  }
  function allianceBonus(p) {
    if (p.alliance < 0) return 0;
    const a = G.alliances[p.alliance];
    let b = 0;
    for (const cid of a.cities) {
      const c = World.cities[cid];
      b += c.type === 'luoyang' ? 0.12 : c.type === 'capital' ? 0.05 : c.type === 'commandery' ? 0.025 : 0.01;
    }
    return Math.min(0.5, b);
  }
  function recompute(p) {
    syncTeams(p);
    const base = CFG.CITY_BASE_OUTPUT + p.b.palace * 60;
    const bonus = 1 + allianceBonus(p);
    const bmap = ['lumber', 'ironw', 'quarry', 'farm'];
    const prod = {};
    CFG.RES.forEach((r, k) => { prod[r] = Math.round((base + p.b[bmap[k]] * 150 + p.landProd[k]) * bonus); });
    let nb = 0;
    for (const id of (p.branches || [])) { const bc = World.cities[id]; if (!bc.dead && !(bc.building > G.time)) nb++; }
    if (nb) CFG.RES.forEach(r => { prod[r] += Math.round(CFG.BRANCH_OUTPUT * nb * bonus); });
    prod.copper = 200 + p.b.house * 250;
    if (p.captor >= 0) for (const r of CFG.RES) prod[r] = Math.round(prod[r] * (1 - CFG.TRIBUTE_PCT));
    p.prod = prod;
    p.cap = 30000 + p.b.warehouse * 22000 + p.b.palace * 4000;
    p.landCap = CFG.landCap(p.fame);
    const c = World.cities[p.city];
    if (c) { const md = mainCityMaxDur(p); if (c.maxDur !== md) { c.dur = Math.min(md, c.dur + (md - c.maxDur)); c.maxDur = md; } }
  }
  function mainCityMaxDur(p) { return 2000 + p.b.palace * 400 + p.b.wall * 600; }
  function recomputeAll() { for (const p of P) recompute(p); }

  // ================= 建築 =================
  function upgradeBuilding(p, key) {
    const bd = BUILDING_BY_KEY[key];
    if (!bd) return err('無此建築');
    if (p.bq.length >= 2) return err('建造隊列已滿');
    if (p.bq.some(q => q.key === key)) return err('該建築正在升級');
    const to = p.b[key] + 1;
    if (to > bd.max) return err('已達最高等級');
    if (to > buildingMaxAllowed(key, p.b.palace)) return err('需要更高等級的君王殿');
    if (key === 'palace') {
      // 君王殿升級需其他建築達標
      const need = Math.max(0, to - 2);
      const ok2 = ['lumber', 'ironw', 'quarry', 'farm'].every(k => p.b[k] >= need);
      if (!ok2) return err('需要四種資源建築達到 ' + need + ' 級');
    }
    const cost = buildingCost(key, to);
    if (!canAfford(p, cost)) return err('資源不足');
    pay(p, cost);
    p.bq.push({ key, lv: to, end: G.time + buildingTime(key, to) });
    return ok();
  }

  // ================= 招募 =================
  function drawPack(p, key) {
    const pack = CFG.PACKS.find(x => x.key === key);
    if (!pack) return err('無此卡包');
    if (!canAfford(p, pack.price)) return err(pack.price.gold ? '金銖不足' : '銅幣不足');
    pay(p, pack.price);
    const n = pack.count || 1;
    const got = [];
    for (let k = 0; k < n; k++) {
      let r = U.rnd(), star = 1;
      for (const [s, pr] of pack.rates) { if (r < pr) { star = s; break; } r -= pr; }
      if (n === 5 && k === 4 && got.every(h => tpl(h).star < 4) && star < 4) star = 4; // 五連保底四星
      const pool = HEROES.filter(h => h.star === star);
      const h = addHero(p, U.pick(pool).id);
      got.push(h);
    }
    p.stats.draws += n;
    return ok({ heroes: got });
  }
  function advanceHero(p, uid, fodderUid) {
    const h = heroByUid(p, uid), f = heroByUid(p, fodderUid);
    if (!h || !f || h === f) return err('武將不存在');
    if (tpl(h).name !== tpl(f).name) return err('需要同名武將進階');
    if (f.team >= 0) return err('素材武將在部隊中');
    if (h.adv >= 5) return err('已進階滿');
    h.adv++;
    removeHero(p, f);
    return ok();
  }
  // 傳承：消耗三星以上武將，取得其自帶戰法的演練進度（B 級直接學會，A 級 50%，S 級 25%）
  function inheritHero(p, uid) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    if (h.team >= 0) return err('武將在部隊中');
    if (tpl(h).star < 3) return err('三星以上武將才能傳承戰法');
    const sid = tpl(h).inherit;
    if (p.lib.includes(sid)) return err('已擁有此戰法');
    removeHero(p, h);
    const prog = addDrill(p, sid, CFG.INHERIT_PROG[SKILLS[sid].q]);
    return ok({ skill: sid, prog });
  }
  function addDrill(p, sid, n) {
    const v = Math.min(100, (p.libp[sid] || 0) + n);
    if (v >= 100) { delete p.libp[sid]; if (!p.lib.includes(sid)) p.lib.push(sid); return 100; }
    p.libp[sid] = v;
    return v;
  }
  // 演練：消耗閒置武將，提高研究中戰法的進度
  function drillSkill(p, sid, uid) {
    if (p.libp[sid] === undefined) return err('沒有研究中的此戰法');
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    if (h.team >= 0) return err('武將在部隊中');
    const n = CFG.DRILL_PROG[tpl(h).star];
    removeHero(p, h);
    const prog = addDrill(p, sid, n);
    return ok({ prog, done: prog >= 100 });
  }
  // 轉化：武將轉為戰法點
  function convertValue(h) { return CFG.CONVERT_PTS[tpl(h).star] + h.lv * 10 + h.adv * CFG.CONVERT_PTS[tpl(h).star] * 0.5; }
  function convertHero(p, uid) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    if (h.team >= 0) return err('武將在部隊中');
    const n = Math.round(convertValue(h));
    removeHero(p, h);
    p.skp += n;
    return ok({ pts: n });
  }
  function skillInvested(q, lv) { let s = 0; for (let l = 1; l < lv; l++) s += CFG.skillUpCost(q, l); return s; }
  function upgradeSkill(p, uid, k) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    const sid = h.sk[k];
    if (!sid) return err('此欄位沒有戰法');
    const lv = h.sl[k] || 1;
    if (lv >= CFG.SKILL_MAX_LV) return err('戰法已滿級');
    const cost = CFG.skillUpCost(SKILLS[sid].q, lv);
    if (p.skp < cost) return err('戰法點不足（需要 ' + cost + '）');
    p.skp -= cost;
    h.sl[k] = lv + 1;
    return ok({ lv: lv + 1 });
  }
  function removeHero(p, h) {
    const i = p.heroes.indexOf(h);
    if (i >= 0) p.heroes.splice(i, 1);
  }
  function learnSkill(p, uid, k, sid) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    if (k < 1 || k > 2) return err('無效欄位');
    if (!slotUnlocked(h, k)) return err(k === 1 ? '武將 5 級解鎖第二戰法欄' : '武將 20 級或覺醒後解鎖第三戰法欄');
    if (sid) {
      if (!p.lib.includes(sid)) return err('尚未擁有此戰法');
      const s = SKILLS[sid];
      if (s.troops && !s.troops.includes(tpl(h).troop)) return err('兵種不符');
      if (h.sk.includes(sid)) return err('已擁有此戰法');
    }
    // 更換或遺忘時返還部分已投入的戰法點
    const old = h.sk[k];
    let refund = 0;
    if (old && old !== sid) refund = Math.floor(skillInvested(SKILLS[old].q, h.sl[k] || 1) * CFG.SKILL_REFUND);
    p.skp += refund;
    if (old !== sid) h.sl[k] = 1;
    h.sk[k] = sid || null;
    return ok({ refund });
  }
  function addPoint(p, uid, stat, n) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    n = Math.min(n || 1, freePoints(h));
    if (n <= 0) return err('沒有可分配屬性點');
    h.pts[stat] += n;
    return ok();
  }
  function resetPoints(p, uid) {
    const h = heroByUid(p, uid);
    if (!h) return err('武將不存在');
    h.pts = { atk: 0, def: 0, int: 0, spd: 0 };
    return ok();
  }

  // ================= 地圖歸屬 =================
  function markDirty(i) { G.dirty.push(i); }
  function tileOwner(i) {
    const c = T.city[i];
    if (c >= 0) { const city = World.cities[c]; if (World.isPlayerCity(city)) return city.owner; return -1; }
    return T.owner[i];
  }
  function tileAlliance(i) {
    const c = T.city[i];
    if (c >= 0) {
      const city = World.cities[c];
      if (World.isPlayerCity(city)) return city.owner >= 0 ? P[city.owner].alliance : -1;
      return city.alliance;
    }
    const o = T.owner[i];
    return o >= 0 ? P[o].alliance : -1;
  }
  function isFriendly(p, i) {
    const o = tileOwner(i);
    if (o === p.id) return true;
    if (p.alliance < 0) return false;
    return tileAlliance(i) === p.alliance;
  }
  function adjFriendly(p, i) {
    World.neighbors8(i, tmp8);
    for (const n of tmp8) if (isFriendly(p, n) && World.linked(n, i)) return true;
    return false;
  }
  function cityLockedDay(c) {
    if (c.type === 'pass') {
      const [a, b] = c.link;
      if (World.states[a].type === 'center' || World.states[b].type === 'center') return 8;
      return 3;
    }
    if (c.type === 'luoyang') return 14;
    return 0;
  }
  function day() { return Math.floor(G.time / 1440); }
  // 可否攻擊（回傳原因字串或 ''）
  function attackBlock(p, i) {
    if (!World.isPassable(i)) return '無法到達（山脈/河流）';
    if (isFriendly(p, i)) return '我方領地';
    const c = T.city[i];
    if (c >= 0) {
      const city = World.cities[c];
      if (city.type === 'main') {
        const o = P[city.owner];
        if (G.time < o.protectEnd) return '對方主城處於保護期';
        if (o.captor === p.id) return '已淪陷於你';
      }
      if (!World.isPlayerCity(city)) {
        if (day() < cityLockedDay(city)) return '尚未開放（第 ' + (cityLockedDay(city) + 1) + ' 天開放）';
        if (city.alliance < 0 && p.alliance < 0) return '需加入同盟才能攻城';
      }
      let adj = false;
      for (const t of city.tiles) if (adjFriendly(p, t)) { adj = true; break; }
      if (!adj) return '需與我方或同盟領地相鄰';
    } else if (!adjFriendly(p, i)) return '需與我方或同盟領地相鄰';
    if (p.captor >= 0) {
      const ca = P[p.captor].alliance;
      const ta = tileAlliance(i);
      if (tileOwner(i) === p.captor || (ca >= 0 && ta === ca)) return '淪陷中，無法攻擊佔領方';
    }
    return '';
  }
  function setOwner(i, pid) {
    const old = T.owner[i];
    if (old === pid) return;
    if (old >= 0) {
      const op = P[old];
      const pos = landPos[i];
      const last = op.lands.pop();
      if (last !== i) { op.lands[pos] = last; landPos[last] = pos; }
      landPos[i] = -1;
      op.landCount--;
      op.landProd[T.res[i]] -= CFG.LAND_OUTPUT[T.lvl[i]];
      recompute(op);
    }
    T.owner[i] = pid;
    if (pid >= 0) {
      const np = P[pid];
      landPos[i] = np.lands.length;
      np.lands.push(i);
      np.landCount++;
      np.landProd[T.res[i]] += CFG.LAND_OUTPUT[T.lvl[i]];
      recompute(np);
    }
    markDirty(i);
  }
  function abandon(p, i) {
    if (T.owner[i] !== p.id || T.city[i] >= 0) return err('無法放棄此地');
    for (const tm of p.teams) if (tm.gtile === i) return err('有部隊駐守中');
    setOwner(i, -1);
    return ok();
  }
  function outpostCount(p, type) { let n = 0; for (const id of p.forts) if (World.cities[id].type === type) n++; return n; }
  // 要塞 / 營帳（單格前線駐地，土地仍計入領地）
  function buildFort(p, i, type) {
    type = type || 'fort';
    const camp = type === 'camp';
    const nm = camp ? '營帳' : '要塞', max = camp ? CFG.CAMP_MAX : CFG.FORT_MAX, cost = camp ? CFG.CAMP_COST : CFG.FORT_COST;
    if (T.owner[i] !== p.id || T.city[i] >= 0) return err('只能在自己的土地上建造' + nm);
    if (outpostCount(p, type) >= max) return err(nm + '數量已達上限（' + max + '）');
    if (!canAfford(p, cost)) return err('資源不足');
    pay(p, cost);
    const c = World.placeFort(i, p.id, type);
    c.building = G.time + (camp ? CFG.CAMP_BUILD_MIN : CFG.FORT_BUILD_MIN);
    if (camp) c.expire = c.building + CFG.CAMP_LIFE_MIN;
    p.forts.push(c.id);
    markDirty(i);
    return ok({ city: c });
  }
  function buildCamp(p, i) { return buildFort(p, i, 'camp'); }
  function removeFort(c) {
    const p = P[c.owner];
    if (p) p.forts = p.forts.filter(x => x !== c.id);
    T.city[c.tiles[0]] = -1;
    c.dead = true;
    markDirty(c.tiles[0]);
    // 駐紮其中的部隊撤回主城
    if (p) for (const tm of p.teams) if (tm.base === c.tiles[0] && tm.status === 'idle') { tm.base = p.cityTile; }
  }
  // 3×3 範圍是否全為自己的空地（分城、遷城用）
  function block3Owned(p, center) {
    const x0 = World.X(center), y0 = World.Y(center);
    for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) {
      if (!World.inb(x, y)) return false;
      const i = World.idx(x, y);
      if (T.owner[i] !== p.id || T.city[i] >= 0 || !World.isPassable(i)) return false;
      for (const tm of p.teams) if (tm.gtile === i) return false;
    }
    return true;
  }
  function branchCount(p) { return (p.branches || []).length; }
  function canBranch(p, i) {
    if (p.b.palace < CFG.BRANCH_PALACE) return '需要君王殿 ' + CFG.BRANCH_PALACE + ' 級';
    const max = CFG.branchMax(p.fame);
    if (branchCount(p) >= max) return max === 0 ? '名望 15000 才能建造分城' : '分城數量已達上限（' + max + '，名望 50000 可建第二座）';
    if (!block3Owned(p, i)) return '需以此格為中心、周圍 3×3 皆為自己的空地（無駐守部隊）';
    if (World.dist(i, p.cityTile) < 8) return '距離主城太近（至少 8 格）';
    if (!canAfford(p, CFG.BRANCH_COST)) return '資源不足';
    return '';
  }
  function buildBranch(p, i) {
    const why = canBranch(p, i);
    if (why) return err(why);
    pay(p, CFG.BRANCH_COST);
    const x0 = World.X(i), y0 = World.Y(i);
    for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) setOwner(World.idx(x, y), -1);
    const c = World.placeBranch(i, p.id, p.name + '分城');
    c.building = G.time + CFG.BRANCH_BUILD_MIN;
    if (!p.branches) p.branches = [];
    p.branches.push(c.id);
    for (const t of c.tiles) markDirty(t);
    recompute(p);
    return ok({ city: c });
  }
  function removeBranch(c) {
    const p = P[c.owner];
    if (p) p.branches = (p.branches || []).filter(x => x !== c.id);
    World.clearCityTiles(c);
    c.dead = true;
    for (const t of c.tiles) markDirty(t);
    if (p) {
      for (const tm of p.teams) {
        if (c.tiles.includes(tm.base)) { tm.base = p.cityTile; if (tm.status === 'idle') startReturn(p, tm, c.tiles[4]); }
      }
      recompute(p);
    }
  }
  // 遷城
  function canRelocate(p, i) {
    if (p.captor >= 0) return '淪陷中無法遷城';
    if (G.time < (p.relocateCd || 0)) return '遷城冷卻中（' + Math.ceil((p.relocateCd - G.time) / 60) + ' 小時）';
    if (!block3Owned(p, i)) return '需以此格為中心、周圍 3×3 皆為自己的空地（無駐守部隊）';
    for (const tm of p.teams) if (tm.status !== 'idle' || tm.rq) return '所有部隊需待命（不可出征、駐守或征兵）';
    if (!canAfford(p, CFG.RELOCATE_COST)) return '需要金銖 ' + CFG.RELOCATE_COST.gold + '、銅幣 ' + CFG.RELOCATE_COST.copper;
    return '';
  }
  function relocate(p, i) {
    const why = canRelocate(p, i);
    if (why) return err(why);
    pay(p, CFG.RELOCATE_COST);
    const c = World.cities[p.city];
    const old = p.cityTile;
    const x0 = World.X(i), y0 = World.Y(i);
    for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) setOwner(World.idx(x, y), -1);
    World.clearCityTiles(c);
    for (const t of c.tiles) markDirty(t);
    if (c.hx === undefined) { c.hx = c.cx; c.hy = c.cy; }
    c.cx = x0; c.cy = y0;
    World.applyCityTiles(c);
    for (const t of c.tiles) markDirty(t);
    p.cityTile = i;
    p.state = T.state[i];
    c.state = T.state[i];
    c.garrison = null;
    for (const tm of p.teams) if (tm.base === old || !baseValid(p, tm.base)) tm.base = i;
    p.relocateCd = G.time + CFG.RELOCATE_CD_MIN;
    recompute(p);
    return ok();
  }
  // 主城或已建成的己方分城（可征兵、治療）
  function isHome(p, tile) {
    if (tile === p.cityTile) return true;
    const c = T.city[tile];
    if (c < 0) return false;
    const city = World.cities[c];
    return city.type === 'branch' && city.owner === p.id && !city.dead && !(city.building > G.time);
  }

  // ================= 行軍 =================
  function baseValid(p, tile) {
    if (tile === p.cityTile) return true;
    const c = T.city[tile];
    if (c < 0) return false;
    const city = World.cities[c];
    if (World.isOutpost(city) || city.type === 'branch') return city.owner === p.id && !city.dead && !(city.building > G.time);
    if (city.type === 'main') return false;
    return p.alliance >= 0 && city.alliance === p.alliance;
  }
  // 從部隊目前駐地出發抵達目標時的士氣
  function marchMorale(p, team, target) {
    const from = baseValid(p, team.base) ? team.base : p.cityTile;
    return CFG.moraleAt(World.dist(from, target));
  }
  function marchTime(p, team, from, to) {
    return Math.max(2, Math.round(World.dist(from, to) * CFG.minPerTile(teamSpeed(p, team))));
  }
  function send(p, ti, target, type) {
    const team = p.teams[ti];
    if (!team) return err('部隊不存在');
    if (team.status !== 'idle') return err('部隊不在待命狀態');
    if (team.rq) return err('部隊征兵中');
    const base = heroByUid(p, team.slots[0]);
    if (!base) return err('部隊缺少大營武將');
    if (base.troops <= 0) return err('大營武將兵力不足');
    const cost = { attack: CFG.COST_ATTACK, move: CFG.COST_MOVE, garrison: CFG.COST_GARRISON, farm: CFG.COST_FARM, train: CFG.COST_TRAIN, sweep: CFG.COST_SWEEP }[type];
    if (cost === undefined) return err('無效行動');
    if (teamMinSta(p, team) < cost) return err('武將體力不足（需要 ' + cost + '）');
    if (!baseValid(p, team.base)) team.base = p.cityTile;
    if (type === 'attack') {
      const why = attackBlock(p, target);
      if (why) return err(why);
    } else if (type === 'move') {
      if (!baseValid(p, target)) return err('只能調動至主城、己方要塞或同盟城池');
      if (target === team.base) return err('部隊已在此處');
    } else if (type === 'garrison') {
      if (!isFriendly(p, target) || !World.isPassable(target)) return err('只能駐守我方或同盟領地');
    } else {
      // 屯田 / 練兵 / 掃蕩：只能在自己的土地上
      if (T.owner[target] !== p.id || T.city[target] >= 0) return err('只能在自己的土地上' + ACT_NAME[type]);
    }
    const dist = World.dist(team.base, target);
    if (dist > 120) return err('距離過遠');
    for (const h of teamHeroes(p, team)) if (h) useSta(h, cost);
    const m = { id: G.nextMarch++, pid: p.id, team: ti, type, from: team.base, to: target, start: G.time, end: G.time + marchTime(p, team, team.base, target) };
    G.marches.push(m);
    team.status = 'march';
    team.march = m.id;
    team.gtile = -1;
    // 被攻擊方預警
    if (type === 'attack') {
      const o = tileOwner(target);
      if (o >= 0 && o !== p.id) {
        const tgtCity = T.city[target] >= 0 && World.cities[T.city[target]].type === 'main';
        if (o === G.userId) notify(o, (tgtCity ? '⚠ 主城' : '⚠ 領地') + '(' + World.X(target) + ',' + World.Y(target) + ') 即將遭到【' + p.name + '】攻擊！', 'bad');
        P[o].incoming = G.time;
        if (P[o].ai) AI.onThreat(P[o], p, target, m);
      }
    }
    return ok({ march: m });
  }
  const ACT_NAME = { farm: '屯田', train: '練兵', sweep: '掃蕩' };
  function recall(p, ti) {
    const team = p.teams[ti];
    if (!team) return err('部隊不存在');
    if (team.status === 'garrison' || team.status === 'train') {
      startReturn(p, team, team.gtile);
      return ok();
    }
    if (team.status !== 'march') return err('部隊未出征');
    const m = G.marches.find(x => x.id === team.march);
    if (!m) return err('找不到行軍');
    if (m.type === 'return') return err('已在回城途中');
    const f = Math.min(1, (G.time - m.start) / Math.max(1, m.end - m.start));
    const elapsed = G.time - m.start;
    // 中途折返：從目前位置返回出發地
    m.recalled = true;
    m.recallFrom = m.to;
    m.rx = f;
    m.type = 'return';
    const base = m.from;
    m.from = m.recallFrom;
    m.to = base;
    m.start = G.time; m.end = G.time + Math.max(1, elapsed);
    return ok();
  }
  function startReturn(p, team, fromTile) {
    if (!baseValid(p, team.base)) team.base = p.cityTile;
    const m = { id: G.nextMarch++, pid: p.id, team: team.id, type: 'return', from: fromTile, to: team.base, start: G.time, end: G.time + marchTime(p, team, fromTile, team.base) };
    G.marches.push(m);
    team.status = 'march';
    team.march = m.id;
    team.gtile = -1;
  }
  // 行軍當前位置（渲染用，回傳格座標浮點）
  function marchPos(m, t) {
    const f = Math.max(0, Math.min(1, (t - m.start) / Math.max(0.001, m.end - m.start)));
    if (m.recalled) {
      // 從中途折返：起點為 rx 比例位置
      const ax = World.X(m.to), ay = World.Y(m.to);
      const bx = World.X(m.recallFrom), by = World.Y(m.recallFrom);
      const sx = ax + (bx - ax) * m.rx, sy = ay + (by - ay) * m.rx;
      return [sx + (ax - sx) * f, sy + (ay - sy) * f];
    }
    const ax = World.X(m.from), ay = World.Y(m.from), bx = World.X(m.to), by = World.Y(m.to);
    return [ax + (bx - ax) * f, ay + (by - ay) * f];
  }

  function processMarches() {
    const arr = G.marches;
    let any = false;
    for (let k = 0; k < arr.length; k++) if (arr[k].end <= G.time) { any = true; break; }
    if (!any) return;
    const due = [], keep = [];
    for (const m of arr) (m.end <= G.time ? due : keep).push(m);
    G.marches = keep;
    due.sort((a, b) => a.end - b.end || a.id - b.id);
    for (const m of due) arrive(m);
  }
  function arrive(m) {
    const p = P[m.pid];
    const team = p.teams[m.team];
    if (!team || team.march !== m.id) return;
    if (m.type === 'return') {
      team.status = 'idle'; team.march = 0;
      if (!baseValid(p, team.base)) team.base = p.cityTile;
      return;
    }
    if (m.type === 'move') {
      if (baseValid(p, m.to)) { team.base = m.to; team.status = 'idle'; team.march = 0; }
      else startReturn(p, team, m.to);
      return;
    }
    if (m.type === 'garrison') {
      if (isFriendly(p, m.to)) { team.status = 'garrison'; team.gtile = m.to; team.march = 0; }
      else startReturn(p, team, m.to);
      return;
    }
    if (m.type === 'farm' || m.type === 'train' || m.type === 'sweep') {
      if (T.owner[m.to] !== p.id || T.city[m.to] >= 0) { startReturn(p, team, m.to); return; }
      if (m.type === 'train') { team.status = 'train'; team.gtile = m.to; team.march = 0; team.trainEnd = G.time + CFG.TRAIN_MIN; return; }
      if (m.type === 'farm') doFarm(p, team, m.to);
      else resolveSweep(p, team, m.to, CFG.moraleAt(World.dist(m.from, m.to)));
      if (team.status === 'march' && team.march === m.id) startReturn(p, team, m.to);
      return;
    }
    if (m.type === 'attack') {
      resolveAttack(p, team, m.to, CFG.moraleAt(World.dist(m.from, m.to)));
      if (team.status === 'march' && team.march === m.id) startReturn(p, team, m.to);
    }
  }

  // ================= 屯田 / 練兵 / 掃蕩 =================
  function farmYield(i) { return Math.round(CFG.LAND_OUTPUT[T.lvl[i]] * CFG.FARM_HOURS); }
  function doFarm(p, team, i) {
    const r = CFG.RES[T.res[i]], n = farmYield(i);
    const before = p.res[r];
    gain(p, { [r]: n });
    const got = Math.round(p.res[r] - before);
    p.stats.farmed = (p.stats.farmed || 0) + got;
    if (p.id === G.userId) notify(p.id, '第' + (team.id + 1) + '部隊屯田完成：' + CFG.RES_NAME[r] + ' +' + got + (got < n ? '（倉庫已滿）' : ''), 'good');
  }
  function trainTick(p) {
    for (const tm of p.teams) {
      if (tm.status !== 'train') continue;
      if (T.owner[tm.gtile] !== p.id || G.time >= tm.trainEnd) {
        if (p.id === G.userId && G.time >= tm.trainEnd) notify(p.id, '第' + (tm.id + 1) + '部隊練兵結束，返回駐地', 'good');
        startReturn(p, tm, tm.gtile);
        continue;
      }
      const e = CFG.TRAIN_EXP[T.lvl[tm.gtile]];
      for (const h of teamHeroes(p, tm)) if (h) gainExp(p, h, e);
    }
  }
  // 掃蕩：與己方土地的守軍交戰賺經驗，土地歸屬不變
  function resolveSweep(p, team, i, morale) {
    const atkUnits = teamUnits(p, team, morale);
    const g = CFG.GARRISON[T.lvl[i]];
    const logIt = p.id === G.userId;
    const targetName = CFG.RES_NAME[CFG.RES[T.res[i]]] + ' Lv.' + T.lvl[i];
    const report = logIt ? { id: G.nextReport++, t: G.time, tile: i, target: targetName + '（掃蕩）', atkName: p.name, atkPid: p.id, defName: '守軍', battles: [], result: '', read: false } : null;
    let won = true, kills = 0;
    for (let sq = 0; sq < g[0] && won; sq++) {
      if (!atkUnits.find(u => u.slot === 0 && u.troops > 0)) { won = false; break; }
      const dUnits = npcSquad(T.lvl[i], g[1], g[2], new Array(g[1]).fill(g[3]), i + sq, false);
      const res = Battle.simulate(atkUnits, dUnits, { log: !!report });
      applyLosses(p, res.A, outcomeOf(res, 0));
      syncUnits(atkUnits, res.A);
      kills += killsOf(res.D);
      if (report) addBattleToReport(report, null, res, '守軍' + (g[0] > 1 ? '（第' + (sq + 1) + '隊）' : ''), p, i, targetName);
      if (res.winner !== 'atk') won = false;
    }
    p.stats.kills += kills;
    for (const u of atkUnits) if (u.ref) gainExp(p, u.ref, kills * 0.45 * (won ? 1.3 : 1));
    if (report) {
      report.result = won ? '掃蕩成功' : '掃蕩失敗';
      report.win = won;
      pushReport(report);
      notify(p.id, '【戰報】掃蕩 ' + targetName + '：' + report.result, won ? 'good' : 'bad');
    }
  }

  // ================= 戰鬥結算 =================
  function npcSquad(lvl, count, heroLv, troops, key, city) {
    const types = ['步', '騎', '弓'];
    const units = [];
    const slots = count === 1 ? [0] : count === 2 ? [0, 2] : [0, 1, 2];
    const genericSk = ['tuji', 'huogong', 'luanji', 'jijiu', 'jianshou', 'fenzhan', 'zhenshe', 'jijianfang', 'poqianjun', 'guwu', 'kongluan', 'shisanhuan'];
    for (let k = 0; k < count; k++) {
      const tp = types[(key * 7 + k * 3) % 3];
      const sk = [];
      if (lvl >= 3) sk.push(genericSk[(key * 5 + k * 11) % genericSk.length]);
      if (lvl >= 7) sk.push(genericSk[(key * 13 + k * 7 + 3) % genericSk.length]);
      const phys = (key + k) % 3 !== 2;
      units.push({
        name: (city ? '城防' : '') + tp + '兵守軍', faction: '群', troop: tp, troops: troops[k] !== undefined ? troops[k] : 0,
        atk: (phys ? 48 : 30) + heroLv * (phys ? 2.2 : 1.2), def: 46 + heroLv * 2.05, int: (phys ? 32 : 50) + heroLv * (phys ? 1.1 : 2.2), spd: 45 + heroLv * 1.3,
        range: tp === '弓' ? 4 : 2, skills: sk, skl: sk.map(() => Math.min(CFG.SKILL_MAX_LV, lvl)), slot: slots[k], lv: heroLv,
      });
    }
    return units;
  }
  function landGarrison(i) {
    const lv = T.lvl[i];
    const g = CFG.GARRISON[lv];
    let st = G.landSiege[i];
    if (st && st.until < G.time) { delete G.landSiege[i]; st = null; }
    if (!st) {
      const squads = [];
      for (let s = 0; s < g[0]; s++) squads.push(new Array(g[1]).fill(g[3]));
      st = { squads, until: G.time + 30 };
    }
    return { lv, count: g[1], heroLv: g[2], st };
  }
  function cityGarrisonInit(c) {
    const g = CFG.CITY_GARRISON[c.lvl];
    if (!g) return;
    c.garrison = [];
    for (let s = 0; s < g[0]; s++) c.garrison.push([g[2], g[2], g[2]]);
  }
  function mainCityDefense(o) {
    const w = o.b.wall;
    const n = 1 + Math.floor(w / 4);
    const troops = 500 + w * 450;
    const sq = [];
    for (let k = 0; k < n; k++) sq.push([troops, troops, troops]);
    return { squads: sq, heroLv: 6 + Math.round(w * 3.5) };
  }

  function killsOf(side) { let k = 0; for (const u of side) k += (u.start - u.troops); return k; }

  function defendersAt(i, attacker) {
    // 回傳 [{p, team}] 防守部隊
    const out = [];
    const c = T.city[i];
    const ownerPid = tileOwner(i);
    const ownerAlli = tileAlliance(i);
    const isCity = c >= 0;
    const city = isCity ? World.cities[c] : null;
    for (const q of P) {
      if (q.id === attacker.id) continue;
      if (!(q.id === ownerPid || (ownerAlli >= 0 && q.alliance === ownerAlli))) continue;
      for (const tm of q.teams) {
        if (!tm.slots[0]) continue;
        const bh = heroByUid(q, tm.slots[0]);
        if (!bh || bh.troops <= 0) continue;
        if (tm.status === 'garrison' && (tm.gtile === i || (isCity && city.tiles.includes(tm.gtile)))) out.push({ p: q, team: tm });
        else if (tm.status === 'idle' && isCity && city.tiles.includes(tm.base)) out.push({ p: q, team: tm });
      }
    }
    return out;
  }

  function outcomeOf(res, side) { return res.winner === 'draw' ? 'draw' : (res.winner === 'atk') === (side === 0) ? 'win' : 'lose'; }
  function resolveAttack(p, team, i, morale) {
    const why = attackBlock(p, i);
    if (why) {
      if (p.id === G.userId) notify(p.id, '出征取消：' + why, 'warn');
      return;
    }
    if (morale === undefined) morale = 100;
    const atkUnits = teamUnits(p, team, morale);
    const logIt = p.id === G.userId || tileOwner(i) === G.userId;
    const c = T.city[i];
    const city = c >= 0 ? World.cities[c] : null;
    const targetName = city ? city.name : ((CFG.RES_NAME[CFG.RES[T.res[i]]]) + ' Lv.' + T.lvl[i]);
    const report = logIt ? { id: G.nextReport++, t: G.time, tile: i, target: targetName, atkName: p.name, atkPid: p.id, defName: '', battles: [], result: '', read: false } : null;
    let won = true;
    let totalKill = 0;
    const ownerPid = tileOwner(i);
    p.stats.battles++;
    // 1) 玩家防守部隊
    const defs = defendersAt(i, p);
    for (const d of defs) {
      const dUnits = teamUnits(d.p, d.team);
      const res = Battle.simulate(atkUnits, dUnits, { log: !!report || d.p.id === G.userId });
      applyLosses(p, res.A, outcomeOf(res, 0)); applyLosses(d.p, res.D, outcomeOf(res, 1));
      syncUnits(atkUnits, res.A);
      const kA = killsOf(res.D), kD = killsOf(res.A);
      totalKill += kA;
      p.stats.kills += kA; d.p.stats.kills += kD; p.stats.lost += kD; d.p.stats.lost += kA;
      for (const u of res.D) if (u.ref) gainExp(d.p, u.ref, kD * 0.4);
      if (report || d.p.id === G.userId) addBattleToReport(report, d.p, res, d.p.name + '的部隊', p, i, targetName);
      if (d.p.ai) AI.onAttacked(d.p, p, i, res.winner);
      if (res.winner !== 'atk') { won = false; if (res.winner === 'def') d.p.stats.wins++; break; }
      // 防守方大營陣亡：駐守部隊撤回
      if (d.team.status === 'garrison') startReturn(d.p, d.team, i);
    }
    // 2) NPC 守軍
    if (won) {
      let squadsState = null, heroLv = 0, count = 3, isLand = false, cityNpc = false, key = i;
      if (!city) {
        const lg = landGarrison(i);
        squadsState = lg.st.squads; heroLv = lg.heroLv; count = lg.count; isLand = true;
        G.landSiege[i] = lg.st; lg.st.until = G.time + 30;
      } else if (city.type === 'main' || (city.type === 'branch' && !(city.building > G.time))) {
        const o = P[city.owner];
        if (!city.garrison || city.resetAt < G.time) { const md = mainCityDefense(o); city.garrison = city.type === 'branch' ? md.squads.slice(0, 1) : md.squads; city.gLv = md.heroLv; }
        squadsState = city.garrison; heroLv = city.gLv || 10; count = 3;
        if (!city.resetAt || city.resetAt < G.time) city.resetAt = G.time + CFG.GARRISON_RESET_MIN;
      } else if (!World.isPlayerCity(city) && city.alliance < 0) {
        if (!city.garrison) cityGarrisonInit(city);
        if (!city.resetAt || city.resetAt < G.time) city.resetAt = G.time + CFG.GARRISON_RESET_MIN;
        squadsState = city.garrison; heroLv = CFG.CITY_GARRISON[city.lvl][1]; count = 3; cityNpc = true;
        key = city.id * 17;
      }
      if (squadsState) {
        for (let s = 0; s < squadsState.length && won; s++) {
          const sq = squadsState[s];
          if (sq.every(t => t <= 0)) continue;
          const dUnits = npcSquad(isLand ? T.lvl[i] : (city.lvl || 5), count, heroLv, sq, key + s, !!city);
          if (!(atkUnits.find(u => u.slot === 0 && u.troops > 0))) { won = false; break; }
          const res = Battle.simulate(atkUnits, dUnits, { log: !!report });
          applyLosses(p, res.A, outcomeOf(res, 0));
          syncUnits(atkUnits, res.A);
          // 寫回守軍兵力
          const left = dUnits.map(u => { const r = res.D.find(x => x.slot === u.slot); return r ? r.troops : 0; });
          for (let k = 0; k < sq.length; k++) sq[k] = left[k] !== undefined ? left[k] : 0;
          if (res.winner === 'atk') for (let k = 0; k < sq.length; k++) sq[k] = 0;
          const kA = killsOf(res.D);
          totalKill += kA; p.stats.kills += kA; p.stats.lost += killsOf(res.A);
          if (report) addBattleToReport(report, null, res, (city ? city.name + '守軍' : '守軍') + (squadsState.length > 1 ? '（第' + (s + 1) + '隊）' : ''), p, i, targetName);
          if (res.winner !== 'atk') won = false;
        }
      }
    }
    // 經驗
    for (const u of atkUnits) if (u.ref) gainExp(p, u.ref, totalKill * 0.45 * (won ? 1.3 : 1));
    if (won) p.stats.wins++;
    // 3) 佔領 / 攻城
    let result = won ? '勝利' : '失敗';
    if (won) {
      if (!city) {
        delete G.landSiege[i];
        if (p.landCount >= p.landCap) {
          result = '勝利（領地已達上限，未能佔領）';
          if (p.ai) p.capHit = G.time;
        } else {
          const prev = T.owner[i];
          setOwner(i, p.id);
          p.stats.landsTaken++;
          p.stats.maxLandLv = Math.max(p.stats.maxLandLv, T.lvl[i]);
          if (!p.firstCap[i]) { p.firstCap[i] = 1; p.fame += T.lvl[i] * CFG.FAME_PER_LVL; recompute(p); }
          result = '勝利，佔領土地';
          if (prev >= 0) {
            const op = P[prev];
            op.lastLoss = G.time;
            if (prev === G.userId) notify(prev, '領地(' + World.X(i) + ',' + World.Y(i) + ') 被【' + p.name + '】奪走了！', 'bad');
            if (op.ai) AI.onLandLost(op, p, i);
          }
        }
      } else {
        result = siege(p, team, city, atkUnits, report);
      }
    }
    if (report) {
      report.result = result;
      report.win = won;
      report.defName = report.defName || (ownerPid >= 0 ? P[ownerPid].name : '守軍');
      pushReport(report);
      if (p.id === G.userId) notify(p.id, '【戰報】' + targetName + '(' + World.X(i) + ',' + World.Y(i) + ')：' + result, won ? 'good' : 'bad');
      else if (ownerPid === G.userId) notify(G.userId, '【戰報】' + p.name + ' 進攻 ' + targetName + '：' + (won ? '我方失守' : '防守成功'), won ? 'bad' : 'good');
    }
    if (G.fx.length < 200) G.fx.push({ tile: i, kind: p.id === G.userId ? (won ? 'win' : 'lose') : (ownerPid === G.userId ? (won ? 'lose' : 'win') : 'other') });
    if (p.ai) AI.onBattleResult(p, team, i, won);
  }
  function syncUnits(units, resSide) {
    for (const u of units) { const r = resSide.find(x => x.slot === u.slot); u.troops = r ? r.troops : 0; }
  }
  function addBattleToReport(report, defP, res, defLabel, atkP, tile, targetName) {
    let rep = report;
    if (!rep) {
      // 使用者為防守方但進攻方非使用者時也需要戰報
      rep = { id: G.nextReport++, t: G.time, tile, target: targetName, atkName: atkP.name, atkPid: atkP.id, defName: defP ? defP.name : '', battles: [], result: '', read: false };
      rep.result = res.winner === 'atk' ? '防守失敗' : res.winner === 'def' ? '防守成功' : '平局';
      rep.win = res.winner !== 'atk';
      rep.asDef = true;
      pushReport(rep);
    }
    if (defP && !rep.defName) rep.defName = defP.name;
    rep.battles.push({
      def: defLabel, winner: res.winner, rounds: res.rounds, morale: res.A.length ? res.A[0].morale : 100,
      A: res.A.map(u => ({ name: u.name, troop: u.troop, faction: u.faction, lv: u.lv, start: u.start, end: u.troops, slot: u.slot })),
      D: res.D.map(u => ({ name: u.name, troop: u.troop, faction: u.faction, lv: u.lv, start: u.start, end: u.troops, slot: u.slot })),
      log: res.log,
    });
  }
  function pushReport(r) {
    if (G.reports.includes(r)) return;
    G.reports.unshift(r);
    if (G.reports.length > 120) G.reports.length = 120;
  }

  function siege(p, team, city, atkUnits, report) {
    let dmg = 0;
    for (const u of atkUnits) if (u.troops > 0) dmg += CFG.siegeValue(u.troops, u.siege || 10);
    dmg = Math.round(dmg);
    if (city.type === 'main') {
      const o = P[city.owner];
      city.dur = Math.max(0, city.dur - dmg);
      p.stats.cityDmg += dmg;
      if (city.dur <= 0) {
        city.dur = Math.round(city.maxDur * 0.5);
        city.garrison = null;
        o.captor = p.id; o.captureEnd = G.time + CFG.CAPTURE_HOURS * 60;
        G.fallCount = (G.fallCount || 0) + 1;
        recompute(o);
        sys('world', '【淪陷】' + (p.alliance >= 0 ? '〔' + G.alliances[p.alliance].name + '〕' : '') + p.name + ' 攻陷了 ' + o.name + ' 的主城！');
        if (o.id === G.userId) notify(o.id, '主城淪陷！你成為【' + p.name + '】的俘虜，將上繳 20% 資源 ' + CFG.CAPTURE_HOURS + ' 小時', 'bad');
        if (o.ai) AI.onCaptured(o, p);
        return '攻陷主城！';
      }
      return '拆除耐久 ' + dmg + '（剩餘 ' + city.dur + '/' + city.maxDur + '）';
    }
    if (World.isOutpost(city) || city.type === 'branch') {
      const nm = CFG.CITY_TYPE_NAME[city.type];
      const kill = city.type === 'branch' ? removeBranch : removeFort;
      if (city.building > G.time) { kill(city); return '摧毀建造中的' + nm; }
      city.dur = Math.max(0, city.dur - dmg);
      if (city.dur <= 0) { const o = P[city.owner]; kill(city); if (o && o.id === G.userId) notify(o.id, nm + '被【' + p.name + '】摧毀了！', 'bad'); return '摧毀' + nm + '！'; }
      return '拆除耐久 ' + dmg + '（剩餘 ' + city.dur + '）';
    }
    // 城池 / 關口
    if (p.alliance < 0) return '需加入同盟才能攻城';
    city.dur = Math.max(0, city.dur - dmg);
    city.contrib = city.contrib || {};
    city.contrib[p.id] = (city.contrib[p.id] || 0) + dmg;
    p.stats.cityDmg += dmg;
    if (city.dur <= 0) {
      captureCity(city, p);
      return '攻下' + CFG.CITY_TYPE_NAME[city.type] + '【' + city.name + '】！';
    }
    return '拆除耐久 ' + dmg + '（剩餘 ' + city.dur + '/' + city.maxDur + '）';
  }
  function captureCity(city, p) {
    const oldA = city.alliance;
    const a = G.alliances[p.alliance];
    if (oldA >= 0) {
      const oa = G.alliances[oldA];
      oa.cities = oa.cities.filter(x => x !== city.id);
      for (const mid of oa.members) recompute(P[mid]);
      sysAlly(oldA, '【失守】我盟的' + CFG.CITY_TYPE_NAME[city.type] + '【' + city.name + '】被〔' + a.name + '〕攻佔！');
      // 駐紮該城的敵方部隊撤回
      for (const mid of oa.members) {
        const q = P[mid];
        for (const tm of q.teams) {
          if (city.tiles.includes(tm.base)) { tm.base = q.cityTile; if (tm.status === 'idle') startReturn(q, tm, city.tiles[0]); }
          if (tm.status === 'garrison' && city.tiles.includes(tm.gtile)) startReturn(q, tm, tm.gtile);
        }
      }
    }
    city.alliance = p.alliance;
    city.garrison = null;
    city.resetAt = 0;
    city.dur = Math.round(city.maxDur * 0.3);
    city.capturedAt = G.time;
    city.holdSince = G.time;
    if (city.firstBy < 0) city.firstBy = p.alliance;
    a.cities.push(city.id);
    const contrib = city.contrib || {};
    for (const pid in contrib) {
      const q = P[pid];
      if (q && q.alliance === p.alliance) { q.stats.cities++; q.fame += city.lvl * 150; recompute(q); }
    }
    city.contrib = {};
    for (const mid of a.members) recompute(P[mid]);
    for (const t of city.tiles) markDirty(t);
    const tn = CFG.CITY_TYPE_NAME[city.type];
    sys('world', '【攻城】〔' + a.name + '〕攻下了' + World.states[city.state].name + '的' + tn + '【' + city.name + '】！');
    sysAlly(p.alliance, '【捷報】我盟攻下' + tn + '【' + city.name + '】！首功：' + p.name);
    G.news.unshift({ t: G.time, text: '〔' + a.name + '〕攻下' + tn + '【' + city.name + '】' });
    if (G.news.length > 60) G.news.length = 60;
    if (p.alliance === P[G.userId].alliance) notify(G.userId, '同盟攻下' + tn + '【' + city.name + '】！', 'good');
    AI.onCityCaptured(city, p.alliance, oldA);
  }

  // ================= 同盟 =================
  const ALLI_COLORS = ['#e0463a', '#3a7be0', '#e0b93a', '#9b4ae0', '#3ac7c7', '#e07a3a', '#7ae03a', '#e03a9b', '#3ae08a', '#b5b5b5', '#8a6a3a', '#3a4ae0', '#c73a5a', '#5ac73a', '#e0e03a', '#3aa0e0'];
  function createAlliance(p, name) {
    if (p.alliance >= 0) return err('已在同盟中');
    if (!name || name.length > 8) return err('同盟名稱需 1~8 字');
    if (G.alliances.some(a => !a.dead && a.name === name)) return err('名稱已被使用');
    if (!canAfford(p, CFG.ALLIANCE_CREATE_COST)) return err('銅幣不足（需要 10000）');
    pay(p, CFG.ALLIANCE_CREATE_COST);
    const a = { id: G.alliances.length, name, leader: p.id, members: [], color: ALLI_COLORS[G.alliances.length % ALLI_COLORS.length], cities: [], created: G.time, target: -1, targetSince: 0, notice: '', dead: false, state: p.state, open: true, power: 0, marks: [] };
    G.alliances.push(a);
    G.chat.ally[a.id] = [];
    joinAlliance(p, a.id, true);
    p.role = 2;
    sys('world', '【結盟】' + p.name + ' 創建了同盟〔' + name + '〕');
    return ok({ alliance: a });
  }
  function joinAlliance(p, aid, force) {
    const a = G.alliances[aid];
    if (!a || a.dead) return err('同盟不存在');
    if (p.alliance >= 0) return err('已在同盟中');
    if (a.members.length >= CFG.ALLIANCE_MAX) return err('同盟人數已滿');
    if (!force && !a.open) return err('該同盟不接受申請');
    p.alliance = aid; p.role = 0;
    a.members.push(p.id);
    if (p.id === G.userId) G.overlayAll = true;
    for (const t of p.lands) markDirty(t);
    for (const t of World.cities[p.city].tiles) markDirty(t);
    recompute(p);
    if (!force || p.role !== 2) sysAlly(aid, '【入盟】歡迎 ' + p.name + ' 加入同盟！');
    if (a.members.length > 1 && AI.onJoin) AI.onJoin(p, a);
    return ok();
  }
  function leaveAlliance(p) {
    if (p.alliance < 0) return err('不在同盟中');
    const a = G.alliances[p.alliance];
    a.members = a.members.filter(x => x !== p.id);
    // 駐紮同盟城池的部隊回主城
    for (const tm of p.teams) {
      if (tm.base !== p.cityTile) { tm.base = p.cityTile; if (tm.status === 'idle') startReturn(p, tm, World.cities[p.city].tiles[0]); }
      if (tm.status === 'garrison' && !(T.owner[tm.gtile] === p.id)) startReturn(p, tm, tm.gtile);
    }
    p.alliance = -1; p.role = 0;
    if (p.id === G.userId) G.overlayAll = true;
    for (const t of p.lands) markDirty(t);
    for (const t of World.cities[p.city].tiles) markDirty(t);
    recompute(p);
    sysAlly(a.id, p.name + ' 離開了同盟');
    if (!a.members.length) disband(a);
    else if (a.leader === p.id) {
      const nl = a.members.map(id => P[id]).sort((x, y) => y.power - x.power)[0];
      a.leader = nl.id; nl.role = 2;
      sysAlly(a.id, '盟主之位由 ' + nl.name + ' 接任');
    }
    return ok();
  }
  function disband(a) {
    a.dead = true;
    for (const cid of a.cities) {
      const c = World.cities[cid];
      c.alliance = -1; c.garrison = null; c.dur = c.maxDur; c.holdSince = -1;
      for (const t of c.tiles) markDirty(t);
    }
    a.cities = [];
    sys('world', '【解散】同盟〔' + a.name + '〕解散了');
  }

  // ================= 聊天 / 通知 =================
  function sys(ch, text) { pushChat(ch === 'world' ? G.chat.world : G.chat.sys, { t: G.time, from: -1, name: '系統', text, sys: true }); }
  function sysAlly(aid, text) { if (aid < 0) return; if (!G.chat.ally[aid]) G.chat.ally[aid] = []; pushChat(G.chat.ally[aid], { t: G.time, from: -1, name: '同盟', text, sys: true }); }
  function say(p, ch, text) {
    const msg = { t: G.time, from: p.id, name: p.name, text, tag: p.alliance >= 0 ? G.alliances[p.alliance].name : '' };
    if (ch === 'ally') {
      if (p.alliance < 0) return err('尚未加入同盟');
      if (!G.chat.ally[p.alliance]) G.chat.ally[p.alliance] = [];
      pushChat(G.chat.ally[p.alliance], msg);
      if (!p.ai) AI.onUserChat(p, 'ally', text);
    } else {
      pushChat(G.chat.world, msg);
      if (!p.ai) AI.onUserChat(p, 'world', text);
    }
    return ok();
  }
  function pushChat(arr, msg) { arr.push(msg); if (arr.length > 150) arr.splice(0, arr.length - 150); G.chatVer = (G.chatVer || 0) + 1; }
  function notify(pid, text, type) { if (pid !== G.userId) return; G.notices.push({ t: G.time, text, type: type || 'info' }); if (G.notices.length > 50) G.notices.shift(); }

  // ================= 主循環 =================
  function advance(minutes) {
    if (G.over) return;
    G.acc += minutes;
    let n = 0;
    while (G.acc >= 1 && n < 200) { G.acc -= 1; tick(); n++; if (G.over) break; }
    if (n >= 200) G.acc = 0;
  }
  function tick() {
    G.time += 1;
    const now = G.time;
    // 資源
    for (const p of P) {
      for (const r of CFG.RES) {
        if (p.res[r] < p.cap) p.res[r] = Math.min(p.cap, p.res[r] + p.prod[r] / 60);
      }
      p.copper += p.prod.copper / 60;
      if (p.captor >= 0) {
        const cp = P[p.captor];
        for (const r of CFG.RES) cp.res[r] = Math.min(Math.max(cp.cap, cp.res[r]), cp.res[r] + p.prod[r] * CFG.TRIBUTE_PCT / (1 - CFG.TRIBUTE_PCT) / 60);
        if (now >= p.captureEnd || cp.alliance >= 0 && cp.alliance === p.alliance) {
          p.captor = -1; p.protectEnd = Math.max(p.protectEnd, now + 120);
          recompute(p);
          notify(p.id, '你已擺脫淪陷狀態，主城獲得 2 小時保護', 'good');
        }
      }
      // 建造完成
      if (p.bq.length) {
        for (let k = p.bq.length - 1; k >= 0; k--) {
          const q = p.bq[k];
          if (q.end <= now) {
            p.b[q.key] = q.lv;
            p.bq.splice(k, 1);
            p.fame += q.lv * 25;
            recompute(p);
            notify(p.id, BUILDING_BY_KEY[q.key].name + ' 升級至 ' + q.lv + ' 級', 'good');
          }
        }
      }
      // 預備兵
      const rcap = CFG.reserveCap(p.b.recruit);
      if (p.reserve < rcap) p.reserve = Math.min(rcap, p.reserve + CFG.reserveProd(p.b.recruit) / 60);
      // 傷兵治療（部隊在主城待命）
      healTick(p);
      trainTick(p);
      // 征兵完成
      for (const tm of p.teams) {
        if (tm.rq && tm.rq.end <= now) {
          for (const uid in tm.rq.add) { const h = heroByUid(p, +uid); if (h) h.troops = Math.min(heroCap(p, h) - (h.wnd || 0), h.troops + tm.rq.add[uid]); }
          tm.rq = null;
          if (p.id === G.userId) notify(p.id, '第' + (tm.id + 1) + '部隊征兵完成', 'good');
        }
      }
    }
    processMarches();
    // 城池恢復
    if (now % 10 === 0) {
      for (const c of World.cities) {
        if (c.dead || !c.maxDur) continue;
        if (c.dur < c.maxDur) c.dur = Math.min(c.maxDur, c.dur + c.maxDur * CFG.DUR_REGEN_PCT_H / 6 * (c.alliance >= 0 ? 2 : 1));
        if (c.resetAt && c.resetAt < now && c.garrison) {
          if (c.type !== 'main') { c.garrison = null; c.resetAt = 0; }
          else { c.garrison = null; c.resetAt = 0; }
        }
        if ((World.isOutpost(c) || c.type === 'branch') && c.building && c.building <= now) {
          c.building = 0;
          if (c.type === 'branch') recompute(P[c.owner]);
          if (c.owner === G.userId) notify(c.owner, CFG.CITY_TYPE_NAME[c.type] + '建造完成', 'good');
        }
        if (c.type === 'camp' && c.expire && c.expire <= now) { if (c.owner === G.userId) notify(c.owner, '營帳到期，已拆除', 'info'); removeFort(c); }
      }
      for (const k in G.landSiege) if (G.landSiege[k].until < now) delete G.landSiege[k];
    }
    // AI
    for (const p of P) {
      if (p.ai && p.nextThink <= now) {
        AI.think(p);
        p.nextThink = now + AI.interval(p);
      }
    }
    AI.alliancesThink(now);
    if (now % 3 === 0) AI.chatTick();
    // 每日
    const d = day();
    if (d !== G.lastDay) {
      G.lastDay = d;
      for (const p of P) { p.gold += CFG.DAILY_GOLD; p.skp += CFG.DAILY_SKP; if (p.ai) AI.daily(p); }
      notify(G.userId, '新的一天！獲得每日金銖 ' + CFG.DAILY_GOLD + '、戰法點 ' + CFG.DAILY_SKP, 'good');
      const ph = CFG.PHASES.find(x => x.day === d);
      if (ph) sys('world', '【天下大勢】進入「' + ph.name + '」：' + ph.desc);
    }
    if (now % 60 === 0) { updatePower(); checkSeason(); }
  }
  function phase() {
    const d = day();
    let ph = CFG.PHASES[0];
    for (const x of CFG.PHASES) if (d >= x.day) ph = x;
    return ph;
  }
  function updatePower() {
    for (const p of P) {
      let lp = 0;
      for (const t of p.lands) lp += T.lvl[t] * T.lvl[t] * 8;
      let bp = 0;
      for (const k in p.b) bp += p.b[k] * 60;
      let hp = 0;
      for (const tm of p.teams) hp += teamPower(p, tm) * 0.3;
      p.power = Math.round(lp + bp + hp + p.fame * 0.2);
    }
    for (const a of G.alliances) {
      if (a.dead) continue;
      let s = 0;
      for (const m of a.members) s += P[m].power;
      a.power = s;
    }
    G.rankCache = null;
  }
  function alliancePoints(a) {
    let pts = 0;
    for (const cid of a.cities) pts += CFG.CITY_POINTS[World.cities[cid].type] || 0;
    return pts;
  }
  function checkSeason() {
    if (G.over) return;
    const ly = World.cities.find(c => c.type === 'luoyang');
    if (ly && ly.alliance >= 0 && ly.holdSince >= 0 && G.time - ly.holdSince >= CFG.HEGEMONY_HOLD_MIN) {
      endSeason(ly.alliance, '霸業');
      return;
    }
    if (G.time >= CFG.SEASON_DAYS * 1440) {
      let best = -1, bp = -1;
      for (const a of G.alliances) { if (a.dead) continue; const pt = alliancePoints(a) * 1e6 + a.power; if (pt > bp) { bp = pt; best = a.id; } }
      endSeason(best, '賽季結束');
    }
  }
  function endSeason(aid, why) {
    G.over = true;
    G.winner = aid;
    G.endReason = why;
    const a = G.alliances[aid];
    sys('world', '【賽季結算】' + (a ? '〔' + a.name + '〕' + (why === '霸業' ? '堅守洛陽，成就霸業，一統天下！' : '以最多城池積分奪得本季霸主！') : '賽季結束'));
  }

  // ================= 存檔 =================
  // 精簡存檔：地形由種子重建，僅存動態資料
  // v3 存檔直接保存戰法 id；v2 存檔保存的是舊版戰法索引，經 LEGACY_SKILL_IDS 與 SKILLS._alias 對照
  let skOf = s => (s && SKILLS[s]) ? s : null;
  const legacySk = i => {
    if (i === null || i === undefined || i < 0) return null;
    const id = LEGACY_SKILL_IDS[i];
    const to = SKILLS._alias[id] || id;
    return SKILLS[to] ? to : null;
  };
  function packHero(h) {
    return [h.uid, h.t, h.lv, Math.round(h.exp), h.troops, Math.round(h.sta * 10) / 10, h.staT, h.pts.atk, h.pts.def, h.pts.int, h.pts.spd, h.adv,
      h.sk.map(s => s || 0), h.team, h.wnd || 0, h.sl, h.awk || 0];
  }
  function unpackHero(a) {
    return { uid: a[0], t: a[1], lv: a[2], exp: a[3], troops: a[4], wnd: a[14] || 0, sta: a[5], staT: a[6], pts: { atk: a[7], def: a[8], int: a[9], spd: a[10] }, adv: a[11], sk: a[12].map(skOf), sl: a[15] || [1, 1, 1], awk: a[16] || 0, team: a[13] };
  }
  function serialize() {
    const cities = World.cities.map(c => {
      const o = Object.assign({}, c);
      delete o.tiles;
      if (o.contrib && !Object.keys(o.contrib).length) delete o.contrib;
      return o;
    });
    const trimChat = arr => arr.slice(-60);
    const chat = { world: trimChat(G.chat.world), sys: trimChat(G.chat.sys), ally: {} };
    for (const k in G.chat.ally) chat.ally[k] = trimChat(G.chat.ally[k]);
    const data = {
      v: 3,
      G: Object.assign({}, G, { dirty: [], fx: [], rankCache: null, notices: [], chat, reports: G.reports.slice(0, 60).map((r, k) => k < 20 ? r : Object.assign({}, r, { battles: r.battles.map(b => Object.assign({}, b, { log: [] })) })) }),
      cities,
      owner: U.rle(T.owner),
      rng: U.getRngState(),
    };
    // 聯盟路徑場等暫存資料不存
    data.G.alliances = G.alliances.map(a => { const o = Object.assign({}, a); delete o.field; delete o.fieldList; delete o.pave; return o; });
    data.G.players = P.map(p => {
      const o = Object.assign({}, p);
      delete o.lands; delete o.aiMem; delete o._btp; delete o._btpT;
      o.heroes = p.heroes.map(packHero);
      o.firstCap = U.encodeInts(Object.keys(p.firstCap).map(Number));
      o.lib = p.lib.slice();
      o.libp = Object.assign({}, p.libp);
      return o;
    });
    return JSON.stringify(data);
  }
  function deserialize(str) {
    const data = JSON.parse(str);
    if (data.v !== 2 && data.v !== 3) throw new Error('舊版存檔不相容');
    skOf = data.v === 2 ? legacySk : (s => (s && SKILLS[s]) ? s : null);
    World.generate(data.G.seed, data.G.mapN || CFG.MAP_N, data.G.genVer || 1);
    T = World.T;
    const N = World.N;
    // 城池：NPC 城池由種子重建（順序一致），主城與要塞重新套用
    const npcCount = World.cities.length;
    World.cities.length = 0;
    for (const c of data.cities) {
      const h = (c.size - 1) >> 1;
      c.tiles = [];
      if (c.type === 'main') { World.cities.push(c); World.applyMainCity(c); continue; }
      if (c.type === 'fort' || c.type === 'camp') { c.tiles = [c.cy * N + c.cx]; World.cities.push(c); if (!c.dead) T.city[c.tiles[0]] = c.id; continue; }
      if (c.type === 'branch') { World.cities.push(c); if (!c.dead) World.applyCityTiles(c); else { for (let y = c.cy - 1; y <= c.cy + 1; y++) for (let x = c.cx - 1; x <= c.cx + 1; x++) c.tiles.push(y * N + x); } continue; }
      for (let y = c.cy - h; y <= c.cy + h; y++) for (let x = c.cx - h; x <= c.cx + h; x++) c.tiles.push(y * N + x);
      World.cities.push(c);
    }
    if (World.cities.filter(c => !World.isPlayerCity(c)).length !== npcCount) throw new Error('地圖重建不一致');
    T.owner = U.unrle(data.owner, N * N);
    for (const k in G) delete G[k];
    Object.assign(G, data.G);
    P = G.players;
    for (const p of P) {
      p.heroes = p.heroes.map(unpackHero);
      const fc = {};
      for (const i of U.decodeInts(p.firstCap)) fc[i] = 1;
      p.firstCap = fc;
      p.lib = p.lib.map(skOf).filter((s, i, a) => s && a.indexOf(s) === i);
      // 自帶戰法固定為武將模板的戰法（舊存檔的自帶戰法已換成官方戰法）
      for (const h of p.heroes) { h.sk[0] = tpl(h).skill; for (let k = 1; k < 3; k++) if (h.sk[k] && h.sk.indexOf(h.sk[k]) !== k) h.sk[k] = null; }
      const lp = {};
      for (const k in (p.libp || {})) { const sid = skOf(k); if (sid && !p.lib.includes(sid)) lp[sid] = p.libp[k]; }
      p.libp = lp;
      if (p.skp === undefined) p.skp = CFG.SKP_START;
      if (p.reserve === undefined) p.reserve = CFG.RESERVE_START;
    }
    landPos = new Int32Array(N * N).fill(-1);
    for (const p of P) { p.lands = []; }
    for (let i = 0; i < N * N; i++) {
      const o = T.owner[i];
      if (o >= 0 && T.city[i] < 0) { landPos[i] = P[o].lands.length; P[o].lands.push(i); }
      else if (o >= 0 && T.city[i] >= 0 && World.isOutpost(World.cities[T.city[i]])) { landPos[i] = P[o].lands.length; P[o].lands.push(i); }
    }
    G.dirty = []; G.notices = []; G.fx = []; G.invites = G.invites || [];
    U.setRngState(data.rng);
    for (const p of P) if (p.ai) AI.restore(p);
    recomputeAll();
    return G;
  }
  function save() {
    try { localStorage.setItem('stzb_save', serialize()); return true; } catch (e) { console.warn('save failed', e); return false; }
  }
  function hasSave() { try { return !!localStorage.getItem('stzb_save'); } catch (e) { return false; } }
  function load() {
    try { const s = localStorage.getItem('stzb_save'); if (!s) return null; return deserialize(s); } catch (e) { console.warn('load failed', e); return null; }
  }
  function clearSave() { try { localStorage.removeItem('stzb_save'); } catch (e) { /* */ } }

  function ok(o) { return Object.assign({ ok: true }, o || {}); }
  function err(msg) { return { ok: false, msg }; }

  // 使用者儲值（模擬）
  function recharge(p, amt, kind) {
    if (kind === 'copper') { p.copper += amt; return ok(); }
    p.gold += amt; p.stats.paid = (p.stats.paid || 0) + amt; return ok();
  }

  function claimQuest(p, q) {
    if (p.quests[q.id]) return err('已領取');
    if (!q.check(p)) return err('尚未完成');
    p.quests[q.id] = 1;
    gain(p, q.reward);
    return ok();
  }

  return {
    G, newGame, advance, tick, day, phase,
    get T() { return T; }, get P() { return P; },
    // 武將
    addHero, heroByUid, tpl, heroCap, heroRoom, heroStats, freePoints, getSta, gainExp, slotUnlocked,
    drawPack, advanceHero, inheritHero, learnSkill, addPoint, resetPoints,
    awakenHero, awakenFodder, eventStatus, exchangeEvent,
    drillSkill, convertHero, convertValue, upgradeSkill, skillInvested, teamWounded, healTime,
    // 部隊
    teamCount, costCap, teamHeroes, teamBonus, teamCost, teamTroops, teamCapTroops, teamMinSta, teamSpeed, teamUnits, teamPower, teamReady,
    setSlot, autoFillTeam, recruit, recruitCost,
    // 資源建築
    canAfford, pay, gain, recompute, upgradeBuilding, mainCityMaxDur, allianceBonus,
    // 地圖
    tileOwner, tileAlliance, isFriendly, adjFriendly, attackBlock, setOwner, abandon, buildFort, cityLockedDay, baseValid,
    buildCamp, buildBranch, canBranch, relocate, canRelocate, isHome, farmYield, outpostCount,
    // 行軍
    send, recall, marchPos, marchTime, marchMorale, startReturn,
    landGarrison, npcSquad, cityGarrisonInit, mainCityDefense,
    // 同盟
    createAlliance, joinAlliance, leaveAlliance, alliancePoints,
    // 聊天
    say, sys, sysAlly, notify,
    // 其他
    save, load, hasSave, clearSave, serialize, deserialize, recharge, claimQuest, updatePower,
    ok, err,
  };
})();
