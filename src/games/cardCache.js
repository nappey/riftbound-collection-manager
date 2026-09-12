// In-memory per-game cache of loaded cards + prices, so switching back to a
// game you already opened this session is instant instead of refetching.
const cache = new Map();

export function getCached(gameId) {
  return cache.get(gameId) ?? null;
}

export function setCached(gameId, patch) {
  cache.set(gameId, { ...(cache.get(gameId) ?? {}), ...patch, loadedAt: Date.now() });
}
