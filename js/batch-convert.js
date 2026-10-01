'use strict';

// 戰法頁：批量轉化多餘的 2★ / 3★ 閒置武將為戰法點。
(function () {
  const BOX_ID = 'batch-hero-convert';

  function player() {
    return (typeof UI !== 'undefined' && UI.user) || (typeof Game !== 'undefined' && Game.P && Game.G ? Game.P[Game.G.userId] : null);
  }

  function selectedStars(box) {
    return [2, 3].filter(star => {
      const el = box.querySelector('[data-bc-star="' + star + '"]');
      return el && el.checked;
    });
  }

  function candidates(box) {
    const p = player();
    if (!p) return [];
    const stars = selectedStars(box);
    if (!stars.length) return [];
    const keepOne = !!box.querySelector('[data-bc-keep]').checked;
    const pool = p.heroes.filter(h => h.team < 0 && stars.includes(Game.tpl(h).star));
    if (!keepOne) return pool.slice();

    // 「多餘」預設定義：同名武將至少保留一張，優先保留培養程度最高者。
    const groups = new Map();
    pool.forEach(h => {
      if (!groups.has(h.t)) groups.set(h.t, []);
      groups.get(h.t).push(h);
    });
    const out = [];
    groups.forEach(list => {
      list.sort((a, b) => (b.lv - a.lv) || (b.adv - a.adv) || (b.awk - a.awk) || (a.uid - b.uid));
      out.push(...list.slice(1));
    });
    return out;
  }

  function updatePreview(box) {
    const list = candidates(box);
    let s2 = 0, s3 = 0, pts = 0;
    list.forEach(h => {
      const star = Game.tpl(h).star;
      if (star === 2) s2++; else if (star === 3) s3++;
      pts += Math.round(Game.convertValue(h));
    });
    const out = box.querySelector('[data-bc-preview]');
    if (out) out.innerHTML = '將轉化 <b>' + list.length + '</b> 名武將（2★ ' + s2 + '、3★ ' + s3 + '），預計獲得 <b>' + pts.toLocaleString() + '</b> 戰法點。';
    const btn = box.querySelector('[data-bc-go]');
    if (btn) btn.disabled = list.length === 0;
  }

  function convert(box) {
    const p = player();
    if (!p) return;
    const list = candidates(box);
    if (!list.length) {
      if (typeof UI !== 'undefined') UI.toast('沒有符合條件的多餘武將', 'warn');
      return;
    }
    const pts = list.reduce((n, h) => n + Math.round(Game.convertValue(h)), 0);
    const stars = selectedStars(box).map(x => x + '★').join('、');
    const keep = box.querySelector('[data-bc-keep]').checked;
    const msg = '確定一鍵轉化 ' + list.length + ' 名 ' + stars + ' 武將嗎？\n預計獲得 ' + pts.toLocaleString() + ' 戰法點。' + (keep ? '\n每個同名武將會保留培養程度最高的 1 張。' : '\n注意：目前未勾選保留同名武將，符合條件的閒置武將會全部轉化。');
    if (window.self === window.top && !window.confirm(msg)) return;

    let gained = 0, done = 0;
    // 先保存 uid，避免移除陣列元素時影響遍歷。
    list.map(h => h.uid).forEach(uid => {
      const r = Game.convertHero(p, uid);
      if (r && r.ok) { gained += r.pts || 0; done++; }
    });
    if (typeof Game.save === 'function') Game.save();
    if (typeof UI !== 'undefined') {
      UI.toast('一鍵轉化完成：' + done + ' 名武將，獲得 ' + gained.toLocaleString() + ' 戰法點', 'good');
      UI.openPanel('skills');
    }
  }

  function inject() {
    if (typeof Game === 'undefined' || typeof UI === 'undefined') return;
    const modal = document.querySelector('#modal');
    const body = modal && modal.querySelector('.win-body');
    const title = modal && modal.querySelector('.win-title span');
    if (!body || !title || modal.classList.contains('hidden') || !title.textContent.includes('戰法')) return;
    if (body.querySelector('#' + BOX_ID)) return;

    const box = document.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = 'margin:10px 0 14px;padding:12px;border:1px solid rgba(210,170,90,.5);background:rgba(30,22,13,.55);border-radius:6px';
    box.innerHTML = '<div class="sec-t" style="margin-top:0">一鍵轉化武將</div>' +
      '<div class="muted" style="font-size:12px;margin-bottom:8px">選擇要轉化的低星閒置武將。預設只處理同名的多餘卡，避免誤分解唯一武將。</div>' +
      '<label style="margin-right:14px"><input type="checkbox" data-bc-star="2" checked> 2★ 武將</label>' +
      '<label style="margin-right:14px"><input type="checkbox" data-bc-star="3"> 3★ 武將</label>' +
      '<label><input type="checkbox" data-bc-keep checked> 每個同名武將保留 1 張</label>' +
      '<div data-bc-preview class="muted" style="margin:9px 0"></div>' +
      '<button class="btn gold" type="button" data-bc-go>一鍵轉化為戰法點</button>';

    const firstSection = body.querySelector('.sec-t');
    if (firstSection && firstSection.parentNode === body) firstSection.insertAdjacentElement('afterend', box);
    else body.insertBefore(box, body.firstChild);
    box.addEventListener('change', () => updatePreview(box));
    box.querySelector('[data-bc-go]').addEventListener('click', () => convert(box));
    updatePreview(box);
  }

  const obs = new MutationObserver(() => setTimeout(inject, 0));
  function start() {
    const modal = document.querySelector('#modal');
    if (modal) obs.observe(modal, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', e => {
      const open = e.target.closest('[data-act="open"][data-panel="skills"]');
      if (open) setTimeout(inject, 0);
    });
    inject();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
