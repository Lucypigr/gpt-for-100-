# 遊玩過載／卡頓紀錄（2026-10-02）

## 問題與根因

500 AI、20× 速度下，Chromium 實測每次 Render.draw 平均約 2.0～2.4 秒，
AI 更新約 31～34ms。CPU profile 大部分時間停在 Canvas 繪圖 flush。
鐵礦與石料地塊每幀逐格設定 brightness/saturate/contrast 濾鏡，
讓 Canvas 在大量繪圖命令中反覆重算影像；軟體渲染環境尤其嚴重。
只降低行軍數或 UI 更新頻率無法解決這個瓶頸。

原有 tests/performance-stress.js 只呼叫 Game.tick()，不會繪製 Canvas，
因此即使通過也不能證明瀏覽器遊玩流暢。

第二個原因是 play.html 缺少 viewport 宣告：390×844 的手機被配置成
980×2121 的桌面版面，DPR 2 畫布達 1960×4240（約 831 萬像素），
是正確手機畫布 780×1688（約 132 萬像素）的 6.3 倍。
單修濾鏡後此入口仍每幀約 162ms，必須一起修正 viewport。

## 修正

- 只在離屏 Canvas 預先生成鐵礦、石料兩張 256×256 調色貼圖。
- 主地圖直接繪製貼圖，不逐格使用 Canvas filter，保留顏色、大小與鏡像。
- 快取只有兩個資源種類，不以格子、縮放、時間作 key；延遲載入正式素材時
  取代備用貼圖，重建地圖時也會依來源更新，不累積歷史版本。
- 同時更新 index.html 與 play.html 的 render.js 版本參數。
- 補齊 play.html 的文件結構與 viewport，避免手機套用桌面寬度與巨型畫布。

同一環境修正後的 15 秒實測：繪圖平均約 26ms、p95 約 29ms、最大約 44ms。
這是本次 Chromium 環境的測量值，非所有裝置或後期存檔的保證。
最終固定種子瀏覽器回歸（500 AI、20×、至少 60 次繪圖）：桌面平均 28.8ms、
p95 34.9ms；手機嵌入版平均 23.0ms、p95 29.6ms。修正前程式執行同一測試，
會因主畫布出現 1215 次濾鏡設定而失敗，確認測試能抓到原始問題。

## 後續編輯規則

1. 不在主地圖逐格套 filter、讀回像素或重新建立貼圖；把固定影像處理移到
   有界的離屏快取。不要重新加入依縮放或世界座標無限成長的快取。
2. 修改地圖、Canvas、貼圖或主循環時，必須跑瀏覽器回歸測試，不能只跑無頭模擬。
   手機入口須保留 viewport 宣告；畫布像素應限制在實際視窗乘 DPR 的範圍。
3. 分別測試桌面、手機 DPR 2、500 AI、20×、縮放、暫停操作、素材延遲載入，
   並涵蓋 index.html、play.html。涉及 AI 或存檔時再跑對應邏輯測試。
4. 發布時兩個 HTML 入口都要更新改動腳本的快取版本。核對 main 與 gh-pages
   的實際歷史後以非強制推送發布；最後核對公開網站提供的腳本。

## 驗證命令

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium
node tests/browser-performance.js
node tests/resource-density.js
node tests/performance-stress.js
```

已有系統 Chromium 可改用 `CHROMIUM_PATH=/usr/bin/chromium node tests/browser-performance.js`。
瀏覽器測試會啟動並關閉自己的本機 HTTP 伺服器，不需要額外手動啟動服務。
測試檢查主畫布濾鏡為零、調色貼圖數有界、穩定繪圖期間沒有新增 Canvas、
延遲載入後更新貼圖、暫停可操作及無頁面錯誤。p95 <250ms 是防秒級退化門檻，
不是理想幀率；效能比較應在相同機器與設定下進行。
