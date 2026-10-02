'use strict';
const assert = require('node:assert/strict');
const { load } = require('./load');
const { Game, AI, World, TERRAIN, CFG } = load();

assert.equal(AI.raiderQuota(500), 30, '500 AI 局應約有 30 名劫掠者');
const G = Game.newGame({ seed: 771234, userName: '劫掠測試', aiCount: 80 });
const raiders = Game.P.filter(p => p.ai && AI.raiderSelf(p));
assert.ok(raiders.length >= 4 && raiders.length <= 6, '80 AI 局應約有 5 名劫掠者');
const raider = raiders[0];
assert.equal(AI.isRaider(raider), true, '劫掠客本人應被識別');
assert.match(AI.styleSummary(raider), /劫掠客/, '作風摘要應顯示劫掠客');

raider.copper = 999999;
const created = Game.createAlliance(raider, '劫掠測試盟');
assert.equal(created.ok, true, '劫掠客應能自立同盟');
const a = created.alliance;

// 拉一名普通 AI 入盟，驗證整個同盟會一起進入劫掠樣態。
const helper = Game.P.find(p => p.ai && p !== raider && !AI.raiderSelf(p) && p.alliance < 0);
assert.ok(helper, '缺少一般 AI 盟員');
assert.equal(Game.joinAlliance(helper, a.id, true).ok, true);
assert.equal(AI.isRaider(helper), true, '劫掠盟成員也應採用劫掠行為');

// 讓保護期結束，只留下附近一名明顯弱者，其他人設成強勢以避免誤選。
G.time = 20 * 1440;
for (const p of Game.P) { p.protectEnd = 0; if (p !== raider && p !== helper) p.power = 400000; }
const victim = Game.P.filter(p => p.ai && p !== raider && p !== helper && !AI.raiderSelf(p))
  .sort((x,y) => World.dist(x.cityTile,raider.cityTile) - World.dist(y.cityTile,raider.cityTile))
  .find(p => World.dist(p.cityTile,raider.cityTile) <= 62 * Math.max(1,World.N/300));
assert.ok(victim, '劫掠客附近應有可測試的弱者');
victim.power = 800;
a.power = 500000;

const picked = AI.chooseRaiderVictim(a, raider);
assert.ok(picked, '劫掠客應選到弱勢目標');
assert.equal(picked.id, victim.id, '劫掠客應優先挑明顯弱者');
assert.equal(a.raiderVictim, victim.id, '同盟應共享劫掠目標');
assert.equal(AI.raiderVictimId(helper), victim.id, '盟員應跟隨同一名弱勢目標');

// 連續搶地後，受害 AI 會在世界頻道公開點名「劫掠客」。
AI.recordRaiderIncident(victim, raider, 1);
AI.recordRaiderIncident(victim, raider, 1);
AI.recordRaiderIncident(victim, raider, 1);
assert.ok((a.raiderInfamy || 0) >= 6, '劫掠同盟應累積劫掠惡名');
assert.ok((raider.prof.raiderInfamy || 0) >= 6, '劫掠玩家應累積個人惡名');
assert.ok(AI._pending.some(m => /劫掠客/.test(m.text) && /〔劫掠測試盟〕/.test(m.text)), '受害者應在世界頻道揭露劫掠同盟');
assert.equal(AI.reputationSummary(raider), '劫掠惡名', '劫掠客聲譽應顯示劫掠惡名');

// 惡名跨過門檻後，整個同盟會被列為「全服公敵」，並在世界頻道公告。
AI.recordRaiderIncident(victim, raider, 27);
assert.equal(AI.publicEnemyActive(a), true, '高惡名劫掠盟應成為全服公敵');
assert.equal(AI.reputationSummary(raider), '全服公敵', '全服公敵狀態應覆蓋一般劫掠惡名顯示');
assert.ok(Game.G.chat.world.some(m => /全服公敵/.test(m.text) && /劫掠測試盟/.test(m.text)), '世界頻道應公告全服公敵');

// 非劫掠客不應因同一測試事件被錯誤標記。
const clean = Game.P.find(p => p.ai && !AI.isRaider(p) && p !== victim && p.alliance < 0);
assert.ok(clean, '缺少非劫掠 AI');
const abuseBefore = JSON.stringify(victim.raiderAbuse);
AI.recordRaiderIncident(victim, clean, 5);
assert.equal(JSON.stringify(victim.raiderAbuse), abuseBefore, '一般 AI 不應被劫掠系統誤判');

// 劫掠盟會優先搶受害者所在州的關口，形成堵路。
a.target = -1;
a.cities = a.cities || [];
const passes = World.cities.filter(c => c.type === 'pass' && c.link && c.link.includes(victim.state) && c.alliance !== a.id);
let chosenPass = null;
const nb = [];
for (const pass of passes) {
  for (const t of pass.tiles) {
    World.neighbors8(t, nb);
    const land = nb.find(i => Game.T.terrain[i] === TERRAIN.PLAIN && Game.T.city[i] < 0 && World.linked(i,t));
    if (land === undefined) continue;
    Game.setOwner(land, raider.id);
    a.raiderVictim = victim.id;
    a.raiderVictimUntil = G.time + 1000;
    if (AI.chooseRaiderPassTarget(a, raider)) { chosenPass = pass; break; }
  }
  if (chosenPass) break;
}
assert.ok(chosenPass, '劫掠盟應能鎖定弱者州域的關口');
assert.equal(a.target, chosenPass.id, '劫掠盟應把關口設為封路目標');

// 拿下關口後，劫掠客會比一般同盟留守更久。
chosenPass.alliance = a.id;
if (!a.cities.includes(chosenPass.id)) a.cities.push(chosenPass.id);
AI.onCityCaptured(chosenPass, a.id, -1);
assert.ok(a.warHoldUntil >= G.time + 1430, '劫掠客拿關後應長時間封鎖');

// 重外交/重信用 AI 對已有劫掠惡名的同盟會更警戒。
const observer = Game.P.find(p => p.ai && !AI.isRaider(p) && p !== victim && p !== clean && p.alliance < 0);
assert.ok(observer, '缺少外交觀察 AI');
observer.copper = 999999;
const obsA = Game.createAlliance(observer, '觀察盟').alliance;
obsA.power = a.power = 100000;
Object.assign(AI.traits(observer), { honorable:95, diplomatic:92, opportunistic:15, cautious:55, aggressive:40, warlike:35, courageous:45, ambitious:40 });
const inf = a.raiderInfamy;
const leaderInf = raider.prof.raiderInfamy || 0;
const publicUntil = a.publicEnemyUntil;
a.raiderInfamy = 0;
raider.prof.raiderInfamy = 0;
a.publicEnemyUntil = 0;
const normalScore = AI.warIntentScore(obsA, a, observer);
a.raiderInfamy = inf;
raider.prof.raiderInfamy = leaderInf;
a.publicEnemyUntil = publicUntil;
const raiderScore = AI.warIntentScore(obsA, a, observer);
assert.ok(raiderScore > normalScore, '重信用外交 AI 應因劫掠惡名與全服公敵提高警戒/敵意');

// 高信用／好戰 AI 同盟會暫停 AI 內鬥並加入討伐，不會替真人盟主自動作決定。
obsA.nextPublicEnemyThink = 0;
assert.equal(AI.publicEnemyThink(obsA, observer), true, 'AI 同盟應能響應全服公敵討伐');
assert.equal(obsA.enemy, a.id, '響應後應把全服公敵設為敵對同盟');

// 存讀檔後，劫掠身份、目標、惡名與受害紀錄都必須保留。
const snap = {
  archetype: raider.prof.archetype,
  victim: a.raiderVictim,
  infamy: a.raiderInfamy,
  publicEnemyUntil: a.publicEnemyUntil,
  abuse: JSON.stringify(victim.raiderAbuse),
};
const save = Game.serialize();
Game.deserialize(save);
const raider2 = Game.P[raider.id];
const a2 = Game.G.alliances[a.id];
const victim2 = Game.P[victim.id];
assert.equal(raider2.prof.archetype, snap.archetype, '存檔後劫掠身份改變');
assert.equal(a2.raiderVictim, snap.victim, '存檔後劫掠目標遺失');
assert.equal(a2.raiderInfamy, snap.infamy, '存檔後劫掠惡名遺失');
assert.equal(a2.publicEnemyUntil, snap.publicEnemyUntil, '存檔後全服公敵狀態遺失');
assert.equal(JSON.stringify(victim2.raiderAbuse), snap.abuse, '存檔後受害紀錄遺失');

console.log('Raider AI OK: ~6% raiders, weak-target gangs, pass blocking, public exposure, public-enemy coalition and persistence');
