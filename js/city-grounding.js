'use strict';

// The painted city assets were rendered from a slightly steeper camera than
// the 2:1 isometric world map. Simply moving the square PNG down fixes its
// anchor, but the steeper projection still makes the city read as if it were
// hovering above the terrain. This shim corrects both the ground contact and
// the projection without changing gameplay/world coordinates.
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

        // The map uses a 2:1 isometric projection. The source city art is a
        // little too top-down, so flatten its screen-space Y axis while keeping
        // the visual ground contact fixed. This is a camera-angle correction,
        // not another arbitrary downward offset.
        const perspectiveY = 0.86;
        const correctedH = dh * perspectiveY;
        const groundY = dy + dh * 1.09;
        const correctedY = groundY - correctedH;
        const cx = dx + dw * 0.5;

        // Contact shadow follows the same shallow isometric footprint as the
        // terrain diamonds, so the city sits in the map instead of over it.
        this.save();
        const grad = this.createRadialGradient(cx, groundY, 0, cx, groundY, dw * 0.40);
        grad.addColorStop(0, 'rgba(29, 37, 23, 0.36)');
        grad.addColorStop(0.58, 'rgba(29, 37, 23, 0.19)');
        grad.addColorStop(1, 'rgba(29, 37, 23, 0)');
        this.fillStyle = grad;
        this.beginPath();
        this.ellipse(cx, groundY, dw * 0.40, correctedH * 0.055, 0, 0, Math.PI * 2);
        this.fill();
        this.fillStyle = 'rgba(34, 39, 25, 0.18)';
        this.beginPath();
        this.ellipse(cx, groundY - correctedH * 0.008, dw * 0.27, correctedH * 0.025, 0, 0, Math.PI * 2);
        this.fill();
        this.restore();

        return nativeDrawImage.call(this, image, dx, correctedY, dw, correctedH);
      }
    }
    return nativeDrawImage.call(this, image, ...args);
  };

  proto.__cityGroundingPatched = true;
})();
