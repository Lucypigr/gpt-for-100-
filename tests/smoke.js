'use strict';
const { load } = require('./load');
const S = load();
const t0 = Date.now();
// 檢查資料完整性
for (const h of S.HEROES) for (const k of ['skill', 'inherit']) if (!S.SKILLS[h[k]]) throw new Error('missing ' + k + ' ' + h[k] + ' for ' + h.name);
for (const s of S.SKILLS._list) for (const f of s.fx.concat(s.rfx || [])) if (f.k !== 'range' && !/^(self|a1|a2|aAll|aLow|e1|e2|e3|e23|eAll)$/.test(f.tgt)) throw new Error('bad target ' + s.name);
const G = S.Game.newGame({ seed: 12345, userName: '測試主公' });
console.log('newGame ms', Date.now() - t0, 'players', G.players.length, 'cities', S.World.cities.length, 'passes', S.World.passes.length);
const st = S.World.states.map(s => s.name + ':' + s.tiles + '/c' + s.cities.length).join(' ');
console.log(st);
