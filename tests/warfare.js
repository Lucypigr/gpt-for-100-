'use strict';
const assert = require('node:assert/strict');
const { load } = require('./load');
const { Game, AI, World } = load();

const G = Game.newGame({ seed: 91001, aiCount: 20 });
const defender = Game.P[1];
const attacker = Game.P[0];
defender.copper = 20000;
attacker.copper = 20000;
assert.equal(Game.createAlliance(defender, '守關盟').ok, true);
assert.equal(Game.createAlliance(attacker, '進攻盟').ok, true);
const da = G.alliances[defender.alliance];
const aa = G.alliances[attacker.alliance];

// 敵盟搶地後，守方會把對方標記為戰爭敵盟，讓 PvP/據點突襲邏輯接手。
AI.onLandLost(defender, attacker, defender.lands[0]);
assert.equal(da.enemy, aa.id, 'land conflict escalates into alliance war');

const pass = World.cities.find(c => c.type === 'pass' && c.link.includes(defender.state));
assert.ok(pass, 'defender state has a pass');
pass.alliance = da.id;
da.cities.push(pass.id);
G.time = 6000;
const march = { team: 0, end: G.time + 5000 };
AI.onPassThreat(pass, attacker, march);
assert.equal(da.enemy, aa.id, 'attacking an owned pass declares the hostile alliance');
assert.ok(G.marches.some(m => m.pid === defender.id && m.type === 'garrison' && pass.tiles.includes(m.to)), 'threatened pass receives reinforcement');

// 關口易手後，勝方留守，失守方立即把該關設為反攻目標。
da.cities = da.cities.filter(id => id !== pass.id);
aa.cities.push(pass.id);
pass.alliance = aa.id;
AI.onCityCaptured(pass, aa.id, da.id);
assert.equal(aa.warHoldPass, pass.id, 'winner schedules a post-capture pass hold');
assert.ok(aa.warHoldUntil > G.time, 'winner keeps a defensive hold window');
assert.equal(da.target, pass.id, 'loser immediately targets the lost pass for recapture');
assert.equal(da.phase, 'pave', 'recapture starts by rebuilding the route');
assert.equal(da.enemy, aa.id, 'loser keeps the capturing alliance as war enemy');

console.log('Alliance war escalation, pass reinforcement, hold and counterattack OK');
