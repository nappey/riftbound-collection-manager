import { useEffect, useMemo, useState, useCallback } from 'react';
import SetSection from './components/SetSection';
import RuneBox from './components/RuneBox';
import PromoBox from './components/PromoBox';
import FilterBar from './components/FilterBar';
import ImportButton from './components/ImportButton';
import ExportButton from './components/ExportButton';
import CardModal from './components/CardModal';
import UpdateToast from './components/UpdateToast';
import CheckForUpdatesButton from './components/CheckForUpdatesButton';
import SetPicker from './components/SetPicker';
import Decks from './pages/Decks';
import Export from './pages/Export';
import SetEntry from './pages/SetEntry';
import TradeBinder from './pages/TradeBinder';
import Shopping from './pages/Shopping';
import Stats from './pages/Stats';
import { fetchTcgProducts, augmentCards } from './utils/tcgAugment';
import { augmentRunes } from './utils/runeArt';
import './App.css';
import './pages.css';

const API_BASE = 'https://api.riftcodex.com';
const PAGE_SIZE = 100;
const STORAGE_KEY      = 'riftbound-collection';
const FOIL_STORAGE_KEY = 'riftbound-collection-foil';
const LF_KEY           = 'riftbound-looking-for';
const UFT_KEY          = 'riftbound-up-for-trade';
const DECKS_KEY        = 'riftbound-decks';
const IS_ELECTRON = typeof window !== 'undefined' && window.__electron__?.isElectron;
const TCGCSV_BASE = IS_ELECTRON
  ? 'https://tcgcsv.com/tcgplayer/89'
  : '/tcgcsv/tcgplayer/89';
// Fallback TCGplayer group IDs (Riftbound = category 89) used only if runtime
// group discovery fails — normally the full set list is fetched from tcgcsv so
// new sets get prices automatically.
const FALLBACK_GROUP_IDS = [24344, 24439, 24502, 24519, 24528, 24552, 24560, 24343];

const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, showcase: 3 };

const SET_LABELS = {
  OGN: 'Origins',
  OGS: 'Proving Grounds',
  OPP: 'Organized Play Promos',
  SFD: 'Spiritforged',
  UNL: 'Unleashed',
  PR:  'Promotional Cards',
  JDG: 'Judge Promos',
  RWB: 'Worlds Bundle 2025',
};

const PROMO_SETS = new Set(['OGS', 'OPP', 'PR', 'JDG', 'RWB']);
const PROMO_FOLD_SETS = new Set(['OPP', 'PR', 'JDG', 'RWB']);
const PROMO_SHORT_LABELS = {
  OPP: 'OP Promo', PR: 'Promo', JDG: 'Judge', RWB: 'Worlds',
};

async function fetchAllCards() {
  const first = await fetch(`${API_BASE}/cards?size=${PAGE_SIZE}&page=1`).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
  });
  const remaining = [];
  for (let p = 2; p <= first.pages; p++) {
    remaining.push(fetch(`${API_BASE}/cards?size=${PAGE_SIZE}&page=${p}`).then((r) => r.json()));
  }
  const rest = await Promise.all(remaining);
  return [first, ...rest].flatMap((d) => d.items);
}

// Discover every Riftbound set's TCGplayer group ID at runtime so a brand-new
// set gets prices with no code change. Falls back to the known list if the
// groups endpoint is unavailable.
async function fetchGroupIds() {
  try {
    const res = await fetch(`${TCGCSV_BASE}/groups`).then((r) => {
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

async function fetchAllPrices() {
  const groupIds = await fetchGroupIds();
  const responses = await Promise.allSettled(
    groupIds.map((gid) =>
      fetch(`${TCGCSV_BASE}/${gid}/prices`).then((r) => r.json())
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

function applyFilters(cards, filters, collection) {
  const search = filters.search.toLowerCase().trim();
  return cards.filter((card) => {
    if (search && !card.name.toLowerCase().includes(search)) return false;
    if (filters.type && card.classification?.type !== filters.type) return false;
    if (filters.rarity && card.classification?.rarity?.toLowerCase() !== filters.rarity.toLowerCase()) return false;
    if (filters.domain) {
      const domains = (card.classification?.domain ?? []).map((d) => d.toLowerCase());
      if (!domains.includes(filters.domain.toLowerCase())) return false;
    }
    if (filters.status !== 'all') {
      const count = collection[card.id] ?? 0;
      if (filters.status === 'owned' && count === 0) return false;
      if (filters.status === 'missing' && count > 0) return false;
      if (filters.status === 'playset' && count < 3) return false;
      if (filters.status === 'incomplete' && (count === 0 || count >= 3)) return false;
    }
    return true;
  });
}

function applySort(cards, sort, collection) {
  return [...cards].sort((a, b) => {
    let cmp;
    switch (sort.field) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'rarity':
        cmp = (RARITY_ORDER[a.classification?.rarity?.toLowerCase()] ?? 0) -
              (RARITY_ORDER[b.classification?.rarity?.toLowerCase()] ?? 0);
        break;
      case 'energy':
        cmp = (a.attributes?.energy ?? 99) - (b.attributes?.energy ?? 99);
        break;
      case 'count':
        cmp = (collection[b.id] ?? 0) - (collection[a.id] ?? 0);
        break;
      default:
        cmp = (a.collector_number ?? 0) - (b.collector_number ?? 0);
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

function groupBySet(cards) {
  return cards.reduce((acc, card) => {
    const setId = card.set?.set_id ?? 'UNKNOWN';
    if (!acc[setId]) {
      acc[setId] = {
        label: SET_LABELS[setId] ?? card.set?.label ?? setId,
        promo: PROMO_SETS.has(setId),
        cards: [],
      };
    }
    acc[setId].cards.push(card);
    return acc;
  }, {});
}

// Pick a representative card to act as a set's "cover" art — prefer a Legend,
// then a Champion, else the lowest collector number. Alt-art printings are
// skipped so the cover shows the standard look. (No API exposes set logos, so
// a signature card from the set stands in as its visual identity.)
function pickSetArt(cards) {
  const withImg = cards.filter(c => c.media?.image_url && !c.metadata?.alternate_art);
  const pool = withImg.length ? withImg : cards.filter(c => c.media?.image_url);
  if (!pool.length) return null;
  return pool.find(c => c.classification?.type === 'Legend')
      ?? pool.find(c => c.classification?.supertype === 'Champion')
      ?? [...pool].sort((a, b) => (a.collector_number ?? 9999) - (b.collector_number ?? 9999))[0];
}

function totalCollectionValue(cards, collection, foilCollection, prices) {
  return cards.reduce((sum, card) => {
    const p = prices[card.tcgplayer_id] ?? {};
    return sum + (collection[card.id] ?? 0) * (p.normal?.market ?? 0)
               + (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
  }, 0);
}

const DEFAULT_FILTERS = { search: '', type: '', rarity: '', domain: '', status: 'all' };
const DEFAULT_SORT = { field: 'collector_number', dir: 'asc' };

// SVG icons
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
  </svg>
);
const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
);
const RowsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

function ListRow({ card, count, foilCount, price, pricesLoading, onAdjust, onAdjustFoil }) {
  const imgSrc = card.media?.image_url ?? null;
  const domain = (card.classification?.domain?.[0] ?? '').toLowerCase();
  const normalPrice = price?.normal?.market;
  const total = count + foilCount;
  let status = total >= 3 ? 'playset' : total > 0 ? 'incomplete' : 'missing';

  return (
    <div className={`list-row s-${status}`}>
      <span className="list-num">#{card.collector_number}</span>
      <div className="list-thumb">
        {imgSrc ? <img src={imgSrc} alt={card.name} loading="lazy" /> : null}
      </div>
      <div className="list-name">
        {card.name}
        <span className="list-id">{card.id?.toUpperCase()}</span>
      </div>
      <div className="list-meta">
        <span>{card.classification?.type}</span>
        <span style={{color: `var(--d-${domain})`}}>{domain}</span>
      </div>
      <span className="list-price">{pricesLoading ? '…' : normalPrice ? `$${normalPrice.toFixed(2)}` : '—'}</span>
      <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
        <div className="stepper">
          <button onClick={() => onAdjust(card.id, -1)} disabled={count === 0}>−</button>
          <span className="val">{count}</span>
          <button onClick={() => onAdjust(card.id, 1)}>+</button>
        </div>
        <div className="stepper foil">
          <button onClick={() => onAdjustFoil(card.id, -1)} disabled={foilCount === 0}>−</button>
          <span className="val">{foilCount}</span>
          <button onClick={() => onAdjustFoil(card.id, 1)}>+</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [allCards, setAllCards] = useState([]);
  const [prices, setPrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [collection, setCollection] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  });
  const [foilCollection, setFoilCollection] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FOIL_STORAGE_KEY)) || {}; }
    catch { return {}; }
  });
  const [lookingFor, setLookingFor] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LF_KEY)) || {}; }
    catch { return {}; }
  });
  const [upForTrade, setUpForTrade] = useState(() => {
    try { return JSON.parse(localStorage.getItem(UFT_KEY)) || {}; }
    catch { return {}; }
  });
  const [decks, setDecks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DECKS_KEY)) || []; }
    catch { return []; }
  });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [modalCard, setModalCard] = useState(null);
  const [tab, setTab] = useState('collection');
  // Signal to the deck builder to create + open a new deck seeded with a Legend.
  const [newDeckLegend, setNewDeckLegend] = useState(null);
  const startDeckWithLegend = useCallback((card) => {
    setNewDeckLegend(card);
    setModalCard(null);
    setTab('decks');
  }, []);
  const consumeNewDeckLegend = useCallback(() => setNewDeckLegend(null), []);
  const [activeSetId, setActiveSetId] = useState(null);
  const [view, setView] = useState('grid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAllCards()
      .then(async (cards) => {
        try {
          // Swap in the correct Arcane (PR) promo art (riftcodex serves the
          // base art for those).
          const tcg = await fetchTcgProducts(TCGCSV_BASE);
          cards = augmentCards(cards, tcg);
        } catch { /* tcgcsv unavailable — fall back to riftcodex data as-is */ }
        // Curated rune art + missing rune printings (local images).
        cards = augmentRunes(cards);
        setAllCards(cards);
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
    fetchAllPrices()
      .then((map) => { setPrices(map); setPricesLoading(false); })
      .catch(() => setPricesLoading(false));
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }, [collection]);
  useEffect(() => { localStorage.setItem(FOIL_STORAGE_KEY, JSON.stringify(foilCollection)); }, [foilCollection]);
  useEffect(() => { localStorage.setItem(LF_KEY, JSON.stringify(lookingFor)); }, [lookingFor]);
  useEffect(() => { localStorage.setItem(UFT_KEY, JSON.stringify(upForTrade)); }, [upForTrade]);
  useEffect(() => { localStorage.setItem(DECKS_KEY, JSON.stringify(decks)); }, [decks]);

  function adjust(cardId, delta) {
    setCollection((prev) => {
      const next = { ...prev };
      const val = (next[cardId] ?? 0) + delta;
      if (val <= 0) { delete next[cardId]; } else { next[cardId] = val; }
      return next;
    });
  }

  function adjustFoil(cardId, delta) {
    setFoilCollection((prev) => {
      const next = { ...prev };
      const val = (next[cardId] ?? 0) + delta;
      if (val <= 0) { delete next[cardId]; } else { next[cardId] = val; }
      return next;
    });
  }

  function toggleLF(cardId) {
    setLookingFor(prev => {
      const next = { ...prev };
      if (next[cardId]) { delete next[cardId]; } else { next[cardId] = true; }
      return next;
    });
  }

  function toggleUFT(cardId) {
    setUpForTrade(prev => {
      const next = { ...prev };
      if (next[cardId]) { delete next[cardId]; } else { next[cardId] = true; }
      return next;
    });
  }

  function handleImport({ updates, foilUpdates }) {
    setCollection((prev) => ({ ...prev, ...updates }));
    setFoilCollection((prev) => ({ ...prev, ...foilUpdates }));
  }

  const allRuneCards = useMemo(
    () => allCards.filter(c => c.classification?.type === 'Rune'),
    [allCards]
  );

  const allPromoCards = useMemo(
    () => allCards.filter(c => PROMO_FOLD_SETS.has(c.set?.set_id) && c.classification?.type !== 'Rune'),
    [allCards]
  );

  const promoByName = useMemo(() => {
    const map = {};
    for (const card of allCards) {
      if (PROMO_FOLD_SETS.has(card.set?.set_id) && card.classification?.type !== 'Rune') {
        const key = card.name.toLowerCase().trim();
        (map[key] = map[key] || []).push(card);
      }
    }
    return map;
  }, [allCards]);

  const cardsBySet = useMemo(() => {
    const filtered = applyFilters(allCards, filters, collection)
      .filter(c => c.classification?.type !== 'Rune')
      .filter(c => !PROMO_FOLD_SETS.has(c.set?.set_id));
    const sorted = applySort(filtered, sort, collection);
    return groupBySet(sorted);
  }, [allCards, filters, sort, collection]);

  // Stats for all non-promo, non-rune cards
  const globalStats = useMemo(() => {
    const nonFolded = allCards.filter(c =>
      c.classification?.type !== 'Rune' && !PROMO_FOLD_SETS.has(c.set?.set_id)
    );
    const ownedCount = nonFolded.filter(c => (collection[c.id] ?? 0) > 0).length;
    const playsetCount = nonFolded.filter(c => (collection[c.id] ?? 0) >= 3).length;
    const totalValue = !pricesLoading ? totalCollectionValue(allCards, collection, foilCollection, prices) : null;
    return {
      owned: ownedCount,
      total: nonFolded.length,
      pct: nonFolded.length ? Math.round((playsetCount / nonFolded.length) * 100) : 0,
      value: totalValue,
    };
  }, [allCards, collection, foilCollection, prices, pricesLoading]);

  // Per-set stats for tabs
  const setTabStats = useMemo(() => {
    const m = {};
    const allNonFolded = allCards.filter(c =>
      c.classification?.type !== 'Rune' && !PROMO_FOLD_SETS.has(c.set?.set_id)
    );
    const allRunes = allCards.filter(c => c.classification?.type === 'Rune');
    // Group all non-rune cards by set
    const grouped = groupBySet(allNonFolded);
    for (const [sid, { cards }] of Object.entries(grouped)) {
      const owned = cards.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
      m[sid] = { total: cards.length, owned, pct: cards.length ? Math.round(owned / cards.length * 100) : 0 };
    }
    // Runes
    const runesOwned = allRunes.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
    m['runes'] = { total: allRunes.length, owned: runesOwned, pct: allRunes.length ? Math.round(runesOwned / allRunes.length * 100) : 0 };
    // Promos
    const allPromos = allCards.filter(c => PROMO_FOLD_SETS.has(c.set?.set_id) && c.classification?.type !== 'Rune');
    const promosOwned = allPromos.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
    m['promos'] = { total: allPromos.length, owned: promosOwned, pct: allPromos.length ? Math.round(promosOwned / allPromos.length * 100) : 0 };
    return m;
  }, [allCards, collection, foilCollection]);

  if (loading) return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-3)', fontFamily: 'var(--font-mono)'}}>
      Loading cards…
    </div>
  );
  if (error) return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--miss)'}}>
      Failed to load: {error}
    </div>
  );

  const setIds = Object.keys(cardsBySet);
  const totalVisible = setIds.reduce((n, id) => n + cardsBySet[id].cards.length, 0);
  const currentSetId = (activeSetId === 'runes' || activeSetId === 'promos') ? activeSetId
    : setIds.includes(activeSetId) ? activeSetId
    : (setIds[0] ?? null);

  // Entries for the set-picker dropdown: real sets first, then Rune Box / Promos.
  const statOf = (id) => setTabStats[id] ?? { owned: 0, total: 0, pct: 0 };
  const setPickerEntries = [
    ...setIds.map(sid => ({
      id: sid,
      label: cardsBySet[sid].label,
      kind: cardsBySet[sid].promo ? 'promoSet' : 'set',
      ...statOf(sid),
    })),
    { id: 'runes', label: 'Rune Box', kind: 'runes', ...statOf('runes') },
    { id: 'promos', label: 'Promos', kind: 'promos', ...statOf('promos') },
  ];

  // Active filter chips
  const activeChips = [];
  if (filters.type) activeChips.push({ k: 'type', label: filters.type, clear: () => setFilters(f => ({...f, type: ''})) });
  if (filters.rarity) activeChips.push({ k: 'rarity', label: filters.rarity, clear: () => setFilters(f => ({...f, rarity: ''})) });
  if (filters.domain) activeChips.push({ k: 'domain', label: filters.domain, clear: () => setFilters(f => ({...f, domain: ''})) });
  if (filters.status !== 'all') activeChips.push({ k: 'status', label: filters.status, clear: () => setFilters(f => ({...f, status: 'all'})) });

  // Set progress stats for the active set
  let setProgressStats = null;
  if (currentSetId && currentSetId !== 'runes' && currentSetId !== 'promos') {
    const allSetCards = allCards.filter(c =>
      c.set?.set_id === currentSetId &&
      c.classification?.type !== 'Rune' &&
      !PROMO_FOLD_SETS.has(c.set?.set_id)
    );
    const playsets = allSetCards.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) >= 3).length;
    const partial  = allSetCards.filter(c => {
      const total = (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0);
      return total > 0 && total < 3;
    }).length;
    const missing  = allSetCards.length - playsets - partial;
    const setValue = !pricesLoading ? allSetCards.reduce((sum, card) => {
      const p = prices[card.tcgplayer_id] ?? {};
      return sum + (collection[card.id] ?? 0) * (p.normal?.market ?? 0)
                 + (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
    }, 0) : null;
    setProgressStats = {
      name: cardsBySet[currentSetId]?.label ?? currentSetId,
      art: pickSetArt(allSetCards),
      playsets, partial, missing,
      total: allSetCards.length,
      value: setValue,
      pct: allSetCards.length ? (playsets / allSetCards.length) * 100 : 0,
      partialPct: allSetCards.length ? (partial / allSetCards.length) * 100 : 0,
    };
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"></div>
          <div className="brand-name">
            Card Manager <span className="muted">/ Riftbound</span>
          </div>
        </div>

        <div className="global-search">
          <span className="search-icon"><SearchIcon /></span>
          <input
            type="search"
            placeholder="Search cards…"
            value={filters.search}
            onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
          />
        </div>

        <div className="header-right">
          <CheckForUpdatesButton />
          <ExportButton allCards={allCards} collection={collection} foilCollection={foilCollection} />
          <ImportButton allCards={allCards} onImport={handleImport} />
        </div>
      </header>

      {/* ── Subnav ── */}
      <div className="subnav">
        <nav className="tabs">
          <button className={`tab${tab === 'collection' ? ' tab--active' : ''}`} onClick={() => setTab('collection')}>
            Collection
            {tab === 'collection' && <span className="tab-count">{totalVisible}</span>}
          </button>
          <button className={`tab${tab === 'entry' ? ' tab--active' : ''}`} onClick={() => setTab('entry')}>Set Entry</button>
          <button className={`tab${tab === 'shopping' ? ' tab--active' : ''}`} onClick={() => setTab('shopping')}>Shopping</button>
          <button className={`tab${tab === 'trade' ? ' tab--active' : ''}`} onClick={() => setTab('trade')}>Trade Binder</button>
          <button className={`tab${tab === 'stats' ? ' tab--active' : ''}`} onClick={() => setTab('stats')}>Stats</button>
          <button className={`tab${tab === 'decks' ? ' tab--active' : ''}`} onClick={() => setTab('decks')}>Decks</button>
          <button className={`tab${tab === 'export' ? ' tab--active' : ''}`} onClick={() => setTab('export')}>Export</button>
        </nav>
        <div className="stats-row">
          {globalStats.value != null && (
            <div className="stat">
              <span className="stat-label">Value</span>
              <span className="stat-value">${globalStats.value.toFixed(2)}</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-label">Owned</span>
            <span className="stat-value">{globalStats.owned}/{globalStats.total}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Complete</span>
            <span className="stat-value">{globalStats.pct}%</span>
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div className={`main${tab !== 'collection' ? ' no-sidebar' : ''}`}>
        {/* Sidebar — only in collection tab */}
        {tab === 'collection' && (
          <FilterBar
            filters={filters}
            sort={sort}
            onChange={setFilters}
            onSortChange={setSort}
            allCards={allCards.filter(c => c.classification?.type !== 'Rune' && !PROMO_FOLD_SETS.has(c.set?.set_id))}
          />
        )}

        {/* Content */}
        <div className="content">
          {tab === 'entry' ? (
            <SetEntry
              allCards={allCards}
              collection={collection}
              foilCollection={foilCollection}
              onAdjust={adjust}
              onAdjustFoil={adjustFoil}
              promoByName={promoByName}
              promoShortLabels={PROMO_SHORT_LABELS}
            />
          ) : tab === 'decks' ? (
            <Decks
              allCards={allCards}
              collection={collection}
              foilCollection={foilCollection}
              prices={prices}
              pricesLoading={pricesLoading}
              decks={decks}
              setDecks={setDecks}
              onOpenModal={setModalCard}
              newDeckLegend={newDeckLegend}
              onNewDeckConsumed={consumeNewDeckLegend}
            />
          ) : tab === 'shopping' ? (
            <Shopping
              allCards={allCards}
              collection={collection}
              foilCollection={foilCollection}
              prices={prices}
              pricesLoading={pricesLoading}
              lookingFor={lookingFor}
              onToggleLF={toggleLF}
              onOpenModal={setModalCard}
            />
          ) : tab === 'trade' ? (
            <TradeBinder
              allCards={allCards}
              collection={collection}
              foilCollection={foilCollection}
              prices={prices}
              pricesLoading={pricesLoading}
              lookingFor={lookingFor}
              upForTrade={upForTrade}
              onToggleLF={toggleLF}
              onToggleUFT={toggleUFT}
              onOpenModal={setModalCard}
            />
          ) : tab === 'stats' ? (
            <Stats
              allCards={allCards}
              collection={collection}
              foilCollection={foilCollection}
              prices={prices}
              pricesLoading={pricesLoading}
              onOpenModal={setModalCard}
            />
          ) : tab === 'export' ? (
            <Export
              allCards={allCards}
              collection={collection}
              foilCollection={foilCollection}
              prices={prices}
              pricesLoading={pricesLoading}
              lookingFor={lookingFor}
              upForTrade={upForTrade}
            />
          ) : (
            <>
              {/* Set picker — scalable dropdown replacing the old tab strip */}
              <div className="set-picker-row">
                <SetPicker
                  entries={setPickerEntries}
                  currentId={currentSetId}
                  onSelect={setActiveSetId}
                />
              </div>

              {/* Set progress */}
              {setProgressStats && (
                <div className="set-progress">
                  <div className="set-progress-head">
                    {setProgressStats.art && (
                      <button
                        className="set-cover"
                        onClick={() => setModalCard(setProgressStats.art)}
                        title={`${setProgressStats.name} — ${setProgressStats.art.name}`}
                      >
                        <img src={setProgressStats.art.media.image_url} alt="" loading="lazy" />
                      </button>
                    )}
                    <div className="set-progress-headings">
                      <h2 className="set-progress-title">{setProgressStats.name}</h2>
                      <span className="set-progress-sub">
                        {setProgressStats.playsets} playsets · {setProgressStats.partial} in progress · {setProgressStats.missing} missing
                      </span>
                    </div>
                  </div>
                  <div className="progress-legend">
                    <span className="legend-item"><span className="legend-swatch" style={{background: 'var(--accent)'}}></span> Playset</span>
                    <span className="legend-item"><span className="legend-swatch" style={{background: 'var(--accent-line)'}}></span> Partial</span>
                    <span className="legend-item"><span className="legend-swatch" style={{background: 'var(--bg-2)'}}></span> Missing</span>
                    {setProgressStats.value != null && (
                      <span style={{marginLeft: 12, color: 'var(--text-0)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 12}}>
                        ${setProgressStats.value.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="set-progress-bar">
                    <span className="seg-own" style={{width: setProgressStats.pct + '%'}}></span>
                    <span className="seg-partial" style={{width: setProgressStats.partialPct + '%'}}></span>
                  </div>
                </div>
              )}

              {/* Content toolbar */}
              <div className="content-toolbar">
                <div className="active-filters">
                  {activeChips.length > 0 ? activeChips.map(ch => (
                    <span key={ch.k} className="active-filter-pill">
                      {ch.label}
                      <button className="x-btn" onClick={ch.clear}>×</button>
                    </span>
                  )) : (
                    <span style={{fontSize: 12, color: 'var(--text-3)'}}>No filters applied</span>
                  )}
                </div>
                <div className="view-toggle">
                  <button className={view === 'grid' ? 'active' : ''} title="Grid view" onClick={() => setView('grid')}><GridIcon /></button>
                  <button className={view === 'list' ? 'active' : ''} title="List view" onClick={() => setView('list')}><RowsIcon /></button>
                </div>
              </div>

              {/* Cards */}
              {currentSetId === 'runes' ? (
                <RuneBox
                  allRuneCards={allRuneCards}
                  collection={collection}
                  foilCollection={foilCollection}
                  prices={prices}
                  pricesLoading={pricesLoading}
                  onAdjust={adjust}
                  onAdjustFoil={adjustFoil}
                  onOpenModal={setModalCard}
                  lookingFor={lookingFor}
                  upForTrade={upForTrade}
                  onToggleLF={toggleLF}
                  onToggleUFT={toggleUFT}
                />
              ) : currentSetId === 'promos' ? (
                <PromoBox
                  allPromoCards={allPromoCards}
                  collection={collection}
                  foilCollection={foilCollection}
                  prices={prices}
                  pricesLoading={pricesLoading}
                  onAdjust={adjust}
                  onAdjustFoil={adjustFoil}
                  onOpenModal={setModalCard}
                  lookingFor={lookingFor}
                  upForTrade={upForTrade}
                  onToggleLF={toggleLF}
                  onToggleUFT={toggleUFT}
                />
              ) : currentSetId ? (
                view === 'list' ? (
                  <div className="card-list">
                    <div className="list-row list-head">
                      <span>#</span>
                      <span></span>
                      <span>Name</span>
                      <span>Type · Domain</span>
                      <span>Price</span>
                      <span>Qty</span>
                    </div>
                    {cardsBySet[currentSetId].cards.map(card => (
                      <ListRow
                        key={card.id}
                        card={card}
                        count={collection[card.id] ?? 0}
                        foilCount={foilCollection[card.id] ?? 0}
                        price={prices[card.tcgplayer_id] ?? null}
                        pricesLoading={pricesLoading}
                        onAdjust={adjust}
                        onAdjustFoil={adjustFoil}
                      />
                    ))}
                  </div>
                ) : (
                  <SetSection
                    key={currentSetId}
                    setName={cardsBySet[currentSetId].label}
                    promo={cardsBySet[currentSetId].promo}
                    cards={cardsBySet[currentSetId].cards}
                    collection={collection}
                    foilCollection={foilCollection}
                    prices={prices}
                    pricesLoading={pricesLoading}
                    onAdjust={adjust}
                    onAdjustFoil={adjustFoil}
                    onOpenModal={setModalCard}
                    lookingFor={lookingFor}
                    upForTrade={upForTrade}
                    onToggleLF={toggleLF}
                    onToggleUFT={toggleUFT}
                    promoByName={promoByName}
                    promoShortLabels={PROMO_SHORT_LABELS}
                  />
                )
              ) : (
                <div className="status-placeholder">No cards match your filters.</div>
              )}
            </>
          )}
        </div>
      </div>

      <CardModal
        card={modalCard}
        price={modalCard ? prices[modalCard.tcgplayer_id] ?? null : null}
        pricesLoading={pricesLoading}
        onClose={() => setModalCard(null)}
        onStartDeck={startDeckWithLegend}
      />

      <UpdateToast />
    </div>
  );
}
