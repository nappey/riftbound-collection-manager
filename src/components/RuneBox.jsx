import { CardGrid } from './SetSection';
import { SET_LABELS } from '../utils/generateExport';

const SET_ORDER = ['OGN', 'OGS', 'SFD', 'UNL'];
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, showcase: 3, epic: 3, promo: 4 };

function groupRunesByName(cards) {
  const byName = {};
  for (const card of cards) {
    const key = card.name.toLowerCase().trim();
    (byName[key] = byName[key] || []).push(card);
  }
  return Object.values(byName).map(group => {
    group.sort((a, b) =>
      (RARITY_RANK[a.classification?.rarity?.toLowerCase()] ?? 0) -
      (RARITY_RANK[b.classification?.rarity?.toLowerCase()] ?? 0)
    );
    const [base, ...alts] = group;
    return { base, alts };
  });
}

export default function RuneBox({ allRuneCards, collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT }) {
  if (!allRuneCards.length) return null;

  const bySet = {};
  for (const card of allRuneCards) {
    const sid = card.set?.set_id ?? 'UNKNOWN';
    (bySet[sid] = bySet[sid] || []).push(card);
  }
  const setIds = [
    ...SET_ORDER.filter(s => bySet[s]),
    ...Object.keys(bySet).filter(s => !SET_ORDER.includes(s)),
  ];

  const ownedCount = allRuneCards.filter(c => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0).length;
  const setValue = !pricesLoading ? allRuneCards.reduce((sum, card) => {
    const p = prices[card.tcgplayer_id] ?? {};
    return sum + (collection[card.id] ?? 0) * (p.normal?.market ?? 0)
               + (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
  }, 0) : null;

  const gridProps = { collection, foilCollection, prices, pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor, upForTrade, onToggleLF, onToggleUFT };

  return (
    <div className="rune-box">
      <div className="rune-box-header">
        <h2 className="rune-box-title">Rune Box</h2>
        <span style={{fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)'}}>
          {ownedCount} / {allRuneCards.length}
          {setValue != null && setValue > 0 && <> · ${setValue.toFixed(2)}</>}
        </span>
      </div>
      <div className="rune-box-body">
        {setIds.map(sid => {
          const groups = groupRunesByName(bySet[sid]);
          return (
            <div key={sid} className="rune-box-set">
              <div className="rune-box-set-label">{SET_LABELS[sid] ?? sid}</div>
              <CardGrid groups={groups} {...gridProps} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
