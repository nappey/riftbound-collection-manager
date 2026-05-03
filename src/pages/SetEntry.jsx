import { useMemo, useState } from 'react';
import { isAlwaysFoil, formatPlayset } from '../utils/playset';

const SET_LABELS = {
  OGN: 'Origins', OGS: 'Skirmish', SFD: 'Spiritforged', UNL: 'Unleashed',
  OPP: 'Nexus Night Promos', PR: 'Promotional Cards', JDG: 'Judge Promos', RWB: 'Worlds Bundle 2025',
};

function sortByEnergy(cards) {
  return [...cards].sort((a, b) => {
    const ea = a.attributes?.energy;
    const eb = b.attributes?.energy;
    if (ea == null && eb == null) return a.collector_number - b.collector_number;
    if (ea == null) return 1;
    if (eb == null) return -1;
    if (ea !== eb) return ea - eb;
    return a.collector_number - b.collector_number;
  });
}

// ── Config screen ──────────────────────────────────────────────

function ConfigScreen({ allCards, onStart }) {
  const sets = useMemo(() => {
    const seen = new Set();
    for (const c of allCards) { if (c.set?.set_id) seen.add(c.set.set_id); }
    return [...seen].sort();
  }, [allCards]);

  const [selectedSet, setSelectedSet] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');

  const domains = useMemo(() => {
    if (!selectedSet) return [];
    const seen = new Set();
    for (const c of allCards) {
      if (c.set?.set_id === selectedSet) {
        (c.classification?.domain ?? []).forEach(d => seen.add(d));
      }
    }
    return [...seen].sort();
  }, [allCards, selectedSet]);

  function handleStart() {
    if (!selectedSet || !selectedDomain) return;
    const cards = sortByEnergy(
      allCards.filter(c =>
        c.set?.set_id === selectedSet &&
        (c.classification?.domain ?? []).includes(selectedDomain) &&
        !c.metadata?.alternate_art // alts are handled under their base card
      )
    );
    onStart(cards, selectedSet, selectedDomain);
  }

  return (
    <div className="se-config">
      <h2 className="se-title">Set Entry Wizard</h2>
      <p className="se-hint">Step through cards one by one and log your collection.</p>

      <div className="se-config-row">
        <label className="se-label">Set</label>
        <select
          className="se-select"
          value={selectedSet}
          onChange={e => { setSelectedSet(e.target.value); setSelectedDomain(''); }}
        >
          <option value="">Choose a set…</option>
          {sets.map(s => (
            <option key={s} value={s}>{SET_LABELS[s] ?? s}</option>
          ))}
        </select>
      </div>

      <div className="se-config-row">
        <label className="se-label">Domain</label>
        <select
          className="se-select"
          value={selectedDomain}
          onChange={e => setSelectedDomain(e.target.value)}
          disabled={!selectedSet}
        >
          <option value="">Choose a domain…</option>
          {domains.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      <button
        className="se-start-btn"
        onClick={handleStart}
        disabled={!selectedSet || !selectedDomain}
      >
        Start →
      </button>
    </div>
  );
}

// ── Card entry screen ──────────────────────────────────────────

const RARITY_COLOR = {
  common: '#9090a8', uncommon: '#4ade80', rare: '#60a5fa',
  showcase: '#f59e0b', epic: '#f59e0b', promo: '#f472b6',
};

function CardEntryScreen({ cards, setLabel, domain, collection, foilCollection, onAdjust, onAdjustFoil, onDone }) {
  const [index, setIndex] = useState(0);

  const card    = cards[index];
  const alwaysFoil = isAlwaysFoil(card);
  const count   = collection[card.id] ?? 0;
  const foilCount = foilCollection[card.id] ?? 0;

  const rarity    = card.classification?.rarity?.toLowerCase() ?? '';
  const rarityColor = RARITY_COLOR[rarity] ?? '#9090a8';
  const type      = [card.classification?.supertype, card.classification?.type].filter(Boolean).join(' ');
  const energy    = card.attributes?.energy;
  const might     = card.attributes?.might;
  const power     = card.attributes?.power;
  const hasStats  = energy != null || might != null || power != null;

  function setCount(n) {
    const delta = n - count;
    if (delta !== 0) onAdjust(card.id, delta);
  }

  function setFoilCount(n) {
    const delta = n - foilCount;
    if (delta !== 0) onAdjustFoil(card.id, delta);
  }

  function go(dir) {
    const next = index + dir;
    if (next < 0 || next >= cards.length) return;
    setIndex(next);
  }

  const progress = `${index + 1} / ${cards.length}`;
  const effectiveCount = alwaysFoil ? foilCount : count;
  const ps = formatPlayset(effectiveCount);
  const foilPs = alwaysFoil ? null : formatPlayset(foilCount);

  return (
    <div className="se-entry">
      {/* Header */}
      <div className="se-entry-header">
        <button className="se-back-config-btn" onClick={onDone}>← Back to config</button>
        <div className="se-progress-info">
          <span className="se-set-label">{setLabel}</span>
          <span className="se-domain-label">{domain}</span>
          <span className="se-progress">{progress}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="se-progress-bar-wrap">
        <div className="se-progress-bar" style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
      </div>

      {/* Card */}
      <div className="se-card-wrap">
        <div className="se-card-img-col">
          {card.media?.image_url
            ? <img className="se-card-img" src={card.media.image_url} alt={card.name} />
            : <div className="se-card-img-placeholder">{card.name}</div>}
        </div>

        <div className="se-card-info-col">
          <div className="se-card-name">
            {card.name}
            {alwaysFoil && <span className="se-foil-tag">✦ Foil only</span>}
          </div>

          <div className="se-card-meta">
            <span>{type}</span>
            <span className="se-rarity" style={{ color: rarityColor }}>
              {card.classification?.rarity}
            </span>
          </div>

          {hasStats && (
            <div className="se-stats">
              {energy != null && <span className="se-stat"><span>E</span>{energy}</span>}
              {might  != null && <span className="se-stat"><span>M</span>{might}</span>}
              {power  != null && <span className="se-stat"><span>P</span>{power}</span>}
            </div>
          )}

          {/* ── Normal counter (non-foil cards only) ── */}
          {!alwaysFoil && (
            <div className="se-section">
              <div className="se-section-label">Playset (×3)?</div>
              <div className="se-playset-btns">
                <button
                  className={`se-yn-btn${count === 0 ? ' se-yn-active-no' : ''}`}
                  onClick={() => setCount(0)}
                >
                  No
                </button>
                <button
                  className={`se-yn-btn${count >= 3 ? ' se-yn-active-yes' : ''}`}
                  onClick={() => setCount(count >= 3 ? 0 : 3)}
                >
                  Yes
                </button>
              </div>
              {count === 0 ? null : count < 3 ? null : null}
              {/* Partial count row */}
              <div className="se-partial-row">
                <span className="se-partial-label">Have:</span>
                <div className="se-counter">
                  <button onClick={() => setCount(Math.max(0, count - 1))} disabled={count === 0}>−</button>
                  <span>{count}</span>
                  <button onClick={() => setCount(count + 1)}>+</button>
                </div>
                {ps && <span className="se-ps-label">{ps}</span>}
              </div>
            </div>
          )}

          {/* ── Foil counter ── */}
          <div className="se-section">
            <div className="se-section-label">
              {alwaysFoil ? 'How many?' : 'Foils?'}
            </div>
            <div className="se-counter se-foil-counter">
              <button onClick={() => setFoilCount(Math.max(0, foilCount - 1))} disabled={foilCount === 0}>−</button>
              <span>{foilCount}</span>
              <button onClick={() => setFoilCount(foilCount + 1)}>+</button>
            </div>
            {(alwaysFoil ? ps : foilPs) && (
              <span className="se-ps-label se-foil-ps">{alwaysFoil ? ps : foilPs}</span>
            )}
          </div>

          {/* ── Navigation ── */}
          <div className="se-nav">
            <button className="se-nav-btn" onClick={() => go(-1)} disabled={index === 0}>← Back</button>
            {index < cards.length - 1
              ? <button className="se-nav-btn se-nav-next" onClick={() => go(1)}>Next →</button>
              : <button className="se-nav-btn se-nav-done" onClick={onDone}>Done ✓</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────

export default function SetEntry({ allCards, collection, foilCollection, onAdjust, onAdjustFoil }) {
  const [session, setSession] = useState(null); // { cards, setId, domain }

  if (!session) {
    return (
      <ConfigScreen
        allCards={allCards}
        onStart={(cards, setId, domain) => setSession({ cards, setId, domain })}
      />
    );
  }

  return (
    <CardEntryScreen
      cards={session.cards}
      setLabel={SET_LABELS[session.setId] ?? session.setId}
      domain={session.domain}
      collection={collection}
      foilCollection={foilCollection}
      onAdjust={onAdjust}
      onAdjustFoil={onAdjustFoil}
      onDone={() => setSession(null)}
    />
  );
}
