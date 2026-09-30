// 官網卡圖（僅限本機自用）：在本機瀏覽器執行 index.html 時，直接向《率土之濱》官網載入武將卡圖。
// ・卡圖不存進 repo；武將資料只記錄來源與編號（tw:台服 / cn:網易）。
// ・本機（file://、localhost、區網位址）預設開啟；GitHub Pages 等網址預設關閉，需在「設定」頁自行勾選。
// ・開關只記在這個瀏覽器；嵌入版 play.html 不引用本檔，不會載入任何卡圖。
'use strict';

var CardArt = (function () {
  const CN = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/cards/cut/';
  const TW = 'https://images.gamedreamer.com/stzb/20220721/images/';
  const host = location.hostname;
  const local = location.protocol === 'file:' || host === 'localhost' || host === '[::1]' || host === '::1' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /\.local$/.test(host);
  let pref = null;
  try { pref = localStorage.getItem('stzb_cardart'); } catch (e) { /* */ }
  let on = pref ? pref === 'on' : local;
  return {
    available: true,
    local,
    get on() { return on; },
    set(v) {
      on = !!v;
      try { localStorage.setItem('stzb_cardart', v ? 'on' : 'off'); } catch (e) { /* */ }
    },
    // icon: 'tw:100451'（台服：jzzl 350×480 立繪 / wjzl 100×100 頭像）或 'cn:100451'（網易：medium 240×348 / small 80×80）
    url(icon, size) {
      const [src, id] = String(icon).split(':');
      const small = size === 'small';
      if (src === 'tw') return TW + (small ? 'wjzl' : 'jzzl') + '/card_' + id + '.jpg';
      return CN + 'card_' + (small ? 'small' : 'medium') + '_' + (id || src) + '.jpg?gameid=g10';
    },
  };
})();
