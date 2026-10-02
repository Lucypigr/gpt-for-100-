'use strict';
const assert = require('node:assert/strict');
const { load } = require('./load');
const S = load();

S.Game.newGame({ seed: 20261002, aiCount: 0 });
const T = S.Game.T;
const counts = Array(10).fill(0);
let total = 0;

for (let i = 0; i < T.lvl.length; i++) {
  if (T.terrain[i] !== S.TERRAIN.PLAIN) continue;
  const state = S.World.states[T.state[i]];
  if (!state || state.type !== 'birth') continue;
  const lv = T.lvl[i] || 1;
  counts[lv]++;
  total++;
}

const pct = lv => counts[lv] / Math.max(1, total);
const low = pct(1) + pct(2) + pct(3) + pct(4);

console.log('Birth-state land distribution:', counts.slice(1).map((n, i) => (i + 1) + '級=' + (n / total * 100).toFixed(1) + '%').join(' '));

assert.ok(total > 1000, '出生州平地樣本不足');
assert.ok(pct(6) >= 0.055 && pct(6) <= 0.085, '6級地應約7%，不可過多');
assert.ok(pct(7) >= 0.020 && pct(7) <= 0.040, '7級地應約3%，不可過多');
assert.ok(low >= 0.70, '1~4級應佔出生州大多數');
assert.ok(pct(6) < pct(5), '6級應少於5級');
assert.ok(pct(7) < pct(6), '7級應少於6級');

console.log('Land distribution OK: birth states stay low-level heavy with reduced Lv6/Lv7');
