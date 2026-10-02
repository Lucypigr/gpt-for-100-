'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { load } = require('./load');
const S = load();

const DAYS = 2;
const AI_COUNT = 500;
const G = S.Game.newGame({ seed: 20261002, userName: '壓力測試', aiCount: AI_COUNT });

const samples = [];
let maxMarches = 0;
let maxTickMs = 0;
let totalMs = 0;
const totalTicks = DAYS * 1440;

for (let minute = 0; minute < totalTicks; minute++) {
  const t0 = performance.now();
  S.Game.tick();
  const dt = performance.now() - t0;
  samples.push(dt);
  totalMs += dt;
  if (dt > maxTickMs) maxTickMs = dt;
  if (G.marches.length > maxMarches) maxMarches = G.marches.length;
  if (G.over) break;
}

function avg(arr) { return arr.reduce((a,b)=>a+b,0) / Math.max(1,arr.length); }
function percentile(arr, p) {
  const a = arr.slice().sort((x,y)=>x-y);
  return a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] || 0;
}

const window = Math.min(360, Math.floor(samples.length / 3));
const early = avg(samples.slice(0, window));
const late = avg(samples.slice(-window));
const p95 = percentile(samples, .95);
const p99 = percentile(samples, .99);
const save = S.Game.serialize();
const saveMB = Buffer.byteLength(save, 'utf8') / 1024 / 1024;
const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
const ratio = late / Math.max(.05, early);

console.log(JSON.stringify({
  aiCount: AI_COUNT,
  ticks: samples.length,
  totalSeconds: +(totalMs / 1000).toFixed(2),
  avgTickMs: +(avg(samples)).toFixed(2),
  earlyAvgTickMs: +early.toFixed(2),
  lateAvgTickMs: +late.toFixed(2),
  lateToEarlyRatio: +ratio.toFixed(2),
  p95TickMs: +p95.toFixed(2),
  p99TickMs: +p99.toFixed(2),
  maxTickMs: +maxTickMs.toFixed(2),
  maxMarches,
  liveMarches: G.marches.length,
  alliances: G.alliances.filter(a => !a.dead).length,
  worldChat: G.chat.world.length,
  saveMB: +saveMB.toFixed(2),
  heapMB: +heapMB.toFixed(2)
}, null, 2));

// 這些是防止「越玩越卡」的安全護欄，不是遊戲平衡值。
assert.ok(samples.length >= 1440, '500 AI 至少應穩定跑完一個遊戲日');
assert.ok(ratio < 4.0, '後段 tick 平均耗時暴增，疑似累積型效能退化');
assert.ok(p95 < 250, '95% tick 應低於 250ms，否則高速模式會明顯卡頓');
assert.ok(maxMarches < 3500, '行軍數失控，疑似未清理或 AI 重複派兵');
assert.ok(G.chat.world.length <= 150, '世界聊天未保持上限');
assert.ok(saveMB < 20, '存檔體積異常膨脹');
assert.ok(heapMB < 1024, '無頭壓力測試記憶體異常膨脹');

console.log('500-AI long-run performance stress test OK');
