'use strict';
const { load } = require('./load');
const { HEROES, SKILLS, TACTIC_RECOMMENDATIONS } = load();

function ok(v,m){ if(!v) throw new Error(m); }

const target = HEROES.filter(h => h.star >= 3 && h.star <= 5);
ok(target.length === 97, '預期 3~5 星武將共 97 人，實際 '+target.length);

const missing = [];
for (const h of target) {
  const recs = TACTIC_RECOMMENDATIONS.forHero(h);
  if (!recs.length) { missing.push(h.name); continue; }
  ok(recs.length >= 3, h.name+' 推薦戰法少於 3 個');
  const seen = new Set();
  for (const r of recs) {
    ok(SKILLS[r.id], h.name+' 推薦不存在戰法 '+r.id);
    ok(r.id !== h.skill, h.name+' 不應推薦自己的自帶戰法');
    ok(!seen.has(r.id), h.name+' 推薦戰法重複 '+r.id);
    seen.add(r.id);
    ok(r.reason && r.reason.length >= 8, h.name+' 缺少推薦原因');
    const sk = SKILLS[r.id];
    ok(!sk.troops || sk.troops.includes(h.troop), h.name+' 推薦兵種不符 '+sk.name);
  }
}
ok(!missing.length, '缺少推薦：'+missing.join('、'));
ok(!TACTIC_RECOMMENDATIONS.allCovered().length, 'allCovered 應為空');

const five = target.filter(h=>h.star===5);
const uncuratedFive = five.filter(h=>!TACTIC_RECOMMENDATIONS.isCurated(h));
ok(!uncuratedFive.length, '五星尚未逐人精修：'+uncuratedFive.map(h=>h.name).join('、'));

const counts = [3,4,5].map(star => [star, target.filter(h=>h.star===star).length]);
console.log('Tactic recommendations OK:', counts.map(x=>x[0]+'★ '+x[1]).join(', '), 'total', target.length);
