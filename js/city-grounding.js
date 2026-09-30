'use strict';

// The city PNGs contain transparent padding below the visible walls. The map
// renderer anchors the full square texture, so the visible city can appear to
// hover above its isometric tile. This small rendering shim fixes only the two
// city art assets: it adds a soft contact shadow at the footprint and lowers
// the art so the wall base visually meets that footprint.
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
        const cx = dx + dw * 0.5;
        const contactY = dy + dh * 0.995;

        // A tight, soft isometric contact shadow removes the sticker/floating
        // look without darkening the whole city tile.
        this.save();
        const grad = this.createRadialGradient(
          cx, contactY, 0,
          cx, contactY, dw * 0.39
        );
        grad.addColorStop(0, 'rgba(31, 39, 24, 0.34)');
        grad.addColorStop(0.55, 'rgba(31, 39, 24, 0.20)');
        grad.addColorStop(1, 'rgba(31, 39, 24, 0)');
        this.fillStyle = grad;
        this.beginPath();
        this.ellipse(cx, contactY, dw * 0.39, dh * 0.075, 0, 0, Math.PI * 2);
        this.fill();

        // A very small dark core directly beneath the front wall gives the
        // wall a definite ground-contact edge on bright farm/plain tiles.
        this.fillStyle = 'rgba(38, 42, 27, 0.16)';
        this.beginPath();
        this.ellipse(cx, contactY - dh * 0.008, dw * 0.27, dh * 0.035, 0, 0, Math.PI * 2);
        this.fill();
        this.restore();

        // The useful ground contact in these square textures sits roughly 9%
        // above their bottom edge, so sink the texture by that amount.
        return nativeDrawImage.call(this, image, dx, dy + dh * 0.09, dw, dh);
      }
    }
    return nativeDrawImage.call(this, image, ...args);
  };

  proto.__cityGroundingPatched = true;
})();
