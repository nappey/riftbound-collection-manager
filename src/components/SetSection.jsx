import { groupWithAlts } from '../utils/cardGroups';
import CardItem from './CardItem';

export function CardGrid({ groups, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT, promoByName = {}, promoShortLabels = {} }) {
  // Flatten groups: each base card + each alt becomes its own cell
  const cells = [];
  for (const { base, alts } of groups) {
    const promos = (promoByName[base.name.toLowerCase().trim()] ?? []).map(p => ({
      card: p,
      count: collection[p.id] ?? 0,
      foilCount: foilCollection[p.id] ?? 0,
      price: prices[p.tcgplayer_id] ?? null,
      label: promoShortLabels[p.set?.set_id] ?? 'Promo',
    }));
    cells.push({ card: base, promos, isAlt: false });
    for (const alt of alts) {
      cells.push({ card: alt, promos: [], isAlt: true });
    }
  }

  return (
    <div className="card-grid">
      {cells.map(({ card, promos, isAlt }) => (
        <CardItem
          key={card.id}
          card={card}
          isAlt={isAlt}
          count={collection[card.id] ?? 0}
          foilCount={foilCollection[card.id] ?? 0}
          price={prices[card.tcgplayer_id] ?? null}
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
      ))}
    </div>
  );
}

export default function SetSection({ promo, cards, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT, promoByName, promoShortLabels }) {
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
