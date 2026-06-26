import { useMemo, useState, useCallback } from 'react';
import { isSingleton, isAlwaysFoil } from '../utils/playset';
import { ownedTotal, unitPrice, fmt$ } from '../utils/analysis';

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
  main: {}, sideboard: {}, bench: {}, runes: {}, tags: {},
});

// Ensure a deck has all v2 fields, migrating an old { cards } deck if needed.
function normalizeDeck(deck, cardById) {
  const d = {
    legendId: null, championId: null, main: {}, sideboard: {}, bench: {}, runes: {}, tags: {},
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

  const cardById = useMemo(() => {
    const m = new Map();
    for (const c of allCards) m.set(c.id, c);
    return m;
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
    mutate(active.id, d => {
      const z = { ...d[zone] };
      // Enforce sideboard size limit on increments.
      if (zone === 'sideboard' && delta > 0 && sumQty(z) >= SIDEBOARD_MAX) return d;
      const next = Math.max(0, Math.min(cap, (z[cardId] ?? 0) + delta));
      if (next === 0) delete z[cardId]; else z[cardId] = next;
      const patch = { ...d, [zone]: z };
      // Dropping a champion from the main deck clears the chosen flag.
      if (zone === 'main' && next === 0 && d.championId === cardId) patch.championId = null;
      return patch;
    });
  }

  function moveCard(cardId, from, to) {
    mutate(active.id, d => {
      const card = cardById.get(cardId);
      const cap = card ? deckCap(card) : 3;
      const src = { ...d[from] };
      const dst = { ...d[to] };
      if (!src[cardId]) return d;
      if (to === 'sideboard' && sumQty(dst) >= SIDEBOARD_MAX) return d;
      src[cardId] -= 1; if (src[cardId] <= 0) delete src[cardId];
      dst[cardId] = Math.min(cap, (dst[cardId] ?? 0) + 1);
      return { ...d, [from]: src, [to]: dst };
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
      const patch = { ...d, legendId: card.id };
      // Prepopulate the rune deck from the legend's domains if untouched.
      if (sumQty(d.runes) === 0) patch.runes = prepopulateRunes(legendDomains(card));
      return patch;
    });
  }
  function clearLegend() { mutate(active.id, d => ({ ...d, legendId: null })); }

  function resetRunesFromLegend() {
    const legend = cardById.get(active.legendId);
    mutate(active.id, d => ({ ...d, runes: prepopulateRunes(legendDomains(legend)) }));
  }
  function adjustRune(domain, delta) {
    mutate(active.id, d => {
      const runes = { ...d.runes };
      const next = Math.max(0, (runes[domain] ?? 0) + delta);
      if (next === 0) delete runes[domain]; else runes[domain] = next;
      return { ...d, runes };
    });
  }

  function setChampion(cardId) {
    mutate(active.id, d => ({ ...d, championId: d.championId === cardId ? null : cardId }));
  }
  function setTag(cardId, label) {
    mutate(active.id, d => {
      const tags = { ...d.tags };
      if (!label || tags[cardId] === label) delete tags[cardId]; else tags[cardId] = label;
      return { ...d, tags };
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
  const champion = active?.championId ? cardById.get(active.championId) : null;

  async function copyDecklist() {
    if (!active || !analysis) return;
    let out = '';
    if (analysis.legend) out += `Legend:\n1 ${analysis.legend.name}\n\n`;
    if (active.championId) out += `Champion:\n1 ${cardById.get(active.championId)?.name ?? ''}\n\n`;
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

  // ── shared tile renderer (plain function, not a nested component) ──
  function renderTile(row, zone) {
    const { card, qty } = row;
    const short = Math.max(0, qty - (row.owned ?? ownedTotal(card, collection, foilCollection)));
    const isChamp = card.classification?.supertype === 'Champion';
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
          {isChamp && zone === 'main' && (
            <button
              className={`db-champ-star${chosen ? ' on' : ''}`}
              title={chosen ? 'Chosen champion' : 'Set as chosen champion'}
              onClick={(e) => { e.stopPropagation(); setChampion(card.id); }}
            >★</button>
          )}
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

                {/* Chosen Champion */}
                <div className="db-identity-slot">
                  <div className="db-identity-label">Chosen Champion</div>
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
                        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setChampion(champion.id)}>Clear</button>
                      </div>
                    </div>
                  ) : (
                    <div className="db-identity-empty">Star a <b>Champion</b> in the main deck to set your chosen champ.</div>
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
              <li className={active.championId ? 'ok' : 'bad'}>{active.championId ? '✓' : '○'} Chosen champion</li>
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
            {active.championId && (
              <div className="db-champ-line">Champion: <b>{cardById.get(active.championId)?.name}</b></div>
            )}
          </div>

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
          </div>
        </aside>
      )}
    </div>
  );
}
