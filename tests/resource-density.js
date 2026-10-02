'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const render = fs.readFileSync(path.join(root, 'js', 'render.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const play = fs.readFileSync(path.join(root, 'play.html'), 'utf8');

assert.equal(fs.existsSync(path.join(root, 'js', 'resource-density.js')), false,
  '舊 resource-density monkeypatch 不應再存在');
assert.equal(index.includes('resource-density.js'), false,
  'index.html 不得再載入舊 resource-density monkeypatch');
assert.equal(play.includes('resource-density.js'), false,
  'play.html 不得再載入舊 resource-density monkeypatch');

assert.ok(render.includes('const resourceClusterCache = new Map();'),
  'render.js 應使用資源群組快取');
assert.ok(render.includes('if (lv <= 1 || !terrainArt'),
  '1級地應保持乾淨，不繪製資源物件');
assert.ok(render.includes('const count = Math.min(spots.length, level - 1);'),
  '2~9級應逐級增加資源物件數');
assert.ok(render.includes('drawResourceLand(r, lv, sx, sy, tw);'),
  '可見資源地應由原生 render.js 直接繪製');
assert.ok(render.includes('ctx.drawImage(cluster, sx - width / 2'),
  '每塊資源地最終應以單次快取貼圖繪製');

for (const html of [index, play]) {
  assert.match(html, /js\/render\.js\?v=20261002-mapfix1/,
    '頁面應載入新版 render.js，避免手機使用舊快取');
}

console.log('Resource land rendering OK: no global drawImage patch; Lv1 clean; Lv2-9 progressively denser; cached native rendering');
