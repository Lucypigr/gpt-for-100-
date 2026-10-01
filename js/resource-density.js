'use strict';
(function () {
  const proto=window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype;
  if(!proto||proto.__resourceDensityPatched)return;
  const nativeDrawImage=proto.drawImage;
  const terrainAtlas=/(?:^|\/)assets\/terrain-details\.png(?:[?#].*)?$/;
  const spots=[[0,.02,1],[-.22,.10,.78],[.23,.08,.74],[-.10,-.12,.67],[.13,-.13,.62],[0,.18,.56]];
  const countFor=l=>l<=1?0:l===2?1:l===3?2:l===4?2:l===5?3:l===6?4:l===7?5:6;
  const scaleFor=l=>[0,0,.40,.47,.55,.61,.67,.72,.77,.82][Math.min(9,Math.max(0,l))];

  function drawTileGrid(ctx,image,args){
    if(!(image instanceof HTMLCanvasElement)||args.length!==2||typeof World==='undefined'||!World.N)return false;
    const n=World.N;
    if(image.width!==n||image.height!==n)return false;
    const m=ctx.getTransform();
    // The ownership overlay is drawn with the isometric world transform:
    // x axis = (a,b), y axis = (-a,b). Ignore minimap/other N×N canvases.
    if(Math.abs(m.a+m.c)>.05||Math.abs(m.b-m.d)>.05||Math.abs(m.a)<2)return false;
    nativeDrawImage.call(ctx,image,...args);
    const tw=typeof Render!=='undefined'&&Render.cam?Render.cam.tw:48;
    const scale=Math.hypot(m.a,m.b)||1;
    const dpr=Math.max(1,Math.abs(m.a)/(Math.max(1,tw)/2));
    const cssWidth=tw>=70?1.35:tw>=32?1.12:tw>=16?.92:.72;
    ctx.save();
    ctx.globalAlpha=1;
    ctx.strokeStyle=tw>=20?'rgba(45,37,24,.62)':'rgba(45,37,24,.48)';
    ctx.lineWidth=cssWidth*dpr/scale;
    ctx.beginPath();
    for(let k=0;k<=n;k++){
      ctx.moveTo(k,0);ctx.lineTo(k,n);
      ctx.moveTo(0,k);ctx.lineTo(n,k);
    }
    ctx.stroke();
    ctx.restore();
    return true;
  }

  proto.drawImage=function(image,...args){
    // Draw a crisp diamond border around every land tile after the ownership
    // overlay, but before cities, marches and selection effects.
    if(drawTileGrid(this,image,args))return;

    if(!(image instanceof HTMLImageElement)||args.length!==8)return nativeDrawImage.call(this,image,...args);
    const src=image.getAttribute('src')||image.src||'';
    if(!terrainAtlas.test(src)||typeof Render==='undefined'||!Render.tileAt||typeof Game==='undefined'||!Game.T||typeof TERRAIN==='undefined')return nativeDrawImage.call(this,image,...args);
    const[srcX,srcY,srcW,srcH,dx,dy,dw,dh]=args,ax=dx+dw*.5,ay=dy+dh*.82,tile=Render.tileAt(ax,ay);
    if(tile<0||Game.T.terrain[tile]!==TERRAIN.PLAIN)return nativeDrawImage.call(this,image,...args);
    const level=Game.T.lvl[tile]||1,res=Game.T.res[tile],count=countFor(level);
    if(!count)return;
    const half=image.naturalWidth/2;let sx=srcX,sy=srcY;
    if(half>0){if(res===0){sx=0;sy=0;}else if(res===1||res===2){sx=half;sy=0;}else if(res===3){sx=0;sy=half;}}
    const scale=scaleFor(level);
    for(let n=0;n<count;n++){const[ox,oy,local]=spots[n],s=scale*local,w=dw*s,h=dh*s,cx=ax+ox*dw,cy=ay+oy*dh;nativeDrawImage.call(this,image,sx,sy,srcW,srcH,cx-w*.5,cy-h*.82,w,h);}
  };
  proto.__resourceDensityPatched=true;
})();
