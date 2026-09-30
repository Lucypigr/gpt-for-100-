// 存檔紀錄：保留多份歷史存檔（手動存檔、每遊戲日自動備份、重開賽季前備份），可隨時讀回。
// 存在瀏覽器 IndexedDB（容量比 localStorage 大），支援時以 gzip 壓縮；目前進度仍存在 localStorage 的 stzb_save。
'use strict';

var SaveHist = (function () {
  const DB = 'stzb', META = 'meta', DATA = 'data';
  const KEEP = { manual: 20, auto: 10, backup: 5 };
  const KIND_NAME = { manual: '手動存檔', auto: '自動備份', backup: '重開前備份' };
  let dbp = null;

  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id', autoIncrement: true });
          if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function done(tx) { return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }

  async function pack(str) {
    if (typeof CompressionStream === 'undefined') return { z: 0, v: str };
    const blob = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return { z: 1, v: blob };
  }
  async function unpack(d) {
    if (!d) return null;
    if (!d.z) return d.v;
    return new Response(d.v.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }

  async function list() {
    const db = await open();
    const all = await req(db.transaction(META).objectStore(META).getAll());
    return all.sort((a, b) => b.at - a.at);
  }

  // meta: {name, clock, day, kind}
  async function add(meta, str) {
    const db = await open();
    const body = await pack(str);
    const rec = Object.assign({ at: Date.now(), size: str.length }, meta);
    const tx = db.transaction([META, DATA], 'readwrite');
    const id = await req(tx.objectStore(META).add(rec));
    tx.objectStore(DATA).put(body, id);
    await done(tx);
    // 各類型只保留最新的若干份
    const same = (await list()).filter(x => x.kind === rec.kind);
    for (const x of same.slice(KEEP[rec.kind] || 10)) await remove(x.id);
    return id;
  }

  async function get(id) {
    const db = await open();
    return unpack(await req(db.transaction(DATA).objectStore(DATA).get(id)));
  }

  async function remove(id) {
    const db = await open();
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
    await done(tx);
  }

  return { list, add, get, remove, KIND_NAME };
})();
