import { isAlwaysFoil, playsetTarget } from './playset';

// Promo sets whose cards are folded into their base card in the main view.
// Mirrors PROMO_FOLD_SETS in App.jsx — kept here so analysis pages agree.
export const PROMO_FOLD_SETS = new Set(['OPP', 'PR', 'JDG', 'RWB']);

// A card counts toward set completion / playset math if it's a real,
// stand-alone card (not a Rune, not a folded promo reprint).
export function isPlaysetEligible(card) {
  return card.classification?.type !== 'Rune' && !PROMO_FOLD_SETS.has(card.set?.set_id);
}

// How many copies make this card "complete": 1 for singletons
// (Legends/Battlefields), 12 for Runes, otherwise a playset of 3.
export function cardTarget(card) {
  return playsetTarget(card);
}

// Copies owned that count toward completion. Always-foil cards (rares,
// showcase, alt art…) only have a foil printing, so only foils count.
export function ownedTotal(card, collection, foilCollection) {
  const n = collection[card.id] ?? 0;
  const f = foilCollection[card.id] ?? 0;
  return isAlwaysFoil(card) ? f : n + f;
}

// Estimated price to acquire one more copy of this card.
export function unitPrice(card, prices) {
  const p = prices[card.tcgplayer_id] ?? {};
  if (isAlwaysFoil(card)) return p.foil?.market ?? p.foil?.low ?? p.normal?.market ?? null;
  return p.normal?.market ?? p.normal?.low ?? null;
}

// Market value of the copies currently owned of this card (normal + foil).
export function cardMarketValue(card, collection, foilCollection, prices) {
  const p = prices[card.tcgplayer_id] ?? {};
  const n = collection[card.id] ?? 0;
  const f = foilCollection[card.id] ?? 0;
  return n * (p.normal?.market ?? 0) + f * (p.foil?.market ?? p.normal?.market ?? 0);
}

export function fmt$(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}
