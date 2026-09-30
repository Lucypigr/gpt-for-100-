// 主循環：玩家在線時，天下（含全部 AI）即時運轉；離開頁面時暫停並存檔
'use strict';

var main = { started: false };

(function () {
  Render.init(document.getElementById('map'));
  UI.init();
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
