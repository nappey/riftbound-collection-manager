// Cyberpunk TCG card rules — leaf module (no imports). Cards are normalized by
// games/cyberpunkApi.js into the same shape Riftbound cards use, with
// `game: 'cyberpunk'` stamped on so utils can dispatch here.

// Netdeck set codes, in display order. `short` is the prefix used on printing
// labels ("Beta β005b"); promo sets are grouped after the main products.
export const SETS = [
  { id: 'welcometonightcityretail',         label: 'Welcome to Night City',                 short: 'WNC' },
  { id: 'welcometonightcitybeta',           label: 'Welcome to Night City — Beta',          short: 'Beta' },
  { id: 'boxtoppersretail',                 label: 'Box Toppers',                           short: 'Box Topper' },
  { id: 'boxtoppersbeta',                   label: 'Box Toppers — Beta',                    short: 'Beta Box Topper' },
  { id: 'embracingpowerretailstarterdeck',  label: 'Embracing Power Starter Deck',          short: 'Embracing Power' },
  { id: 'embracingpowerbetastarterdeck',    label: 'Embracing Power Starter Deck — Beta',   short: 'Beta Embracing Power' },
  { id: 'theheistretailstarterdeck',        label: 'The Heist Starter Deck',                short: 'The Heist' },
  { id: 'theheistbetastarterdeck',          label: 'The Heist Starter Deck — Beta',         short: 'Beta The Heist' },
  { id: 'arasakademodeck',                  label: 'Arasaka Demo Deck',                     short: 'Arasaka Demo' },
  { id: 'mercdemodeck',                     label: 'Merc Demo Deck',                        short: 'Merc Demo' },
  { id: 'PRM01',                            label: 'Set 1 Promos',                          short: 'Promo',        promo: true },
  { id: 'prereleasebeta',                   label: 'Pre-Release — Beta',                    short: 'Pre-Release',  promo: true },
  { id: 'edgerunneropens1',                 label: 'Edgerunner Open S1',                    short: 'Edgerunner',   promo: true },
  { id: 'nightcitybrawls1',                 label: 'Night City Brawl S1',                   short: 'Brawl',        promo: true },
];

const SET_INDEX = Object.fromEntries(SETS.map((s, i) => [s.id, i]));
const SET_SHORT = Object.fromEntries(SETS.map(s => [s.id, s.short]));

export const COLORS = ['Red', 'Blue', 'Green', 'Yellow'];
export const TYPES = ['Legend', 'Unit', 'Gear', 'Program'];
export const RARITIES = [
  'Common', 'Uncommon', 'Rare', 'Epic', 'Nova Rare', 'Secret',
  'Iconic Legend', 'Iconic Other', 'Iconic Secret',
];
export const RARITY_ORDER = Object.fromEntries(RARITIES.map((r, i) => [r.toLowerCase(), i]));

// Verified against TCGplayer listings: Common/Uncommon exist only as Normal,
// everything Rare and up exists only as Foil.
const NORMAL_RARITIES = new Set(['common', 'uncommon']);

export function isAlwaysFoil(card) {
  const rarity = card.classification?.rarity?.toLowerCase() ?? '';
  return rarity !== '' && !NORMAL_RARITIES.has(rarity);
}

export function isSingleton(card) {
  return card.classification?.type === 'Legend';
}

export function isBattlefield() {
  return false;
}

export function playsetTarget(card) {
  return isSingleton(card) ? 1 : 3;
}

// Every printing is its own set in the picker, so all of them count.
export function isPlaysetEligible() {
  return true;
}

// All printings of a card share the Netdeck card uuid.
export function printingKey(card) {
  return card?.metadata?.identity ?? (card?.name ?? '').toLowerCase();
}

export function printingLabel(card) {
  const short = SET_SHORT[card?.set?.set_id] ?? card?.set?.label ?? '';
  const iconic = /^iconic/i.test(card?.classification?.rarity ?? '') ? ' · Iconic' : '';
  return `${short} ${card?.collector_label ?? card?.collector_number ?? ''}${iconic}`.trim();
}

// Retail base art first, then the alt (b) variant, then Iconic reprints, then
// everything else in set order. Netdeck lists the retail set first, so its
// index doubles as the tie-break.
export function printingRank(card) {
  const setIdx = SET_INDEX[card.set?.set_id] ?? SETS.length;
  return setIdx * 10
    + (card.metadata?.variant === 'b' ? 1 : 0)
    + (/^iconic/i.test(card.classification?.rarity ?? '') ? 2 : 0)
    + (card.media?.image_url ? 0 : 1);
}
