// Re-key saved data when a game's card ids change. Riftbound main-set cards
// used to be keyed by riftcodex's ids and are now keyed by riftbound_id
// ("rad-038-167"); the game's idRemap (old id → new id) moves quantities,
// wishlists, decks and merchant entries saved under the old keys.
//
// Every helper returns its input unchanged (same reference) when nothing
// needed remapping, so React state setters can bail out without a re-render.

const merge = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : a || b);

/** {cardId: value} — counts are summed, flags OR'd if both keys exist. */
export function remapKeys(obj, map) {
  if (!obj || !map.size || !Object.keys(obj).some((k) => map.has(k))) return obj;
  const next = {};
  for (const [k, v] of Object.entries(obj)) {
    const id = map.get(k) ?? k;
    next[id] = id in next ? merge(next[id], v) : v;
  }
  return next;
}

const remapId = (id, map) => map.get(id) ?? id;

/** Deck shape: legendId, legendIds[], championId, main/sideboard/bench/tags {cardId:x}, arts {cardId:printingId}. */
export function remapDecks(decks, map) {
  if (!Array.isArray(decks) || !map.size) return decks;
  let changed = false;
  const out = decks.map((d) => {
    const next = { ...d };
    for (const zone of ['main', 'sideboard', 'bench', 'tags']) next[zone] = remapKeys(d[zone], map);
    if (d.arts) {
      const arts = remapKeys(d.arts, map);
      next.arts = Object.values(arts).some((v) => map.has(v))
        ? Object.fromEntries(Object.entries(arts).map(([k, v]) => [k, remapId(v, map)]))
        : arts;
    }
    if (d.legendId) next.legendId = remapId(d.legendId, map);
    if (d.championId) next.championId = remapId(d.championId, map);
    if (Array.isArray(d.legendIds)) {
      next.legendIds = d.legendIds.some((id) => map.has(id)) ? d.legendIds.map((id) => remapId(id, map)) : d.legendIds;
    }
    const same = Object.keys(next).every((k) => next[k] === d[k]);
    if (!same) changed = true;
    return same ? d : next;
  });
  return changed ? out : decks;
}

/** Merchant entries: [{ cardId, ... }]. */
export function remapMerchant(entries, map) {
  if (!Array.isArray(entries) || !entries.some((e) => map.has(e.cardId))) return entries;
  return entries.map((e) => (map.has(e.cardId) ? { ...e, cardId: map.get(e.cardId) } : e));
}
