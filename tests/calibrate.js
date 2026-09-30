'use strict';
// 校準：隊伍戰力 / 守軍戰力 比值 對應的勝率
const { load } = require('./load');
const S = load();
S.Game.newGame({ seed: 1, aiCount: 0 });
const p = S.Game.P[0];
S.AI.restore(p);
const GP = S.AI.GP, CP = S.AI.CP;
function randomTeam(lv) {
  const pool = S.HEROES.filter(h => h.star >= 3);
  const units = [];
  const used = new Set();
  for (let s = 0; s < 3; s++) {
    let t; do { t = pool[(Math.random() * pool.length) | 0]; } while (used.has(t.name)); used.add(t.name);
    const L = lv - 1;
    const pts = Math.floor(lv / 10) * 10;
    units.push({ name: t.name, faction: t.faction, troop: t.troop, troops: S.CFG.heroTroopCap(lv, Math.min(10, lv / 5 | 0)),
      atk: t.atk + t.atkG * L + (t.role === 'atk' ? pts : 0), def: t.def + t.defG * L, int: t.int + t.intG * L + (t.role === 'int' ? pts : 0), spd: t.spd + t.spdG * L,
      range: t.range, skills: [t.skill], slot: s, lv });
  }
  return units;
}
function fightLand(units, L) {
  const g = S.CFG.GARRISON[L];
  let att = units.map(u => Object.assign({}, u));
  for (let s = 0; s < g[0]; s++) {
    const sq = S.Game.npcSquad(L, g[1], g[2], new Array(g[1]).fill(g[3]), 7 + s, false);
    const r = S.Battle.simulate(att, sq, {});
    if (r.winner !== 'atk') return false;
    att = att.map(u => { const x = r.A.find(a => a.slot === u.slot); return Object.assign({}, u, { troops: x ? x.troops : 0 }); });
  }
  return true;
}
const buckets = {};
for (let L = 1; L <= 9; L++) {
  const b = {};
  for (let k = 0; k < 1500; k++) {
    const lv = 1 + ((Math.random() * 50) | 0);
    const u = randomTeam(lv);
    const ratio = S.Battle.power(u) / GP[L];
    const key = Math.min(30, Math.round(ratio * 5)) / 5;
    const w = fightLand(u, L);
    b[key] = b[key] || [0, 0];
    b[key][0] += w ? 1 : 0; b[key][1]++;
  }
  const keys = Object.keys(b).map(Number).sort((a, c) => a - c).filter(k => b[k][1] >= 8);
  console.log('L' + L, keys.map(k => k.toFixed(1) + ':' + Math.round(b[k][0] / b[k][1] * 100)).join(' '));
}
// 城池一隊
for (const L of [5, 6, 7, 8, 9, 10]) {
  const g = S.CFG.CITY_GARRISON[L];
  const b = {};
  for (let k = 0; k < 800; k++) {
    const lv = 15 + ((Math.random() * 36) | 0);
    const u = randomTeam(Math.min(50, lv));
    const ratio = S.Battle.power(u) / CP[L];
    const key = Math.min(30, Math.round(ratio * 5)) / 5;
    const sq = S.Game.npcSquad(L, 3, g[1], [g[2], g[2], g[2]], 3, true);
    const r = S.Battle.simulate(u, sq, {});
    b[key] = b[key] || [0, 0];
    b[key][0] += r.winner === 'atk' ? 1 : 0; b[key][1]++;
  }
  const keys = Object.keys(b).map(Number).sort((a, c) => a - c).filter(k => b[k][1] >= 8);
  console.log('City' + L, keys.map(k => k.toFixed(1) + ':' + Math.round(b[k][0] / b[k][1] * 100)).join(' '));
}
console.log('GP', GP.map(x => Math.round(x)).join(','), 'CP', JSON.stringify(Object.fromEntries(Object.entries(CP).map(([k, v]) => [k, Math.round(v)]))));
