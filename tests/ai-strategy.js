'use strict';
const assert = require('node:assert/strict');
const { load } = require('./load');
const { Game, AI, World, TERRAIN, CFG } = load();

const G = Game.newGame({ seed: 1173, aiCount: 20 });
const p = Game.P[1], attacker = Game.P[0];
p.copper = 20000;
const created = Game.createAlliance(p, '戰略測試');
assert.equal(created.ok, true);
const a = created.alliance;
G.time = 5000;

const passes = World.cities.filter(c => c.type === 'pass' && c.link.includes(p.state))
  .sort((x, y) => World.dist(x.tiles[0], p.cityTile) - World.dist(y.tiles[0], p.cityTile));
assert.ok(passes.length, 'AI birth state has a pass');
const pass = passes[0];
const before = AI.passPriority(a, pass);
assert.ok(before >= 130, 'a pass opening another state has strategic value');
pass.alliance = a.id;
a.cities.push(pass.id);
assert.ok(AI.passPriority(a, pass) < before, 'already opened route is less urgent');

const county = World.cities.filter(c => c.type === 'county')
  .sort((x, y) => World.dist(x.tiles[0], p.cityTile) - World.dist(y.tiles[0], p.cityTile))[0];
a.target = county.id;
a.phase = 'siege';
a.rallyAt = G.time;
const team = p.teams[0];
const originalTroops = team.slots.map(uid => uid ? Game.heroByUid(p, uid).troops : 0);
for (const uid of team.slots) if (uid) Game.heroByUid(p, uid).troops = 1;
assert.equal(AI.allianceAction(p, team, Game.teamPower(p, team)), -2, 'weak demolition team waits for guard clearing');
team.slots.forEach((uid, n) => { if (uid) Game.heroByUid(p, uid).troops = originalTroops[n]; });
county.garrison = Array.from({ length: CFG.CITY_GARRISON[county.lvl][0] }, () => [0, 0, 0]);
county.resetAt = G.time + 80;
let adjacent = -1;
const neighbors = [];
for (const t of county.tiles) {
  World.neighbors8(t, neighbors);
  adjacent = neighbors.find(i => Game.T.terrain[i] === TERRAIN.PLAIN && Game.T.city[i] < 0 && World.linked(i, t));
  if (adjacent !== undefined) break;
}
assert.ok(adjacent >= 0, 'county has a neighboring land tile');
Game.setOwner(adjacent, p.id);
assert.equal(AI.allianceAction(p, team, Game.teamPower(p, team)), county.tiles[(county.tiles.length / 2) | 0], 'after guards fall, AI demolishes the city');

for (const uid of attacker.teams[0].slots) if (uid) Game.heroByUid(attacker, uid).troops = 1;
AI.onPassThreat(pass, attacker, { team: 0, end: G.time + 200 });
assert.ok(G.marches.some(m => m.pid === p.id && m.type === 'garrison' && pass.tiles.includes(m.to)), 'AI reinforces its threatened pass');
assert.ok(team.guardUntil > G.time, 'reinforcement has a return deadline');
G.marches = [];
team.status = 'idle'; team.march = 0; delete team.guardUntil;
let passNeighbor = -1;
for (const t of pass.tiles) {
  World.neighbors8(t, neighbors);
  passNeighbor = neighbors.find(i => Game.T.terrain[i] === TERRAIN.PLAIN && Game.T.city[i] < 0 && World.linked(i, t));
  if (passNeighbor !== undefined) break;
}
assert.ok(passNeighbor >= 0);
Game.setOwner(passNeighbor, attacker.id);
assert.equal(Game.send(attacker, 0, pass.tiles[(pass.tiles.length / 2) | 0], 'attack').ok, true);
assert.ok(G.marches.some(m => m.pid === p.id && m.type === 'garrison' && pass.tiles.includes(m.to)), 'an actual pass attack triggers ally reinforcements');

const raidNeighbors = [];
World.neighbors8(adjacent, raidNeighbors);
const raidTile = raidNeighbors.find(i => Game.T.terrain[i] === TERRAIN.PLAIN && Game.T.city[i] < 0 && Game.T.owner[i] < 0 && World.linked(i, adjacent));
assert.ok(raidTile >= 0, 'frontline has a neighboring tile for an enemy camp');
const camp = { id: World.cities.length, type: 'camp', owner: attacker.id, tiles: [raidTile], cx: World.X(raidTile), cy: World.Y(raidTile), dur: 80, maxDur: 800, dead: false };
World.cities.push(camp);
Game.T.city[raidTile] = camp.id;
p.prof.skill = 0.9;
p.grudge[attacker.id] = G.time;
assert.equal(AI.pvpTarget(p, team, Game.teamPower(p, team)), raidTile, 'AI raids an exposed hostile forward camp');
console.log('AI pass priority, assault order, demolition, pass defense, and camp raid OK');
