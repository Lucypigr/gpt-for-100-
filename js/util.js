// 通用工具：亂數、格式化、名稱產生
'use strict';

var U = (function () {
  // 可播種亂數 (mulberry32)
  function makeRng(seed) {
    let a = seed >>> 0;
    const rng = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.state = function () { return a; };
    rng.setState = function (s) { a = s >>> 0; };
    return rng;
  }

  let R = makeRng(Date.now() & 0xffffffff);
  function setSeed(s) { R = makeRng(s); }
  function rnd() { return R(); }
  function rint(a, b) { return a + Math.floor(R() * (b - a + 1)); }
  function rrange(a, b) { return a + R() * (b - a); }
  function chance(p) { return R() < p; }
  function pick(arr) { return arr[Math.floor(R() * arr.length)]; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function weighted(items, wf) {
    let sum = 0;
    for (const it of items) sum += Math.max(0, wf(it));
    if (sum <= 0) return items.length ? items[0] : null;
    let r = R() * sum;
    for (const it of items) {
      r -= Math.max(0, wf(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = R();
    while (v === 0) v = R();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // 值雜訊（地形用）
  function makeNoise(seed) {
    const r = makeRng(seed);
    const P = new Uint8Array(512);
    const G = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = P[i]; P[i] = P[j]; P[j] = t; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    function v(ix, iy) { return G[P[(ix & 255) + P[iy & 255]]]; }
    function sm(t) { return t * t * (3 - 2 * t); }
    function n2(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const a = v(ix, iy), b = v(ix + 1, iy), c = v(ix, iy + 1), d = v(ix + 1, iy + 1);
      const ux = sm(fx), uy = sm(fy);
      return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
    }
    return function (x, y, oct) {
      oct = oct || 3;
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let o = 0; o < oct; o++) { s += n2(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    };
  }

  function fmt(n) {
    n = Math.floor(n);
    if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1) + '億';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '萬';
    return String(n);
  }
  function fmtFull(n) { return Math.floor(n).toLocaleString('en-US'); }
  // 遊戲分鐘 -> 顯示
  function fmtDur(min) {
    min = Math.max(0, Math.ceil(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (h >= 24) return Math.floor(h / 24) + '天' + (h % 24) + '時';
    if (h > 0) return h + '時' + String(m).padStart(2, '0') + '分';
    return m + '分';
  }
  function fmtClock(t) {
    const d = Math.floor(t / 1440);
    const m = Math.floor(t % 1440);
    return '第' + (d + 1) + '天 ' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 玩家暱稱：像真人一樣的遊戲 ID
  const NAME_A = ['北風', '孤城', '落日', '青衫', '醉臥', '一劍', '長安', '煙雨', '寒江', '白衣', '墨染', '浮生', '清風', '明月', '烈酒', '無名', '逐鹿', '天涯',
    '江湖', '夜雨', '驚鴻', '星河', '鐵血', '狂刀', '流雲', '亂世', '霸王', '臥龍', '鳳雛', '銀槍', '赤兔', '虎牢', '官渡', '赤壁', '許昌', '洛水', '涼州', '冀北', '荊南', '江東'];
  const NAME_B = ['客', '君', '笑', '行', '郎', '仙', '劍', '侯', '公子', '少年', '書生', '將軍', '先生', '老六', '阿福', '大叔', '小白', '無敵', '歸來', '在此', '不語', '如夢', '聽雨', '問天', '獨行', '醉了', '哥', '姐', '丶', '灬'];
  const NAME_C = ['阿斗', '小喬的貓', '張飛不賣肉', '關二爺', '曹賊', '趙子龍本龍', '諸葛村夫', '呂小布', '許褚光膀子', '大耳賊', '孫十萬', '司馬老賊', '周郎顧曲',
    '劉皇叔', '馬孟起', '袁本初', '董胖胖', '黃忠不老', '陸遜燒營', '孔明燈', '小霸王', '貂蟬的扇子', '典韋不累', '郭奉孝', '賈文和', '甘興霸', '太史慈悲',
    '姜伯約', '龐士元', '徐元直', '荀文若', '夏侯不惇', '張文遠', '孟獲七擒', '祝融夫人', '黃月英', '蔡文姬', '大喬', '孫尚香', '魯子敬', '法孝直'];
  const NAME_EN = ['Tiger', 'Leo', 'Kevin', 'Andy', 'Jack', 'Mike', 'Sam', 'Eric', 'Tom', 'Ray', 'Nick', 'Alex', 'Ken', 'Max', 'Ian', 'Owen'];
  function playerName(used) {
    for (let k = 0; k < 50; k++) {
      let n;
      const r = R();
      if (r < 0.45) n = pick(NAME_A) + pick(NAME_B);
      else if (r < 0.7) n = pick(NAME_C) + (chance(0.4) ? rint(1, 999) : '');
      else if (r < 0.85) n = pick(NAME_A) + pick(NAME_A);
      else if (r < 0.93) n = pick(NAME_EN) + rint(10, 9999);
      else n = pick(['丶', '灬', '╰', '℡']) + pick(NAME_A) + pick(['丶', '灬', '', '′']);
      if (!used.has(n)) { used.add(n); return n; }
    }
    const n = '玩家' + rint(10000, 99999);
    used.add(n);
    return n;
  }
  const ALLI_NAMES = ['長歌', '天下', '烽火', '江山', '風雲', '龍騰', '虎嘯', '血盟', '破軍', '凌雲', '無雙', '縱橫', '九州', '逐鹿', '鐵騎', '星辰', '赤焰', '寒霜',
    '青龍', '白虎', '朱雀', '玄武', '軒轅', '蒼穹', '霸業', '王者', '神威', '驚雷', '孤狼', '夜行'];
  function allianceName(used) {
    for (let k = 0; k < 50; k++) {
      const n = pick(ALLI_NAMES) + (chance(0.35) ? pick(['盟', '會', '閣', '殿', '軍', '堂']) : '');
      if (!used.has(n)) { used.add(n); return n; }
    }
    return '同盟' + rint(100, 999);
  }

  function b64FromU8(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  }
  function u8FromB64(b) {
    const s = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  // 整數集合 <-> 字串（排序後差分 + 36 進位）
  function encodeInts(arr) {
    const a = Array.from(arr).sort((x, y) => x - y);
    let prev = 0;
    const out = [];
    for (const v of a) { out.push((v - prev).toString(36)); prev = v; }
    return out.join(',');
  }
  function decodeInts(s) {
    if (!s) return [];
    let prev = 0;
    return s.split(',').map(t => (prev += parseInt(t, 36)));
  }
  // Int16 陣列 RLE
  function rle(arr) {
    const out = [];
    let cur = arr[0], n = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === cur) n++;
      else { out.push(cur, n); cur = arr[i]; n = 1; }
    }
    out.push(cur, n);
    return out.join(',');
  }
  function unrle(s, len) {
    const a = new Int16Array(len);
    const p = s.split(',');
    let k = 0;
    for (let i = 0; i < p.length; i += 2) { const v = +p[i], n = +p[i + 1]; a.fill(v, k, k + n); k += n; }
    return a;
  }

  return {
    encodeInts, decodeInts, rle, unrle,
    makeRng, setSeed, rnd, rint, rrange, chance, pick, shuffle, weighted, gauss, clamp, lerp, makeNoise,
    fmt, fmtFull, fmtDur, fmtClock, esc, playerName, allianceName, b64FromU8, u8FromB64,
    getRngState: function () { return R.state(); }, setRngState: function (s) { R.setState(s); },
  };
})();
