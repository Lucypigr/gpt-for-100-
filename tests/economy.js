'use strict';
// 內政經濟機制測試：屯田、練兵、掃蕩、營帳、分城、遷城，以及存讀檔一致性
const { load } = require('./load');
const S = load();
const { Game, World, CFG } = S;
const G = Game.newGame({ seed: 99, aiCount: 0 });
const p = G.players[0];
const T = Game.T;
let bad = 0;
const check = (c, msg) => { if (!c) { bad++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const rich = () => Object.assign(p.res, { wood: 1e6, iron: 1e6, stone: 1e6, grain: 1e6 }) && Object.assign(p, { gold: 1e5, copper: 1e6 });
const run = n => { for (let k = 0; k < n; k++) Game.tick(); };
// 找一塊 3×3 可佔領的平地，距主城 10~20 格
function block(minD, maxD) {
  for (let i = 0; i < T.owner.length; i++) {
    const d = World.dist(i, p.cityTile);
    if (d < minD || d > maxD) continue;
    let okb = true;
    for (let dy = -1; dy <= 1 && okb; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = i + dy * World.N + dx;
      if (T.owner[j] >= 0 || T.city[j] >= 0 || !World.isPassable(j) || T.state[j] !== T.state[p.cityTile]) { okb = false; break; }
    }
    if (okb) return i;
  }
  return -1;
}
function own3(c) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) Game.setOwner(c + dy * World.N + dx, p.id); }
const team = p.teams[0];
for (const uid of team.slots) { const h = Game.heroByUid(p, uid); if (h) { h.troops = Game.heroCap(p, h); h.lv = 20; } }
rich();
// 屯田
const b1 = block(3, 8); own3(b1);
const r0 = CFG.RES[T.res[b1]];
const before = p.res[r0] = 1000;
check(Game.send(p, 0, b1, 'farm').ok, '屯田出發');
run(120);
check(p.res[r0] >= before + Game.farmYield(b1) * 0.99, '屯田獲得資源 ' + Math.round(p.res[r0] - before));
check(team.status === 'idle', '屯田後返回');
// 練兵
team.slots.forEach(u => { const h = Game.heroByUid(p, u); if (h) h.sta = 120; });
const exp0 = Game.heroByUid(p, team.slots[0]).exp, lv0 = Game.heroByUid(p, team.slots[0]).lv;
check(Game.send(p, 0, b1, 'train').ok, '練兵出發');
run(30);
check(team.status === 'train', '練兵中');
run(120);
const hh = Game.heroByUid(p, team.slots[0]);
check(team.status === 'idle' && (hh.lv > lv0 || hh.exp > exp0), '練兵結束返回並獲得經驗');
// 掃蕩
team.slots.forEach(u => { const h = Game.heroByUid(p, u); if (h) h.sta = 120; });
const reps = G.reports.length;
check(Game.send(p, 0, b1, 'sweep').ok, '掃蕩出發');
run(120);
check(T.owner[b1] === p.id && G.reports.length > reps && /掃蕩/.test(G.reports[0].target), '掃蕩後土地仍屬於自己且有戰報');
check(!Game.send(p, 0, b1 + 40 * World.N, 'farm').ok, '不能在他人/無主土地屯田');
// 營帳
rich();
const campT = b1 + 1;
check(Game.buildCamp(p, campT).ok, '建營帳');
run(CFG.CAMP_BUILD_MIN + 1);
check(Game.baseValid(p, campT), '營帳可作為駐地');
// 分城
p.fame = 20000; p.b.palace = 6; rich();
const b2 = block(10, 20); own3(b2);
const lands0 = p.landCount;
check(Game.canBranch(p, b2) === '', '可建分城 ' + Game.canBranch(p, b2));
check(Game.buildBranch(p, b2).ok, '建分城');
check(p.landCount === lands0 - 9, '分城 3×3 不再佔領地名額');
run(CFG.BRANCH_BUILD_MIN + 12);
check(Game.isHome(p, b2), '分城可征兵/治療');
check(p.prod.wood >= CFG.BRANCH_OUTPUT, '分城提高產量');
// 遷城
rich();
const b3 = block(12, 25); own3(b3);
const oldCity = p.cityTile;
const why = Game.canRelocate(p, b3);
check(why === '', '可遷城 ' + why);
check(Game.relocate(p, b3).ok, '遷城');
check(p.cityTile === b3 && T.city[oldCity] < 0 && World.cities[T.city[b3]].type === 'main', '主城搬到新位置、舊址清空');
check(!Game.relocate(p, b3).ok, '遷城冷卻');
// 營帳到期
run(CFG.CAMP_LIFE_MIN);
check(T.city[campT] < 0, '營帳到期拆除');
// 存讀檔一致
const snap = { terrain: T.terrain.slice(), lvl: T.lvl.slice(), city: T.city.slice(), owner: T.owner.slice() };
const str = Game.serialize();
Game.deserialize(str);
const T2 = Game.T;
let mism = 0;
for (const k in snap) for (let i = 0; i < snap[k].length; i++) if (snap[k][i] !== T2[k][i]) { if (mism++ < 3) console.log('  mismatch', k, i, snap[k][i], T2[k][i]); }
check(mism === 0, '存讀檔後地圖一致');
const p2 = Game.P[0];
check(p2.cityTile === b3 && Game.isHome(p2, b2) && p2.landCount === p2.lands.length, '存讀檔後主城、分城、領地一致');
run(60);
console.log(bad ? 'FAIL ' + bad : 'ALL OK');
process.exit(bad ? 1 : 0);
