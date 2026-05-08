import { groupWithAlts } from '../utils/cardGroups';
import CardItem from './CardItem';

export function CardGrid({ groups, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT }) {
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
          lookingFor={lookingFor[base.id] ?? false}
          upForTrade={upForTrade[base.id] ?? false}
          onToggleLF={onToggleLF}
          onToggleUFT={onToggleUFT}
        />
      ))}
    </div>
  );
}

export default function SetSection({ setName, promo, cards, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT }) {
  const nonRunes = cards.filter((c) => c.classification?.type !== 'Rune');
  const cardGroups = groupWithAlts(nonRunes);

  const ownedCount = cards.filter((c) => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0).length;
  const setValue = cards.reduce((sum, card) => {
    const p = prices[card.tcgplayer_id] ?? {};
    return sum + (collection[card.id] ?? 0) * (p.normal?.market ?? 0)
               + (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
  }, 0);
  const pct = cards.length ? Math.round((ownedCount / cards.length) * 100) : 0;

  return (
    <div className={`set-section${promo ? ' set-section--promo' : ''}`}>
      <div className="set-section-summary">
        <div className="set-progress-wrap" title={`${pct}% owned`}>
          <div className="set-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <span className="set-summary">
          {ownedCount} / {cards.length}
          {!pricesLoading && setValue > 0 && <> · ${setValue.toFixed(2)}</>}
        </span>
      </div>
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
          lookingFor={lookingFor}
          upForTrade={upForTrade}
          onToggleLF={onToggleLF}
          onToggleUFT={onToggleUFT}
        />
      )}
    </div>
  );
}
