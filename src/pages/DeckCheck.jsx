import { useMemo, useState } from 'react';
import { parseDeckList, buildNameMap, matchDeckList, SECTION_ORDER } from '../utils/parseDeckList';

const SECTION_LABELS = {
  Legend:      'Legend',
  Champion:    'Champion',
  MainDeck:    'Main Deck',
  Battlefields:'Battlefields',
  Runes:       'Rune Deck',
  Sideboard:   'Sideboard',
};

const PLACEHOLDER = `Legend:
1 Pyke, Bloodharbor Ripper

Champion:
1 Pyke, Returned

MainDeck:
3 Sneaky Deckhand
3 Tideturner
3 Bewitching Spirit
2 Abandon
2 Gust

Battlefields:
1 The Arena's Greatest
1 Hall of Legends
1 Ripper's Bay

Runes:
6 Fury Rune
6 Chaos Rune

Sideboard:
2 Brynhir Thundersong
2 Downwell`;

export default function DeckCheck({ allCards, collection }) {
  const [input, setInput] = useState('');

  const nameMap = useMemo(() => buildNameMap(allCards), [allCards]);

  const matched = useMemo(() => {
    if (!input.trim()) return null;
    const sections = parseDeckList(input);
    return matchDeckList(sections, nameMap);
  }, [input, nameMap]);

  const summary = useMemo(() => {
    if (!matched) return null;
    let have = 0, short = 0, missing = 0, unknown = 0, count = 0, unique = 0;
    for (const entries of Object.values(matched)) {
      for (const { quantity, card } of entries) {
        unique++;
        count += quantity;
        if (!card) { unknown += quantity; continue; }
        const h = collection[card.id] ?? 0;
        if (h >= quantity) have += quantity;
        else if (h > 0) { have += h; short += (quantity - h); }
        else missing += quantity;
      }
    }
    return {
      have, short, missing, unknown, count, unique,
      buildable: short === 0 && missing === 0 && unknown === 0,
    };
  }, [matched, collection]);

  const sectionIds = matched ? [
    ...SECTION_ORDER.filter(s => matched[s]?.length),
    ...Object.keys(matched).filter(s => !SECTION_ORDER.includes(s) && matched[s]?.length),
  ] : [];

  return (
    <div className="deck-check-wrap">
      {/* Left: input + parsed sections */}
      <div>
        <div className="deck-input-panel">
          <div className="deck-input-head">
            <span>Decklist</span>
            <span className="deck-meta-text">
              {summary ? `${summary.count} cards · ${summary.unique} unique` : 'Empty'}
            </span>
          </div>
          <textarea
            className="deck-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
          />
          <div className="deck-btns">
            <button className="btn" onClick={() => setInput('')}>Clear</button>
          </div>
        </div>

        {matched && sectionIds.map(sec => (
          <div key={sec} className="dc-section">
            <div className="dc-section-head">
              <span className="dc-section-title">{SECTION_LABELS[sec] ?? sec}</span>
              <span className="dc-section-count">{matched[sec].reduce((n, e) => n + e.quantity, 0)} cards</span>
            </div>
            {matched[sec].map(({ name, quantity, card }, i) => {
              const have = card ? (collection[card.id] ?? 0) : 0;
              const rowClass = !card ? 'unknown' : have >= quantity ? 'have' : have > 0 ? 'short' : 'miss';
              return (
                <div key={i} className={`deck-card-row ${rowClass}`}>
                  <span className="qty">{quantity}×</span>
                  <span className="name">{name}{!card && <span style={{color: 'var(--text-3)', fontSize: 11}}> — unknown</span>}</span>
                  <span className="have-count">{card ? `have ${have}` : '—'}</span>
                  <span className="status-tag">
                    {rowClass === 'have' ? `✓ ${have}` : rowClass === 'short' ? `⚠ ${have}/${quantity}` : rowClass === 'miss' ? '✗ Missing' : '? Unknown'}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Right: summary */}
      <div className="deck-summary">
        {summary && (
          <>
            <div className="deck-stat-card" style={{
              borderColor: summary.buildable ? 'oklch(0.74 0.14 155 / 0.4)' : 'var(--border-0)',
              background: summary.buildable ? 'oklch(0.74 0.14 155 / 0.06)' : 'var(--bg-1)',
            }}>
              <h3>Deck Status</h3>
              <div className="deck-buildable" style={{color: summary.buildable ? 'var(--ok)' : 'var(--warn)'}}>
                {summary.buildable ? 'Buildable' : 'Incomplete'}
              </div>
              <div style={{fontSize: 12, color: 'var(--text-2)', marginTop: 6}}>
                {summary.buildable
                  ? 'Every card is owned in the required quantity.'
                  : `${summary.short + summary.missing} card${(summary.short + summary.missing) !== 1 ? 's' : ''} short · ${summary.unknown} unknown.`}
              </div>
            </div>

            <div className="deck-stat-card">
              <h3>What's needed</h3>
              <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                {Object.values(matched).flat()
                  .filter(({card, quantity}) => card && (collection[card.id] ?? 0) < quantity)
                  .map(({name, quantity, card}, i) => (
                    <div key={i} className="deck-needed-row">
                      <span style={{color: 'var(--text-1)'}}>{name}</span>
                      <span style={{color: 'var(--warn)', fontFamily: 'var(--font-mono)'}}>
                        +{quantity - (collection[card.id] ?? 0)}
                      </span>
                    </div>
                  ))}
                {Object.values(matched).flat().filter(({card}) => !card).map(({name}, i) => (
                  <div key={'u' + i} className="deck-needed-row">
                    <span style={{color: 'var(--text-2)'}}>{name}</span>
                    <span style={{color: 'var(--miss)', fontFamily: 'var(--font-mono)', fontSize: 10.5}}>UNKNOWN</span>
                  </div>
                ))}
                {Object.values(matched).flat().filter(({card, quantity}) => card && (collection[card.id] ?? 0) >= quantity).length === Object.values(matched).flat().filter(({card}) => card).length && (
                  <div style={{fontSize: 12, color: 'var(--text-3)'}}>Nothing — all set.</div>
                )}
              </div>
            </div>

            <div className="deck-stat-card">
              <h3>Quick actions</h3>
              <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                <button className="btn" style={{justifyContent: 'flex-start'}}>Copy missing list</button>
              </div>
            </div>
          </>
        )}
        {!matched && (
          <div className="deck-stat-card">
            <h3>Instructions</h3>
            <div style={{fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6}}>
              Paste a deck list on the left. Use section headers like <code style={{fontFamily: 'var(--font-mono)', color: 'var(--accent)'}}>Legend:</code>, <code style={{fontFamily: 'var(--font-mono)', color: 'var(--accent)'}}>Champion:</code>, <code style={{fontFamily: 'var(--font-mono)', color: 'var(--accent)'}}>MainDeck:</code> followed by lines like <code style={{fontFamily: 'var(--font-mono)', color: 'var(--accent)'}}>3 Card Name</code>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
