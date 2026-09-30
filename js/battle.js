// 戰鬥模擬：準備回合 + 8 回合，大營陣亡即敗，8 回合未分勝負為平局
'use strict';

var Battle = (function () {
  const K = 30;           // 傷害常數
  const MAX_ROUNDS = 8;
  const CONTROL = { stun: 1, confuse: 1, silence: 1, disarm: 1 };
  const ST_NAME = { stun: '震懾', confuse: '混亂', silence: '計窮', disarm: '繳械', taunt: '嘲諷', first: '先攻', double: '連擊', evade: '規避', insight: '洞察', burn: '灼燒', fear: '恐慌', regen: '休整', dmgDealt: '增傷', dmgTaken: '受創', counter: '反擊' };
  const STAT_NAME = { atk: '攻擊', def: '防禦', int: '謀略', spd: '速度' };
  const SLOT_NAME = ['大營', '中軍', '前鋒'];

  let rnd = Math.random;

  // 依戰法等級縮放效果數值（傷害率、治療率、增減益、狀態強度），快取每個 (戰法, 等級)
  const SCALED_V = { burn: 1, fear: 1, regen: 1, counter: 1, dmgDealt: 1, dmgTaken: 1, evade: 1, double: 1 };
  const scaledCache = {};
  function scaledSkill(id, lv) {
    const base = SKILLS[id];
    if (!base) return null;
    lv = lv || CFG.SKILL_MAX_LV;
    if (lv >= CFG.SKILL_MAX_LV) return base;
    const key = id + '@' + lv;
    if (scaledCache[key]) return scaledCache[key];
    const sc = CFG.skillScale(lv);
    const scale = fx => fx.map(f => {
      const g = Object.assign({}, f);
      if (f.k === 'dmg' || f.k === 'heal') g.rate = f.rate * sc;
      else if (f.k === 'buff' || f.k === 'debuff') { if (f.v) g.v = f.v * sc; if (f.pct) g.pct = f.pct * sc; }
      else if (f.k === 'st' && SCALED_V[f.st] && f.v !== undefined) g.v = f.v * sc;
      return g;
    });
    const sk = Object.assign({}, base, { lv, fx: scale(base.fx) });
    if (base.rfx) sk.rfx = scale(base.rfx);
    scaledCache[key] = sk;
    return sk;
  }

  // u: {name, faction, troop, troops, atk, def, int, spd, range, skills, skl(戰法等級), morale, slot}
  function prepUnit(u, side) {
    const morale = u.morale === undefined ? 100 : u.morale;
    return {
      name: u.name, faction: u.faction, troop: u.troop, lv: u.lv || 1,
      troops: Math.max(0, Math.floor(u.troops)), start: Math.max(0, Math.floor(u.troops)), wounded: 0,
      b: { atk: u.atk, def: u.def, int: u.int, spd: u.spd }, range: u.range || 2,
      skills: (u.skills || []).map((id, k) => scaledSkill(id, u.skl ? u.skl[k] : 0)).filter(Boolean),
      morale, mf: CFG.moraleDmg(morale),
      slot: u.slot, side, pos: 0, buffs: [], sts: [], prep: {}, ref: u.ref,
      dealt: 0, healed: 0,
    };
  }
  function alive(u) { return u.troops > 0; }
  function stat(u, s) {
    let flat = 0, pct = 0;
    for (const b of u.buffs) if (b.stat === s) { flat += b.v || 0; pct += b.pct || 0; }
    return Math.max(1, (u.b[s] + flat) * Math.max(0.2, 1 + pct));
  }
  function stSum(u, st) {
    let v = 0;
    for (const s of u.sts) if (s.st === st) v += (s.v === undefined ? 1 : s.v);
    return v;
  }
  function has(u, st) { for (const s of u.sts) if (s.st === st) return s; return null; }
  function controlled(u, st) { return has(u, st) && !has(u, 'insight'); }

  function Ctx(A, D, log) {
    this.sides = [A, D];
    this.log = log ? [] : null;
    this.round = 0;
    this.over = false;
  }
  // 戰鬥紀錄：t 文字、c 樣式；e 為結構化事件（戰鬥回放用）
  // e.k：round/cast/prep/dmg/heal/buff/st/ev/ctl/dead/end；a 行動者、d 目標（side*3+slot）；v 數值；n 剩餘兵力；s 戰法/狀態名
  Ctx.prototype.L = function (text, cls, e) { if (this.log) { const o = { r: this.round, t: text, c: cls || '' }; if (e) o.e = e; this.log.push(o); } };
  function UK(u) { return u.side * 3 + u.slot; } // 單位代號
  Ctx.prototype.enemies = function (u) { return this.sides[1 - u.side].filter(alive); };
  Ctx.prototype.allies = function (u) { return this.sides[u.side].filter(alive); };
  Ctx.prototype.updatePos = function () {
    for (const s of this.sides) {
      const al = s.filter(alive).sort((a, b) => b.slot - a.slot);
      al.forEach((u, i) => { u.pos = i + 1; });
    }
  };
  Ctx.prototype.checkEnd = function () {
    for (let s = 0; s < 2; s++) {
      const base = this.sides[s].find(u => u.slot === 0) || this.sides[s][0];
      if (!base || !alive(base)) { this.over = true; this.loser = s; return true; }
    }
    return false;
  };

  function nm(u) { return (u.side === 0 ? '【我】' : '【敵】') + u.name; }

  function pickN(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a.slice(0, n);
  }

  function targets(ctx, u, tgt, primary, range) {
    const conf = controlled(u, 'confuse');
    if (tgt === 'self') return [u];
    if (tgt[0] === 'a') {
      const al = ctx.allies(u);
      if (tgt === 'aAll') return al;
      if (tgt === 'aLow') { let best = null; for (const x of al) if (!best || x.troops / Math.max(1, x.start) < best.troops / Math.max(1, best.start)) best = x; return best ? [best] : []; }
      return pickN(al, tgt === 'a1' ? 1 : 2);
    }
    let pool;
    if (conf) {
      pool = ctx.sides[0].concat(ctx.sides[1]).filter(x => alive(x) && x !== u);
    } else {
      pool = ctx.enemies(u).filter(e => u.pos + e.pos - 1 <= (range || 5));
      if (!pool.length) pool = ctx.enemies(u);
    }
    if (!pool.length) return [];
    if (tgt === 'eAll') return conf ? pickN(pool, 3) : pool;
    let n = tgt === 'e1' ? 1 : tgt === 'e2' ? 2 : tgt === 'e3' ? 3 : (rnd() < 0.5 ? 2 : 3);
    if (primary && alive(primary) && pool.includes(primary)) {
      const rest = pool.filter(x => x !== primary);
      return [primary].concat(pickN(rest, n - 1));
    }
    return pickN(pool, n);
  }

  function rawDmg(src, tgt, type, rate) {
    const tf = Math.sqrt(Math.max(1, src.troops));
    const a = type === 'phys' ? stat(src, 'atk') : stat(src, 'int');
    const d = type === 'phys' ? stat(tgt, 'def') : stat(tgt, 'int');
    let dmg = rate * tf * (a * 0.9 + 60) / K * (250 / (250 + d * 0.8));
    if (TROOP_COUNTER[src.troop] === tgt.troop) dmg *= 1.15;
    else if (TROOP_COUNTER[tgt.troop] === src.troop) dmg *= 0.87;
    dmg *= Math.max(0.3, 1 + stSum(src, 'dmgDealt')) * Math.max(0.3, 1 + stSum(tgt, 'dmgTaken'));
    dmg *= src.mf; // 士氣
    dmg *= 0.92 + rnd() * 0.16;
    return dmg;
  }

  function dealDamage(ctx, src, tgt, type, rate, label) {
    if (!alive(tgt)) return 0;
    const ev = has(tgt, 'evade');
    if (ev && rnd() < stSum(tgt, 'evade')) { ctx.L(nm(tgt) + ' 規避了傷害', 'ev', { k: 'ev', a: UK(src), d: UK(tgt), s: '規避' }); return 0; }
    let dmg = Math.round(rawDmg(src, tgt, type, rate));
    dmg = Math.max(1, Math.min(tgt.troops, dmg));
    tgt.troops -= dmg;
    tgt.wounded += dmg;
    src.dealt += dmg;
    ctx.L(nm(src) + (label === '普通攻擊' ? ' 普通攻擊 ' : label === '反擊' ? ' 反擊 ' : ' 以【' + label + '】攻擊 ') + nm(tgt) + '，造成' + (type === 'phys' ? '兵刃' : '謀略') + '傷害 ' + dmg + '（剩餘 ' + tgt.troops + '）', src.side === 0 ? 'dmg0' : 'dmg1',
      { k: 'dmg', a: UK(src), d: UK(tgt), v: dmg, n: tgt.troops, s: label, t: type === 'phys' ? 0 : 1 });
    if (!alive(tgt)) { ctx.L(nm(tgt) + ' 兵力耗盡，無法再戰', 'dead', { k: 'dead', d: UK(tgt) }); ctx.updatePos(); }
    return dmg;
  }

  function heal(ctx, src, tgt, rate, label) {
    if (!alive(tgt) || tgt.wounded <= 0) return 0;
    const tf = Math.sqrt(Math.max(1, src.troops));
    let h = rate * tf * (stat(src, 'int') * 0.9 + 60) / K * 0.85 * (0.95 + rnd() * 0.1);
    h = Math.round(Math.min(h, tgt.wounded));
    if (h <= 0) return 0;
    tgt.troops += h; tgt.wounded -= h; src.healed += h;
    ctx.L(nm(tgt) + ' 因【' + label + '】恢復兵力 ' + h + '（剩餘 ' + tgt.troops + '）', 'heal', { k: 'heal', a: UK(src), d: UK(tgt), v: h, n: tgt.troops, s: label });
    return h;
  }

  function applyFx(ctx, u, sk, primary, list) {
    const range = sk.range || 5;
    const cache = {}; // 同一戰法中相同目標代號沿用同一批目標
    for (const f of list || sk.fx) {
      if (f.k === 'range') { u.range += f.v; continue; }
      let tg;
      if (cache[f.tgt]) tg = cache[f.tgt].filter(alive);
      else { tg = targets(ctx, u, f.tgt, primary, range); cache[f.tgt] = tg; }
      if (f.k === 'dmg') {
        for (const t of tg) dealDamage(ctx, u, t, f.t, f.rate, sk.name);
      } else if (f.k === 'heal') {
        for (const t of tg) heal(ctx, u, t, f.rate, sk.name);
      } else if (f.k === 'buff' || f.k === 'debuff') {
        for (const t of tg) {
          const key = sk.id + ':' + f.stat + ':' + f.k;
          t.buffs = t.buffs.filter(b => b.key !== key);
          const sign = f.k === 'debuff' ? -1 : 1;
          t.buffs.push({ key, stat: f.stat, v: (f.v || 0) * sign, pct: (f.pct || 0) * sign, left: f.dur || 1 });
          if (f.dur !== 99 || sk.type === 'active') ctx.L(nm(t) + ' 的' + STAT_NAME[f.stat] + (sign > 0 ? '提高' : '降低') + (f.pct ? Math.round(f.pct * 100) + '%' : f.v) + '（' + sk.name + '）', 'buff',
            { k: 'buff', a: UK(u), d: UK(t), s: STAT_NAME[f.stat] + (sign > 0 ? '↑' : '↓'), up: sign > 0 ? 1 : 0, dur: f.dur || 1, from: sk.name });
        }
      } else if (f.k === 'st') {
        for (const t of tg) {
          if (!alive(t)) continue;
          if (f.p && rnd() >= f.p) continue;
          if (CONTROL[f.st] && has(t, 'insight')) { ctx.L(nm(t) + ' 處於洞察狀態，免疫' + ST_NAME[f.st], 'ev', { k: 'ev', a: UK(u), d: UK(t), s: '免疫' + ST_NAME[f.st] }); continue; }
          const key = sk.id + ':' + f.st;
          t.sts = t.sts.filter(s => s.key !== key);
          const rec = { key, st: f.st, v: f.v, left: f.dur || 1 };
          if (f.st === 'burn' || f.st === 'fear') {
            rec.dmg = Math.round(f.v * Math.sqrt(Math.max(1, u.troops)) * (stat(u, 'int') * 0.9 + 60) / K * (250 / (250 + stat(t, 'int') * 0.8)) * u.mf);
            rec.srcSide = u.side;
          }
          if (f.st === 'regen') rec.src = u;
          t.sts.push(rec);
          const stn = f.st === 'dmgDealt' && f.v < 0 ? '傷害降低' : f.st === 'dmgTaken' && f.v < 0 ? '減傷' : ST_NAME[f.st];
          if (f.dur !== 99) ctx.L(nm(t) + ' 陷入' + stn + '狀態（' + sk.name + '）', CONTROL[f.st] ? 'ctl' : 'buff',
            { k: 'st', a: UK(u), d: UK(t), s: stn, dur: f.dur || 1, ctl: CONTROL[f.st] ? 1 : 0, bad: (u.side !== t.side) ? 1 : 0, from: sk.name });
        }
      }
    }
  }
  function castSkill(ctx, u, sk, primary) {
    ctx.L(nm(u) + ' 發動【' + sk.name + '】', u.side === 0 ? 'sk0' : 'sk1', { k: 'cast', a: UK(u), s: sk.name, q: sk.q, ty: sk.type });
    applyFx(ctx, u, sk, primary);
  }

  function normalAttack(ctx, u) {
    let tgt = null;
    if (controlled(u, 'confuse')) {
      const pool = ctx.sides[0].concat(ctx.sides[1]).filter(x => alive(x) && x !== u);
      tgt = pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
      if (tgt) ctx.L(nm(u) + ' 陷入混亂，攻擊了 ' + nm(tgt), 'ctl', { k: 'ctl', a: UK(u), d: UK(tgt), s: '混亂' });
    } else {
      const en = ctx.enemies(u);
      const taunter = en.find(e => has(e, 'taunt'));
      if (taunter) tgt = taunter;
      else {
        const inR = en.filter(e => u.pos + e.pos - 1 <= u.range);
        if (inR.length) tgt = inR[Math.floor(rnd() * inR.length)];
      }
    }
    if (!tgt) return null;
    dealDamage(ctx, u, tgt, 'phys', 1.0, '普通攻擊');
    // 反擊
    const ct = has(tgt, 'counter');
    if (ct && alive(tgt) && alive(u) && tgt.side !== u.side) dealDamage(ctx, tgt, u, 'phys', stSum(tgt, 'counter'), '反擊');
    return tgt;
  }

  function act(ctx, u) {
    if (!alive(u) || ctx.over) return;
    // 持續效果
    for (const s of u.sts) {
      if ((s.st === 'burn' || s.st === 'fear') && s.dmg > 0 && alive(u)) {
        const d = Math.max(1, Math.min(u.troops, Math.round(s.dmg * (0.9 + rnd() * 0.2))));
        u.troops -= d; u.wounded += d;
        ctx.L(nm(u) + ' 受到' + ST_NAME[s.st] + '傷害 ' + d + '（剩餘 ' + u.troops + '）', 'dot', { k: 'dmg', d: UK(u), v: d, n: u.troops, s: ST_NAME[s.st], dot: 1 });
        if (!alive(u)) { ctx.L(nm(u) + ' 兵力耗盡，無法再戰', 'dead', { k: 'dead', d: UK(u) }); ctx.updatePos(); if (ctx.checkEnd()) return; return; }
      }
      if (s.st === 'regen' && alive(u)) heal(ctx, u, u, s.v, '休整');
    }
    if (controlled(u, 'stun')) { ctx.L(nm(u) + ' 處於震懾狀態，無法行動', 'ctl', { k: 'ctl', a: UK(u), s: '震懾' }); return; }
    // 主動戰法
    const silenced = controlled(u, 'silence');
    for (const sk of u.skills) {
      if (sk.type !== 'active' || ctx.over) continue;
      if (u.prep[sk.id] !== undefined) {
        if (silenced) continue;
        u.prep[sk.id]--;
        if (u.prep[sk.id] <= 0) { delete u.prep[sk.id]; castSkill(ctx, u, sk); if (ctx.checkEnd()) return; }
        continue;
      }
      if (silenced) continue;
      if (rnd() < sk.chance) {
        if (sk.prep > 0) { u.prep[sk.id] = sk.prep; ctx.L(nm(u) + ' 開始準備【' + sk.name + '】', 'prep', { k: 'prep', a: UK(u), s: sk.name }); }
        else { castSkill(ctx, u, sk); if (ctx.checkEnd()) return; }
      }
    }
    if (!alive(u) || ctx.over) return;
    // 普通攻擊 + 追擊 + 連擊
    if (controlled(u, 'disarm')) { ctx.L(nm(u) + ' 處於繳械狀態，無法普通攻擊', 'ctl', { k: 'ctl', a: UK(u), s: '繳械' }); return; }
    let times = 1;
    const dbl = stSum(u, 'double');
    if (dbl > 0 && rnd() < dbl) times = 2;
    for (let k = 0; k < times && alive(u) && !ctx.over; k++) {
      if (k === 1) ctx.L(nm(u) + ' 發動連擊', 'sk' + u.side, { k: 'cast', a: UK(u), s: '連擊' });
      const tgt = normalAttack(ctx, u);
      if (ctx.checkEnd()) return;
      if (!tgt) break;
      for (const sk of u.skills) {
        if (sk.type !== 'pursuit' || ctx.over || !alive(u)) continue;
        if (rnd() < sk.chance) { castSkill(ctx, u, sk, tgt); if (ctx.checkEnd()) return; }
      }
    }
  }

  // 指揮/被動戰法的每回合效果（rfx）：rp 為每回合觸發機率、rr 為生效回合數
  function roundEffects(ctx, r) {
    const order = ctx.sides[0].concat(ctx.sides[1]).filter(alive).sort((a, b) => stat(b, 'spd') - stat(a, 'spd'));
    for (const u of order) for (const sk of u.skills) {
      if (!sk.rfx || !alive(u) || ctx.over || r > (sk.rr || MAX_ROUNDS)) continue;
      if (sk.rp && rnd() >= sk.rp) continue;
      ctx.L(nm(u) + ' 的【' + sk.name + '】生效', u.side === 0 ? 'sk0' : 'sk1', { k: 'cast', a: UK(u), s: sk.name, q: sk.q, ty: sk.type });
      applyFx(ctx, u, sk, null, sk.rfx);
      if (ctx.checkEnd()) return;
    }
  }

  function tickDurations(ctx) {
    for (const s of ctx.sides) for (const u of s) {
      u.buffs = u.buffs.filter(b => b.left >= 99 || --b.left > 0);
      u.sts = u.sts.filter(x => x.left >= 99 || --x.left > 0);
    }
  }

  // atk/def: 單位陣列（slot: 0 大營 1 中軍 2 前鋒）
  function simulate(atk, def, opts) {
    opts = opts || {};
    rnd = opts.rng || Math.random;
    const A = atk.filter(u => u && u.troops > 0).map(u => prepUnit(u, 0));
    const D = def.filter(u => u && u.troops > 0).map(u => prepUnit(u, 1));
    // 若大營缺席（兵力 0），以剩餘最高槽位者為大營
    for (const S of [A, D]) {
      if (S.length && !S.some(u => u.slot === 0)) { S.sort((a, b) => a.slot - b.slot); S[0].slot = 0; }
    }
    const ctx = new Ctx(A, D, opts.log);
    if (!A.length || !D.length) {
      return { winner: !A.length ? 'def' : 'atk', rounds: 0, A, D, log: ctx.log || [] };
    }
    ctx.updatePos();
    // 準備回合：指揮、被動
    ctx.round = 0;
    ctx.L('—— 準備回合 ——', 'round', { k: 'round', r: 0 });
    for (const S of [A, D]) {
      const m = S[0].morale;
      if (m < 100) ctx.L((S === A ? '【我】' : '【敵】') + '部隊士氣 ' + m + '，造成傷害 ' + Math.round(S[0].mf * 100) + '%', 'ctl');
    }
    const all = A.concat(D).sort((a, b) => stat(b, 'spd') - stat(a, 'spd'));
    for (const u of all) for (const sk of u.skills) {
      if ((sk.type === 'command' || sk.type === 'passive') && sk.fx.length) castSkill(ctx, u, sk);
    }
    for (let r = 1; r <= MAX_ROUNDS && !ctx.over; r++) {
      ctx.round = r;
      ctx.L('—— 第 ' + r + ' 回合 ——', 'round', { k: 'round', r });
      roundEffects(ctx, r);
      if (ctx.over) break;
      const order = A.concat(D).filter(alive).map(u => ({ u, k: (has(u, 'first') ? 10000 : 0) + stat(u, 'spd') + rnd() * 3 }))
        .sort((a, b) => b.k - a.k).map(o => o.u);
      for (const u of order) {
        act(ctx, u);
        if (ctx.over) break;
      }
      tickDurations(ctx);
    }
    let winner = 'draw';
    if (ctx.over) winner = ctx.loser === 0 ? 'def' : 'atk';
    if (ctx.log) ctx.L(winner === 'draw' ? '八回合未分勝負，雙方平局' : (winner === 'atk' ? '進攻方獲勝' : '防守方獲勝'), 'end', { k: 'end', w: winner });
    return { winner, rounds: ctx.round, A, D, log: ctx.log || [] };
  }

  // 估算戰力（AI 用）：兵力^0.75 * 屬性
  function power(units) {
    let p = 0;
    for (const u of units) {
      if (!u || u.troops <= 0) continue;
      const main = Math.max(u.atk, u.int);
      const sk = (u.skills || []).reduce((s, id, k) => s + (SKILLS[id] ? SKILL_VALUE[SKILLS[id].q] * (u.skl ? CFG.skillScale(u.skl[k]) : 1) : 0), 0);
      p += Math.pow(u.troops, 0.75) * (main * 0.9 + u.def * 0.6 + 60) * (1 + sk * 0.06);
    }
    return p / 100;
  }

  return { simulate, power, scaledSkill, SLOT_NAME, ST_NAME };
})();
