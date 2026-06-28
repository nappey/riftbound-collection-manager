const KNOWN_SECTIONS = ['Legend', 'Champion', 'MainDeck', 'Battlefields', 'Runes', 'Sideboard'];

// Elemental rune domains — the deck builder tracks runes abstractly by domain
// rather than as real cards, so on import "6 Fury Rune" becomes { Fury: 6 }.
export const ELEMENTAL_DOMAINS = ['Body', 'Calm', 'Chaos', 'Fury', 'Mind', 'Order'];

// Header words other sites use, mapped to our canonical section names.
const SECTION_ALIASES = {
  legend: 'Legend', legends: 'Legend',
  champion: 'Champion', champions: 'Champion',
  main: 'MainDeck', maindeck: 'MainDeck', 'main deck': 'MainDeck',
  deck: 'MainDeck', units: 'MainDeck', spells: 'MainDeck', gear: 'MainDeck',
  battlefield: 'Battlefields', battlefields: 'Battlefields',
  rune: 'Runes', runes: 'Runes', 'rune deck': 'Runes',
  sideboard: 'Sideboard', side: 'Sideboard', sb: 'Sideboard',
};

// Detect a section header. Handles "MainDeck:", "Main Deck (40)", "Sideboard"
// and known aliases. Returns the canonical section name, or null.
function headerOf(line) {
  if (/^\s*\d/.test(line)) return null; // starts with a quantity → it's a card line
  const stripped = line.replace(/\(\s*\d+\s*\)\s*$/, '').replace(/:\s*$/, '').trim();
  const key = stripped.toLowerCase();
  if (SECTION_ALIASES[key]) return SECTION_ALIASES[key];
  // A bare "Word:" header line that isn't a known alias — keep its own name.
  if (/:\s*$/.test(line) && /^[\w\s'/&-]+$/.test(stripped)) return stripped;
  return null;
}

// Strip trailing set/collector codes like " (OGN-123)" or " [OGN 123]".
function cleanName(name) {
  return name
    .replace(/\s*[([][A-Za-z]{2,5}[-\s]?\d+[a-z]?[)\]]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse one card line. Handles "3 Name", "3x Name", "Name x3", "Name 3",
// optional bullet prefixes, and bare 1-of names.
function cardOf(line) {
  const s = line.replace(/^[-*•·]\s*/, '').trim();
  let m = s.match(/^(\d+)\s*[xX]?\s+(.+)$/);
  if (m) return { quantity: parseInt(m[1], 10), name: cleanName(m[2]) };
  m = s.match(/^(.+?)\s+[xX]?(\d+)$/);
  if (m) return { quantity: parseInt(m[2], 10), name: cleanName(m[1]) };
  if (s) return { quantity: 1, name: cleanName(s) };
  return null;
}

// A "Name:"/"Deck:" line carrying a value is deck metadata, not a card.
const NAME_META = /^\s*(?:deck\s*name|deck|name)\s*[:=]\s*\S.*$/i;

export function parseDeckList(text) {
  const sections = {};
  let current = null;
  const push = (entry) => {
    if (!entry || !entry.name) return;
    if (!current) current = 'MainDeck'; // implicit section for header-less lists
    (sections[current] ??= []).push(entry);
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (NAME_META.test(line)) continue; // "Name: …" / "Deck: …" metadata line

    const header = headerOf(line);
    if (header) { current = header; sections[current] ??= []; continue; }

    push(cardOf(line));
  }

  return sections;
}

// Normalize a card name for loose matching:
// "Pyke - Returned"  →  "pyke returned"
// "Pyke, Returned"   →  "pyke returned"
function norm(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildNameMap(cards) {
  const map = new Map();
  for (const card of cards) {
    // Canonical key
    map.set(norm(card.name), card);
    // Also index without "(Alternate Art)" suffix so we don't accidentally pick alts
  }
  return map;
}

export function matchDeckList(sections, nameMap) {
  const result = {};

  for (const [section, entries] of Object.entries(sections)) {
    result[section] = entries.map(({ quantity, name }) => {
      const key = norm(name);
      const card = nameMap.get(key) ?? null;
      return { name, quantity, card };
    });
  }

  return result;
}

// Pull "Fury Rune" → "Fury" when a rune line doesn't match a real card.
function runeDomainFromName(name) {
  const m = name.match(/^(\w+)\s+rune$/i);
  if (!m) return null;
  return ELEMENTAL_DOMAINS.find(d => d.toLowerCase() === m[1].toLowerCase()) ?? null;
}

// Try to read a deck name out of a "Name:"/"Deck:" style header line.
function deckNameFromText(text) {
  const m = text.match(/^\s*(?:deck\s*name|deck|name)\s*[:=]\s*(.+?)\s*$/im);
  return m ? m[1].trim() : null;
}

// Convert a pasted decklist into the deck-builder's deck shape. Cards are
// routed by their real classification (legend / rune / battlefield / other),
// so a flat header-less list from another site still lands in the right zones.
// Runes collapse to abstract per-domain counts. Returns the importable fields
// plus a report of what matched and what didn't.
export function deckFromImport(text, nameMap) {
  const sections = matchDeckList(parseDeckList(text), nameMap);

  const main = {}, sideboard = {}, runes = {};
  let legendId = null, championId = null;
  const unknown = [];
  let total = 0, matchedCount = 0;

  const addMain = (id, q) => { main[id] = (main[id] ?? 0) + q; };

  for (const [section, entries] of Object.entries(sections)) {
    const sec = section.toLowerCase();
    for (const { name, quantity, card } of entries) {
      total += quantity;

      if (!card) {
        const dm = runeDomainFromName(name);
        if (dm) { runes[dm] = (runes[dm] ?? 0) + quantity; matchedCount += quantity; }
        else unknown.push({ name, quantity });
        continue;
      }

      matchedCount += quantity;
      const type = card.classification?.type;

      if (type === 'Legend') { legendId ??= card.id; continue; }

      if (type === 'Rune') {
        const dm = (card.classification?.domain ?? []).find(d => ELEMENTAL_DOMAINS.includes(d));
        if (dm) runes[dm] = (runes[dm] ?? 0) + quantity;
        continue;
      }

      // A "Champion:" section marks the chosen champion. Its actual copy lives
      // in the main deck (added after the loop if the list didn't repeat it),
      // so don't add to main here — that would double-count our own export.
      if (sec === 'champion' || sec === 'champions') { championId ??= card.id; continue; }

      if (sec.includes('side')) { sideboard[card.id] = (sideboard[card.id] ?? 0) + quantity; continue; }

      addMain(card.id, quantity);
    }
  }

  // Ensure the chosen champion is present in the main deck.
  if (championId && !(championId in main)) addMain(championId, 1);

  return {
    name: deckNameFromText(text),
    legendId, championId, main, sideboard, runes,
    unknown, total, matchedCount,
  };
}

export const SECTION_ORDER = KNOWN_SECTIONS;
