import { useMemo, useState, useCallback } from 'react';
import { isSingleton, isAlwaysFoil } from '../utils/playset';
import { ownedTotal, unitPrice, fmt$ } from '../utils/analysis';

// Deck shape: { id, name, cards: { [cardId]: qty }, updatedAt }

const SECTIONS = ['Legend', 'Champion', 'MainDeck', 'Battlefields', 'Runes'];
const SECTION_LABELS = {
  Legend: 'Legend', Champion: 'Champions', MainDeck: 'Main Deck',
  Battlefields: 'Battlefields', Runes: 'Rune Deck',
};
// Headers used in the exported / Deck-Check decklist format.
const EXPORT_HEADERS = {
  Legend: 'Legend', Champion: 'Champion', MainDeck: 'MainDeck',
  Battlefields: 'Battlefields', Runes: 'Runes',
};

function sectionOf(card) {
  const t = card.classification?.type;
  if (t === 'Legend') return 'Legend';
  if (t === 'Battlefield') return 'Battlefields';
  if (t === 'Rune') return 'Runes';
  if (card.classification?.supertype === 'Champion') return 'Champion';
  return 'MainDeck';
}

function deckCap(card) {
  if (isSingleton(card)) return 1;
  if (card.classification?.type === 'Rune') return 12;
  return 3;
}

const uid = () => `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Analyse a deck against the collection: group cards, total value, and what's
// still needed to build it. Kept at module scope so React Compiler can memoize
// the call site cleanly.
function computeDeckAnalysis(deck, cardById, collection, foilCollection, prices) {
  if (!deck) return null;
  const bySection = Object.fromEntries(SECTIONS.map(s => [s, []]));
  let totalCards = 0, deckValue = 0, missingCost = 0, shortCards = 0;
  const missing = [];
  for (const [cardId, qty] of Object.entries(deck.cards)) {
    const card = cardById.get(cardId);
    if (!card) continue;
    totalCards += qty;
    const owned = ownedTotal(card, collection, foilCollection);
    const price = unitPrice(card, prices);
    deckValue += (price ?? 0) * qty;
    const short = Math.max(0, qty - owned);
    if (short > 0) {
      shortCards += short;
      missingCost += (price ?? 0) * short;
      missing.push({ card, short, price });
    }
    bySection[sectionOf(card)].push({ card, qty, owned, short, price });
  }
  for (const s of SECTIONS) {
    bySection[s].sort((a, b) => (a.card.attributes?.energy ?? 99) - (b.card.attributes?.energy ?? 99)
      || a.card.name.localeCompare(b.card.name));
  }
  missing.sort((a, b) => (b.price ?? 0) * b.short - (a.price ?? 0) * a.short);
  return { bySection, totalCards, deckValue, missingCost, shortCards, missing,
    buildable: shortCards === 0 && totalCards > 0 };
}

export default function DeckBuilder({
  allCards, collection, foilCollection, prices, pricesLoading,
  decks, setDecks, onOpenModal,
}) {
  const [activeId, setActiveId] = useState(() => decks[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const cardById = useMemo(() => {
    const m = new Map();
    for (const c of allCards) m.set(c.id, c);
    return m;
  }, [allCards]);

  const active = decks.find(d => d.id === activeId) ?? null;

  // ── deck mutations ────────────────────────────────────────────
  const mutate = useCallback((id, fn) => {
    setDecks(prev => prev.map(d => d.id === id ? { ...fn(d), updatedAt: Date.now() } : d));
  }, [setDecks]);

  function newDeck() {
    const deck = { id: uid(), name: 'Untitled Deck', cards: {}, updatedAt: Date.now() };
    setDecks(prev => [deck, ...prev]);
    setActiveId(deck.id);
  }
  function duplicateDeck(d) {
    const copy = { id: uid(), name: `${d.name} (copy)`, cards: { ...d.cards }, updatedAt: Date.now() };
    setDecks(prev => [copy, ...prev]);
    setActiveId(copy.id);
  }
  function deleteDeck(id) {
    setDecks(prev => prev.filter(d => d.id !== id));
    if (activeId === id) {
      const remaining = decks.filter(d => d.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
  }
  function setQty(cardId, delta) {
    if (!active) return;
    const card = cardById.get(cardId);
    const cap = card ? deckCap(card) : 3;
    mutate(active.id, d => {
      const cards = { ...d.cards };
      const next = Math.max(0, Math.min(cap, (cards[cardId] ?? 0) + delta));
      if (next === 0) delete cards[cardId]; else cards[cardId] = next;
      return { ...d, cards };
    });
  }

  // ── search results for adding cards ───────────────────────────
  const results = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    return allCards
      .filter(c => c.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [allCards, search]);

  // ── analysis of active deck ───────────────────────────────────
  const analysis = computeDeckAnalysis(active, cardById, collection, foilCollection, prices);

  async function copyDecklist() {
    if (!active || !analysis) return;
    let out = '';
    for (const s of SECTIONS) {
      const rows = analysis.bySection[s];
      if (!rows.length) continue;
      out += `${EXPORT_HEADERS[s]}:\n`;
      for (const { card, qty } of rows) out += `${qty} ${card.name}\n`;
      out += '\n';
    }
    await navigator.clipboard.writeText(out.trimEnd());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="db-wrap">
      {/* ── Deck list sidebar ── */}
      <aside className="db-sidebar">
        <button className="btn primary db-new" onClick={newDeck}>+ New deck</button>
        <div className="db-deck-list">
          {decks.length === 0 && <div className="db-empty">No decks yet.</div>}
          {decks.map(d => {
            const count = Object.values(d.cards).reduce((n, q) => n + q, 0);
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
        <div className="db-editor">
          <div className="status-placeholder">Create a deck to get started.</div>
        </div>
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

          {/* Add cards */}
          <div className="db-add">
            <input
              className="db-search"
              type="search"
              placeholder="Search cards to add…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="db-results">
                {results.map(c => (
                  <button key={c.id} className="db-result" onClick={() => setQty(c.id, 1)}>
                    <span className="db-result-name">{c.name}</span>
                    <span className="db-result-meta">{c.classification?.type} · {(active.cards[c.id] ?? 0)}/{deckCap(c)}</span>
                    <span className="db-result-add">+</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Deck contents */}
          <div className="db-contents">
            {SECTIONS.map(s => {
              const rows = analysis.bySection[s];
              if (!rows.length) return null;
              return (
                <div key={s} className="db-section">
                  <div className="db-section-head">
                    <span>{SECTION_LABELS[s]}</span>
                    <span className="db-section-count">{rows.reduce((n, r) => n + r.qty, 0)}</span>
                  </div>
                  {rows.map(({ card, qty, owned, short, price }) => (
                    <div key={card.id} className={`db-card-row${short > 0 ? ' short' : ''}`}>
                      <div className="stepper">
                        <button onClick={() => setQty(card.id, -1)}>−</button>
                        <span className="val">{qty}</span>
                        <button onClick={() => setQty(card.id, 1)} disabled={qty >= deckCap(card)}>+</button>
                      </div>
                      <button className="db-card-name" onClick={() => onOpenModal?.(card)} title="View details">
                        {card.name}{isAlwaysFoil(card) && <span className="db-foil">✦</span>}
                      </button>
                      <span className={`db-own${short > 0 ? ' short' : ''}`}>
                        {short > 0 ? `need ${short}` : `✓ ${owned}`}
                      </span>
                      <span className="db-card-price">{price != null ? fmt$(price) : '—'}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {analysis.totalCards === 0 && (
              <div className="status-placeholder">Empty deck — search above to add cards.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Summary ── */}
      {active && (
        <aside className="db-summary">
          <div className="deck-stat-card" style={{
            borderColor: analysis.buildable ? 'var(--accent-line)' : 'var(--border-0)',
            background: analysis.buildable ? 'var(--accent-soft)' : 'var(--bg-1)',
          }}>
            <h3>Deck Status</h3>
            <div className="deck-buildable" style={{ color: analysis.buildable ? 'var(--ok)' : 'var(--warn)' }}>
              {analysis.totalCards === 0 ? 'Empty' : analysis.buildable ? 'Buildable' : 'Incomplete'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
              {analysis.totalCards} cards
              {analysis.shortCards > 0 && ` · ${analysis.shortCards} short`}
            </div>
          </div>

          <div className="deck-stat-card">
            <h3>Value</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>Deck value</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>
                {pricesLoading ? '…' : fmt$(analysis.deckValue)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
              <span style={{ color: 'var(--text-2)' }}>To complete</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: analysis.missingCost > 0 ? 'var(--warn)' : 'var(--ok)' }}>
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
                    <span style={{ color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>
                      {price != null ? fmt$(price * short) : '—'}
                    </span>
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
          </div>
        </aside>
      )}
    </div>
  );
}
