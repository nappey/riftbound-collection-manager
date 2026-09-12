import { indexPrintings } from './printings';

// Every function here takes the active game config: its `deck` rules supply
// the section aliases, identity size and which zones exist.

// Detect a section header. Handles "MainDeck:", "Main Deck (40)", "Sideboard",
// Netdeck's "// Legends (3)" and known aliases. Returns the canonical section
// name, or null.
function headerOf(line, aliases) {
  if (/^\s*\d/.test(line)) return null; // starts with a quantity → it's a card line
  const stripped = line
    .replace(/^\/\/\s*/, '')                 // "// Units (12)" (Netdeck)
    .replace(/\(\s*\d+\s*\)\s*$/, '')
    .replace(/:\s*$/, '')
    .trim();
  const key = stripped.toLowerCase();
  if (aliases[key]) return aliases[key];
  // A bare "Word:" header line that isn't a known alias — keep its own name.
  if (/:\s*$/.test(line) && /^[\w\s'/&-]+$/.test(stripped)) return stripped;
  if (/^\/\//.test(line) && stripped) return stripped;
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
// Netdeck's "# Deck Name" title line.
const TITLE_LINE = /^\s*#\s+\S/;

export function parseDeckList(text, game) {
  const aliases = game.deck.sectionAliases;
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
    if (NAME_META.test(line) || TITLE_LINE.test(line)) continue; // metadata / title line

    const header = headerOf(line, aliases);
    if (header) { current = header; sections[current] ??= []; continue; }

    push(cardOf(line));
  }

  return sections;
}

// Normalize a card name for loose matching:
// "Pyke - Returned"  →  "pyke returned"
// "Pyke, Returned"   →  "pyke returned"
// "V: Streetkid"     →  "v streetkid"
function norm(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Name → canonical printing. Every printing of a card shares its name, so
// index the base printing of each group (rather than whichever came last) so
// an imported list resolves to the standard art.
export function buildNameMap(cards) {
  const printings = indexPrintings(cards);
  const map = new Map();
  for (const card of cards) {
    const base = printings.get(card.id)?.base ?? card;
    const key = norm(card.name);
    if (!map.has(key) || base === card) map.set(key, base);
    // Cyberpunk lists sometimes write "Name - Subname" or just the base name.
    if (card.subname) {
      const alt = norm(`${card.base_name ?? ''} ${card.subname}`);
      if (!map.has(alt)) map.set(alt, base);
    }
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

// Pull "Fury Rune" → "Fury" when a rune line doesn't match a real card
// (Riftbound tracks runes abstractly by domain, so "6 Fury Rune" → { Fury: 6 }).
function runeDomainFromName(name, domains) {
  const m = name.match(/^(\w+)\s+rune$/i);
  if (!m) return null;
  return domains.find(d => d.toLowerCase() === m[1].toLowerCase()) ?? null;
}

// Try to read a deck name out of a "Name:"/"Deck:"/"# Title" style line.
function deckNameFromText(text) {
  const m = text.match(/^\s*(?:deck\s*name|deck|name)\s*[:=]\s*(.+?)\s*$/im)
    ?? text.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

// Convert a pasted decklist into the deck-builder's deck shape. Cards are
// routed by their real classification (legend / rune / battlefield / other),
// so a flat header-less list from another site still lands in the right zones.
// Runes collapse to abstract per-domain counts (Riftbound). Returns the
// importable fields plus a report of what matched and what didn't.
export function deckFromImport(text, nameMap, game) {
  const R = game.deck;
  const domains = R.elementalFactions ?? [];
  const sections = matchDeckList(parseDeckList(text, game), nameMap);

  const main = {}, sideboard = {}, runes = {};
  const legendIds = [];
  let championId = null;
  const unknown = [];
  let total = 0, matchedCount = 0;

  const addMain = (id, q) => { main[id] = (main[id] ?? 0) + q; };

  for (const [section, entries] of Object.entries(sections)) {
    const sec = section.toLowerCase();
    for (const { name, quantity, card } of entries) {
      total += quantity;

      if (!card) {
        const dm = R.hasRunes ? runeDomainFromName(name, domains) : null;
        if (dm) { runes[dm] = (runes[dm] ?? 0) + quantity; matchedCount += quantity; }
        else unknown.push({ name, quantity });
        continue;
      }

      matchedCount += quantity;
      const type = card.classification?.type;

      if (type === 'Legend') {
        if (legendIds.length < R.identity.max && !legendIds.includes(card.id)) legendIds.push(card.id);
        continue;
      }

      if (R.hasRunes && type === 'Rune') {
        const dm = (card.classification?.domain ?? []).find(d => domains.includes(d));
        if (dm) runes[dm] = (runes[dm] ?? 0) + quantity;
        continue;
      }

      // A "Champion:" section marks the chosen champion. Its actual copy lives
      // in the main deck (added after the loop if the list didn't repeat it),
      // so don't add to main here — that would double-count our own export.
      if (R.hasChampion && (sec === 'champion' || sec === 'champions')) { championId ??= card.id; continue; }

      if (sec.includes('side')) { sideboard[card.id] = (sideboard[card.id] ?? 0) + quantity; continue; }

      addMain(card.id, quantity);
    }
  }

  // Ensure the chosen champion is present in the main deck.
  if (championId && !(championId in main)) addMain(championId, 1);

  return {
    name: deckNameFromText(text),
    legendId: legendIds[0] ?? null, legendIds, championId, main, sideboard, runes,
    unknown, total, matchedCount,
  };
}

export function sectionOrderFor(game) {
  return game.deck.sectionOrder;
}
