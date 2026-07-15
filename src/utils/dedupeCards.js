// riftcodex sometimes serves the same physical card more than once. Vendetta
// (VEN) currently arrives as three separate ingests: one canonical batch plus
// two re-ingests, so every Vendetta card renders 2-3 times. The ghost rows are
// hard to spot because each carries its own `id` — but they share the real
// card's `riftbound_id` and have no `tcgplayer_id`.
//
// riftbound_id alone is not a safe key: genuine variants reuse it. OPP's premium
// promos ("Ahri - Nine-Tailed Fox (Metal)" vs "Ahri - Nine-Tailed Fox") share
// riftbound_id opp-255-298 yet are different products — and each has its own
// tcgplayer_id. That's the distinguishing signal:
//
//   within one set + riftbound_id, a real variant has its own tcgplayer_id,
//   a ghost has none.
//
// So keep one row per distinct tcgplayer_id, and when nothing in the group is
// priced (e.g. art-only printings), fall back to the single richest row.

const groupKey = (card) => `${card.set?.set_id}|${card.riftbound_id}`;
const richness = (card) => (card.media?.image_url ? 2 : 0) + (card.text?.plain ? 1 : 0);

/** Drop duplicate printings served by the API, preserving genuine variants. */
export function dedupeCards(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = groupKey(card);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }

  const keep = new Set();
  for (const rows of groups.values()) {
    if (rows.length === 1) { keep.add(rows[0]); continue; }

    const priced = rows.filter((c) => c.tcgplayer_id);
    if (priced.length) {
      const seen = new Set();
      for (const card of priced) {
        const pid = String(card.tcgplayer_id);
        if (seen.has(pid)) continue; // same product listed twice — ghost
        seen.add(pid);
        keep.add(card);
      }
    } else {
      keep.add(rows.reduce((a, b) => (richness(b) > richness(a) ? b : a)));
    }
  }

  return cards.filter((card) => keep.has(card)); // preserve API order
}
