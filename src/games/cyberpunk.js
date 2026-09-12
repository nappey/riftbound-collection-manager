// Cyberpunk TCG — game config + data adapter.
// Cards from Netdeck.gg (powers cyberpunktcg.com/cards); prices, product ids
// and fallback scans from tcgcsv (category 92) via ProductsAndPrices.csv.
import CyberText from '../components/CyberText';
import { splitCyberParagraphs } from '../utils/cyberText';
import { toCSV } from '../utils/csvImport';
import { loadCards as loadNetdeckCards } from './cyberpunkApi';
import { fetchTcgRows, resolveTcgplayerIds, buildPriceMap } from './cyberpunkTcg';
import * as rules from './cyberpunkRules';
import { defineGame } from './defineGame';

// Netdeck set code → tcgcsv group id. Demo decks, pre-release, Edgerunner Open
// and Night City Brawl promos have no TCGplayer listing (unpriced).
const GROUP_BY_SET = {
  welcometonightcityretail: 24855,
  welcometonightcitybeta: 24845,
  boxtoppersretail: 24857,
  boxtoppersbeta: 24848,
  embracingpowerretailstarterdeck: 24858,
  embracingpowerbetastarterdeck: 24846,
  theheistretailstarterdeck: 24859,
  theheistbetastarterdeck: 24847,
  PRM01: 24860,
};
const GROUP_IDS = [...new Set(Object.values(GROUP_BY_SET))];

// The card load and the price load both need the tcgcsv rows; fetch them once
// per base URL and share the promise.
const rowsCache = new Map();
function tcgRows(tcgcsvBase) {
  if (!rowsCache.has(tcgcsvBase)) {
    rowsCache.set(tcgcsvBase, fetchTcgRows(tcgcsvBase, GROUP_IDS).catch(() => []));
  }
  return rowsCache.get(tcgcsvBase);
}

async function loadCards({ tcgcsvBase, netdeckBase }, onProgress) {
  const cards = await loadNetdeckCards({ netdeckBase }, onProgress);
  try {
    const rows = await tcgRows(tcgcsvBase);
    return resolveTcgplayerIds(cards, rows, GROUP_BY_SET);
  } catch {
    return cards; // tcgcsv unavailable — cards still work, just unpriced
  }
}

async function loadPrices(tcgcsvBase) {
  return buildPriceMap(await tcgRows(tcgcsvBase));
}

// ── CSV ────────────────────────────────────────────────────────

const SET_LABELS = Object.fromEntries(rules.SETS.map(s => [s.id, s.label]));

function generateCSV(allCards, collection, foilCollection) {
  const rows = [['Set Code', 'Set', 'Number', 'Card Name', 'Rarity', 'Finish', 'Quantity', 'Printing Id']];
  for (const card of allCards) {
    const count = collection[card.id] ?? 0;
    const foilCount = foilCollection[card.id] ?? 0;
    if (!count && !foilCount) continue;
    const setId = card.set?.set_id ?? '';
    const base = [
      setId, SET_LABELS[setId] ?? card.set?.label ?? setId,
      card.collector_label ?? card.collector_number, card.name, card.classification?.rarity ?? '',
    ];
    if (count > 0) rows.push([...base, 'Normal', count, card.id]);
    if (foilCount > 0) rows.push([...base, 'Foil', foilCount, card.id]);
  }
  return toCSV(rows);
}

function matchCSV(rows, allCards) {
  const byId = new Map(allCards.map(c => [c.id, c]));
  const byNumber = new Map(allCards.map(c => [`${c.set?.set_id}|${String(c.collector_label ?? c.collector_number).toLowerCase()}`, c]));
  const byName = new Map(allCards.map(c => [`${c.set?.set_id}|${c.name.toLowerCase()}`, c]));
  const updates = {}, foilUpdates = {}, unmatched = [];
  for (const row of rows) {
    const qty = parseInt(row['Quantity'], 10);
    if (!qty || qty <= 0) continue;
    const setId = row['Set Code'] ?? '';
    const card = byId.get(row['Printing Id'])
      ?? byNumber.get(`${setId}|${String(row['Number'] ?? '').toLowerCase()}`)
      ?? byName.get(`${setId}|${(row['Card Name'] ?? '').toLowerCase()}`);
    if (!card) { unmatched.push(row['Card Name'] || row['Number'] || '?'); continue; }
    const foil = (row['Finish'] ?? '').toLowerCase() === 'foil' || rules.isAlwaysFoil(card);
    const target = foil ? foilUpdates : updates;
    target[card.id] = (target[card.id] ?? 0) + qty;
  }
  return { updates, foilUpdates, unmatched };
}

// ── Deck rules (comprehensive rules / Netdeck validator) ───────
//   • exactly 3 Legends, one copy each, unique names, kept out of the deck
//   • main deck 40–50 cards, max 3 copies of a card
//   • sideboard max 7
//   • RAM budget: for each color, your Legends' combined RAM of that color must
//     cover the highest RAM requirement of any deck card of that color

const MAIN_MIN = 40, MAIN_MAX = 50, SIDEBOARD_MAX = 7, LEGEND_COUNT = 3;

const colorOf = (card) => card?.classification?.domain?.[0] ?? null;
const isLegend = (card) => card?.classification?.type === 'Legend';

// Legends' RAM provided per color.
function ramBudget(identityCards) {
  const budget = {};
  for (const c of identityCards) {
    const color = colorOf(c), ram = c?.attributes?.ram;
    if (color && ram != null) budget[color] = (budget[color] ?? 0) + ram;
  }
  return budget;
}

// Highest RAM required per color across the given non-Legend cards.
function ramRequired(cards) {
  const req = {};
  for (const c of cards) {
    if (isLegend(c)) continue;
    const color = colorOf(c), ram = c?.attributes?.ram;
    if (color && ram != null) req[color] = Math.max(req[color] ?? 0, ram);
  }
  return req;
}

const TYPE_ORDER = { Unit: 0, Gear: 1, Program: 2 };
const TYPE_SECTIONS = [['Unit', 'Units'], ['Gear', 'Gear'], ['Program', 'Programs']];

const IMPORT_PLACEHOLDER = [
  "Paste a decklist (works with this app's export or",
  "Netdeck.gg's text format):",
  '',
  '# My Deck',
  '',
  '// Legends (3)',
  '1 V: Streetkid',
  '1 Royce: Psycho on the Edge',
  '1 Adam Smasher: Ender of Legends',
  '',
  '// Units (3)',
  '3 Japantown Jonin',
  '',
  '// Sideboard (1)',
  '1 Mantis Blades',
].join('\n');

const CHECK_PLACEHOLDER = [
  '# My Deck',
  '',
  '// Legends (3)',
  '1 V: Streetkid',
  '1 Royce: Psycho on the Edge',
  '1 Adam Smasher: Ender of Legends',
  '',
  '// Units (6)',
  '3 Japantown Jonin',
  '3 Ruthless Lowlife',
  '',
  '// Gear (3)',
  '3 Mantis Blades',
  '',
  '// Programs (3)',
  '3 Detonate',
  '',
  '// Sideboard (2)',
  '2 Swordwise Huscle',
].join('\n');

const deck = {
  identity: { kind: 'multi', label: 'Legends', max: LEGEND_COUNT, uniqueBy: (c) => c.name.toLowerCase() },
  hasChampion: false,
  hasRunes: false,
  hasBattlefields: false,
  main: { min: MAIN_MIN, max: MAIN_MAX },
  sideboardMax: SIDEBOARD_MAX,
  runeTarget: 0,
  copyCap: (card) => (isLegend(card) ? 1 : 3),
  libraryTypes: ['Legend', 'Unit', 'Gear', 'Program'],
  typeOf: (c) => c.classification?.type,
  typeOrder: TYPE_ORDER,
  statTypes: [['Units', 'Unit'], ['Gear', 'Gear'], ['Programs', 'Program']],
  curveMax: 5,
  costLabel: 'Cost',
  factionLabel: 'Colors',
  identityFactions: (card) => {
    const color = colorOf(card);
    if (!color) return [];
    const ram = card.attributes?.ram;
    return [ram != null ? `${color} · ${ram} RAM` : color];
  },
  seedRunes: null,
  // Playable if the Legends' RAM of the card's color covers its RAM cost.
  libraryFilter: (card, identityCards) => {
    const ram = card.attributes?.ram, color = colorOf(card);
    if (ram == null || !color) return true;
    return (ramBudget(identityCards)[color] ?? 0) >= ram;
  },
  libraryFilterToggle: true,
  libraryFilterBadge: 'RAM',
  ramBudget,
  stepCopy: {
    pickIdentity: `Pick your ${LEGEND_COUNT} Legends — their colors and RAM set your budget.`,
    addCards: 'Add cards — showing what your Legends’ RAM can pay for:',
    identityEmpty: `Click Legends in the library — you need ${LEGEND_COUNT}. Their RAM sets which colors you can play.`,
    mainEmpty: 'Empty — add cards from the library.',
  },
  validate: ({ analysis, identityCards }) => {
    const n = identityCards.length;
    const names = identityCards.map(c => c.name.toLowerCase());
    const dup = new Set(names).size !== names.length;
    const rows = [
      { key: 'legends', ok: n === LEGEND_COUNT && !dup, label: `Legends ${n}/${LEGEND_COUNT}${dup ? ' · names must be unique' : ''}` },
      { key: 'main', ok: analysis.mainCount >= MAIN_MIN && analysis.mainCount <= MAIN_MAX, over: analysis.mainCount > MAIN_MAX, label: `Main ${analysis.mainCount}/${MAIN_MIN}–${MAIN_MAX}` },
      { key: 'sb', ok: analysis.sideboardCount <= SIDEBOARD_MAX, over: analysis.sideboardCount > SIDEBOARD_MAX, label: `SB ${analysis.sideboardCount}/${SIDEBOARD_MAX}` },
    ];
    if (n === 0 && analysis.mainCount > 0) {
      rows.push({ key: 'ram', warn: true, label: `Pick ${LEGEND_COUNT} Legends to define your RAM budget` });
    } else if (n > 0) {
      const budget = ramBudget(identityCards);
      const req = ramRequired(analysis.mainRows.map(r => r.card));
      for (const color of rules.COLORS) {
        const need = req[color] ?? 0, have = budget[color] ?? 0;
        if (need > have) {
          rows.push({ key: `ram-${color}`, ok: false, label: `${color} RAM insufficient: a card requires ${need} ${color} RAM but Legends only provide ${have}` });
        }
      }
    }
    return rows;
  },
  // Netdeck.gg's text format, so lists paste straight into their builder.
  buildDecklistText: ({ deck: d, analysis, identityCards }) => {
    const lines = [`# ${d.name}`, ''];
    if (identityCards.length) {
      lines.push(`// Legends (${identityCards.length})`);
      for (const c of identityCards) lines.push(`1 ${c.name}`);
      lines.push('');
    }
    for (const [type, label] of TYPE_SECTIONS) {
      const rows = analysis.mainRows.filter(r => r.card.classification?.type === type);
      if (!rows.length) continue;
      lines.push(`// ${label} (${rows.reduce((n, r) => n + r.qty, 0)})`);
      for (const { card, qty } of rows) lines.push(`${qty} ${card.name}`);
      lines.push('');
    }
    if (analysis.sideboardRows.length) {
      lines.push(`// Sideboard (${analysis.sideboardCount})`);
      for (const { card, qty } of analysis.sideboardRows) lines.push(`${qty} ${card.name}`);
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  },
  importPlaceholder: IMPORT_PLACEHOLDER,
  checkPlaceholder: CHECK_PLACEHOLDER,
  checkHeaders: ['// Legends', '// Units', '// Sideboard'],
  sectionOrder: ['Legend', 'MainDeck', 'Sideboard'],
  sectionLabels: { Legend: 'Legends', MainDeck: 'Main Deck', Sideboard: 'Sideboard' },
  sectionAliases: {
    legend: 'Legend', legends: 'Legend',
    main: 'MainDeck', maindeck: 'MainDeck', 'main deck': 'MainDeck', deck: 'MainDeck',
    unit: 'MainDeck', units: 'MainDeck', gear: 'MainDeck', gears: 'MainDeck',
    program: 'MainDeck', programs: 'MainDeck',
    sideboard: 'Sideboard', side: 'Sideboard', sb: 'Sideboard',
  },
  elementalFactions: rules.COLORS,
};

export default defineGame({
  id: 'cyberpunk',
  label: 'Cyberpunk TCG',
  api: { loadCards, imagesExpire: true },
  prices: { tcgcsvCategory: 92, load: loadPrices },
  sets: rules.SETS,
  faction: { key: 'domain', label: 'Color', values: rules.COLORS, neutral: null },
  attributes: [
    { key: 'energy', label: 'Cost' },
    { key: 'power', label: 'Power' },
    { key: 'ram', label: 'RAM' },
  ],
  costLabel: 'Cost',
  types: rules.TYPES,
  rarities: rules.RARITIES,
  rarityOrder: rules.RARITY_ORDER,
  statsRarities: rules.RARITIES.map(r => r.toLowerCase()),
  rarityClass: {
    rare: 'rare', epic: 'epic', 'nova rare': 'showcase', secret: 'showcase',
    'iconic legend': 'showcase', 'iconic other': 'showcase', 'iconic secret': 'showcase',
  },
  features: { runeBox: false, promoBox: false, setLogos: {} },
  rules,
  text: { Component: CyberText, split: splitCyberParagraphs },
  csv: { generate: generateCSV, match: matchCSV },
  export: {
    title: 'Cyberpunk TCG Collection',
    buyListTitle: 'Cyberpunk TCG Buy List',
    contentOptions: ['foils', 'allOwned', 'lookingFor', 'upForTrade'],
  },
  deck,
});
