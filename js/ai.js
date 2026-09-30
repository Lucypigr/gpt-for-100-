// AI 玩家：模擬真人行為（新手/休閒/普通/老手/課長），全體同時行動
'use strict';

var AI = (function () {
  const TYPES = {
    newbie: { label: '新手', skill: [0.08, 0.35], act: [8, 20], aggr: [0.05, 0.3], gold: [0, 400], daily: [0, 0], chat: 0.9 },
    casual: { label: '休閒', skill: [0.3, 0.55], act: [7, 16], aggr: [0.1, 0.35], gold: [100, 800], daily: [0, 60], chat: 0.6 },
    regular: { label: '普通', skill: [0.45, 0.72], act: [4, 10], aggr: [0.25, 0.6], gold: [300, 2000], daily: [0, 200], chat: 0.6 },
    veteran: { label: '老手', skill: [0.75, 0.97], act: [2, 5], aggr: [0.45, 0.9], gold: [600, 3500], daily: [100, 400], chat: 0.7 },
    whale: { label: '課長', skill: [0.45, 0.9], act: [2, 6], aggr: [0.55, 1.0], gold: [18000, 50000], daily: [2500, 7000], chat: 1.0 },
  };
  const MIX = [['newbie', 30], ['casual', 25], ['regular', 45], ['veteran', 30], ['whale', 20]];
  // 土地守軍「50%勝率」所需戰力倍數（由離線模擬校準）
  let GP = null, CP = null;
  const R50 = [0, 0.6, 0.8, 1.45, 1.75, 1.9, 1.75, 1.65, 1.6, 1.55];
  const CR50 = { 5: 2.6, 6: 2.6, 7: 2.3, 8: 2.3, 9: 2.2, 10: 2.1 };

  function G() { return Game.G; }
  // 地圖放大倍數：同盟選目標、鋪路、招人等「戰略距離」隨地圖等比放大
  function MS() { return Math.max(1, World.N / 300); }

  function makeProfiles(n) {
    const out = [];
    const total = MIX.reduce((s, x) => s + x[1], 0);
    for (const [type, cnt] of MIX) {
      const k = Math.round(cnt * n / total);
      for (let i = 0; i < k; i++) out.push(type);
    }
    while (out.length < n) out.push('regular');
    out.length = n;
    U.shuffle(out);
    return out.map(type => {
      const d = TYPES[type];
      return {
        type, label: d.label,
        skill: U.rrange(d.skill[0], d.skill[1]),
        act: U.rrange(d.act[0], d.act[1]),
        aggr: U.rrange(d.aggr[0], d.aggr[1]),
        daily: Math.round(U.rrange(d.daily[0], d.daily[1])),
        gold: Math.round(U.rrange(d.gold[0], d.gold[1])),
        chat: d.chat * U.rrange(0.4, 1.3),
        leader: false,
        loyalty: U.rrange(0.3, 1),
        persona: 'normal',
      };
    }).map(assignPersonaInit(n));
  }
  // 個性（與技術類型無關）：梟雄、好戰者、叛徒、火爆鄰居、龜縮
  const PERSONA = {
    overlord: { label: '梟雄' }, warmonger: { label: '好戰者' }, traitor: { label: '叛徒' },
    hothead: { label: '火爆' }, turtle: { label: '龜縮' }, normal: { label: '一般' },
  };
  function assignPersonaInit(n) {
    const quota = { overlord: Math.max(1, Math.round(n / 75)), warmonger: Math.max(2, Math.round(n / 25)), traitor: Math.max(2, Math.round(n / 30)) };
    const used = { overlord: 0, warmonger: 0, traitor: 0 };
    return pr => {
      const t = pr.type;
      if (used.overlord < quota.overlord && (t === 'whale' || t === 'veteran')) { used.overlord++; return setPersona(pr, 'overlord'); }
      if (used.warmonger < quota.warmonger && t !== 'newbie' && t !== 'casual') { used.warmonger++; return setPersona(pr, 'warmonger'); }
      if (used.traitor < quota.traitor && t !== 'newbie') { used.traitor++; return setPersona(pr, 'traitor'); }
      const r = U.rnd();
      if (r < 0.22 && t !== 'newbie') return setPersona(pr, 'hothead');
      if (r < 0.4 && (t === 'casual' || t === 'newbie' || t === 'regular')) return setPersona(pr, 'turtle');
      return pr;
    };
  }
  function setPersona(pr, k) {
    pr.persona = k;
    if (k === 'overlord') { pr.skill = Math.max(pr.skill, 0.95); pr.aggr = Math.max(pr.aggr, 0.8); pr.gold += 20000; pr.daily = Math.max(pr.daily, 3000); pr.act = Math.min(pr.act, 3); pr.chat = Math.max(pr.chat, 0.9); }
    if (k === 'warmonger') { pr.aggr = 1; pr.skill = Math.max(pr.skill, 0.7); pr.chat = Math.max(pr.chat, 0.9); }
    if (k === 'traitor') { pr.loyalty = 0; }
    if (k === 'hothead') { pr.aggr = Math.max(pr.aggr, 0.65); pr.chat = Math.max(pr.chat, 0.8); }
    if (k === 'turtle') { pr.aggr = 0.02; }
    return pr;
  }
  function persona(p) { return p.prof.persona || 'normal'; }
  // 同一陣營：同盟相同，或有從屬（附庸）關係
  function sameBloc(a1, a2) {
    if (a1 < 0 || a2 < 0) return false;
    if (a1 === a2) return true;
    const A = G().alliances[a1], B = G().alliances[a2];
    if (!A || !B || A.dead || B.dead) return false;
    const la = A.lord >= 0 && !G().alliances[A.lord].dead ? A.lord : a1, lb = B.lord >= 0 && !G().alliances[B.lord].dead ? B.lord : a2;
    return la === lb;
  }
  function userLed(a) { return a && !Game.P[a.leader].ai; }

  function calib() {
    if (GP) return;
    GP = [0]; CP = {};
    for (let L = 1; L <= 9; L++) {
      const g = CFG.GARRISON[L];
      const sq = Game.npcSquad(L, g[1], g[2], new Array(g[1]).fill(g[3]), 1, false);
      GP.push(Battle.power(sq) * (g[0] === 2 ? 1.75 : 1));
    }
    for (const L in CFG.CITY_GARRISON) {
      const g = CFG.CITY_GARRISON[L];
      const sq = Game.npcSquad(+L, 3, g[1], [g[2], g[2], g[2]], 1, true);
      CP[L] = Battle.power(sq);
    }
  }

  function mem(p) {
    if (!p.aiMem) p.aiMem = { nextHero: 0, nextTeam: 0, heroCount: -1, lastChat: -999, fortFor: -1, lastBuildThink: 0, conquest: -1 };
    return p.aiMem;
  }
  function init(p) {
    calib();
    const pr = p.prof;
    p.gold += pr.gold;
    p.nextThink = U.rint(1, 12);
    const m = mem(p);
    const joinDelay = { newbie: [240, 2600], casual: [160, 1200], regular: [90, 700], veteran: [40, 300], whale: [30, 260] }[pr.type];
    m.joinAt = U.rint(joinDelay[0], joinDelay[1]);
    if (pr.type === 'newbie' && U.chance(0.25)) m.joinAt = 99999; // 有些新手不主動入盟
  }
  function restore(p) { calib(); mem(p); }
  function interval(p) {
    const base = p.prof.act;
    return Math.max(1, Math.round(base * U.rrange(0.6, 1.4)));
  }

  // 世界初始化後：指定各州盟主
  function setupLeaders() {
    const P = Game.P;
    const byState = {};
    for (const p of P) { if (!p.ai) continue; (byState[p.state] = byState[p.state] || []).push(p); }
    for (const st in byState) {
      const arr = byState[st].filter(p => p.prof.type === 'whale' || p.prof.type === 'veteran')
        .sort((a, b) => (b.prof.skill + (b.prof.type === 'whale' ? 0.3 : 0)) - (a.prof.skill + (a.prof.type === 'whale' ? 0.3 : 0)));
      if (arr.length) { arr[0].prof.leader = true; mem(arr[0]).createAt = U.rint(20, 240); }
    }
    // 梟雄一定自立門戶，而且很早開盟
    for (const p of P) if (p.ai && persona(p) === 'overlord') { p.prof.leader = true; mem(p).createAt = U.rint(10, 90); }
    // 額外幾位想自立門戶的玩家
    const extra = U.shuffle(P.filter(p => p.ai && !p.prof.leader && (p.prof.type === 'whale' || p.prof.type === 'veteran' || p.prof.type === 'regular'))).slice(0, 3);
    for (const p of extra) { p.prof.leader = true; mem(p).createAt = U.rint(200, 900); }
  }

  // ================= 主決策 =================
  function think(p) {
    const g = G();
    if (g.over) return;
    const m = mem(p);
    const pr = p.prof;
    // 同盟
    if (p.alliance < 0) allianceSeek(p, m);
    // 內政
    manageBuild(p);
    // 武將管理（低頻）
    if (g.time >= m.nextHero || p.heroes.length !== m.heroCount) {
      manageHeroes(p);
      m.nextHero = g.time + Math.round(U.rrange(60, 240) / (0.5 + pr.skill));
      m.heroCount = p.heroes.length;
      m.nextTeam = 0;
    }
    if (g.time >= m.nextTeam) { manageTeams(p); m.nextTeam = g.time + U.rint(180, 480); }
    // 領地上限管理
    manageLands(p);
    // 要塞
    manageFort(p);
    manageBranch(p);
    if (g.time >= (m.nextPersona || 0)) { m.nextPersona = g.time + U.rint(90, 180); personaThink(p); }
    // 軍事
    military(p);
  }

  // ================= 同盟 =================
  function allianceSeek(p, m) {
    const g = G();
    if (p.prof.leader && m.createAt !== undefined && g.time >= m.createAt) {
      const used = new Set(g.alliances.map(a => a.name));
      if (p.copper < CFG.ALLIANCE_CREATE_COST.copper) p.copper = CFG.ALLIANCE_CREATE_COST.copper; // 盟主會存錢
      const r = Game.createAlliance(p, U.allianceName(used));
      if (r.ok) {
        delete m.createAt;
        Game.say(p, 'world', U.pick(CHAT.recruit).replace('{a}', r.alliance.name).replace('{s}', World.states[p.state].name));
      }
      return;
    }
    if (p.prof.leader && m.createAt !== undefined) return; // 盟主不加入他盟
    if (g.time < m.joinAt) return;
    const cands = g.alliances.filter(a => !a.dead && a.members.length < CFG.ALLIANCE_MAX && a.open !== false);
    if (!cands.length) return;
    const best = U.weighted(cands, a => {
      const same = a.members.filter(id => Game.P[id].state === p.state).length;
      return (same * 4 + 1) * (1 + a.power / 50000) * (a.state === p.state ? 3 : 0.3) * (a.members.length > 32 ? 0.3 : 1);
    });
    if (best) {
      Game.joinAlliance(p, best.id);
      if (U.chance(0.5)) later(p, 'ally', U.pick(CHAT.joinGreet), U.rint(1, 8));
    }
  }
  function onJoin(p, a) { /* 盟友歡迎 */
    if (U.chance(0.4)) {
      const other = Game.P[U.pick(a.members)];
      if (other && other.ai && other !== p) later(other, 'ally', U.pick(CHAT.welcome).replace('{n}', p.name), U.rint(1, 6));
    }
  }

  // ================= 內政 =================
  function manageBuild(p) {
    if (p.bq.length >= 2) return;
    const m = mem(p);
    if (G().time < (m.nextBuild || 0)) return;
    const pr = p.prof;
    const opts = [];
    for (const bd of BUILDINGS) {
      const key = bd.key;
      const to = p.b[key] + 1;
      if (to > bd.max || to > buildingMaxAllowed(key, p.b.palace)) continue;
      if (p.bq.some(q => q.key === key)) continue;
      const cost = buildingCost(key, to);
      if (!Game.canAfford(p, cost)) continue;
      opts.push({ key, to, score: buildScore(p, key, to) });
    }
    if (!opts.length) { m.nextBuild = G().time + U.rint(8, 25); return; }
    let pick;
    if (U.rnd() < pr.skill) { opts.sort((a, b) => b.score - a.score); pick = opts[0]; }
    else pick = U.pick(opts);
    if (pick.score <= 0 && U.rnd() < pr.skill) return;
    Game.upgradeBuilding(p, pick.key);
  }
  function buildScore(p, key, to) {
    const b = p.b;
    const resLow = CFG.RES.reduce((mn, r) => Math.min(mn, p.prod[r]), 1e9);
    const nearCap = CFG.RES.some(r => p.res[r] > p.cap * 0.85);
    switch (key) {
      case 'palace': {
        const need = Math.max(0, to - 2);
        return ['lumber', 'ironw', 'quarry', 'farm'].every(k => b[k] >= need) ? 90 - to * 2 : -1;
      }
      case 'lumber': case 'ironw': case 'quarry': case 'farm': {
        const r = { lumber: 'wood', ironw: 'iron', quarry: 'stone', farm: 'grain' }[key];
        return 60 - to * 3 + (p.prod[r] <= resLow + 1 ? 20 : 0) + (r === 'stone' || r === 'grain' ? 5 : 0);
      }
      case 'drill': return 100 - to * 6;
      case 'warehouse': return nearCap ? 95 : 20 - to;
      case 'barracks': return 55 - to * 2;
      case 'command': return 58 - to * 3;
      case 'recruit': return 35 - to * 2;
      case 'house': return 30 - to * 2;
      case 'wall': return (p.lastLoss > 0 && G().time - p.lastLoss < 600 ? 50 : 18) - to;
      default: return 25 - to * 3;
    }
  }

  // ================= 武將 =================
  function manageHeroes(p) {
    const pr = p.prof;
    // 抽卡
    let draws = 0;
    if (pr.type === 'whale') { while (p.gold >= 900 && draws < 12) { Game.drawPack(p, 'gold5'); draws++; } }
    else if (pr.skill > 0.6) { while (p.gold >= 900 && draws < 3) { Game.drawPack(p, 'gold5'); draws++; } }
    else { while (p.gold >= 200 && draws < 4 && U.chance(0.7)) { Game.drawPack(p, 'gold'); draws++; } }
    if (p.copper > 30000 && U.chance(0.5)) Game.drawPack(p, 'copper');
    // 進階（同名合併）
    const byName = {};
    for (const h of p.heroes) (byName[Game.tpl(h).name] = byName[Game.tpl(h).name] || []).push(h);
    for (const name in byName) {
      const arr = byName[name].sort((a, b) => (b.team >= 0) - (a.team >= 0) || b.lv - a.lv);
      const main = arr[0];
      for (let k = 1; k < arr.length; k++) {
        const f = arr[k];
        if (f.team >= 0) continue;
        if (main.adv < 5 && Game.tpl(main).star >= 3 && U.rnd() < 0.4 + pr.skill) Game.advanceHero(p, main.uid, f.uid);
        else if (Game.tpl(f).star >= 3 && !p.lib.includes(Game.tpl(f).inherit) && U.rnd() < pr.skill) Game.inheritHero(p, f.uid);
      }
    }
    // 事件戰法：集齊武將就兌換
    if (U.rnd() < 0.2 + pr.skill) for (const ev of EVENT_SKILLS) { const st = Game.eventStatus(p, ev); if (!st.done && !st.missing.length) Game.exchangeEvent(p, ev.id); }
    // 覺醒：主力部隊的四星以上武將
    if (U.rnd() < 0.1 + pr.skill * 0.6) {
      for (const team of p.teams) for (const uid of team.slots) {
        const h = Game.heroByUid(p, uid);
        if (!h || h.awk || Game.tpl(h).star < CFG.AWAKEN_MIN_STAR) continue;
        if (Game.awakenFodder(p, h).length >= CFG.AWAKEN_FODDER + 2) Game.awakenHero(p, h.uid);
      }
    }
    // 演練：用閒置低星武將推進研究中的戰法
    const fodder = () => p.heroes.filter(h => h.team < 0 && Game.tpl(h).star <= 3).sort((a, b) => Game.tpl(a).star - Game.tpl(b).star || a.lv - b.lv);
    for (const sid in p.libp) {
      if (U.rnd() > 0.3 + pr.skill) continue;
      const fd = fodder();
      while (fd.length > 4 && p.libp[sid] !== undefined) Game.drillSkill(p, sid, fd.shift().uid);
    }
    // 清理多餘武將：高星傳承，其餘轉化為戰法點
    const idle = p.heroes.filter(h => h.team < 0);
    const keep = 12 + Math.round(pr.skill * 6);
    if (p.heroes.length > keep) {
      idle.sort((a, b) => Game.tpl(a).star - Game.tpl(b).star || a.lv - b.lv);
      let rm = p.heroes.length - keep;
      for (const h of idle) {
        if (rm <= 0) break;
        const t = Game.tpl(h);
        if (t.star >= 4 && !p.lib.includes(t.inherit) && pr.skill > 0.5) { if (Game.inheritHero(p, h.uid).ok) { rm--; continue; } }
        if (t.star <= 3 || U.rnd() < 0.2) { if (Game.convertHero(p, h.uid).ok) rm--; }
      }
    }
    // 升級戰法：優先主力部隊的自帶戰法
    if (U.rnd() < 0.3 + pr.skill) {
      let guard = 40;
      while (guard-- > 0) {
        let best = null, bl = 99;
        for (const team of p.teams) {
          for (const uid of team.slots) {
            const h = Game.heroByUid(p, uid);
            if (!h) continue;
            for (let k = 0; k < 3; k++) {
              if (!h.sk[k] || h.sl[k] >= CFG.SKILL_MAX_LV) continue;
              const v = h.sl[k] + team.id * 1.5 + k * 0.5;
              if (v < bl) { bl = v; best = [h, k]; }
            }
          }
        }
        if (!best || !Game.upgradeSkill(p, best[0].uid, best[1]).ok) break;
      }
    }
    // 加點
    for (const h of p.heroes) {
      const fp = Game.freePoints(h);
      if (fp <= 0) continue;
      if (U.rnd() < 0.25 + pr.skill) {
        const t = Game.tpl(h);
        const stat = U.rnd() < pr.skill ? (t.role === 'int' ? 'int' : 'atk') : U.pick(['atk', 'def', 'int', 'spd']);
        Game.addPoint(p, h.uid, stat, fp);
      }
    }
    // 學戰法
    if (U.rnd() < 0.2 + pr.skill) {
      for (const h of p.heroes) {
        if (h.team < 0) continue;
        for (let k = 1; k <= 2; k++) {
          if (!Game.slotUnlocked(h, k)) continue;
          const cur = h.sk[k] ? skillFit(h, SKILLS[h.sk[k]]) : -1;
          let best = null, bs = cur + 0.5;
          for (const sid of p.lib) {
            if (h.sk.includes(sid)) continue;
            const s = SKILLS[sid];
            if (s.troops && !s.troops.includes(Game.tpl(h).troop)) continue;
            const f = pr.skill > 0.5 ? skillFit(h, s) : SKILL_VALUE[s.q] + U.rnd() * 2;
            if (f > bs) { bs = f; best = sid; }
          }
          if (best) Game.learnSkill(p, h.uid, k, best);
        }
      }
    }
  }
  function skillFit(h, s) {
    const t = Game.tpl(h);
    let v = SKILL_VALUE[s.q] * 2;
    let intish = 0, physish = 0;
    for (const f of s.rfx ? s.fx.concat(s.rfx) : s.fx) {
      if (f.k === 'dmg') { if (f.t === 'int') intish++; else physish++; }
      if ((f.k === 'buff') && f.stat === 'int') intish += 0.5;
      if ((f.k === 'buff') && f.stat === 'atk') physish += 0.5;
    }
    if (t.role === 'int') v += intish * 1.5 - physish * 1.2;
    else v += physish * 1.5 - intish * 1.2;
    if (s.type === 'command' || s.type === 'passive') v += 0.6;
    if ((s.fx.some(f => f.k === 'heal') || (s.rfx || []).some(f => f.k === 'heal')) && t.role === 'int') v += 1;
    return v;
  }

  // ================= 部隊編成 =================
  function heroValue(p, h) {
    const t = Game.tpl(h);
    const s = Game.heroStats(p, h);
    return (Math.max(s.atk, s.int) * 1.2 + s.def * 0.7 + s.spd * 0.3) * (1 + h.adv * 0.04) + (SKILL_VALUE[SKILLS[t.skill].q] || 1) * 20;
  }
  function manageTeams(p) {
    const pr = p.prof;
    const teams = p.teams.filter(t => t.status === 'idle' && !t.rq && t.base === p.cityTile);
    if (!teams.length) return;
    const cap = Game.costCap(p);
    // 候選：不在忙碌部隊中的武將
    const busy = new Set();
    for (const t of p.teams) if (!teams.includes(t)) for (const u of t.slots) if (u) busy.add(u);
    let pool = p.heroes.filter(h => !busy.has(h.uid));
    const val = new Map(pool.map(h => [h, heroValue(p, h)]));
    pool.sort((a, b) => val.get(b) - val.get(a));
    // 清空待編部隊
    for (const t of teams) for (let s = 0; s < 3; s++) { const h = Game.heroByUid(p, t.slots[s]); if (h) h.team = -1; t.slots[s] = 0; }
    const smart = U.rnd() < pr.skill;
    for (const t of teams) {
      if (!pool.length) break;
      let pickSet;
      if (smart) pickSet = bestTrio(p, pool.slice(0, 9), cap);
      else {
        pickSet = [];
        let c = 0;
        for (const h of pool) { if (pickSet.length >= 3) break; if (c + Game.tpl(h).cost <= cap && !pickSet.some(x => Game.tpl(x).name === Game.tpl(h).name)) { pickSet.push(h); c += Game.tpl(h).cost; } }
      }
      if (!pickSet.length) break;
      // 位置：前鋒=防高近戰，大營=遠程/核心
      const arr = pickSet.slice();
      const order = [];
      if (smart && arr.length === 3) {
        arr.sort((a, b) => frontScore(p, b) - frontScore(p, a));
        const front = arr.shift();
        arr.sort((a, b) => Game.heroStats(p, b).range - Game.heroStats(p, a).range || heroValue(p, b) - heroValue(p, a));
        order[0] = arr[0]; order[1] = arr[1]; order[2] = front;
      } else { order[0] = arr[0]; order[1] = arr[1]; order[2] = arr[2]; }
      for (let s = 0; s < 3; s++) if (order[s]) Game.setSlot(p, t.id, s, order[s].uid);
      pool = pool.filter(h => !pickSet.includes(h));
    }
    // 若有部隊大營空著，補上
    for (const t of teams) if (!t.slots[0]) Game.autoFillTeam(p, t.id);
  }
  function frontScore(p, h) { const s = Game.heroStats(p, h); return s.def * 1.2 - s.range * 25 + (Game.tpl(h).troop === '弓' ? -40 : 0); }
  function bestTrio(p, cands, cap) {
    let best = null, bv = -1;
    const n = cands.length;
    const hv = cands.map(h => heroValue(p, h));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      const a = cands[i], b = cands[j], c = cands[k];
      const ta = Game.tpl(a), tb = Game.tpl(b), tc = Game.tpl(c);
      if (ta.cost + tb.cost + tc.cost > cap + 1e-6) continue;
      if (ta.name === tb.name || ta.name === tc.name || tb.name === tc.name) continue;
      let v = hv[i] + hv[j] + hv[k];
      if (ta.faction === tb.faction && tb.faction === tc.faction) v *= 1.1;
      if (ta.troop === tb.troop && tb.troop === tc.troop) v *= 1.08;
      if (v > bv) { bv = v; best = [a, b, c]; }
    }
    if (!best) {
      // 統御不足：取兩人
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = cands[i], b = cands[j];
        if (Game.tpl(a).cost + Game.tpl(b).cost > cap || Game.tpl(a).name === Game.tpl(b).name) continue;
        const v = hv[i] + hv[j];
        if (v > bv) { bv = v; best = [a, b]; }
      }
    }
    return best || cands.slice(0, 1);
  }

  // ================= 領地 =================
  function manageLands(p) {
    const pr = p.prof;
    if (p.landCount < p.landCap - 1) return;
    if (U.rnd() > pr.skill * 0.9 + 0.05) return; // 新手常常忘了放棄低級地
    // 放棄最低級、遠離前線的地
    const a = p.alliance >= 0 ? Game.G.alliances[p.alliance] : null;
    const field = a && a.field;
    let cands = p.lands.filter(i => Game.T.city[i] < 0 && !p.teams.some(t => t.gtile === i));
    if (cands.length < 6) return;
    const sample = cands.length > 80 ? U.shuffle(cands.slice()).slice(0, 80) : cands;
    sample.sort((x, y) => landKeep(p, x, field) - landKeep(p, y, field));
    const n = Math.min(3, Math.max(1, Math.floor(p.landCount - p.landCap + 3)));
    for (let k = 0; k < n && k < sample.length; k++) {
      if (Game.T.lvl[sample[k]] >= 6) break;
      Game.abandon(p, sample[k]);
    }
  }
  function landKeep(p, i, field) {
    const T = Game.T;
    let v = T.lvl[i] * 10;
    if (field && field[i] < 60) v += 30 - field[i] * 0.5; // 鋪路用地
    const d = World.dist(i, p.cityTile);
    v -= d * 0.05;
    return v;
  }
  // 前線據點：老手蓋要塞，其他人蓋便宜的營帳
  function manageFort(p) {
    const pr = p.prof;
    if (pr.skill < 0.3 || p.alliance < 0) return;
    const m = mem(p);
    if (G().time < (m.nextFort || 0)) return;
    m.nextFort = G().time + U.rint(90, 240);
    const a = Game.G.alliances[p.alliance];
    if (a.target < 0 || !a.field) return;
    const city = World.cities[a.target];
    const dMain = Math.hypot(city.cx - World.X(p.cityTile), city.cy - World.Y(p.cityTile));
    if (dMain < 26) return;
    // 目標附近已有自己的據點就不再蓋
    for (const id of p.forts.concat(p.branches || [])) { const f = World.cities[id]; if (!f.dead && Math.hypot(city.cx - f.cx, city.cy - f.cy) < 14) return; }
    let best = -1, bd = 1e9;
    for (const i of p.lands) {
      if (Game.T.city[i] >= 0) continue;
      const d = Math.hypot(city.cx - World.X(i), city.cy - World.Y(i));
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd >= 12) return;
    if (pr.skill >= 0.55 && Game.outpostCount(p, 'fort') < CFG.FORT_MAX && Game.canAfford(p, CFG.FORT_COST)) Game.buildFort(p, best);
    else if (Game.canAfford(p, CFG.CAMP_COST)) Game.buildCamp(p, best);
  }
  // 分城：名望足夠的老手/課長，在靠近同盟目標（或離主城較遠）的 3×3 己方土地建分城
  function manageBranch(p) {
    const pr = p.prof;
    if (pr.skill < 0.5 || CFG.branchMax(p.fame) <= (p.branches || []).length || p.b.palace < CFG.BRANCH_PALACE) return;
    const m = mem(p);
    if (G().time < (m.nextBranch || 0)) return;
    m.nextBranch = G().time + U.rint(240, 600);
    if (!Game.canAfford(p, CFG.BRANCH_COST)) return;
    const a = p.alliance >= 0 ? Game.G.alliances[p.alliance] : null;
    const tgt = a && a.target >= 0 ? World.cities[a.target] : null;
    let best = -1, bs = -1e9;
    const lands = p.lands;
    for (let k = 0; k < Math.min(400, lands.length); k++) {
      const i = lands[lands.length > 400 ? (U.rnd() * lands.length) | 0 : k];
      if (Game.canBranch(p, i)) continue;
      const v = tgt ? -Math.hypot(tgt.cx - World.X(i), tgt.cy - World.Y(i)) : World.dist(i, p.cityTile);
      if (v > bs) { bs = v; best = i; }
    }
    if (best >= 0) Game.buildBranch(p, best);
  }

  // ================= 軍事 =================
  let curNoise = 0;
  function drawNoise(p) {
    const pr = p.prof;
    const bias = pr.type === 'newbie' ? 0.35 : pr.type === 'casual' ? 0.12 : 0;
    curNoise = U.gauss() * 0.45 * (1 - pr.skill) + bias;
  }
  function perceived(p, ratio) { return ratio * Math.exp(curNoise); }
  // 士氣折算後的戰力（老手會考慮士氣，新手常忽略）
  function mtp(p, team, tp, i) {
    const m = CFG.moraleDmg(Game.marchMorale(p, team, i));
    return tp * (1 - (1 - m) * (0.3 + 0.7 * p.prof.skill));
  }
  function winP(r) { return 1 / (1 + Math.exp(-7 * (r - 1))); }

  function military(p) {
    const g = G();
    const pr = p.prof;
    for (const team of p.teams) {
      if (team.status !== 'idle' || team.rq) continue;
      const cap = Game.teamCapTroops(p, team);
      if (!cap) continue;
      const troops = Game.teamTroops(p, team);
      const ratio = troops / cap;
      const atMain = team.base === p.cityTile;
      const minRatio = 0.25 + pr.skill * 0.4;
      if (ratio < minRatio) {
        if (atMain) {
          if (U.rnd() < 0.5 + pr.skill * 0.5) Game.recruit(p, team.id, 1);
        } else if (Game.teamMinSta(p, team) >= CFG.COST_MOVE) Game.send(p, team.id, p.cityTile, 'move');
        continue;
      }
      // 部分補兵：技術好的玩家在主城閒置時補滿
      if (atMain && ratio < 0.92 && pr.skill > 0.6 && U.chance(0.5)) { const r = Game.recruit(p, team.id, 1); if (r.ok) continue; }
      if (Game.teamMinSta(p, team) < CFG.COST_ATTACK) continue;
      const base = Game.heroByUid(p, team.slots[0]);
      if (!base || base.troops <= 0) continue;
      const tp = Game.teamPower(p, team);
      drawNoise(p);
      // 前線駐紮：同盟目標很遠時，把部隊調動到更靠近目標的同盟城池或自家要塞
      if (p.alliance >= 0 && ratio > 0.6 && U.rnd() < 0.3 + pr.skill * 0.7) {
        const nb = frontBase(p, team);
        if (nb >= 0) { const r = Game.send(p, team.id, nb, 'move'); if (r.ok) continue; }
      }
      let target = -1;
      // 1) 同盟行動
      if (p.alliance >= 0 && U.rnd() < obeyP(p)) target = allianceAction(p, team, tp);
      if (target === -2) continue; // 等待集結
      // 2) 報復 / 征服（領地已滿時更傾向搶奪他人高級地）
      let pvpP = pr.aggr * (p.landCount >= p.landCap - 2 ? 1 : 0.6);
      if (activeFeud(p)) pvpP = Math.max(pvpP, 0.7);
      if (persona(p) === 'turtle') pvpP = 0;
      if (target < 0 && U.rnd() < pvpP) target = pvpTarget(p, team, tp);
      // 3) 擴張
      if (target < 0) target = expandTarget(p, team, tp);
      if (target >= 0) {
        const r = Game.send(p, team.id, target, 'attack');
        const fr = mem(p).front;
        if (fr) { const k = fr.indexOf(target); if (k >= 0) fr.splice(k, 1); }
        if (!r.ok) continue;
      } else if (!atMain && ratio < 0.7) {
        Game.send(p, team.id, p.cityTile, 'move');
      } else {
        idleAction(p, team, tp); // 沒有目標時：屯田 / 掃蕩 / 練兵
      }
    }
  }

  // 閒置部隊：資源缺就屯田，否則掃蕩（打得過）或練兵賺經驗
  function idleAction(p, team, tp) {
    const pr = p.prof;
    if (U.rnd() > 0.25 + pr.skill * 0.6) return false;
    const T = Game.T;
    let low = false;
    for (const r of CFG.RES) if (p.res[r] < p.cap * 0.3) low = true;
    let lvMax = 0;
    for (const h of Game.teamHeroes(p, team)) if (h) lvMax = Math.max(lvMax, h.lv);
    const want = low ? 'farm' : lvMax >= CFG.HERO_MAX_LV ? '' : (pr.skill > 0.45 ? 'sweep' : 'train');
    if (!want) return false;
    if (Game.teamMinSta(p, team) < (want === 'farm' ? CFG.COST_FARM : CFG.COST_SWEEP)) return false;
    let best = -1, bs = -1e9;
    const lands = p.lands;
    for (let k = 0; k < Math.min(60, lands.length); k++) {
      const i = lands[lands.length > 60 ? (U.rnd() * lands.length) | 0 : k];
      if (T.city[i] >= 0) continue;
      const d = World.dist(i, team.base);
      if (d > 15) continue;
      const L = T.lvl[i];
      if (want === 'sweep' && winP(mtp(p, team, tp, i) / (GP[L] * R50[L])) < 0.8) continue;
      const v = L * 10 - d;
      if (v > bs) { bs = v; best = i; }
    }
    if (best < 0) return false;
    return Game.send(p, team.id, best, want).ok;
  }

  let stamp = null, stampGen = 1;
  function nextStamp() {
    const NN = World.N * World.N;
    if (!stamp || stamp.length !== NN) { stamp = new Uint32Array(NN); stampGen = 1; }
    stampGen++;
    if (stampGen > 4e9) { stamp.fill(0); stampGen = 1; }
    return stampGen;
  }
  function frontBase(p, team) {
    const a = G().alliances[p.alliance];
    if (!a || a.target < 0) return -1;
    const c = World.cities[a.target];
    const ctr = c.tiles[(c.tiles.length / 2) | 0];
    const cur = World.dist(team.base, ctr);
    if (cur < 22) return -1; // 太遠會掉士氣，先調動到前線
    let best = -1, bd = cur - 10;
    const cands = a.cities.map(cid => { const cc = World.cities[cid]; return cc.tiles[(cc.tiles.length / 2) | 0]; });
    for (const fid of p.forts) { const f = World.cities[fid]; if (!f.dead) cands.push(f.tiles[0]); }
    for (const bid of (p.branches || [])) { const f = World.cities[bid]; if (!f.dead) cands.push(f.tiles[4]); }
    cands.push(p.cityTile);
    for (const b of cands) {
      if (b === team.base || !Game.baseValid(p, b)) continue;
      const d = World.dist(b, ctr);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function frontier(p, sampleN) {
    const m = mem(p);
    if (m.front && m.frontT === G().time) return m.front;
    const T = Game.T;
    const N = World.N;
    const out = [];
    const src = [];
    const lands = p.lands;
    if (lands.length <= sampleN) { for (const x of lands) src.push(x); }
    else {
      // 最近佔領的地多半在前線
      for (let k = Math.max(0, lands.length - (sampleN >> 1)); k < lands.length; k++) src.push(lands[k]);
      for (let k = 0; k < (sampleN >> 1); k++) src.push(lands[(U.rnd() * lands.length) | 0]);
    }
    for (const t of World.cities[p.city].tiles) src.push(t);
    const st = nextStamp();
    const ter = T.terrain, cty = T.city, own = T.owner, sta = T.state;
    for (const s of src) {
      const x = s % N, y = (s / N) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= N) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= N) continue;
          const n = yy * N + xx;
          if (stamp[n] === st || ter[n] !== 0 || cty[n] >= 0) continue;
          const o = own[n];
          if (o === p.id) continue;
          if (sta[s] !== sta[n] && !(cty[s] >= 0 && World.cities[cty[s]].type === 'pass')) continue;
          if (o >= 0 && p.alliance >= 0 && Game.P[o].alliance === p.alliance) continue;
          stamp[n] = st;
          out.push(n);
        }
      }
    }
    m.front = out; m.frontT = G().time;
    return out;
  }

  function resWeight(p) {
    const w = {};
    let mn = 1e9;
    for (const r of CFG.RES) mn = Math.min(mn, p.prod[r]);
    for (const r of CFG.RES) w[r] = 1 + (p.prod[r] <= mn * 1.1 ? 0.35 : 0) + (r === 'stone' ? 0.1 : 0) + (r === 'grain' ? 0.15 : 0);
    return w;
  }

  function expandTarget(p, team, tp) {
    const T = Game.T;
    const pr = p.prof;
    const cands = frontier(p, 50);
    if (!cands.length) return -1;
    const atCap = p.landCount >= p.landCap;
    const w = resWeight(p);
    let minOwned = 9;
    if (atCap) for (let k = 0; k < Math.min(40, p.lands.length); k++) minOwned = Math.min(minOwned, T.lvl[p.lands[(U.rnd() * p.lands.length) | 0]]);
    let best = -1, bs = -1e9;
    const reckless = U.rnd() < (1 - pr.skill) * 0.3;
    for (const i of cands) {
      if (T.owner[i] >= 0) continue; // 他人土地交給 PvP 邏輯
      const L = T.lvl[i];
      const ratio = mtp(p, team, tp, i) / (GP[L] * R50[L]);
      const pr2 = winP(perceived(p, ratio));
      const need = reckless ? 0.25 : 0.45 + pr.skill * 0.3;
      if (pr2 < need) continue;
      if (atCap && L <= minOwned + 1 && pr.skill > 0.4) continue;
      const d = World.dist(i, team.base);
      let v = CFG.LAND_OUTPUT[L] * w[CFG.RES[T.res[i]]] * (0.5 + pr2) + (p.firstCap[i] ? 0 : L * 25) - d * 6;
      // 升級期偏好經驗高的地
      v += CFG.GARRISON[L][0] * CFG.GARRISON[L][1] * CFG.GARRISON[L][3] * 0.02;
      if (reckless) v += U.rnd() * 400;
      if (v > bs) { bs = v; best = i; }
    }
    if (best >= 0 && atCap && pr.skill > 0.4) {
      // 先放棄一塊低級地再打
      const low = p.lands.find(i => T.lvl[i] <= minOwned && T.city[i] < 0 && !p.teams.some(t => t.gtile === i));
      if (low !== undefined) Game.abandon(p, low);
    }
    return best;
  }

  function pvpTarget(p, team, tp) {
    const g = G();
    const T = Game.T;
    const pr = p.prof;
    // 仇人
    let foe = -1, ft = -1;
    for (const k in p.grudge) { if (g.time - p.grudge[k] < 720 && p.grudge[k] > ft) { ft = p.grudge[k]; foe = +k; } }
    const cands = frontier(p, 50);
    let best = -1, bs = -1e9;
    for (const i of cands) {
      const o = T.owner[i];
      if (o < 0 || o === p.id) continue;
      const op = Game.P[o];
      if (op.alliance >= 0 && sameBloc(op.alliance, p.alliance)) continue;
      if (p.captor >= 0 && (o === p.captor || (Game.P[p.captor].alliance >= 0 && op.alliance === Game.P[p.captor].alliance))) continue;
      const L = T.lvl[i];
      // 估計對方駐守與守軍
      const enemyBest = bestTeamPower(op) * (op.teams.some(t => t.gtile === i) ? 1 : 0.15);
      const ratio = mtp(p, team, tp, i) / (GP[L] * R50[L] + enemyBest * 0.9);
      const w = winP(perceived(p, ratio));
      if (w < 0.55) continue;
      let v = L * 60 + (o === foe ? 400 : 0) + (op.alliance >= 0 && isEnemyAlliance(p, op.alliance) ? 150 : 0) - World.dist(i, team.base) * 5;
      if (op.power > p.power * 1.5 && o !== foe && persona(p) !== 'warmonger') v -= 200; // 不惹強者（好戰者例外）
      if (p.landCount >= p.landCap && L < 5) continue;
      if (v > bs) { bs = v; best = i; }
    }
    if (best >= 0 && bs > 150) return best;
    // 攻打弱小鄰居主城（課長/老手）
    if (pr.aggr > 0.6 && (pr.skill > 0.5 || persona(p) === 'hothead') && g.time > CFG.PROTECT_DAYS * 1440) {
      const m = mem(p);
      if (m.conquest >= 0) {
        const op = Game.P[m.conquest];
        if (!op || op.captor >= 0 || (op.alliance >= 0 && op.alliance === p.alliance) || g.time > m.conquestUntil) m.conquest = -1;
        else {
          const ct = op.cityTile;
          if (!Game.attackBlock(p, ct)) return ct;
          // 先「拔點」：攻打最靠近對方主城的土地，推進到城下
          let best2 = -1, bd = 1e9;
          for (const i of cands) {
            const d = World.dist(i, ct);
            if (d >= bd || d > 14) continue;
            const L = T.lvl[i];
            if (winP(perceived(p, mtp(p, team, tp, i) / (GP[L] * R50[L]) * (T.owner[i] >= 0 ? 0.7 : 1))) < 0.45) continue;
            bd = d; best2 = i;
          }
          if (best2 >= 0) return best2;
          m.conquest = -1;
        }
      } else if (activeFeud(p) && U.chance(0.5)) {
        // 世仇：推進到對方主城下
        const op = Game.P[activeFeud(p)];
        if (op && op.captor < 0 && g.time >= op.protectEnd && !(op.alliance >= 0 && sameBloc(op.alliance, p.alliance)) && bestTeamPower(op) < tp * 1.3) {
          m.conquest = op.id; m.conquestUntil = g.time + 720;
          return Game.attackBlock(p, op.cityTile) ? -1 : op.cityTile;
        }
      } else if (U.chance(persona(p) === 'warmonger' ? 0.6 : 0.25)) {
        for (const i of cands) {
          const o = T.owner[i];
          if (o < 0) continue;
          const op = Game.P[o];
          if (op.alliance >= 0 && op.alliance === p.alliance) continue;
          if (World.dist(i, op.cityTile) > 12 || g.time < op.protectEnd || op.captor >= 0) continue;
          const hostile = o in p.grudge || (op.alliance >= 0 && isEnemyAlliance(p, op.alliance));
          const bold = persona(p) === 'warmonger' ? 1.3 : 1;
          if ((op.power < p.power * (hostile ? 0.95 : 0.7) * bold) && bestTeamPower(op) < tp * 0.9 * bold) {
            m.conquest = o;
            m.conquestUntil = g.time + 720;
            if (U.chance(0.5)) Game.say(p, 'world', U.pick(CHAT.threaten).replace('{n}', op.name));
            return Game.attackBlock(p, op.cityTile) ? i : op.cityTile;
          }
        }
      }
    }
    return -1;
  }
  function bestTeamPower(op) {
    const g = G();
    if (op._btpT !== undefined && g.time - op._btpT < 60) return op._btp;
    let b = 0;
    for (const t of op.teams) b = Math.max(b, Game.teamPower(op, t));
    op._btp = b; op._btpT = g.time;
    return b;
  }
  function isEnemyAlliance(p, aid) {
    if (p.alliance < 0) return false;
    const a = Game.G.alliances[p.alliance];
    return a.enemy === aid;
  }

  // 同盟行動：鋪路 / 攻城
  function allianceAction(p, team, tp) {
    const g = G();
    const a = g.alliances[p.alliance];
    if (!a || a.target < 0) return -1;
    const city = World.cities[a.target];
    if (city.alliance === p.alliance) return -1;
    if (a.phase === 'siege') {
      const center = city.tiles[(city.tiles.length / 2) | 0];
      const d = World.dist(team.base, center);
      if (d > 75 * MS()) return -1;
      // 集結：等待集結時間，讓大家同時抵達
      const eta = Game.marchTime(p, team, team.base, center);
      if (a.rallyAt && g.time + eta < a.rallyAt - 5) { team._hold = g.time; return -2; }
      // 評估能否打過目前第一隊守軍（守軍會被消耗）
      let squadP = 0, aliveSq = 0;
      if (city.alliance < 0) {
        const gar = CFG.CITY_GARRISON[city.lvl];
        const cur = city.garrison;
        aliveSq = cur ? cur.filter(s2 => s2.some(x => x > 0)).length : gar[0];
        const first = cur ? cur.find(s2 => s2.some(x => x > 0)) : [gar[2], gar[2], gar[2]];
        squadP = first ? Battle.power(Game.npcSquad(city.lvl, 3, gar[1], first, 1, true)) * CR50[city.lvl] : 0;
      } else {
        squadP = CP[Math.min(8, city.lvl)] * 1.2;
        aliveSq = 1;
      }
      const w = squadP ? winP(perceived(p, mtp(p, team, tp, center) / squadP)) : 1;
      // 消耗戰：戰力足夠就上，守軍清空則全力拆耐久
      if (aliveSq === 0 || w > 0.18 - p.prof.skill * 0.06 || (p.prof.skill < 0.4 && U.chance(0.3))) {
        if (!Game.attackBlock(p, center)) return center;
        for (const t of city.tiles) if (!Game.attackBlock(p, t)) return t;
      }
      return -1;
    }
    // 鋪路
    if (!a.pave || !a.pave.length || !a.field) return -1;
    const T = Game.T;
    const field = a.field;
    let best = -1, bs = -1e9;
    for (const i of a.pave) {
      if (Game.isFriendly(p, i)) continue;
      if (T.owner[i] >= 0 && Game.P[T.owner[i]].alliance === p.alliance) continue;
      const L = T.lvl[i];
      const ratio = mtp(p, team, tp, i) / (GP[L] * R50[L]) * (T.owner[i] >= 0 ? 0.6 : 1);
      const damaged = Game.G.landSiege[i] ? 1.25 : 1; // 守軍已被消耗
      if (winP(perceived(p, ratio * damaged)) < 0.33) continue;
      const d = World.dist(i, team.base);
      if (d > 60 * MS()) continue;
      const v = -field[i] * 12 - d * 1.5;
      if (v > bs) { bs = v; best = i; }
    }
    if (best >= 0 && p.landCount >= p.landCap) {
      // 為鋪路放棄一塊低級地（取樣找最低級、非路線上的地）
      let low = -1, ll = 99;
      for (let k = 0; k < 60 && p.lands.length; k++) {
        const i = p.lands[(U.rnd() * p.lands.length) | 0];
        if (T.city[i] >= 0 || field[i] < 80 || p.teams.some(t => t.gtile === i)) continue;
        if (T.lvl[i] < ll) { ll = T.lvl[i]; low = i; }
      }
      if (low >= 0 && ll <= 6) Game.abandon(p, low); else return -1;
    }
    if (best >= 0 && Game.attackBlock(p, best)) return -1;
    return best;
  }

  // ================= 同盟 AI（盟主決策）=================
  function inviteUser(a, leader) {
    const g = G();
    const u = Game.P[g.userId];
    if (u.alliance >= 0 || !leader.ai || a.members.length >= CFG.ALLIANCE_MAX) return;
    if (!g.invites) g.invites = [];
    if (g.invites.some(x => x.a === a.id)) return;
    const d = Math.hypot(World.X(u.cityTile) - World.X(leader.cityTile), World.Y(u.cityTile) - World.Y(leader.cityTile));
    if (d > 70 * MS() || g.time < 90 || U.rnd() > 0.25) return;
    g.invites.push({ a: a.id, t: g.time });
    Game.say(leader, 'world', '@' + u.name + ' ' + U.pick(['來我們〔' + a.name + '〕吧，就在你附近', '〔' + a.name + '〕誠邀主公加入，一起打城', '看你一個人開荒，要不要入〔' + a.name + '〕？', '兄弟入盟嗎？〔' + a.name + '〕缺人']));
    Game.notify(u.id, '〔' + a.name + '〕盟主 ' + leader.name + ' 邀請你加入同盟（點「同盟」查看）', 'good');
  }
  function alliancesThink(now) {
    const g = G();
    if (now !== undefined && now % 60 === 17) feudTick();
    for (const a of g.alliances) {
      if (a.dead) continue;
      if (now !== undefined && (now + a.id * 7) % 30 !== 0) continue; // 各同盟錯開思考，避免卡頓
      const leader = Game.P[a.leader];
      inviteUser(a, leader);
      if (!leader.ai) recruitForUser(a);
      // 使用者當盟主時，由使用者設定目標；AI 僅協助計算鋪路
      if (a.target >= 0) {
        const city = World.cities[a.target];
        if (city.alliance === a.id || sameBloc(city.alliance, a.id) || Game.cityLockedDay(city) > Game.day()) { a.target = -1; a.field = null; a.pave = null; }
      }
      if (a.target < 0 && leader.ai && a.members.length >= 3 && g.time >= (a.nextChoose || 0)) {
        chooseTarget(a);
        if (a.target < 0) a.nextChoose = g.time + 150; // 找不到目標時稍後再議
      }
      if (a.target >= 0) {
        if (!a.field || a.fieldFor !== a.target || g.time - (a.fieldAt || 0) > 360) buildField(a);
        updatePave(a);
        const city = World.cities[a.target];
        const adj = cityAdjacent(a, city);
        if (adj && a.phase === 'siege' && a.rallyAt && g.time > a.rallyAt + 150) {
          // 上一波未攻下：重新集結
          const cty = World.cities[a.target];
          if (!cty.garrison || cty.alliance >= 0) { a.rallyAt = g.time + 50; if (leader.ai) Game.say(leader, 'ally', U.pick(CHAT.rally).replace('{c}', cty.name)); }
        }
        if (adj && a.phase !== 'siege') {
          a.phase = 'siege';
          a.rallyAt = g.time + 60;
          if (leader.ai) Game.say(leader, 'ally', U.pick(CHAT.siegeGo).replace('{c}', city.name).replace('{xy}', '(' + city.cx + ',' + city.cy + ')'));
          else Game.sysAlly(a.id, '【戰報】已鋪路至【' + city.name + '】，可以開始攻城！');
        } else if (!adj && a.phase === 'siege') a.phase = 'pave';
        // 長時間無進展則換目標
        if (leader.ai && g.time - a.targetSince > 60 * 30 && a.phase === 'pave') { a.target = -1; a.field = null; }
      }
    }
  }
  function cityAdjacent(a, city) {
    const nb = [];
    for (const t of city.tiles) {
      World.neighbors8(t, nb);
      for (const n of nb) if (Game.tileAlliance(n) === a.id && World.linked(n, t)) return true;
    }
    return false;
  }
  function allianceStrength(a) {
    let s = 0;
    for (const id of a.members) s += bestTeamPower(Game.P[id]);
    return s;
  }
  function chooseTarget(a) {
    const g = G();
    const leader = Game.P[a.leader];
    // 附庸同盟：跟隨宗主的目標
    if (a.lord >= 0) {
      const L = g.alliances[a.lord];
      if (!L || L.dead) a.lord = -1;
      else if (L.target >= 0) {
        const c = World.cities[L.target];
        if (c.alliance !== a.id && !sameBloc(c.alliance, a.id) && reachable(a, c)) {
          a.target = c.id; a.targetSince = g.time; a.phase = 'pave'; a.field = null;
          Game.say(leader, 'ally', '宗主〔' + L.name + '〕有令，全盟攻打' + CFG.CITY_TYPE_NAME[c.type] + '【' + c.name + '】(' + c.cx + ',' + c.cy + ')');
          return;
        }
      }
    }
    // 同盟重心
    let sx = 0, sy = 0, n = 0;
    for (const id of a.members) { const q = Game.P[id]; sx += World.X(q.cityTile); sy += World.Y(q.cityTile); n++; }
    for (const cid of a.cities) { const c = World.cities[cid]; sx += c.cx * 3; sy += c.cy * 3; n += 3; }
    sx /= n; sy /= n;
    const str = allianceStrength(a) / Math.max(1, a.members.length) * Math.min(a.members.length, 12);
    const cands = [];
    for (const c of World.cities) {
      if (World.isPlayerCity(c) || c.dead) continue;
      if (c.alliance === a.id || sameBloc(c.alliance, a.id)) continue;
      if (Game.cityLockedDay(c) > Game.day()) continue;
      const d = Math.hypot(c.cx - sx, c.cy - sy);
      // 一般城池只看附近；洛陽與司隸城池在大地圖上距離按比例放大，否則沒有同盟會去打
      if (d > 85 * (c.type === 'luoyang' || World.states[c.state].type === 'center' ? MS() : 1)) continue;
      const garr = CFG.CITY_GARRISON[c.lvl];
      const need = c.alliance < 0 ? CP[c.lvl] * garr[0] * 0.9 : (Game.G.alliances[c.alliance].power / 60);
      if (str < need * (0.55 + leader.prof.skill * 0.3)) continue;
      const pts = (CFG.CITY_POINTS[c.type] || 5) + (c.type === 'pass' ? 25 : 0) + (c.type === 'luoyang' ? 1000 : 0);
      cands.push({ c, score: pts * 3 - d * 1.2 - (c.alliance >= 0 ? 30 : 0) + U.rnd() * 15 });
    }
    cands.sort((x, y) => y.score - x.score);
    for (const { c } of cands.slice(0, 6)) {
      if (!reachable(a, c)) continue;
      a.target = c.id; a.targetSince = g.time; a.phase = 'pave'; a.field = null;
      Game.say(leader, 'ally', U.pick(CHAT.targetSet).replace('{c}', CFG.CITY_TYPE_NAME[c.type] + '【' + c.name + '】').replace('{xy}', '(' + c.cx + ',' + c.cy + ')'));
      if (c.alliance >= 0) {
        a.enemy = c.alliance;
        Game.say(leader, 'world', U.pick(CHAT.declare).replace('{a}', Game.G.alliances[c.alliance].name));
      }
      return;
    }
  }
  // BFS：自目標城池外擴，碰到同盟領地即視為可達
  let bq = null, bd = null;
  function stepOk(a, c, cur, n) {
    const T = Game.T;
    const tr = T.terrain[n];
    if (tr === 1 || tr === 2) return false;
    const ci = T.city[n];
    if (T.state[cur] !== T.state[n]) {
      const cc = T.city[cur];
      if (!((ci >= 0 && World.cities[ci].type === 'pass') || (cc >= 0 && World.cities[cc].type === 'pass'))) return false;
    }
    if (ci >= 0 && ci !== c.id) {
      const cty = World.cities[ci];
      if (cty.type === 'pass' && cty.alliance !== a.id) return false; // 未佔領關口不可穿越
    }
    return true;
  }
  // 無權 BFS：判斷同盟領地是否在 maxD 格內可達
  function reachable(a, c) {
    const NN = World.N * World.N;
    if (!bq || bq.length !== NN) { bq = new Int32Array(NN); bd = new Int16Array(NN); }
    const st = nextStamp();
    let qh = 0, qt = 0;
    for (const t of c.tiles) { stamp[t] = st; bd[t] = 0; bq[qt++] = t; }
    const nb = [];
    while (qh < qt) {
      const cur = bq[qh++];
      const d = bd[cur];
      if (d >= 70) continue;
      World.neighbors8(cur, nb);
      for (const n of nb) {
        if (stamp[n] === st || !stepOk(a, c, cur, n)) continue;
        stamp[n] = st; bd[n] = d + 1;
        if (Game.tileAlliance(n) === a.id) return true;
        bq[qt++] = n;
      }
    }
    return false;
  }
  // 加權路徑場（Dial 演算法）：高級地成本較高，鋪路會繞開難打的地
  function buildFieldInto(a, c, field, maxCost) {
    const T = Game.T;
    field.fill(32767);
    const buckets = [];
    const visited = [];
    a.fieldList = visited;
    for (const t of c.tiles) { field[t] = 0; (buckets[0] = buckets[0] || []).push(t); }
    const nb = [];
    for (let d = 0; d <= maxCost; d++) {
      const b = buckets[d];
      if (!b) continue;
      for (let k = 0; k < b.length; k++) {
        const cur = b[k];
        if (field[cur] !== d) continue;
        visited.push(cur);
        World.neighbors8(cur, nb);
        for (const n of nb) {
          if (!stepOk(a, c, cur, n)) continue;
          const L = T.lvl[n];
          const own = Game.tileAlliance(n) === a.id;
          const w = own ? 2 : 2 + (L >= 8 ? 6 : L >= 7 ? 4 : L >= 6 ? 2 : 0);
          const nd = d + w;
          if (nd < field[n] && nd <= maxCost) { field[n] = nd; (buckets[nd] = buckets[nd] || []).push(n); }
        }
      }
      buckets[d] = null;
    }
  }
  function buildField(a) {
    const NN = World.N * World.N;
    if (!a.field || a.field.length !== NN) a.field = new Int16Array(NN);
    a.field.fill(32767);
    const c = World.cities[a.target];
    buildFieldInto(a, c, a.field, 200);
    a.fieldFor = a.target;
    a.fieldAt = Game.G.time;
  }
  function updatePave(a) {
    // 路徑場清單已依距離排序：找到第一塊同盟地（最接近目標的前線），只掃描其附近距離帶
    const T = Game.T;
    const field = a.field;
    const list = a.fieldList || [];
    let first = -1;
    for (let k = 0; k < list.length; k++) if (Game.tileAlliance(list[k]) === a.id) { first = k; break; }
    a.pave = [];
    if (first < 0) return;
    const minF = field[list[first]];
    const nb = [];
    const cand = [];
    let k0 = first;
    while (k0 > 0 && field[list[k0 - 1]] >= minF - 10) k0--;
    for (let k = k0; k < list.length; k++) {
      const n = list[k];
      if (field[n] > minF + 30 || cand.length >= 60) break;
      if (T.terrain[n] !== TERRAIN.PLAIN || T.city[n] >= 0) continue;
      if (Game.tileAlliance(n) === a.id) continue;
      World.neighbors8(n, nb);
      for (const s2 of nb) {
        if (Game.tileAlliance(s2) === a.id && World.linked(s2, n)) { cand.push(n); break; }
      }
    }
    cand.sort((x, y) => field[x] - field[y]);
    a.pave = cand.slice(0, 40);
  }

  // ================= 事件回呼 =================
  function onThreat(p, attacker, tile, march) {
    const pr = p.prof;
    const isMain = Game.T.city[tile] >= 0 && World.cities[Game.T.city[tile]].type === 'main';
    if (isMain) {
      if (U.rnd() < pr.skill) {
        // 召回附近部隊守城
        for (const t of p.teams) {
          if (t.status === 'march') {
            const m = Game.G.marches.find(x => x.id === t.march);
            if (m && m.type !== 'return' && m.end - Game.G.time > 3) Game.recall(p, t.id);
          }
        }
      }
      if (p.alliance >= 0 && U.rnd() < pr.chat + 0.3) later(p, 'ally', U.pick(CHAT.help).replace('{n}', attacker.name).replace('{xy}', '(' + World.X(tile) + ',' + World.Y(tile) + ')'), U.rint(0, 3));
      // 盟友支援駐守
      if (p.alliance >= 0) {
        const a = Game.G.alliances[p.alliance];
        let sent = 0;
        for (const id of a.members) {
          if (sent >= 2) break;
          const q = Game.P[id];
          if (!q.ai || q === p || U.rnd() > q.prof.skill * 0.7) continue;
          for (const t of q.teams) {
            if (!Game.teamReady(q, t, CFG.COST_GARRISON)) continue;
            const eta = Game.marchTime(q, t, t.base, tile);
            if (G().time + eta >= march.end) continue;
            const r = Game.send(q, t.id, tile, 'garrison');
            if (r.ok) { sent++; later(q, 'ally', U.pick(CHAT.support).replace('{n}', p.name), U.rint(0, 2)); break; }
          }
        }
      }
    }
  }
  function onAttacked(p, attacker, tile, winner) {
    p.grudge[attacker.id] = G().time;
  }
  function onLandLost(p, attacker, tile) {
    p.grudge[attacker.id] = G().time;
    const m = mem(p);
    if (G().time - m.lastChat > 60 && U.rnd() < p.prof.chat * 0.5) {
      m.lastChat = G().time;
      const ch = p.alliance >= 0 && U.chance(0.6) ? 'ally' : 'world';
      later(p, ch, U.pick(p.prof.type === 'newbie' ? CHAT.newbieLost : CHAT.landLost).replace('{n}', attacker.name), U.rint(1, 10));
    }
  }
  function onCaptured(p, attacker) {
    p.grudge[attacker.id] = G().time;
    if (U.rnd() < 0.8) later(p, 'world', U.pick(CHAT.captured).replace('{n}', attacker.name), U.rint(1, 12));
  }
  function onBattleResult(p, team, tile, won) {
    const m = mem(p);
    if (!won && p.prof.type === 'newbie' && U.rnd() < 0.08 && G().time - m.lastChat > 120) {
      m.lastChat = G().time;
      later(p, 'world', U.pick(CHAT.newbieQ), U.rint(1, 6));
    }
    if (won && Game.T.city[tile] < 0 && Game.T.lvl[tile] >= 7 && U.rnd() < 0.15 * p.prof.chat) later(p, 'world', U.pick(CHAT.brag).replace('{l}', Game.T.lvl[tile]), U.rint(1, 6));
  }
  function onCityCaptured(city, aid, oldA) {
    const g = G();
    for (const a of g.alliances) {
      if (a.dead) continue;
      if (a.target === city.id) { a.target = -1; a.field = null; a.pave = null; a.phase = ''; }
    }
    const a = g.alliances[aid];
    if (a) {
      const m = Game.P[U.pick(a.members)];
      if (m && m.ai) later(m, 'ally', U.pick(CHAT.cheer), U.rint(1, 5));
    }
    if (oldA >= 0 && g.alliances[oldA] && !g.alliances[oldA].dead) {
      const oa = g.alliances[oldA];
      oa.enemy = aid;
      const m = Game.P[U.pick(oa.members)];
      if (m && m.ai) later(m, 'ally', U.pick(CHAT.revenge).replace('{a}', a.name), U.rint(2, 10));
    }
  }
  function daily(p) {
    const pr = p.prof;
    if (pr.daily > 0) {
      const amt = Math.round(pr.daily * U.rrange(0.5, 1.5));
      p.gold += amt;
      if (pr.type === 'whale' && U.chance(0.35)) later(p, 'world', U.pick(CHAT.whale), U.rint(5, 120));
    }
    // 小盟盟主解散投靠大盟
    if (p.alliance >= 0) {
      const a = G().alliances[p.alliance];
      if (a.leader === p.id && a.members.length < 3 && Game.day() >= 2 && a.cities.length === 0) {
        p.prof.leader = false;
        delete mem(p).createAt;
        Game.leaveAlliance(p);
        mem(p).joinAt = G().time + U.rint(10, 90);
        return;
      }
    }
    // 弱盟成員跳槽
    if (p.alliance >= 0) {
      const a = G().alliances[p.alliance];
      if (a.members.length < 5 && a.leader !== p.id && !userLed(a) && G().time > 4 * 1440 && U.rnd() < 0.3 * (1 - pr.loyalty)) {
        Game.leaveAlliance(p);
        mem(p).joinAt = G().time + U.rint(10, 120);
      }
    }
  }

  // ================= 個性行為 =================
  function obeyP(p) {
    let o = 0.35 + p.prof.skill * 0.6;
    const a = G().alliances[p.alliance];
    if (userLed(a)) o += 0.25;                               // 聽從玩家盟主
    if (a && (Game.P[a.leader].prof || {}).persona === 'overlord') o += 0.2; // 梟雄治軍嚴明
    if (a && a.lord >= 0) o += 0.1;
    if (persona(p) === 'turtle') o *= 0.4;
    if (persona(p) === 'traitor') o *= 0.7;
    return Math.min(0.97, o);
  }
  function feuds() { const g = G(); if (!g.feuds) g.feuds = []; return g.feuds; }
  function activeFeud(p) {
    for (const f of feuds()) if (!f.over && (f.a === p.id || f.b === p.id)) return f.a === p.id ? f.b : f.a;
    return 0;
  }
  function personaThink(p) {
    const k = persona(p), g = G();
    if (g.time < CFG.PROTECT_DAYS * 1440 * 0.5) return;
    if ((k === 'hothead' || k === 'warmonger') && !activeFeud(p) && U.rnd() < (k === 'warmonger' ? 0.5 : 0.25)) startFeud(p);
    if (k === 'traitor') tryBetray(p);
    if (k === 'overlord') subjugate(p);
    if (k === 'turtle' && U.rnd() < 0.08 * p.prof.chat) later(p, 'world', U.pick(CHAT.turtle), U.rint(1, 20));
    if (k === 'warmonger' && U.rnd() < 0.12) later(p, 'world', U.pick(CHAT.warmonger), U.rint(1, 20));
  }
  // 火爆鄰居 / 好戰者：挑一位鄰居結仇，在世界頻道嗆聲
  function startFeud(p) {
    const g = G();
    let best = null, bd = 1e9;
    for (const q of Game.P) {
      if (q === p || q.captor >= 0) continue;
      if (q.alliance >= 0 && sameBloc(q.alliance, p.alliance)) continue;
      const d = World.dist(q.cityTile, p.cityTile);
      if (d > 26) continue;
      if (persona(p) !== 'warmonger' && q.power > p.power * 1.8) continue;
      if (activeFeud(q) && U.rnd() < 0.7) continue;
      const v = d + U.rnd() * 8;
      if (v < bd) { bd = v; best = q; }
    }
    if (!best) return;
    feuds().push({ a: p.id, b: best.id, since: g.time, last: g.time, over: false });
    p.grudge[best.id] = g.time;
    later(p, 'world', U.pick(CHAT.feudStart).replace('{n}', best.name), U.rint(0, 5));
    if (best.ai) {
      best.grudge[p.id] = g.time;
      const meek = persona(best) === 'turtle' || best.prof.type === 'newbie';
      later(best, 'world', U.pick(meek ? CHAT.turtleReply : CHAT.feudReply).replace('{n}', p.name), U.rint(3, 20));
    } else Game.notify(best.id, '【' + p.name + '】在世界頻道向你挑釁，小心他來搶地！', 'bad');
  }
  // 每小時：世仇互嗆、維持仇恨，一方淪陷或 3 天後結束
  function feudTick() {
    const g = G();
    for (const f of feuds()) {
      if (f.over) continue;
      const A = Game.P[f.a], B = Game.P[f.b];
      if (!A || !B) { f.over = true; continue; }
      const loser = B.captor === A.id ? B : A.captor === B.id ? A : null;
      if (loser) {
        f.over = true;
        const w = loser === A ? B : A;
        if (w.ai) later(w, 'world', U.pick(CHAT.feudWin).replace('{n}', loser.name), U.rint(1, 10));
        continue;
      }
      if (g.time - f.since > 3 * 1440) {
        f.over = true;
        const q = A.ai ? A : B, o = q === A ? B : A;
        if (q.ai) later(q, 'world', U.pick(CHAT.feudEnd).replace('{n}', o.name), U.rint(1, 30));
        continue;
      }
      if (A.ai) A.grudge[B.id] = g.time;
      if (B.ai && persona(B) !== 'turtle') B.grudge[A.id] = g.time;
      if (g.time - f.last > 90 && U.rnd() < 0.35) {
        f.last = g.time;
        const q = U.chance(0.5) ? A : B, o = q === A ? B : A;
        if (q.ai) {
          const meek = persona(q) === 'turtle';
          later(q, 'world', U.pick(meek ? CHAT.turtleReply : CHAT.feudInsult).replace('{n}', o.name), U.rint(0, 10));
          if (o.ai && !meek && U.chance(0.6)) later(o, 'world', U.pick(persona(o) === 'turtle' ? CHAT.turtleReply : CHAT.feudReply).replace('{n}', q.name), U.rint(5, 25));
        }
      }
    }
    if (feuds().length > 200) g.feuds = feuds().filter(f => !f.over || g.time - f.since < 1440);
  }
  // 叛徒：同盟交戰或攻城時倒戈，投靠敵盟或最強的鄰盟
  function tryBetray(p) {
    const g = G(), m = mem(p);
    if (m.betrayed || p.alliance < 0 || Game.day() < 4) return;
    const a = g.alliances[p.alliance];
    if (a.leader === p.id) return;
    const tense = (a.enemy >= 0 && g.alliances[a.enemy] && !g.alliances[a.enemy].dead) || a.phase === 'siege';
    if (U.rnd() > (tense ? 0.35 : 0.06)) return;
    let to = null;
    if (a.enemy >= 0 && g.alliances[a.enemy] && !g.alliances[a.enemy].dead && g.alliances[a.enemy].members.length < CFG.ALLIANCE_MAX) to = g.alliances[a.enemy];
    if (!to) {
      let bp = a.power * 0.4; // 大服同盟多半滿員：投靠任何一個還有空位、夠強的鄰盟
      for (const b of g.alliances) {
        if (b.dead || b.id === a.id || b.members.length >= CFG.ALLIANCE_MAX || sameBloc(b.id, a.id)) continue;
        const L = Game.P[b.leader];
        if (World.dist(L.cityTile, p.cityTile) > 90 * MS()) continue;
        if (b.power > bp) { bp = b.power; to = b; }
      }
    }
    if (!to) return;
    const oldA = a;
    const oldMembers = oldA.members.filter(id => id !== p.id);
    Game.leaveAlliance(p);
    if (!Game.joinAlliance(p, to.id, true).ok) return;
    m.betrayed = true;
    p.title = '叛徒';
    Game.say(p, 'world', U.pick(CHAT.betray).replace('{a}', oldA.name).replace('{b}', to.name));
    Game.sys('world', '【倒戈】' + p.name + ' 叛出〔' + oldA.name + '〕，投靠〔' + to.name + '〕！');
    for (const id of oldMembers) { const q = Game.P[id]; if (q && q.ai) q.grudge[p.id] = g.time; }
    const who = Game.P[U.pick(oldMembers)];
    if (who && who.ai) later(who, 'ally', U.pick(CHAT.betrayed).replace('{n}', p.name), U.rint(1, 6));
    const L = Game.P[oldA.leader];
    if (L) p.grudge[L.id] = g.time;
    if (!L.ai) Game.notify(L.id, '盟員 ' + p.name + ' 叛變投靠〔' + to.name + '〕了！', 'bad');
  }
  // 梟雄：收服附近較弱的 AI 同盟為附庸，附庸跟隨其目標、互不攻擊
  function subjugate(p) {
    const g = G();
    if (p.alliance < 0) return;
    const a = g.alliances[p.alliance];
    if (a.leader !== p.id || a.lord >= 0) return;
    if (U.rnd() < 0.1 * p.prof.chat) later(p, 'world', U.pick(CHAT.overlord).replace('{a}', a.name).replace('{s}', World.states[p.state].name), U.rint(1, 20));
    if (Game.day() < 3 || U.rnd() > 0.35) return;
    let best = null, bd = 1e9;
    for (const b of g.alliances) {
      if (b.dead || b.id === a.id || b.lord >= 0 || userLed(b)) continue;
      if (g.alliances.some(x => !x.dead && x.lord === b.id)) continue; // 別人的宗主不收
      if (b.power > a.power * 0.7) continue;
      const L = Game.P[b.leader];
      if ((L.prof || {}).persona === 'overlord') continue;
      const d = World.dist(L.cityTile, p.cityTile);
      if (d > 80 * MS()) continue;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return;
    best.lord = a.id;
    if (best.enemy === a.id) best.enemy = -1;
    if (a.enemy === best.id) a.enemy = -1;
    if (!p.title) p.title = '霸主';
    Game.sys('world', '【歸順】〔' + best.name + '〕歸順〔' + a.name + '〕，聽其號令！');
    later(Game.P[best.leader], 'world', U.pick(CHAT.vassal).replace('{a}', a.name).replace('{b}', best.name), U.rint(1, 8));
    if (a.target >= 0 && U.chance(0.6)) {
      const c = World.cities[a.target];
      later(p, 'world', U.pick(CHAT.overlordOrder).replace('{a}', a.name).replace('{c}', c.name + '(' + c.cx + ',' + c.cy + ')'), U.rint(3, 20));
      best.target = -1; best.nextChoose = 0;
    }
  }
  // 玩家當盟主：附近的 AI 會陸續申請加入並聽從指揮
  function recruitForUser(a) {
    const g = G();
    if (a.members.length >= CFG.ALLIANCE_MAX || U.rnd() > (a.members.length < 12 ? 0.5 : 0.25)) return;
    const u = Game.P[a.leader];
    const cands = Game.P.filter(q => {
      if (!q.ai || q.alliance === a.id || q.captor >= 0) return false;
      if (World.dist(q.cityTile, u.cityTile) > 130 * MS()) return false;
      if (q.alliance < 0) return !(q.prof.leader && mem(q).createAt !== undefined);
      const b = g.alliances[q.alliance];
      if (b.leader === q.id || persona(q) === 'overlord') return false;
      // 小盟成員、或對原盟忠誠度低的人會跳槽過來（主公威望越高越吸引人）
      const pull = Math.min(0.35, u.power / Math.max(1, b.power) * 0.1);
      return b.members.length < 8 || q.prof.loyalty < 0.35 + pull;
    });
    if (!cands.length) return;
    const q = U.weighted(cands, x => (x.alliance < 0 ? 3 : 1) * (x.state === u.state ? 2 : 1) * (persona(x) === 'turtle' ? 0.5 : 1));
    if (!q) return;
    if (q.alliance >= 0) Game.leaveAlliance(q);
    if (!Game.joinAlliance(q, a.id, true).ok) return;
    later(q, 'ally', U.pick(CHAT.obeyUser), U.rint(1, 6));
    Game.notify(u.id, q.name + '（' + q.prof.label + '）加入了你的同盟', 'good');
  }

  // ================= 聊天 =================
  const pending = [];
  function later(p, ch, text, delayMin) { pending.push({ at: G().time + (delayMin || 0), pid: p.id, ch, text }); }
  function chatTick() {
    const g = G();
    for (let k = pending.length - 1; k >= 0; k--) {
      const m = pending[k];
      if (m.at <= g.time) {
        pending.splice(k, 1);
        const p = Game.P[m.pid];
        if (p) Game.say(p, m.ch, m.text);
      }
    }
    const sp = Math.max(1, g.speed || 1);
    // 世界頻道閒聊
    if (U.rnd() < 0.55 / Math.sqrt(sp)) {
      const p = U.pick(Game.P);
      if (p && p.ai && U.rnd() < p.prof.chat) {
        const txt = ambient(p);
        if (txt) Game.say(p, 'world', txt);
      }
    }
    // 同盟頻道
    for (const a of g.alliances) {
      if (a.dead || !a.members.length) continue;
      if (U.rnd() < 0.18 / Math.sqrt(sp)) {
        const p = Game.P[U.pick(a.members)];
        if (p && p.ai) { const t = allyAmbient(p, a); if (t) Game.say(p, 'ally', t); }
      }
    }
  }
  function ambient(p) {
    const g = G();
    const t = p.prof.type;
    const d = Game.day();
    const r = U.rnd();
    if (t === 'newbie' && r < 0.5) return U.pick(CHAT.newbieQ);
    if (t === 'whale' && r < 0.35) return U.pick(CHAT.whale);
    if (p.prof.leader && p.alliance >= 0 && r < 0.3 && g.alliances[p.alliance].members.length < 35) return U.pick(CHAT.recruit).replace('{a}', g.alliances[p.alliance].name).replace('{s}', World.states[p.state].name);
    if (r < 0.2 && g.news.length && g.time - g.news[0].t < 180) return U.pick(CHAT.newsReact).replace('{e}', g.news[0].text);
    if (d < 3 && r < 0.6) return U.pick(CHAT.early);
    if (t === 'veteran' && r < 0.4) return U.pick(CHAT.tips);
    return U.pick(CHAT.idle);
  }
  function allyAmbient(p, a) {
    const r = U.rnd();
    if (a.target >= 0) {
      const c = World.cities[a.target];
      if (a.leader === p.id && r < 0.4) return U.pick(a.phase === 'siege' ? CHAT.siegeGo : CHAT.pave).replace('{c}', c.name).replace('{xy}', '(' + c.cx + ',' + c.cy + ')');
      if (r < 0.5) return U.pick(a.phase === 'siege' ? CHAT.siegeReply : CHAT.paveReply).replace('{c}', c.name);
    }
    if (p.prof.type === 'newbie' && r < 0.6) return U.pick(CHAT.allyNewbie);
    return U.pick(CHAT.allyIdle);
  }
  function onUserChat(user, ch, text) {
    const g = G();
    let pool;
    if (ch === 'ally') {
      if (user.alliance < 0) return;
      pool = g.alliances[user.alliance].members.map(id => Game.P[id]).filter(q => q.ai);
    } else pool = Game.P.filter(q => q.ai);
    if (!pool.length) return;
    const n = ch === 'ally' ? U.rint(1, 3) : (U.chance(0.6) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const q = U.pick(pool);
      later(q, ch, replyTo(q, text, user), U.rint(1, 4) + k);
    }
  }
  function replyTo(q, text, user) {
    const s = text;
    if (/救|援|help|打我|被打/i.test(s)) return U.pick(['來了來了', '坐標發一下', '我派一隊過去駐守', '頂住！馬上到', '兵在征，等我十分鐘', '誰打你？我去報仇']);
    if (/好|hi|hello|哈囉|嗨/i.test(s)) return U.pick(['你好呀', '主公好', '歡迎歡迎', '嗨～', '好好好', '新人嗎？有問題問我']);
    if (/[?？]|怎麼|如何|請問/.test(s)) return U.pick(CHAT.tips);
    if (/攻城|集合|衝|打/.test(s)) return U.pick(['收到', '跟上！', '主力在路上', '我體力不夠了，等一下', '衝衝衝', '先把守軍清掉']);
    if (/謝/.test(s)) return U.pick(['不客氣', '應該的', '一起加油', '小事']);
    if (/哈/.test(s)) return U.pick(['哈哈哈', 'XD', '笑死', '233']);
    return U.pick(['+1', '收到', '有道理', '嗯嗯', '哈哈', '同意', '好喔', '是的主公', '6', '看情況吧', '我也這麼覺得']);
  }

  return {
    makeProfiles, init, restore, PERSONA, sameBloc, interval, think, setupLeaders, alliancesThink, chatTick, daily,
    onThreat, onAttacked, onLandLost, onCaptured, onBattleResult, onCityCaptured, onJoin, onUserChat,
    get GP() { calib(); return GP; }, get CP() { calib(); return CP; }, R50, CR50, TYPES, winP, buildField, updatePave, cityAdjacent, reachable,
    _pending: pending,
  };
})();
