'use strict';

// Resource-land visual rule:
// L1 = clean grass. From L2 upward, every level increases visible resource mass.
// Gameplay data is untouched; this layer only changes map presentation.
(function () {
  const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (!proto || proto.__resourceDensityPatched) return;

  const nativeDrawImage = proto.drawImage;
  const terrainAtlas = /(?:^|\/)assets\/terrain-details\.png(?:[?#].*)?$/;
  const spots = [
    [ 0.00,  0.02, 1.00], [-0.22,  0.10, 0.78], [ 0.23,  0.08, 0.74],
    [-0.10, -0.12, 0.67], [ 0.13, -0.13, 0.62], [ 0.00,  0.18, 0.56],
  ];

  function clusterCount(level) {
    if (level <= 1) return 0;
    if (level === 2) return 1;
    if (level === 3) return 2;
    if (level === 4) return 2;
    if (level === 5) return 3;
    if (level === 6) return 4;
    if (level === 7) return 5;
    return 6;
  }
  function baseScale(level) {
    return [0, 0, 0.40, 0.47, 0.55, 0.61, 0.67, 0.72, 0.77, 0.82][Math.min(9, Math.max(0, level))];
  }

  proto.drawImage = function (image, ...args) {
    if (!(image instanceof HTMLImageElement) || args.length !== 8) return nativeDrawImage.call(this, image, ...args);
    const src = image.getAttribute('src') || image.src || '';
    if (!terrainAtlas.test(src) || typeof Render === 'undefined' || !Render.tileAt ||
        typeof Game === 'undefined' || !Game.T || typeof TERRAIN === 'undefined') {
      return nativeDrawImage.call(this, image, ...args);
    }

    const [srcX, srcY, srcW, srcH, dx, dy, dw, dh] = args;
    const anchorX = dx + dw * 0.5;
    const anchorY = dy + dh * 0.82;
    const tile = Render.tileAt(anchorX, anchorY);
    if (tile < 0 || Game.T.terrain[tile] !== TERRAIN.PLAIN) return nativeDrawImage.call(this, image, ...args);

    const level = Game.T.lvl[tile] || 1;
    const resource = Game.T.res[tile];
    const count = clusterCount(level);
    if (count === 0) return; // L1: grass only.

    const half = image.naturalWidth / 2;
    let sx = srcX, sy = srcY;
    if (half > 0) {
      if (resource === 0) { sx = 0; sy = 0; }          // wood: trees
      else if (resource === 1) { sx = half; sy = 0; } // iron: ore
      else if (resource === 2) { sx = half; sy = 0; } // stone: rocks
      else if (resource === 3) { sx = 0; sy = half; } // grain: fields
    }

    const scale = baseScale(level);
    for (let n = 0; n < count; n++) {
      const [ox, oy, local] = spots[n];
      const s = scale * local, w = dw * s, h = dh * s;
      const cx = anchorX + ox * dw, ay = anchorY + oy * dh;
      nativeDrawImage.call(this, image, sx, sy, srcW, srcH, cx - w * 0.5, ay - h * 0.82, w, h);
    }
  };
  proto.__resourceDensityPatched = true;
})();
