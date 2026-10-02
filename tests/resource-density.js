'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const render = fs.readFileSync(path.join(root, 'js', 'render.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const play = fs.readFileSync(path.join(root, 'play.html'), 'utf8');

assert.equal(fs.existsSync(path.join(root, 'js', 'resource-density.js')), false,
  '舊 resource-density monkeypatch 不應存在');
assert.equal(index.includes('resource-density.js'), false,
  'index.html 不得載入舊 resource-density monkeypatch');
assert.equal(play.includes('resource-density.js'), false,
  'play.html 不得載入舊 resource-density monkeypatch');

assert.ok(render.includes('function drawSimpleResourceLand('),
  'render.js 應使用簡化資源地繪製');
assert.ok(render.includes('if (lv <= 1) return;'),
  '1級地應保持乾淨，不繪製資源物件');
assert.ok(render.includes("const size = 0.46 + (level - 2) * 0.045;"),
  '2~9級只應以單一圖案大小區分');
assert.ok(render.includes('drawSimpleResourceLand(r, lv, sx, sy, tw, Math.floor(h * 10));'),
  '可見資源地應使用簡化單圖案渲染');
assert.equal(render.includes('resourceClusterCache'), false,
  '不得保留多圖案資源群組快取');
assert.equal(render.includes('const count = Math.min(spots.length, level - 1);'), false,
  '不得恢復每級多次資源繪圖');
assert.ok(render.includes('function drawVisibleTileGrid('),
  '地塊邊界應只由可見範圍渲染');
assert.ok(render.includes('touchDevice && tw < 55'),
  '手機縮小地圖時應停止畫細格線');

for (const html of [index, play]) {
  assert.match(html, /js\/render\.js\?v=20261002-mapfix3/,
    '頁面應載入效能優先 render.js，避免手機使用舊快取');
}

console.log('Simple map rendering OK: Lv1 clean; one resource sprite max per tile; mobile grid throttled');
