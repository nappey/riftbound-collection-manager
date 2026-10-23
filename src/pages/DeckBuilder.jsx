import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { isAlwaysFoil } from '../utils/playset';
import { ownedTotal, unitPrice, fmt$ } from '../utils/analysis';
import { exportDeckImage, exportSidingImage } from '../utils/deckImage';
import { buildNameMap, deckFromImport } from '../utils/parseDeckList';
import { indexPrintings, printingLabel } from '../utils/printings';
import { useGame } from '../games/GameContext';
import { useIsMobile } from '../hooks/useIsMobile';

// Deck shape (v2):
// { id, name, updatedAt, legendId, legendIds, championId,
//   main: {cardId:qty}, sideboard: {cardId:qty}, bench: {cardId:qty},
//   runes: {domain:count}, tags: {cardId:label}, arts: {cardId:printingId} }
//
// The deck's "identity" is game-specific (see game.deck.identity): Riftbound
// keeps a single `legendId` (+ chosen `championId`), Cyberpunk keeps three
// `legendIds`. Everything else — zones, sizes, validation, decklist text —
// reads from `game.deck` so this builder serves every game.
//
// `arts` is purely cosmetic — it picks which printing's image renders for a card.
// Deck contents, pricing and ownership always track the card id in the zone maps.

const TAGS = ['core', 'amazing', 'flex', 'bad'];
const TAG_COLOR = { core: 'var(--accent)', amazing: 'var(--ok)', flex: 'var(--warn)', bad: 'var(--miss)' };

// Art popover footprint, in sync with .db-art-pop in pages.css — the popover is
// positioned fixed, so its placement has to be computed rather than inherited.
const POP_W = 232;
const POP_MAX_H = 320;

const uid = () => `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const sumQty = (m) => Object.values(m || {}).reduce((n, q) => n + q, 0);

const ZONE_LABEL = { main: 'main deck', sideboard: 'sideboard', bench: 'bench' };
const LOG_MAX = 400;

// Change-log activity categories — drive the filter chips and the badge column.
const LOG_CATS = {
  add:      { label: 'Add',      color: 'oklch(0.76 0.18 150)' }, // green
  remove:   { label: 'Remove',   color: 'oklch(0.66 0.21 25)'  }, // red
  move:     { label: 'Move',     color: 'oklch(0.70 0.16 250)' }, // blue
  legend:   { label: 'Legend',   color: 'oklch(0.68 0.20 300)' }, // violet
  champion: { label: 'Champion', color: 'oklch(0.81 0.16 85)'  }, // amber
  rune:     { label: 'Rune',     color: 'oklch(0.74 0.14 195)' }, // cyan
  tag:      { label: 'Tag',      color: 'oklch(0.72 0.18 340)' }, // magenta
  art:      { label: 'Art',      color: 'oklch(0.77 0.15 120)' }, // lime
  import:   { label: 'Import',   color: 'oklch(0.72 0.17 45)'  }, // orange
  other:    { label: 'Other',    color: 'oklch(0.66 0.04 282)' }, // neutral
};
const LOG_CAT_ORDER = Object.keys(LOG_CATS);

// Append a change-log entry to a deck (returns a new deck).
function withLog(d, text, cat = 'other') {
  return { ...d, log: [...(d.log ?? []), { ts: Date.now(), text, cat }].slice(-LOG_MAX) };
}

function fmtLogTime(ts) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Aggregate deck stats over the main deck + battlefields: cost curve,
// card-type composition, domain/color distribution, and tag counts.
function computeDeckStats(analysis, deck, R) {
  const MAXE = R.curveMax; // bucket MAXE+ together
  const curve = new Array(MAXE + 1).fill(0);
  const types = Object.fromEntries(R.statTypes.map(([, k]) => [k, 0]));
  const domains = {};
  let energySum = 0, energyCards = 0;
  for (const { card, qty } of [...analysis.mainRows, ...analysis.battlefieldRows]) {
    const t = R.typeOf(card); if (t in types) types[t] += qty;
    const e = card.attributes?.energy;
    if (e != null) { curve[Math.min(e, MAXE)] += qty; energySum += e * qty; energyCards += qty; }
    for (const dm of card.classification?.domain ?? []) domains[dm] = (domains[dm] ?? 0) + qty;
  }
  const tags = { core: 0, amazing: 0, flex: 0, bad: 0 };
  for (const label of Object.values(deck.tags ?? {})) if (label in tags) tags[label] += 1;
  return {
    curve, maxCurve: Math.max(1, ...curve), types, domains, tags,
    avgEnergy: energyCards ? energySum / energyCards : 0,
  };
}

// P(at least one hit) drawing `draws` cards without replacement from a
// population of `pop` cards containing `successes` successes.
function hyperAtLeastOne(pop, successes, draws) {
  if (successes <= 0 || pop <= 0) return 0;
  const n = Math.min(draws, pop);
  if (pop - successes < n) return 1; // fewer misses than draws — a hit is guaranteed
  let missChance = 1;
  for (let i = 0; i < n; i++) missChance *= (pop - successes - i) / (pop - i);
  return 1 - missChance;
}

// "Baited Hook" (Origins Gear): kill a friendly unit, look at the top 5 of the
// Main Deck, and may banish + play a unit from among them with Might up to 1
// more than the one killed. One row per unique unit in the deck — the odds of
// finding a legal target on the dig if that unit is the one sacrificed. The
// unit's own copy counts as already removed from the library (it's the one
// dying), and the deck is otherwise assumed fresh/unseen.
function computeBaitedHookOdds(analysis) {
  const units = analysis.mainRows.filter(({ card }) => card.classification?.type === 'Unit');
  if (!units.length) return null;
  const pop = Math.max(0, analysis.mainCount - 1); // library remaining after the kill
  return units
    .map(({ card, qty }) => {
      const might = card.attributes?.might ?? 0;
      const ceiling = might + 1;
      const qualifying = units.reduce((n, u) => ((u.card.attributes?.might ?? 0) <= ceiling ? n + u.qty : n), 0);
      const successes = Math.max(0, qualifying - 1); // minus the copy that's being killed
      return { card, qty, might, pct: hyperAtLeastOne(pop, successes, 5) };
    })
    .sort((a, b) => b.pct - a.pct || a.might - b.might || a.card.name.localeCompare(b.card.name));
}

// CSS color key for a faction pill: "Fury" → fury, "Red · 2 RAM" → red.
const factionKey = (label) => String(label).split(/[\s·]/)[0].toLowerCase();

const newDeckObj = () => ({
  id: uid(), name: 'Untitled Deck', updatedAt: Date.now(),
  legendId: null, legendIds: [], bonusLegendIds: [], championId: null,
  main: {}, sideboard: {}, bench: {}, runes: {}, tags: {}, arts: {},
  notes: '', noteLog: [], log: [], matches: [], siding: [],
});

// Ensure a deck has all v2 fields, migrating an old { cards } deck if needed.
function normalizeDeck(deck, cardById) {
  const d = {
    legendId: null, legendIds: [], bonusLegendIds: [], championId: null, main: {}, sideboard: {}, bench: {}, runes: {}, tags: {}, arts: {},
    notes: '', noteLog: [], log: [], matches: [], siding: [],
    ...deck,
  };
  if (deck && !deck.main && deck.cards) {
    const main = {};
    let legendId = d.legendId;
    for (const [id, qty] of Object.entries(deck.cards)) {
      const c = cardById.get(id);
      const t = c?.classification?.type;
      if (t === 'Legend') { if (!legendId) legendId = id; continue; }
      if (t === 'Rune') continue; // runes are now tracked abstractly by domain
      main[id] = qty;
    }
    d.main = main;
    d.legendId = legendId;
  }
  return d;
}

export default function DeckBuilder({
  allCards, collection, foilCollection, prices, pricesLoading,
  decks, setDecks, onOpenModal, newDeckLegend, onNewDeckConsumed,
}) {
  const game = useGame();
  const R = game.deck;
  const multi = R.identity.kind === 'multi';
  const deckCap = R.copyCap;
  // Identity accessors — hide single-legend vs multi-legend storage.
  const identityIds = (d) => (multi ? (d?.legendIds ?? []) : (d?.legendId ? [d.legendId] : []));
  const withIdentity = (d, ids) => (multi ? { ...d, legendIds: ids } : { ...d, legendId: ids[0] ?? null });

  const [activeId, setActiveId] = useState(null); // null → deck gallery; id → builder
  const [libFilter, setLibFilter] = useState('');   // library search text
  const [libType, setLibType] = useState('');        // library type quick-filter ('' = all)
  const [libShowAll, setLibShowAll] = useState(false);     // ignore the identity filter (flag tiles instead)
  const [libBrowseIdentity, setLibBrowseIdentity] = useState(false); // revisit step 1 after it's complete
  // Chosen-champion step (games with a chosen champion): shown right after
  // the legend is set, until a champion is picked or the step is skipped.
  const [libPickChampion, setLibPickChampion] = useState(false); // reopened from step 3
  const [champSkipped, setChampSkipped] = useState(false);
  const [libPickBonus, setLibPickBonus] = useState(false); // picking bonus legends (Neeko)
  const [libSection, setLibSection] = useState('main');     // after the champion: 'main' | 'battlefields'
  const [view, setView] = useState('build');         // center view: 'build' | 'details'
  // Phones: one pane at a time (library or deck), tap-to-select deck tiles
  // with an action bar in place of the hover overlay, and a toast on add.
  const isMobile = useIsMobile();
  const [mobilePane, setMobilePane] = useState('cards'); // 'cards' | 'deck'
  const [picked, setPicked] = useState(null);            // { cardId, zone, key }
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function flashToast(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }
  const [collapsed, setCollapsed] = useState({});     // collapsed deck-panel sections
  const toggleCollapse = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));
  const [copied, setCopied] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgBench, setImgBench] = useState(false); // include the bench in the deck image
  // In-progress match entry (opponent legend, game result, dice-roll result).
  const [mOpp, setMOpp] = useState('');
  const [mResult, setMResult] = useState('W');
  const [mDice, setMDice] = useState('W');
  const [sidingOpp, setSidingOpp] = useState('');
  const [sidingCopied, setSidingCopied] = useState(false);
  const [sidingImgBusy, setSidingImgBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  // Open art popover: { token, left, top, bottom } — the anchor's viewport rect,
  // since the popover is positioned fixed to escape the deck panel's clipping.
  const [artPicker, setArtPicker] = useState(null);
  const [logCats, setLogCats] = useState([]); // active change-log filters ([] = all)
  const toggleLogCat = (c) => setLogCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  // Create-and-open a new deck seeded with a Legend, triggered from a Legend
  // card's "Start a new deck" button. Flag-guarded so StrictMode's double effect
  // invocation (dev) can't create two decks; the flag resets when the signal clears.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!newDeckLegend) { startedRef.current = false; return; }
    if (startedRef.current) return;
    startedRef.current = true;
    const legend = newDeckLegend;
    const deck = {
      ...withIdentity(newDeckObj(), [legend.id]),
      name: legend.name,
      runes: R.seedRunes ? R.seedRunes([legend]) : {},
      log: [{ ts: Date.now(), cat: 'legend', text: `Set legend: ${legend.name}` }],
    };
    setDecks(prev => [deck, ...prev]);
    setActiveId(deck.id);
    onNewDeckConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDeckLegend, setDecks, onNewDeckConsumed]);

  const cardById = useMemo(() => {
    const m = new Map();
    for (const c of allCards) m.set(c.id, c);
    return m;
  }, [allCards]);

  const nameMap = useMemo(() => buildNameMap(allCards), [allCards]);

  // Every printing of every card, grouped by gameplay identity — collapses the
  // library to one tile per card and backs the per-card art picker.
  const printings = useMemo(() => indexPrintings(allCards), [allCards]);

  // Any click outside an open art popover dismisses it; the picker's own
  // controls stop propagation so they don't close it out from under themselves.
  // Scrolling closes it too — it's pinned to viewport coordinates, so it would
  // otherwise drift away from the card it belongs to.
  useEffect(() => {
    if (!artPicker) return;
    const close = () => setArtPicker(null);
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [artPicker]);

  // Live preview of a pasted decklist — same parser the Deck Check uses.
  const importPreview = useMemo(
    () => (importText.trim() ? deckFromImport(importText, nameMap, game) : null),
    [importText, nameMap, game],
  );

  // Legends for the opponent dropdown — one per name (a legend can be reprinted
  // across sets), preferring the base (non-promo) printing's art.
  const legendCards = useMemo(() => {
    const candidates = allCards.filter(c => c.classification?.type === 'Legend'
      && !c.metadata?.alternate_art
      && !/\((Signature|Overnumbered|Metal)\)/i.test(c.name));
    // Base printings first so they win the de-dupe.
    candidates.sort((a, b) =>
      (game.promoFoldSets.has(a.set?.set_id) ? 1 : 0) - (game.promoFoldSets.has(b.set?.set_id) ? 1 : 0));
    const byName = new Map();
    for (const c of candidates) {
      const key = c.name.toLowerCase().trim();
      if (!byName.has(key)) byName.set(key, c);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allCards, game]);

  const rawActive = decks.find(d => d.id === activeId) ?? null;
  const active = rawActive ? normalizeDeck(rawActive, cardById) : null;

  // ── deck mutations ────────────────────────────────────────────
  const mutate = useCallback((id, fn) => {
    setDecks(prev => prev.map(d => {
      if (d.id !== id) return d;
      const norm = normalizeDeck(d, cardById);
      return { ...fn(norm), updatedAt: Date.now() };
    }));
  }, [setDecks, cardById]);

  function createDeck() {
    const deck = newDeckObj();
    setDecks(prev => [deck, ...prev]);
    setActiveId(deck.id);
  }
  function importDeck() {
    const res = deckFromImport(importText, nameMap, game);
    if (res.matchedCount === 0) return; // nothing recognized
    const deck = {
      ...withIdentity(newDeckObj(), res.legendIds),
      name: res.name || 'Imported Deck',
      bonusLegendIds: res.bonusLegendIds ?? [],
      championId: res.championId,
      main: res.main,
      sideboard: res.sideboard,
      runes: res.runes,
      log: [{ ts: Date.now(), cat: 'import', text: `Imported ${res.matchedCount} card${res.matchedCount !== 1 ? 's' : ''}${res.unknown.length ? ` · ${res.unknown.length} line${res.unknown.length !== 1 ? 's' : ''} unmatched` : ''}` }],
    };
    // No runes in the list but we know the legend? Seed from its domains.
    if (R.seedRunes && sumQty(deck.runes) === 0 && identityIds(deck).length) {
      deck.runes = R.seedRunes(identityIds(deck).map(id => cardById.get(id)).filter(Boolean));
    }
    setDecks(prev => [deck, ...prev]);
    setActiveId(deck.id);
    setImportOpen(false);
    setImportText('');
  }

  function duplicateDeck(d) {
    const copy = { ...normalizeDeck(d, cardById), id: uid(), name: `${d.name} (copy)`, updatedAt: Date.now() };
    setDecks(prev => [copy, ...prev]);
    setActiveId(copy.id);
  }
  function deleteDeck(id) {
    setDecks(prev => prev.filter(d => d.id !== id));
    if (activeId === id) { setActiveId(null); resetLibFilters(); } // back to gallery
  }

  function adjustZone(zone, cardId, delta) {
    const card = cardById.get(cardId);
    const cap = card ? deckCap(card) : 3;
    const name = card?.name ?? cardId;
    mutate(active.id, d => {
      const z = { ...d[zone] };
      // Enforce sideboard size limit on increments.
      if (zone === 'sideboard' && delta > 0 && sumQty(z) >= R.sideboardMax) return d;
      const prev = z[cardId] ?? 0;
      const next = Math.max(0, Math.min(cap, prev + delta));
      if (next === prev) return d; // no actual change (e.g. at cap or 0)
      if (next === 0) delete z[cardId]; else z[cardId] = next;
      const patch = { ...d, [zone]: z };
      // Dropping a champion from the main deck clears the chosen flag.
      if (zone === 'main' && next === 0 && d.championId === cardId) patch.championId = null;
      const zl = ZONE_LABEL[zone];
      const text = next === 0 ? `Removed ${name} from ${zl}`
        : prev === 0 ? `Added ${name} to ${zl}`
        : `${name} ${prev}× → ${next}× (${zl})`;
      return withLog(patch, text, next > prev ? 'add' : 'remove');
    });
  }

  function moveCard(cardId, from, to) {
    const name = cardById.get(cardId)?.name ?? cardId;
    mutate(active.id, d => {
      const card = cardById.get(cardId);
      const cap = card ? deckCap(card) : 3;
      const src = { ...d[from] };
      const dst = { ...d[to] };
      if (!src[cardId]) return d;
      if (to === 'sideboard' && sumQty(dst) >= R.sideboardMax) return d;
      src[cardId] -= 1; if (src[cardId] <= 0) delete src[cardId];
      dst[cardId] = Math.min(cap, (dst[cardId] ?? 0) + 1);
      return withLog({ ...d, [from]: src, [to]: dst }, `Moved ${name}: ${ZONE_LABEL[from]} → ${ZONE_LABEL[to]}`, 'move');
    });
  }

  function addCard(card) {
    if (!active) return;
    if (card.classification?.type === 'Legend') {
      addIdentity(card);
      return;
    }
    adjustZone('main', card.id, +1);
  }

  // Add a Legend to the deck's identity. Single-legend games replace the
  // current legend; multi-legend games append up to the game's max, refusing
  // duplicates by name.
  function addIdentity(card) {
    mutate(active.id, d => {
      const ids = identityIds(d);
      if (ids.includes(card.id)) return d;
      let next, text;
      if (multi) {
        if (ids.length >= R.identity.max) return d;
        const key = R.identity.uniqueBy?.(card);
        if (key && ids.some(id => R.identity.uniqueBy(cardById.get(id) ?? {}) === key)) return d;
        next = [...ids, card.id];
        text = `Added legend: ${card.name}`;
      } else {
        next = [card.id];
        text = ids.length ? `Changed legend → ${card.name}` : `Set legend: ${card.name}`;
      }
      const patch = withIdentity(d, next);
      // A chosen champion must match the legend — drop one that no longer does.
      if (!multi && d.championId) {
        const tags = new Set(card.tags ?? []);
        if (!(cardById.get(d.championId)?.tags ?? []).some(t => tags.has(t))) patch.championId = null;
      }
      // Prepopulate the rune deck from the legend's domains if untouched.
      if (R.seedRunes && sumQty(d.runes) === 0) patch.runes = R.seedRunes([card]);
      return withLog(patch, text, 'legend');
    });
    resetLibFilters(); // moving to step 2 — drop any legend-name filter
  }
  function removeIdentity(cardId) {
    mutate(active.id, d => {
      const ids = identityIds(d);
      if (!ids.includes(cardId)) return d;
      return withLog(withIdentity(d, ids.filter(id => id !== cardId)), `Removed legend: ${cardById.get(cardId)?.name ?? ''}`, 'legend');
    });
    resetLibFilters(); // back to step 1
  }

  // Toggle a bonus legend (Neeko's picks): up to BL.count, all names different
  // from each other and from the starting legend.
  function toggleBonusLegend(card) {
    mutate(active.id, d => {
      const ids = d.bonusLegendIds ?? [];
      if (ids.includes(card.id)) {
        return withLog({ ...d, bonusLegendIds: ids.filter(id => id !== card.id) }, `Removed ${BL.label.toLowerCase()} pick: ${card.name}`, 'legend');
      }
      if (ids.length >= BL.count) return d;
      const taken = [d.legendId, ...ids].map(id => cardById.get(id)).filter(Boolean).map(c => BL.uniqueBy(c));
      if (taken.includes(BL.uniqueBy(card))) return d;
      return withLog({ ...d, bonusLegendIds: [...ids, card.id] }, `Added ${BL.label.toLowerCase()} pick: ${card.name}`, 'legend');
    });
  }

  function resetRunesFromLegend() {
    const cards = identityIds(active).map(id => cardById.get(id)).filter(Boolean);
    mutate(active.id, d => withLog({ ...d, runes: R.seedRunes(cards) }, 'Reset runes from legend', 'rune'));
  }
  function adjustRune(domain, delta) {
    mutate(active.id, d => {
      const runes = { ...d.runes };
      const prev = runes[domain] ?? 0;
      const next = Math.max(0, prev + delta);
      if (next === prev) return d;
      if (next === 0) delete runes[domain]; else runes[domain] = next;
      return withLog({ ...d, runes }, `${domain} runes ${prev} → ${next}`, 'rune');
    });
  }

  function chooseChampion(cardId) {
    mutate(active.id, d => {
      const id = cardId || null;
      if (d.championId === id) return d;
      const text = id ? `Chose champion: ${cardById.get(id)?.name ?? ''}` : 'Cleared chosen champion';
      return withLog({ ...d, championId: id }, text, 'champion');
    });
  }
  // Step 2: set the chosen champion and make sure a copy is in the main deck.
  function pickChampion(card) {
    mutate(active.id, d => {
      const main = { ...d.main };
      if (!main[card.id]) main[card.id] = 1;
      if (d.championId === card.id && d.main[card.id]) return d;
      return withLog({ ...d, main, championId: card.id }, `Chose champion: ${card.name}`, 'champion');
    });
    setLibPickChampion(false);
    setLibFilter('');
  }
  function setTag(cardId, label) {
    mutate(active.id, d => {
      const tags = { ...d.tags };
      const name = cardById.get(cardId)?.name ?? cardId;
      let text;
      if (!label || tags[cardId] === label) { delete tags[cardId]; text = `Untagged ${name}`; }
      else { tags[cardId] = label; text = `Tagged ${name}: ${label}`; }
      return withLog({ ...d, tags }, text, 'tag');
    });
  }

  // Pick which printing's art represents a card in this deck. Passing the base
  // printing (or null) clears the override back to the standard art.
  function setArt(cardId, printingId) {
    mutate(active.id, d => {
      const arts = { ...d.arts };
      const name = cardById.get(cardId)?.name ?? cardId;
      const base = printings.get(cardId)?.base;
      let text;
      if (!printingId || printingId === base?.id) {
        if (!(cardId in arts)) return d;
        delete arts[cardId];
        text = `Reset ${name} to standard art`;
      } else {
        if (arts[cardId] === printingId) return d;
        arts[cardId] = printingId;
        text = `${name} art → ${printingLabel(cardById.get(printingId))}`;
      }
      return withLog({ ...d, arts }, text, 'art');
    });
  }

  // The printing whose art should render for a card in this deck — the chosen
  // alternate if there is one, otherwise the card itself.
  function artOf(card) {
    const id = card && active?.arts?.[card.id];
    return (id && cardById.get(id)) || card;
  }

  function setNotes(value) {
    mutate(active.id, d => ({ ...d, notes: value })); // draft edits aren't logged
  }
  // Commit the notes draft as a timestamped entry in the running note log.
  function addNote() {
    mutate(active.id, d => {
      const text = (d.notes ?? '').trim();
      if (!text) return d;
      return { ...d, notes: '', noteLog: [...(d.noteLog ?? []), { id: uid(), ts: Date.now(), text }] };
    });
  }
  function deleteNote(id) {
    mutate(active.id, d => ({ ...d, noteLog: (d.noteLog ?? []).filter(n => n.id !== id) }));
  }
  function clearLog() {
    mutate(active.id, d => ({ ...d, log: [] }));
  }

  function addMatch() {
    if (!mOpp) return;
    const oppLegendId = mOpp, result = mResult, dice = mDice;
    mutate(active.id, d => ({
      ...d,
      matches: [...(d.matches ?? []), { id: uid(), ts: Date.now(), oppLegendId, result, dice }],
    }));
    setMOpp('');
  }
  function deleteMatch(id) {
    mutate(active.id, d => ({ ...d, matches: (d.matches ?? []).filter(m => m.id !== id) }));
  }

  // ── siding (sideboard guide) ──────────────────────────────────
  function addSidingPlan() {
    if (!sidingOpp) return;
    const oppLegendId = sidingOpp;
    mutate(active.id, d => {
      if ((d.siding ?? []).some(p => p.oppLegendId === oppLegendId)) return d; // one plan per legend
      return { ...d, siding: [...(d.siding ?? []), { id: uid(), oppLegendId, out: {}, in: {} }] };
    });
    setSidingOpp('');
  }
  function deleteSidingPlan(id) {
    mutate(active.id, d => ({ ...d, siding: (d.siding ?? []).filter(p => p.id !== id) }));
  }
  // side: 'out' draws from the main deck, 'in' draws from the sideboard.
  function adjustSiding(planId, side, cardId, delta) {
    mutate(active.id, d => {
      const avail = side === 'out' ? (d.main[cardId] ?? 0) : (d.sideboard[cardId] ?? 0);
      const siding = (d.siding ?? []).map(p => {
        if (p.id !== planId) return p;
        const m = { ...p[side] };
        const next = Math.max(0, Math.min(avail, (m[cardId] ?? 0) + delta));
        if (next === 0) delete m[cardId]; else m[cardId] = next;
        return { ...p, [side]: m };
      });
      return { ...d, siding };
    });
  }

  // ── library (browsable card grid) ─────────────────────────────
  // Two-step flow: with no legend chosen yet, the grid shows ONLY legends
  // (step 1); once a legend is set it shows the rest of the pool with legends
  // excluded (step 2), filtered by name/tags and an optional type chip.
  // Match name OR tags — champion identity (e.g. "Kennen") lives in tags,
  // since legend cards are named by title ("Heart of the Tempest").
  const activeIdentityIds = identityIds(active);
  const identityCards = activeIdentityIds.map(id => cardById.get(id)).filter(Boolean);
  const identityComplete = activeIdentityIds.length >= R.identity.max;
  // Bonus legends (Riftbound: Neeko, Blending In) — extra legends of any domain
  // the deck names while a granting card is in the main deck. The picks stay
  // saved if that card is taken out, but only count while it's in.
  const BL = R.bonusLegends;
  const bonusActive = !!(BL && active && Object.keys(active.main).some(id => BL.grantedBy(cardById.get(id))));
  const bonusCards = bonusActive
    ? (active.bonusLegendIds ?? []).map(id => cardById.get(id)).filter(Boolean)
    : null;
  // Names already taken by the starting legend + bonus picks ("none match names").
  const bonusTaken = bonusCards ? new Set([...identityCards, ...bonusCards].map(c => BL.uniqueBy(c))) : null;
  // Step 1 (pick identity) until the identity is complete; step 2 (add cards)
  // after — unless the user chose to browse legends again.
  // Legal chosen champions: champion units sharing a tag (the champion's
  // name, e.g. "Ahri") with the legend. One tile per card group, like the library.
  const identityTags = new Set(identityCards.flatMap(c => c.tags ?? []));
  const legalChampions = R.hasChampion && identityCards.length
    ? allCards.filter(c =>
        printings.get(c.id)?.base === c &&
        c.classification?.supertype === 'Champion' &&
        c.classification?.type !== 'Legend' &&
        (c.tags ?? []).some(t => identityTags.has(t)))
    : [];
  const libStage = !identityComplete || libBrowseIdentity ? 'identity'
    : libPickBonus && bonusActive ? 'bonus'
    : R.hasChampion && (libPickChampion || (!active?.championId && !champSkipped)) ? 'champion'
    : R.hasBattlefields && libSection === 'battlefields' ? 'battlefields'
    : 'cards';
  const bfStage = libStage === 'battlefields';
  // Past the identity/champion steps — the library shows the playable pool.
  const hasLegend = libStage === 'cards' || bfStage;
  const champStage = libStage === 'champion';
  const bonusStage = libStage === 'bonus';
  // Library results (plain function; React Compiler memoizes — see computeAnalysis).
  // Two-step flow: step 1 shows only legends; step 2 shows the rest of the pool,
  // restricted to cards playable under the chosen identity (game.deck.libraryFilter).
  // Library order: by set (the game's release order), then energy, then
  // color (the game's domain/color order; mono before multi, colorless last),
  // then name.
  const setRank = (c) => {
    const i = game.setOrder.indexOf(c.set?.set_id);
    return i === -1 ? 999 : i;
  };
  const colorRank = (c) => {
    const order = game.faction.values;
    const idx = (c.classification?.domain ?? []).map(d => order.indexOf(d)).filter(i => i !== -1);
    if (!idx.length) return order.length * 2;           // colorless / neutral
    return Math.min(...idx) * 2 + (idx.length > 1 ? 1 : 0);
  };
  function computeLibResults() {
    const q = libFilter.toLowerCase().trim();
    const typeOf = R.typeOf;
    const matchQ = (c) => !q || c.name.toLowerCase().includes(q) || (c.tags ?? []).some(t => t.toLowerCase().includes(q));
    const playable = (c) => R.libraryFilter(c, identityCards);
    return allCards
      .filter(c => {
        // One tile per card: alt arts, premiums and promo reprints are separate
        // cards in the API, so keep only each group's canonical printing. Their
        // art stays reachable through the deck panel's art picker.
        if (printings.get(c.id)?.base !== c) return false;
        if (champStage) return legalChampions.includes(c) && matchQ(c);   // step 2 — legal champions only
        const isLegend = c.classification?.type === 'Legend';
        if (bonusStage) return isLegend && c.id !== active.legendId && matchQ(c); // bonus legends — any domain
        if (!hasLegend) return isLegend && matchQ(c);       // step 1 — legends only
        if (isLegend) return false;                         // later steps — everything but legends
        // Battlefields get their own step; the main-deck step shows the rest.
        const isBf = R.hasBattlefields && c.classification?.type === 'Battlefield';
        if (bfStage) return isBf && matchQ(c);
        if (isBf) return false;
        if (!libShowAll && !playable(c)) return false;      // only what the identity allows
        if (libType && typeOf(c) !== libType) return false;
        return matchQ(c);
      })
      .map(c => ({ card: c, flagged: libShowAll && !playable(c) }))
      .sort((a, b) =>
        setRank(a.card) - setRank(b.card) ||
        (a.card.attributes?.energy ?? 99) - (b.card.attributes?.energy ?? 99) ||
        colorRank(a.card) - colorRank(b.card) ||
        a.card.name.localeCompare(b.card.name));
  }
  const libResults = computeLibResults();

  // Clear the library filter/type — called when the step flips (legend
  // set/removed) or the active deck changes, so a stale filter doesn't linger.
  const resetLibFilters = useCallback(() => {
    setLibFilter(''); setLibType(''); setLibShowAll(false); setLibBrowseIdentity(false);
    setLibPickChampion(false); setChampSkipped(false); setLibPickBonus(false); setLibSection('main');
  }, []);

  // How many copies of a card the active deck already holds (across every zone,
  // counting the legend/champion slots) — drives the library "in deck" badge/cap.
  function qtyInDeck(cardId) {
    if (!active) return 0;
    let n = (active.main[cardId] ?? 0) + (active.sideboard[cardId] ?? 0) + (active.bench[cardId] ?? 0);
    if (activeIdentityIds.includes(cardId)) n += 1;
    return n;
  }

  // ── analysis (plain function; React Compiler memoizes) ────────
  function computeAnalysis() {
    if (!active) return null;
    const zoneCard = (id) => cardById.get(id);
    const legend = identityCards[0] ?? null;

    const mainRows = [];
    const battlefieldRows = [];
    let mainCount = 0;
    for (const [id, qty] of Object.entries(active.main)) {
      const card = zoneCard(id); if (!card) continue;
      const row = { card, qty, owned: ownedTotal(card, collection, foilCollection), price: unitPrice(card, prices) };
      if (R.hasBattlefields && card.classification?.type === 'Battlefield') battlefieldRows.push(row);
      else { mainRows.push(row); mainCount += qty; }
    }
    // Deck order: set (release order), then color (domain order, mono before
    // multi, colorless last), then energy, then name.
    const sortRows = (rows) => rows.sort((a, b) =>
      setRank(a.card) - setRank(b.card) ||
      colorRank(a.card) - colorRank(b.card) ||
      (a.card.attributes?.energy ?? 99) - (b.card.attributes?.energy ?? 99) ||
      a.card.name.localeCompare(b.card.name));
    sortRows(mainRows); sortRows(battlefieldRows);

    const zoneRows = (zone) => Object.entries(active[zone]).map(([id, qty]) => {
      const card = zoneCard(id); return card ? { card, qty } : null;
    }).filter(Boolean).sort((a, b) => a.card.name.localeCompare(b.card.name));

    const allRows = [...mainRows, ...battlefieldRows, ...zoneRows('sideboard'), ...zoneRows('bench')];
    let deckValue = 0, missingCost = 0;
    const missing = [];
    for (const { card, qty } of allRows) {
      const price = unitPrice(card, prices) ?? 0;
      deckValue += price * qty;
      const short = Math.max(0, qty - ownedTotal(card, collection, foilCollection));
      if (short > 0) { missingCost += price * short; missing.push({ card, short, price }); }
    }
    for (const idCard of [...identityCards, ...(bonusCards ?? [])]) {
      const short = Math.max(0, 1 - ownedTotal(idCard, collection, foilCollection));
      const lp = unitPrice(idCard, prices) ?? 0;
      deckValue += lp;
      if (short > 0) { missingCost += lp; missing.push({ card: idCard, short, price: lp }); }
    }
    missing.sort((a, b) => (b.price ?? 0) * b.short - (a.price ?? 0) * a.short);

    return {
      legend, identityCards,
      mainRows, battlefieldRows, battlefieldCount: battlefieldRows.reduce((n, r) => n + r.qty, 0),
      sideboardRows: zoneRows('sideboard'), benchRows: zoneRows('bench'),
      mainCount, runeCount: sumQty(active.runes), sideboardCount: sumQty(active.sideboard),
      deckValue, missingCost, missing,
    };
  }
  const analysis = computeAnalysis();
  // Champions currently in the main deck — the pickable chosen-champion options.
  const championOptions = analysis
    ? analysis.mainRows.filter(r => r.card.classification?.supertype === 'Champion').map(r => r.card)
    : [];
  // The chosen champion is only valid while it's in the main deck.
  const champion = championOptions.find(c => c.id === active?.championId) ?? null;

  // Build steps: Legend → Chosen Champion → Main Deck → (Neeko legends) →
  // Battlefields. Each can be revisited from the step bar; later ones open
  // once the identity is complete.
  function goStep(id) {
    setLibFilter(''); setLibType('');
    setLibBrowseIdentity(id === 'identity');
    setLibPickChampion(id === 'champion');
    setLibPickBonus(id === 'bonus');
    if (id === 'cards' || id === 'battlefields' || id === 'bonus') setChampSkipped(true);
    setLibSection(id === 'battlefields' ? 'battlefields' : 'main');
  }
  const steps = !active ? [] : [
    { id: 'identity', label: R.identity.label, done: identityComplete,
      sub: multi ? `${activeIdentityIds.length}/${R.identity.max}` : null },
    ...(R.hasChampion ? [{ id: 'champion', label: 'Champion', done: !!champion }] : []),
    { id: 'cards', label: R.stepCopy.mainStep ?? 'Main Deck', done: analysis.mainCount === R.main.max,
      sub: `${analysis.mainCount}/${R.main.max}` },
    ...(bonusActive ? [{ id: 'bonus', label: BL.label, done: bonusCards.length === BL.count,
      sub: `${bonusCards.length}/${BL.count}` }] : []),
    ...(R.hasBattlefields ? [{ id: 'battlefields', label: 'Battlefields', done: analysis.battlefieldCount === R.battlefieldTarget,
      sub: `${analysis.battlefieldCount}/${R.battlefieldTarget}` }] : []),
  ];
  const stepIndex = Math.max(0, steps.findIndex(st => st.id === libStage));
  const nextStep = steps[stepIndex + 1] ?? null;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;

  // Match record for this deck.
  const matches = active?.matches ?? [];
  const mWins = matches.filter(m => m.result === 'W').length;
  const mLosses = matches.length - mWins;
  const mWinPct = matches.length ? Math.round((mWins / matches.length) * 100) : 0;
  const mDiceWins = matches.filter(m => m.dice === 'W').length;
  const mDiceLosses = matches.length - mDiceWins;

  const stats = analysis ? computeDeckStats(analysis, active, R) : null;
  const hasBaitedHook = analysis?.mainRows.some(r => r.card.name === 'Baited Hook') ?? false;
  const baitedHookOdds = hasBaitedHook ? computeBaitedHookOdds(analysis) : null;
  const checklist = analysis ? R.validate({ deck: active, analysis, identityCards, champion, bonusCards }) : [];
  const hasTags = stats && Object.values(stats.tags).some(n => n > 0);
  const domainEntries = stats ? Object.entries(stats.domains).sort((a, b) => b[1] - a[1]) : [];
  const maxDomain = domainEntries.length ? domainEntries[0][1] : 1;

  // Build the plain-text decklist — the exact section format the importer reads.
  function buildDecklistText() {
    if (!active || !analysis) return '';
    return R.buildDecklistText({ deck: active, analysis, identityCards, champion, bonusCards });
  }

  async function copyDecklist() {
    const text = buildDecklistText();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function exportImage() {
    if (!active || !analysis) return;
    setImgBusy(true);
    // Export the art the deck actually shows, but keep each card's own name —
    // the chosen printing carries a variant suffix we don't want on the image.
    const asShown = (card) => card && { ...card, media: artOf(card).media };
    try {
      const identity = identityCards.map(c => [R.identity.kind === 'multi' ? 'Legend' : R.identity.label, asShown(c)]);
      for (const c of bonusCards ?? []) identity.push([BL.label.replace(/s$/, ''), asShown(c)]);
      if (R.hasChampion && champion) identity.push(['Champion', asShown(champion)]);
      const shown = (rows) => rows.map(r => ({ ...r, card: asShown(r.card) }));
      await exportDeckImage({
        deckName: active.name,
        identity,
        sections: [
          { label: 'Main Deck', rows: shown(analysis.mainRows) },
          { label: 'Battlefields', rows: shown(analysis.battlefieldRows) },
          { label: 'Sideboard', rows: shown(analysis.sideboardRows) },
          ...(imgBench ? [{ label: 'Bench', rows: shown(analysis.benchRows) }] : []),
        ],
      });
    } catch (e) {
      window.alert(`Image export failed — a card image blocked the canvas. ${e?.message ?? ''}`);
    } finally {
      setImgBusy(false);
    }
  }

  async function copySidingGuide() {
    if (!active || !active.siding.length) return;
    let out = `${active.name} — Siding Guide\n\n`;
    for (const p of active.siding) {
      const opp = cardById.get(p.oppLegendId)?.name ?? 'Unknown legend';
      const outList = Object.entries(p.out).map(([id, q]) => `-${q} ${cardById.get(id)?.name ?? ''}`).join(', ');
      const inList = Object.entries(p.in).map(([id, q]) => `+${q} ${cardById.get(id)?.name ?? ''}`).join(', ');
      out += `vs ${opp}\n  OUT: ${outList || '—'}\n  IN:  ${inList || '—'}\n\n`;
    }
    await navigator.clipboard.writeText(out.trimEnd());
    setSidingCopied(true);
    setTimeout(() => setSidingCopied(false), 1800);
  }

  async function exportSidingGuideImage() {
    if (!active || !active.siding.length) return;
    setSidingImgBusy(true);
    // Show the art the deck displays for each card, but keep its own name.
    const asShown = (card) => card && { ...card, media: artOf(card).media };
    const rowsOf = (obj) => Object.entries(obj ?? {})
      .map(([id, qty]) => ({ card: asShown(cardById.get(id)), qty }))
      .filter(r => r.card);
    try {
      await exportSidingImage({
        deckName: active.name,
        plans: active.siding.map(p => ({
          opp: asShown(cardById.get(p.oppLegendId)),
          out: rowsOf(p.out),
          in: rowsOf(p.in),
        })),
      });
    } catch (e) {
      window.alert(`Image export failed — a card image blocked the canvas. ${e?.message ?? ''}`);
    } finally {
      setSidingImgBusy(false);
    }
  }

  // ── art picker ────────────────────────────────────────────────
  // A paintbrush badge on cards that exist in more than one printing; clicking
  // it opens a thumbnail popover to pick which art the deck shows.
  // `token` identifies which badge is open — a playset renders the same card as
  // several tiles, and each needs its own open/closed state.
  function renderArtPicker(card, place, token = card.id) {
    const group = printings.get(card.id);
    if (!group || group.printings.length < 2) return null;
    const open = artPicker?.token === token;
    const currentId = active.arts[card.id] ?? group.base.id;
    // Prefer opening upward; near the top of the viewport there's no room, so
    // drop below the badge instead.
    const flipDown = open && artPicker.top < POP_MAX_H;
    return (
      <div className={`db-art ${place}`}>
        <button
          className={`db-art-btn${open ? ' open' : ''}${active.arts[card.id] ? ' custom' : ''}`}
          title={`Choose art — ${group.printings.length} printings`}
          onClick={e => {
            e.stopPropagation();
            if (open) { setArtPicker(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            setArtPicker({ token, left: r.right, top: r.top, bottom: r.bottom });
          }}
        >
          🖌
        </button>
        {open && (
          <div
            className="db-art-pop"
            onClick={e => e.stopPropagation()}
            style={{
              left: Math.max(8, Math.min(artPicker.left - POP_W, window.innerWidth - POP_W - 8)),
              ...(flipDown
                ? { top: artPicker.bottom + 6 }
                : { bottom: window.innerHeight - artPicker.top + 6 }),
            }}
          >
            <div className="db-art-pop-head">{card.name}</div>
            <div className="db-art-pop-grid">
              {group.printings.map(p => (
                <button
                  key={p.id}
                  className={`db-art-opt${p.id === currentId ? ' active' : ''}`}
                  title={p.name}
                  onClick={() => { setArt(card.id, p.id); setArtPicker(null); }}
                >
                  {p.media?.image_url
                    ? <img src={p.media.image_url} alt="" loading="lazy" />
                    : <span className="db-lib-ph">{p.name}</span>}
                  <span className="db-art-opt-label">{printingLabel(p)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── deck-zone card tile (one tile per physical copy) ─────────────
  // Each copy of a card shows as its own small image, so a 3-of appears as
  // three cards. Remove / move / tag controls appear on hover.
  function renderCopyTile(card, zone, key, missing) {
    const chosen = active.championId === card.id;
    const tag = active.tags[card.id];
    const art = artOf(card);
    const isPicked = picked?.zone === zone && picked?.key === key;
    return (
      <div key={key} className={`db-mini-tile${missing ? ' short' : ''}${chosen ? ' chosen' : ''}${isPicked ? ' picked' : ''}`}>
        <button
          className="db-mini-tile-art"
          onClick={() => (isMobile ? setPicked(isPicked ? null : { cardId: card.id, zone, key }) : onOpenModal?.(card))}
          title={card.name}
        >
          {art.media?.image_url
            ? <img src={art.media.image_url} alt={card.name} loading="lazy" />
            : <span className="db-lib-ph">{card.name}</span>}
          {isAlwaysFoil(card) && <span className="db-mini-foil">✦</span>}
          {chosen && <span className="db-mini-star">★</span>}
          {tag && <span className="db-mini-tag" style={{ background: TAG_COLOR[tag] }} />}
          {missing && <span className="db-mini-need">need</span>}
        </button>
        {renderArtPicker(card, 'tile', key)}
        <div className="db-mini-controls">
          <button className="db-mini-rm" title="Remove this copy" onClick={() => adjustZone(zone, card.id, -1)}>✕</button>
          {zone !== 'main' && <button className="db-mini-to-main" title="To main deck" onClick={() => moveCard(card.id, zone, 'main')}>M</button>}
          {zone !== 'sideboard' && <button className="db-mini-to-sideboard" title="To sideboard" onClick={() => moveCard(card.id, zone, 'sideboard')}>SB</button>}
          {zone !== 'bench' && <button className="db-mini-to-bench" title="To bench" onClick={() => moveCard(card.id, zone, 'bench')}>B</button>}
          <select className="db-tag-select" value={tag ?? ''} onChange={(e) => setTag(card.id, e.target.value)} title="Tag">
            <option value="">🏷 tag…</option>
            {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
    );
  }

  // Expand a zone's rows into one tile per physical copy (a playset shows 3).
  // Copies beyond the number owned are flagged as "need".
  function renderZoneTiles(rows, zone) {
    return rows.flatMap(({ card, qty, owned }) => {
      const have = owned ?? ownedTotal(card, collection, foilCollection);
      return Array.from({ length: qty }, (_, i) =>
        renderCopyTile(card, zone, `${card.id}-${i}`, i >= have));
    });
  }

  // Collapsible section header for the deck panel.
  function zoneHead(key, title, countNode) {
    return (
      <button className="db-section-head db-section-toggle" onClick={() => toggleCollapse(key)}>
        <span className="db-section-title"><span className="db-chevron">{collapsed[key] ? '▸' : '▾'}</span>{title}</span>
        {countNode}
      </button>
    );
  }

  // A library grid tile — click to add the card to the deck.
  function renderLibTile({ card, flagged }) {
    const isLegend = card.classification?.type === 'Legend';
    // Bonus-legend picking: a tile toggles the pick; one is blocked once the
    // picks are full or its name is already taken.
    const bonusPicked = bonusStage && (bonusCards ?? []).some(c => c.id === card.id);
    const bonusBlocked = bonusStage && !bonusPicked
      && ((bonusCards ?? []).length >= BL.count || bonusTaken.has(BL.uniqueBy(card)));
    const inDeck = bonusStage ? (bonusPicked ? 1 : 0) : qtyInDeck(card.id);
    // A legend that isn't in the deck is still blocked once the identity is full.
    // Battlefields: once the deck has its full set, the rest lock.
    const bfFull = bfStage && inDeck === 0 && (analysis?.battlefieldCount ?? 0) >= R.battlefieldTarget;
    const atCap = bonusStage ? bonusBlocked
      : bfFull || (!champStage && (inDeck >= deckCap(card) || (isLegend && multi && inDeck === 0 && identityComplete)));
    const kind = R.typeOf(card);
    return (
      <button
        key={card.id}
        className={`db-lib-tile${inDeck > 0 ? ' in-deck' : ''}${atCap ? ' at-cap' : ''}${flagged ? ' flagged' : ''}${champStage && active.championId === card.id ? ' chosen' : ''}`}
        onClick={() => {
          if (champStage) { pickChampion(card); if (isMobile) flashToast(`Chosen champion: ${card.name}`); return; }
          if (bonusStage) { toggleBonusLegend(card); if (isMobile) flashToast(`${bonusPicked ? 'Removed' : 'Added'} ${card.name}`); return; }
          addCard(card); if (isMobile) flashToast(`Added ${card.name}`);
        }}
        disabled={atCap}
        title={champStage ? `Choose ${card.name} as your champion`
          : bonusStage ? (bonusPicked ? `Remove ${card.name} from ${BL.label}`
            : bonusBlocked ? `${card.name} — ${(bonusCards ?? []).length >= BL.count ? `${BL.count} already chosen` : 'name already chosen'}`
            : `Add ${card.name} to ${BL.label}`)
          : atCap ? `${card.name} — at max (${deckCap(card)})` : `Add ${card.name}`}
      >
        <span className="db-lib-art">
          {card.media?.image_url
            ? <img src={card.media.image_url} alt={card.name} loading="lazy" />
            : <span className="db-lib-ph">{card.name}</span>}
          {champStage && active.championId === card.id
            ? <span className="db-lib-count">★ Chosen</span>
            : inDeck > 0 && <span className="db-lib-count">{isLegend ? '✓' : `×${inDeck}`}</span>}
          {flagged && <span className="db-lib-flag" title="Outside your legends' budget">{R.libraryFilterBadge}</span>}
          {!atCap && <span className="db-lib-add">＋</span>}
        </span>
        <span className="db-lib-name" title={card.name}>{card.name}</span>
        <span className="db-lib-meta">{kind}</span>
      </button>
    );
  }

  function renderSection(title, count, target, children) {
    const over = target != null && count > target;
    return (
      <div className="db-section">
        <div className="db-section-head">
          <span>{title}</span>
          {count != null && (
            <span className={`db-section-count${over ? ' over' : ''}`}>
              {count}{target != null ? ` / ${target}` : ''}
            </span>
          )}
        </div>
        {children}
      </div>
    );
  }

  function renderSidingPlan(plan) {
    const opp = cardById.get(plan.oppLegendId);
    const outTotal = sumQty(plan.out);
    const inTotal = sumQty(plan.in);
    const balanced = outTotal === inTotal;
    const outRows = Object.entries(plan.out).map(([id, q]) => ({ card: cardById.get(id), q })).filter(r => r.card);
    const inRows = Object.entries(plan.in).map(([id, q]) => ({ card: cardById.get(id), q })).filter(r => r.card);

    const sideCol = (label, side, rows, options, availOf) => (
      <div className="db-siding-col">
        <div className={`db-siding-col-head ${side}`}>{label}</div>
        <select
          className="db-champ-select"
          value=""
          onChange={e => { if (e.target.value) { adjustSiding(plan.id, side, e.target.value, 1); e.target.value = ''; } }}
        >
          <option value="">{side === 'out' ? '+ card from main deck…' : '+ card from sideboard…'}</option>
          {options.map(({ card }) => <option key={card.id} value={card.id}>{card.name}</option>)}
        </select>
        {rows.length ? rows.map(({ card, q }) => (
          <div key={card.id} className={`db-siding-row ${side}`}>
            <span className="db-siding-name" title={card.name}>{card.name}</span>
            <div className="stepper">
              <button onClick={() => adjustSiding(plan.id, side, card.id, -1)}>−</button>
              <span className="val">{q}</span>
              <button onClick={() => adjustSiding(plan.id, side, card.id, 1)} disabled={q >= availOf(card.id)}>+</button>
            </div>
          </div>
        )) : <div className="db-siding-empty">— none —</div>}
      </div>
    );

    return (
      <div key={plan.id} className="db-siding-plan">
        <div className="db-siding-head">
          <button className="db-match-thumb" onClick={() => opp && onOpenModal?.(opp)} title={opp?.name}>
            {opp?.media?.image_url ? <img src={opp.media.image_url} alt="" loading="lazy" /> : null}
          </button>
          <span className="db-siding-opp">vs {opp?.name ?? 'Unknown legend'}</span>
          <span className={`db-siding-balance ${balanced ? 'ok' : 'warn'}`}>−{outTotal} / +{inTotal} {balanced ? '✓' : '⚠'}</span>
          <button className="db-match-del" onClick={() => deleteSidingPlan(plan.id)} title="Delete plan">×</button>
        </div>
        <div className="db-siding-cols">
          {sideCol('Side out', 'out', outRows, analysis.mainRows, id => active.main[id] ?? 0)}
          {sideCol('Side in', 'in', inRows, analysis.sideboardRows, id => active.sideboard[id] ?? 0)}
        </div>
      </div>
    );
  }

  // ── deck gallery (landing view — legend art + New deck) ───────
  function renderGallery() {
    return (
      <div className="db-gallery">
        <div className="db-gallery-head">
          <h2 className="db-gallery-title">Your Decks</h2>
          <div className="db-gallery-actions">
            <button
              className={`btn db-io-toggle${importOpen ? ' active' : ''}`}
              onClick={() => setImportOpen(o => !o)}
              title="Import a decklist from text"
            >
              ⤓ Import
            </button>
            <button className="btn primary" onClick={() => { createDeck(); resetLibFilters(); }}>+ New deck</button>
          </div>
        </div>

        {importOpen && (
          <div className="db-import">
            <textarea
              className="deck-textarea db-import-text"
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={R.importPlaceholder}
              spellCheck={false}
            />
            {importPreview && (
              <div className="db-import-report">
                <span className="db-import-ok">{importPreview.matchedCount} matched</span>
                {importPreview.unknown.length > 0 && (
                  <span className="db-import-miss" title={importPreview.unknown.map(u => `${u.quantity} ${u.name}`).join('\n')}>
                    {importPreview.unknown.length} unmatched
                  </span>
                )}
              </div>
            )}
            <div className="deck-btns">
              <button
                className="btn primary"
                onClick={importDeck}
                disabled={!importPreview || importPreview.matchedCount === 0}
              >
                Import as new deck
              </button>
              <button className="btn ghost" onClick={() => { setImportText(''); setImportOpen(false); }}>Cancel</button>
            </div>
          </div>
        )}

        {decks.length === 0 ? (
          <div className="db-gallery-empty">No decks yet — click <b>+ New deck</b> to build one.</div>
        ) : (
          <div className="db-gallery-grid">
            {decks.map(d => {
              const nd = normalizeDeck(d, cardById);
              const idCards = identityIds(nd).map(id => cardById.get(id)).filter(Boolean);
              const legend = idCards[0] ?? null;
              const champ = R.hasChampion && nd.championId ? cardById.get(nd.championId) : null;
              const count = sumQty(nd.main);
              // Gallery art follows the deck's chosen legend printing.
              const legendArt = legend && (cardById.get(nd.arts?.[legend.id]) ?? legend);
              const identityText = idCards.length ? idCards.map(c => c.name).join(' · ') : 'No legend';
              return (
                <button
                  key={d.id}
                  className="db-gallery-card"
                  onClick={() => { setActiveId(d.id); resetLibFilters(); }}
                  title={`Open ${d.name}`}
                >
                  <span className="db-gallery-art">
                    {legendArt?.media?.image_url
                      ? <img src={legendArt.media.image_url} alt={legend.name} loading="lazy" />
                      : <span className="db-gallery-ph">No legend yet</span>}
                    <span className="db-gallery-count">{count} cards</span>
                  </span>
                  <span className="db-gallery-info">
                    <span className="db-gallery-name">{d.name}</span>
                    <span className="db-gallery-sub">{identityText}{champ ? ` · ★ ${champ.name}` : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (!active) return renderGallery();

  // Phones: action bar for the tapped deck tile (cleared once that card
  // leaves the zone).
  const pickedCard = picked ? cardById.get(picked.cardId) : null;
  const pickedQty = picked ? (active[picked.zone]?.[picked.cardId] ?? 0) : 0;
  const pickedLive = isMobile && mobilePane === 'deck' && pickedCard && pickedQty > 0;

  return (
    <div className={`db-wrap m-pane-${mobilePane}`}>
      {/* ── Builder ── */}
      <div className="db-editor">
        <div className="db-editor-head">
          <button className="db-back" onClick={() => { setActiveId(null); resetLibFilters(); }} title="Back to your decks">← Decks</button>
          <input
            className="db-name-input"
            value={active.name}
            onChange={e => mutate(active.id, d => ({ ...d, name: e.target.value }))}
          />
          <div className="db-head-actions">
            <button className="btn ghost" onClick={() => duplicateDeck(active)}>Duplicate</button>
            <button className="btn ghost danger" onClick={() => deleteDeck(active.id)}>Delete</button>
          </div>
        </div>

          {/* Phones: switch between the library and the deck */}
          {isMobile && (
            <div className="db-mobile-switch seg">
              <button className={mobilePane === 'cards' ? 'active' : ''} onClick={() => setMobilePane('cards')}>Cards</button>
              <button className={mobilePane === 'deck' ? 'active' : ''} onClick={() => { setMobilePane('deck'); setPicked(null); }}>
                Deck <span className="db-mobile-count">{analysis.mainCount}/{R.main.max}</span>
              </button>
            </div>
          )}

          {/* View tabs: browse the library, or dig into deck details */}
          <div className="db-view-tabs">
            <button className={`db-view-tab${view === 'build' ? ' active' : ''}`} onClick={() => setView('build')}>Build</button>
            <button className={`db-view-tab${view === 'details' ? ' active' : ''}`} onClick={() => setView('details')}>Details</button>
          </div>

          {view === 'build' ? (
            /* ── Card library: step 1 pick a legend, step 2 add cards ── */
            <div className="db-library">
              {/* Step bar — every step can be revisited once the identity is set */}
              <ol className="db-steps">
                {steps.map((st, i) => (
                  <li key={st.id}>
                    <button
                      className={`db-step${st.id === libStage ? ' current' : ''}${st.done ? ' done' : ''}`}
                      disabled={i > 0 && !identityComplete}
                      onClick={() => goStep(st.id)}
                    >
                      <span className="db-step-n">{st.done ? '✓' : i + 1}</span>
                      <span className="db-step-label">{st.label}</span>
                      {st.sub && <span className="db-step-sub">{st.sub}</span>}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="db-lib-step">
                <span className="db-lib-step-n">Step {stepIndex + 1}</span>{' '}
                {bonusStage ? (
                  <>Choose {BL.count} legends in addition to your starting legend — any domain, no two with the same name.</>
                ) : champStage ? (
                  <>Choose your chosen champion — {/^[aeiou]/i.test([...identityTags][0] ?? '') ? 'an' : 'a'} {[...identityTags].join(' / ')} champion unit. It goes in your main deck.</>
                ) : bfStage ? (
                  <>{R.stepCopy.battlefields}</>
                ) : hasLegend ? (
                  <>
                    {R.stepCopy.addCards}
                    <span className="db-legend-domains">
                      {identityCards.flatMap(c => R.identityFactions(c)).map((dm, i) => (
                        <span key={`${dm}-${i}`} className="db-domain-pill" style={{ color: `var(--d-${factionKey(dm)})` }}>{dm}</span>
                      ))}
                    </span>
                  </>
                ) : (
                  <>{R.stepCopy.pickIdentity}{multi ? ` (${activeIdentityIds.length}/${R.identity.max} chosen)` : ''}</>
                )}
                {identityComplete && (
                  <span className="db-step-nav">
                    {prevStep && (
                      <button className="btn ghost" onClick={() => goStep(prevStep.id)}>← {prevStep.label}</button>
                    )}
                    {nextStep && (
                      <button className={`btn${steps[stepIndex]?.done ? ' primary' : ' ghost'}`} onClick={() => goStep(nextStep.id)}>
                        {champStage && !active.championId ? 'Skip' : 'Next'}: {nextStep.label} →
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="db-lib-toolbar">
                <input
                  className="db-lib-filter"
                  type="search"
                  placeholder={champStage ? 'Filter champions…' : bfStage ? 'Filter battlefields…' : hasLegend ? 'Filter cards by name or tag…' : 'Filter legends…'}
                  value={libFilter}
                  onChange={e => setLibFilter(e.target.value)}
                />
                {hasLegend && !bfStage && (
                  <div className="db-lib-chips">
                    {R.libraryTypes.filter(t => t !== 'Legend' && !(R.hasBattlefields && t === 'Battlefield')).map(t => (
                      <button
                        key={t}
                        className={`db-lib-chip${libType === t ? ' active' : ''}`}
                        onClick={() => setLibType(libType === t ? '' : t)}
                      >
                        {t}
                      </button>
                    ))}
                    {libType && <button className="db-lib-chip clear" onClick={() => setLibType('')}>Clear</button>}
                    {R.libraryFilterToggle && (
                      <button
                        className={`db-lib-chip${libShowAll ? ' active' : ''}`}
                        title="Also show cards your legends can't pay for (flagged)"
                        onClick={() => setLibShowAll(v => !v)}
                      >
                        Show all
                      </button>
                    )}
                  </div>
                )}
                <span className="db-lib-total">{libResults.length} {champStage ? (libResults.length === 1 ? 'champion' : 'champions') : bfStage ? 'battlefields' : hasLegend ? 'cards' : 'legends'}</span>
              </div>
              {libResults.length
                ? <div className="db-lib-grid">{libResults.flatMap((r, i) => {
                    // A heading wherever a new set starts.
                    const setId = r.card.set?.set_id;
                    const head = i === 0 || libResults[i - 1].card.set?.set_id !== setId;
                    const tile = renderLibTile(r);
                    return head
                      ? [<div key={`set-${setId}`} className="db-lib-set">{game.setLabels[setId] ?? setId ?? 'Other'}</div>, tile]
                      : [tile];
                  })}</div>
                : <div className="db-zone-empty">{champStage && !libFilter
                    ? <>No champion units match this legend yet. <button className="btn ghost" onClick={() => setChampSkipped(true)}>Continue without one</button></>
                    : <>No {champStage ? 'champions' : bfStage ? 'battlefields' : hasLegend ? 'cards' : 'legends'} match — adjust the filter.</>}</div>}
            </div>
          ) : (
            /* ── Details: stats, matchups, siding, notes, change log ── */
            <div className="db-contents">
              <div className="db-stats-grid">
                {/* Energy curve */}
                <div className="deck-stat-card">
                  <h3>{R.costLabel} curve <span className="db-stat-sub">avg {stats.avgEnergy.toFixed(1)}</span></h3>
                  <div className="db-curve">
                    {stats.curve.map((n, e) => (
                      <div key={e} className="db-curve-col">
                        <span className="db-curve-n">{n || ''}</span>
                        <div className="db-curve-track"><div className="db-curve-bar" style={{ height: `${(n / stats.maxCurve) * 100}%` }} /></div>
                        <span className="db-curve-x">{e === R.curveMax ? `${e}+` : e}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Composition */}
                <div className="deck-stat-card">
                  <h3>Composition</h3>
                  <div className="db-stat-rows">
                    {R.statTypes
                      .filter(([, k]) => stats.types[k] > 0)
                      .map(([label, k]) => (
                        <div key={k} className="db-stat-row"><span>{label}</span><span>{stats.types[k]}</span></div>
                      ))}
                    {analysis.mainCount === 0 && <div className="db-stat-muted">No cards yet.</div>}
                  </div>
                </div>

                {/* Baited Hook — only shown when that Gear is in the main deck */}
                {baitedHookOdds && (
                  <div className="deck-stat-card db-hook-card">
                    <h3>Baited Hook odds</h3>
                    <p className="db-hook-note">Chance the top 5 cards hold a legal target (Might ≤ killed + 1) if that unit is the one sacrificed.</p>
                    <div className="db-hook-rows">
                      {baitedHookOdds.map(({ card, qty, might, pct }) => (
                        <div key={card.id} className="db-hook-row">
                          <span className="db-hook-name">{card.name} <span className="db-hook-qty">×{qty}</span></span>
                          <span className="db-hook-might">{might} Might</span>
                          <div className="db-hook-track"><span className="db-hook-fill" style={{ width: `${pct * 100}%` }} /></div>
                          <span className="db-hook-pct">{Math.round(pct * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Domains */}
                {domainEntries.length > 0 && (
                  <div className="deck-stat-card">
                    <h3>{R.factionLabel}</h3>
                    <div className="db-stat-rows">
                      {domainEntries.map(([dm, n]) => (
                        <div key={dm} className="db-domain-stat">
                          <span className="db-domain-name" style={{ color: `var(--d-${dm.toLowerCase()})` }}>
                            <span className="db-rune-dot" style={{ background: `var(--d-${dm.toLowerCase()})` }} />{dm}
                          </span>
                          <div className="db-domain-track">
                            <span className="db-domain-fill" style={{ width: `${(n / maxDomain) * 100}%`, background: `var(--d-${dm.toLowerCase()})` }} />
                          </div>
                          <span className="db-domain-n">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {hasTags && (
                  <div className="deck-stat-card">
                    <h3>Tags</h3>
                    <div className="db-tag-counts">
                      {TAGS.filter(t => stats.tags[t] > 0).map(t => (
                        <span key={t} className="db-tag-count" style={{ color: TAG_COLOR[t], borderColor: TAG_COLOR[t] }}>{t} {stats.tags[t]}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Value */}
                <div className="deck-stat-card">
                  <h3>Value</h3>
                  <div className="db-value-row"><span>Deck value</span><span>{pricesLoading ? '…' : fmt$(analysis.deckValue)}</span></div>
                  <div className="db-value-row"><span>To complete</span>
                    <span style={{ color: analysis.missingCost > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                      {pricesLoading ? '…' : fmt$(analysis.missingCost)}
                    </span>
                  </div>
                </div>

                {/* Missing */}
                {analysis.missing.length > 0 && (
                  <div className="deck-stat-card">
                    <h3>Missing</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {analysis.missing.map(({ card, short, price }) => (
                        <div key={card.id} className="deck-needed-row">
                          <span style={{ color: 'var(--text-1)' }}>{short}× {card.name}</span>
                          <span style={{ color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>{price != null ? fmt$(price * short) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            {/* Matches — legend vs legend, game W/L + dice-roll W/L */}
            {renderSection('Matches', matches.length || null, null, (
              <div className="db-matches">
                <div className="db-match-summary">
                  <div className="db-record">
                    <b className="ok">{mWins}</b><span className="db-record-sep">–</span><b className="bad">{mLosses}</b>
                    {matches.length > 0 && <span className="db-record-pct">{mWinPct}%</span>}
                  </div>
                  <div className="db-record-dice">Dice roll <b>{mDiceWins}</b>–<b>{mDiceLosses}</b></div>
                  {identityCards.length > 0 && <div className="db-record-legend">as {identityCards.map(c => c.name).join(' · ')}</div>}
                </div>

                <div className="db-match-add">
                  <select className="db-champ-select" value={mOpp} onChange={e => setMOpp(e.target.value)}>
                    <option value="">Opponent legend…</option>
                    {legendCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="seg">
                    <button className={mResult === 'W' ? 'active' : ''} onClick={() => setMResult('W')}>Win</button>
                    <button className={mResult === 'L' ? 'active' : ''} onClick={() => setMResult('L')}>Loss</button>
                  </div>
                  <div className="seg">
                    <span className="seg-label">Roll</span>
                    <button className={mDice === 'W' ? 'active' : ''} onClick={() => setMDice('W')}>Won</button>
                    <button className={mDice === 'L' ? 'active' : ''} onClick={() => setMDice('L')}>Lost</button>
                  </div>
                  <button className="btn primary" onClick={addMatch} disabled={!mOpp}>Add match</button>
                </div>

                {matches.length > 0 && (
                  <div className="db-match-list">
                    {[...matches].reverse().map(m => {
                      const opp = cardById.get(m.oppLegendId);
                      return (
                        <div key={m.id} className="db-match-row">
                          <button className="db-match-thumb" onClick={() => opp && onOpenModal?.(opp)} title={opp?.name}>
                            {opp?.media?.image_url ? <img src={opp.media.image_url} alt="" loading="lazy" /> : null}
                          </button>
                          <span className="db-match-opp">{opp?.name ?? 'Unknown legend'}</span>
                          <span className={`db-match-badge ${m.result === 'W' ? 'win' : 'loss'}`}>{m.result === 'W' ? 'Win' : 'Loss'}</span>
                          <span className={`db-match-roll ${m.dice === 'W' ? 'win' : 'loss'}`}>roll {m.dice}</span>
                          <span className="db-match-date">{fmtLogTime(m.ts)}</span>
                          <button className="db-match-del" onClick={() => deleteMatch(m.id)} title="Delete match">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Siding — per-opponent-legend side-out / side-in plans */}
            {renderSection('Siding', active.siding.length || null, null, (
              <div className="db-siding">
                <div className="db-siding-add">
                  <select className="db-champ-select" value={sidingOpp} onChange={e => setSidingOpp(e.target.value)}>
                    <option value="">Opponent legend…</option>
                    {legendCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="btn primary" onClick={addSidingPlan} disabled={!sidingOpp}>Add siding plan</button>
                  {active.siding.length > 0 && (
                    <>
                      <button className="btn" style={{ marginLeft: 'auto' }} onClick={copySidingGuide}>
                        {sidingCopied ? '✓ Copied' : 'Copy siding guide'}
                      </button>
                      <button className="btn" onClick={exportSidingGuideImage} disabled={sidingImgBusy}>
                        {sidingImgBusy ? 'Exporting…' : '🖼 Export image'}
                      </button>
                    </>
                  )}
                </div>
                {active.siding.length === 0
                  ? <div className="db-zone-empty">No siding plans. Pick an opponent legend to plan what to <b>side out</b> (from your main deck) and <b>side in</b> (from your sideboard).</div>
                  : active.siding.map(p => renderSidingPlan(p))}
              </div>
            ))}

            {/* Notes — composer + timestamped running log */}
            {renderSection('Notes', active.noteLog.length || null, null, (
              <div className="db-notes-wrap">
                <textarea
                  className="db-notes"
                  value={active.notes}
                  onChange={e => setNotes(e.target.value)}
                  onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addNote(); } }}
                  placeholder="Write a note — strategy, matchups, swaps to try, sideboard plan… (Ctrl+Enter to log)"
                  spellCheck={false}
                />
                <div className="deck-btns">
                  <button className="btn primary" onClick={addNote} disabled={!active.notes.trim()}>Add note</button>
                </div>
                {active.noteLog.length > 0 && (
                  <div className="db-note-list">
                    {[...active.noteLog].reverse().map(n => (
                      <div key={n.id} className="db-note-row">
                        <span className="db-log-time">{fmtLogTime(n.ts)}</span>
                        <span className="db-note-text">{n.text}</span>
                        <button className="db-match-del" onClick={() => deleteNote(n.id)} title="Delete note">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Change Log — categorized activities with column filters */}
            {renderSection('Change Log', active.log.length || null, null, (
              active.log.length ? (() => {
                const present = LOG_CAT_ORDER.filter(c => active.log.some(e => (e.cat ?? 'other') === c));
                const shown = logCats.length
                  ? active.log.filter(e => logCats.includes(e.cat ?? 'other'))
                  : active.log;
                return (
                  <div className="db-log">
                    <div className="db-log-filters">
                      {present.map(c => {
                        const on = logCats.includes(c);
                        const color = LOG_CATS[c].color;
                        return (
                          <button
                            key={c}
                            className={`db-log-chip${on ? ' active' : ''}`}
                            style={{
                              color,
                              borderColor: on ? color : 'transparent',
                              background: `color-mix(in oklch, ${color} ${on ? 24 : 12}%, transparent)`,
                            }}
                            onClick={() => toggleLogCat(c)}
                          >
                            <span className="db-log-dot" style={{ background: color }} />
                            {LOG_CATS[c].label}
                          </button>
                        );
                      })}
                      {logCats.length > 0 && (
                        <button className="db-log-chip clear" onClick={() => setLogCats([])}>Clear filter</button>
                      )}
                    </div>
                    <div className="db-log-list">
                      <div className="db-log-row head">
                        <span>Time</span>
                        <span>Activity</span>
                        <span>Detail</span>
                      </div>
                      {shown.length === 0 ? (
                        <div className="db-log-none">No entries match this filter.</div>
                      ) : [...shown].reverse().map((e, i) => {
                        const cat = e.cat ?? 'other';
                        const color = LOG_CATS[cat].color;
                        return (
                          <div
                            key={shown.length - i}
                            className="db-log-row"
                            style={{
                              boxShadow: `inset 3px 0 0 ${color}`,
                              background: `color-mix(in oklch, ${color} 7%, transparent)`,
                            }}
                          >
                            <span className="db-log-time">{fmtLogTime(e.ts)}</span>
                            <span className="db-log-cat" style={{ color, background: `color-mix(in oklch, ${color} 22%, transparent)`, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}>
                              <span className="db-log-dot" style={{ background: color }} />
                              {LOG_CATS[cat].label}
                            </span>
                            <span className="db-log-text">{e.text}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="db-log-foot">
                      <span className="db-log-shown">
                        {logCats.length ? `${shown.length} of ${active.log.length}` : `${active.log.length} entr${active.log.length !== 1 ? 'ies' : 'y'}`}
                      </span>
                      <button className="btn ghost" onClick={clearLog}>Clear log</button>
                    </div>
                  </div>
                );
              })() : <div className="db-zone-empty">No changes yet — edits to this deck get logged here automatically.</div>
            ))}
            </div>
          )}
        </div>

      {/* ── Deck panel ── */}
      {active && (
        <aside className="db-deck-panel">
          {/* Deck check */}
          <ul className="db-checklist">
            {checklist.map(row => (
              <li
                key={row.key}
                className={row.warn ? 'warn' : row.ok ? 'ok' : `bad${row.key.startsWith('ram') ? ' violation' : ''}`}
              >
                {row.warn ? '⚠' : row.ok ? '✓' : row.over || row.key.startsWith('ram') ? '✕' : '○'} {row.label}
              </li>
            ))}
          </ul>

          {/* Identity: Legend(s) + (Riftbound) Chosen Champion */}
          <div className="db-panel-identity">
            <div className="db-identity-slot">
              <div className="db-identity-label">{R.identity.label}{multi ? ` ${identityCards.length}/${R.identity.max}` : ''}</div>
              {identityCards.length ? (
                <div className="db-identity-list">
                  {identityCards.map(idCard => (
                    <div key={idCard.id} className="db-mini-card">
                      <button className="db-mini-img" onClick={() => onOpenModal?.(idCard)} title="View details">
                        {artOf(idCard).media?.image_url
                          ? <img src={artOf(idCard).media.image_url} alt={idCard.name} loading="lazy" />
                          : <span className="db-line-ph">{idCard.name.slice(0, 2)}</span>}
                      </button>
                      {renderArtPicker(idCard, 'slot', `identity-${idCard.id}`)}
                      <div className="db-mini-info">
                        <span className="db-mini-name">{idCard.name}</span>
                        <span className="db-legend-domains">
                          {R.identityFactions(idCard).map(dm => (
                            <span key={dm} className="db-domain-pill" style={{ color: `var(--d-${factionKey(dm)})` }}>{dm}</span>
                          ))}
                        </span>
                        <button className="btn ghost danger db-mini-remove" onClick={() => removeIdentity(idCard.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                  {multi && !identityComplete && (
                    <div className="db-identity-empty">{R.identity.max - identityCards.length} more to pick.</div>
                  )}
                </div>
              ) : (
                <div className="db-identity-empty">{R.stepCopy.identityEmpty}</div>
              )}
            </div>

            {bonusActive && <div className="db-identity-slot">
              <div className="db-identity-label">{BL.label} {bonusCards.length}/{BL.count}</div>
              <div className="db-identity-list">
                {bonusCards.map(idCard => (
                  <div key={idCard.id} className="db-mini-card">
                    <button className="db-mini-img" onClick={() => onOpenModal?.(idCard)} title="View details">
                      {artOf(idCard).media?.image_url
                        ? <img src={artOf(idCard).media.image_url} alt={idCard.name} loading="lazy" />
                        : <span className="db-line-ph">{idCard.name.slice(0, 2)}</span>}
                    </button>
                    {renderArtPicker(idCard, 'slot', `bonus-${idCard.id}`)}
                    <div className="db-mini-info">
                      <span className="db-mini-name">{idCard.name}</span>
                      <span className="db-legend-domains">
                        {R.identityFactions(idCard).map(dm => (
                          <span key={dm} className="db-domain-pill" style={{ color: `var(--d-${factionKey(dm)})` }}>{dm}</span>
                        ))}
                      </span>
                      <button className="btn ghost danger db-mini-remove" onClick={() => toggleBonusLegend(idCard)}>Remove</button>
                    </div>
                  </div>
                ))}
                {bonusCards.length < BL.count && (
                  <div className="db-identity-empty">
                    {BL.count - bonusCards.length} more to pick.{' '}
                    <button className="btn ghost" onClick={() => { setLibPickBonus(true); setLibFilter(''); setView('build'); }}>Choose legends</button>
                  </div>
                )}
              </div>
            </div>}

            {R.hasChampion && <div className="db-identity-slot">
              <div className="db-identity-label">Chosen Champion</div>
              {championOptions.length === 0 ? (
                <div className="db-identity-empty">Add a <b>Champion</b> to your main deck, then pick it here.</div>
              ) : (
                <>
                  <select className="db-champ-select" value={champion?.id ?? ''} onChange={e => chooseChampion(e.target.value)}>
                    <option value="">— Select chosen champion —</option>
                    {championOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {champion && (
                    <div className="db-mini-card">
                      <button className="db-mini-img" onClick={() => onOpenModal?.(champion)} title="View details">
                        {artOf(champion).media?.image_url
                          ? <img src={artOf(champion).media.image_url} alt={champion.name} loading="lazy" />
                          : <span className="db-line-ph">{champion.name.slice(0, 2)}</span>}
                      </button>
                      {renderArtPicker(champion, 'slot', 'champion')}
                      <div className="db-mini-info"><span className="db-mini-name">{champion.name}</span></div>
                    </div>
                  )}
                </>
              )}
            </div>}
          </div>

          {/* Deck list, grouped by zone — each section collapsible */}
          <div className="db-line-group">
            {zoneHead('main', 'Main Deck',
              <span className={`db-section-count${analysis.mainCount > R.main.max ? ' over' : ''}`}>
                {analysis.mainCount} / {R.main.min === R.main.max ? R.main.max : `${R.main.min}–${R.main.max}`}
              </span>)}
            {!collapsed.main && (analysis.mainRows.length
              ? <div className="db-mini-grid">{renderZoneTiles(analysis.mainRows, 'main')}</div>
              : <div className="db-zone-empty">{R.stepCopy.mainEmpty}</div>)}
          </div>

          {analysis.battlefieldRows.length > 0 && (
            <div className="db-line-group">
              {zoneHead('battlefields', 'Battlefields',
                <span className="db-section-count">{analysis.battlefieldRows.reduce((n, r) => n + r.qty, 0)}</span>)}
              {!collapsed.battlefields && <div className="db-mini-grid">{renderZoneTiles(analysis.battlefieldRows, 'main')}</div>}
            </div>
          )}

          {R.hasRunes && <div className="db-line-group">
            {zoneHead('runes', 'Rune Deck',
              <span className={`db-section-count${analysis.runeCount > R.runeTarget ? ' over' : ''}`}>{analysis.runeCount} / {R.runeTarget}</span>)}
            {!collapsed.runes && (!analysis.legend ? (
              <div className="db-zone-empty">Add a legend to set up runes.</div>
            ) : (
              <div className="db-rune-deck">
                {[...new Set([...R.identityFactions(analysis.legend), ...Object.keys(active.runes)])].map(dm => (
                  <div key={dm} className="db-rune-row">
                    <span className="db-rune-name" style={{ color: `var(--d-${dm.toLowerCase()})` }}>
                      <span className="db-rune-dot" style={{ background: `var(--d-${dm.toLowerCase()})` }} />{dm}
                    </span>
                    <div className="stepper">
                      <button onClick={() => adjustRune(dm, -1)} disabled={!active.runes[dm]}>−</button>
                      <span className="val">{active.runes[dm] ?? 0}</span>
                      <button onClick={() => adjustRune(dm, 1)}>+</button>
                    </div>
                  </div>
                ))}
                <button className="btn ghost" style={{ marginTop: 4 }} onClick={resetRunesFromLegend}>↻ Reset from legend</button>
              </div>
            ))}
          </div>}

          <div className="db-line-group">
            {zoneHead('sideboard', 'Sideboard',
              <span className={`db-section-count${analysis.sideboardCount > R.sideboardMax ? ' over' : ''}`}>{analysis.sideboardCount} / {R.sideboardMax}</span>)}
            {!collapsed.sideboard && (analysis.sideboardRows.length
              ? <div className="db-mini-grid">{renderZoneTiles(analysis.sideboardRows, 'sideboard')}</div>
              : <div className="db-zone-empty">Empty — move cards here with a card's <b>SB</b> button (max {R.sideboardMax}).</div>)}
          </div>

          <div className="db-line-group">
            {zoneHead('bench', 'Bench',
              <span className="db-section-count">{sumQty(active.bench)}</span>)}
            {!collapsed.bench && (analysis.benchRows.length
              ? <div className="db-mini-grid">{renderZoneTiles(analysis.benchRows, 'bench')}</div>
              : <div className="db-zone-empty">Empty — park potential cards here with a card's <b>Bench</b> button.</div>)}
          </div>

          {/* Export */}
          <div className="db-panel-export">
            <button className="btn" onClick={copyDecklist}>{copied ? '✓ Copied decklist' : 'Copy decklist'}</button>
            <button className="btn" onClick={exportImage} disabled={imgBusy}>{imgBusy ? 'Generating image…' : '🖼 Export image'}</button>
            <label className="db-export-opt" title="Also draw the bench on the exported image">
              <input type="checkbox" checked={imgBench} onChange={e => setImgBench(e.target.checked)} />
              <span>Include bench</span>
            </label>
          </div>
        </aside>
      )}

      {pickedLive && (
        <div className="db-action-bar" role="toolbar" aria-label={`${pickedCard.name} actions`}>
          <div className="db-action-head">
            <span className="db-action-name">{pickedCard.name}</span>
            <span className="db-action-zone">{ZONE_LABEL[picked.zone]} · ×{pickedQty}</span>
            <button className="db-action-close" onClick={() => setPicked(null)} aria-label="Close">✕</button>
          </div>
          <div className="db-action-btns">
            <button className="btn" onClick={() => adjustZone(picked.zone, picked.cardId, -1)}>−1</button>
            <button className="btn" onClick={() => adjustZone(picked.zone, picked.cardId, +1)}>+1</button>
            {picked.zone !== 'main' && <button className="btn" onClick={() => moveCard(picked.cardId, picked.zone, 'main')}>→ Main</button>}
            {picked.zone !== 'sideboard' && <button className="btn" onClick={() => moveCard(picked.cardId, picked.zone, 'sideboard')}>→ Side</button>}
            {picked.zone !== 'bench' && <button className="btn" onClick={() => moveCard(picked.cardId, picked.zone, 'bench')}>→ Bench</button>}
            <select className="db-tag-select" value={active.tags[picked.cardId] ?? ''} onChange={(e) => setTag(picked.cardId, e.target.value)} aria-label="Tag">
              <option value="">🏷 Tag…</option>
              {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="btn ghost" onClick={() => onOpenModal?.(pickedCard)}>Details</button>
          </div>
        </div>
      )}

      {toast && isMobile && <div className="db-toast" role="status">{toast}</div>}
    </div>
  );
}
