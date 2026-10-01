'use strict';
const { load } = require('./load');
const S = load();
const { Game, AI } = S;
function ok(v,m){ if(!v) throw new Error(m); }
function eq(a,b,m){ if(a!==b) throw new Error((m||'not equal')+': '+a+' vs '+b); }

const G = Game.newGame({ seed: 24681357, userName:'人格測試', aiCount:40 });
const ais = Game.P.filter(p=>p.ai).slice(0,4);
ok(ais.length>=4,'AI數量不足');

// 10 個人格維度必須在新局生成，且能形成可讀作風。
for(const p of ais){
  const t=AI.traits(p);
  eq(AI.TRAIT_KEYS.length,10,'人格維度數量');
  for(const k of AI.TRAIT_KEYS) ok(Number.isFinite(t[k])&&t[k]>=0&&t[k]<=100,'人格維度無效 '+k);
  ok(AI.styleSummary(p).length>0,'缺少作風摘要');
  ok(AI.reputationSummary(p).length>0,'缺少聲譽摘要');
}

// 建立三個同盟，固定相同軍力，用人格差異比較宣戰/背刺傾向。
for(const p of ais.slice(0,3)){ p.copper=50000; p.alliance=-1; }
const aa=Game.createAlliance(ais[0],'激進盟').alliance;
const ab=Game.createAlliance(ais[1],'保守盟').alliance;
const at=Game.createAlliance(ais[2],'目標盟').alliance;
aa.power=ab.power=at.power=100000;

Object.assign(AI.traits(ais[0]),{
  aggressive:92,cautious:18,deceitful:45,diplomatic:25,warlike:94,vengeful:65,honorable:45,opportunistic:75,courageous:90,ambitious:88
});
Object.assign(AI.traits(ais[1]),{
  aggressive:18,cautious:94,deceitful:12,diplomatic:92,warlike:15,vengeful:25,honorable:95,opportunistic:22,courageous:24,ambitious:28
});
const sAgg=AI.warIntentScore(aa,at,ais[0]);
const sCau=AI.warIntentScore(ab,at,ais[1]);
ok(sAgg>sCau+45,'激進/好戰 AI 的宣戰意願應明顯高於保守外交 AI');

// 同一份協議壓力下，陰險投機 AI 應比重信用 AI 更願意背刺。
Object.assign(AI.traits(ais[0]),{deceitful:95,opportunistic:95,honorable:8,warlike:80,ambitious:85,cautious:20});
Object.assign(AI.traits(ais[1]),{deceitful:8,opportunistic:20,honorable:98,warlike:20,ambitious:30,cautious:75});
at.enemy=999; // 模擬目標正在多線作戰
AI.makePact(aa,at,'nap',600,ais[0]);
AI.makePact(ab,at,'nap',600,ais[1]);
const bsDirty=AI.backstabIntentScore(aa,at,ais[0]);
const bsHonor=AI.backstabIntentScore(ab,at,ais[1]);
ok(bsDirty>bsHonor+55,'陰險投機 AI 的背刺意願應顯著高於重信用 AI');

// 每對勢力記憶：trust/grudge/betrayal/cooperation/lastInteraction 都要存在並會更新。
const ar=AI.allianceMemory(aa,at);
for(const k of ['trust','grudge','betrayals','cooperation','lastInteraction']) ok(k in ar,'同盟記憶缺欄位 '+k);
const pr=AI.personMemory(ais[0],ais[2].id);
for(const k of ['trust','grudge','betrayals','cooperation','lastInteraction']) ok(k in pr,'個人記憶缺欄位 '+k);
const g0=pr.grudge;
AI.rememberHarm(ais[0],ais[2],20,'test-conflict');
ok(pr.grudge>g0 && pr.lastInteraction===Game.G.time,'記仇/互動時間未更新');
const coop0=pr.cooperation;
AI.rememberHelp(ais[0],ais[2],10,'test-help');
ok(pr.cooperation>coop0,'合作記憶未更新');

// 存讀檔後人格與外交記憶必須完全保留。
const profileBefore=JSON.stringify(Game.P.map(p=>p.ai?{id:p.id,traits:p.prof.traits,reputation:p.prof.reputation}:null));
const dipBefore=JSON.stringify(aa.diplomacy);
const peopleBefore=JSON.stringify(ais[0].aiMem.people);
const save=Game.serialize();
Game.deserialize(save);
const profileAfter=JSON.stringify(Game.P.map(p=>p.ai?{id:p.id,traits:p.prof.traits,reputation:p.prof.reputation}:null));
eq(profileAfter,profileBefore,'存讀檔後人格改變');
const aa2=Game.G.alliances[aa.id];
eq(JSON.stringify(aa2.diplomacy),dipBefore,'存讀檔後同盟外交記憶改變');
eq(JSON.stringify(Game.P[ais[0].id].aiMem.people),peopleBefore,'存讀檔後個人外交記憶改變');

console.log('AI personality OK: 10 traits + distinct war/backstab choices + persistent pair memories');