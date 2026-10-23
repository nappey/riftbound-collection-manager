// In-memory per-game cache of loaded cards + prices, so switching back to a
// game you already opened this session is instant instead of refetching.
const cache = new Map();

export function getCached(gameId) {
  return cache.get(gameId) ?? null;
}

export function setCached(gameId, patch) {
  cache.set(gameId, { ...(cache.get(gameId) ?? {}), ...patch, loadedAt: Date.now() });
}

// ── On-disk card list (IndexedDB) ───────────────────────────────
// The card APIs can take 30s+ to page through, so the last good card list is
// kept on disk: launches render it immediately while a fresh copy loads in the
// background. Too big for localStorage alongside the collections. Every call
// degrades to a no-op if IndexedDB is unavailable.
const DB_NAME = 'card-manager-cache';
const STORE = 'cards';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadStoredCards(gameId) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(gameId);
      req.onsuccess = () => resolve(Array.isArray(req.result) && req.result.length ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function storeCards(gameId, cards) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(cards, gameId);
  } catch { /* cache is best-effort */ }
}

/** Forget every game's cards + prices — in memory and on disk. */
export async function clearAllCached() {
  cache.clear();
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  } catch { /* cache is best-effort */ }
}
