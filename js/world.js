// 天下地圖生成：十三州、關口、城池、山川河流、土地等級
'use strict';

var TERRAIN = { PLAIN: 0, MOUNTAIN: 1, WATER: 2, CITY: 3 };

var STATE_DEFS = [
  // u: 左(-1)~右(+1)  v: 上(0)~下(2)（菱形地圖的螢幕座標）
  { name: '司隸', type: 'center', u: 0.0, v: 0.98, w: 0.8 },
  { name: '雍州', type: 'resource', u: -0.36, v: 0.98, w: 0.85 },
  { name: '兗州', type: 'resource', u: 0.34, v: 0.88, w: 0.85 },
  { name: '豫州', type: 'resource', u: 0.17, v: 1.28, w: 0.85 },
  { name: '涼州', type: 'birth', u: -0.74, v: 0.98, w: 1.12 },
  { name: '并州', type: 'birth', u: -0.28, v: 0.58, w: 1.05 },
  { name: '冀州', type: 'birth', u: 0.06, v: 0.42, w: 1.0 },
  { name: '幽州', type: 'birth', u: 0.42, v: 0.56, w: 1.05 },
  { name: '青州', type: 'birth', u: 0.74, v: 0.95, w: 1.05 },
  { name: '徐州', type: 'birth', u: 0.56, v: 1.3, w: 1.05 },
  { name: '揚州', type: 'birth', u: 0.28, v: 1.62, w: 1.1 },
  { name: '荊州', type: 'birth', u: -0.12, v: 1.55, w: 1.05 },
  { name: '益州', type: 'birth', u: -0.5, v: 1.36, w: 1.12 },
];

var CITY_NAMES = {
  '司隸': ['洛陽', '弘農', '河內', '河南', '河東', '滎陽', '偃師', '緱氏'],
  '雍州': ['長安', '扶風', '馮翊', '北地', '新平', '陳倉', '武功', '藍田'],
  '兗州': ['濮陽', '陳留', '東郡', '濟陰', '山陽', '泰山', '任城', '昌邑'],
  '豫州': ['許昌', '潁川', '汝南', '梁國', '沛國', '陳國', '魯國', '譙縣'],
  '涼州': ['武威', '金城', '酒泉', '張掖', '敦煌', '天水', '隴西', '安定', '西平'],
  '并州': ['晉陽', '上黨', '雁門', '西河', '太原', '雲中', '五原', '朔方', '上郡'],
  '冀州': ['鄴城', '渤海', '中山', '常山', '鉅鹿', '河間', '清河', '安平', '魏郡'],
  '幽州': ['薊城', '涿郡', '遼東', '右北平', '漁陽', '代郡', '上谷', '遼西', '玄菟'],
  '青州': ['臨淄', '北海', '東萊', '平原', '濟南', '樂安', '齊國', '城陽'],
  '徐州': ['下邳', '彭城', '琅琊', '東海', '廣陵', '小沛', '臨沂', '郯縣'],
  '揚州': ['建業', '吳郡', '會稽', '丹陽', '廬江', '豫章', '廬陵', '九江', '柴桑'],
  '荊州': ['襄陽', '江陵', '長沙', '南陽', '江夏', '武陵', '零陵', '桂陽', '新野'],
  '益州': ['成都', '漢中', '巴郡', '梓潼', '江州', '永安', '建寧', '越巂', '犍為'],
};
var PASS_NAMES = ['虎牢關', '函谷關', '潼關', '武關', '壺關', '汜水關', '陽平關', '劍閣', '散關', '井陘關', '居庸關', '雁門關', '天井關', '蕭關',
  '白馬津', '官渡', '延津', '孟津', '葭萌關', '白帝', '江陵渡', '濡須口', '合肥', '樊城', '宛城', '街亭', '祁山', '陰平', '漢津', '夏口', '柴桑渡', '瓦口關', '鄴關', '定軍山', '五丈原', '上庸', '箕谷', '斜谷'];

var World = (function () {
  let N = 0;
  const W = {};

  function idx(x, y) { return y * N + x; }
  function X(i) { return i % N; }
  function Y(i) { return (i / N) | 0; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
  const D8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  function neighbors8(i, out) {
    out.length = 0;
    const x = X(i), y = Y(i);
    for (const d of D8) {
      const nx = x + d[0], ny = y + d[1];
      if (nx >= 0 && ny >= 0 && nx < N && ny < N) out.push(ny * N + nx);
    }
    return out;
  }
  function dist(a, b) { const dx = X(a) - X(b), dy = Y(a) - Y(b); return Math.sqrt(dx * dx + dy * dy); }

  function uvToGrid(u, v) { return [N * (v + u) / 2, N * (v - u) / 2]; }

  // ver：地圖生成版本（舊存檔用舊版比例重建，確保讀檔一致）
  function generate(seed, n, ver) {
    N = n || CFG.MAP_N;
    W.N = N;
    W.seed = seed;
    const rng = U.makeRng(seed);
    const pick = a => a[Math.floor(rng() * a.length)];
    const nz1 = U.makeNoise(seed + 1), nz2 = U.makeNoise(seed + 2), nz3 = U.makeNoise(seed + 3), nz4 = U.makeNoise(seed + 4), nz5 = U.makeNoise(seed + 5);
    const NN = N * N;
    const T = {
      terrain: new Uint8Array(NN),
      state: new Uint8Array(NN),
      lvl: new Uint8Array(NN),
      res: new Uint8Array(NN),
      owner: new Int16Array(NN).fill(-1),
      city: new Int16Array(NN).fill(-1),
    };
    W.T = T;
    const states = STATE_DEFS.map((s, i) => {
      const g = uvToGrid(s.u, s.v);
      return { id: i, name: s.name, type: s.type, w: s.w, sx: g[0], sy: g[1], tiles: 0, capital: -1, cities: [] };
    });
    W.states = states;

    // 1) 州分區（加權 Voronoi + 雜訊擾動）
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        const px = x + (nz1(x * 0.02, y * 0.02, 3) - 0.5) * N * 0.16;
        const py = y + (nz1(x * 0.02 + 50, y * 0.02 + 50, 3) - 0.5) * N * 0.16;
        let best = 0, bd = 1e18;
        for (const s of states) {
          const dx = px - s.sx, dy = py - s.sy;
          const d = Math.sqrt(dx * dx + dy * dy) / s.w;
          if (d < bd) { bd = d; best = s.id; }
        }
        T.state[i] = best;
      }
    }
    // 2) 州界山脈 + 地圖邊緣
    const tmp = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2) { T.terrain[i] = TERRAIN.MOUNTAIN; continue; }
        neighbors8(i, tmp);
        for (const j of tmp) if (T.state[j] !== T.state[i]) { T.terrain[i] = TERRAIN.MOUNTAIN; break; }
      }
    }
    // 3) 州內零星山地
    for (let y = 2; y < N - 2; y++) {
      for (let x = 2; x < N - 2; x++) {
        const i = idx(x, y);
        if (T.terrain[i] !== TERRAIN.PLAIN) continue;
        const m = nz4(x * 0.09, y * 0.09, 3);
        if (m > 0.73 && rng() < 0.85) T.terrain[i] = TERRAIN.MOUNTAIN;
      }
    }
    // 4) 河流（黃河、長江），留渡口
    function river(pointsUV, name) {
      const pts = pointsUV.map(p => uvToGrid(p[0], p[1]));
      let step = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
        const len = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
        for (let s = 0; s <= len; s++) {
          const t = s / len;
          let x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          x += (nz5(x * 0.05, y * 0.05) - 0.5) * 10;
          y += (nz5(x * 0.05 + 9, y * 0.05 + 9) - 0.5) * 10;
          const ix = Math.round(x), iy = Math.round(y);
          step++;
          const ford = (Math.floor(step / 2) % 26) < 3;
          for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
            const qx = ix + ox, qy = iy + oy;
            if (!inb(qx, qy)) continue;
            const q = idx(qx, qy);
            if (ford) { if (T.terrain[q] === TERRAIN.WATER) continue; else continue; }
            if (T.terrain[q] === TERRAIN.PLAIN) T.terrain[q] = TERRAIN.WATER;
          }
        }
      }
    }
    river([[-0.95, 0.9], [-0.55, 0.72], [-0.2, 0.8], [0.15, 0.72], [0.45, 0.72], [0.82, 0.86]], '黃河');
    river([[-0.75, 1.2], [-0.35, 1.42], [0.0, 1.4], [0.3, 1.46], [0.55, 1.42], [0.7, 1.25]], '長江');

    // 5) 城池
    const cities = [];
    W.cities = cities;
    function footprintOk(cx, cy, size, st, spacing) {
      const h = (size - 1) >> 1;
      for (let y = cy - h; y <= cy + h; y++) for (let x = cx - h; x <= cx + h; x++) {
        if (!inb(x, y)) return false;
        const i = idx(x, y);
        if (T.state[i] !== st || T.terrain[i] !== TERRAIN.PLAIN || T.city[i] >= 0) return false;
      }
      for (const c of cities) {
        if (Math.abs(c.cx - cx) < spacing && Math.abs(c.cy - cy) < spacing) return false;
      }
      return true;
    }
    function placeCity(type, lvl, cx, cy, size, st, name) {
      const c = {
        id: cities.length, type, name, lvl, state: st, cx, cy, size, tiles: [],
        alliance: -1, owner: -1, dur: 0, maxDur: 0, garrison: null, resetAt: 0, capturedAt: -1, holdSince: -1, firstBy: -1,
      };
      const h = (size - 1) >> 1;
      for (let y = cy - h; y <= cy + h; y++) for (let x = cx - h; x <= cx + h; x++) {
        const i = idx(x, y);
        T.terrain[i] = TERRAIN.CITY;
        T.city[i] = c.id;
        T.state[i] = st;
        c.tiles.push(i);
      }
      if (CFG.CITY_GARRISON[lvl]) { c.maxDur = CFG.CITY_GARRISON[lvl][3]; c.dur = c.maxDur; }
      cities.push(c);
      states[st].cities.push(c.id);
      return c;
    }
    function carveArea(cx, cy, r) {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (x < 3 || y < 3 || x >= N - 3 || y >= N - 3) continue;
        const i = idx(x, y);
        if (T.terrain[i] !== TERRAIN.CITY) {
          let bord = false;
          neighbors8(i, tmp);
          for (const j of tmp) if (T.state[j] !== T.state[i]) bord = true;
          if (!bord) T.terrain[i] = TERRAIN.PLAIN;
        }
      }
    }
    for (const s of states) {
      const names = CITY_NAMES[s.name].slice();
      const cx = Math.round(s.sx), cy = Math.round(s.sy);
      carveArea(cx, cy, 4);
      const capLvl = s.type === 'center' ? 10 : 9;
      const cap = placeCity(s.type === 'center' ? 'luoyang' : 'capital', capLvl, cx, cy, 5, s.id, names.shift());
      s.capital = cap.id;
      // 州內其他城池
      // 地圖放大時城池數量依面積等比增加
      const area = (N / 300) * (N / 300);
      const nCom = Math.round(2 * area), nCounty = Math.round((s.type === 'birth' ? 6 : 4) * area);
      const plan = [];
      for (let k = 0; k < nCom; k++) plan.push(['commandery', s.type === 'birth' ? 7 : 8]);
      for (let k = 0; k < nCounty; k++) plan.push(['county', s.type === 'birth' ? (k < 3 ? 5 : 6) : 6]);
      for (const [type, lvl] of plan) {
        let placed = false;
        for (let tries = 0; tries < 4000 && !placed; tries++) {
          const r = (type === 'commandery' ? 0.35 : 0.2) + rng() * 0.75;
          const ang = rng() * Math.PI * 2;
          const rad = Math.sqrt(s.w) * N * 0.13 * r;
          const x = Math.round(s.sx + Math.cos(ang) * rad), y = Math.round(s.sy + Math.sin(ang) * rad);
          if (!inb(x, y)) continue;
          if (footprintOk(x, y, 3, s.id, 14)) {
            placeCity(type, lvl, x, y, 3, s.id, names.length ? names.shift() : s.name.slice(0, 1) + '城' + '甲乙丙丁戊己庚辛壬癸'[(s.extra = (s.extra || 0) + 1) % 10]);
            placed = true;
          }
        }
      }
    }
    // 6) 關口
    const pairCount = new Map();
    const pairCand = new Map();
    for (let y = 3; y < N - 3; y++) {
      for (let x = 3; x < N - 3; x++) {
        const i = idx(x, y);
        const a = T.state[i];
        const b1 = T.state[idx(x + 1, y)], b2 = T.state[idx(x, y + 1)];
        for (const b of [b1, b2]) {
          if (b === a) continue;
          const key = Math.min(a, b) * 100 + Math.max(a, b);
          pairCount.set(key, (pairCount.get(key) || 0) + 1);
          if (!pairCand.has(key)) pairCand.set(key, []);
          pairCand.get(key).push(i);
        }
      }
    }
    const passNames = PASS_NAMES.slice();
    // 官方關名用完時（大地圖），以兩州首字命名：如「涼雍關」，重複則加序號
    const passUsed = {};
    const uniqPass = base => { const k = passUsed[base] = (passUsed[base] || 0) + 1; return base + (k > 1 ? '二三四五六七八九十'[k - 2] || k : '') + '關'; };
    W.passes = [];
    for (const [key, cnt] of pairCount) {
      if (cnt < 12) continue;
      const a = Math.floor(key / 100), b = key % 100;
      const cand = pairCand.get(key);
      const nPass = cnt > 90 ? 2 : 1;
      const chosen = [];
      // 候選點依沿界排序後取分位點
      cand.sort((p, q) => (X(p) + Y(p) * 0.5) - (X(q) + Y(q) * 0.5));
      const fr = nPass === 1 ? [0.5] : [0.28, 0.72];
      for (const f of fr) {
        let found = -1;
        for (let off = 0; off < cand.length && found < 0; off++) {
          for (const sgn of [1, -1]) {
            const k = Math.floor(cand.length * f) + sgn * off;
            if (k < 0 || k >= cand.length) continue;
            const c = cand[k];
            const cx = X(c), cy = Y(c);
            if (cx < 5 || cy < 5 || cx > N - 6 || cy > N - 6) continue;
            let ok = true;
            for (let yy = cy - 1; yy <= cy + 1 && ok; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) if (T.city[idx(xx, yy)] >= 0) { ok = false; break; }
            for (const cc of cities) if (Math.abs(cc.cx - cx) < 8 && Math.abs(cc.cy - cy) < 8) ok = false;
            if (ok) { found = c; break; }
          }
        }
        if (found >= 0) chosen.push(found);
      }
      for (const c of chosen) {
        const cx = X(c), cy = Y(c);
        const sa = states[a], sb = states[b];
        let lvl = 7;
        if (sa.type === 'center' || sb.type === 'center') lvl = 9;
        else if (sa.type === 'resource' || sb.type === 'resource') lvl = 8;
        const pc = placeCity('pass', lvl, cx, cy, 3, T.state[c], passNames.length ? passNames.splice(Math.floor(rng() * passNames.length), 1)[0] : uniqPass(sa.name[0] + sb.name[0]));
        pc.link = [a, b];
        W.passes.push(pc.id);
        // 開鑿兩側通道
        for (const st of [a, b]) carveTo(pc, st);
      }
    }
    function carveTo(pc, st) {
      // BFS 從關口外圍往 st 州內找到最近平地
      const start = [];
      for (const t of pc.tiles) {
        neighbors8(t, tmp);
        for (const j of tmp) if (T.city[j] < 0 && T.state[j] === st) start.push(j);
      }
      const prev = new Map();
      const q = [];
      for (const s of start) { prev.set(s, -1); q.push(s); }
      let goal = -1;
      for (let h = 0; h < q.length && goal < 0; h++) {
        const cur = q[h];
        if (T.terrain[cur] === TERRAIN.PLAIN) {
          // 需要是「非州界」的平地
          let bord = false;
          neighbors8(cur, tmp);
          for (const j of tmp) if (T.state[j] !== st && T.city[j] < 0) bord = true;
          if (!bord) { goal = cur; break; }
        }
        neighbors8(cur, tmp);
        for (const j of tmp) {
          if (prev.has(j) || T.state[j] !== st || T.city[j] >= 0) continue;
          prev.set(j, cur);
          q.push(j);
        }
        if (q.length > 4000) break;
      }
      let cur = goal;
      while (cur >= 0) {
        if (T.terrain[cur] !== TERRAIN.CITY) T.terrain[cur] = TERRAIN.PLAIN;
        cur = prev.get(cur);
        if (cur === undefined) break;
      }
    }
    // 關口歸屬：link 雙方州
    // 7) 土地等級（分位數對應，城池周邊等級較高）
    const cityCenters = cities.filter(c => c.type !== 'pass').map(c => [c.cx, c.cy, c.lvl]);
    const score = new Float32Array(NN);
    const plainIdx = { birth: [], resource: [] };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      if (T.terrain[i] !== TERRAIN.PLAIN) continue;
      let near = 0;
      for (const [cx, cy, cl] of cityCenters) {
        const d = Math.hypot(cx - x, cy - y);
        if (d < 14) near = Math.max(near, (14 - d) / 14 * (cl - 3) * 0.55);
      }
      const n = nz2(x * 0.07, y * 0.07, 4);
      const st = states[T.state[i]];
      const dCenter = Math.hypot(st.sx - x, st.sy - y) / (N * 0.14 * Math.sqrt(st.w));
      score[i] = n * 5 + near + Math.max(0, 1 - dCenter) * 1.6 + rng() * 1.2;
      (st.type === 'birth' ? plainIdx.birth : plainIdx.resource).push(i);
    }
    const DIST = {
      // v2：出生州提高 5、6 級地比例（由 1、2、4 級地調撥）
      birth: (ver || 1) >= 2 ? [0.16, 0.18, 0.19, 0.14, 0.14, 0.10, 0.048, 0.022, 0.01] : [0.19, 0.2, 0.19, 0.15, 0.11, 0.07, 0.048, 0.022, 0.01],
      resource: [0.05, 0.09, 0.13, 0.17, 0.18, 0.15, 0.11, 0.075, 0.045],
    };
    for (const k of ['birth', 'resource']) {
      const arr = plainIdx[k];
      arr.sort((a, b) => score[a] - score[b]);
      let p = 0;
      for (let lv = 1; lv <= 9; lv++) {
        const cnt = lv === 9 ? arr.length - p : Math.round(arr.length * DIST[k][lv - 1]);
        for (let c = 0; c < cnt && p < arr.length; c++) T.lvl[arr[p++]] = lv;
      }
    }
    // 8) 資源類型（成片分佈）
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const a = nz3(x * 0.11, y * 0.11, 2), b = nz3(x * 0.11 + 77, y * 0.11 + 33, 2);
      let r = (a > 0.5 ? 1 : 0) + (b > 0.5 ? 2 : 0);
      if (rng() < 0.18) r = Math.floor(rng() * 4);
      T.res[i] = r;
    }
    for (const s of states) s.tiles = 0;
    for (let i = 0; i < NN; i++) if (T.terrain[i] === TERRAIN.PLAIN) states[T.state[i]].tiles++;
    return W;
  }

  // 出生點：州內低級地區，彼此間隔
  function findSpawn(stateId, rng, mainCities) {
    const T = W.T;
    const s = W.states[stateId];
    for (let tries = 0; tries < 6000; tries++) {
      const ang = rng() * Math.PI * 2;
      const rad = (0.35 + rng() * 0.75) * N * 0.14 * Math.sqrt(s.w);
      const cx = Math.round(s.sx + Math.cos(ang) * rad), cy = Math.round(s.sy + Math.sin(ang) * rad);
      if (cx < 6 || cy < 6 || cx >= N - 6 || cy >= N - 6) continue;
      let ok = true;
      for (let y = cy - 2; y <= cy + 2 && ok; y++) for (let x = cx - 2; x <= cx + 2; x++) {
        const i = idx(x, y);
        if (T.state[i] !== stateId || T.terrain[i] !== TERRAIN.PLAIN || T.city[i] >= 0 || T.owner[i] >= 0) { ok = false; break; }
      }
      if (!ok) continue;
      const minD = tries < 3000 ? 9 : (tries < 5000 ? 7 : 5);
      for (const c of W.cities) {
        const lim = c.type === 'main' ? minD : 6;
        if (Math.abs(c.cx - cx) < lim && Math.abs(c.cy - cy) < lim) { ok = false; break; }
      }
      if (!ok) continue;
      return idx(cx, cy);
    }
    return -1;
  }
  function placeMainCity(center, pid, name) {
    const T = W.T;
    const cx = X(center), cy = Y(center);
    const st = T.state[center];
    const c = {
      id: W.cities.length, type: 'main', name, lvl: 0, state: st, cx, cy, size: 3, tiles: [],
      alliance: -1, owner: pid, dur: 0, maxDur: 0, garrison: null, resetAt: 0, capturedAt: -1,
    };
    applyMainCity(c);
    W.cities.push(c);
    return c;
  }
  // 將 3×3 的玩家城（主城/分城）套用到地圖
  function applyCityTiles(c) {
    const T = W.T;
    c.tiles = [];
    for (let y = c.cy - 1; y <= c.cy + 1; y++) for (let x = c.cx - 1; x <= c.cx + 1; x++) {
      const i = idx(x, y);
      T.terrain[i] = TERRAIN.CITY;
      T.city[i] = c.id;
      T.owner[i] = c.owner;
      c.tiles.push(i);
    }
  }
  // 移除 3×3 玩家城（分城被摧毀、遷城時舊址）：恢復為無主平地
  function clearCityTiles(c) {
    const T = W.T;
    for (const i of c.tiles) { T.terrain[i] = TERRAIN.PLAIN; T.city[i] = -1; T.owner[i] = -1; }
  }
  // 將主城套用到地圖（新建與讀檔共用）
  function applyMainCity(c) {
    const T = W.T;
    applyCityTiles(c);
    // 出生點周圍降為低級地（遷城後仍以原出生點為準，讀檔結果一致）
    const cx = c.hx === undefined ? c.cx : c.hx, cy = c.hy === undefined ? c.cy : c.hy;
    for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) {
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if (T.terrain[i] !== TERRAIN.PLAIN) continue;
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (d <= 1) continue; // 出生點本身（主城 3×3）不調整，遷城後讀檔才會一致
      const cap = d <= 2 ? 2 : d <= 3 ? 3 : d <= 4 ? 4 : 5;
      if (T.lvl[i] > cap) T.lvl[i] = Math.max(1, cap - (((x * 7 + y * 13) % 3) === 0 ? 1 : 0));
    }
  }
  function placeBranch(center, pid, name) {
    const T = W.T;
    const c = {
      id: W.cities.length, type: 'branch', name, lvl: 0, state: T.state[center], cx: X(center), cy: Y(center), size: 3, tiles: [],
      alliance: -1, owner: pid, dur: CFG.BRANCH_DUR, maxDur: CFG.BRANCH_DUR, garrison: null, resetAt: 0, capturedAt: -1, dead: false,
    };
    applyCityTiles(c);
    W.cities.push(c);
    return c;
  }
  // 玩家擁有的據點：主城、分城、要塞、營帳（歸屬看 owner，不看同盟）
  const PCITY = { main: 1, branch: 1, fort: 1, camp: 1 };
  function isPlayerCity(c) { return !!PCITY[c.type]; }
  function isOutpost(c) { return c.type === 'fort' || c.type === 'camp'; }
  function placeFort(tile, pid, type) {
    const T = W.T;
    type = type || 'fort';
    const c = {
      id: W.cities.length, type, name: type === 'camp' ? '營帳' : '要塞', lvl: T.lvl[tile], state: T.state[tile], cx: X(tile), cy: Y(tile), size: 1, tiles: [tile],
      alliance: -1, owner: pid, dur: type === 'camp' ? CFG.CAMP_DUR : CFG.FORT_DUR, maxDur: type === 'camp' ? CFG.CAMP_DUR : CFG.FORT_DUR, garrison: null, resetAt: 0, capturedAt: -1, dead: false,
    };
    T.city[tile] = c.id;
    W.cities.push(c);
    return c;
  }

  // 相鄰規則：跨州必須經由關口
  function linked(a, b) {
    const T = W.T;
    if (T.state[a] === T.state[b]) return true;
    const ca = T.city[a], cb = T.city[b];
    if (ca >= 0 && W.cities[ca].type === 'pass') return true;
    if (cb >= 0 && W.cities[cb].type === 'pass') return true;
    return false;
  }

  function isPassable(i) { const t = W.T.terrain[i]; return t === TERRAIN.PLAIN || t === TERRAIN.CITY; }

  // 重新產生地形（讀檔時用）
  function regen(seed, n) { return generate(seed, n); }

  W.generate = generate;
  W.regen = regen;
  W.idx = idx; W.X = X; W.Y = Y; W.inb = inb; W.neighbors8 = neighbors8; W.dist = dist;
  W.findSpawn = findSpawn; W.placeMainCity = placeMainCity; W.placeFort = placeFort; W.applyMainCity = applyMainCity;
  W.placeBranch = placeBranch; W.applyCityTiles = applyCityTiles; W.clearCityTiles = clearCityTiles; W.isPlayerCity = isPlayerCity; W.isOutpost = isOutpost;
  W.linked = linked; W.isPassable = isPassable;
  W.D8 = D8;
  return W;
})();
