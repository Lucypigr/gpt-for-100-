'use strict';
// 存讀檔一致性測試：序列化後重建地圖，所有地塊與玩家狀態須相同
const { load } = require('./load');
const S = load();
const G = S.Game.newGame({ seed: 4242, aiCount: 80 });
for (let k = 0; k < 1440 * 2; k++) S.Game.tick();
// 建一座要塞
const u = G.players[1];
if (u.lands.length) S.Game.buildFort(Object.assign(u, { res: { wood: 1e6, iron: 1e6, stone: 1e6, grain: 1e6 } }), u.lands[0]);
const T = S.Game.T;
const snap = { terrain: T.terrain.slice(), lvl: T.lvl.slice(), city: T.city.slice(), owner: T.owner.slice(), state: T.state.slice(), res: T.res.slice() };
const lands = G.players.map(p => p.lands.length);
const norm = hs => JSON.stringify(hs.map(h => Object.assign({}, h, { exp: Math.round(h.exp), sta: Math.round(h.sta * 10) / 10 })));
const heroes = norm(G.players.flatMap(p => p.heroes));
const str = S.Game.serialize();
S.Game.deserialize(str);
const T2 = S.Game.T;
let bad = 0;
for (const k in snap) for (let i = 0; i < snap[k].length; i++) if (snap[k][i] !== T2[k][i]) { if (bad++ < 5) console.log('mismatch', k, i, snap[k][i], T2[k][i]); }
G.players.forEach((p, k) => { if (p.lands.length !== lands[k] || p.lands.length !== p.landCount) { if (bad++ < 10) console.log('lands mismatch', k, lands[k], p.lands.length, p.landCount); } });
if (norm(G.players.flatMap(p => p.heroes)) !== heroes) { bad++; console.log('heroes mismatch'); }
for (let k = 0; k < 600; k++) S.Game.tick();
console.log('save KB', (str.length / 1024).toFixed(0), bad ? 'FAIL ' + bad : 'OK');
process.exit(bad ? 1 : 0);
