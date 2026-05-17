import { isAlwaysFoil, isSingleton, isBattlefield } from '../utils/playset';

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
const Sparkle = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 3l1.5 5L18 9.5 13.5 11 12 16l-1.5-5L6 9.5 10.5 8z"/>
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
      <button onClick={onDec} disabled={count === 0}><Minus /></button>
      <span className="val">{count}</span>
      <button onClick={onInc}><Plus /></button>
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
  card, count, foilCount, price, alts = [], promos = [],
  pricesLoading, onAdjust, onAdjustFoil, onOpenModal,
  lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT
}) {
  const alwaysFoil = isAlwaysFoil(card);
  const singleton = isSingleton(card);
  const battlefield = isBattlefield(card);

  const effectiveCount = alwaysFoil ? foilCount : count + foilCount;

  let status;
  if (singleton) {
    status = (count > 0 || (battlefield && foilCount > 0)) ? 'playset' : 'missing';
  } else if (effectiveCount >= 3) {
    status = 'playset';
  } else if (effectiveCount > 0) {
    status = 'incomplete';
  } else {
    status = 'missing';
  }

  const imgSrc = card.media?.image_url ?? null;
  const domain = (card.classification?.domain?.[0] ?? '').toLowerCase();
  const rarity  = (card.classification?.rarity ?? '').toLowerCase();
  const normalPrice = price?.normal?.market;
  const foilPriceVal = price?.foil?.market;
  const isLF = !!lookingFor[card.id];
  const isUFT = !!upForTrade[card.id];

  let statusLabel;
  if (singleton) {
    statusLabel = count > 0 ? 'Owned' : 'Missing';
  } else if (status === 'playset') {
    statusLabel = `Playset${effectiveCount > 3 ? ` +${effectiveCount - 3}` : ''}`;
  } else if (status === 'missing') {
    statusLabel = 'Missing';
  } else {
    statusLabel = `${alwaysFoil ? foilCount : count}/3 owned`;
  }

  return (
    <article className={`card-cell s-${status}`}>
      <div className="status-stripe"></div>

      {/* Art */}
      <button className="card-art" onClick={() => onOpenModal?.(card)} title="View details">
        {imgSrc
          ? <img className="card-img" src={imgSrc} alt={card.name} loading="lazy" />
          : <span className="card-art-placeholder">[{card.classification?.type} · {card.id?.toUpperCase()}]</span>
        }
        {card.attributes?.energy != null && (
          <div className="corner cost"><span className="lbl">Cost</span>{card.attributes.energy}</div>
        )}
        {card.attributes?.power != null && (
          <div className="corner power"><span className="lbl">Pow</span>{card.attributes.power}</div>
        )}
        <span className="domain-dot" style={{'--domain': `var(--d-${domain})`}}></span>
        {singleton && <span className="singleton-marker">×1</span>}
      </button>

      {/* Body */}
      <div className="card-body">
        <div className="card-title">
          {card.name}
          {rarity === 'showcase' && <span className="card-foil-mini">◆</span>}
        </div>
        <div className="card-meta">
          <span>#{card.collector_number}</span>
          <span className="sep">·</span>
          <span className="price">
            {pricesLoading ? '…'
              : alwaysFoil
                ? <><span className="meta-foil-sym">✦</span>{foilPriceVal ? fmt(foilPriceVal) : '—'}</>
                : (normalPrice ? fmt(normalPrice) : '—')
            }
          </span>
          {!pricesLoading && !alwaysFoil && foilPriceVal && (
            <>
              <span className="sep">·</span>
              <span className="price foil-price"><span className="meta-foil-sym">✦</span>{fmt(foilPriceVal)}</span>
            </>
          )}
          {!pricesLoading && promos.map(({ label, price: pp }) => {
            const promoPrice = pp?.foil?.market ?? pp?.normal?.market;
            if (!promoPrice) return null;
            const abbrev = PROMO_ABBREV[label] ?? label.slice(0, 2).toUpperCase();
            return (
              <span key={label} style={{display: 'contents'}}>
                <span className="sep">·</span>
                <span className="price promo-price"><span className="meta-promo-sym">{abbrev}</span>{fmt(promoPrice)}</span>
              </span>
            );
          })}
        </div>

        {/* Singleton row */}
        {singleton ? (
          <div className="card-row singleton-row">
            <label className="singleton-check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={count > 0}
                onChange={(e) => onAdjust(card.id, e.target.checked ? 1 : -count)}
              />
              <span>Have copy <span style={{color: 'var(--text-3)', fontWeight: 400}}>(×1)</span></span>
            </label>
            {battlefield && (
              <label className="singleton-foil-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={foilCount > 0}
                  onChange={(e) => onAdjustFoil(card.id, e.target.checked ? 1 : -foilCount)}
                />
                <span className="foil-lbl"><Sparkle /> Foil</span>
              </label>
            )}
            <div className="card-actions-trail">
              <TagBtn label="LF" active={isLF} variant="lf" onClick={(e) => { e.stopPropagation(); onToggleLF?.(card.id); }} />
              <TagBtn label="UFT" active={isUFT} variant="uft" onClick={(e) => { e.stopPropagation(); onToggleUFT?.(card.id); }} />
            </div>
          </div>
        ) : (
          <>
            {/* Regular row — hidden for always-foil */}
            {!alwaysFoil && (
              <div className="card-row">
                <span className="row-lbl">Regular</span>
                <Stepper count={count} onDec={() => onAdjust(card.id, -1)} onInc={() => onAdjust(card.id, 1)} />
                <div className="card-actions-trail">
                  <TagBtn label="LF" active={isLF} variant="lf" onClick={() => onToggleLF?.(card.id)} />
                  <TagBtn label="UFT" active={isUFT} variant="uft" onClick={() => onToggleUFT?.(card.id)} />
                </div>
              </div>
            )}

            {/* Foil row */}
            <div className="card-row foil-row">
              <span className="row-lbl foil"><Sparkle /> Foil</span>
              <Stepper count={foilCount} onDec={() => onAdjustFoil(card.id, -1)} onInc={() => onAdjustFoil(card.id, 1)} variant="foil" />
              {alwaysFoil && (
                <div className="card-actions-trail">
                  <TagBtn label="LF" active={isLF} variant="lf" onClick={() => onToggleLF?.(card.id)} />
                  <TagBtn label="UFT" active={isUFT} variant="uft" onClick={() => onToggleUFT?.(card.id)} />
                </div>
              )}
            </div>
          </>
        )}

        {/* Promo fold-ins */}
        {promos.length > 0 && (
          <div className="card-promo-section">
            {promos.map(({ card: promo, count: pc, foilCount: pfc, price: pp, label: pl }) => {
              const promoAlwaysFoil = isAlwaysFoil(promo);
              const promoCount = promoAlwaysFoil ? (pfc ?? 0) : pc;
              const promoFoilP = pp?.foil?.market;
              return (
                <div key={promo.id} className="card-row promo-row">
                  <span className="row-lbl promo">
                    {pl}{promoAlwaysFoil && <> <Sparkle /></>}
                  </span>
                  <Stepper
                    count={promoCount}
                    onDec={() => promoAlwaysFoil ? onAdjustFoil(promo.id, -1) : onAdjust(promo.id, -1)}
                    onInc={() => promoAlwaysFoil ? onAdjustFoil(promo.id, 1) : onAdjust(promo.id, 1)}
                    variant={promoAlwaysFoil ? 'foil promo' : 'promo'}
                  />
                  {!promoAlwaysFoil && (
                    <Stepper
                      count={pfc ?? 0}
                      onDec={() => onAdjustFoil(promo.id, -1)}
                      onInc={() => onAdjustFoil(promo.id, 1)}
                      variant="foil promo"
                    />
                  )}
                  <div className="card-actions-trail">
                    <TagBtn label="LF" active={!!lookingFor[promo.id]} variant="lf" onClick={() => onToggleLF?.(promo.id)} />
                    <TagBtn label="UFT" active={!!upForTrade[promo.id]} variant="uft" onClick={() => onToggleUFT?.(promo.id)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Alt arts */}
        {alts.length > 0 && alts.map(({ card: alt, count: ac, foilCount: afc, price: ap }) => {
          const altAlwaysFoil = isAlwaysFoil(alt);
          const altCount = altAlwaysFoil ? (afc ?? 0) : ac;
          return (
            <div key={alt.id} className="card-alt-section">
              <div className="card-row alt-row">
                <span className="row-lbl alt">Alt Art ✦</span>
                <Stepper
                  count={altCount}
                  onDec={() => altAlwaysFoil ? onAdjustFoil(alt.id, -1) : onAdjust(alt.id, -1)}
                  onInc={() => altAlwaysFoil ? onAdjustFoil(alt.id, 1) : onAdjust(alt.id, 1)}
                  variant={altAlwaysFoil ? 'foil' : ''}
                />
                {!altAlwaysFoil && (
                  <Stepper
                    count={afc ?? 0}
                    onDec={() => onAdjustFoil(alt.id, -1)}
                    onInc={() => onAdjustFoil(alt.id, 1)}
                    variant="foil"
                  />
                )}
                <div className="card-actions-trail">
                  <TagBtn label="LF" active={!!lookingFor[alt.id]} variant="lf" onClick={() => onToggleLF?.(alt.id)} />
                  <TagBtn label="UFT" active={!!upForTrade[alt.id]} variant="uft" onClick={() => onToggleUFT?.(alt.id)} />
                </div>
              </div>
            </div>
          );
        })}

        {/* Status row */}
        <div className="card-row card-status-row">
          <span className="card-status">
            <span className="pip"></span>
            {statusLabel}
          </span>
          {!singleton && foilCount > 0 && (
            <span className="foil-badge">
              <Sparkle /> {foilCount >= 3 ? `playset${foilCount > 3 ? ` +${foilCount - 3}` : ''}` : `${foilCount}/3`}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
