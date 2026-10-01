// 率土同盟擴充：官職、捐獻/同盟等級、淪陷/反叛/流浪、義勇軍、攻城隊
// 原則：能由公開資料核對的規則照原作；未公開的經驗表/百分比以本作縮放值標示，不冒充官方數字。
'use strict';

var RateAllianceSystems = (function () {
  const ROLE_NAME = { leader: '盟主', deputy: '副盟主', commander: '指揮官', officer: '官員', member: '盟員' };
  const MAX_COMMANDERS = 2;          // 公開版本：指揮官最多 2 名
  const MILITIA_MAX = 50;            // 2019 官方更新後：義勇軍上限 50 勢力
  const ROAM_KEEP = 0.80;            // 流浪軍保留原有資源 80%
  const LAND_LOSS_PCT = 0.10;        // 原作僅公開「隨機丟失部分領地」；本作採 10% 模擬，非官方比例
  const CAPTURE_LOOT_PCT = 0.10;     // 原作僅公開「掠奪部分倉庫資源」；本作採 10% 模擬，非官方比例
  let installed = false;

  function ok(o) { return Object.assign({ ok: true }, o || {}); }
  function err(msg) { return { ok: false, msg }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function ensureGlobal() {
    if (!Game.G.militias) Game.G.militias = [];
    return Game.G;
  }
  function ensureAlliance(a) {
    if (!a) return null;
    if (a.level === undefined) a.level = 1;
    if (a.exp === undefined) a.exp = 0;
    if (!a.contrib) a.contrib = {};
    if (!a.offices) a.offices = { deputy: -1, commanders: [], officers: [] };
    if (a.offices.deputy === undefined) a.offices.deputy = -1;
    if (!Array.isArray(a.offices.commanders)) a.offices.commanders = [];
    if (!Array.isArray(a.offices.officers)) a.offices.officers = [];
    return a;
  }
  function allianceOf(p) { return p && p.alliance >= 0 ? ensureAlliance(Game.G.alliances[p.alliance]) : null; }

  // 公開資料確認「捐獻/戰鬥 -> 同盟等級 -> 全盟資源產量提升」，但沒有公開完整逐級經驗表與倍率。
  // 這兩個數字是本作縮放值，只負責把原作機制落地，不宣稱為官方數值。
  function xpNeed(level) { return 1000 * Math.max(1, level); }
  function levelBonus(a) {
    a = ensureAlliance(a);
    return a ? Math.min(0.10, Math.max(0, a.level - 1) * 0.005) : 0;
  }
  function addAllianceExp(a, exp) {
    a = ensureAlliance(a);
    if (!a || !(exp > 0)) return 0;
    a.exp += exp;
    let raised = 0;
    while (a.level < 30 && a.exp >= xpNeed(a.level)) {
      a.exp -= xpNeed(a.level);
      a.level++;
      raised++;
    }
    if (raised) {
      Game.sysAlly(a.id, '【同盟升級】同盟升至 ' + a.level + ' 級，全盟資源產出加成提升。');
      for (const id of a.members) if (Game.P[id]) Game.recompute(Game.P[id]);
    }
    return raised;
  }
  function donate(p, res, amount) {
    const a = allianceOf(p);
    if (!a) return err('需先加入同盟');
    if (p.captor >= 0) return err('淪陷期間無法進行同盟捐獻');
    if (!CFG.RES.includes(res)) return err('無效資源');
    amount = Math.floor(+amount || 0);
    if (amount <= 0) return err('請輸入捐獻數量');
    if ((p.res[res] || 0) < amount) return err('資源不足');
    p.res[res] -= amount;
    // 本作換算：每 100 資源 = 1 同盟經驗；原作完整換算表未公開。
    const exp = Math.max(1, Math.floor(amount / 100));
    a.contrib[p.id] = (a.contrib[p.id] || 0) + amount;
    const raised = addAllianceExp(a, exp);
    Game.sysAlly(a.id, '【捐獻】' + p.name + ' 捐獻 ' + CFG.RES_NAME[res] + ' ' + amount + '，貢獻 +' + amount + (raised ? '，同盟升級！' : ''));
    return ok({ exp, contribution: a.contrib[p.id], raised });
  }

  function roleOf(p, a) {
    a = ensureAlliance(a || allianceOf(p));
    if (!p || !a) return 'member';
    if (a.leader === p.id) return 'leader';
    if (a.offices.deputy === p.id) return 'deputy';
    if (a.offices.commanders.includes(p.id)) return 'commander';
    if (a.offices.officers.includes(p.id)) return 'officer';
    return 'member';
  }
  function roleName(p, a) { return ROLE_NAME[roleOf(p, a)] || '盟員'; }
  function canCommand(p, a) {
    const r = roleOf(p, a);
    return r === 'leader' || r === 'deputy' || r === 'commander';
  }
  function clearOffice(a, pid) {
    a = ensureAlliance(a);
    if (a.offices.deputy === pid) a.offices.deputy = -1;
    a.offices.commanders = a.offices.commanders.filter(id => id !== pid);
    a.offices.officers = a.offices.officers.filter(id => id !== pid);
  }
  function appoint(p, pid, role) {
    const a = allianceOf(p);
    if (!a) return err('需先加入同盟');
    if (a.leader !== p.id) return err('只有盟主可以任命同盟官職');
    pid = +pid;
    if (!a.members.includes(pid)) return err('只能任命本盟成員');
    if (pid === a.leader) return err('盟主不能變更為其他官職');
    if (!['deputy','commander','officer','member'].includes(role)) return err('無效官職');
    clearOffice(a, pid);
    if (role === 'deputy') {
      const old = a.offices.deputy;
      if (old >= 0 && old !== pid) clearOffice(a, old);
      a.offices.deputy = pid;
    } else if (role === 'commander') {
      if (a.offices.commanders.length >= MAX_COMMANDERS) return err('指揮官最多 ' + MAX_COMMANDERS + ' 名');
      a.offices.commanders.push(pid);
    } else if (role === 'officer') {
      a.offices.officers.push(pid);
    }
    const q = Game.P[pid];
    if (q) q.role = role === 'member' ? 0 : 1;
    Game.sysAlly(a.id, '【官職】' + (q ? q.name : '成員') + (role === 'member' ? ' 已卸任官職' : ' 被任命為' + ROLE_NAME[role]) + '。');
    return ok({ role });
  }

  function capturingSideOf(victim) {
    if (!victim || victim.captor < 0) return null;
    const cp = Game.P[victim.captor];
    return cp || null;
  }
  function friendOverride(p, owner) {
    if (!p || !owner) return null;
    if (p.captor >= 0) return false; // 淪陷勢力失去原同盟借地/連地能力
    if (owner.captor >= 0) {
      const cp = capturingSideOf(owner);
      if (p.id === owner.captor) return true;
      if (cp && cp.alliance >= 0 && p.alliance === cp.alliance) return true; // 上級同盟可借俘虜土地
      if (owner.alliance >= 0 && p.alliance === owner.alliance) return false; // 原盟暫失連地
    }
    if (p.wanderer && owner.wanderer && p.militia >= 0 && p.militia === owner.militia) return true;
    return null;
  }
  function canRescue(p, victim) {
    return !!(p && victim && victim.captor >= 0 && p.id !== victim.id && p.captor < 0 &&
      victim.alliance >= 0 && p.alliance === victim.alliance);
  }
  function capturedAllyLandBlock(p, tile) {
    const o = Game.tileOwner(tile);
    if (o < 0) return '';
    const v = Game.P[o];
    if (!canRescue(p, v)) return '';
    const cid = Game.T.city[tile];
    if (cid >= 0 && World.cities[cid].type === 'main') return '';
    return '盟友正處於淪陷狀態；請攻打其主城進行解救';
  }

  function releaseCaptive(victim, reason, helper) {
    if (!victim || victim.captor < 0) return err('目前未處於淪陷狀態');
    victim.captor = -1;
    victim.captureEnd = 0;
    victim.capturedAt = 0;
    victim.protectEnd = Math.max(victim.protectEnd || 0, Game.G.time + 120);
    Game.recompute(victim);
    if (victim.id === Game.G.userId) Game.notify(victim.id, reason === 'rescue' ? '盟友已解救你的主城，淪陷狀態解除！' : '反叛成功，已脫離淪陷！', 'good');
    if (helper) Game.sys('world', '【解救】' + helper.name + ' 解救了 ' + victim.name + '，其勢力脫離淪陷。');
    return ok();
  }
  function onCaptured(victim, attacker) {
    if (!victim || !attacker) return;
    victim.capturedAt = Game.G.time;
    victim.captureEnd = 0; // 原作淪陷不是固定12小時自動結束
    // 經典同盟規則：盟主主城被淪陷時，同盟其他未淪陷成員一併進入淪陷/附屬關係。
    if (victim.alliance >= 0) {
      const va = Game.G.alliances[victim.alliance];
      if (va && va.leader === victim.id) {
        for (const id of va.members) {
          const q = Game.P[id];
          if (!q || q.id === victim.id || q.captor >= 0) continue;
          q.captor = attacker.id; q.captureEnd = 0; q.capturedAt = Game.G.time;
          Game.recompute(q);
          if (q.id === Game.G.userId) Game.notify(q.id, '盟主淪陷，你也隨同同盟進入淪陷狀態。', 'bad');
        }
      }
    }
    // 隨機失去「部分領地」：公開規則沒有給出固定比例，本作以10%模擬。
    const lands = victim.lands.filter(i => Game.T.city[i] < 0);
    const lose = Math.min(lands.length, Math.max(0, Math.ceil(lands.length * LAND_LOSS_PCT)));
    for (let k = 0; k < lose; k++) {
      const pos = Math.floor(U.rnd() * lands.length);
      const i = lands.splice(pos, 1)[0];
      if (Game.T.owner[i] === victim.id) Game.setOwner(i, -1);
    }
    // 倉庫資源被最後一擊方掠奪「部分」；比例未公開，本作以10%模擬。
    for (const r of CFG.RES) {
      const n = Math.floor((victim.res[r] || 0) * CAPTURE_LOOT_PCT);
      victim.res[r] -= n;
      attacker.res[r] = Math.min(Math.max(attacker.cap, attacker.res[r]), attacker.res[r] + n);
    }
    Game.recompute(victim);
  }

  // 反叛所需資源在公開規則中只明確為「依勢力/產量決定」，完整公式未公開。
  // 本作以約48小時當前四資源產量作為透明近似。
  function rebellionCost(p) {
    const out = {};
    for (const r of CFG.RES) out[r] = Math.max(1000, Math.round((p.prod[r] || 0) * 48));
    return out;
  }
  function rebel(p) {
    if (!p || p.captor < 0) return err('目前未處於淪陷狀態');
    const cost = rebellionCost(p);
    if (!Game.canAfford(p, cost)) return err('反叛資源不足');
    Game.pay(p, cost);
    const cp = capturingSideOf(p);
    if (cp && cp.alliance >= 0) {
      const a = ensureAlliance(Game.G.alliances[cp.alliance]);
      addAllianceExp(a, Math.max(1, Math.floor(Object.values(cost).reduce((s,n)=>s+n,0) / 100)));
    }
    return releaseCaptive(p, 'rebel');
  }

  function detachAlliance(p) {
    if (p.alliance < 0) return;
    const a = ensureAlliance(Game.G.alliances[p.alliance]);
    if (!a) { p.alliance = -1; p.role = 0; return; }
    a.members = a.members.filter(id => id !== p.id);
    clearOffice(a, p.id);
    if (a.leader === p.id) {
      if (a.members.length) {
        const nl = a.members.map(id => Game.P[id]).filter(Boolean).sort((x,y)=>y.power-x.power)[0];
        a.leader = nl.id; nl.role = 2;
      } else a.dead = true;
    }
    p.alliance = -1; p.role = 0;
  }

  function roam(p, stateId) {
    if (!p || p.captor < 0) return err('只有淪陷勢力可在此使用流浪重生');
    if ((p.b.palace || 0) < 6) return err('轉為流浪軍需要君王殿／城主府 6 級');
    stateId = +stateId;
    const st = World.states[stateId];
    if (!st || st.type !== 'birth') return err('請選擇可出生州');
    const center = World.findSpawn(stateId, U.rnd, Game.P);
    if (center < 0) return err('此州暫時找不到可用出生位置');

    // 原作明確：成為流浪軍時保留80%原有資源。
    for (const r of CFG.RES) p.res[r] = Math.floor((p.res[r] || 0) * ROAM_KEEP);

    // 放棄全部領地、分城、要塞/營帳。
    for (const i of p.lands.slice()) if (Game.T.owner[i] === p.id && Game.T.city[i] < 0) Game.setOwner(i, -1);
    for (const id of (p.forts || []).slice()) {
      const c = World.cities[id];
      if (c && !c.dead) {
        const ti = c.tiles && c.tiles.length ? c.tiles[0] : -1;
        if (ti >= 0 && Game.T.owner[ti] === p.id) Game.setOwner(ti, -1);
        if (ti >= 0) Game.T.city[ti] = -1;
        c.dead = true;
      }
    }
    for (const id of (p.branches || []).slice()) {
      const c = World.cities[id];
      if (c && !c.dead) { World.clearCityTiles(c); c.dead = true; }
    }
    p.forts = []; p.branches = [];

    // 移動主城成為流浪軍砦。武將等級與戰法保留。
    const city = World.cities[p.city];
    World.clearCityTiles(city);
    city.cx = World.X(center); city.cy = World.Y(center); city.state = stateId; city.name = p.name + '軍砦';
    city.rateWanderer = true; city.size = 3;
    World.applyMainCity(city);
    p.cityTile = center; p.state = stateId;
    Game.G.marches = Game.G.marches.filter(m => m.pid !== p.id);
    for (const tm of p.teams) {
      tm.status = 'idle'; tm.base = center; tm.march = 0; tm.gtile = -1; tm.rq = null;
    }

    // 官方流浪軍保留原主城設施但不能升級（2019規則）；因此不清空建築等級。
    p.bq = [];
    detachAlliance(p);
    p.captor = -1; p.captureEnd = 0; p.capturedAt = 0;
    p.wanderer = true; p.militia = -1;
    p.protectEnd = Game.G.time + 120;
    ensureGlobal();
    Game.recompute(p);
    Game.sys('world', '【流浪】' + p.name + ' 放棄原有疆土，轉為流浪軍。');
    return ok({ center });
  }

  function wandererLootMain(victim, attacker) {
    if (!victim || !attacker || !attacker.wanderer) return err('不是流浪軍掠奪');
    if ((victim.plunderedUntil || 0) > Game.G.time) return ok({ cooldown: true, loot: {} });
    const loot = {};
    // 官方流浪軍規則：主城耐久歸零時可取得對方持有資源80%，被掠奪方倉庫四資源歸零；24小時內不再被流浪軍重複掠奪。
    for (const r of CFG.RES) {
      loot[r] = Math.floor((victim.res[r] || 0) * 0.80);
      victim.res[r] = 0;
      attacker.res[r] = Math.min(Math.max(attacker.cap, attacker.res[r]), attacker.res[r] + loot[r]);
    }
    victim.plunderedUntil = Game.G.time + 1440;
    if (victim.id === Game.G.userId) Game.notify(victim.id, '主城遭流浪軍掠奪，進入24小時掠奪保護。', 'bad');
    Game.sys('world', '【掠奪】流浪軍 ' + attacker.name + ' 攻破 ' + victim.name + ' 主城並掠走資源。');
    return ok({ loot });
  }

  function activeMilitia(id) {
    ensureGlobal();
    const m = Game.G.militias[id];
    return m && !m.dead ? m : null;
  }
  function createMilitia(p, name) {
    ensureGlobal();
    if (!p || !p.wanderer) return err('只有流浪軍可以建立義勇軍');
    if (p.militia >= 0) return err('已加入義勇軍');
    if ((p.b.palace || 0) < 3) return err('建立義勇軍需要城主府／君王殿 3 級');
    if ((p.copper || 0) < 5000) return err('建立義勇軍需要 5000 銅幣');
    name = String(name || '').trim();
    if (!name || name.length > 8) return err('義勇軍名稱需 1~8 字');
    if (Game.G.militias.some(m => m && !m.dead && m.name === name)) return err('名稱已被使用');
    p.copper -= 5000;
    const m = { id: Game.G.militias.length, name, leader: p.id, members: [p.id], state: p.state, dead: false, created: Game.G.time, offices: { deputy: -1, commanders: [] } };
    Game.G.militias.push(m); p.militia = m.id;
    Game.sys('world', '【義勇軍】流浪軍 ' + p.name + ' 建立義勇軍〔' + name + '〕。');
    return ok({ militia: m });
  }
  function joinMilitia(p, id) {
    const m = activeMilitia(+id);
    if (!p || !p.wanderer) return err('只有流浪軍可以加入義勇軍');
    if (p.militia >= 0) return err('已加入義勇軍');
    if (!m) return err('義勇軍不存在');
    if (m.members.length >= MILITIA_MAX) return err('義勇軍人數已滿（' + MILITIA_MAX + '）');
    // 2019 官方更新後已允許不同州的流浪軍加入同一義勇軍。
    m.members.push(p.id); p.militia = m.id;
    return ok();
  }
  function leaveMilitia(p) {
    const m = activeMilitia(p && p.militia);
    if (!m) return err('未加入義勇軍');
    m.members = m.members.filter(id => id !== p.id);
    p.militia = -1;
    if (!m.members.length) m.dead = true;
    else if (m.leader === p.id) m.leader = m.members[0];
    return ok();
  }

  function militiaPanel(p) {
    ensureGlobal();
    let h = '<div class="sec-t">流浪軍・義勇軍</div><div class="muted">流浪軍不享有普通同盟等級加成；義勇軍可共享視野與領地連地。2019 官方更新後上限 ' + MILITIA_MAX + ' 勢力、可跨州加入；建立需君王殿3級與5000銅幣。</div>';
    if (p.militia >= 0) {
      const m = activeMilitia(p.militia);
      if (!m) { p.militia = -1; return militiaPanel(p); }
      h += '<div class="target-box"><b>〔' + esc(m.name) + '〕</b>　首領 ' + esc(Game.P[m.leader].name) + '　' + m.members.length + '/' + MILITIA_MAX +
        '<br>' + m.members.map(id => esc(Game.P[id].name)).join('、') +
        '<br><button class="btn small dark" data-rate-militia-leave>退出義勇軍</button></div>';
    } else {
      h += '<div style="display:flex;gap:6px;margin:8px 0"><input data-rate-militia-name maxlength="8" placeholder="義勇軍名稱"><button class="btn small gold" data-rate-militia-create>建立</button></div>';
      const list = Game.G.militias.filter(m => m && !m.dead);
      h += '<table class="tbl"><tr><th>義勇軍</th><th>首領</th><th>人數</th><th></th></tr>' +
        list.map(m => '<tr><td>〔' + esc(m.name) + '〕</td><td>' + esc(Game.P[m.leader].name) + '</td><td>' + m.members.length + '/' + MILITIA_MAX + '</td><td><button class="btn small" data-rate-militia-join="' + m.id + '"' + (m.members.length >= MILITIA_MAX ? ' disabled' : '') + '>加入</button></td></tr>').join('') +
        '</table>';
    }
    return h;
  }

  function siegeOfTeam(p, team) {
    if (!p || !team) return 0;
    return Game.teamUnits(p, team).reduce((s,u) => s + (u.troops > 0 ? (u.siege || 0) : 0), 0);
  }

  function capturePanel() {
    if (typeof document === 'undefined' || !Game.G || !Game.P) return;
    const modal = document.getElementById('modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const title = modal.querySelector('.win-title span');
    if (!title || title.textContent.trim() !== '主城內政') return;
    const body = modal.querySelector('.win-body');
    if (!body || body.querySelector('.rate-captive-panel')) return;
    const p = Game.P[Game.G.userId];
    if (!p || p.captor < 0) return;
    const cp = capturingSideOf(p), cost = rebellionCost(p);
    const box = document.createElement('div'); box.className = 'rate-captive-panel target-box';
    const birth = World.states.filter(s => s.type === 'birth');
    box.innerHTML = '<b class="bad">淪陷／俘虜狀態</b><br>上級勢力：' + esc(cp ? cp.name : '未知') +
      '<div class="muted" style="margin-top:5px">淪陷期間失去原同盟資源加成與借地連地；上級同盟可利用你的領地連地。可由未淪陷盟友攻破你的主城解救，或支付反叛資源。</div>' +
      '<div style="margin-top:7px">反叛需求（本作以約48小時當前產量近似；官方未公開完整公式）： ' +
      CFG.RES.map(r => CFG.RES_NAME[r] + ' ' + U.fmt(cost[r])).join('、') + '</div>' +
      '<button class="btn small red" data-rate-rebel style="margin-top:6px">反叛</button>' +
      '<div style="margin-top:9px"><b>流浪重生</b>　<span class="muted">需君王殿6級；保留80%四資源、武將與戰法，放棄領地／分城／要塞並退出同盟。原城內設施等級保留但流浪期間不可升級，也不產四資源。</span></div>' +
      '<select data-rate-roam-state>' + birth.map(s => '<option value="' + s.id + '"' + (s.id === p.state ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select> ' +
      '<button class="btn small dark" data-rate-roam>成為流浪軍</button>';
    body.appendChild(box);
  }

  function alliancePanel() {
    if (typeof document === 'undefined' || !Game.G || !Game.P) return;
    const modal = document.getElementById('modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const title = modal.querySelector('.win-title span');
    if (!title || title.textContent.trim() !== '同盟') return;
    const body = modal.querySelector('.win-body');
    if (!body || body.querySelector('.rate-alliance-panel')) return;
    const p = Game.P[Game.G.userId];
    if (!p || p.wanderer || p.alliance < 0) return;
    const a = allianceOf(p);
    const box = document.createElement('div'); box.className = 'rate-alliance-panel';
    box.style.cssText = 'margin-top:12px;padding:10px;border:1px solid rgba(128,91,35,.45);background:rgba(239,226,194,.58)';
    const need = xpNeed(a.level);
    let h = '<div class="sec-t" style="margin-top:0">同盟發展</div>' +
      '<div class="row"><span>同盟等級</span><span>Lv.' + a.level + '　經驗 ' + a.exp + '/' + need + '</span></div>' +
      '<div class="row"><span>等級資源加成</span><span>+' + (levelBonus(a) * 100).toFixed(1) + '%</span></div>' +
      '<div class="muted">原作可由戰鬥與木／鐵／石／糧捐獻提升同盟等級，等級提高全盟資源產出。公開資料沒有完整逐級經驗表與加成倍率，因此此頁的經驗門檻與每級 +0.5% 為本作縮放值。</div>' +
      '<div style="display:flex;gap:5px;align-items:center;margin-top:7px"><select data-rate-donate-res>' +
      CFG.RES.map(r => '<option value="' + r + '">' + CFG.RES_NAME[r] + '</option>').join('') +
      '</select><input data-rate-donate-amt type="number" min="100" step="100" value="1000" style="width:100px"><button class="btn small gold" data-rate-donate>捐獻</button></div>' +
      '<div class="muted">你的累積貢獻：' + U.fmt(a.contrib[p.id] || 0) + '</div>';

    h += '<div class="sec-t">同盟官職</div><div class="muted">盟主：管理官職；副盟主、指揮官與盟主皆可下達地圖攻城目標。指揮官上限 ' + MAX_COMMANDERS + ' 名。</div>';
    if (a.leader === p.id) {
      h += '<div style="display:flex;gap:5px;align-items:center;margin-top:7px"><select data-rate-office-member style="flex:1">' +
        a.members.filter(id => id !== a.leader).map(id => '<option value="' + id + '">' + esc(Game.P[id].name) + '（' + roleName(Game.P[id], a) + '）</option>').join('') +
        '</select><select data-rate-office-role><option value="deputy">副盟主</option><option value="commander">指揮官</option><option value="officer">官員</option><option value="member">撤職</option></select><button class="btn small" data-rate-appoint-office>任命</button></div>';
    }

    if (typeof AI !== 'undefined' && AI.diplomacyOffersFor) {
      const offers = AI.diplomacyOffersFor(a.id);
      h += '<div class="sec-t">外交動態</div>';
      if (offers.length) {
        h += offers.map(o => {
          const from = Game.G.alliances[o.from];
          if (!from) return '';
          const hrs = Math.max(1, Math.round(o.minutes / 60));
          return '<div class="target-box"><b>〔' + esc(from.name) + '〕</b> 提出' + (o.kind === 'truce' ? '停戰' : '互不侵犯') + ' ' + hrs + ' 小時' +
            (a.leader === p.id ? '<br><button class="btn small gold" data-rate-dip-accept="' + o.id + '">接受</button> <button class="btn small dark" data-rate-dip-reject="' + o.id + '">拒絕</button>' : '<br><span class="muted">等待盟主處理</span>') + '</div>';
        }).join('');
      } else h += '<div class="muted">目前沒有待處理的外交提案。</div>';

      const me = Game.P[a.leader];
      const near = Game.G.alliances.filter(b => b && !b.dead && b.id !== a.id).map(b => {
        const L = Game.P[b.leader];
        const d = L && me ? World.dist(L.cityTile, me.cityTile) : 9999;
        return { b, L, d };
      }).filter(x => x.L && x.d <= 120).sort((x,y)=>x.d-y.d).slice(0,6);
      if (near.length) {
        h += '<div class="muted" style="margin-top:7px">鄰近勢力觀察（只顯示行為印象，不公開內部人格數值）</div>';
        h += '<table class="tbl"><tr><th>同盟</th><th>近期作風</th><th>外交聲譽</th><th>對我方態度</th></tr>' + near.map(x => {
          const style = x.L.ai && AI.styleSummary ? AI.styleSummary(x.L) : '尚難判斷';
          const rep = x.L.ai && AI.reputationSummary ? AI.reputationSummary(x.L) : '未知';
          const att = AI.attitudeSummary ? AI.attitudeSummary(a, x.b.id) : '觀望';
          const m = AI.allianceMemory ? AI.allianceMemory(a, x.b) : null;
          const marks = m ? (m.betrayals ? ' <span class="bad">曾背約</span>' : m.gifts ? ' <span class="good">曾援助</span>' : '') : '';
          return '<tr><td>〔' + esc(x.b.name) + '〕</td><td>' + esc(style) + '</td><td>' + esc(rep) + marks + '</td><td>' + esc(att) + '</td></tr>';
        }).join('') + '</table>';
      }
    }
    box.innerHTML = h;
    body.appendChild(box);
  }

  function toast(msg, type) { if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg, type || 'info'); }
  function rerenderExtras() {
    for (const s of ['.rate-alliance-panel','.rate-captive-panel']) { const e = document.querySelector(s); if (e) e.remove(); }
    alliancePanel(); capturePanel();
  }
  function installDom() {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', e => {
      let b = e.target.closest && e.target.closest('[data-rate-donate]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const rs = document.querySelector('[data-rate-donate-res]'), am = document.querySelector('[data-rate-donate-amt]');
        const r = donate(Game.P[Game.G.userId], rs ? rs.value : '', am ? +am.value : 0);
        toast(r.ok ? '同盟捐獻完成' : r.msg, r.ok ? 'good' : 'warn'); rerenderExtras(); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-appoint-office]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const ms = document.querySelector('[data-rate-office-member]'), rr = document.querySelector('[data-rate-office-role]');
        const r = appoint(Game.P[Game.G.userId], ms ? +ms.value : -1, rr ? rr.value : '');
        toast(r.ok ? '官職已更新' : r.msg, r.ok ? 'good' : 'warn'); rerenderExtras(); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-dip-accept]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const p = Game.P[Game.G.userId], a = allianceOf(p);
        if (!a || a.leader !== p.id) { toast('只有盟主可以處理外交提案', 'warn'); return; }
        const r = AI.respondDiplomacyOffer(a.id, +b.getAttribute('data-rate-dip-accept'), true);
        toast(r.ok ? '已接受外交提案' : r.msg, r.ok ? 'good' : 'warn'); rerenderExtras(); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-dip-reject]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const p = Game.P[Game.G.userId], a = allianceOf(p);
        if (!a || a.leader !== p.id) { toast('只有盟主可以處理外交提案', 'warn'); return; }
        const r = AI.respondDiplomacyOffer(a.id, +b.getAttribute('data-rate-dip-reject'), false);
        toast(r.ok ? '已拒絕外交提案' : r.msg, r.ok ? 'info' : 'warn'); rerenderExtras(); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-rebel]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const r = rebel(Game.P[Game.G.userId]); toast(r.ok ? '反叛成功，已脫離淪陷' : r.msg, r.ok ? 'good' : 'warn'); rerenderExtras(); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-roam]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('成為流浪軍會放棄全部領地、分城、要塞並退出同盟，只保留80%四資源。確定嗎？')) return;
        const st = document.querySelector('[data-rate-roam-state]');
        const r = roam(Game.P[Game.G.userId], st ? +st.value : -1);
        toast(r.ok ? '已轉為流浪軍' : r.msg, r.ok ? 'good' : 'warn');
        if (r.ok && typeof UI !== 'undefined') UI.openPanel('alliance');
        return;
      }
      b = e.target.closest && e.target.closest('[data-rate-militia-create]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const n = document.querySelector('[data-rate-militia-name]');
        const r = createMilitia(Game.P[Game.G.userId], n ? n.value : '');
        toast(r.ok ? '義勇軍建立成功' : r.msg, r.ok ? 'good' : 'warn');
        if (typeof UI !== 'undefined') UI.openPanel('alliance'); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-militia-join]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const r = joinMilitia(Game.P[Game.G.userId], +b.getAttribute('data-rate-militia-join'));
        toast(r.ok ? '加入義勇軍成功' : r.msg, r.ok ? 'good' : 'warn');
        if (typeof UI !== 'undefined') UI.openPanel('alliance'); return;
      }
      b = e.target.closest && e.target.closest('[data-rate-militia-leave]');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const r = leaveMilitia(Game.P[Game.G.userId]);
        toast(r.ok ? '已退出義勇軍' : r.msg, r.ok ? 'info' : 'warn');
        if (typeof UI !== 'undefined') UI.openPanel('alliance');
      }
    }, true);
    const modal = document.getElementById('modal');
    if (modal && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => { alliancePanel(); capturePanel(); }).observe(modal, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    }
    setInterval(() => { alliancePanel(); capturePanel(); }, 700);
  }

  function autoManage() {
    ensureGlobal();
    for (const a0 of Game.G.alliances || []) {
      if (!a0 || a0.dead) continue;
      const a = ensureAlliance(a0);
      // 戰鬥也會推進同盟等級；原作確認此路徑存在，但公開資料沒有完整經驗換算表。
      if (!a._battleSeen) a._battleSeen = {};
      let battleGain = 0;
      for (const id of a.members) {
        const q = Game.P[id]; if (!q) continue;
        const cur = (q.stats && q.stats.battles) || 0, prev = a._battleSeen[id] || 0;
        if (cur > prev) battleGain += (cur - prev) * 5; // 本作縮放：每場5經驗
        a._battleSeen[id] = cur;
      }
      if (battleGain) addAllianceExp(a, battleGain);
      // 讓 AI 同盟也真的有副盟主/指揮官，不只玩家同盟介面有功能。
      const candidates = a.members.map(id => Game.P[id]).filter(q => q && q.id !== a.leader).sort((x,y)=>y.power-x.power);
      if (a.offices.deputy < 0 && candidates[0]) { clearOffice(a, candidates[0].id); a.offices.deputy = candidates[0].id; }
      while (a.offices.commanders.length < MAX_COMMANDERS) {
        const q = candidates.find(x => x.id !== a.offices.deputy && !a.offices.commanders.includes(x.id));
        if (!q) break;
        a.offices.commanders.push(q.id);
      }
    }
  }

  function installGamePatches() {
    if (installed || typeof Game === 'undefined') return;
    installed = true;
    const origNew = Game.newGame;
    Game.newGame = function (opts) {
      const g = origNew(opts); ensureGlobal();
      for (const a of g.alliances || []) ensureAlliance(a);
      autoManage(); return g;
    };
    const origLoad = Game.load;
    if (typeof origLoad === 'function') Game.load = function () {
      const r = origLoad.apply(Game, arguments);
      if (r) { ensureGlobal(); for (const a of Game.G.alliances || []) ensureAlliance(a); autoManage(); }
      return r;
    };
    const origCreate = Game.createAlliance;
    Game.createAlliance = function (p, name) {
      if (p && p.wanderer) return err('流浪軍不能建立普通同盟，請建立義勇軍');
      if (p && p.captor >= 0) return err('淪陷期間不能建立同盟');
      const r = origCreate(p, name);
      if (r && r.ok) ensureAlliance(r.alliance);
      return r;
    };
    const origJoin = Game.joinAlliance;
    Game.joinAlliance = function (p, aid, force) {
      if (p && p.wanderer) return err('流浪軍不能加入普通同盟，請加入義勇軍');
      if (p && p.captor >= 0) return err('淪陷期間不能加入同盟');
      const r = origJoin(p, aid, force);
      if (r && r.ok) ensureAlliance(Game.G.alliances[aid]);
      return r;
    };
    const origLeave = Game.leaveAlliance;
    Game.leaveAlliance = function (p) {
      // 原作允許淪陷中退盟，但退盟不會解除淪陷，且淪陷中無法再建盟/入盟。
      return origLeave(p);
    };

    const origAdvance = Game.advance;
    Game.advance = function (minutes) {
      const r = origAdvance(minutes);
      if (!Game.G._rateAllianceNext || Game.G.time >= Game.G._rateAllianceNext) {
        Game.G._rateAllianceNext = Game.G.time + 60;
        autoManage();
      }
      return r;
    };
  }

  function init() { installGamePatches(); installDom(); }
  if (typeof window !== 'undefined') init();
  else installGamePatches();

  return {
    ROLE_NAME, MAX_COMMANDERS, MILITIA_MAX, ROAM_KEEP, LAND_LOSS_PCT, CAPTURE_LOOT_PCT,
    ensureGlobal, ensureAlliance, xpNeed, levelBonus, addAllianceExp, donate,
    roleOf, roleName, canCommand, appoint,
    friendOverride, canRescue, capturedAllyLandBlock, onCaptured, releaseCaptive, rebellionCost, rebel, roam,
    wandererLootMain, createMilitia, joinMilitia, leaveMilitia, activeMilitia, militiaPanel,
    siegeOfTeam, installGamePatches
  };
})();