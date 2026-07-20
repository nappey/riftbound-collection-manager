import { PROMO_FOLD_SETS } from './analysis';

// A card is often printed more than once: an Alternate Art or Signature version
// in its own set, a Metal / Overnumbered premium, or a promo reprint in a later
// set. riftcodex serves every printing as its own card with its own id, so any
// grid built straight off `allCards` shows the same card three or four times.
//
// Strip the variant suffix and every printing of a card shares a name, so the
// name is a safe identity key — checked against the live API, printings that
// group by name never disagree on type, energy or domain. Every multi-printing
// group also contains one plain, unsuffixed printing, so a canonical base always
// exists to represent the group.

const VARIANT_SUFFIX =
  /\s*\((Alternate Art|Overnumbered|Signature|Metal|Starter|Ultimate|Launch Exclusive|GG EZ)\)\s*$/i;

/** Gameplay identity of a printing — its name minus any variant suffix. */
export function printingKey(card) {
  return (card?.name ?? '').replace(VARIANT_SUFFIX, '').trim().toLowerCase();
}

// Promo set labels run long ("Riftbound Organized Play Promotional Cards"), and
// a printing label has to fit under a thumbnail. Mirrors PROMO_SHORT_LABELS in
// App.jsx.
const PROMO_SHORT = { OPP: 'OP Promo', PR: 'Promo', JDG: 'Judge', RWB: 'Worlds' };

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
function rank(card) {
  return (VARIANT_SUFFIX.test(card.name ?? '') ? 4 : 0)
    + (PROMO_FOLD_SETS.has(card.set?.set_id) ? 2 : 0)
    + (card.media?.image_url ? 0 : 1);
}

/**
 * Index every printing by card id.
 * → Map<cardId, { base, printings }>, where `printings` holds every printing of
 *   that card (canonical first) and `base` is the one a grid should show. Every
 *   printing in a group maps to the same entry, so a lookup by a variant's id
 *   finds the group just as well as a lookup by the base's.
 */
export function indexPrintings(cards) {
  const byKey = new Map();
  for (const card of cards) {
    const key = printingKey(card);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(card);
  }

  const index = new Map();
  for (const printings of byKey.values()) {
    printings.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const entry = { base: printings[0], printings };
    for (const card of printings) index.set(card.id, entry);
  }
  return index;
}
