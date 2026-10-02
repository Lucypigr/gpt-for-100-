'use strict';
(function () {
  const proto=window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype;
  if(!proto||proto.__resourceDensityPatched)return;
  const nativeDrawImage=proto.drawImage;
  const terrainAtlas=/(?:^|\/)assets\/terrain-details\.png(?:[?#].*)?$/;
  const spots=[[0,.02,1],[-.22,.10,.78],[.23,.08,.74],[-.10,-.12,.67],[.13,-.13,.62],[0,.18,.56],[-.28,-.06,.50],[.29,-.05,.48]];
  const countFor=l=>Math.max(0,Math.min(spots.length,(l|0)-1));
  const scaleFor=l=>[0,0,.40,.47,.55,.61,.67,.72,.77,.82][Math.min(9,Math.max(0,l))];
  const spriteCache=new Map();
  const BOX={l:-.25,t:-.16,r:1.25,b:1.20};
  let gridPath=null,gridN=0;

  function getGridPath(n){
    if(typeof Path2D==='undefined')return null;
    if(gridPath&&gridN===n)return gridPath;
    const p=new Path2D();
    for(let k=0;k<=n;k++){
      p.moveTo(k,0);p.lineTo(k,n);
      p.moveTo(0,k);p.lineTo(n,k);
    }
    gridPath=p;gridN=n;
    return p;
  }

  function drawTileGrid(ctx,image,args){
    if(typeof HTMLCanvasElement==='undefined'||!(image instanceof HTMLCanvasElement)||args.length!==2||typeof World==='undefined'||!World.N)return false;
    const n=World.N;
    if(image.width!==n||image.height!==n)return false;
    const m=ctx.getTransform();
    if(Math.abs(m.a+m.c)>.05||Math.abs(m.b-m.d)>.05||Math.abs(m.a)<2)return false;
    nativeDrawImage.call(ctx,image,...args);
    const tw=typeof Render!=='undefined'&&Render.cam?Render.cam.tw:48;
    // 遠景格線太密且無法辨識，略過可大幅減少大地圖每幀描邊負擔。
    if(tw<20)return true;
    const scale=Math.hypot(m.a,m.b)||1;
    const dpr=Math.max(1,Math.abs(m.a)/(Math.max(1,tw)/2));
    const cssWidth=tw>=70?1.35:tw>=32?1.12:.92;
    ctx.save();
    ctx.globalAlpha=1;
    ctx.strokeStyle=tw>=20?'rgba(45,37,24,.62)':'rgba(45,37,24,.48)';
    ctx.lineWidth=cssWidth*dpr/scale;
    const path=getGridPath(n);
    if(path)ctx.stroke(path);
    else{
      ctx.beginPath();
      for(let k=0;k<=n;k++){
        ctx.moveTo(k,0);ctx.lineTo(k,n);
        ctx.moveTo(0,k);ctx.lineTo(n,k);
      }
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  function compositeFor(image,sx,sy,srcW,srcH,res,level,count){
    const iw=image.naturalWidth||image.width||0,ih=image.naturalHeight||image.height||0;
    const key=[iw,ih,sx,sy,srcW,srcH,res,level].join(':');
    let cv=spriteCache.get(key);
    if(cv)return cv;
    cv=document.createElement('canvas');
    const bw=BOX.r-BOX.l,bh=BOX.b-BOX.t,CW=160,CH=Math.max(1,Math.round(CW*bh/bw));
    cv.width=CW;cv.height=CH;
    const c=cv.getContext('2d');
    c.imageSmoothingEnabled=true;
    const scale=scaleFor(level);
    const family=res===1?.86:res===2?1.06:1;
    for(let n=0;n<count;n++){
      const[ox,oy,local]=spots[n];
      const s=scale*local*family;
      const nx=.5+ox-s*.5,ny=.82+oy-s*.82;
      nativeDrawImage.call(c,image,sx,sy,srcW,srcH,
        (nx-BOX.l)/bw*CW,(ny-BOX.t)/bh*CH,s/bw*CW,s/bh*CH);
    }
    spriteCache.set(key,cv);
    return cv;
  }

  proto.drawImage=function(image,...args){
    if(drawTileGrid(this,image,args))return;
    if(typeof HTMLImageElement==='undefined'||!(image instanceof HTMLImageElement)||args.length!==8)return nativeDrawImage.call(this,image,...args);
    const src=image.getAttribute('src')||image.src||'';
    if(!terrainAtlas.test(src)||typeof Render==='undefined'||!Render.tileAt||typeof Game==='undefined'||!Game.T||typeof TERRAIN==='undefined')return nativeDrawImage.call(this,image,...args);
    const[srcX,srcY,srcW,srcH,dx,dy,dw,dh]=args,ax=dx+dw*.5,ay=dy+dh*.82,tile=Render.tileAt(ax,ay);
    if(tile<0||Game.T.terrain[tile]!==TERRAIN.PLAIN)return nativeDrawImage.call(this,image,...args);
    const level=Game.T.lvl[tile]||1,res=Game.T.res[tile],count=countFor(level);
    if(!count)return;
    const half=image.naturalWidth/2;let sx=srcX,sy=srcY;
    if(half>0){
      if(res===0){sx=0;sy=0;}
      else if(res===1||res===2){sx=half;sy=0;}
      else if(res===3){sx=0;sy=half;}
    }
    const composite=compositeFor(image,sx,sy,srcW,srcH,res,level,count);
    const bw=BOX.r-BOX.l,bh=BOX.b-BOX.t;
    this.save();
    if(res===1)this.filter='brightness(.68) saturate(.55) contrast(1.22)';
    else if(res===2)this.filter='brightness(1.14) saturate(.42) contrast(.94)';
    // 每塊資源地現在只做一次畫布繪製；2~9級的數量差異已預先合成並快取。
    nativeDrawImage.call(this,composite,dx+BOX.l*dw,dy+BOX.t*dh,bw*dw,bh*dh);
    this.restore();
  };
  proto.__resourceDensityPatched=true;
})();