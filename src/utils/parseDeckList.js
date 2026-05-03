const KNOWN_SECTIONS = ['Legend', 'Champion', 'MainDeck', 'Battlefields', 'Runes', 'Sideboard'];

export function parseDeckList(text) {
  const sections = {};
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // Section header e.g. "MainDeck:"
    if (/^[\w\s]+:$/.test(line)) {
      current = line.slice(0, -1).trim();
      sections[current] = [];
      continue;
    }

    // Card line e.g. "3 Tideturner" or "1 Pyke, Returned"
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (m && current) {
      sections[current].push({ quantity: parseInt(m[1], 10), name: m[2].trim() });
    }
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

export const SECTION_ORDER = KNOWN_SECTIONS;
