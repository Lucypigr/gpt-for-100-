'use strict';
(function () {
  const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (!proto || proto.__resourceDensityPatched) return;
  const nativeDrawImage = proto.drawImage;
  const terrainAtlas = /(?:^|\/)assets\/terrain-details\.png(?:[?#].*)?$/;
  const spots = [[0,.02,1],[-.22,.10,.78],[.23,.08,.74],[-.10,-.12,.67],[.13,-.13,.62],[0,.18,.56]];
  const countFor = l => l<=1?0:l===2?1:l===3?2:l===4?2:l===5?3:l===6?4:l===7?5:6;
  const scaleFor = l => [0,0,.40,.47,.55,.61,.67,.72,.77,.82][Math.min(9,Math.max(0,l))];

  proto.drawImage = function(image, ...args) {
    if (!(image instanceof HTMLImageElement) || args.length !== 8) return nativeDrawImage.call(this,image,...args);
    const src=image.getAttribute('src')||image.src||'';
    if (!terrainAtlas.test(src) || typeof Render==='undefined' || !Render.tileAt || typeof Game==='undefined' || !Game.T || typeof TERRAIN==='undefined') return nativeDrawImage.call(this,image,...args);
    const [srcX,srcY,srcW,srcH,dx,dy,dw,dh]=args;
    const ax=dx+dw*.5, ay=dy+dh*.82, tile=Render.tileAt(ax,ay);
    if (tile<0 || Game.T.terrain[tile]!==TERRAIN.PLAIN) return nativeDrawImage.call(this,image,...args);
    const level=Game.T.lvl[tile]||1, res=Game.T.res[tile], count=countFor(level);
    if (!count) return; // Level 1: grass only.
    const half=image.naturalWidth/2;
    let sx=srcX, sy=srcY;
    if (half>0) {
      if (res===0) { sx=0; sy=0; }          // wood: trees
      else if (res===1) { sx=half; sy=0; } // iron: ore
      else if (res===2) { sx=half; sy=0; } // stone: rocks
      else if (res===3) { sx=0; sy=half; } // grain: fields
    }
    const scale=scaleFor(level);
    for (let n=0;n<count;n++) {
      const [ox,oy,local]=spots[n], s=scale*local, w=dw*s, h=dh*s;
      const cx=ax+ox*dw, cy=ay+oy*dh;
      nativeDrawImage.call(this,image,sx,sy,srcW,srcH,cx-w*.5,cy-h*.82,w,h);
    }
  };
  proto.__resourceDensityPatched=true;
})();
