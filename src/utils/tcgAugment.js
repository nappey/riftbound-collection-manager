// Fixes riftcodex's Arcane promo art using TCGplayer (tcgcsv).
//
// riftcodex serves the *base* card art for the Arcane "Promotional Cards" (PR)
// set, which actually have unique alternate art (e.g. "Warwick - Hunter" shows
// the plain Origins art). We swap in the correct TCGplayer scan, matched by
// product id + name. Other promos (Nexus Night, etc.) genuinely reuse their
// base art, so we leave those alone.
//
// Best-effort: if tcgcsv is unreachable the app falls back to riftcodex data.
//
// NOTE: rune printings are intentionally NOT augmented here — they span many
// set-specific full arts (Origins / Origins Showcase / Spiritforged / Unleashed
// / Nexus Night / OP Promo) that need an explicit, curated mapping. That is
// handled separately once the local rune art is named by set+number.

// tcgcsv groups under category 89 (Riftbound).
const TCG_GROUP_IDS = [24344, 24439, 24502, 24519, 24528, 24552, 24560, 24343];

// Promo sets whose cards have genuinely unique art that riftcodex gets wrong.
const ALT_ART_PROMO_SETS = new Set(['PR']);

const bigImage = (url) => (url ? url.replace(/_\d+w\.(jpg|png|webp)/i, '_400w.$1') : url);

// First alphanumeric token of a card name (the champion/card key), for a cheap
// sanity check that a product id really points at the same card.
function nameKey(name) {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] ?? '';
}

/**
 * Fetch tcgcsv products once and index image + name by product id (string keys,
 * to match riftcodex's string tcgplayer_id). `tcgcsvBase` is the same base the
 * app uses for prices.
 */
export async function fetchTcgProducts(tcgcsvBase) {
  const productById = new Map();
  const responses = await Promise.allSettled(
    TCG_GROUP_IDS.map(gid => fetch(`${tcgcsvBase}/${gid}/products`).then(r => r.json()))
  );
  for (const res of responses) {
    if (res.status !== 'fulfilled') continue;
    for (const p of res.value.results ?? []) {
      const pidKey = String(p.productId);
      if (!productById.has(pidKey)) productById.set(pidKey, { img: p.imageUrl, name: p.name });
    }
  }
  return { productById };
}

/** Swap in the correct unique TCGplayer art for Arcane (PR) promo cards. */
export function augmentCards(cards, data) {
  const productById = data?.productById;
  if (!productById?.size) return cards;

  return cards.map(card => {
    if (!ALT_ART_PROMO_SETS.has(card.set?.set_id)) return card;
    const prod = productById.get(String(card.tcgplayer_id));
    // Only override when the product id plausibly matches this card.
    if (prod?.img && nameKey(prod.name) && nameKey(prod.name) === nameKey(card.name)) {
      return { ...card, media: { ...card.media, image_url: bigImage(prod.img) } };
    }
    return card;
  });
}
