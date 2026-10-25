import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import SetSection from './components/SetSection';
import RuneBox from './components/RuneBox';
import PromoBox from './components/PromoBox';
import FilterBar from './components/FilterBar';
import ImportButton from './components/ImportButton';
import ExportButton from './components/ExportButton';
import CardModal from './components/CardModal';
import UpdateToast from './components/UpdateToast';
import SetPicker from './components/SetPicker';
import Decks from './pages/Decks';
import Export from './pages/Export';
import SetEntry from './pages/SetEntry';
import TradeBinder from './pages/TradeBinder';
import Shopping from './pages/Shopping';
import Stats from './pages/Stats';
import TravelingMerchant from './pages/TravelingMerchant';
import Settings from './pages/Settings';
import Friends from './pages/Friends';
import SyncIndicator from './components/SyncIndicator';
import ThemeBackdrop from './components/ThemeBackdrop';
import SlidingTabs from './components/SlidingTabs';
import { useIsMobile } from './hooks/useIsMobile';
import { SyncProvider, useSync } from './sync/SyncContext';
import { DiscordProvider, useDiscord } from './discord/DiscordContext';
import { GAMES, GAME_IDS, DEFAULT_GAME, getGame } from './games';
import { GameContext } from './games/GameContext';
import { storageKeys, ACTIVE_GAME_KEY } from './games/storage';
import { getCached, setCached, loadStoredCards, storeCards, clearAllCached } from './games/cardCache';
import MerchantBtn from './components/MerchantBtn';
import { completePrices } from './utils/analysis';
import { remapKeys, remapDecks, remapMerchant } from './utils/remapIds';
import logoUrl from './assets/logo.png';
import './App.css';
import './pages.css';

const IS_ELECTRON = typeof window !== 'undefined' && window.__electron__?.isElectron;
// tcgcsv (prices) and Netdeck (Cyberpunk cards) are hit directly in Electron,
// which injects CORS headers; the browser dev build goes through Vite proxies.
const tcgcsvBaseFor = (category) => IS_ELECTRON
  ? `https://tcgcsv.com/tcgplayer/${category}`
  : `/tcgcsv/tcgplayer/${category}`;
const NETDECK_BASE = IS_ELECTRON ? 'https://api.netdeck.gg/api/cards' : '/netdeck/api/cards';
// Riot's card gallery — Riftbound's main card source (promos come from riftcodex).
const RIOT_BASE = IS_ELECTRON ? 'https://playriftbound.com' : '/riot';

function applyFilters(cards, filters, collection) {
  const search = filters.search.toLowerCase().trim();
  return cards.filter((card) => {
    if (search && !card.name.toLowerCase().includes(search)
        && !(card.tags ?? []).some((t) => t.toLowerCase().includes(search))) return false;
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

function applySort(cards, sort, collection, rarityOrder) {
  return [...cards].sort((a, b) => {
    let cmp;
    switch (sort.field) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'rarity':
        cmp = (rarityOrder[a.classification?.rarity?.toLowerCase()] ?? 0) -
              (rarityOrder[b.classification?.rarity?.toLowerCase()] ?? 0);
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

function groupBySet(cards, game) {
  const grouped = cards.reduce((acc, card) => {
    const setId = card.set?.set_id ?? 'UNKNOWN';
    if (!acc[setId]) {
      acc[setId] = {
        label: game.setLabels[setId] ?? card.set?.label ?? setId,
        promo: game.promoSets.has(setId),
        cards: [],
      };
    }
    acc[setId].cards.push(card);
    return acc;
  }, {});
  // Present sets in the game's canonical order, unknown sets after.
  const order = game.setOrder;
  const ids = Object.keys(grouped).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
  return Object.fromEntries(ids.map(id => [id, grouped[id]]));
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
const ALL_SETS = 'all'; // set-picker id for every set in one grid

// SVG icons
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
  </svg>
);

const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 5h18M6 12h12M10 19h4" />
  </svg>
);

// Nav icons — 16px line art in the current text color.
const navIcon = (children) => (
  <svg className="tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const NAV_ICONS = {
  collection: navIcon(<><rect x="7" y="3" width="12" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h9" /></>),
  trade: navIcon(<><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>),
  decks: navIcon(<><rect x="4" y="6" width="11" height="15" rx="2" transform="rotate(-8 9.5 13.5)" /><rect x="9" y="3" width="11" height="15" rx="2" /></>),
  export: navIcon(<><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></>),
};

// Top-level tabs group related pages; each page keeps its own id in `tab`.
// Groups with several pages show a sub-tab switcher above the content.
const NAV = [
  { id: 'collection', label: 'Collection', pages: [['collection', 'Cards'], ['entry', 'Set Entry'], ['stats', 'Stats'], ['shopping', 'Shopping List']] },
  { id: 'trade', label: 'Trade', pages: [['trade', 'Binder'], ['friends', 'Friends'], ['merchant', 'Merchant']] },
  { id: 'decks', label: 'Decks', pages: [['decks', 'Decks']] },
  { id: 'export', label: 'Export', pages: [['export', 'Export']] },
];
const navGroupOf = (page) => NAV.find(g => g.pages.some(([id]) => id === page)) ?? null;
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

function ListRow({ card, count, foilCount, price, pricesLoading, onAdjust, onAdjustFoil, onConsign }) {
  const imgSrc = card.media?.image_url ?? null;
  const domain = (card.classification?.domain?.[0] ?? '').toLowerCase();
  const normalPrice = price?.normal?.market;
  const total = count + foilCount;
  let status = total >= 3 ? 'playset' : total > 0 ? 'incomplete' : 'missing';

  return (
    <div className={`list-row s-${status}`}>
      <span className="list-num">#{card.collector_label ?? card.collector_number}</span>
      <div className="list-thumb">
        {imgSrc ? <img src={imgSrc} alt={card.name} loading="lazy" /> : null}
      </div>
      <div className="list-name">
        {card.name}
        <span className="list-id">{card.code ?? card.id?.toUpperCase()}</span>
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
        <MerchantBtn count={count} foilCount={foilCount} onConsign={(foil) => onConsign?.(card.id, foil)} />
      </div>
    </div>
  );
}

// Shell: picks the active game and remounts the whole UI when it changes, so
// every piece of per-game state (collection, decks, filters, tab...) re-reads
// from the right localStorage namespace with no swapping code.
export default function App() {
  const [gameId, setGameId] = useState(() => {
    try { const id = localStorage.getItem(ACTIVE_GAME_KEY); return GAMES[id] ? id : DEFAULT_GAME; }
    catch { return DEFAULT_GAME; }
  });
  useEffect(() => { try { localStorage.setItem(ACTIVE_GAME_KEY, gameId); } catch { /* ignore */ } }, [gameId]);
  const game = getGame(gameId);
  return (
    <SyncProvider>
      <DiscordProvider>
        <ThemeBackdrop />
        <GameContext.Provider value={game}>
          <SyncedGameApp game={game} onSwitchGame={setGameId} />
        </GameContext.Provider>
      </DiscordProvider>
    </SyncProvider>
  );
}

// When sync loads another device's data into localStorage, dataVersion bumps
// and the game remounts — the same re-read-everything path as a game switch.
function SyncedGameApp({ game, onSwitchGame }) {
  const { dataVersion } = useSync();
  return <GameApp key={`${game.id}-${dataVersion}`} game={game} onSwitchGame={onSwitchGame} />;
}

// Read one saved field; `migrate` re-keys it through the game's legacy id map.
function loadSaved(key, fallback, migrate) {
  try {
    const value = JSON.parse(localStorage.getItem(key)) || fallback;
    return migrate(value);
  } catch { return fallback; }
}
const NO_REMAP = new Map();

function GameApp({ game, onSwitchGame }) {
  const K = storageKeys(game.id);
  const TCGCSV_BASE = tcgcsvBaseFor(game.prices.tcgcsvCategory);
  // Cards/prices already loaded this session (switching back to a game) seed
  // state directly so the UI is instant and no refetch runs.
  const cached = getCached(game.id);
  const [allCards, setAllCards] = useState(() => cached?.cards ?? []);
  const [progress, setProgress] = useState(null); // { done, total } while cards load
  const [prices, setPrices] = useState(() => cached?.prices ?? {}); // already completed when cached
  const [pricesLoading, setPricesLoading] = useState(() => !cached?.prices);
  // Saved data written under a game's old card ids (Riftbound: riftcodex ids
  // from before the switch to Riot's gallery) is re-keyed as it's read; the
  // save effects below then persist the new keys.
  const idMap = game.idRemap ?? NO_REMAP;
  const byKeys = (v) => remapKeys(v, idMap);
  const [collection, setCollection] = useState(() => loadSaved(K.collection, {}, byKeys));
  const [foilCollection, setFoilCollection] = useState(() => loadSaved(K.foil, {}, byKeys));
  const [lookingFor, setLookingFor] = useState(() => loadSaved(K.lf, {}, byKeys));
  const [upForTrade, setUpForTrade] = useState(() => loadSaved(K.uft, {}, byKeys));
  const [decks, setDecks] = useState(() => loadSaved(K.decks, [], (v) => remapDecks(v, idMap)));
  const [merchant, setMerchant] = useState(() => loadSaved(K.merchant, [], (v) => remapMerchant(v, idMap)));
  const [vendorName, setVendorName] = useState(() => {
    try { return localStorage.getItem(K.vendor) || ''; }
    catch { return ''; }
  });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [modalCard, setModalCard] = useState(null);
  const [tab, setTabState] = useState('collection');
  // Last page visited in each group, so clicking a group tab returns there.
  const [lastPage, setLastPage] = useState({});
  const setTab = useCallback((page) => {
    setTabState(page);
    const g = navGroupOf(page);
    if (g) setLastPage(lp => (lp[g.id] === page ? lp : { ...lp, [g.id]: page }));
  }, []);
  const activeGroup = navGroupOf(tab);
  // Signal to the deck builder to create + open a new deck seeded with a Legend.
  const [newDeckLegend, setNewDeckLegend] = useState(null);
  const startDeckWithLegend = useCallback((card) => {
    setNewDeckLegend(card);
    setModalCard(null);
    setTab('decks');
  }, [setTab]);
  const consumeNewDeckLegend = useCallback(() => setNewDeckLegend(null), []);
  const [activeSetId, setActiveSetId] = useState(null);
  const [view, setView] = useState('grid');
  // Phones: filters live in a bottom sheet, stats in a strip above the cards.
  const isMobile = useIsMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(() => !cached?.cards);
  const [error, setError] = useState(null);
  // Discord bot link: gets the Riftbound card list and edit notifications.
  const { noteLocalEdit, setRiftboundCards } = useDiscord();

  useEffect(() => {
    const have = getCached(game.id);
    if (!have?.cards) {
      // Show the last card list saved on disk right away (if any) while the
      // fresh one loads; the network copy replaces it when it arrives.
      let fresh = false;
      let shownStored = false;
      loadStoredCards(game.id).then((stored) => {
        // A card list cached under old ids wouldn't match the re-keyed data.
        if (!stored || fresh || stored.some((c) => idMap.has(c.id))) return;
        shownStored = true;
        setAllCards(stored);
        setLoading(false);
      });
      game.api.loadCards({ isElectron: IS_ELECTRON, tcgcsvBase: TCGCSV_BASE, netdeckBase: NETDECK_BASE, riotBase: RIOT_BASE },
        (done, total) => setProgress({ done, total }))
        .then((cards) => {
          fresh = true;
          setCached(game.id, { cards });
          storeCards(game.id, cards);
          if (game.id === 'riftbound') setRiftboundCards(cards);
          setAllCards(cards);
          setLoading(false);
        })
        .catch((err) => {
          if (shownStored) return; // keep the saved cards rather than erroring
          setError(err.message);
          setLoading(false);
        });
    }
    if (!have?.prices) {
      game.prices.load(TCGCSV_BASE)
        .then((raw) => { const map = completePrices(raw); setCached(game.id, { prices: map }); setPrices(map); setPricesLoading(false); })
        .catch(() => setPricesLoading(false));
    }
  }, [game, TCGCSV_BASE, idMap, setRiftboundCards]);

  // Settings → Card library: fetch a fresh card list + prices. The current
  // cards stay on screen until the new ones arrive, so a failed reload leaves
  // the app usable. `clearCache` first drops every game's saved card list.
  const reloadCards = useCallback(async ({ clearCache = false, onProgress } = {}) => {
    if (clearCache) await clearAllCached();
    const cards = await game.api.loadCards(
      { isElectron: IS_ELECTRON, tcgcsvBase: TCGCSV_BASE, netdeckBase: NETDECK_BASE, riotBase: RIOT_BASE },
      onProgress);
    setCached(game.id, { cards });
    storeCards(game.id, cards);
    if (game.id === 'riftbound') setRiftboundCards(cards);
    setAllCards(cards);
    setPricesLoading(true);
    game.prices.load(TCGCSV_BASE)
      .then((raw) => { const map = completePrices(raw); setCached(game.id, { prices: map }); setPrices(map); })
      .catch(() => { /* keep the old prices */ })
      .finally(() => setPricesLoading(false));
    return cards.length;
  }, [game, TCGCSV_BASE, setRiftboundCards]);

  // Netdeck serves signed image URLs that expire after a few hours. When the
  // window comes back into focus after a long idle, silently refetch the card
  // list so images keep loading; ids are stable so no other state changes.
  useEffect(() => {
    if (!game.api.imagesExpire) return;
    const MAX_AGE = 6 * 60 * 60 * 1000;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const c = getCached(game.id);
      if (!c?.loadedAt || Date.now() - c.loadedAt < MAX_AGE) return;
      setCached(game.id, {}); // bump loadedAt so a slow reload isn't retriggered
      game.api.loadCards({ isElectron: IS_ELECTRON, tcgcsvBase: TCGCSV_BASE, netdeckBase: NETDECK_BASE, riotBase: RIOT_BASE })
        .then((cards) => { setCached(game.id, { cards }); setAllCards(cards); })
        .catch(() => { /* keep the current cards; the <img> fallback covers expired art */ });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [game, TCGCSV_BASE]);

  // K is fixed for the lifetime of a GameApp mount (the shell remounts on switch).
  useEffect(() => { localStorage.setItem(K.collection, JSON.stringify(collection)); }, [K.collection, collection]);
  useEffect(() => { localStorage.setItem(K.foil, JSON.stringify(foilCollection)); }, [K.foil, foilCollection]);
  useEffect(() => { localStorage.setItem(K.lf, JSON.stringify(lookingFor)); }, [K.lf, lookingFor]);
  useEffect(() => { localStorage.setItem(K.uft, JSON.stringify(upForTrade)); }, [K.uft, upForTrade]);
  useEffect(() => { localStorage.setItem(K.decks, JSON.stringify(decks)); }, [K.decks, decks]);
  useEffect(() => { localStorage.setItem(K.merchant, JSON.stringify(merchant)); }, [K.merchant, merchant]);
  useEffect(() => { localStorage.setItem(K.vendor, vendorName); }, [K.vendor, vendorName]);

  // Mirror edits to the sync file (no-op when sync is off). Skips the mount,
  // which is just the saved data being read back.
  const { scheduleSave, setCsvWriter, friends } = useSync();
  // Friends (sync-folder neighbours) who own the card open in the modal.
  const modalFriendOwners = useMemo(() => {
    if (!modalCard) return [];
    return friends.flatMap((f) => {
      const g = f.games?.[game.id];
      // Friends on older versions may still use legacy card ids.
      const normal = remapKeys(g?.collection ?? {}, idMap)[modalCard.id] ?? 0;
      const foil = remapKeys(g?.foil ?? {}, idMap)[modalCard.id] ?? 0;
      return normal + foil > 0 ? [{ id: f.id, name: f.name, normal, foil }] : [];
    });
  }, [modalCard, friends, game.id, idMap]);

  const syncMounted = useRef(false);
  useEffect(() => {
    if (!syncMounted.current) { syncMounted.current = true; return; }
    scheduleSave();
  }, [scheduleSave, collection, foilCollection, lookingFor, upForTrade, decks, merchant, vendorName]);

  // Discord bot link: Riftbound counts / trade-list edits trigger a (debounced)
  // push. Same mount skip as above. Decks and the Merchant aren't sent.
  const discordMounted = useRef(false);
  useEffect(() => {
    if (!discordMounted.current) { discordMounted.current = true; return; }
    if (game.id === 'riftbound') noteLocalEdit();
  }, [noteLocalEdit, game.id, collection, foilCollection, lookingFor, upForTrade]);
  useEffect(() => {
    setCsvWriter(allCards.length
      ? () => window.__electron__?.sync?.writeCsv(game.id, game.csv.generate(allCards, collection, foilCollection))
      : null);
  }, [setCsvWriter, game, allCards, collection, foilCollection]);

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

  // Hand one copy (normal or foil) to the Traveling Merchant: it leaves the
  // collection count and joins (or bumps) the matching consignment entry.
  const consign = useCallback((cardId, foil) => {
    (foil ? adjustFoil : adjust)(cardId, -1);
    setMerchant(prev => {
      const i = prev.findIndex(e => e.cardId === cardId && e.foil === foil);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      const id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      return [...prev, { id, cardId, foil, qty: 1, askPrice: null, ts: Date.now(), sold: [] }];
    });
  }, []);

  function handleImport({ updates, foilUpdates }) {
    setCollection((prev) => ({ ...prev, ...updates }));
    setFoilCollection((prev) => ({ ...prev, ...foilUpdates }));
  }

  const allRuneCards = useMemo(
    () => allCards.filter(c => c.classification?.type === 'Rune'),
    [allCards]
  );

  const allPromoCards = useMemo(
    () => allCards.filter(c => game.promoFoldSets.has(c.set?.set_id) && c.classification?.type !== 'Rune'),
    [allCards, game]
  );

  const promoByName = useMemo(() => {
    const map = {};
    for (const card of allCards) {
      if (game.promoFoldSets.has(card.set?.set_id) && card.classification?.type !== 'Rune') {
        const key = card.name.toLowerCase().trim();
        (map[key] = map[key] || []).push(card);
      }
    }
    return map;
  }, [allCards, game]);

  const cardsBySet = useMemo(() => {
    const filtered = applyFilters(allCards, filters, collection)
      .filter(c => c.classification?.type !== 'Rune')
      .filter(c => !game.promoFoldSets.has(c.set?.set_id));
    const sorted = applySort(filtered, sort, collection, game.rarityOrder);
    return groupBySet(sorted, game);
  }, [allCards, filters, sort, collection, game]);

  // Stats for all non-promo, non-rune cards
  const globalStats = useMemo(() => {
    const nonFolded = allCards.filter(c =>
      c.classification?.type !== 'Rune' && !game.promoFoldSets.has(c.set?.set_id)
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
  }, [allCards, collection, foilCollection, prices, pricesLoading, game]);

  // Per-set stats for tabs
  const setTabStats = useMemo(() => {
    const m = {};
    const allNonFolded = allCards.filter(c =>
      c.classification?.type !== 'Rune' && !game.promoFoldSets.has(c.set?.set_id)
    );
    const allRunes = allCards.filter(c => c.classification?.type === 'Rune');
    // Group all non-rune cards by set
    const grouped = groupBySet(allNonFolded, game);
    for (const [sid, { cards }] of Object.entries(grouped)) {
      const owned = cards.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
      m[sid] = { total: cards.length, owned, pct: cards.length ? Math.round(owned / cards.length * 100) : 0 };
    }
    // Runes
    const runesOwned = allRunes.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
    m['runes'] = { total: allRunes.length, owned: runesOwned, pct: allRunes.length ? Math.round(runesOwned / allRunes.length * 100) : 0 };
    // Promos
    const allPromos = allCards.filter(c => game.promoFoldSets.has(c.set?.set_id) && c.classification?.type !== 'Rune');
    const promosOwned = allPromos.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
    m['promos'] = { total: allPromos.length, owned: promosOwned, pct: allPromos.length ? Math.round(promosOwned / allPromos.length * 100) : 0 };
    // Every set at once
    const allOwned = allNonFolded.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
    m[ALL_SETS] = { total: allNonFolded.length, owned: allOwned, pct: allNonFolded.length ? Math.round(allOwned / allNonFolded.length * 100) : 0 };
    return m;
  }, [allCards, collection, foilCollection, game]);

  if (loading) return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-2)', fontFamily: 'var(--font-mono)'}}>
      Loading {game.label} cards…{progress && progress.total ? ` (${progress.done}/${progress.total})` : ''}
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
    : activeSetId === ALL_SETS && setIds.length ? ALL_SETS
    : setIds.includes(activeSetId) ? activeSetId
    : (setIds[0] ?? null);
  const isAllSets = currentSetId === ALL_SETS;
  // Cards shown for the picked set. All sets: in set order when sorted by
  // number (else every set's #001 would sit together), otherwise one sort
  // across all of them.
  const currentCards = isAllSets
    ? (sort.field === DEFAULT_SORT.field
        ? setIds.flatMap(id => cardsBySet[id].cards)
        : applySort(setIds.flatMap(id => cardsBySet[id].cards), sort, collection, game.rarityOrder))
    : cardsBySet[currentSetId]?.cards;

  // Entries for the set-picker dropdown: All sets, real sets, then Rune Box / Promos.
  const statOf = (id) => setTabStats[id] ?? { owned: 0, total: 0, pct: 0 };
  const setPickerEntries = [
    { id: ALL_SETS, label: 'All sets', kind: 'all', ...statOf(ALL_SETS) },
    ...setIds.map(sid => ({
      id: sid,
      label: cardsBySet[sid].label,
      kind: cardsBySet[sid].promo ? 'promoSet' : 'set',
      ...statOf(sid),
    })),
    ...(game.features.runeBox ? [{ id: 'runes', label: 'Rune Box', kind: 'runes', ...statOf('runes') }] : []),
    ...(game.features.promoBox ? [{ id: 'promos', label: 'Promos', kind: 'promos', ...statOf('promos') }] : []),
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
      (isAllSets || c.set?.set_id === currentSetId) &&
      c.classification?.type !== 'Rune' &&
      !game.promoFoldSets.has(c.set?.set_id)
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
      name: isAllSets ? 'All sets' : cardsBySet[currentSetId]?.label ?? currentSetId,
      logo: isAllSets ? null : game.features.setLogos[currentSetId] ?? null,
      art: pickSetArt(allSetCards),
      playsets, partial, missing,
      total: allSetCards.length,
      value: setValue,
      pct: allSetCards.length ? (playsets / allSetCards.length) * 100 : 0,
      partialPct: allSetCards.length ? (partial / allSetCards.length) * 100 : 0,
    };
  }

  const statsRow = (
      <div className="stats-row">
        {globalStats.value != null && (
          <div className="stat">
            <span className="stat-label">Value</span>
            <span className="stat-value">${globalStats.value.toFixed(2)}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Owned</span>
          <span className="stat-value">{globalStats.owned}<span className="stat-of">/{globalStats.total}</span></span>
        </div>
        <div className="stat stat--complete">
          <span className="stat-label">Complete</span>
          <span className="stat-value">{globalStats.pct}%</span>
          <span className="stat-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, globalStats.pct)}%` }} /></span>
        </div>
      </div>
  );

  const filterBar = (
    <FilterBar
      filters={filters}
      sort={sort}
      onChange={setFilters}
      onSortChange={setSort}
      allCards={allCards.filter(c => c.classification?.type !== 'Rune' && !game.promoFoldSets.has(c.set?.set_id))}
    />
  );

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src={logoUrl} alt="" />
          <div className="brand-name">
            Card Manager <span className="muted">/ {game.label}</span>
          </div>
          <div className="seg game-switch" title="Switch game">
            {GAME_IDS.map(id => (
              <button
                key={id}
                className={id === game.id ? 'active' : ''}
                onClick={() => id !== game.id && onSwitchGame(id)}
              >
                {GAMES[id].label}
              </button>
            ))}
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
          <SyncIndicator onClick={() => setTab('settings')} />
          <button
            className={`btn ghost btn-sq${tab === 'settings' ? ' active' : ''}`}
            onClick={() => setTab('settings')}
            title="Settings"
            aria-label="Settings"
          >
            <GearIcon />
          </button>
          <div className="header-csv">
            <ExportButton allCards={allCards} collection={collection} foilCollection={foilCollection} />
            <ImportButton allCards={allCards} onImport={handleImport} />
          </div>
        </div>
      </header>

      {/* ── Subnav ── */}
      <div className="subnav">
        <SlidingTabs
          className="nav-dock"
          ariaLabel="Sections"
          active={activeGroup?.id}
          onSelect={(id) => { const g = NAV.find(n => n.id === id); setTab(lastPage[id] ?? g.pages[0][0]); }}
          items={NAV.map(g => ({
            id: g.id,
            label: g.label,
            icon: NAV_ICONS[g.id],
            badge: g.id === 'collection' && tab === 'collection' ? totalVisible : null,
          }))}
        />
        {!isMobile && statsRow}
      </div>

      {/* ── Main ── */}
      <div className={`main${tab !== 'collection' || isMobile ? ' no-sidebar' : ''}`}>
        {/* Sidebar — only in collection tab (a bottom sheet on phones) */}
        {tab === 'collection' && !isMobile && filterBar}

        {/* Content */}
        <div className="content">
          {activeGroup && activeGroup.pages.length > 1 && (
            <div className="page-subnav">
              <SlidingTabs
                className="sub-tabs"
                ariaLabel={`${activeGroup.label} pages`}
                active={tab}
                onSelect={setTab}
                items={activeGroup.pages.map(([id, label]) => ({
                  id,
                  label,
                  badge: id === 'friends' && friends.length > 0 ? friends.length : null,
                }))}
              />
            </div>
          )}
          <div key={tab} className="page-enter">
            {tab === 'entry' ? (
              <SetEntry
                allCards={allCards}
                collection={collection}
                foilCollection={foilCollection}
                onAdjust={adjust}
                onAdjustFoil={adjustFoil}
                promoByName={promoByName}
                promoShortLabels={game.promoShortLabels}
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
            ) : tab === 'merchant' ? (
              <TravelingMerchant
                allCards={allCards}
                collection={collection}
                foilCollection={foilCollection}
                prices={prices}
                pricesLoading={pricesLoading}
                merchant={merchant}
                setMerchant={setMerchant}
                vendorName={vendorName}
                setVendorName={setVendorName}
                onAdjust={adjust}
                onAdjustFoil={adjustFoil}
                onConsign={consign}
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
            ) : tab === 'friends' ? (
              <Friends
                allCards={allCards}
                collection={collection}
                foilCollection={foilCollection}
                lookingFor={lookingFor}
                upForTrade={upForTrade}
                prices={prices}
                pricesLoading={pricesLoading}
                onOpenModal={setModalCard}
                onOpenSettings={() => setTab('settings')}
              />
            ) : tab === 'settings' ? (
              <Settings
                allCards={allCards}
                collection={collection}
                foilCollection={foilCollection}
                onImport={handleImport}
                onReloadCards={reloadCards}
              />
            ) : tab === 'export' ? (
              <Export
                onImport={handleImport}
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
                {isMobile && <div className="mobile-stats">{statsRow}</div>}

                {/* Radiance notice — riftcodex hasn't ingested the set yet, so it
                    can't appear as a real tab; this self-removes once it has. */}
                {game.id === 'riftbound' && !setIds.includes('RAD') && game.features.setLogos.RAD && (
                  <div className="upcoming-set-banner">
                    <img src={game.features.setLogos.RAD} alt="Radiance" className="upcoming-set-logo" />
                    <span className="upcoming-set-text">
                      <strong>Radiance</strong> launches <strong>October 23, 2026</strong> — its cards will appear here automatically once the set releases.
                    </span>
                  </div>
                )}

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
                      {setProgressStats.logo ? (
                        <img className="set-logo" src={setProgressStats.logo} alt={setProgressStats.name} />
                      ) : setProgressStats.art ? (
                        <button
                          className="set-cover"
                          onClick={() => setModalCard(setProgressStats.art)}
                          title={`${setProgressStats.name} — ${setProgressStats.art.name}`}
                        >
                          <img src={setProgressStats.art.media.image_url} alt="" loading="lazy" />
                        </button>
                      ) : null}
                      <div className="set-progress-headings">
                        {!setProgressStats.logo && <h2 className="set-progress-title">{setProgressStats.name}</h2>}
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
                  {isMobile && (
                    <button className="btn mobile-filter-btn" onClick={() => setFiltersOpen(true)}>
                      <FilterIcon /> Filters{activeChips.length > 0 && <span className="mobile-filter-count">{activeChips.length}</span>}
                    </button>
                  )}
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
                    onConsign={consign}
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
                    onConsign={consign}
                  />
                ) : currentSetId ? (
                  view === 'list' ? (
                    <div className="card-list">
                      <div className="list-row list-head">
                        <span>#</span>
                        <span></span>
                        <span>Name</span>
                        <span>Type · {game.faction.label}</span>
                        <span>Price</span>
                        <span>Qty</span>
                      </div>
                      {currentCards.map(card => (
                        <ListRow
                          key={card.id}
                          card={card}
                          count={collection[card.id] ?? 0}
                          foilCount={foilCollection[card.id] ?? 0}
                          price={prices[card.tcgplayer_id] ?? null}
                          pricesLoading={pricesLoading}
                          onAdjust={adjust}
                          onAdjustFoil={adjustFoil}
                          onConsign={consign}
                        />
                      ))}
                    </div>
                  ) : (
                    <SetSection
                      key={currentSetId}
                      setName={isAllSets ? 'All sets' : cardsBySet[currentSetId].label}
                      promo={!isAllSets && cardsBySet[currentSetId].promo}
                      cards={currentCards}
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
                      onConsign={consign}
                      promoByName={promoByName}
                      promoShortLabels={game.promoShortLabels}
                    />
                  )
                ) : (
                  <div className="status-placeholder">No cards match your filters.</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Phones: filters in a bottom sheet */}
      {isMobile && filtersOpen && tab === 'collection' && (
        <div className="sheet-backdrop" onClick={() => setFiltersOpen(false)}>
          <div className="filter-sheet" role="dialog" aria-label="Filters" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="sheet-grip" aria-hidden="true" />
              <b>Filters</b>
              <button className="btn primary" onClick={() => setFiltersOpen(false)}>Done</button>
            </div>
            {filterBar}
          </div>
        </div>
      )}

      <CardModal
        card={modalCard}
        price={modalCard ? prices[modalCard.tcgplayer_id] ?? null : null}
        pricesLoading={pricesLoading}
        onClose={() => setModalCard(null)}
        onStartDeck={startDeckWithLegend}
        friendOwners={modalFriendOwners}
      />

      <UpdateToast />
    </div>
  );
}
