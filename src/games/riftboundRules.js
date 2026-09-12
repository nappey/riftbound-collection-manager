// Riftbound card rules — leaf module (no imports) so the card-only helpers in
// utils/ can dispatch here without creating an import cycle with the full
// game config. Every function takes a card in the riftcodex-like shape.

export const SETS = [
  { id: 'OGN', label: 'Origins',               short: 'OGN' },
  { id: 'OGS', label: 'Proving Grounds',       short: 'OGS', promo: true },
  { id: 'SFD', label: 'Spiritforged',          short: 'SFD' },
  { id: 'UNL', label: 'Unleashed',             short: 'UNL' },
  { id: 'VEN', label: 'Vendetta',              short: 'VEN' },
  { id: 'OPP', label: 'Organized Play Promos', short: 'OP Promo', promo: true, fold: true },
  { id: 'PR',  label: 'Promotional Cards',     short: 'Promo',    promo: true, fold: true },
  { id: 'JDG', label: 'Judge Promos',          short: 'Judge',    promo: true, fold: true },
  { id: 'RWB', label: 'Worlds Bundle 2025',    short: 'Worlds',   promo: true, fold: true },
];

export const PROMO_FOLD_SETS = new Set(SETS.filter(s => s.fold).map(s => s.id));
export const PROMO_SHORT = Object.fromEntries(SETS.filter(s => s.fold).map(s => [s.id, s.short]));

// A full rune deck runs 12 of a rune, so a rune "playset" is 12 (not 3).
export const RUNE_PLAYSET = 12;

// Rare, Showcase/Epic, Promo, and Alt Art cards have no unfoiled printing
const FOIL_RARITIES = new Set(['rare', 'showcase', 'epic', 'promo']);

export function isAlwaysFoil(card) {
  const rarity = card.classification?.rarity?.toLowerCase() ?? '';
  return card.metadata?.alternate_art === true || FOIL_RARITIES.has(rarity);
}

// Legends and Battlefields are singleton cards — you only care about having one
export function isSingleton(card) {
  const t = card.classification?.type;
  return t === 'Legend' || t === 'Battlefield';
}

export function isBattlefield(card) {
  return card.classification?.type === 'Battlefield';
}

// How many copies make a "playset" for this card: 1 for singletons
// (Legends/Battlefields), 12 for Runes, otherwise the standard 3.
export function playsetTarget(card) {
  if (isSingleton(card)) return 1;
  if (card?.classification?.type === 'Rune') return RUNE_PLAYSET;
  return 3;
}

// A card counts toward set completion / playset math if it's a real,
// stand-alone card (not a Rune, not a folded promo reprint).
export function isPlaysetEligible(card) {
  return card.classification?.type !== 'Rune' && !PROMO_FOLD_SETS.has(card.set?.set_id);
}

// A card is often printed more than once: an Alternate Art or Signature version
// in its own set, a Metal / Overnumbered premium, or a promo reprint in a later
// set. Strip the variant suffix and every printing of a card shares a name.
export const VARIANT_SUFFIX =
  /\s*\((Alternate Art|Overnumbered|Signature|Metal|Starter|Ultimate|Launch Exclusive|GG EZ)\)\s*$/i;

/** Gameplay identity of a printing — its name minus any variant suffix. */
export function printingKey(card) {
  return (card?.name ?? '').replace(VARIANT_SUFFIX, '').trim().toLowerCase();
}

/** Short label for a printing's art: 'Alternate Art', 'Judge', 'Standard'… */
export function printingLabel(card) {
  const suffix = card?.name?.match(VARIANT_SUFFIX);
  if (suffix) return suffix[1];
  const setId = card?.set?.set_id;
  if (PROMO_FOLD_SETS.has(setId)) return PROMO_SHORT[setId] ?? 'Promo';
  return 'Standard';
}

// Canonical printing sorts first: a plain name beats a variant suffix, a base
// set beats a promo reprint, and a printing with art beats one without.
export function printingRank(card) {
  return (VARIANT_SUFFIX.test(card.name ?? '') ? 4 : 0)
    + (PROMO_FOLD_SETS.has(card.set?.set_id) ? 2 : 0)
    + (card.media?.image_url ? 0 : 1);
}
