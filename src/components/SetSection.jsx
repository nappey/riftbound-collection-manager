import { useState } from 'react';
import CardItem from './CardItem';

function groupWithAlts(cards) {
  const altsByBase = {};
  const bases = [];

  for (const card of cards) {
    if (card.metadata?.alternate_art) {
      const baseKey = (card.metadata.clean_name ?? card.name)
        .toLowerCase()
        .replace(/\s*alternate\s*art\s*/gi, '')
        .trim();
      (altsByBase[baseKey] = altsByBase[baseKey] || []).push(card);
    } else {
      bases.push(card);
    }
  }

  const matchedAltIds = new Set();
  const groups = bases.map((base) => {
    const key = (base.metadata?.clean_name ?? base.name).toLowerCase().trim();
    const alts = altsByBase[key] ?? [];
    alts.forEach((a) => matchedAltIds.add(a.id));
    return { base, alts };
  });

  for (const alts of Object.values(altsByBase)) {
    for (const alt of alts) {
      if (!matchedAltIds.has(alt.id)) groups.push({ base: alt, alts: [] });
    }
  }

  return groups;
}

function CardGrid({ groups, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal }) {
  return (
    <div className="card-grid">
      {groups.map(({ base, alts }) => (
        <CardItem
          key={base.id}
          card={base}
          count={collection[base.id] ?? 0}
          foilCount={foilCollection[base.id] ?? 0}
          price={prices[base.tcgplayer_id] ?? null}
          alts={alts.map((a) => ({
            card: a,
            count: collection[a.id] ?? 0,
            foilCount: foilCollection[a.id] ?? 0,
            price: prices[a.tcgplayer_id] ?? null,
          }))}
          pricesLoading={pricesLoading}
          onAdjust={onAdjust}
          onAdjustFoil={onAdjustFoil}
          onOpenModal={onOpenModal}
        />
      ))}
    </div>
  );
}

export default function SetSection({ setName, promo, cards, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal }) {
  const [open, setOpen] = useState(true);
  const [runesOpen, setRunesOpen] = useState(true);

  const runes = cards.filter((c) => c.classification?.type === 'Rune');
  const nonRunes = cards.filter((c) => c.classification?.type !== 'Rune');

  const cardGroups = groupWithAlts(nonRunes);
  const runeGroups = groupWithAlts(runes);

  const ownedCount = cards.filter((c) => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0).length;
  const setValue = cards.reduce((sum, card) => {
    const p = prices[card.tcgplayer_id] ?? {};
    const normalVal = (collection[card.id] ?? 0) * (p.normal?.market ?? 0);
    const foilVal = (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
    return sum + normalVal + foilVal;
  }, 0);
  const pct = cards.length ? Math.round((ownedCount / cards.length) * 100) : 0;

  return (
    <div className={`set-section${promo ? ' set-section--promo' : ''}`}>
      <div className="set-header" onClick={() => setOpen((o) => !o)}>
        <h2>{setName}</h2>
        {promo && <span className="set-promo-badge">Promo</span>}
        <div className="set-progress-wrap" title={`${pct}% owned`}>
          <div className="set-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <span className="set-summary">
          {ownedCount} / {cards.length}
          {!pricesLoading && setValue > 0 && <> &middot; ${setValue.toFixed(2)}</>}
        </span>
        <span className={`set-chevron${open ? ' open' : ''}`}>▼</span>
      </div>

      {open && (
        <>
          {cardGroups.length > 0 && (
            <CardGrid
              groups={cardGroups}
              collection={collection}
              foilCollection={foilCollection}
              prices={prices}
              pricesLoading={pricesLoading}
              onAdjust={onAdjust}
              onAdjustFoil={onAdjustFoil}
              onOpenModal={onOpenModal}
            />
          )}

          {runeGroups.length > 0 && (
            <div className="rune-section">
              <div className="rune-header" onClick={() => setRunesOpen((o) => !o)}>
                <span className="rune-title">Rune Deck</span>
                <span className="rune-count">{runeGroups.length} runes</span>
                <span className={`set-chevron${runesOpen ? ' open' : ''}`}>▼</span>
              </div>
              {runesOpen && (
                <CardGrid
                  groups={runeGroups}
                  collection={collection}
                  foilCollection={foilCollection}
                  prices={prices}
                  pricesLoading={pricesLoading}
                  onAdjust={onAdjust}
                  onAdjustFoil={onAdjustFoil}
                  onOpenModal={onOpenModal}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
