// riftcodex has two data problems this module fixes using TCGplayer (tcgcsv):
//   1. Runes — only 3 of the 4 printings per elemental rune, with stale
//      tcgplayer_ids. We correct the ids and synthesize the missing printings.
//   2. Arcane promos — riftcodex serves the *base* card art for the Arcane
//      "Promotional Cards" (PR) set, which actually have unique alternate art
//      (e.g. "Warwick - Hunter" shows the plain Origins art). We swap in the
//      correct TCGplayer scan, matched by product id + name. Nexus Night (OPP)
//      and other promos genuinely reuse their base art, so we leave those alone.
//
// All of this is best-effort: if tcgcsv is unreachable the app falls back to
// riftcodex data unchanged.

// tcgcsv groups under category 89 (Riftbound).
const TCG_GROUP_IDS = [24344, 24439, 24502, 24519, 24528, 24552, 24560, 24343];

// Promo sets whose cards have genuinely unique art that riftcodex gets wrong.
// Only these get an art override. Nexus Night (OPP) reprints share the base art
// and must NOT be overridden (and some have broken TCGplayer images).
const ALT_ART_PROMO_SETS = new Set(['PR']);

// Elemental rune → TCGplayer rune number and card domain.
const ELEMENTS = [
  { name: 'Fury Rune',  num: 1, domain: 'Fury' },
  { name: 'Calm Rune',  num: 2, domain: 'Calm' },
  { name: 'Mind Rune',  num: 3, domain: 'Mind' },
  { name: 'Body Rune',  num: 4, domain: 'Body' },
  { name: 'Chaos Rune', num: 5, domain: 'Chaos' },
  { name: 'Order Rune', num: 6, domain: 'Order' },
];
const ELEMENT_BY_NUM = Object.fromEntries(ELEMENTS.map(e => [e.num, e]));
const ELEMENT_BY_NAME = Object.fromEntries(ELEMENTS.map(e => [e.name.toLowerCase(), e]));

// Rune printing suffix → set metadata used for the variant badge.
// The 'a' (Showcase) rune printing is the Unleashed alt art.
const PRINTING = {
  '': { set_id: 'OGN', label: 'Origins' },
  a:  { set_id: 'UNL', label: 'Unleashed' },
  b:  { set_id: 'OPP', label: 'Nexus Night Promos' },
  c:  { set_id: 'OPR', label: 'Organized Play Promo' },
};

// High-res local rune art (in public/rune-images/), keyed by TCGplayer rune
// number. Covers the Unleashed alt-art (a) and Nexus Night (b) printings.
const LOCAL_RUNE_IMAGES = {
  R01a: '692932_in_1000x1000.jpg', R02a: '692933_in_1000x1000.jpg', R03a: '692934_in_1000x1000.jpg',
  R04a: '692935_in_1000x1000.jpg', R05a: '692936_in_1000x1000.jpg', R06a: '692937_in_1000x1000.jpg',
  R01b: '680274_in_1000x1000.jpg', R02b: '680304_in_1000x1000.jpg', R03b: '680331_in_1000x1000.jpg',
  R04b: '680347_in_1000x1000.jpg', R05b: '680392_in_1000x1000.jpg', R06b: '680432_in_1000x1000.jpg',
};
function localRuneImage(num) {
  const f = LOCAL_RUNE_IMAGES[num];
  return f ? `${import.meta.env.BASE_URL}rune-images/${f}` : null;
}

const pad2 = (n) => String(n).padStart(2, '0');
const bigImage = (url) => (url ? url.replace(/_\d+w\.(jpg|png|webp)/i, '_400w.$1') : url);

// First alphanumeric token of a card name (the champion/card key), for a cheap
// sanity check that a product id really points at the same card.
function nameKey(name) {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] ?? '';
}

// TCGplayer card number for a riftcodex rune, e.g. "R05a" for Chaos alt art.
export function tcgNumberForRune(card) {
  const el = ELEMENT_BY_NAME[card.name?.toLowerCase().replace(/\s*\(alternate art\)\s*/i, '').trim()];
  if (!el) return null;
  let suffix = '';
  if (card.metadata?.alternate_art) suffix = 'a';
  else if (card.set?.set_id === 'OPP') suffix = 'b';
  return `R${pad2(el.num)}${suffix}`;
}

/**
 * Fetch tcgcsv products once and derive what we need:
 *   runeByNumber: Map<"R05a", { pid, img, rarity, name }>
 *   productById:  Map<productId, { img, name }>
 * `tcgcsvBase` is the same base the app uses for prices.
 */
export async function fetchTcgProducts(tcgcsvBase) {
  const runeByNumber = new Map();
  const productById = new Map();
  const responses = await Promise.allSettled(
    TCG_GROUP_IDS.map(gid => fetch(`${tcgcsvBase}/${gid}/products`).then(r => r.json()))
  );
  for (const res of responses) {
    if (res.status !== 'fulfilled') continue;
    for (const p of res.value.results ?? []) {
      // riftcodex stores tcgplayer_id as a string, so key by string to match.
      const pidKey = String(p.productId);
      if (!productById.has(pidKey)) productById.set(pidKey, { img: p.imageUrl, name: p.name });
      const num = (p.extendedData ?? []).find(e => /number/i.test(e.name))?.value?.trim();
      if (!num || !/^R\d/i.test(num)) continue;
      const rarity = (p.extendedData ?? []).find(e => /rarity/i.test(e.name))?.value ?? '';
      const cur = runeByNumber.get(num);
      if (!cur || p.productId < cur.pid) runeByNumber.set(num, { pid: p.productId, img: p.imageUrl, rarity, name: p.name });
    }
  }
  return { runeByNumber, productById };
}

function synthRune(num, product) {
  const m = /^R(\d{2})([a-z]?)$/i.exec(num);
  if (!m) return null;
  const el = ELEMENT_BY_NUM[parseInt(m[1], 10)];
  if (!el) return null;
  const printing = PRINTING[m[2].toLowerCase()] ?? { set_id: 'OPR', label: 'Promo' };
  return {
    id: `tcg-${num}`,
    name: el.name,
    riftbound_id: num.toLowerCase(),
    collector_number: el.num,
    tcgplayer_id: String(product.pid),
    classification: { type: 'Rune', supertype: null, rarity: (product.rarity || 'promo').toLowerCase(), domain: [el.domain] },
    attributes: {},
    set: { set_id: printing.set_id, label: printing.label },
    media: { image_url: localRuneImage(num) ?? bigImage(product.img) },
    metadata: { alternate_art: false, clean_name: el.name },
    text: { plain: '', flavour: '' },
    tags: [],
    _synthetic: true,
  };
}

/**
 * Apply both fixups to the riftcodex card list:
 *   - rune tcgplayer_id corrections + synthesized missing rune printings
 *   - promo art override (riftcodex serves base art for promos)
 */
export function augmentCards(cards, data) {
  if (!data || (!data.runeByNumber?.size && !data.productById?.size)) return cards;
  const { runeByNumber, productById } = data;

  const coveredRunes = new Set();
  const out = cards.map(card => {
    // ── Runes: correct the price id, and use high-res local art when we have it ──
    if (card.classification?.type === 'Rune') {
      const num = tcgNumberForRune(card);
      if (num) {
        coveredRunes.add(num);
        const next = { ...card };
        const product = runeByNumber.get(num);
        if (product) next.tcgplayer_id = String(product.pid);
        const localImg = localRuneImage(num);
        if (localImg) next.media = { ...card.media, image_url: localImg };
        return next;
      }
      return card;
    }
    // ── Arcane (PR) promos: swap in the correct unique TCGplayer art ──
    if (ALT_ART_PROMO_SETS.has(card.set?.set_id)) {
      const prod = productById.get(String(card.tcgplayer_id));
      // Only override when the product id plausibly matches this card.
      if (prod?.img && nameKey(prod.name) && nameKey(prod.name) === nameKey(card.name)) {
        return { ...card, media: { ...card.media, image_url: bigImage(prod.img) } };
      }
    }
    return card;
  });

  // Append rune printings riftcodex didn't supply (the R0Xc promos).
  if (runeByNumber) {
    for (const [num, product] of runeByNumber) {
      if (coveredRunes.has(num)) continue;
      const synth = synthRune(num, product);
      if (synth) out.push(synth);
    }
  }
  return out;
}
