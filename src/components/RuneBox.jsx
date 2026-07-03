import CardItem from './CardItem';

// Short label shown on each rune printing so the different arts are obvious.
const PRINTING_SHORT = {
  OPP: 'OP Promo', OPR: 'OP Promo', OGN: 'Origins', OGS: 'Proving Grounds', SFD: 'Spiritforged',
  UNL: 'Unleashed', PR: 'Promo', JDG: 'Judge', RWB: 'Worlds',
};
function printingLabel(card) {
  if (card.metadata?.alternate_art) return 'Showcase';
  return PRINTING_SHORT[card.set?.set_id] ?? card.set?.set_id ?? '';
}

// Base rune name with any "(Alternate Art)" suffix stripped, so all printings
// of e.g. "Fury Rune" group together regardless of set or art.
function baseRuneName(card) {
  return (card.metadata?.clean_name ?? card.name)
    .toLowerCase()
    .replace(/\s*alternate\s*art\s*/gi, '')
    .replace(/\s*\(alternate art\)\s*/gi, '')
    .trim();
}

const PRINT_RANK = { common: 0, uncommon: 1, rare: 2, showcase: 3, epic: 3, promo: 4 };

function groupRunes(cards) {
  const byBase = {};
  for (const c of cards) {
    const key = baseRuneName(c);
    (byBase[key] = byBase[key] || []).push(c);
  }
  return Object.values(byBase)
    .map((group) => {
      group.sort((a, b) =>
        (PRINT_RANK[a.classification?.rarity?.toLowerCase()] ?? 0) -
        (PRINT_RANK[b.classification?.rarity?.toLowerCase()] ?? 0));
      const name = group[0].name.replace(/\s*\(Alternate Art\)\s*/i, '').trim();
      return { name, cards: group };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function RuneBox({
  allRuneCards, collection, foilCollection, prices, pricesLoading,
  onAdjust, onAdjustFoil, onOpenModal, lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT,
}) {
  if (!allRuneCards.length) return null;

  const groups = groupRunes(allRuneCards);

  const ownedCount = allRuneCards.filter(c => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0).length;
  const setValue = !pricesLoading ? allRuneCards.reduce((sum, card) => {
    const p = prices[card.tcgplayer_id] ?? {};
    return sum + (collection[card.id] ?? 0) * (p.normal?.market ?? 0)
               + (foilCollection[card.id] ?? 0) * (p.foil?.market ?? p.normal?.market ?? 0);
  }, 0) : null;

  return (
    <div className="rune-box">
      <div className="rune-box-header">
        <h2 className="rune-box-title">Rune Box</h2>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
          {ownedCount} / {allRuneCards.length} arts
          {setValue != null && setValue > 0 && <> · ${setValue.toFixed(2)}</>}
        </span>
      </div>
      <div className="rune-box-body">
        {groups.map(({ name, cards }) => {
          const owned = cards.filter(c => (collection[c.id] ?? 0) + (foilCollection[c.id] ?? 0) > 0).length;
          return (
            <div key={name} className="rune-group">
              <div className="rune-group-head">
                <span className="rune-group-name">{name}</span>
                <span className="rune-group-meta">{owned}/{cards.length} arts</span>
              </div>
              <div className="card-grid">
                {cards.map(card => (
                  <CardItem
                    key={card.id}
                    card={card}
                    printingLabel={printingLabel(card)}
                    count={collection[card.id] ?? 0}
                    foilCount={foilCollection[card.id] ?? 0}
                    price={prices[card.tcgplayer_id] ?? null}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
