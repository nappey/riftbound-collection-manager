// A full rune deck runs 12 of a rune, so a rune "playset" is 12 (not 3).
export const RUNE_PLAYSET = 12;

// How many copies make a "playset" for this card: 1 for singletons
// (Legends/Battlefields), 12 for Runes, otherwise the standard 3.
export function playsetTarget(card) {
  if (isSingleton(card)) return 1;
  if (card?.classification?.type === 'Rune') return RUNE_PLAYSET;
  return 3;
}

// Format a count against a given playset size (defaults to 3).
export function formatPlaysetFor(count, target = 3) {
  if (count === 0) return null;
  const sets = Math.floor(count / target);
  const extra = count % target;
  if (sets === 0) return String(count);
  const label = sets === 1 ? '1 playset' : `${sets} playsets`;
  return extra === 0 ? label : `${label} +${extra}`;
}

export function formatPlayset(count) {
  return formatPlaysetFor(count, 3);
}

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
