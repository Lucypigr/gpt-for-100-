'use strict';
const { load } = require('./load');
const S = load();
const { Game, World, CFG, RateEarthSystems } = S;
function ok(v, m) { if (!v) throw new Error(m); }
function near(a, b, eps, m) { if (Math.abs(a - b) > (eps || 1e-6)) throw new Error((m || 'not near') + ': ' + a + ' vs ' + b); }

// 公開可核對的天氣倍率
near(RateEarthSystems.WEATHER.light_snow.march, 1.05, 1e-9, '小雪行軍');
near(RateEarthSystems.WEATHER.mid_snow.march, 1.08, 1e-9, '中雪行軍');
near(RateEarthSystems.WEATHER.heavy_snow.march, 1.10, 1e-9, '大雪行軍');
near(RateEarthSystems.WEATHER.mid_rain.build, 1.05, 1e-9, '中雨築城');
near(RateEarthSystems.WEATHER.heavy_rain.build, 1.10, 1e-9, '大雨築城');
ok(RateEarthSystems.seasonForDay(0).id === 'spring' && RateEarthSystems.seasonForDay(3).id === 'winter', '四季循環錯誤');

RateEarthSystems.installGamePatches();
Game.newGame({ seed: 24680, userName: '天時測試', aiCount: 20 });
const p = Game.P[Game.G.userId], team = p.teams[0];
let target = -1;
for (let i = 0; i < World.N * World.N; i++) {
  if (Game.attackBlock(p, i) === '') { target = i; break; }
}
ok(target >= 0, '找不到可出征測試地塊');

// 春季：部隊行動體力實際只扣原成本 50%
const h = Game.heroByUid(p, team.slots[0]);
const beforeSta = Game.getSta(h);
const sent = Game.send(p, 0, target, 'attack');
ok(sent.ok, '春季測試出征失敗: ' + (sent.msg || ''));
near(Game.getSta(h), beforeSta - CFG.COST_ATTACK * 0.5, 1e-6, '春季體力減耗');

// 偵查必須能在真正交戰前取得守軍隊伍、兵種與兵力
const intel = RateEarthSystems.scoutData(target);
ok(intel.groups.length > 0, '偵查沒有回傳守軍');
ok(intel.groups[0].units.length > 0, '偵查沒有回傳配將');
ok(intel.groups[0].units.every(u => u.troops >= 0 && u.troop), '偵查缺少兵力/兵種');

// 冬季：攻城耐久傷害從結算源頭減半
Game.G.time = 0;
const springSiege = CFG.siegeValue(1000, 10);
Game.G.time = 3 * 1440;
const winterSiege = CFG.siegeValue(1000, 10);
near(winterSiege, springSiege * 0.5, 1e-6, '冬季耐久減傷');

console.log('Rate-earth systems OK: scout + weather values + spring/winter season effects');
