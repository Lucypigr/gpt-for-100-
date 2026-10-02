'use strict';
// Run with Playwright installed; CHROMIUM_PATH optionally selects a system browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function run() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://test').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox'] });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // External fonts/card art are optional; test the complete local renderer.
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      let releaseArt;
      const artGate = new Promise(resolve => { releaseArt = resolve; });
      if (mobile) await page.route('**/assets/terrain-details.png', async route => {
        await artGate; await route.continue();
      });
      await page.addInitScript(() => {
        window.renderProbe = { mapFilters: 0, tintFilters: 0, canvases: 0 };
        const create = document.createElement.bind(document);
        document.createElement = function (name, ...args) {
          if (name === 'canvas') renderProbe.canvases++;
          return create(name, ...args);
        };
        const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'filter');
        Object.defineProperty(CanvasRenderingContext2D.prototype, 'filter', {
          ...desc, set(value) {
            if (value !== 'none') renderProbe[this.canvas.id === 'map' ? 'mapFilters' : 'tintFilters']++;
            desc.set.call(this, value);
          },
        });
      });
      await page.goto(base + (mobile ? '/play.html' : '/index.html'), { waitUntil: mobile ? 'domcontentloaded' : 'networkidle' });
      assert.equal(await page.evaluate(() => innerWidth), mobile ? 390 : 1280,
        'Missing viewport metadata inflates the mobile layout and Canvas workload');
      await page.evaluate(() => {
        const newGame = Game.newGame;
        Game.newGame = opts => newGame({ ...opts, seed: 20261002, aiCount: 500,
          userState: +document.querySelector('#in-state option').value });
      });
      await page.click('[data-act="newgame"]');
      await page.waitForFunction(() => main.started);
      await page.waitForFunction(() => renderProbe.tintFilters >= 2 || renderProbe.mapFilters > 0);
      assert.equal(await page.evaluate(() => renderProbe.mapFilters), 0,
        'Never apply per-tile filters on the live map');
      if (mobile) {
        // The fallback must be replaced once art arrives, not cached forever.
        const response = page.waitForResponse('**/assets/terrain-details.png');
        releaseArt(); await response;
        await page.waitForFunction(() => renderProbe.tintFilters === 4);
      }
      const baseline = await page.evaluate(() => ({ ...renderProbe }));
      assert.equal(baseline.mapFilters, 0, 'Never apply per-tile filters on the live map');
      assert.equal(baseline.tintFilters, mobile ? 4 : 2, 'Only two tint sprites per source image');
      await page.evaluate(() => {
        window.drawTimes = [];
        const draw = Render.draw;
        Render.draw = function (now) {
          const start = performance.now(); draw(now); drawTimes.push(performance.now() - start);
        };
        Game.G.speed = 20;
      });
      await page.waitForFunction(() => drawTimes.length >= 60);
      const metrics = await page.evaluate(() => {
        const times = drawTimes.slice().sort((a, b) => a - b);
        const oldZoom = Render.cam.tw;
        // Changing zoom must reuse the same two sprites, not grow a zoom/tile cache.
        for (const zoom of [24, 48, 80, 150, 48]) { Render.cam.tw = zoom; Render.draw(performance.now()); }
        Render.cam.tw = oldZoom;
        return { ...renderProbe, count: times.length,
          mean: times.reduce((a, b) => a + b, 0) / times.length,
          p95: times[Math.floor(times.length * .95)], max: times.at(-1) };
      });
      assert.equal(metrics.mapFilters, 0);
      assert.equal(metrics.tintFilters, baseline.tintFilters, 'Tint cache grew during play/zoom');
      assert.equal(metrics.canvases, baseline.canvases, 'Steady-state rendering allocated new canvases');
      const pixels = await page.evaluate(() => {
        const canvas = document.getElementById('map'); return canvas.width * canvas.height;
      });
      assert.ok(pixels <= (mobile ? 390 * 844 * 4 : 1280 * 800), 'Canvas exceeds the viewport/DPR budget');
      assert.ok(metrics.p95 < 250, `Rendering p95 ${metrics.p95}ms exceeded 250ms regression ceiling`);
      await page.click('#modal .close'); // Dismiss the new-season help dialog.
      await page.click('#speed button[data-v="0"]');
      assert.equal(await page.evaluate(() => Game.G.paused), true, 'Pause input must remain usable');
      assert.deepEqual(errors, []);
      console.log(mobile ? 'mobile/play (delayed art)' : 'desktop/index', JSON.stringify(metrics));
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
