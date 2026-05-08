export function formatPlayset(count) {
  if (count === 0) return null;
  const sets = Math.floor(count / 3);
  const extra = count % 3;
  if (sets === 0) return String(count);
  const label = sets === 1 ? '1 playset' : `${sets} playsets`;
  return extra === 0 ? label : `${label} +${extra}`;
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
