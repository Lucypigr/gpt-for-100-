'use strict';
// 無頭模擬：跑 N 天，輸出平衡與效能統計
const { load } = require('./load');
const S = load();
const days = +(process.argv[2] || 3);
const seed = +(process.argv[3] || 777);
const G = S.Game.newGame({ seed, userName: '測試主公' });
let P = G.players;
let t0 = Date.now();
function stats(label) {
  const ai = P.filter(p => p.ai);
  const by = {};
  for (const p of ai) {
    const k = p.prof.type;
    by[k] = by[k] || { n: 0, lands: 0, fame: 0, maxLv: 0, heroLv: 0, power: 0, alli: 0, bat: 0, wins: 0, maxLandLv: 0, cap: 0, b: 0 };
    const o = by[k];
    o.n++; o.lands += p.landCount; o.fame += p.fame; o.power += p.power; o.alli += p.alliance >= 0 ? 1 : 0;
    o.bat += p.stats.battles; o.wins += p.stats.wins; o.maxLandLv += p.stats.maxLandLv; o.cap += p.landCap; o.b += p.b.palace;
    let ml = 0; for (const h of p.heroes) if (h.team >= 0) ml = Math.max(ml, h.lv);
    o.heroLv += ml;
  }
  console.log('== ' + label + ' day ' + (G.time / 1440).toFixed(2) + ' realms ' + ((Date.now() - t0) / 1000).toFixed(1) + 's marches ' + G.marches.length);
  for (const k in by) {
    const o = by[k];
    const f = x => (x / o.n).toFixed(1);
    console.log(k.padEnd(8), 'n', o.n, 'lands', f(o.lands), 'cap', f(o.cap), 'fame', f(o.fame), 'heroLv', f(o.heroLv), 'maxLandLv', f(o.maxLandLv), 'palace', f(o.b), 'battles', f(o.bat), 'win%', (o.wins / Math.max(1, o.bat) * 100).toFixed(0), 'inAlli', o.alli);
  }
  const al = G.alliances.filter(a => !a.dead);
  console.log('alliances', al.length, al.map(a => a.name + '(' + a.members.length + ',c' + a.cities.length + ',t' + a.target + ',' + (a.phase || '-') + ')').join(' '));
  const u = P[0];
  console.log('user lands', u.landCount);
}
const perDay = 1440;
for (let d = 0; d < days; d++) {
  const t1 = Date.now();
  for (let k = 0; k < perDay; k++) { S.Game.tick(); if (G.over) break; }
  console.log('day', d + 1, 'ms', Date.now() - t1);
  if (d === 2) {
    const str = S.Game.serialize();
    console.log('save size', (str.length / 1024).toFixed(0) + 'KB');
    S.Game.deserialize(str);
    P = G.players;
    console.log('reloaded ok, players', P.length, 'marches', G.marches.length);
  }
  stats('end');
  if (G.over) { console.log('SEASON OVER', G.winner, G.endReason); break; }
}
const ly = S.World.cities.find(c => c.type === 'luoyang');
console.log('luoyang', ly.alliance, ly.alliance >= 0 ? G.alliances[ly.alliance].name : '-', 'hold', ly.holdSince);
const captured = P.filter(p => p.captor >= 0).length;
console.log('captured players now', captured, 'main city falls', G.fallCount || 0);
console.log('kills by type', JSON.stringify(P.filter(p => p.ai).reduce((o, p) => { o[p.prof.type] = (o[p.prof.type] || 0) + p.stats.kills; return o; }, {})));
const caps = S.World.cities.filter(c => c.type !== 'main' && c.type !== 'fort' && c.alliance >= 0);
console.log('captured cities', caps.length, caps.map(c => c.name + '/' + c.type).join(','));
console.log('world chat sample:'); G.chat.world.slice(-12).forEach(m => console.log('  ', m.name + ':', m.text));
