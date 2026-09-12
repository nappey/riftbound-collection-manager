// Card-only playset helpers. Each dispatches on the card's game (see
// games/rules.js) so the same call sites serve every supported game.
import { rulesFor } from '../games/rules';
import { RUNE_PLAYSET } from '../games/riftboundRules';

export { RUNE_PLAYSET };

// How many copies make a "playset" for this card: 1 for singletons, 12 for
// Riftbound Runes, otherwise the standard 3.
export function playsetTarget(card) {
  return rulesFor(card).playsetTarget(card);
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

// Cards with no unfoiled printing (rares, showcase, alt art…).
export function isAlwaysFoil(card) {
  return rulesFor(card).isAlwaysFoil(card);
}

// Singleton cards — you only care about having one.
export function isSingleton(card) {
  return rulesFor(card).isSingleton(card);
}

export function isBattlefield(card) {
  return rulesFor(card).isBattlefield(card);
}
