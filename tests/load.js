// 在 Node 中載入遊戲核心（不含 DOM）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FILES = ['js/util.js', 'js/data/config.js', 'js/data/skills.js', 'js/data/heroes.js', 'js/chat.js', 'js/world.js', 'js/battle.js', 'js/core.js', 'js/ai.js'];
function load() {
  const ctx = { console, Math, Date, JSON, Buffer, setTimeout, clearTimeout };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const root = path.join(__dirname, '..');
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  // 讓 top-level const/var 可被取用
  return vm.runInContext('({U, CFG, SKILLS, HEROES, EVENT_SKILLS, HERO_BY_NAME, World, Battle, Game, AI, BUILDINGS, QUESTS, TERRAIN, CHAT})', ctx);
}
module.exports = { load };
