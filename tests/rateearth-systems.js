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

// 特殊天氣：第一週不產生；公開的持續時間與災害延遲必須精確落在原規則。
for (let st = 0; st < World.states.length; st++) ok(RateEarthSystems.specialEventForState(6, st, Game.G.seed) === null, '第一週不應有特殊天氣');
const found = {};
for (let d = 7; d < 220; d++) for (let st = 0; st < World.states.length; st++) {
  const ev = RateEarthSystems.specialEventForState(d, st, Game.G.seed);
  if (ev && !found[ev.type]) found[ev.type] = ev;
}
for (const type of ['blizzard', 'freezing_rain', 'fog', 'storm']) ok(found[type], '未生成特殊天氣樣本: ' + type);
for (const type of Object.keys(found)) {
  const ev = found[type], def = RateEarthSystems.SPECIAL[type];
  ok(ev.end - ev.start >= def.durMin && ev.end - ev.start <= def.durMax, type + ' 持續時間超出公開範圍');
  ok(ev.hazardStart - ev.start === def.delay, type + ' 災害形成延遲錯誤');
  ok(ev.hazardEnd - ev.end === def.tail, type + ' 災害消退延遲錯誤');
}

// 災害實際規則：洪災封鎖土地指令；積雪封鎖屯田/練兵；大霧/冰凍/積雪士氣-10，洪災-20。
const flood = found.storm; Game.G.time = flood.hazardStart; ok(RateEarthSystems.hazardAt(flood.center).id === 'flood', '洪災未形成');
ok(/洪災/.test(RateEarthSystems.commandBlock(flood.center, 'attack')), '洪災應封鎖土地指令');
near(RateEarthSystems.adjustMorale(100, flood.center, true), 80, 1e-9, '洪災建築所屬部隊士氣');
near(RateEarthSystems.adjustMorale(100, flood.center, false), 100, 1e-9, '洪災不應對非建築領地套同一士氣狀態');
const snow = found.blizzard; Game.G.time = snow.hazardStart; ok(/積雪/.test(RateEarthSystems.commandBlock(snow.center, 'farm')), '積雪應封鎖屯田');
ok(/積雪/.test(RateEarthSystems.commandBlock(snow.center, 'train')), '積雪應封鎖練兵');
near(RateEarthSystems.adjustMorale(100, snow.center, false), 90, 1e-9, '積雪士氣');
near(RateEarthSystems.adjustMorale(100, snow.center, true), 100, 1e-9, '建築內不應套用積雪-10');
const fog = found.fog; Game.G.time = fog.hazardStart; near(RateEarthSystems.adjustMorale(100, fog.center, false), 90, 1e-9, '大霧士氣');
const ice = found.freezing_rain; Game.G.time = ice.hazardStart; near(RateEarthSystems.adjustMorale(100, ice.center, false), 90, 1e-9, '冰凍士氣');

console.log('Extreme weather OK: first-week guard + exact durations/delays + flood/snow/fog/ice effects');


// 風向/風力與風災：官方公開效果為風力>=4、屯田/練兵/計略耗時+30%、行軍距離上限50。
const winds = {};
for (let d = 7; d < 500 && (!winds.sandstorm || !winds.windstorm); d++) {
  for (let st = 0; st < World.states.length; st++) {
    const ev = RateEarthSystems.windEventForState(d, st, Game.G.seed);
    if (ev && !winds[ev.hazard]) winds[ev.hazard] = ev;
  }
}
ok(winds.sandstorm && winds.windstorm, '應能產生沙塵暴與風災樣本');
for (const k of ['sandstorm', 'windstorm']) {
  const ev = winds[k];
  ok(ev.wind.level >= 4, k + ' 風力應至少4級');
  ok(['clear','cloudy','overcast'].includes(RateEarthSystems.weatherIdFor(ev.day, ev.stateId, Game.G.seed)), k + ' 天氣條件錯誤');
  Game.G.time = ev.start;
  near(RateEarthSystems.actionTimeFactor(ev.center, 'train'), 1.30, 1e-9, k + ' 練兵風阻');
  near(RateEarthSystems.adjustMorale(100, ev.center, false), 80, 1e-9, k + ' 非建築領地士氣');
  near(RateEarthSystems.adjustMorale(100, ev.center, true), 100, 1e-9, k + ' 建築內不套用鼓餒旗靡');
}

// 江河凝凍：冬季豪雪/凍雨災害中的非州界河流可通行、可佔領，解凍後自動失去河面領地。
let frozen = null, freezeEv = null;
outer:
for (let d = 7; d < 500; d++) {
  for (let st = 0; st < World.states.length; st++) {
    const ev = RateEarthSystems.specialEventForState(d, st, Game.G.seed);
    if (!ev || (ev.hazard !== 'snow' && ev.hazard !== 'ice')) continue;
    Game.G.time = ev.hazardStart;
    const cx = World.X(ev.center), cy = World.Y(ev.center);
    for (let y = Math.max(0, cy - ev.radius); y <= Math.min(World.N - 1, cy + ev.radius); y++) {
      for (let x = Math.max(0, cx - ev.radius); x <= Math.min(World.N - 1, cx + ev.radius); x++) {
        const i = World.idx(x, y);
        if (Game.T.terrain[i] === S.TERRAIN.WATER && RateEarthSystems.isFrozenRiver(i)) {
          frozen = i; freezeEv = ev; break outer;
        }
      }
    }
  }
}
ok(frozen !== null, '找不到可凍結的非州界河流樣本');
ok(World.isPassable(frozen), '凍結河流應可通行');
Game.setOwner(frozen, p.id);
ok(Game.tileOwner(frozen) === p.id, '凍結河流應可佔領');
Game.G.time = freezeEv.hazardEnd + 1;
Game.G.rateEnv = Game.G.rateEnv || {};
Game.G.rateEnv.lastThawSweep = Game.G.time - 20;
Game.advance(1);
ok(Game.tileOwner(frozen) < 0, '解凍後河流領地應移除');

console.log('Wind/frozen-river OK: level-4 hazards +30%/50-rule data + winter river occupation/thaw');


// 太祝令／祭壇／祭風：盟主任命 -> 太祝令建壇 -> 符合天氣與風力條件時祈禳5小時風災。
Game.G.time = 8 * 1440;
p.copper = 20000;
if (p.alliance < 0) {
  const ca = Game.createAlliance(p, '天時盟');
  ok(ca.ok, '建立測試同盟失敗');
}
const a = Game.G.alliances[p.alliance];
ok(RateEarthSystems.appointWeatherOfficer(p, p.id).ok, '盟主應可任命自己為太祝令');
ok(RateEarthSystems.isWeatherOfficer(p), '太祝令身份未生效');

let altarTile = -1;
for (let y = Math.max(1, World.Y(p.cityTile) - 4); y <= Math.min(World.N - 2, World.Y(p.cityTile) + 4) && altarTile < 0; y++) {
  for (let x = Math.max(1, World.X(p.cityTile) - 4); x <= Math.min(World.N - 2, World.X(p.cityTile) + 4); x++) {
    const i = World.idx(x, y);
    if (Game.T.city[i] < 0 && World.isPassable(i)) { altarTile = i; break; }
  }
}
ok(altarTile >= 0, '找不到祭壇測試空地');
Game.setOwner(altarTile, p.id);
const ba = RateEarthSystems.buildAltar(p, altarTile);
ok(ba.ok && ba.city.rateAltar, '太祝令應可在自己空地建祭壇');
ok(RateEarthSystems.activeAltar(a).id === ba.city.id, '同盟祭壇未登記');

let prayerTarget = -1;
for (let d = 8; d < 60 && prayerTarget < 0; d++) {
  Game.G.time = d * 1440;
  for (let i = 0; i < World.N * World.N; i++) {
    const w = RateEarthSystems.weatherAt(i), wd = RateEarthSystems.windAt(i);
    if (['clear','cloudy','overcast'].includes(w.id) && wd.level >= 2 && !RateEarthSystems.prayerAt(i)) { prayerTarget = i; break; }
  }
}
ok(prayerTarget >= 0, '找不到可祭風的天時條件');
const pw = RateEarthSystems.prayWind(p, prayerTarget);
ok(pw.ok, '祭風應成功: ' + (pw.msg || ''));
ok(pw.event.end - pw.event.start === 300, '祭風公開持續時間應為5小時');
ok(RateEarthSystems.hazardAt(prayerTarget).id === 'windstorm', '祭風應立即套用風災效果');
near(RateEarthSystems.actionTimeFactor(prayerTarget, 'train'), 1.30, 1e-9, '祭風風阻練兵時間');
ok(RateEarthSystems.garrisonCovers(prayerTarget, prayerTarget), '風災下駐守中心格仍應生效');

let adj = -1;
const px = World.X(prayerTarget), py = World.Y(prayerTarget);
for (let dy = -1; dy <= 1 && adj < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
  if (!dx && !dy) continue;
  if (World.inb(px + dx, py + dy)) { adj = World.idx(px + dx, py + dy); break; }
}
ok(adj >= 0, '找不到祭風鄰格');
ok(!RateEarthSystems.garrisonCovers(prayerTarget, adj), '風災「自顧不暇」應把駐守保護縮至中心一格');

Game.G.time = pw.event.end + 1;
ok(RateEarthSystems.garrisonCovers(prayerTarget, adj), '無風災時駐守應恢復九宮格保護');
console.log('Prayer/altar OK: Taizhuling appointment + altar + exact 5h wind prayer + garrison disruption');
