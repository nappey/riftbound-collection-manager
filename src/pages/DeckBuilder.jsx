import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { isSingleton, isAlwaysFoil } from '../utils/playset';
import { ownedTotal, unitPrice, fmt$, PROMO_FOLD_SETS } from '../utils/analysis';
import { exportDeckImage } from '../utils/deckImage';
import { buildNameMap, deckFromImport } from '../utils/parseDeckList';

const IMPORT_PLACEHOLDER = `Paste a decklist (works with this app's export or
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
2 Downwell`;

// Deck shape (v2):
// { id, name, updatedAt, legendId, championId,
//   main: {cardId:qty}, sideboard: {cardId:qty}, bench: {cardId:qty},
//   runes: {domain:count}, tags: {cardId:label} }

const MAIN_TARGET = 40;
const SIDEBOARD_MAX = 10;
const RUNE_TARGET = 12;

const ELEMENTAL_DOMAINS = ['Body', 'Calm', 'Chaos', 'Fury', 'Mind', 'Order'];
const TAGS = ['core', 'amazing', 'flex', 'bad'];
// Type quick-filter chips for the card library (matches classification.type,
// except 'Champion' which is a supertype).
const LIB_TYPES = ['Legend', 'Champion', 'Unit', 'Spell', 'Gear', 'Rune', 'Battlefield'];
const TAG_COLOR = { core: 'var(--accent)', amazing: 'var(--ok)', flex: 'var(--warn)', bad: 'var(--miss)' };

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

// Aggregate deck stats over the main deck + battlefields: energy curve,
// card-type composition, domain distribution, and tag counts.
function computeDeckStats(analysis, deck) {
  const MAXE = 7; // bucket 7+ together
  const curve = new Array(MAXE + 1).fill(0);
  const types = { Champion: 0, Unit: 0, Spell: 0, Gear: 0, Battlefield: 0 };
  const domains = {};
  let energySum = 0, energyCards = 0;
  for (const { card, qty } of [...analysis.mainRows, ...analysis.battlefieldRows]) {
    if (card.classification?.supertype === 'Champion') types.Champion += qty;
    else { const t = card.classification?.type; if (t in types) types[t] += qty; }
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

function deckCap(card) {
  if (isSingleton(card)) return 1; // Legend / Battlefield
  return 3;
}

function legendDomains(card) {
  return (card?.classification?.domain ?? []).filter(d => ELEMENTAL_DOMAINS.includes(d));
}

function prepopulateRunes(domains) {
  const runes = {};
  const n = domains.length;
  if (!n) return runes;
  const base = Math.floor(RUNE_TARGET / n);
  let rem = RUNE_TARGET - base * n;
  for (const d of domains) runes[d] = base + (rem-- > 0 ? 1 : 0);
  return runes;
}

const newDeckObj = () => ({
  id: uid(), name: 'Untitled Deck', updatedAt: Date.now(),
  legendId: null, championId: null,
  main: {}, sideboard: {}, bench: {}, runes: {}, tags: {}, notes: '', noteLog: [], log: [], matches: [], siding: [],
});

// Ensure a deck has all v2 fields, migrating an old { cards } deck if needed.
function normalizeDeck(deck, cardById) {
  const d = {
    legendId: null, championId: null, main: {}, sideboard: {}, bench: {}, runes: {}, tags: {},
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
  const [activeId, setActiveId] = useState(null); // null → deck gallery; id → builder
  const [libFilter, setLibFilter] = useState('');   // library search text
  const [libType, setLibType] = useState('');        // library type quick-filter ('' = all)
  const [view, setView] = useState('build');         // center view: 'build' | 'details'
  const [collapsed, setCollapsed] = useState({});     // collapsed deck-panel sections
  const toggleCollapse = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));
  const [copied, setCopied] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  // In-progress match entry (opponent legend, game result, dice-roll result).
  const [mOpp, setMOpp] = useState('');
  const [mResult, setMResult] = useState('W');
  const [mDice, setMDice] = useState('W');
  const [sidingOpp, setSidingOpp] = useState('');
  const [sidingCopied, setSidingCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
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
    const domains = legendDomains(legend);
    const deck = {
      ...newDeckObj(),
      name: legend.name,
      legendId: legend.id,
      runes: domains.length ? prepopulateRunes(domains) : {},
      log: [{ ts: Date.now(), cat: 'legend', text: `Set legend: ${legend.name}` }],
    };
    setDecks(prev => [deck, ...prev]);
    setActiveId(deck.id);
    onNewDeckConsumed?.();
  }, [newDeckLegend, setDecks, onNewDeckConsumed]);

  const cardById = useMemo(() => {
    const m = new Map();
    for (const c of allCards) m.set(c.id, c);
    return m;
  }, [allCards]);

  const nameMap = useMemo(() => buildNameMap(allCards), [allCards]);

  // Live preview of a pasted decklist — same parser the Deck Check uses.
  const importPreview = useMemo(
    () => (importText.trim() ? deckFromImport(importText, nameMap) : null),
    [importText, nameMap],
  );

  // Legends for the opponent dropdown — one per name (a legend can be reprinted
  // across sets), preferring the base (non-promo) printing's art.
  const legendCards = useMemo(() => {
    const candidates = allCards.filter(c => c.classification?.type === 'Legend'
      && !c.metadata?.alternate_art
      && !/\((Signature|Overnumbered|Metal)\)/i.test(c.name));
    // Base printings first so they win the de-dupe.
    candidates.sort((a, b) =>
      (PROMO_FOLD_SETS.has(a.set?.set_id) ? 1 : 0) - (PROMO_FOLD_SETS.has(b.set?.set_id) ? 1 : 0));
    const byName = new Map();
    for (const c of candidates) {
      const key = c.name.toLowerCase().trim();
      if (!byName.has(key)) byName.set(key, c);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allCards]);

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
    const res = deckFromImport(importText, nameMap);
    if (res.matchedCount === 0) return; // nothing recognized
    const deck = {
      ...newDeckObj(),
      name: res.name || 'Imported Deck',
      legendId: res.legendId,
      championId: res.championId,
      main: res.main,
      sideboard: res.sideboard,
      runes: res.runes,
      log: [{ ts: Date.now(), cat: 'import', text: `Imported ${res.matchedCount} card${res.matchedCount !== 1 ? 's' : ''}${res.unknown.length ? ` · ${res.unknown.length} line${res.unknown.length !== 1 ? 's' : ''} unmatched` : ''}` }],
    };
    // No runes in the list but we know the legend? Seed from its domains.
    if (sumQty(deck.runes) === 0 && deck.legendId) {
      deck.runes = prepopulateRunes(legendDomains(cardById.get(deck.legendId)));
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
      if (zone === 'sideboard' && delta > 0 && sumQty(z) >= SIDEBOARD_MAX) return d;
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
      if (to === 'sideboard' && sumQty(dst) >= SIDEBOARD_MAX) return d;
      src[cardId] -= 1; if (src[cardId] <= 0) delete src[cardId];
      dst[cardId] = Math.min(cap, (dst[cardId] ?? 0) + 1);
      return withLog({ ...d, [from]: src, [to]: dst }, `Moved ${name}: ${ZONE_LABEL[from]} → ${ZONE_LABEL[to]}`, 'move');
    });
  }

  function addCard(card) {
    if (!active) return;
    if (card.classification?.type === 'Legend') {
      setLegend(card);
      return;
    }
    adjustZone('main', card.id, +1);
  }

  function setLegend(card) {
    mutate(active.id, d => {
      if (d.legendId === card.id) return d;
      const patch = { ...d, legendId: card.id };
      // Prepopulate the rune deck from the legend's domains if untouched.
      if (sumQty(d.runes) === 0) patch.runes = prepopulateRunes(legendDomains(card));
      const text = d.legendId
        ? `Changed legend → ${card.name}` : `Set legend: ${card.name}`;
      return withLog(patch, text, 'legend');
    });
    resetLibFilters(); // moving to step 2 — drop any legend-name filter
  }
  function clearLegend() {
    mutate(active.id, d => d.legendId
      ? withLog({ ...d, legendId: null }, `Removed legend: ${cardById.get(d.legendId)?.name ?? ''}`, 'legend')
      : d);
    resetLibFilters(); // back to step 1
  }

  function resetRunesFromLegend() {
    const legend = cardById.get(active.legendId);
    mutate(active.id, d => withLog({ ...d, runes: prepopulateRunes(legendDomains(legend)) }, 'Reset runes from legend', 'rune'));
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
  const hasLegend = !!active?.legendId;
  const legendCard = hasLegend ? cardById.get(active.legendId) : null;
  // Library results (plain function; React Compiler memoizes — see computeAnalysis).
  // Two-step flow: step 1 shows only legends; step 2 shows the rest of the pool,
  // restricted to cards playable in the chosen legend's domains.
  function computeLibResults() {
    const q = libFilter.toLowerCase().trim();
    const typeOf = (c) => c.classification?.supertype === 'Champion' ? 'Champion' : c.classification?.type;
    const TYPE_ORDER = { Champion: 0, Unit: 1, Spell: 2, Gear: 3, Rune: 4, Battlefield: 5 };
    const matchQ = (c) => !q || c.name.toLowerCase().includes(q) || (c.tags ?? []).some(t => t.toLowerCase().includes(q));
    // A card is playable if every elemental domain it has is one of the
    // legend's domains; domainless/neutral cards are always allowed.
    const legendSet = new Set(legendCard ? legendDomains(legendCard) : []);
    const inLegendDomains = (c) =>
      (c.classification?.domain ?? [])
        .filter(d => ELEMENTAL_DOMAINS.includes(d))
        .every(d => legendSet.has(d));
    return allCards
      .filter(c => {
        const isLegend = c.classification?.type === 'Legend';
        if (!hasLegend) return isLegend && matchQ(c);       // step 1 — legends only
        if (isLegend) return false;                         // step 2 — everything but legends
        if (!inLegendDomains(c)) return false;              // only the legend's domains
        if (libType && typeOf(c) !== libType) return false;
        return matchQ(c);
      })
      .sort((a, b) =>
        (TYPE_ORDER[typeOf(a)] ?? 9) - (TYPE_ORDER[typeOf(b)] ?? 9) ||
        (a.attributes?.energy ?? 99) - (b.attributes?.energy ?? 99) ||
        a.name.localeCompare(b.name));
  }
  const libResults = computeLibResults();

  // Clear the library filter/type — called when the step flips (legend
  // set/removed) or the active deck changes, so a stale filter doesn't linger.
  const resetLibFilters = useCallback(() => { setLibFilter(''); setLibType(''); }, []);

  // How many copies of a card the active deck already holds (across every zone,
  // counting the legend/champion slots) — drives the library "in deck" badge/cap.
  function qtyInDeck(cardId) {
    if (!active) return 0;
    let n = (active.main[cardId] ?? 0) + (active.sideboard[cardId] ?? 0) + (active.bench[cardId] ?? 0);
    if (active.legendId === cardId) n += 1;
    return n;
  }

  // ── analysis (plain function; React Compiler memoizes) ────────
  function computeAnalysis() {
    if (!active) return null;
    const zoneCard = (id) => cardById.get(id);
    const legend = active.legendId ? zoneCard(active.legendId) : null;

    const mainRows = [];
    const battlefieldRows = [];
    let mainCount = 0;
    for (const [id, qty] of Object.entries(active.main)) {
      const card = zoneCard(id); if (!card) continue;
      const row = { card, qty, owned: ownedTotal(card, collection, foilCollection), price: unitPrice(card, prices) };
      if (card.classification?.type === 'Battlefield') battlefieldRows.push(row);
      else { mainRows.push(row); mainCount += qty; }
    }
    const sortRows = (rows) => rows.sort((a, b) =>
      (a.card.attributes?.energy ?? 99) - (b.card.attributes?.energy ?? 99) || a.card.name.localeCompare(b.card.name));
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
    if (legend) {
      const short = Math.max(0, 1 - ownedTotal(legend, collection, foilCollection));
      const lp = unitPrice(legend, prices) ?? 0;
      deckValue += lp;
      if (short > 0) { missingCost += lp; missing.push({ card: legend, short, price: lp }); }
    }
    missing.sort((a, b) => (b.price ?? 0) * b.short - (a.price ?? 0) * a.short);

    return {
      legend,
      mainRows, battlefieldRows,
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

  // Match record for this deck.
  const matches = active?.matches ?? [];
  const mWins = matches.filter(m => m.result === 'W').length;
  const mLosses = matches.length - mWins;
  const mWinPct = matches.length ? Math.round((mWins / matches.length) * 100) : 0;
  const mDiceWins = matches.filter(m => m.dice === 'W').length;
  const mDiceLosses = matches.length - mDiceWins;

  const stats = analysis ? computeDeckStats(analysis, active) : null;
  const hasTags = stats && Object.values(stats.tags).some(n => n > 0);
  const domainEntries = stats ? Object.entries(stats.domains).sort((a, b) => b[1] - a[1]) : [];
  const maxDomain = domainEntries.length ? domainEntries[0][1] : 1;

  // Build the plain-text decklist — the exact section format the importer reads.
  function buildDecklistText() {
    if (!active || !analysis) return '';
    let out = '';
    if (analysis.legend) out += `Legend:\n1 ${analysis.legend.name}\n\n`;
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
    const runeEntries = Object.entries(active.runes).filter(([, n]) => n > 0);
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
    try {
      await exportDeckImage({ deckName: active.name, legend: analysis.legend, champion, mainRows: analysis.mainRows });
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

  // ── deck-zone card tile (one tile per physical copy) ─────────────
  // Each copy of a card shows as its own small image, so a 3-of appears as
  // three cards. Remove / move / tag controls appear on hover.
  function renderCopyTile(card, zone, key, missing) {
    const chosen = active.championId === card.id;
    const tag = active.tags[card.id];
    return (
      <div key={key} className={`db-mini-tile${missing ? ' short' : ''}${chosen ? ' chosen' : ''}`}>
        <button className="db-mini-tile-art" onClick={() => onOpenModal?.(card)} title={card.name}>
          {card.media?.image_url
            ? <img src={card.media.image_url} alt={card.name} loading="lazy" />
            : <span className="db-lib-ph">{card.name}</span>}
          {isAlwaysFoil(card) && <span className="db-mini-foil">✦</span>}
          {chosen && <span className="db-mini-star">★</span>}
          {tag && <span className="db-mini-tag" style={{ background: TAG_COLOR[tag] }} />}
          {missing && <span className="db-mini-need">need</span>}
        </button>
        <div className="db-mini-controls">
          <button className="db-mini-rm" title="Remove this copy" onClick={() => adjustZone(zone, card.id, -1)}>−</button>
          {zone !== 'main' && <button title="To main deck" onClick={() => moveCard(card.id, zone, 'main')}>M</button>}
          {zone !== 'sideboard' && <button title="To sideboard" onClick={() => moveCard(card.id, zone, 'sideboard')}>SB</button>}
          {zone !== 'bench' && <button title="To bench" onClick={() => moveCard(card.id, zone, 'bench')}>B</button>}
          <select className="db-tag-select" value={tag ?? ''} onChange={(e) => setTag(card.id, e.target.value)} title="Tag">
            <option value="">tag…</option>
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
  function renderLibTile(card) {
    const inDeck = qtyInDeck(card.id);
    const atCap = inDeck >= deckCap(card);
    const isLegend = card.classification?.type === 'Legend';
    const kind = card.classification?.supertype === 'Champion' ? 'Champion' : card.classification?.type;
    return (
      <button
        key={card.id}
        className={`db-lib-tile${inDeck > 0 ? ' in-deck' : ''}${atCap ? ' at-cap' : ''}`}
        onClick={() => addCard(card)}
        disabled={atCap}
        title={atCap ? `${card.name} — at max (${deckCap(card)})` : `Add ${card.name}`}
      >
        <span className="db-lib-art">
          {card.media?.image_url
            ? <img src={card.media.image_url} alt={card.name} loading="lazy" />
            : <span className="db-lib-ph">{card.name}</span>}
          {inDeck > 0 && <span className="db-lib-count">{isLegend ? '✓' : `×${inDeck}`}</span>}
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
              placeholder={IMPORT_PLACEHOLDER}
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
              const legend = nd.legendId ? cardById.get(nd.legendId) : null;
              const champ = nd.championId ? cardById.get(nd.championId) : null;
              const count = sumQty(nd.main);
              return (
                <button
                  key={d.id}
                  className="db-gallery-card"
                  onClick={() => { setActiveId(d.id); resetLibFilters(); }}
                  title={`Open ${d.name}`}
                >
                  <span className="db-gallery-art">
                    {legend?.media?.image_url
                      ? <img src={legend.media.image_url} alt={legend.name} loading="lazy" />
                      : <span className="db-gallery-ph">No legend yet</span>}
                    <span className="db-gallery-count">{count} cards</span>
                  </span>
                  <span className="db-gallery-info">
                    <span className="db-gallery-name">{d.name}</span>
                    <span className="db-gallery-sub">{legend ? legend.name : 'No legend'}{champ ? ` · ★ ${champ.name}` : ''}</span>
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

  return (
    <div className="db-wrap">
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

          {/* View tabs: browse the library, or dig into deck details */}
          <div className="db-view-tabs">
            <button className={`db-view-tab${view === 'build' ? ' active' : ''}`} onClick={() => setView('build')}>Build</button>
            <button className={`db-view-tab${view === 'details' ? ' active' : ''}`} onClick={() => setView('details')}>Details</button>
          </div>

          {view === 'build' ? (
            /* ── Card library: step 1 pick a legend, step 2 add cards ── */
            <div className="db-library">
              <div className="db-lib-step">
                {hasLegend ? (
                  <>
                    <span className="db-lib-step-n">Step 2</span> Add cards — showing your legend's domains:
                    {legendCard && legendDomains(legendCard).length > 0 && (
                      <span className="db-legend-domains">
                        {legendDomains(legendCard).map(dm => (
                          <span key={dm} className="db-domain-pill" style={{ color: `var(--d-${dm.toLowerCase()})` }}>{dm}</span>
                        ))}
                      </span>
                    )}
                  </>
                ) : (
                  <><span className="db-lib-step-n">Step 1</span> Pick your legend — it sets your domains and rune deck.</>
                )}
              </div>
              <div className="db-lib-toolbar">
                <input
                  className="db-lib-filter"
                  type="search"
                  placeholder={hasLegend ? 'Filter cards by name or tag…' : 'Filter legends…'}
                  value={libFilter}
                  onChange={e => setLibFilter(e.target.value)}
                />
                {hasLegend && (
                  <div className="db-lib-chips">
                    {LIB_TYPES.filter(t => t !== 'Legend').map(t => (
                      <button
                        key={t}
                        className={`db-lib-chip${libType === t ? ' active' : ''}`}
                        onClick={() => setLibType(libType === t ? '' : t)}
                      >
                        {t}
                      </button>
                    ))}
                    {libType && <button className="db-lib-chip clear" onClick={() => setLibType('')}>Clear</button>}
                  </div>
                )}
                <span className="db-lib-total">{libResults.length} {hasLegend ? 'cards' : 'legends'}</span>
              </div>
              {libResults.length
                ? <div className="db-lib-grid">{libResults.map(renderLibTile)}</div>
                : <div className="db-zone-empty">No {hasLegend ? 'cards' : 'legends'} match — adjust the filter.</div>}
            </div>
          ) : (
            /* ── Details: stats, matchups, siding, notes, change log ── */
            <div className="db-contents">
              <div className="db-stats-grid">
                {/* Energy curve */}
                <div className="deck-stat-card">
                  <h3>Energy curve <span className="db-stat-sub">avg {stats.avgEnergy.toFixed(1)}</span></h3>
                  <div className="db-curve">
                    {stats.curve.map((n, e) => (
                      <div key={e} className="db-curve-col">
                        <span className="db-curve-n">{n || ''}</span>
                        <div className="db-curve-track"><div className="db-curve-bar" style={{ height: `${(n / stats.maxCurve) * 100}%` }} /></div>
                        <span className="db-curve-x">{e === 7 ? '7+' : e}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Composition */}
                <div className="deck-stat-card">
                  <h3>Composition</h3>
                  <div className="db-stat-rows">
                    {[['Champions', 'Champion'], ['Units', 'Unit'], ['Spells', 'Spell'], ['Gear', 'Gear'], ['Battlefields', 'Battlefield']]
                      .filter(([, k]) => stats.types[k] > 0)
                      .map(([label, k]) => (
                        <div key={k} className="db-stat-row"><span>{label}</span><span>{stats.types[k]}</span></div>
                      ))}
                    {analysis.mainCount === 0 && <div className="db-stat-muted">No cards yet.</div>}
                  </div>
                </div>

                {/* Domains */}
                {domainEntries.length > 0 && (
                  <div className="deck-stat-card">
                    <h3>Domains</h3>
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
                  {analysis.legend && <div className="db-record-legend">as {analysis.legend.name}</div>}
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
                    <button className="btn" style={{ marginLeft: 'auto' }} onClick={copySidingGuide}>
                      {sidingCopied ? '✓ Copied' : 'Copy siding guide'}
                    </button>
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
            <li className={active.legendId ? 'ok' : 'bad'}>{active.legendId ? '✓' : '○'} Legend</li>
            <li className={champion ? 'ok' : 'bad'}>{champion ? '✓' : '○'} Chosen champion</li>
            <li className={analysis.mainCount === MAIN_TARGET ? 'ok' : 'bad'}>
              {analysis.mainCount === MAIN_TARGET ? '✓' : '○'} Main {analysis.mainCount}/{MAIN_TARGET}
            </li>
            <li className={analysis.runeCount === RUNE_TARGET ? 'ok' : 'bad'}>
              {analysis.runeCount === RUNE_TARGET ? '✓' : '○'} Runes {analysis.runeCount}/{RUNE_TARGET}
            </li>
            <li className={analysis.sideboardCount <= SIDEBOARD_MAX ? 'ok' : 'bad'}>
              {analysis.sideboardCount <= SIDEBOARD_MAX ? '✓' : '✕'} SB {analysis.sideboardCount}/{SIDEBOARD_MAX}
            </li>
          </ul>

          {/* Legend + Chosen Champion, side by side */}
          <div className="db-panel-identity">
            <div className="db-identity-slot">
              <div className="db-identity-label">Legend</div>
              {analysis.legend ? (
                <div className="db-mini-card">
                  <button className="db-mini-img" onClick={() => onOpenModal?.(analysis.legend)} title="View details">
                    {analysis.legend.media?.image_url
                      ? <img src={analysis.legend.media.image_url} alt={analysis.legend.name} loading="lazy" />
                      : <span className="db-line-ph">{analysis.legend.name.slice(0, 2)}</span>}
                  </button>
                  <div className="db-mini-info">
                    <span className="db-mini-name">{analysis.legend.name}</span>
                    <span className="db-legend-domains">
                      {legendDomains(analysis.legend).map(dm => (
                        <span key={dm} className="db-domain-pill" style={{ color: `var(--d-${dm.toLowerCase()})` }}>{dm}</span>
                      ))}
                    </span>
                    <button className="btn ghost danger db-mini-remove" onClick={clearLegend}>Remove</button>
                  </div>
                </div>
              ) : (
                <div className="db-identity-empty">Click a <b>Legend</b> in the library — its domains set up your rune deck.</div>
              )}
            </div>

            <div className="db-identity-slot">
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
                        {champion.media?.image_url
                          ? <img src={champion.media.image_url} alt={champion.name} loading="lazy" />
                          : <span className="db-line-ph">{champion.name.slice(0, 2)}</span>}
                      </button>
                      <div className="db-mini-info"><span className="db-mini-name">{champion.name}</span></div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Deck list, grouped by zone — each section collapsible */}
          <div className="db-line-group">
            {zoneHead('main', 'Main Deck',
              <span className={`db-section-count${analysis.mainCount > MAIN_TARGET ? ' over' : ''}`}>{analysis.mainCount} / {MAIN_TARGET}</span>)}
            {!collapsed.main && (analysis.mainRows.length
              ? <div className="db-mini-grid">{renderZoneTiles(analysis.mainRows, 'main')}</div>
              : <div className="db-zone-empty">Empty — add cards from the library. Set a chosen champion from a champion in your deck.</div>)}
          </div>

          {analysis.battlefieldRows.length > 0 && (
            <div className="db-line-group">
              {zoneHead('battlefields', 'Battlefields',
                <span className="db-section-count">{analysis.battlefieldRows.reduce((n, r) => n + r.qty, 0)}</span>)}
              {!collapsed.battlefields && <div className="db-mini-grid">{renderZoneTiles(analysis.battlefieldRows, 'main')}</div>}
            </div>
          )}

          <div className="db-line-group">
            {zoneHead('runes', 'Rune Deck',
              <span className={`db-section-count${analysis.runeCount > RUNE_TARGET ? ' over' : ''}`}>{analysis.runeCount} / {RUNE_TARGET}</span>)}
            {!collapsed.runes && (!analysis.legend ? (
              <div className="db-zone-empty">Add a legend to set up runes.</div>
            ) : (
              <div className="db-rune-deck">
                {[...new Set([...legendDomains(analysis.legend), ...Object.keys(active.runes)])].map(dm => (
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
          </div>

          <div className="db-line-group">
            {zoneHead('sideboard', 'Sideboard',
              <span className={`db-section-count${analysis.sideboardCount > SIDEBOARD_MAX ? ' over' : ''}`}>{analysis.sideboardCount} / {SIDEBOARD_MAX}</span>)}
            {!collapsed.sideboard && (analysis.sideboardRows.length
              ? <div className="db-mini-grid">{renderZoneTiles(analysis.sideboardRows, 'sideboard')}</div>
              : <div className="db-zone-empty">Empty — move cards here with a card's <b>SB</b> button (max {SIDEBOARD_MAX}).</div>)}
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
          </div>
        </aside>
      )}
    </div>
  );
}
