import { useMemo, useState, useCallback } from 'react';
import { isSingleton, isAlwaysFoil } from '../utils/playset';
import { ownedTotal, unitPrice, fmt$, PROMO_FOLD_SETS } from '../utils/analysis';
import { exportDeckImage } from '../utils/deckImage';

// Deck shape (v2):
// { id, name, updatedAt, legendId, championId,
//   main: {cardId:qty}, sideboard: {cardId:qty}, bench: {cardId:qty},
//   runes: {domain:count}, tags: {cardId:label} }

const MAIN_TARGET = 40;
const SIDEBOARD_MAX = 8;
const RUNE_TARGET = 12;

const ELEMENTAL_DOMAINS = ['Body', 'Calm', 'Chaos', 'Fury', 'Mind', 'Order'];
const TAGS = ['core', 'amazing', 'flex', 'bad'];
const TAG_COLOR = { core: 'var(--accent)', amazing: 'var(--ok)', flex: 'var(--warn)', bad: 'var(--miss)' };

const uid = () => `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const sumQty = (m) => Object.values(m || {}).reduce((n, q) => n + q, 0);

const ZONE_LABEL = { main: 'main deck', sideboard: 'sideboard', bench: 'bench' };
const LOG_MAX = 400;

// Append a change-log entry to a deck (returns a new deck).
function withLog(d, text) {
  return { ...d, log: [...(d.log ?? []), { ts: Date.now(), text }].slice(-LOG_MAX) };
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
  main: {}, sideboard: {}, bench: {}, runes: {}, tags: {}, notes: '', log: [], matches: [], siding: [],
});

// Ensure a deck has all v2 fields, migrating an old { cards } deck if needed.
function normalizeDeck(deck, cardById) {
  const d = {
    legendId: null, championId: null, main: {}, sideboard: {}, bench: {}, runes: {}, tags: {},
    notes: '', log: [], matches: [], siding: [],
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
  decks, setDecks, onOpenModal,
}) {
  const [activeId, setActiveId] = useState(() => decks[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  // In-progress match entry (opponent legend, game result, dice-roll result).
  const [mOpp, setMOpp] = useState('');
  const [mResult, setMResult] = useState('W');
  const [mDice, setMDice] = useState('W');
  const [sidingOpp, setSidingOpp] = useState('');
  const [sidingCopied, setSidingCopied] = useState(false);

  const cardById = useMemo(() => {
    const m = new Map();
    for (const c of allCards) m.set(c.id, c);
    return m;
  }, [allCards]);

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
  function duplicateDeck(d) {
    const copy = { ...normalizeDeck(d, cardById), id: uid(), name: `${d.name} (copy)`, updatedAt: Date.now() };
    setDecks(prev => [copy, ...prev]);
    setActiveId(copy.id);
  }
  function deleteDeck(id) {
    setDecks(prev => prev.filter(d => d.id !== id));
    if (activeId === id) setActiveId(decks.filter(d => d.id !== id)[0]?.id ?? null);
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
      return withLog(patch, text);
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
      return withLog({ ...d, [from]: src, [to]: dst }, `Moved ${name}: ${ZONE_LABEL[from]} → ${ZONE_LABEL[to]}`);
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
      return withLog(patch, text);
    });
  }
  function clearLegend() {
    mutate(active.id, d => d.legendId
      ? withLog({ ...d, legendId: null }, `Removed legend: ${cardById.get(d.legendId)?.name ?? ''}`)
      : d);
  }

  function resetRunesFromLegend() {
    const legend = cardById.get(active.legendId);
    mutate(active.id, d => withLog({ ...d, runes: prepopulateRunes(legendDomains(legend)) }, 'Reset runes from legend'));
  }
  function adjustRune(domain, delta) {
    mutate(active.id, d => {
      const runes = { ...d.runes };
      const prev = runes[domain] ?? 0;
      const next = Math.max(0, prev + delta);
      if (next === prev) return d;
      if (next === 0) delete runes[domain]; else runes[domain] = next;
      return withLog({ ...d, runes }, `${domain} runes ${prev} → ${next}`);
    });
  }

  function chooseChampion(cardId) {
    mutate(active.id, d => {
      const id = cardId || null;
      if (d.championId === id) return d;
      const text = id ? `Chose champion: ${cardById.get(id)?.name ?? ''}` : 'Cleared chosen champion';
      return withLog({ ...d, championId: id }, text);
    });
  }
  function setTag(cardId, label) {
    mutate(active.id, d => {
      const tags = { ...d.tags };
      const name = cardById.get(cardId)?.name ?? cardId;
      let text;
      if (!label || tags[cardId] === label) { delete tags[cardId]; text = `Untagged ${name}`; }
      else { tags[cardId] = label; text = `Tagged ${name}: ${label}`; }
      return withLog({ ...d, tags }, text);
    });
  }

  function setNotes(value) {
    mutate(active.id, d => ({ ...d, notes: value })); // notes edits aren't logged
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

  // ── search ────────────────────────────────────────────────────
  const results = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    return allCards.filter(c => c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [allCards, search]);

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

  async function copyDecklist() {
    if (!active || !analysis) return;
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
    await navigator.clipboard.writeText(out.trimEnd());
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

  // ── shared tile renderer (plain function, not a nested component) ──
  function renderTile(row, zone) {
    const { card, qty } = row;
    const short = Math.max(0, qty - (row.owned ?? ownedTotal(card, collection, foilCollection)));
    const chosen = active.championId === card.id;
    const tag = active.tags[card.id];
    return (
      <div key={card.id} className={`db-tile${short > 0 ? ' short' : ''}${chosen ? ' chosen' : ''}`}>
        <button className="db-tile-art" onClick={() => onOpenModal?.(card)} title="View details">
          {card.media?.image_url
            ? <img src={card.media.image_url} alt={card.name} loading="lazy" />
            : <span className="db-tile-ph">{card.name}</span>}
          <span className="db-tile-qty">{qty}×{isAlwaysFoil(card) && <span className="db-foil">✦</span>}</span>
          {short > 0 && <span className="db-tile-need">need {short}</span>}
          {tag && <span className="db-tag-badge" style={{ background: TAG_COLOR[tag] }}>{tag}</span>}
          {chosen && <span className="db-chosen-badge">★ champ</span>}
        </button>
        <div className="db-tile-foot">
          <div className="stepper">
            <button onClick={() => adjustZone(zone, card.id, -1)}>−</button>
            <span className="val">{qty}</span>
            <button onClick={() => adjustZone(zone, card.id, 1)} disabled={qty >= deckCap(card)}>+</button>
          </div>
          <span className="db-tile-name" title={card.name}>{card.name}</span>
        </div>
        <div className="db-tile-controls">
          <select
            className="db-tag-select"
            value={tag ?? ''}
            onChange={(e) => setTag(card.id, e.target.value)}
            title="Tag"
          >
            <option value="">tag…</option>
            {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="db-move">
            {zone !== 'main' && <button title="To main deck" onClick={() => moveCard(card.id, zone, 'main')}>Main</button>}
            {zone !== 'sideboard' && <button title="To sideboard" onClick={() => moveCard(card.id, zone, 'sideboard')}>SB</button>}
            {zone !== 'bench' && <button title="To bench" onClick={() => moveCard(card.id, zone, 'bench')}>Bench</button>}
          </div>
        </div>
      </div>
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

  return (
    <div className="db-wrap">
      {/* ── Deck list sidebar ── */}
      <aside className="db-sidebar">
        <button className="btn primary db-new" onClick={createDeck}>+ New deck</button>
        <div className="db-deck-list">
          {decks.length === 0 && <div className="db-empty">No decks yet.</div>}
          {decks.map(d => {
            const nd = normalizeDeck(d, cardById);
            const count = sumQty(nd.main);
            return (
              <button
                key={d.id}
                className={`db-deck-item${d.id === activeId ? ' active' : ''}`}
                onClick={() => setActiveId(d.id)}
              >
                <span className="db-deck-name">{d.name}</span>
                <span className="db-deck-count">{count}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Editor ── */}
      {!active ? (
        <div className="db-editor"><div className="status-placeholder">Create a deck to get started.</div></div>
      ) : (
        <div className="db-editor">
          <div className="db-editor-head">
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

          {/* Search with thumbnails; results hide on click-away */}
          <div className="db-add">
            <input
              className="db-search"
              type="search"
              placeholder="Search cards to add…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            />
            {searchOpen && results.length > 0 && (
              <div className="db-results">
                {results.map(c => (
                  <button key={c.id} className="db-result" onMouseDown={(e) => { e.preventDefault(); addCard(c); }}>
                    <span className="db-result-thumb">
                      {c.media?.image_url ? <img src={c.media.image_url} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="db-result-name">{c.name}</span>
                    <span className="db-result-meta">
                      {c.classification?.supertype === 'Champion' ? 'Champion' : c.classification?.type}
                    </span>
                    <span className="db-result-add">+</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="db-contents">
            {/* Identity: Legend + Chosen Champion side by side, large art */}
            {renderSection('Identity', null, null, (
              <div className="db-identity">
                {/* Legend */}
                <div className="db-identity-slot">
                  <div className="db-identity-label">Legend</div>
                  {analysis.legend ? (
                    <div className="db-identity-card">
                      <button className="db-identity-img" onClick={() => onOpenModal?.(analysis.legend)} title="View details">
                        {analysis.legend.media?.image_url
                          ? <img src={analysis.legend.media.image_url} alt={analysis.legend.name} loading="lazy" />
                          : <span className="db-tile-ph">{analysis.legend.name}</span>}
                        <span className="db-legend-badge">Legend</span>
                      </button>
                      <div className="db-identity-info">
                        <span className="db-champion-name">{analysis.legend.name}</span>
                        <span className="db-legend-domains">
                          {legendDomains(analysis.legend).map(dm => (
                            <span key={dm} className="db-domain-pill" style={{ color: `var(--d-${dm.toLowerCase()})` }}>{dm}</span>
                          ))}
                        </span>
                        <button className="btn ghost danger" style={{ alignSelf: 'flex-start' }} onClick={clearLegend}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div className="db-identity-empty">Add a <b>Legend</b> from search — its domains set up your rune deck.</div>
                  )}
                </div>

                {/* Chosen Champion — pick from the champions in your main deck */}
                <div className="db-identity-slot">
                  <div className="db-identity-label">Chosen Champion</div>
                  {championOptions.length === 0 ? (
                    <div className="db-identity-empty">Add a <b>Champion</b> to your main deck, then pick it here.</div>
                  ) : (
                    <>
                      <select
                        className="db-champ-select"
                        value={champion?.id ?? ''}
                        onChange={e => chooseChampion(e.target.value)}
                      >
                        <option value="">— Select chosen champion —</option>
                        {championOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {champion ? (
                        <div className="db-identity-card">
                          <button className="db-identity-img" onClick={() => onOpenModal?.(champion)} title="View details">
                            {champion.media?.image_url
                              ? <img src={champion.media.image_url} alt={champion.name} loading="lazy" />
                              : <span className="db-tile-ph">{champion.name}</span>}
                            <span className="db-legend-badge champ">Champion</span>
                          </button>
                          <div className="db-identity-info">
                            <span className="db-champion-name">{champion.name}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="db-identity-empty">Pick your chosen champion from the list above.</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Main deck */}
            {renderSection('Main Deck', analysis.mainCount, MAIN_TARGET, analysis.mainRows.length
              ? <div className="db-tile-grid">{analysis.mainRows.map(r => renderTile(r, 'main'))}</div>
              : <div className="db-zone-empty">Empty — search above to add cards. Star a champion to set your chosen champ.</div>)}

            {/* Battlefields */}
            {analysis.battlefieldRows.length > 0 && renderSection(
              'Battlefields',
              analysis.battlefieldRows.reduce((n, r) => n + r.qty, 0),
              null,
              <div className="db-tile-grid">{analysis.battlefieldRows.map(r => renderTile(r, 'main'))}</div>,
            )}

            {/* Rune deck */}
            {renderSection('Rune Deck', analysis.runeCount, RUNE_TARGET, !analysis.legend ? (
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

            {/* Sideboard */}
            {renderSection('Sideboard', analysis.sideboardCount, SIDEBOARD_MAX, analysis.sideboardRows.length
              ? <div className="db-tile-grid">{analysis.sideboardRows.map(r => renderTile(r, 'sideboard'))}</div>
              : <div className="db-zone-empty">Empty — move cards here with the <b>SB</b> button (max 8).</div>)}

            {/* Bench */}
            {renderSection('Bench', sumQty(active.bench), null, analysis.benchRows.length
              ? <div className="db-tile-grid">{analysis.benchRows.map(r => renderTile(r, 'bench'))}</div>
              : <div className="db-zone-empty">Empty — park potential cards here with the <b>Bench</b> button.</div>)}

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

            {/* Notes */}
            {renderSection('Notes', null, null, (
              <textarea
                className="db-notes"
                value={active.notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Deck notes — strategy, matchups, swaps to try, sideboard plan…"
                spellCheck={false}
              />
            ))}

            {/* Change Log */}
            {renderSection('Change Log', active.log.length || null, null, (
              active.log.length ? (
                <div className="db-log">
                  <div className="db-log-list">
                    {[...active.log].reverse().map((e, i) => (
                      <div key={active.log.length - i} className="db-log-row">
                        <span className="db-log-time">{fmtLogTime(e.ts)}</span>
                        <span className="db-log-text">{e.text}</span>
                      </div>
                    ))}
                  </div>
                  <button className="btn ghost" onClick={clearLog}>Clear log</button>
                </div>
              ) : <div className="db-zone-empty">No changes yet — edits to this deck get logged here automatically.</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Summary ── */}
      {active && (
        <aside className="db-summary">
          <div className="deck-stat-card">
            <h3>Deck Check</h3>
            <ul className="db-checklist">
              <li className={active.legendId ? 'ok' : 'bad'}>{active.legendId ? '✓' : '○'} Legend</li>
              <li className={champion ? 'ok' : 'bad'}>{champion ? '✓' : '○'} Chosen champion</li>
              <li className={analysis.mainCount === MAIN_TARGET ? 'ok' : 'bad'}>
                {analysis.mainCount === MAIN_TARGET ? '✓' : '○'} Main deck {analysis.mainCount}/{MAIN_TARGET}
              </li>
              <li className={analysis.runeCount === RUNE_TARGET ? 'ok' : 'bad'}>
                {analysis.runeCount === RUNE_TARGET ? '✓' : '○'} Runes {analysis.runeCount}/{RUNE_TARGET}
              </li>
              <li className={analysis.sideboardCount <= SIDEBOARD_MAX ? 'ok' : 'bad'}>
                {analysis.sideboardCount <= SIDEBOARD_MAX ? '✓' : '✕'} Sideboard {analysis.sideboardCount}/{SIDEBOARD_MAX}
              </li>
            </ul>
            {champion && (
              <div className="db-champ-line">Champion: <b>{champion.name}</b></div>
            )}
            {matches.length > 0 && (
              <div className="db-stat-record">
                Record <b className="ok">{mWins}</b>–<b className="bad">{mLosses}</b>
                <span className="db-stat-record-pct">{mWinPct}% · roll {mDiceWins}–{mDiceLosses}</span>
              </div>
            )}
          </div>

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

          <div className="deck-stat-card">
            <h3>Value</h3>
            <div className="db-value-row"><span>Deck value</span><span>{pricesLoading ? '…' : fmt$(analysis.deckValue)}</span></div>
            <div className="db-value-row"><span>To complete</span>
              <span style={{ color: analysis.missingCost > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                {pricesLoading ? '…' : fmt$(analysis.missingCost)}
              </span>
            </div>
          </div>

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

          <div className="deck-stat-card">
            <h3>Export</h3>
            <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={copyDecklist}>
              {copied ? '✓ Copied decklist' : 'Copy decklist'}
            </button>
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={exportImage} disabled={imgBusy}>
              {imgBusy ? 'Generating image…' : '🖼 Export image'}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
