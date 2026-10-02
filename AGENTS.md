# 開發注意事項

修改地圖、Canvas、素材或主循環前，先讀 [docs/performance.md](docs/performance.md)。
曾發生逐格 Canvas filter 讓每幀耗時超過 2 秒、但無頭測試全部通過的問題。
主地圖禁止逐格套濾鏡；固定影像效果應使用有界離屏快取。
手機入口須保留 viewport 宣告，避免手機被當成桌面渲染而膨脹畫布。
資源地目前以固定 4×8 圖集呈現 2～9 級的遞增群數；每格每幀只能繪製一次。
修改此功能需同時跑 `node tests/resource-density.js`，保留群數與快取上限檢查。

相關變更必須執行 `tests/browser-performance.js`（安裝方式見上述文件），
涵蓋兩個入口、500 AI、桌面與手機、素材延遲載入及快取不增長。
邏輯測試不能取代瀏覽器渲染測試。發布腳本變更時同步更新兩個 HTML 的版本參數。
