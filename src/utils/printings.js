import { rulesFor } from '../games/rules';

// A card is often printed more than once: an Alternate Art or Signature version
// in its own set, a Metal / Overnumbered premium, a promo reprint in a later
// set, or (Cyberpunk) a Beta / alt-art / Iconic printing. The API serves every
// printing as its own card with its own id, so any grid built straight off
// `allCards` shows the same card three or four times.
//
// Each game defines what identifies a card across printings (Riftbound: the
// name minus any variant suffix; Cyberpunk: the Netdeck card uuid) and which
// printing is canonical — see games/*Rules.js.

/** Gameplay identity of a printing. */
export function printingKey(card) {
  return rulesFor(card).printingKey(card);
}

/** Short label for a printing's art: 'Alternate Art', 'Judge', 'Beta β005b'… */
export function printingLabel(card) {
  return rulesFor(card).printingLabel(card);
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
    const rank = rulesFor(printings[0]).printingRank;
    printings.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const entry = { base: printings[0], printings };
    for (const card of printings) index.set(card.id, entry);
  }
  return index;
}
