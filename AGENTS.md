# 開發注意事項

修改地圖、Canvas、素材或主循環前，先讀 [docs/performance.md](docs/performance.md)。
目前依使用者要求，地圖繪圖器直接複製自 Lucypigr/claude-for-100 的 gh-pages。
來源提交、檔案與雜湊記錄於 [docs/map-source.json](docs/map-source.json)。
不得修改或推送 claude-for-100；移植與相容性修改只在 GPT 專案進行。
原先自製資源圖集與圖片地圖已被來源繪圖器取代，不要套回舊的城池圖片校正程式。
後續若刻意修改來源繪圖器，記錄差異，並同步更新來源追蹤測試。

曾發生逐格 Canvas filter 讓每幀耗時超過 2 秒、但無頭測試全部通過的問題。
禁止在主地圖逐格套濾鏡；固定影像處理使用有界快取。
手機入口須保留 viewport 宣告，避免畫布膨脹。
相關變更必須執行 `node tests/resource-density.js` 與 `tests/browser-performance.js`
（安裝方式見效能文件），確認來源、等級、地圖座標、兩個入口、500 AI、
桌面與手機，以及穩定繪圖期間沒有增加 Canvas。
邏輯測試不能取代瀏覽器渲染測試。發布腳本變更時同步更新兩個 HTML 的版本參數。

推送 gh-pages 後必須確認 `Deploy game to GitHub Pages` 工作流程部署成功、
提交吻合，才能稱為已部署；Git 推送成功及 CI 測試通過不能代替此驗證。
網站可連線時核對 `build-info.json`。無法驗證時明確說明目前停在哪一步。
