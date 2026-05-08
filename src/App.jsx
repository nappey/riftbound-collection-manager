import { useEffect, useMemo, useState } from 'react';
import SetSection from './components/SetSection';
import RuneBox from './components/RuneBox';
import FilterBar from './components/FilterBar';
import ImportButton from './components/ImportButton';
import ExportButton from './components/ExportButton';
import CardModal from './components/CardModal';
import DeckCheck from './pages/DeckCheck';
import Export from './pages/Export';
import SetEntry from './pages/SetEntry';
import './App.css';

const API_BASE = 'https://api.riftcodex.com';
const PAGE_SIZE = 100;
const STORAGE_KEY      = 'riftbound-collection';
const FOIL_STORAGE_KEY = 'riftbound-collection-foil';
const LF_KEY           = 'riftbound-looking-for';
const UFT_KEY          = 'riftbound-up-for-trade';
// In Electron the main process injects CORS headers, so use the direct URL.
// In the browser dev server, use the Vite proxy to avoid CORS.
const IS_ELECTRON = typeof window !== 'undefined' && window.__electron__?.isElectron;
const TCGCSV_BASE = IS_ELECTRON
  ? 'https://tcgcsv.com/tcgplayer/89'
  : '/tcgcsv/tcgplayer/89';
const RIFTBOUND_GROUP_IDS = [24344, 24439, 24502, 24519, 24528, 24552, 24560, 24343];

const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, showcase: 3 };

const SET_LABELS = {
  OGN: 'Origins',
  OGS: 'Skirmish',
  OPP: 'Nexus Night Promos',
  SFD: 'Spiritforged',
  UNL: 'Unleashed',
  PR:  'Promotional Cards',
  JDG: 'Judge Promos',
  RWB: 'Worlds Bundle 2025',
};

// Sets that get the "promo" visual treatment
const PROMO_SETS = new Set(['OGS', 'OPP', 'PR', 'JDG', 'RWB']);

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

async function fetchAllPrices() {
  const responses = await Promise.allSettled(
    RIFTBOUND_GROUP_IDS.map((gid) =>
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
    let cmp = 0;
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

function collectionValue(cards, collection, foilCollection, prices) {
  return cards.reduce((sum, card) => {
    const p = prices[card.tcgplayer_id] ?? {};
    const normalVal = (collection[card.id] ?? 0) * (p.normal?.market ?? 0);
    const foilVal = (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
    return sum + normalVal + foilVal;
  }, 0);
}

const DEFAULT_FILTERS = { search: '', type: '', rarity: '', domain: '', status: 'all' };
const DEFAULT_SORT = { field: 'collector_number', dir: 'asc' };

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
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [modalCard, setModalCard] = useState(null);
  const [tab, setTab] = useState('collection');
  const [activeSetId, setActiveSetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAllCards()
      .then((cards) => { setAllCards(cards); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });

    fetchAllPrices()
      .then((map) => { setPrices(map); setPricesLoading(false); })
      .catch(() => setPricesLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
  }, [collection]);

  useEffect(() => {
    localStorage.setItem(FOIL_STORAGE_KEY, JSON.stringify(foilCollection));
  }, [foilCollection]);

  useEffect(() => {
    localStorage.setItem(LF_KEY, JSON.stringify(lookingFor));
  }, [lookingFor]);

  useEffect(() => {
    localStorage.setItem(UFT_KEY, JSON.stringify(upForTrade));
  }, [upForTrade]);

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

  // CSV import: overwrite counts for matched cards, leave others untouched.
  // Rare/Showcase/AltArt cards go to foilCollection automatically.
  function handleImport({ updates, foilUpdates }) {
    setCollection((prev) => ({ ...prev, ...updates }));
    setFoilCollection((prev) => ({ ...prev, ...foilUpdates }));
  }

  const allRuneCards = useMemo(
    () => allCards.filter(c => c.classification?.type === 'Rune'),
    [allCards]
  );

  const cardsBySet = useMemo(() => {
    const filtered = applyFilters(allCards, filters, collection)
      .filter(c => c.classification?.type !== 'Rune');
    const sorted = applySort(filtered, sort, collection);
    return groupBySet(sorted);
  }, [allCards, filters, sort, collection]);

  const totalValue = useMemo(
    () => collectionValue(allCards, collection, foilCollection, prices),
    [allCards, collection, foilCollection, prices]
  );

  if (loading) return <div className="status">Loading cards…</div>;
  if (error) return <div className="status error">Failed to load cards: {error}</div>;

  const setIds = Object.keys(cardsBySet);
  const totalVisible = setIds.reduce((n, id) => n + cardsBySet[id].cards.length, 0);
  const currentSetId = activeSetId === 'runes' ? 'runes'
    : setIds.includes(activeSetId) ? activeSetId
    : (setIds[0] ?? null);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-top">
          <h1>Riftbound Collection</h1>
          <div className="header-actions">
            <ExportButton allCards={allCards} collection={collection} foilCollection={foilCollection} />
            <ImportButton allCards={allCards} onImport={handleImport} />
          </div>
        </div>
        <div className="collection-value">
          {pricesLoading
            ? 'Loading prices…'
            : `Collection value: $${totalValue.toFixed(2)}`}
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab${tab === 'collection' ? ' tab--active' : ''}`} onClick={() => setTab('collection')}>Collection</button>
        <button className={`tab${tab === 'entry'      ? ' tab--active' : ''}`} onClick={() => setTab('entry')}>Set Entry</button>
        <button className={`tab${tab === 'deck'       ? ' tab--active' : ''}`} onClick={() => setTab('deck')}>Deck Check</button>
        <button className={`tab${tab === 'export'     ? ' tab--active' : ''}`} onClick={() => setTab('export')}>Export</button>
      </nav>

      {tab === 'entry' ? (
        <SetEntry
          allCards={allCards}
          collection={collection}
          foilCollection={foilCollection}
          onAdjust={adjust}
          onAdjustFoil={adjustFoil}
        />
      ) : tab === 'deck' ? (
        <DeckCheck allCards={allCards} collection={collection} />
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
          <FilterBar filters={filters} sort={sort} onChange={setFilters} onSortChange={setSort} />

          {/* ── Set tabs ── */}
          <div className="set-tabs">
            <button
              className={`set-tab${currentSetId === 'runes' ? ' set-tab--active' : ''}`}
              onClick={() => setActiveSetId('runes')}
            >Rune Box</button>
            {setIds.map(sid => (
              <button
                key={sid}
                className={`set-tab${currentSetId === sid ? ' set-tab--active' : ''}${cardsBySet[sid].promo ? ' set-tab--promo' : ''}`}
                onClick={() => setActiveSetId(sid)}
              >{cardsBySet[sid].label}</button>
            ))}
          </div>

          <div className="results-count">
            {totalVisible} card{totalVisible !== 1 ? 's' : ''}
          </div>

          <main>
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
            ) : currentSetId ? (
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
              />
            ) : (
              <div className="status">No cards match your filters.</div>
            )}
          </main>
        </>
      )}

      <CardModal
        card={modalCard}
        price={modalCard ? prices[modalCard.tcgplayer_id] ?? null : null}
        pricesLoading={pricesLoading}
        onClose={() => setModalCard(null)}
      />
    </div>
  );
}
