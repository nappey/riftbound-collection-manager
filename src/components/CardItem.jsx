import { isAlwaysFoil, isSingleton, isBattlefield, playsetTarget } from '../utils/playset';

const Plus = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 5v14M5 12h14"/>
  </svg>
);
const Minus = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M5 12h14"/>
  </svg>
);

function fmt(n) { return '$' + (Number(n) || 0).toFixed(2); }

const PROMO_ABBREV = {
  'Nexus Night': 'NN',
  'Promo': 'PR',
  'Judge': 'JDG',
  'Worlds': 'WB',
};

function Stepper({ count, onDec, onInc, variant = '' }) {
  return (
    <div className={`stepper${variant ? ` ${variant}` : ''}`}>
      <button onClick={onDec} disabled={count === 0} aria-label="decrease"><Minus /></button>
      <span className="val">{count}</span>
      <button onClick={onInc} aria-label="increase"><Plus /></button>
    </div>
  );
}

function TagBtn({ label, active, variant, onClick }) {
  return (
    <button
      className={`tag-btn${active ? ` active ${variant}` : ''}`}
      onClick={onClick}
    >{label}</button>
  );
}

export default function CardItem({
  card, count, foilCount, price, promos = [], isAlt = false, printingLabel = null,
  pricesLoading, onAdjust, onAdjustFoil, onOpenModal,
  lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT
}) {
  const alwaysFoil = isAlwaysFoil(card);
  const singleton = isSingleton(card);
  const battlefield = isBattlefield(card);
  const target = playsetTarget(card);

  const effectiveCount = alwaysFoil ? foilCount : count + foilCount;

  let status;
  if (singleton) {
    status = (count > 0 || (battlefield && foilCount > 0)) ? 'playset' : 'missing';
  } else if (effectiveCount >= target) {
    status = 'playset';
  } else if (effectiveCount > 0) {
    status = 'incomplete';
  } else {
    status = 'missing';
  }

  const imgSrc = card.media?.image_url ?? null;
  const normalPrice = price?.normal?.market;
  const foilPriceVal = price?.foil?.market;
  const isLF = !!lookingFor[card.id];
  const isUFT = !!upForTrade[card.id];

  let statusLabel;
  if (singleton) {
    statusLabel = count > 0 ? 'Owned' : 'Missing';
  } else if (status === 'playset') {
    statusLabel = `Playset${effectiveCount > target ? ` +${effectiveCount - target}` : ''}`;
  } else if (status === 'missing') {
    statusLabel = 'Missing';
  } else {
    statusLabel = `${alwaysFoil ? foilCount : count + foilCount}/${target}`;
  }

  return (
    <article className={`card-cell s-${status}${isAlt ? ' is-alt' : ''}`}>
      {/* Full card art (portrait) */}
      <button className="card-art" onClick={() => onOpenModal?.(card)} title="View details">
        {imgSrc
          ? <img className="card-img" src={imgSrc} alt={card.name} loading="lazy" />
          : <span className="card-art-placeholder">{card.name}</span>
        }
        {isAlt && <span className="alt-badge">ALT</span>}
        {printingLabel && <span className="printing-badge">{printingLabel}</span>}
        {singleton && <span className="singleton-marker">×1</span>}
      </button>

      <div className="card-body">
        <div className="card-title" title={card.name}>{card.name}</div>

        <div className="card-meta">
          <span className="num">#{card.collector_number}</span>
          {!pricesLoading && (
            <>
              {alwaysFoil
                ? <span className="price"><span className="meta-foil-sym">✦</span>{foilPriceVal ? fmt(foilPriceVal) : '—'}</span>
                : normalPrice && <span className="price">{fmt(normalPrice)}</span>
              }
              {!alwaysFoil && foilPriceVal && (
                <span className="price foil-price"><span className="meta-foil-sym">✦</span>{fmt(foilPriceVal)}</span>
              )}
              {promos.map(({ label, price: pp }) => {
                const promoPrice = pp?.foil?.market ?? pp?.normal?.market;
                if (!promoPrice) return null;
                const abbrev = PROMO_ABBREV[label] ?? label.slice(0, 2).toUpperCase();
                return (
                  <span key={label} className="price promo-price">
                    <span className="meta-promo-sym">{abbrev}</span>{fmt(promoPrice)}
                  </span>
                );
              })}
            </>
          )}
        </div>

        {/* Counter row */}
        {singleton ? (
          <div className="card-row">
            <label className="singleton-check">
              <input
                type="checkbox"
                checked={count > 0}
                onChange={(e) => onAdjust(card.id, e.target.checked ? 1 : -count)}
              />
              <span>Have it</span>
            </label>
            {battlefield && (
              <label className="singleton-foil-check">
                <input
                  type="checkbox"
                  checked={foilCount > 0}
                  onChange={(e) => onAdjustFoil(card.id, e.target.checked ? 1 : -foilCount)}
                />
                <span className="foil-lbl">✦</span>
              </label>
            )}
            <div className="card-actions-trail">
              <TagBtn label="LF" active={isLF} variant="lf" onClick={() => onToggleLF?.(card.id)} />
              <TagBtn label="UFT" active={isUFT} variant="uft" onClick={() => onToggleUFT?.(card.id)} />
            </div>
          </div>
        ) : (
          <div className="card-row counter-row">
            {!alwaysFoil && (
              <Stepper count={count} onDec={() => onAdjust(card.id, -1)} onInc={() => onAdjust(card.id, 1)} />
            )}
            <Stepper count={foilCount} onDec={() => onAdjustFoil(card.id, -1)} onInc={() => onAdjustFoil(card.id, 1)} variant="foil" />
            <div className="card-actions-trail">
              <TagBtn label="LF" active={isLF} variant="lf" onClick={() => onToggleLF?.(card.id)} />
              <TagBtn label="UFT" active={isUFT} variant="uft" onClick={() => onToggleUFT?.(card.id)} />
            </div>
          </div>
        )}

        {/* Promo fold-ins (only for base cards, not alts) */}
        {promos.length > 0 && !isAlt && promos.map(({ card: promo, count: pc, foilCount: pfc, label: pl }) => {
          const promoAlwaysFoil = isAlwaysFoil(promo);
          const abbrev = PROMO_ABBREV[pl] ?? pl.slice(0, 2).toUpperCase();
          return (
            <div key={promo.id} className="card-row promo-row">
              <span className="promo-tag">{abbrev}</span>
              {!promoAlwaysFoil && (
                <Stepper count={pc} onDec={() => onAdjust(promo.id, -1)} onInc={() => onAdjust(promo.id, 1)} variant="promo" />
              )}
              <Stepper count={pfc ?? 0} onDec={() => onAdjustFoil(promo.id, -1)} onInc={() => onAdjustFoil(promo.id, 1)} variant="foil promo" />
              <div className="card-actions-trail">
                <TagBtn label="LF" active={!!lookingFor[promo.id]} variant="lf" onClick={() => onToggleLF?.(promo.id)} />
                <TagBtn label="UFT" active={!!upForTrade[promo.id]} variant="uft" onClick={() => onToggleUFT?.(promo.id)} />
              </div>
            </div>
          );
        })}

        <div className="card-status-row">
          <span className="status-pip"></span>
          <span className="status-text">{statusLabel}</span>
        </div>
      </div>
    </article>
  );
}
