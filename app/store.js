// Armazenamento no aparelho (IndexedDB). Se o navegador negar, o aplicativo avisa e segue só em memória.
const DB = 'lcs-workout', VER = 1, STORES = ['logs', 'states', 'meta'];
let db = null;
export let persistent = false, available = true;

function open() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => { for (const s of STORES) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
function all(store) {
  return new Promise((res, rej) => {
    const out = {}, rq = db.transaction(store).objectStore(store).openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
    rq.onerror = () => rej(rq.error);
  });
}
export async function load() {
  try {
    db = await open();
    const [logs, states, meta] = await Promise.all(STORES.map(all));
    try { persistent = !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch { }
    return { logs, states, meta };
  } catch (e) {
    available = false; console.error(e);
    return { logs: {}, states: {}, meta: {} };
  }
}
export function put(store, key, value) {
  if (!db) return Promise.resolve();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
export function putMany(store, entries) {
  if (!db) return Promise.resolve();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
    for (const [k, v] of entries) os.put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
