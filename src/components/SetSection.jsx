import { groupWithAlts } from '../utils/cardGroups';
import CardItem from './CardItem';

export function CardGrid({ groups, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT, promoByName = {}, promoShortLabels = {} }) {
  return (
    <div className="card-grid">
      {groups.map(({ base, alts }) => {
        const promos = (promoByName[base.name.toLowerCase().trim()] ?? []).map(p => ({
          card: p,
          count: collection[p.id] ?? 0,
          foilCount: foilCollection[p.id] ?? 0,
          price: prices[p.tcgplayer_id] ?? null,
          label: promoShortLabels[p.set?.set_id] ?? 'Promo',
        }));
        return (
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
            promos={promos}
            pricesLoading={pricesLoading}
            onAdjust={onAdjust}
            onAdjustFoil={onAdjustFoil}
            onOpenModal={onOpenModal}
            lookingFor={lookingFor}
            upForTrade={upForTrade}
            onToggleLF={onToggleLF}
            onToggleUFT={onToggleUFT}
          />
        );
      })}
    </div>
  );
}

export default function SetSection({ setName, promo, cards, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT, promoByName, promoShortLabels }) {
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
          promoByName={promoByName}
          promoShortLabels={promoShortLabels}
        />
      )}
    </div>
  );
}
