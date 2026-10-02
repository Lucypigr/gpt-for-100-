'use strict';
// Map import regression: preserve the requested source and its public contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const render = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'docs/map-source.json'), 'utf8'));
assert.equal(crypto.createHash('sha256').update(render).digest('hex'), provenance.sha256,
  'Renderer must match the imported source; document any deliberate future divergence');
for (const file of ['index.html', 'play.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(html, /js\/render\.js\?v=claude-632b867-map1/);
  assert.equal(html.includes('city-grounding.js'), false, 'Do not apply the old artwork shim');
}
const labels = [];
let drawCalls = 0;
const context = new Proxy({}, { get(target, key) {
  if (key === 'fillText') return text => { labels.push(text); drawCalls++; };
  if (key in target) return target[key];
  return () => { drawCalls++; };
}, set(target, key, value) {
  assert.notEqual(key, 'filter', 'Imported map must not reintroduce Canvas filters');
  target[key] = value; return true;
} });
const T = { terrain: new Uint8Array(81), res: new Uint8Array(81), lvl: new Uint8Array(81) };
for (let y=0;y<9;y++) for (let x=0;x<4;x++) { T.res[y*9+x]=x; T.lvl[y*9+x]=y+1; }
const sandbox = { window: { devicePixelRatio:1, addEventListener() {} },
  TERRAIN: { PLAIN:0, MOUNTAIN:1, WATER:2 }, Game: { T } };
const instrumented = render.replace('init, initMini, buildTerrain,',
  'testDetails() { N=9; drawDetails(0,3,0,8,40,20,80); }, init, initMini, buildTerrain,');
vm.runInNewContext(instrumented, sandbox);
const R = sandbox.Render;
R.init({ clientWidth:800, clientHeight:800, getContext:() => context });
R.cam.cx=2; R.cam.cy=4; R.cam.tw=80;
R.testDetails();
assert.ok(drawCalls > 0, 'Visible resource details must be drawn');
for (let level=1;level<=9;level++) assert.equal(labels.filter(x=>x===level).length,4,
  'Every resource type must show the correct land level');
for (const [x,y] of [[.5,.5],[2.5,4.5],[3.5,8.5]]) {
  const screen = R.toScreen(x,y);
  const grid = R.toGrid(...screen);
  assert.ok(Math.abs(grid[0]-x)<1e-8 && Math.abs(grid[1]-y)<1e-8);
  assert.equal(R.tileAt(...screen),Math.floor(y)*9+Math.floor(x));
}
console.log('Imported map OK: exact source, level labels and selection coordinates');
