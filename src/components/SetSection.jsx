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

  return (
    <div className={`set-section${promo ? ' set-section--promo' : ''}`}>
      {cardGroups.length > 0 ? (
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
      ) : (
        <div className="status-placeholder">No cards match your filters.</div>
      )}
    </div>
  );
}
