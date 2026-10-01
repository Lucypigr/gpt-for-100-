// 主循環：玩家在線時，天下（含全部 AI）即時運轉；離開頁面時暫停並存檔
'use strict';

var main = { started: false };

(function () {
  Render.init(document.getElementById('map'));
  UI.init();

  // 面板（例如「創建同盟」）會每秒自動刷新一次。若刷新時使用者正在
  // input / textarea / select 內輸入，refreshPanel() 會重建 DOM，造成欄位
  // 失去焦點；手機上更會讓虛擬鍵盤反覆收起。輸入期間暫停 UI 的週期刷新，
  // 遊戲世界與地圖仍照常運行，離開輸入欄位後下一幀立即恢復更新。
  const uiUpdate = UI.update;
  UI.update = function (now) {
    const active = document.activeElement;
    const editingModalField = active && active.closest && active.closest('#modal') &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (editingModalField) return;
    return uiUpdate(now);
  };

  let last = performance.now();
  let lastSave = performance.now();
  let hiddenPaused = false;
  let lastDay = -1;

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (main.started) {
      const G = Game.G;
      if (!G.paused && !G.over) Game.advance(dt * CFG.BASE_SPEED * G.speed);
      Render.draw(now);
      UI.update(now);
      if (now - lastSave > 60000) {
        lastSave = now;
        if (!Game.save() && !main.saveWarned) { main.saveWarned = true; UI.toast('自動存檔失敗（瀏覽器儲存空間不足），進度仍會每遊戲日備份到「存檔紀錄」', 'bad'); }
        UI.saveMeta();
      }
      // 每過一個遊戲日保留一份自動備份到存檔紀錄
      const day = Game.day();
      if (day !== lastDay) { if (lastDay >= 0) UI.snapshot('auto'); lastDay = day; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 離線（分頁隱藏/關閉）時暫停世界並存檔
  document.addEventListener('visibilitychange', () => {
    if (!main.started) return;
    const G = Game.G;
    if (document.hidden) {
      if (!G.paused) { G.paused = true; hiddenPaused = true; }
      Game.save(); UI.saveMeta();
    } else if (hiddenPaused) {
      G.paused = false; hiddenPaused = false;
      last = performance.now();
    }
  });
  window.addEventListener('beforeunload', () => { if (main.started) { Game.save(); UI.saveMeta(); } });
})();
