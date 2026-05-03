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

function StatusBadge({ have, need }) {
  if (have >= need) return <span className="dc-badge dc-badge--ok">✓ Have {have}</span>;
  if (have > 0)     return <span className="dc-badge dc-badge--partial">⚠ Have {have} / {need}</span>;
  return              <span className="dc-badge dc-badge--missing">✗ Missing</span>;
}

export default function DeckCheck({ allCards, collection }) {
  const [input, setInput] = useState('');

  const nameMap = useMemo(() => buildNameMap(allCards), [allCards]);

  const matched = useMemo(() => {
    if (!input.trim()) return null;
    const sections = parseDeckList(input);
    return matchDeckList(sections, nameMap);
  }, [input, nameMap]);

  // Summary stats
  const summary = useMemo(() => {
    if (!matched) return null;
    let totalNeeded = 0, totalMissing = 0, unknownCards = 0;
    for (const entries of Object.values(matched)) {
      for (const { quantity, card } of entries) {
        if (!card) { unknownCards++; continue; }
        const have = collection[card.id] ?? 0;
        totalNeeded++;
        if (have < quantity) totalMissing++;
      }
    }
    return { totalNeeded, totalMissing, unknownCards, canBuild: totalMissing === 0 && unknownCards === 0 };
  }, [matched, collection]);

  const sectionIds = matched
    ? [
        ...SECTION_ORDER.filter(s => matched[s]),
        ...Object.keys(matched).filter(s => !SECTION_ORDER.includes(s)),
      ]
    : [];

  return (
    <div className="dc-wrap">
      <div className="dc-input-col">
        <h2 className="dc-heading">Deck Check</h2>
        <p className="dc-hint">Paste a deck list to check it against your collection.</p>
        <textarea
          className="dc-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
        />
        {input.trim() && (
          <button className="dc-clear-btn" onClick={() => setInput('')}>Clear</button>
        )}
      </div>

      <div className="dc-results-col">
        {!matched && (
          <div className="dc-empty">Paste a deck list on the left to get started.</div>
        )}

        {summary && (
          <div className={`dc-summary ${summary.canBuild ? 'dc-summary--ok' : 'dc-summary--missing'}`}>
            {summary.canBuild
              ? '✓ You have all the cards to build this deck!'
              : `✗ Missing copies of ${summary.totalMissing} card${summary.totalMissing !== 1 ? 's' : ''}${summary.unknownCards > 0 ? ` · ${summary.unknownCards} unrecognized` : ''}`}
          </div>
        )}

        {sectionIds.map((section) => (
          <div key={section} className="dc-section">
            <div className="dc-section-header">
              <span className="dc-section-title">{SECTION_LABELS[section] ?? section}</span>
              <span className="dc-section-count">
                {matched[section].reduce((n, e) => n + e.quantity, 0)} cards
              </span>
            </div>
            <div className="dc-card-list">
              {matched[section].map(({ name, quantity, card }, i) => {
                const have = card ? (collection[card.id] ?? 0) : 0;
                const ok = card && have >= quantity;
                return (
                  <div key={i} className={`dc-card-row ${ok ? 'dc-card-row--ok' : card ? 'dc-card-row--short' : 'dc-card-row--unknown'}`}>
                    <span className="dc-card-qty">×{quantity}</span>
                    <span className="dc-card-name">
                      {card?.media?.image_url && (
                        <img
                          className="dc-card-thumb"
                          src={card.media.image_url}
                          alt=""
                          loading="lazy"
                        />
                      )}
                      {name}
                      {!card && <span className="dc-unknown-label"> — not found</span>}
                    </span>
                    <StatusBadge have={have} need={quantity} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
