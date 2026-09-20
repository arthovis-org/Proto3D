// ai/store.js — generated media that is not a hosted URL (demo output, or a provider result
// that was fetched into the page) is kept as a Blob in IndexedDB keyed by the job id, so a
// reload restores it: the world JSON stores only the small media record with `storeId`, and
// `hydrate(media)` gives it a fresh blob: URL. faces.js asks `bitmapFallback` when a blob URL
// from a previous page life fails to load, so even a saved card cover finds its picture again.
import { setBitmapFallback } from '../faces.js';

const DB = 'proto3d-ai', STORE = 'blobs', VERSION = 1;
let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}
const tx = (mode, fn) => open().then((db) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode); const s = t.objectStore(STORE);
  const r = fn(s); t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
}));

const urls = new Map();   // storeId → live blob URL (this page life)
export const store = {
  /** Save a blob under an id; resolves the id. */
  async put(id, blob, meta = {}) { await tx('readwrite', (s) => s.put({ blob, meta, savedAt: Date.now() }, id)); return id; },
  async get(id) { try { const rec = await tx('readonly', (s) => s.get(id)); return rec ? rec.blob : null; } catch (_) { return null; } },
  async remove(id) { urls.delete(id); try { await tx('readwrite', (s) => s.delete(id)); } catch (_) { /* ignore */ } },
  async keys() { try { return await tx('readonly', (s) => s.getAllKeys()); } catch (_) { return []; } },
  async count() { try { return await tx('readonly', (s) => s.count()); } catch (_) { return 0; } },
  /** Size of everything stored, in bytes (for the Connections page). */
  async bytes() { try { const all = await tx('readonly', (s) => s.getAll()); return all.reduce((a, r) => a + (r.blob?.size || 0), 0); } catch (_) { return 0; } },
  async clear() { urls.clear(); try { await tx('readwrite', (s) => s.clear()); } catch (_) { /* ignore */ } },
  /** A live blob: URL for a stored id (cached per page life), or null. */
  async url(id) {
    if (urls.has(id)) return urls.get(id);
    const blob = await store.get(id);
    if (!blob) return null;
    const u = URL.createObjectURL(blob); urls.set(id, u); return u;
  },
  /** Store a blob and return a media record { kind, src (blob URL), storeId, ... }. */
  async putMedia(id, blob, media) { await store.put(id, blob, { kind: media.kind, title: media.title }); const src = URL.createObjectURL(blob); urls.set(id, src); return { ...media, src, storeId: id }; },
  /** Give a media record (or a list) whose blob URL died with the last page a fresh one. */
  async hydrate(m) {
    if (Array.isArray(m)) { for (const x of m) await store.hydrate(x); return m; }
    if (!m || !m.storeId || !/^blob:/.test(m.src || '')) return m;
    if (urls.get(m.storeId) === m.src) return m;
    const u = await store.url(m.storeId);
    if (u) m.src = u; else m.missing = true;
    return m;
  },
};
// faces.js: a blob: URL from a previous page life (not one this page created) is not even requested —
// it goes straight to the store by storeId; any other failed src with a storeId falls back the same way
setBitmapFallback(async (media) => (media?.storeId ? store.get(media.storeId) : null), (src, media) => /^blob:/.test(src) && !!media?.storeId && ![...urls.values()].includes(src));
export default store;
