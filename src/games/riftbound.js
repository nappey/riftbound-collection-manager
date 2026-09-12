// Riftbound (Riot's League of Legends TCG) — game config + data adapter.
// Card data comes from riftcodex; prices and promo art from tcgcsv (category 89).
import RiftText from '../components/RiftText';
import { splitRiftParagraphs } from '../utils/riftText';
import { dedupeCards } from '../utils/dedupeCards';
import { fetchTcgProducts, augmentCards } from '../utils/tcgAugment';
import { augmentRunes } from '../utils/runeArt';
import { SET_LOGOS } from '../utils/setLogos';
import { toCSV, buildRidMap, matchCSVRows } from '../utils/csvImport';
import * as rules from './riftboundRules';
import { defineGame } from './defineGame';

const API_BASE = 'https://api.riftcodex.com';
const PAGE_SIZE = 100;

async function fetchAllCards() {
  // no-store so new sets/cards always appear on launch instead of being served
  // a stale cached response from disk.
  const first = await fetch(`${API_BASE}/cards?size=${PAGE_SIZE}&page=1`, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
  });
  const remaining = [];
  for (let p = 2; p <= first.pages; p++) {
    remaining.push(fetch(`${API_BASE}/cards?size=${PAGE_SIZE}&page=${p}`, { cache: 'no-store' }).then((r) => r.json()));
  }
  const rest = await Promise.all(remaining);
  return [first, ...rest].flatMap((d) => d.items);
}

async function loadCards({ tcgcsvBase }) {
  let cards = await fetchAllCards();
  // The API re-ingests some sets (currently Vendetta), serving each card
  // several times under different ids. Drop the ghosts before anything
  // downstream counts or groups them.
  cards = dedupeCards(cards);
  try {
    // Swap in the correct Arcane (PR) promo art (riftcodex serves the
    // base art for those).
    const tcg = await fetchTcgProducts(tcgcsvBase);
    cards = augmentCards(cards, tcg);
  } catch { /* tcgcsv unavailable — fall back to riftcodex data as-is */ }
  // Curated rune art + missing rune printings (local images).
  return augmentRunes(cards);
}

// ── Prices (tcgcsv groups → /prices) ───────────────────────────

// Fallback TCGplayer group IDs (Riftbound = category 89) used only if runtime
// group discovery fails — normally the full set list is fetched from tcgcsv so
// new sets get prices automatically.
const FALLBACK_GROUP_IDS = [24344, 24439, 24502, 24519, 24528, 24552, 24560, 24343];

async function fetchGroupIds(tcgcsvBase) {
  try {
    const res = await fetch(`${tcgcsvBase}/groups`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`groups ${r.status}`);
      return r.json();
    });
    const ids = (res.results ?? []).map((g) => g.groupId).filter((id) => id != null);
    if (ids.length) return ids;
  } catch (e) {
    console.warn('[prices] group discovery failed, using fallback list:', e?.message ?? e);
  }
  return FALLBACK_GROUP_IDS;
}

async function loadPrices(tcgcsvBase) {
  const groupIds = await fetchGroupIds(tcgcsvBase);
  const responses = await Promise.allSettled(
    groupIds.map((gid) =>
      fetch(`${tcgcsvBase}/${gid}/prices`).then((r) => r.json())
    )
  );
  const priceMap = {};
  for (const res of responses) {
    if (res.status !== 'fulfilled') continue;
    for (const price of res.value.results ?? []) {
      if (price.marketPrice == null) continue;
      const id = String(price.productId);
      if (!priceMap[id]) priceMap[id] = { normal: null, foil: null };
      const entry = { market: price.marketPrice, low: price.lowPrice };
      if (price.subTypeName === 'Foil') {
        priceMap[id].foil = entry;
      } else {
        priceMap[id].normal = entry;
      }
    }
  }
  return priceMap;
}

// ── CSV (Piltover Archive format) ──────────────────────────────

// "unl-001-219" → "UNL-001",  "unl-145a-219" → "UNL-145a"
function variantNumber(card) {
  const rid = card.riftbound_id;
  if (rid) return rid.replace(/-\d+$/, '').toUpperCase();
  const num = String(card.collector_number ?? '').padStart(3, '0');
  return `${card.set?.set_id ?? 'UNK'}-${num}`;
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const SET_DISPLAY = Object.fromEntries(rules.SETS.map(s => [s.id, s.label]));

function generateCSV(allCards, collection, foilCollection) {
  const rows = [[
    'Variant Number', 'Card Name', 'Set', 'Set Prefix', 'Rarity',
    'Variant Type', 'Variant Label', 'Quantity', 'Language', 'Condition',
    'Grading Company', 'Grading Value', 'Grading Label', 'Notes',
  ]];

  for (const card of allCards) {
    const count     = collection[card.id] ?? 0;
    const foilCount = foilCollection[card.id] ?? 0;
    if (count === 0 && foilCount === 0) continue;

    const varNum  = variantNumber(card);
    const setId   = card.set?.set_id ?? '';
    const setName = SET_DISPLAY[setId] ?? card.set?.label ?? setId;
    const rarity  = capitalize(card.classification?.rarity ?? '');
    const isAlt   = card.metadata?.alternate_art;

    if (count > 0) {
      rows.push([
        varNum, card.name, setName, setId, rarity,
        isAlt ? 'Alt Art' : 'Standard',
        isAlt ? 'Alt Art' : 'Standard',
        count, 'English', 'Near Mint', '', '', '', '',
      ]);
    }
    if (foilCount > 0) {
      rows.push([
        varNum, card.name, setName, setId, rarity,
        'Foil', 'Foil',
        foilCount, 'English', 'Near Mint', '', '', '', '',
      ]);
    }
  }
  return toCSV(rows);
}

function matchCSV(rows, allCards) {
  return matchCSVRows(rows, buildRidMap(allCards), allCards);
}

// ── Deck rules ─────────────────────────────────────────────────

const ELEMENTAL_DOMAINS = ['Body', 'Calm', 'Chaos', 'Fury', 'Mind', 'Order'];
const MAIN_TARGET = 40;
const SIDEBOARD_MAX = 10;
const RUNE_TARGET = 12;

const legendDomains = (card) =>
  (card?.classification?.domain ?? []).filter(d => ELEMENTAL_DOMAINS.includes(d));

function prepopulateRunes(domains) {
  const runes = {};
  const n = domains.length;
  if (!n) return runes;
  const base = Math.floor(RUNE_TARGET / n);
  let rem = RUNE_TARGET - base * n;
  for (const d of domains) runes[d] = base + (rem-- > 0 ? 1 : 0);
  return runes;
}

const typeOf = (c) => c.classification?.supertype === 'Champion' ? 'Champion' : c.classification?.type;

const deck = {
  identity: { kind: 'single', label: 'Legend', max: 1 },
  hasChampion: true,
  hasRunes: true,
  hasBattlefields: true,
  main: { min: MAIN_TARGET, max: MAIN_TARGET },
  sideboardMax: SIDEBOARD_MAX,
  runeTarget: RUNE_TARGET,
  copyCap: (card) => (rules.isSingleton(card) ? 1 : 3),
  // Type quick-filter chips for the card library (matches classification.type,
  // except 'Champion' which is a supertype).
  libraryTypes: ['Legend', 'Champion', 'Unit', 'Spell', 'Gear', 'Rune', 'Battlefield'],
  typeOf,
  typeOrder: { Champion: 0, Unit: 1, Spell: 2, Gear: 3, Rune: 4, Battlefield: 5 },
  statTypes: [['Champions', 'Champion'], ['Units', 'Unit'], ['Spells', 'Spell'], ['Gear', 'Gear'], ['Battlefields', 'Battlefield']],
  curveMax: 7,
  costLabel: 'Energy',
  factionLabel: 'Domains',
  identityFactions: legendDomains,
  seedRunes: (identityCards) => prepopulateRunes(legendDomains(identityCards[0])),
  // A card is playable if every elemental domain it has is one of the
  // legend's domains; domainless/neutral cards are always allowed.
  libraryFilter: (card, identityCards) => {
    const legendSet = new Set(legendDomains(identityCards[0]));
    return (card.classification?.domain ?? [])
      .filter(d => ELEMENTAL_DOMAINS.includes(d))
      .every(d => legendSet.has(d));
  },
  libraryFilterToggle: false,
  libraryFilterBadge: null,
  stepCopy: {
    pickIdentity: 'Pick your legend — it sets your domains and rune deck.',
    addCards: "Add cards — showing your legend's domains:",
    identityEmpty: 'Click a Legend in the library — its domains set up your rune deck.',
    mainEmpty: 'Empty — add cards from the library. Set a chosen champion from a champion in your deck.',
  },
  validate: ({ deck: d, analysis, champion }) => [
    { key: 'legend', ok: !!d.legendId, label: 'Legend' },
    { key: 'champion', ok: !!champion, label: 'Chosen champion' },
    { key: 'main', ok: analysis.mainCount === MAIN_TARGET, label: `Main ${analysis.mainCount}/${MAIN_TARGET}` },
    { key: 'runes', ok: analysis.runeCount === RUNE_TARGET, label: `Runes ${analysis.runeCount}/${RUNE_TARGET}` },
    { key: 'sb', ok: analysis.sideboardCount <= SIDEBOARD_MAX, over: analysis.sideboardCount > SIDEBOARD_MAX, label: `SB ${analysis.sideboardCount}/${SIDEBOARD_MAX}` },
  ],
  buildDecklistText: ({ deck: d, analysis, identityCards, champion }) => {
    let out = '';
    if (identityCards[0]) out += `Legend:\n1 ${identityCards[0].name}\n\n`;
    if (champion) out += `Champion:\n1 ${champion.name}\n\n`;
    if (analysis.mainRows.length) {
      out += 'MainDeck:\n';
      for (const { card, qty } of analysis.mainRows) out += `${qty} ${card.name}\n`;
      out += '\n';
    }
    if (analysis.battlefieldRows.length) {
      out += 'Battlefields:\n';
      for (const { card, qty } of analysis.battlefieldRows) out += `${qty} ${card.name}\n`;
      out += '\n';
    }
    const runeEntries = Object.entries(d.runes).filter(([, n]) => n > 0);
    if (runeEntries.length) {
      out += 'Runes:\n';
      for (const [domain, n] of runeEntries) out += `${n} ${domain} Rune\n`;
      out += '\n';
    }
    if (analysis.sideboardRows.length) {
      out += 'Sideboard:\n';
      for (const { card, qty } of analysis.sideboardRows) out += `${qty} ${card.name}\n`;
      out += '\n';
    }
    return out.trimEnd();
  },
  importPlaceholder: `Paste a decklist (works with this app's export or
plain text from other sites):

Legend:
1 Pyke, Bloodharbor Ripper

MainDeck:
3 Sneaky Deckhand
3 Tideturner

Runes:
6 Fury Rune
6 Chaos Rune

Sideboard:
2 Downwell`,
  checkPlaceholder: `Legend:
1 Pyke, Bloodharbor Ripper

Champion:
1 Pyke, Returned

MainDeck:
3 Sneaky Deckhand
3 Tideturner
3 Bewitching Spirit
2 Abandon
2 Gust

Battlefields:
1 The Arena's Greatest
1 Hall of Legends
1 Ripper's Bay

Runes:
6 Fury Rune
6 Chaos Rune

Sideboard:
2 Brynhir Thundersong
2 Downwell`,
  checkHeaders: ['Legend:', 'Champion:', 'MainDeck:'],
  sectionOrder: ['Legend', 'Champion', 'MainDeck', 'Battlefields', 'Runes', 'Sideboard'],
  sectionLabels: {
    Legend: 'Legend', Champion: 'Champion', MainDeck: 'Main Deck',
    Battlefields: 'Battlefields', Runes: 'Rune Deck', Sideboard: 'Sideboard',
  },
  // Header words other sites use, mapped to our canonical section names.
  sectionAliases: {
    legend: 'Legend', legends: 'Legend',
    champion: 'Champion', champions: 'Champion',
    main: 'MainDeck', maindeck: 'MainDeck', 'main deck': 'MainDeck',
    deck: 'MainDeck', units: 'MainDeck', spells: 'MainDeck', gear: 'MainDeck',
    battlefield: 'Battlefields', battlefields: 'Battlefields',
    rune: 'Runes', runes: 'Runes', 'rune deck': 'Runes',
    sideboard: 'Sideboard', side: 'Sideboard', sb: 'Sideboard',
  },
  elementalFactions: ELEMENTAL_DOMAINS,
};

export default defineGame({
  id: 'riftbound',
  label: 'Riftbound',
  api: { loadCards, imagesExpire: false },
  prices: { tcgcsvCategory: 89, load: loadPrices },
  sets: rules.SETS,
  faction: { key: 'domain', label: 'Domain', values: ['Body', 'Calm', 'Chaos', 'Fury', 'Mind', 'Order'], neutral: 'Colorless' },
  attributes: [
    { key: 'energy', label: 'Energy' },
    { key: 'power', label: 'Power' },
    { key: 'might', label: 'Might' },
  ],
  costLabel: 'Energy',
  types: ['Unit', 'Spell', 'Gear', 'Legend', 'Battlefield'],
  rarities: ['Common', 'Uncommon', 'Rare', 'Showcase'],
  rarityOrder: { common: 0, uncommon: 1, rare: 2, showcase: 3 },
  statsRarities: ['common', 'uncommon', 'rare', 'epic', 'showcase'],
  rarityClass: { epic: 'epic', rare: 'rare', showcase: 'showcase' },
  features: { runeBox: true, promoBox: true, setLogos: SET_LOGOS },
  rules,
  text: { Component: RiftText, split: splitRiftParagraphs },
  csv: { generate: generateCSV, match: matchCSV },
  export: {
    title: 'Riftbound Collection',
    buyListTitle: 'Riftbound Buy List',
    contentOptions: ['foils', 'champions', 'signatures', 'allOwned', 'lookingFor', 'upForTrade'],
  },
  deck,
});
