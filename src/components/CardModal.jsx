import { useEffect } from 'react';
import { useGame } from '../games/GameContext';

export default function CardModal({ card, price, pricesLoading, onClose, onStartDeck }) {
  const game = useGame();
  const RARITY_CLASS = game.rarityClass;
  const { Component: CardText, split } = game.text;
  useEffect(() => {
    if (!card) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  const imgSrc = card.media?.image_url ?? null;
  const rarity = (card.classification?.rarity ?? '').toLowerCase();
  const isLegend = card.classification?.type === 'Legend';
  const type = [card.classification?.supertype, card.classification?.type].filter(Boolean).join(' ');
  const domains = card.classification?.domain ?? [];
  const attrs = card.attributes ?? {};
  const textParagraphs = split(card.text?.plain ?? '');
  const flavour = card.text?.flavour ?? '';
  const normalPrice = price?.normal?.market;
  const foilPrice = price?.foil?.market;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {/* Left — image */}
        <div className="modal-img-col">
          {imgSrc
            ? <img src={imgSrc} alt={card.name} />
            : <div className="modal-img-placeholder">[{type} · {card.code ?? card.id?.toUpperCase()}]</div>
          }
        </div>

        {/* Right — details */}
        <div className="modal-body">
          <div className="modal-head">
            <h2>
              {card.name}
              {RARITY_CLASS[rarity] && (
                <span className={`rarity-tag ${RARITY_CLASS[rarity]}`}>{card.classification?.rarity}</span>
              )}
            </h2>
            <div className="modal-tags">
              {type && <span className="modal-tag-pill">{type}</span>}
              {domains.map(d => (
                <span key={d} className="modal-tag-pill" style={{color: `var(--d-${d.toLowerCase()})`}}>{d}</span>
              ))}
              <span className="modal-tag-pill" style={{color: 'var(--text-3)'}}>
                {card.set?.label} #{card.collector_label ?? String(card.collector_number ?? '').padStart(3, '0')}
              </span>
            </div>
          </div>

          {isLegend && onStartDeck && (
            <button className="btn primary modal-start-deck" onClick={() => onStartDeck(card)}>
              + Start a new deck with this Legend
            </button>
          )}

          <div className="modal-stats">
            {game.attributes.map(({ key, label }) => attrs[key] != null && (
              <div key={key} className="modal-stat">
                <span className="m-lbl">{label}</span>
                <span className="m-val">{attrs[key]}</span>
              </div>
            ))}
            {!pricesLoading && normalPrice && (
              <div className="modal-stat">
                <span className="m-lbl">Price</span>
                <span className="m-val" style={{color: 'var(--ok)'}}>${normalPrice.toFixed(2)}</span>
              </div>
            )}
            {!pricesLoading && foilPrice && !price?.foilOnly && (
              <div className="modal-stat">
                <span className="m-lbl">Foil</span>
                <span className="m-val" style={{color: 'var(--warn)'}}>${foilPrice.toFixed(2)}</span>
              </div>
            )}
          </div>

          {textParagraphs.length > 0 && (
            <div className="modal-text-area">
              {textParagraphs.map((chunk, i) => (
                <p key={i}><CardText text={chunk} /></p>
              ))}
            </div>
          )}

          {flavour && <p className="modal-flavour">"{flavour}"</p>}

          {card.media?.artist && (
            <div className="modal-footer-info">
              <span>Art: {card.media.artist}</span>
              {card.tags?.slice(0, 4).map(t => (
                <span key={t} className="modal-tag-pill">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
