import { useEffect, useMemo, useState } from 'react';
import { isAlwaysFoil, isSingleton, isBattlefield } from '../utils/playset';

const SET_LABELS = {
  OGN: 'Origins', OGS: 'Proving Grounds', SFD: 'Spiritforged', UNL: 'Unleashed',
  OPP: 'Organized Play Promos', PR: 'Promotional Cards', JDG: 'Judge Promos', RWB: 'Worlds Bundle 2025',
};

const Sparkle = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 3l1.5 5L18 9.5 13.5 11 12 16l-1.5-5L6 9.5 10.5 8z"/>
  </svg>
);
const ArrowRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5 12h14M13 5l7 7-7 7"/>
  </svg>
);
const ArrowLeft = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M19 12H5M11 5l-7 7 7 7"/>
  </svg>
);
const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

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
  const [selectedSet, setSelectedSet] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');

  const sets = useMemo(() => {
    const seen = new Set();
    for (const c of allCards) {
      if (c.set?.set_id && c.classification?.type !== 'Rune') seen.add(c.set.set_id);
    }
    return [...seen].sort();
  }, [allCards]);

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

  const cardCount = useMemo(() => {
    if (!selectedSet || !selectedDomain) return 0;
    return allCards.filter(c =>
      c.set?.set_id === selectedSet &&
      (c.classification?.domain ?? []).includes(selectedDomain) &&
      !c.metadata?.alternate_art
    ).length;
  }, [allCards, selectedSet, selectedDomain]);

  function handleStart() {
    if (!selectedSet || !selectedDomain) return;
    const cards = sortByEnergy(
      allCards.filter(c =>
        c.set?.set_id === selectedSet &&
        (c.classification?.domain ?? []).includes(selectedDomain) &&
        !c.metadata?.alternate_art
      )
    );
    onStart(cards, selectedSet, selectedDomain);
  }

  return (
    <div className="se-config">
      <div className="se-config-head">
        <h2>Set Entry Wizard</h2>
        <p>Step through cards one set &amp; domain at a time. Keyboard-first.</p>
      </div>
      <div className="se-config-form">
        <div className="se-config-field">
          <label>Set</label>
          <div className="chip-list">
            {sets.map(s => (
              <button
                key={s}
                className={`chip${selectedSet === s ? ' active' : ''}`}
                onClick={() => { setSelectedSet(s); setSelectedDomain(''); }}
              >{SET_LABELS[s] ?? s}</button>
            ))}
          </div>
        </div>
        <div className="se-config-field">
          <label>
            Domain
            {!selectedSet && <span className="se-config-dim">(choose a set first)</span>}
          </label>
          <div className="chip-list">
            {domains.map(d => (
              <button
                key={d}
                className={`chip${selectedDomain === d ? ' active' : ''}`}
                onClick={() => setSelectedDomain(d)}
              >
                <span className="chip-dot" style={{'--c': `var(--d-${d.toLowerCase()})`}}></span>
                {d}
              </button>
            ))}
            {!selectedSet && <span style={{fontSize: 12, color: 'var(--text-3)', padding: '4px 8px'}}>—</span>}
          </div>
        </div>
        <div className="se-config-summary">
          <span style={{color: 'var(--text-2)', fontSize: 13}}>
            {cardCount > 0 ? `${cardCount} cards in this slice` : 'Select a set and domain'}
          </span>
          <button
            className="btn-primary"
            onClick={handleStart}
            disabled={!selectedSet || !selectedDomain}
          >
            Start <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card entry screen ──────────────────────────────────────────

const RARITY_CLASS = { epic: 'epic', rare: 'rare', showcase: 'showcase' };

function CardEntryScreen({ cards, setLabel, domain, collection, foilCollection, onAdjust, onAdjustFoil, onDone, promoByName = {}, promoShortLabels = {} }) {
  const [index, setIndex] = useState(0);

  const card        = cards[index];
  const alwaysFoil  = isAlwaysFoil(card);
  const singleton   = isSingleton(card);
  const battlefield = isBattlefield(card);
  const count       = collection[card.id] ?? 0;
  const foilCount   = foilCollection[card.id] ?? 0;
  const combined    = alwaysFoil ? foilCount : count + foilCount;

  const cardPromos = (promoByName[card.name.toLowerCase().trim()] ?? []).map(p => ({
    card: p,
    label: promoShortLabels[p.set?.set_id] ?? 'Promo',
    alwaysFoil: isAlwaysFoil(p),
    count: collection[p.id] ?? 0,
    foilCount: foilCollection[p.id] ?? 0,
  }));

  const rarity = (card.classification?.rarity ?? '').toLowerCase();
  const type = [card.classification?.supertype, card.classification?.type].filter(Boolean).join(' ');
  const imgSrc = card.media?.image_url ?? null;

  function setCount(n) {
    const delta = n - count;
    if (delta !== 0) onAdjust(card.id, delta);
  }
  function setFoilCount(n) {
    const delta = n - foilCount;
    if (delta !== 0) onAdjustFoil(card.id, delta);
  }

  const next = () => setIndex(i => Math.min(cards.length - 1, i + 1));
  const prev = () => setIndex(i => Math.max(0, i - 1));

  useEffect(() => {
    function handler(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'y' || e.key === 'Y') {
        if (singleton) setCount(1);
        else setCount(Math.max(3, count));
      }
      else if (e.key === 'n' || e.key === 'N') { setCount(0); setFoilCount(0); }
      else if (e.key >= '0' && e.key <= '9') setCount(parseInt(e.key));
      else if (e.key === 'f' || e.key === 'F') setFoilCount(Math.min(3, foilCount + 1));
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [card, index, count, foilCount]);

  const psBadge = combined >= 3
    ? `Playset${combined > 3 ? ` +${combined - 3}` : ''}`
    : combined > 0 ? `${combined}/3` : null;
  const foilBadge = !alwaysFoil && foilCount > 0
    ? foilCount >= 3 ? `Foil playset${foilCount > 3 ? ` +${foilCount - 3}` : ''}` : `${foilCount}/3 foil`
    : null;

  return (
    <div className="entry-wrap">
      {/* Left: card image */}
      <div className="entry-card">
        <div className="entry-art-wrap">
          {imgSrc
            ? <img src={imgSrc} alt={card.name} />
            : <div className="entry-art-placeholder">[{type} · {card.id?.toUpperCase()}]</div>
          }
        </div>
        <div className="entry-meta-row">
          <span style={{fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontSize: 11}}>{card.id?.toUpperCase()}</span>
          <span style={{color: `var(--d-${(card.classification?.domain?.[0] ?? '').toLowerCase()})`, fontSize: 12}}>
            {card.classification?.domain?.[0]}
          </span>
        </div>
      </div>

      {/* Right: detail */}
      <div className="entry-detail">
        <div className="entry-progress-row">
          <button className="btn ghost" style={{fontSize: 11}} onClick={onDone}>
            <ArrowLeft /> Back
          </button>
          <span className="se-pill set-pill">{setLabel}</span>
          <span className="se-pill">
            <span className="dot" style={{'--c': `var(--d-${domain.toLowerCase()})`}}></span>
            {domain}
          </span>
          <div className="entry-progress-bar" style={{flex: 1}}>
            <div className="fill" style={{width: `${((index + 1) / cards.length) * 100}%`}}></div>
          </div>
          <span className="entry-pos">{index + 1} / {cards.length}</span>
        </div>

        <div className="entry-head">
          <h1 className="entry-title">
            {card.name}
            {RARITY_CLASS[rarity] && (
              <span className={`rarity-tag ${RARITY_CLASS[rarity]}`}>{card.classification?.rarity}</span>
            )}
            {alwaysFoil && (
              <span className="foil-only-tag"><Sparkle /> Foil only</span>
            )}
          </h1>
          <div className="se-stat-tiles">
            {card.attributes?.energy != null && (
              <div className="se-stat-tile">
                <span className="se-lbl">Energy</span>
                <span className="se-val">{card.attributes.energy}</span>
              </div>
            )}
            {card.attributes?.power != null && (
              <div className="se-stat-tile">
                <span className="se-lbl">Power</span>
                <span className="se-val">{card.attributes.power}</span>
              </div>
            )}
          </div>
        </div>

        {/* Singleton (Legend / Battlefield) */}
        {singleton && (
          <div className="entry-question">
            <div className="q-head">
              <div className="q-label">Have it?</div>
              <div className={`yn${battlefield ? ' three' : ''}`}>
                <button
                  className={`no${count === 0 && foilCount === 0 ? ' active' : ''}`}
                  onClick={() => { setCount(0); setFoilCount(0); }}
                >No</button>
                <button
                  className={`yes${count > 0 ? ' active' : ''}`}
                  onClick={() => setCount(count > 0 ? 0 : 1)}
                >Normal</button>
                {battlefield && (
                  <button
                    className={`yes${foilCount > 0 ? ' active' : ''}`}
                    onClick={() => setFoilCount(foilCount > 0 ? 0 : 1)}
                  ><Sparkle /> Foil</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Normal counter */}
        {!singleton && !alwaysFoil && (
          <div className="entry-question">
            <div className="q-head">
              <div className="q-label">
                Playset? <span className="q-sub">(×3)</span>
              </div>
              <div className="yn">
                <button className={`no${count === 0 ? ' active' : ''}`} onClick={() => setCount(0)}>
                  No <span className="key">N</span>
                </button>
                <button className={`yes${combined >= 3 ? ' active' : ''}`} onClick={() => setCount(Math.max(0, 3 - foilCount))}>
                  Yes <span className="key">Y</span>
                </button>
              </div>
            </div>
            <div className="se-partial-row">
              <span className="se-partial-label">Have:</span>
              <div className="stepper-big">
                <button onClick={() => setCount(Math.max(0, count - 1))} disabled={count === 0}>−</button>
                <span className="val">{count}</span>
                <button onClick={() => setCount(count + 1)}>+</button>
              </div>
              {psBadge && <span className="se-ps-badge">{psBadge}</span>}
            </div>
          </div>
        )}

        {/* Foil counter */}
        {!singleton && (
          <div className="entry-question foil-q">
            <div className="q-head">
              <div className="q-label">
                <Sparkle /> {alwaysFoil ? `Playset? (×3)` : 'Foils?'}
              </div>
              {alwaysFoil && (
                <div className="yn">
                  <button className={`no${foilCount === 0 ? ' active' : ''}`} onClick={() => setFoilCount(0)}>No</button>
                  <button className={`yes${foilCount >= 3 ? ' active' : ''}`} onClick={() => setFoilCount(3)}>
                    Yes <span className="key">F</span>
                  </button>
                </div>
              )}
            </div>
            <div className="se-partial-row">
              <span className="se-partial-label">{alwaysFoil ? 'Have:' : <Sparkle />}</span>
              <div className="stepper-big foil">
                <button onClick={() => setFoilCount(Math.max(0, foilCount - 1))} disabled={foilCount === 0}>−</button>
                <span className="val">{foilCount}</span>
                <button onClick={() => setFoilCount(foilCount + 1)}>+</button>
              </div>
              {(alwaysFoil ? psBadge : foilBadge) && (
                <span className="se-ps-badge foil">{alwaysFoil ? psBadge : foilBadge}</span>
              )}
            </div>
          </div>
        )}

        {/* Promo variants */}
        {cardPromos.map(({ card: p, label, alwaysFoil: pFoil, count: pCount, foilCount: pFoilCount }) => {
          const pCombined = pFoil ? pFoilCount : pCount + pFoilCount;
          function setPC(n) { const d = n - pCount; if (d) onAdjust(p.id, d); }
          function setPFC(n) { const d = n - pFoilCount; if (d) onAdjustFoil(p.id, d); }
          return (
            <div key={p.id} className="entry-question promo-q">
              <div className="q-head">
                <div className="q-label promo-label">{label}{pFoil ? <> <Sparkle /></> : ''} variant</div>
                <div className="yn">
                  <button className={`no${pCombined === 0 ? ' active' : ''}`} onClick={() => { setPC(0); setPFC(0); }}>No</button>
                  <button className={`yes${pCombined >= 3 ? ' active' : ''}`} onClick={() => pFoil ? setPFC(3) : setPC(Math.max(0, 3 - pFoilCount))}>Yes</button>
                </div>
              </div>
              <div className="se-partial-row">
                <span className="se-partial-label">Have:</span>
                <div className={`stepper-big${pFoil ? ' foil' : ''}`}>
                  <button onClick={() => pFoil ? setPFC(Math.max(0, pFoilCount - 1)) : setPC(Math.max(0, pCount - 1))} disabled={pFoil ? pFoilCount === 0 : pCount === 0}>−</button>
                  <span className="val">{pFoil ? pFoilCount : pCount}</span>
                  <button onClick={() => pFoil ? setPFC(pFoilCount + 1) : setPC(pCount + 1)}>+</button>
                </div>
                {!pFoil && (
                  <>
                    <span className="se-partial-label" style={{marginLeft: 4}}><Sparkle /></span>
                    <div className="stepper-big foil">
                      <button onClick={() => setPFC(Math.max(0, pFoilCount - 1))} disabled={pFoilCount === 0}>−</button>
                      <span className="val">{pFoilCount}</span>
                      <button onClick={() => setPFC(pFoilCount + 1)}>+</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <div className="entry-foot">
          <div className="kbd-hints">
            <span><kbd>Y</kbd>Yes</span>
            <span><kbd>N</kbd>No</span>
            <span><kbd>0</kbd>–<kbd>9</kbd>Count</span>
            <span><kbd>F</kbd>Foil+1</span>
            <span><kbd>←</kbd><kbd>→</kbd>Nav</span>
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <button className="btn" onClick={prev} disabled={index === 0}><ArrowLeft /> Back</button>
            {index < cards.length - 1
              ? <button className="btn-primary" onClick={next}>Next <ArrowRight /></button>
              : <button className="btn-primary" onClick={onDone} style={{background: 'var(--ok)'}}>
                  <Check /> Done
                </button>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────

export default function SetEntry({ allCards, collection, foilCollection, onAdjust, onAdjustFoil, promoByName = {}, promoShortLabels = {} }) {
  const [session, setSession] = useState(null);

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
      promoByName={promoByName}
      promoShortLabels={promoShortLabels}
    />
  );
}
