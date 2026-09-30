'use strict';

// City art is a square image, but its visible wall/base sits higher than the
// bottom edge of the source texture. The map renderer anchors that square to
// the city tile, which makes large capitals look like they are hovering above
// the isometric ground. Keep the fix isolated to the two city art assets and
// sink their rendered image slightly so the visible wall base meets the tile.
(function () {
  const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (!proto || proto.__cityGroundingPatched) return;

  const nativeDrawImage = proto.drawImage;
  const cityAsset = /(?:^|\/)assets\/city-(?:capital|town)\.png(?:[?#].*)?$/;

  proto.drawImage = function (image, ...args) {
    if (image instanceof HTMLImageElement && args.length === 4) {
      const src = image.getAttribute('src') || image.src || '';
      if (cityAsset.test(src)) {
        const [dx, dy, dw, dh] = args;
        // About 9% of the square texture is visual padding below the useful
        // ground contact. Moving the sprite down restores the isometric anchor.
        return nativeDrawImage.call(this, image, dx, dy + dh * 0.09, dw, dh);
      }
    }
    return nativeDrawImage.call(this, image, ...args);
  };

  proto.__cityGroundingPatched = true;
})();
