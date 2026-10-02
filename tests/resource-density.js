'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function ok(v, m) { if (!v) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'not equal') + ': ' + a + ' vs ' + b); }

const created = [];
class CanvasRenderingContext2D {
  constructor(canvas) { this.canvas = canvas; this.nativeCalls = 0; this.filter = 'none'; }
  drawImage() { this.nativeCalls++; }
  getTransform() { return { a: 3, b: 1, c: -3, d: 1 }; }
  save() {}
  restore() {}
  stroke() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
}
class HTMLCanvasElement {
  constructor() { this.width = 0; this.height = 0; this.ctx = new CanvasRenderingContext2D(this); }
  getContext() { return this.ctx; }
}
class HTMLImageElement {
  constructor() { this.src = 'assets/terrain-details.png'; this.naturalWidth = 100; this.naturalHeight = 100; }
  getAttribute() { return this.src; }
}
class Path2D {
  moveTo() {}
  lineTo() {}
}

const ctx = {
  console,
  window: { CanvasRenderingContext2D },
  CanvasRenderingContext2D,
  HTMLCanvasElement,
  HTMLImageElement,
  Path2D,
  document: {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
      const c = new HTMLCanvasElement();
      created.push(c);
      return c;
    }
  },
  World: { N: 550 },
  Render: { cam: { tw: 48 }, tileAt: () => 0 },
  Game: { T: { terrain: [0], lvl: [3], res: [2] } },
  TERRAIN: { PLAIN: 0 },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'resource-density.js'), 'utf8');
vm.runInContext(source, ctx, { filename: 'js/resource-density.js' });

const target = new ctx.CanvasRenderingContext2D({ width: 1, height: 1 });
const image = new ctx.HTMLImageElement();

target.drawImage(image, 0, 0, 50, 50, 0, 0, 48, 48);
eq(target.nativeCalls, 1, '3級石料每格應只做一次最終繪圖');
eq(created.length, 1, '3級石料應建立一份合成快取');
eq(created[0].ctx.nativeCalls, 2, '3級石料應合成2組石頭');

ctx.Game.T.lvl[0] = 4;
target.drawImage(image, 0, 0, 50, 50, 0, 0, 48, 48);
eq(target.nativeCalls, 2, '4級石料每格應只做一次最終繪圖');
eq(created.length, 2, '4級石料應建立獨立合成快取');
eq(created[1].ctx.nativeCalls, 3, '4級石料應合成3組石頭');

target.drawImage(image, 0, 0, 50, 50, 0, 0, 48, 48);
eq(target.nativeCalls, 3, '快取後仍只應增加一次最終繪圖');
eq(created.length, 2, '重畫4級石料不得重建合成快取');

ctx.Game.T.lvl[0] = 1;
target.drawImage(image, 0, 0, 50, 50, 0, 0, 48, 48);
eq(target.nativeCalls, 3, '1級地不得繪製資源物件');

console.log('Resource density OK: 3級=2組、4級=3組，且每格最終只繪製一次並重用快取');
