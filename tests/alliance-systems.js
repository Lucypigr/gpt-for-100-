'use strict';
const { load } = require('./load');
const S = load();
const { Game, World, CFG, RateAllianceSystems } = S;
function ok(v, m) { if (!v) throw new Error(m); }
function eq(a,b,m){ if(a!==b) throw new Error((m||'not equal')+': '+a+' vs '+b); }
function near(a,b,e,m){ if(Math.abs(a-b)>(e||1e-9)) throw new Error((m||'not near')+': '+a+' vs '+b); }

Game.newGame({ seed: 97531, userName: '盟制測試', aiCount: 30 });
const p = Game.P[Game.G.userId];
ok(p.copper >= CFG.ALLIANCE_CREATE_COST.copper, '新開局銅幣應足以建立同盟');
const startCopper = p.copper;
const ca = Game.createAlliance(p, '測試盟');
ok(ca.ok, '建立同盟失敗');
eq(p.copper, startCopper - CFG.ALLIANCE_CREATE_COST.copper, '建立同盟扣款錯誤');
const a = ca.alliance;
RateAllianceSystems.ensureAlliance(a);

// 官職：盟主、副盟主、最多2名指揮官，三者具有軍令權限。
const free = Game.P.filter(q => q.id !== p.id && q.alliance < 0).slice(0, 5);
ok(free.length >= 5, '測試玩家不足');
for (const q of free.slice(0,4)) ok(Game.joinAlliance(q, a.id, true).ok, '強制入盟失敗');
ok(RateAllianceSystems.appoint(p, free[0].id, 'deputy').ok, '任命副盟主失敗');
ok(RateAllianceSystems.appoint(p, free[1].id, 'commander').ok, '任命指揮官1失敗');
ok(RateAllianceSystems.appoint(p, free[2].id, 'commander').ok, '任命指揮官2失敗');
ok(!RateAllianceSystems.appoint(p, free[3].id, 'commander').ok, '第三名指揮官不應成功');
eq(RateAllianceSystems.roleName(free[0], a), '副盟主', '副盟主名稱');
eq(RateAllianceSystems.roleName(free[1], a), '指揮官', '指揮官名稱');
ok(RateAllianceSystems.canCommand(p,a) && RateAllianceSystems.canCommand(free[0],a) && RateAllianceSystems.canCommand(free[1],a), '軍令權限錯誤');

// 捐獻 -> 貢獻 -> 同盟等級 -> 全盟加成。
p.res.wood = 300000;
const beforeWood = p.res.wood, beforeLv = a.level;
const dn = RateAllianceSystems.donate(p, 'wood', 100000);
ok(dn.ok, '同盟捐獻失敗');
eq(p.res.wood, beforeWood - 100000, '捐獻未扣資源');
ok((a.contrib[p.id] || 0) >= 100000, '個人貢獻未累積');
ok(a.level > beforeLv, '大量捐獻應推進同盟等級');
ok(RateAllianceSystems.levelBonus(a) > 0, '同盟等級應提供資源加成');

// 攻城值：不再按兵力換算；1攻城=1耐久，兵力只決定該武將是否仍存活。
near(CFG.siegeValue(1, 25), 25, 1e-9, '低兵力攻城');
near(CFG.siegeValue(10000, 25), 25, 1e-9, '高兵力不應放大攻城');
near(CFG.siegeValue(0, 25), 0, 1e-9, '零兵力不能攻城');
const t0 = p.teams[0];
ok(RateAllianceSystems.siegeOfTeam(p,t0) >= 0, '部隊攻城值計算失敗');

// 淪陷：原盟失去借地，上級同盟可借地；原盟未淪陷盟友可攻主城解救。
const victim = free[3];
const enemy = free[4];
enemy.copper = 50000;
const ea = Game.createAlliance(enemy, '敵軍盟');
ok(ea.ok, '敵方同盟建立失敗');
victim.captor = enemy.id; victim.capturedAt = Game.G.time; victim.captureEnd = 0;
Game.recompute(victim);
ok(!Game.isFriendly(p, victim.cityTile), '淪陷後原盟不應借用俘虜領地');
ok(Game.isFriendly(enemy, victim.cityTile), '上級勢力應可借用俘虜領地');
ok(RateAllianceSystems.canRescue(p, victim), '原盟盟友應可解救');
near(Game.allianceBonus(victim), 0, 1e-9, '淪陷者不應享有同盟加成');

// 反叛：需求依產量計算（本作透明近似），成功後解除淪陷。
const rc = RateAllianceSystems.rebellionCost(victim);
for (const r of CFG.RES) victim.res[r] = rc[r] + 5000;
ok(RateAllianceSystems.rebel(victim).ok, '反叛應成功');
eq(victim.captor, -1, '反叛未解除淪陷');

// 淪陷中可以退盟，但不會因此解除淪陷；之後不能直接再入盟。
victim.captor = enemy.id; victim.capturedAt = Game.G.time;
ok(Game.leaveAlliance(victim).ok, '淪陷中應可退出同盟');
eq(victim.captor, enemy.id, '退盟不應解除淪陷');
ok(!Game.joinAlliance(victim, a.id, true).ok, '淪陷中不可重新加入同盟');
victim.alliance = a.id; if (!a.members.includes(victim.id)) a.members.push(victim.id);
victim.captor = -1; victim.capturedAt = 0;

// 流浪：保留80%四資源、放棄普通同盟、領地上限30；可建立義勇軍。
victim.captor = enemy.id; victim.capturedAt = Game.G.time;
for (const r of CFG.RES) victim.res[r] = 10000;
victim.b.palace = Math.max(6, victim.b.palace);
victim.copper = 10000;
const state = World.states.find(s => s.type === 'birth');
ok(state, '找不到出生州');
const rr = RateAllianceSystems.roam(victim, state.id);
ok(rr.ok, '流浪重生失敗: ' + (rr.msg || ''));
ok(victim.wanderer, '未標記流浪軍');
eq(victim.alliance, -1, '流浪軍應退出普通同盟');
for (const r of CFG.RES) eq(victim.res[r], 8000, '流浪保留80%資源 ' + r);
Game.recompute(victim);
eq(victim.landCap, 30, '流浪軍領地上限');
for (const r of CFG.RES) eq(victim.prod[r], 0, '流浪軍不應取得四資源被動產量 '+r);

const mil = RateAllianceSystems.createMilitia(victim, '義勇測試');
ok(mil.ok, '建立義勇軍失敗: ' + (mil.msg || ''));
eq(victim.copper, 5000, '建立義勇軍應花5000銅幣');
eq(RateAllianceSystems.MILITIA_MAX, 50, '義勇軍上限應為50');

// 2019更新後可跨州加入義勇軍。
enemy.alliance = -1; enemy.wanderer = true; enemy.militia = -1;
const otherState = World.states.find(s => s.type === 'birth' && s.id !== victim.state);
if (otherState) enemy.state = otherState.id;
ok(RateAllianceSystems.joinMilitia(enemy, mil.militia.id).ok, '跨州流浪軍應可加入義勇軍');
ok(RateAllianceSystems.friendOverride(victim, enemy) === true, '義勇軍成員應共享連地');

// 流浪軍攻破主城：掠走80%持有資源、守方倉庫歸零、24小時內不可重複掠奪。
const target = Game.P.find(q => q.id !== victim.id && q.id !== enemy.id && !q.wanderer);
for (const r of CFG.RES) target.res[r] = 10000;
const beforeLoot = {};
for (const r of CFG.RES) beforeLoot[r] = victim.res[r] || 0;
const pl = RateAllianceSystems.wandererLootMain(target, victim);
ok(pl.ok && !pl.cooldown, '首次主城掠奪應成功');
for (const r of CFG.RES) {
  eq(target.res[r], 0, '被掠奪方倉庫應歸零 '+r);
  ok((victim.res[r] || 0) >= beforeLoot[r], '流浪軍未獲得掠奪資源 '+r);
}
ok(target.plunderedUntil - Game.G.time === 1440, '主城掠奪保護應為24小時');
ok(RateAllianceSystems.wandererLootMain(target, victim).cooldown, '24小時內不應重複掠奪');

console.log('Alliance systems OK: roles + donation/level + capture/rescue/rebellion + wanderer/militia + exact siege stat');