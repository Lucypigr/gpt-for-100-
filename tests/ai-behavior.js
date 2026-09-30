'use strict';
const assert = require('node:assert/strict');
const { load } = require('./load');
const S = load();
const { Game, AI, World, TERRAIN } = S;

const G = Game.newGame({ seed: 7264, aiCount: 1 });
const defender = G.players[1];
const T = Game.T;

// 敗仗會使 AI 暫避該地，並且經驗要能跨存檔延續。
let target = -1;
for (let y = 5; y < World.N - 5 && target < 0; y++) {
  for (let x = 5; x < World.N - 5; x++) {
    const i = y * World.N + x;
    if (T.terrain[i] === TERRAIN.PLAIN && T.city[i] < 0 && World.dist(i, defender.cityTile) < 10) { target = i; break; }
  }
}
assert.ok(target >= 0, 'test land exists');
G.time = 100;
AI.onBattleResult(defender, defender.teams[0], target, false);
assert.equal(AI.avoidTile(defender, target), true);
const saved = Game.serialize();
Game.deserialize(saved);
const restored = Game.P[1];
assert.equal(AI.avoidTile(restored, target), true, 'AI remembers the loss after loading');
Game.G.time = 500;
assert.equal(AI.avoidTile(restored, target), false, 'AI tries again after cooldown');

// 高級地遭攻擊時，只要有可趕到且戰力足夠的部隊，AI 就派兵駐守。
Game.T.owner[target] = restored.id;
Game.T.lvl[target] = 6;
for (const uid of Game.P[0].teams[0].slots) {
  const hero = Game.heroByUid(Game.P[0], uid);
  if (hero) hero.troops = 1;
}
AI.onThreat(restored, Game.P[0], target, { team: 0, end: Game.G.time + 200 });
assert.equal(restored.teams[0].status, 'march');
assert.ok(Game.G.marches.some(m => m.pid === restored.id && m.type === 'garrison' && m.to === target));
assert.equal(restored.teams[0].guardUntil, Game.G.time + 220);
Game.deserialize(Game.serialize());
const guarded = Game.P[1];
assert.equal(guarded.teams[0].guardUntil, Game.G.time + 220, 'defense deadline survives save/load');
for (let minute = 0; minute < 230; minute++) Game.tick();
assert.equal(guarded.teams[0].guardUntil, undefined, 'temporary garrison has an end time');
assert.notEqual(guarded.teams[0].status, 'garrison', 'AI recalled its temporary defender');

// 實際運行多隊 AI，確認不會向同一格普通土地重複派兵。
Game.newGame({ seed: 12345, aiCount: 60 });
const originalSend = Game.send;
let landAttacks = 0;
Game.send = function (p, teamId, tile, type) {
  if (p.ai && type === 'attack' && Game.T.city[tile] < 0) {
    assert.equal(Game.G.marches.some(m => m.pid === p.id && m.type === 'attack' && m.to === tile), false, 'duplicate land attack');
    landAttacks++;
  }
  return originalSend(p, teamId, tile, type);
};
for (let minute = 0; minute < 720; minute++) Game.tick();
assert.ok(landAttacks > 100, 'AI attacked enough land to exercise the rule');
console.log('AI learning, save/load, land defense, and duplicate attack prevention OK');
