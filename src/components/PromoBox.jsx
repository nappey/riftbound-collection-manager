import { CardGrid } from './SetSection';
import { groupWithAlts } from '../utils/cardGroups';

// Browsable home for promo-set cards (Nexus Night, Judge, regional/launch
// promos, "Metal" legends, etc.) — many of these don't match a base card by
// name, so without this section they have nowhere to be tracked.
const PROMO_SET_ORDER = ['OPP', 'JDG', 'PR', 'RWB'];
const PROMO_SET_LABELS = {
  OPP: 'Organized Play Promos', JDG: 'Judge Promos',
  PR: 'Promotional Cards', RWB: 'Worlds Bundle 2025',
};

export default function PromoBox({
  allPromoCards, collection, foilCollection, prices, pricesLoading,
  onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT,
}) {
  if (!allPromoCards.length) return <div className="status-placeholder">No promo cards found.</div>;

  const bySet = {};
  for (const card of allPromoCards) {
    const sid = card.set?.set_id ?? 'UNKNOWN';
    (bySet[sid] = bySet[sid] || []).push(card);
  }
  const setIds = [
    ...PROMO_SET_ORDER.filter(s => bySet[s]),
    ...Object.keys(bySet).filter(s => !PROMO_SET_ORDER.includes(s)),
  ];

  const ownedCount = allPromoCards.filter(c => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0).length;

  const gridProps = {
    collection, foilCollection, prices, pricesLoading,
    onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT,
  };

  return (
    <div className="rune-box">
      <div className="rune-box-header">
        <h2 className="rune-box-title">Promos</h2>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
          {ownedCount} / {allPromoCards.length}
        </span>
      </div>
      <div className="rune-box-body">
        {setIds.map(sid => {
          const groups = groupWithAlts(bySet[sid]);
          const owned = bySet[sid].filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
          return (
            <div key={sid} className="rune-box-set">
              <div className="rune-box-set-label">
                {PROMO_SET_LABELS[sid] ?? sid}
                <span style={{ marginLeft: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
                  {owned}/{bySet[sid].length}
                </span>
              </div>
              <CardGrid groups={groups} {...gridProps} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
