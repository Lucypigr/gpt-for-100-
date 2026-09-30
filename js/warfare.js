// 戰爭強化：關口爭奪、多人增援、失關反攻與同盟 PvP 戰線
'use strict';

(function () {
  if (typeof AI === 'undefined' || AI.__warfareEnhanced) return;
  AI.__warfareEnhanced = true;

  const basePassThreat = AI.onPassThreat;
  const baseCityCaptured = AI.onCityCaptured;
  const baseLandLost = AI.onLandLost;
  const baseAttacked = AI.onAttacked;
  const baseAlliancesThink = AI.alliancesThink;

  function G() { return Game.G; }

  function hostile(aid, bid) {
    if (aid < 0 || bid < 0 || aid === bid) return false;
    return !AI.sameBloc(aid, bid);
  }

  function declareWar(defender, attacker) {
    if (!defender || !attacker || defender.alliance < 0 || attacker.alliance < 0) return;
    if (!hostile(defender.alliance, attacker.alliance)) return;
    const a = G().alliances[defender.alliance];
    if (!a || a.dead) return;
    a.enemy = attacker.alliance;
    a.warSince = G().time;
    a.warLastContact = G().time;
  }

  function teamEffectivePower(p, team, tile) {
    return Game.teamPower(p, team) * CFG.moraleDmg(Game.marchMorale(p, team, tile));
  }

  function passCoverage(a, city) {
    let power = 0;
    for (const id of a.members) {
      const p = Game.P[id];
      for (const team of p.teams) {
        if ((team.status === 'garrison' && city.tiles.includes(team.gtile)) ||
            (team.status === 'idle' && city.tiles.includes(team.base))) power += Game.teamPower(p, team);
      }
    }
    for (const m of G().marches) {
      if (m.type !== 'garrison' || !city.tiles.includes(m.to)) continue;
      const p = Game.P[m.pid];
      if (!p || p.alliance !== a.id) continue;
      const team = p.teams[m.team];
      if (team) power += teamEffectivePower(p, team, m.to) * 0.9;
    }
    return power;
  }

  function reinforceThreatenedPass(city, attacker, march) {
    if (!city || city.type !== 'pass' || city.alliance < 0 || !attacker || !march) return;
    const a = G().alliances[city.alliance];
    if (!a || a.dead || !hostile(a.id, attacker.alliance)) return;
    const enemy = attacker.teams[march.team];
    if (!enemy) return;
    const tile = city.tiles[(city.tiles.length / 2) | 0];
    const enemyPower = Math.max(1, Game.teamPower(attacker, enemy));
    let covered = passCoverage(a, city);
    const desired = enemyPower * 1.35;
    if (covered >= desired) return;

    const candidates = [];
    for (const id of a.members) {
      const p = Game.P[id];
      if (!p.ai) continue;
      for (const team of p.teams) {
        if (!Game.teamReady(p, team, CFG.COST_GARRISON)) continue;
        if (city.tiles.includes(team.base) || (team.status === 'garrison' && city.tiles.includes(team.gtile))) continue;
        const cap = Game.teamCapTroops(p, team);
        if (!cap || Game.teamTroops(p, team) < cap * 0.55) continue;
        const eta = Game.marchTime(p, team, team.base, tile);
        if (G().time + eta + 2 >= march.end) continue;
        const power = teamEffectivePower(p, team, tile);
        candidates.push({ p, team, eta, power, score: power / Math.max(4, eta) });
      }
    }
    candidates.sort((x, y) => y.score - x.score);
    let sent = 0;
    for (const c of candidates) {
      if (covered >= desired || sent >= 3) break;
      const r = Game.send(c.p, c.team.id, tile, 'garrison');
      if (!r.ok) continue;
      c.team.guardUntil = Math.max(c.team.guardUntil || 0, march.end + 35);
      covered += c.power;
      sent++;
    }
    if (sent && a.leader >= 0 && Game.P[a.leader].ai) {
      Game.say(Game.P[a.leader], 'ally', '【關口告急】' + city.name + ' 遭襲，已調集 ' + sent + ' 支部隊增援駐守！');
    }
  }

  function strategicEnemyTarget(a) {
    if (!a || a.dead || a.enemy < 0) return null;
    const enemy = G().alliances[a.enemy];
    if (!enemy || enemy.dead || AI.sameBloc(a.id, enemy.id)) return null;
    let best = null, bestScore = -1e9;
    for (const cid of enemy.cities || []) {
      const c = World.cities[cid];
      if (!c || c.dead || c.alliance !== enemy.id || World.isPlayerCity(c)) continue;
      if (Game.cityLockedDay(c) > Game.day()) continue;
      if (!AI.reachable(a, c)) continue;
      let score = (CFG.CITY_POINTS[c.type] || 5) * 8;
      if (c.type === 'pass') score += 520 + AI.passPriority(a, c);
      else if (c.type === 'capital') score += 260;
      else if (c.type === 'commandery') score += 160;
      score -= World.dist(Game.P[a.leader].cityTile, c.tiles[(c.tiles.length / 2) | 0]) * 1.2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  function promoteWarTargets() {
    for (const a of G().alliances) {
      if (!a || a.dead || a.enemy < 0 || a.target >= 0) continue;
      const leader = Game.P[a.leader];
      if (!leader || !leader.ai || a.members.length < 3) continue;
      if (G().time < (a.nextWarTarget || 0)) continue;
      a.nextWarTarget = G().time + 90;
      const target = strategicEnemyTarget(a);
      if (!target) continue;
      a.target = target.id;
      a.targetSince = G().time;
      a.phase = 'pave';
      a.field = null;
      a.pave = null;
      Game.say(leader, 'ally', '【戰線推進】敵盟控制' + CFG.CITY_TYPE_NAME[target.type] + '【' + target.name + '】，全盟鋪路推進！');
    }
  }

  function holdCapturedPasses() {
    for (const a of G().alliances) {
      if (!a || a.dead || a.warHoldPass === undefined || G().time > (a.warHoldUntil || 0)) continue;
      const city = World.cities[a.warHoldPass];
      if (!city || city.type !== 'pass' || city.alliance !== a.id) { delete a.warHoldPass; continue; }
      if (passCoverage(a, city) > 0) continue;
      const tile = city.tiles[(city.tiles.length / 2) | 0];
      let best = null, bestScore = -1;
      for (const id of a.members) {
        const p = Game.P[id];
        if (!p.ai) continue;
        for (const team of p.teams) {
          if (!Game.teamReady(p, team, CFG.COST_GARRISON)) continue;
          const cap = Game.teamCapTroops(p, team);
          if (!cap || Game.teamTroops(p, team) < cap * 0.65) continue;
          const eta = Game.marchTime(p, team, team.base, tile);
          const power = teamEffectivePower(p, team, tile);
          const score = power / Math.max(6, eta);
          if (score > bestScore) { bestScore = score; best = { p, team }; }
        }
      }
      if (best) {
        const r = Game.send(best.p, best.team.id, tile, 'garrison');
        if (r.ok) best.team.guardUntil = Math.max(best.team.guardUntil || 0, a.warHoldUntil);
      }
    }
  }

  AI.onPassThreat = function (city, attacker, march) {
    basePassThreat(city, attacker, march);
    if (city && city.alliance >= 0 && attacker) {
      const defender = Game.P[(G().alliances[city.alliance] || {}).leader];
      if (defender) declareWar(defender, attacker);
    }
    reinforceThreatenedPass(city, attacker, march);
  };

  AI.onAttacked = function (p, attacker, tile, winner) {
    baseAttacked(p, attacker, tile, winner);
    declareWar(p, attacker);
  };

  AI.onLandLost = function (p, attacker, tile) {
    baseLandLost(p, attacker, tile);
    declareWar(p, attacker);
  };

  AI.onCityCaptured = function (city, aid, oldA) {
    baseCityCaptured(city, aid, oldA);
    const g = G();
    const winner = g.alliances[aid];
    if (winner && city.type === 'pass') {
      winner.warHoldPass = city.id;
      winner.warHoldUntil = g.time + 360;
      if (oldA >= 0 && hostile(aid, oldA)) winner.enemy = oldA;
    }
    if (city.type !== 'pass' || oldA < 0 || !hostile(oldA, aid)) return;
    const loser = g.alliances[oldA];
    if (!loser || loser.dead) return;
    loser.enemy = aid;
    loser.warSince = g.time;
    loser.warLastContact = g.time;
    loser.target = city.id;
    loser.targetSince = g.time;
    loser.phase = 'pave';
    loser.field = null;
    loser.pave = null;
    loser.rallyAt = 0;
    const leader = Game.P[loser.leader];
    if (leader && leader.ai) Game.say(leader, 'ally', '【失關反攻】' + city.name + ' 失守，全盟重新鋪路集結，準備奪回關口！');
  };

  AI.alliancesThink = function (now) {
    promoteWarTargets();
    baseAlliancesThink(now);
    if (now === undefined || now % 30 === 0) holdCapturedPasses();
  };
})();
