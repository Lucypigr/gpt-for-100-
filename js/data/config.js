// 遊戲常數與規則表
'use strict';

var CFG = {
  MAP_GEN_VER: 2,            // 地圖生成版本（新賽季使用）
  MAP_N: 300,               // 地圖邊長（格），150 位 AI 的標準大小
  // AI 越多地圖越大：維持每位主公可用面積約與 150 位時相同
  mapSizeFor: function (aiCount) { return aiCount <= 150 ? 300 : Math.round(300 * Math.sqrt((aiCount + 1) / 151) / 10) * 10; },
  AI_COUNT: 150,            // AI 玩家數
  TICK_MIN: 1,              // 模擬步長（遊戲分鐘）
  BASE_SPEED: 1,            // 1 真實秒 = 1 遊戲分鐘
  SEASON_DAYS: 30,          // 賽季天數
  HEGEMONY_HOLD_MIN: 48 * 60, // 佔領洛陽持續時間即達成霸業
  PHASES: [                 // 賽季進程（天）
    { day: 0, key: 'kaihuang', name: '開荒期', desc: '發展內政、佔領土地、招募武將。主城受新手保護。' },
    { day: 3, key: 'zhouzhan', name: '州戰期', desc: '出生州關口開放，可攻打關口進入資源州。主城保護解除。' },
    { day: 8, key: 'sili', name: '司隸開放', desc: '司隸關口開放，群雄逐鹿中原。' },
    { day: 14, key: 'luoyang', name: '洛陽爭霸', desc: '洛陽開放攻打，佔領洛陽並堅守 48 小時者成就霸業！' },
  ],
  PROTECT_DAYS: 3,          // 主城新手保護
  RES: ['wood', 'iron', 'stone', 'grain'],
  RES_NAME: { wood: '木材', iron: '鐵礦', stone: '石料', grain: '糧草' },
  RES_SHORT: { wood: '木', iron: '鐵', stone: '石', grain: '糧' },
  // 土地每小時產量（依等級）
  LAND_OUTPUT: [0, 100, 150, 280, 420, 560, 720, 880, 1050, 1250],
  CITY_BASE_OUTPUT: 300,    // 主城基礎產量（四資源各）
  // 名望：佔領土地首次 +level*FAME_PER_LVL
  FAME_PER_LVL: 30,
  landCap: function (fame) { return Math.min(300, 10 + Math.floor(fame / 150)); },
  // 體力
  STAMINA_MAX: 120,
  STAMINA_REGEN_H: 20,
  COST_ATTACK: 20,
  COST_MOVE: 5,
  COST_GARRISON: 5,
  // 武將
  HERO_MAX_LV: 50,
  expNeed: function (lv) { return Math.floor(60 + 28 * Math.pow(lv, 2.05)); },
  heroTroopCap: function (lv, barracksLv) { return 500 + lv * 190 + barracksLv * 200; },
  POINTS_PER_10LV: 10,
  // 征兵
  RECRUIT_COST: { wood: 0.5, iron: 0.5, grain: 1.0 }, // 每兵（再乘 cost/3）
  recruitRate: function (recruitLv) { return 45 * (1 + 0.15 * recruitLv); }, // 每遊戲分鐘每將
  // 預備兵：征兵需消耗預備兵，募兵所提高產量與上限
  RESERVE_START: 12000,
  reserveProd: function (recruitLv) { return 600 + 400 * recruitLv; },   // 每小時
  reserveCap: function (recruitLv) { return 20000 + 8000 * recruitLv; },
  // 傷兵：戰鬥損失兵力的一部分轉為傷兵，部隊在主城待命時自動治療
  WOUND_RATE: { win: 0.6, draw: 0.5, lose: 0.4 },
  HEAL_SPEED: 2,            // 治療速度 = 征兵速度 × 2
  HEAL_COST: 0.3,           // 治療每兵消耗 = 征兵消耗 × 0.3（不消耗預備兵）
  // 士氣：離出發地越遠士氣越低，士氣影響造成的傷害
  MORALE_FREE_TILES: 6,     // 6 格內不掉士氣
  MORALE_PER_TILE: 1.5,
  MORALE_MIN: 40,
  moraleAt: function (dist) { return Math.round(Math.max(this.MORALE_MIN, 100 - Math.max(0, dist - this.MORALE_FREE_TILES) * this.MORALE_PER_TILE)); },
  moraleDmg: function (m) { return 0.3 + 0.7 * m / 100; },
  // 戰法等級 1~10：效果 75%~100%；升級消耗戰法點
  SKILL_MAX_LV: 10,
  skillScale: function (lv) { return 0.75 + 0.25 * (Math.max(1, Math.min(10, lv || 10)) - 1) / 9; },
  SKILL_UP_BASE: { S: 60, A: 45, B: 30, C: 20, D: 15 },
  skillUpCost: function (q, lv) { return Math.round(this.SKILL_UP_BASE[q] * Math.pow(lv, 1.5) / 10) * 10; }, // lv → lv+1
  SKILL_REFUND: 0.5,        // 更換/遺忘戰法返還 50% 已投入戰法點
  SKP_START: 2000,
  DAILY_SKP: 800,
  CONVERT_PTS: [0, 100, 250, 600, 1500, 3500], // 依星級轉化戰法點（另加等級）
  // 演練：傳承取得的戰法需演練至 100% 才能使用
  INHERIT_PROG: { D: 100, C: 100, B: 100, A: 50, S: 25 },
  DRILL_PROG: [0, 5, 10, 20, 40, 70],          // 依素材星級增加演練進度
  // 覺醒：四星以上武將消耗 3 名閒置武將（星級 ≥ 本身星級 -1），立即開啟第三戰法欄、基礎屬性 +8%、額外 10 屬性點
  AWAKEN_MIN_STAR: 4,
  AWAKEN_FODDER: 3,
  AWAKEN_STAT: 0.08,
  AWAKEN_POINTS: 10,
  // 營帳：便宜、建得快的臨時前線駐地，24 小時後自動拆除
  CAMP_COST: { wood: 1500, iron: 500, stone: 1500, grain: 1000 },
  CAMP_BUILD_MIN: 10,
  CAMP_DUR: 800,
  CAMP_LIFE_MIN: 24 * 60,
  CAMP_MAX: 3,
  FORT_MAX: 2,
  // 分城：在 3×3 全為己方的土地上建造，可駐紮、征兵、治療傷兵，並提高產量
  BRANCH_COST: { wood: 20000, iron: 20000, stone: 30000, grain: 10000 },
  BRANCH_BUILD_MIN: 240,
  BRANCH_DUR: 6000,
  BRANCH_OUTPUT: 300,          // 每座分城四資源各 +300/時
  BRANCH_PALACE: 5,            // 需要君王殿等級
  branchMax: function (fame) { return fame >= 50000 ? 2 : fame >= 15000 ? 1 : 0; },
  // 遷城：把主城搬到 3×3 全為己方的土地
  RELOCATE_COST: { gold: 300, copper: 20000 },
  RELOCATE_CD_MIN: 24 * 60,
  // 屯田：派部隊到己方土地收取一次性資源（該地 3 小時產量），消耗 30 體力
  FARM_HOURS: 3,
  COST_FARM: 30,
  // 練兵：部隊在己方土地練兵 60 分鐘，每分鐘獲得經驗（依土地等級），消耗 20 體力
  TRAIN_MIN: 60,
  TRAIN_EXP: [0, 4, 8, 14, 24, 40, 55, 70, 85, 100],
  COST_TRAIN: 20,
  // 掃蕩：攻打己方土地的守軍賺經驗（不改變歸屬），消耗 20 體力
  COST_SWEEP: 20,
  // 行軍：每格分鐘數
  minPerTile: function (spd) { return 240 / (Math.max(20, spd) + 60); },
  // 攻城值
  siegeValue: function (troops, siege) { return troops * (1 + siege / 100) / 50; },
  // 統御
  BASE_COST_CAP: 8.0,
  // 卡包
  PACKS: [
    { key: 'gold', name: '名將卡包', price: { gold: 200 }, rates: [[5, 0.045], [4, 0.2], [3, 0.5], [2, 0.18], [1, 0.075]] },
    { key: 'gold5', name: '名將卡包·五連', price: { gold: 900 }, count: 5, rates: [[5, 0.045], [4, 0.2], [3, 0.5], [2, 0.18], [1, 0.075]] },
    { key: 'copper', name: '良將卡包', price: { copper: 6000 }, rates: [[5, 0.006], [4, 0.06], [3, 0.45], [2, 0.3], [1, 0.184]] },
  ],
  START_GOLD: 1200,
  DAILY_GOLD: 150,
  // 土地守軍：[部隊數, 每隊武將數, 武將等級, 每將兵力]
  GARRISON: [null,
    [1, 1, 3, 320],
    [1, 2, 6, 520],
    [1, 2, 10, 1150],
    [1, 3, 14, 1700],
    [1, 3, 20, 2900],
    [2, 3, 26, 3600],
    [2, 3, 32, 4400],
    [2, 3, 38, 5200],
    [2, 3, 42, 5800],
  ],
  // 城池：[部隊數, 武將等級, 每將兵力, 耐久]
  CITY_GARRISON: {
    5: [4, 28, 4600, 3500],
    6: [5, 33, 5600, 5000],
    7: [6, 38, 6600, 9000],
    8: [8, 42, 7600, 14000],
    9: [10, 46, 8800, 30000],
    10: [12, 50, 10500, 60000],
  },
  CITY_TYPE_NAME: { county: '縣城', commandery: '郡城', capital: '州府', luoyang: '都城', pass: '關口', main: '主城', fort: '要塞', camp: '營帳', branch: '分城' },
  CITY_POINTS: { county: 10, commandery: 30, capital: 100, luoyang: 500, pass: 20 },
  GARRISON_RESET_MIN: 60,   // 60 分鐘內未拆完耐久，守軍恢復
  DUR_REGEN_PCT_H: 0.02,
  FORT_COST: { wood: 6000, iron: 3000, stone: 8000, grain: 2000 },
  FORT_BUILD_MIN: 60,
  FORT_DUR: 3000,
  ALLIANCE_MAX: 30,
  ALLIANCE_CREATE_COST: { copper: 10000 },
  CAPTURE_HOURS: 12,        // 淪陷持續
  TRIBUTE_PCT: 0.2,
};

// 建築
// req: 需要君王殿等級；max: 等級上限；eff: 效果說明
var BUILDINGS = [
  { key: 'palace', name: '君王殿', max: 10, req: 0, base: { wood: 900, iron: 600, stone: 1200 }, growth: 1.75, time: 12, timeG: 1.6, desc: '主城核心。提高其他建築等級上限、主城耐久與基礎產量。' },
  { key: 'lumber', name: '伐木場', max: 10, req: 1, base: { wood: 150, iron: 150, stone: 300 }, growth: 1.62, time: 4, timeG: 1.45, desc: '每級木材產量 +150/時' },
  { key: 'ironw', name: '煉鐵場', max: 10, req: 1, base: { wood: 300, iron: 100, stone: 300 }, growth: 1.62, time: 4, timeG: 1.45, desc: '每級鐵礦產量 +150/時' },
  { key: 'quarry', name: '採石場', max: 10, req: 1, base: { wood: 300, iron: 150, stone: 100 }, growth: 1.62, time: 4, timeG: 1.45, desc: '每級石料產量 +150/時' },
  { key: 'farm', name: '農場', max: 10, req: 1, base: { wood: 200, iron: 150, stone: 250 }, growth: 1.62, time: 4, timeG: 1.45, desc: '每級糧草產量 +150/時' },
  { key: 'house', name: '民居', max: 10, req: 1, base: { wood: 300, iron: 200, stone: 400 }, growth: 1.6, time: 5, timeG: 1.45, desc: '每級銅幣稅收 +250/時' },
  { key: 'warehouse', name: '倉庫', max: 10, req: 1, base: { wood: 400, iron: 300, stone: 500 }, growth: 1.6, time: 5, timeG: 1.45, desc: '提高資源儲存上限' },
  { key: 'drill', name: '校場', max: 4, req: 2, base: { wood: 1500, iron: 1500, stone: 2500 }, growth: 2.4, time: 15, timeG: 1.8, desc: '每級可多配置一支部隊（上限 5 支）' },
  { key: 'barracks', name: '兵營', max: 10, req: 3, base: { wood: 1200, iron: 1500, stone: 1500 }, growth: 1.6, time: 10, timeG: 1.45, desc: '每級武將帶兵上限 +200' },
  { key: 'recruit', name: '募兵所', max: 10, req: 2, base: { wood: 800, iron: 800, stone: 1000 }, growth: 1.6, time: 8, timeG: 1.45, desc: '每級征兵速度 +15%，預備兵產量 +400/時、上限 +8000' },
  { key: 'command', name: '統帥廳', max: 8, req: 3, base: { wood: 2000, iron: 2000, stone: 3000 }, growth: 1.8, time: 15, timeG: 1.5, desc: '每級部隊統御上限 +0.5' },
  { key: 'wall', name: '城牆', max: 10, req: 2, base: { wood: 800, iron: 600, stone: 1500 }, growth: 1.6, time: 8, timeG: 1.45, desc: '提高主城耐久與城防守軍' },
  { key: 'shangwu', name: '尚武營', max: 5, req: 5, base: { wood: 5000, iron: 6000, stone: 6000 }, growth: 1.9, time: 25, timeG: 1.5, desc: '所有武將攻擊 +4/級' },
  { key: 'tiebi', name: '鐵壁營', max: 5, req: 5, base: { wood: 5000, iron: 6000, stone: 6000 }, growth: 1.9, time: 25, timeG: 1.5, desc: '所有武將防禦 +4/級' },
  { key: 'junji', name: '軍機營', max: 5, req: 5, base: { wood: 5000, iron: 6000, stone: 6000 }, growth: 1.9, time: 25, timeG: 1.5, desc: '所有武將謀略 +4/級' },
  { key: 'jifeng', name: '疾風營', max: 5, req: 5, base: { wood: 5000, iron: 6000, stone: 6000 }, growth: 1.9, time: 25, timeG: 1.5, desc: '所有武將速度 +4/級' },
];
var BUILDING_BY_KEY = {};
for (const b of BUILDINGS) BUILDING_BY_KEY[b.key] = b;

function buildingCost(key, toLv) {
  const b = BUILDING_BY_KEY[key];
  const m = Math.pow(b.growth, toLv - 1);
  const c = {};
  for (const r in b.base) c[r] = Math.round(b.base[r] * m / 10) * 10;
  return c;
}
function buildingTime(key, toLv) {
  const b = BUILDING_BY_KEY[key];
  return Math.round(b.time * Math.pow(b.timeG, toLv - 1));
}
function buildingMaxAllowed(key, palaceLv) {
  const b = BUILDING_BY_KEY[key];
  if (key === 'palace') return b.max;
  if (palaceLv < b.req) return 0;
  if (b.max <= 5) return Math.min(b.max, Math.max(1, palaceLv - b.req + 1));
  return Math.min(b.max, palaceLv + 1);
}

// 新手任務（主線）
var QUESTS = [
  { id: 'q1', name: '初出茅廬', desc: '佔領 3 塊土地', check: p => p.landCount >= 3, reward: { wood: 800, iron: 800, stone: 800, grain: 800 } },
  { id: 'q2', name: '廣積糧', desc: '將農場升到 2 級', check: p => p.b.farm >= 2, reward: { grain: 1500, wood: 500 } },
  { id: 'q3', name: '招賢納士', desc: '招募一次武將', check: p => p.stats.draws >= 1, reward: { gold: 100 } },
  { id: 'q4', name: '擴張領土', desc: '佔領 10 塊土地', check: p => p.landCount >= 10, reward: { wood: 2000, iron: 2000, stone: 2000, grain: 2000 } },
  { id: 'q5', name: '點兵', desc: '將校場升到 1 級（第二支部隊）', check: p => p.b.drill >= 1, reward: { copper: 5000 } },
  { id: 'q6', name: '三級要地', desc: '佔領一塊 3 級以上土地', check: p => p.stats.maxLandLv >= 3, reward: { gold: 100, grain: 2000 } },
  { id: 'q7', name: '君臨', desc: '君王殿升到 3 級', check: p => p.b.palace >= 3, reward: { wood: 5000, stone: 5000 } },
  { id: 'q8', name: '結盟', desc: '加入或創建一個同盟', check: p => p.alliance >= 0, reward: { gold: 200 } },
  { id: 'q9', name: '五級要地', desc: '佔領一塊 5 級以上土地', check: p => p.stats.maxLandLv >= 5, reward: { gold: 200, iron: 5000 } },
  { id: 'q10', name: '百戰老兵', desc: '任一武將達到 20 級', check: p => p.heroes.some(h => h.lv >= 20), reward: { gold: 200 } },
  { id: 'q11', name: '擴張領土II', desc: '佔領 40 塊土地', check: p => p.landCount >= 40, reward: { wood: 8000, iron: 8000, stone: 8000, grain: 8000 } },
  { id: 'q12', name: '攻城略地', desc: '參與攻下一座城池', check: p => p.stats.cities >= 1, reward: { gold: 300 } },
  { id: 'q13', name: '六級要地', desc: '佔領一塊 6 級以上土地', check: p => p.stats.maxLandLv >= 6, reward: { gold: 300 } },
  { id: 'q14', name: '名震一方', desc: '名望達到 10000', check: p => p.fame >= 10000, reward: { gold: 500 } },
];

// 事件戰法：集齊指定武將（兌換時消耗，需未上陣）即可直接學會戰法，不需演練
var EVENT_SKILLS = [
  { id: 'ev_dashang', name: '江東群英', skill: 'o200198', heroes: ['魯肅', '丁奉', '韓當'] },
  { id: 'ev_shenbing', name: '河北雙雄', skill: 'o200204', heroes: ['顏良', '文醜', '田豐'] },
  { id: 'ev_biqi', name: '坐鎮許都', skill: 'o200194', heroes: ['于禁', '程昱', '曹洪'] },
  { id: 'ev_wuxin', name: '吳中宿將', skill: 'o200201', heroes: ['潘璋', '朱桓', '陳武'] },
  { id: 'ev_fanji', name: '冀州謀主', skill: 'o200220', heroes: ['沮授', '田豐', '甄姬'] },
  { id: 'ev_duanjin', name: '西涼盟約', skill: 'o200228', heroes: ['韓遂', '閻行', '董襲'] },
  { id: 'ev_yaoshu', name: '宮闈亂政', skill: 'o200237', heroes: ['張讓', '何進', '王允'] },
];
