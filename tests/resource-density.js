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
// Exercise the real private renderer in a sandbox; do not only match source strings.
const vm = require('node:vm');
const canvases = [];
function makeContext(canvas) {
  let offset = [0, 0]; const stack = [];
  return { canvas, calls: [], save() { stack.push(offset.slice()); },
    restore() { offset = stack.pop(); },
    translate(x, y) { offset[0] += x; offset[1] += y; }, scale() {},
    drawImage(...args) { this.calls.push({ offset: offset.slice(), args }); } };
}
const sandbox = { document: { createElement() {
  const canvas = {}; const context = makeContext(canvas);
  canvas.getContext = () => context; canvases.push(canvas); return canvas;
} } };
const instrumented = render.replace('init, initMini, buildTerrain,',
  `testSetup(map, art) { ctx = map; terrainArt = art; }, testDraw: drawSimpleResourceLand,
   init, initMini, buildTerrain,`);
vm.runInNewContext(instrumented, sandbox);
const map = makeContext({});
Object.defineProperty(map, 'filter', { set() { throw new Error('Live map must not use filters'); } });
sandbox.Render.testSetup(map, { complete: true, naturalWidth: 1024 });
sandbox.Render.testDraw(2, 1, 100, 100, 76, 0);
assert.equal(map.calls.length, 0, 'Level 1 remains clear');
for (let res = 0; res < 4; res++) for (let level = 2; level <= 9; level++) {
  const before = map.calls.length;
  sandbox.Render.testDraw(res, level, 100, 100, 76, 0);
  assert.equal(map.calls.length - before, 1, 'Every resource tile costs one screen draw at every level');
  assert.equal(map.calls.at(-1).args[1], res * 256, 'Select the requested resource');
  assert.equal(map.calls.at(-1).args[2], (level - 2) * 256, 'Select the requested level');
}
const atlas = canvases.find(c => c.width === 1024 && c.height === 2048);
assert.ok(atlas, 'Use one bounded 4-resource × 8-level atlas');
for (let res = 0; res < 4; res++) for (let level = 2; level <= 9; level++) {
  const objects = atlas.getContext().calls.filter(c =>
    c.offset[0] === res * 256 && c.offset[1] === (level - 2) * 256);
  assert.equal(objects.length, level - 1, 'Each higher level must add a resource group');
}
const allocated = canvases.length;
for (const zoom of [24, 58, 76, 150]) for (let level = 2; level <= 9; level++) {
  sandbox.Render.testDraw(2, level, 300, 400, zoom, 1);
}
assert.equal(canvases.length, allocated, 'Zoom and tile position must not allocate more textures');
assert.equal(allocated, 3, 'One atlas plus two pre-tinted rock sources');
assert.ok(render.includes('function drawVisibleTileGrid('),
  '地塊邊界應只由可見範圍渲染');
assert.ok(render.includes('touchDevice && tw < 55'),
  '手機縮小地圖時應停止畫細格線');

for (const html of [index, play]) {
  assert.match(html, /js\/render\.js\?v=20261002-densityatlas1/,
    '頁面應載入效能優先 render.js，避免手機使用舊快取');
}

console.log('Resource density OK: levels 2–9 add 1–8 groups; one screen draw per tile; bounded atlas');
