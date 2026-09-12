import { useMemo, useState, useCallback } from 'react';
import { useGame } from '../games/GameContext';
import { isAlwaysFoil } from '../utils/playset';
import { fmt$ } from '../utils/analysis';
import { exportMerchantImage } from '../utils/deckImage';

const mid = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Market price for a specific printing (foil vs normal) of a card.
function marketOf(card, foil, prices) {
  const p = prices[card.tcgplayer_id] ?? {};
  if (foil) return p.foil?.market ?? p.foil?.low ?? p.normal?.market ?? null;
  return p.normal?.market ?? p.normal?.low ?? null;
}

// A single consigned card: available-qty stepper, asking price, sell controls.
function MerchantRow({
  entry, card, market, effPrice, onReturn, onSell, onUnsell, onSetAsk, onRemove, onOpenModal, pricesLoading,
}) {
  const { setLabels: SET_LABELS } = useGame();
  const [askDraft, setAskDraft] = useState(entry.askPrice != null ? String(entry.askPrice) : '');
  const [saleDraft, setSaleDraft] = useState('');
  const soldCount = entry.sold.length;
  const soldValue = entry.sold.reduce((s, r) => s + (r.price ?? 0), 0);

  const commitAsk = () => {
    const v = askDraft.trim() === '' ? null : Math.max(0, parseFloat(askDraft));
    onSetAsk(entry.id, Number.isFinite(v) ? v : null);
  };
  const commitSell = () => {
    const raw = saleDraft.trim();
    const price = raw === '' ? (effPrice ?? null) : Math.max(0, parseFloat(raw));
    onSell(entry, Number.isFinite(price) ? price : (effPrice ?? null));
    setSaleDraft('');
  };

  return (
    <div className="tm-row">
      <button className="tm-thumb" onClick={() => onOpenModal?.(card)} title="View details">
        {card.media?.image_url ? <img src={card.media.image_url} alt={card.name} loading="lazy" /> : null}
        {entry.foil && <span className="tm-foil-tag">FOIL</span>}
      </button>

      <div className="tm-info">
        <span className="tm-name">{card.name}</span>
        <span className="tm-set">{SET_LABELS[card.set?.set_id] ?? card.set?.set_id ?? '—'}</span>
      </div>

      <div className="tm-cell">
        <span className="tm-cell-label">Available</span>
        <div className="stepper">
          <button onClick={() => onReturn(entry)} disabled={entry.qty === 0} title="Return one copy to your collection">−</button>
          <span className="val">{entry.qty}</span>
        </div>
      </div>

      <div className="tm-cell">
        <span className="tm-cell-label">Ask $ / ea</span>
        <input
          className="tm-price-input"
          type="number" min="0" step="0.25"
          placeholder={market != null ? market.toFixed(2) : '—'}
          value={askDraft}
          onChange={e => setAskDraft(e.target.value)}
          onBlur={commitAsk}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="tm-market">{pricesLoading ? '…' : market != null ? `mkt ${fmt$(market)}` : 'no mkt'}</span>
      </div>

      <div className="tm-cell tm-sell">
        <span className="tm-cell-label">Sell</span>
        <div className="tm-sell-controls">
          <input
            className="tm-price-input"
            type="number" min="0" step="0.25"
            placeholder={effPrice != null ? effPrice.toFixed(2) : '$'}
            value={saleDraft}
            onChange={e => setSaleDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commitSell()}
          />
          <button className="btn ok sm" onClick={commitSell} disabled={entry.qty === 0}>Sold</button>
        </div>
      </div>

      <div className="tm-cell tm-sold">
        <span className="tm-cell-label">Sold</span>
        {soldCount ? (
          <span className="tm-sold-val" title="Undo the most recent sale">
            {soldCount} · {fmt$(soldValue)}
            <button className="tm-undo" onClick={() => onUnsell(entry)} title="Undo last sale">↩</button>
          </span>
        ) : <span className="tm-sold-none">—</span>}
      </div>

      <button className="tm-remove" onClick={() => onRemove(entry)} title="Remove & return all available copies">×</button>
    </div>
  );
}

export default function TravelingMerchant({
  allCards, collection, foilCollection, prices, pricesLoading,
  merchant, setMerchant, vendorName, setVendorName,
  onAdjust, onAdjustFoil, onOpenModal,
}) {
  const { setLabels: SET_LABELS } = useGame();
  const [query, setQuery] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const cardById = useMemo(() => {
    const m = new Map();
    for (const c of allCards) m.set(c.id, c);
    return m;
  }, [allCards]);

  // Search over cards you still own copies of (collection reflects what's left
  // after consigning), so you can only put out what you actually have.
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return allCards
      .filter(c => c.name.toLowerCase().includes(q))
      .filter(c => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0)
      .slice(0, 8);
  }, [query, allCards, collection, foilCollection]);

  // ── mutations (also move copies in/out of the collection) ──────
  const consign = useCallback((cardId, foil) => {
    (foil ? onAdjustFoil : onAdjust)(cardId, -1);
    setMerchant(prev => {
      const i = prev.findIndex(e => e.cardId === cardId && e.foil === foil);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...prev, { id: mid(), cardId, foil, qty: 1, askPrice: null, ts: Date.now(), sold: [] }];
    });
  }, [onAdjust, onAdjustFoil, setMerchant]);

  const returnCopy = useCallback((entry) => {
    if (entry.qty <= 0) return;
    (entry.foil ? onAdjustFoil : onAdjust)(entry.cardId, 1);
    setMerchant(prev => prev
      .map(e => e.id === entry.id ? { ...e, qty: e.qty - 1 } : e)
      .filter(e => e.qty > 0 || e.sold.length > 0));
  }, [onAdjust, onAdjustFoil, setMerchant]);

  const sellCopy = useCallback((entry, price) => {
    if (entry.qty <= 0) return;
    setMerchant(prev => prev.map(e => e.id === entry.id
      ? { ...e, qty: e.qty - 1, sold: [...e.sold, { id: mid(), price: price ?? null, ts: Date.now() }] }
      : e));
  }, [setMerchant]);

  const unsellCopy = useCallback((entry) => {
    if (!entry.sold.length) return;
    setMerchant(prev => prev.map(e => e.id === entry.id
      ? { ...e, qty: e.qty + 1, sold: e.sold.slice(0, -1) }
      : e));
  }, [setMerchant]);

  const setAsk = useCallback((entryId, price) => {
    setMerchant(prev => prev.map(e => e.id === entryId ? { ...e, askPrice: price } : e));
  }, [setMerchant]);

  const removeEntry = useCallback((entry) => {
    if (entry.qty > 0) (entry.foil ? onAdjustFoil : onAdjust)(entry.cardId, entry.qty);
    setMerchant(prev => prev.filter(e => e.id !== entry.id));
  }, [onAdjust, onAdjustFoil, setMerchant]);

  // ── derived rows + totals ──────────────────────────────────────
  const rows = useMemo(() => merchant.map(entry => {
    const card = cardById.get(entry.cardId);
    if (!card) return null;
    const market = marketOf(card, entry.foil, prices);
    const effPrice = entry.askPrice != null ? entry.askPrice : market;
    return { entry, card, market, effPrice };
  }).filter(Boolean), [merchant, cardById, prices]);

  const totals = useMemo(() => {
    let availCount = 0, availValue = 0, soldCount = 0, soldValue = 0;
    for (const { entry, effPrice } of rows) {
      availCount += entry.qty;
      availValue += entry.qty * (effPrice ?? 0);
      soldCount += entry.sold.length;
      soldValue += entry.sold.reduce((s, r) => s + (r.price ?? 0), 0);
    }
    return { availCount, availValue, soldCount, soldValue };
  }, [rows]);

  // ── export ─────────────────────────────────────────────────────
  async function exportImage() {
    const saleRows = rows
      .filter(r => r.entry.qty > 0)
      .map(r => ({ card: r.card, foil: r.entry.foil, qty: r.entry.qty, price: r.effPrice }));
    if (!saleRows.length) { window.alert('No cards are currently for sale.'); return; }
    setImgBusy(true);
    try {
      await exportMerchantImage({
        vendorName,
        rows: saleRows,
        totalValue: totals.availValue,
        soldCount: totals.soldCount,
        soldValue: totals.soldValue,
      });
    } catch (e) {
      window.alert(`Image export failed — a card image blocked the canvas. ${e?.message ?? ''}`);
    } finally {
      setImgBusy(false);
    }
  }

  async function copyText() {
    const saleRows = rows.filter(r => r.entry.qty > 0);
    if (!saleRows.length) return;
    let out = `${vendorName || 'Traveling Merchant'} — For Sale\n\n`;
    for (const { entry, card, effPrice } of saleRows) {
      const foil = entry.foil ? ' (Foil)' : '';
      const price = effPrice != null ? ` — ${fmt$(effPrice)} ea` : '';
      out += `${entry.qty}x ${card.name}${foil}${price}\n`;
    }
    out += `\n${totals.availCount} cards · ${fmt$(totals.availValue)}`;
    await navigator.clipboard.writeText(out.trimEnd());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="tm-wrap">
      <div className="tm-intro">
        <h1>Traveling Merchant</h1>
        <p>Cards you've handed to your local vendor to sell. Consigning a card moves it
          out of your collection count; marking it <b>Sold</b> records the sale, and the −
          button returns an unsold copy to your collection.</p>
      </div>

      {/* Vendor + search */}
      <div className="tm-toolbar">
        <input
          className="tm-vendor"
          placeholder="Vendor name (optional)"
          value={vendorName}
          onChange={e => setVendorName(e.target.value)}
        />
        <div className="tm-search">
          <input
            placeholder="Search a card you own to consign…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <div className="tm-results">
              {results.map(c => {
                const normal = collection[c.id] ?? 0;
                const foil = foilCollection[c.id] ?? 0;
                const alwaysFoil = isAlwaysFoil(c);
                return (
                  <div key={c.id} className="tm-result">
                    <div className="tm-result-thumb">
                      {c.media?.image_url ? <img src={c.media.image_url} alt="" loading="lazy" /> : null}
                    </div>
                    <span className="tm-result-name">{c.name}</span>
                    <span className="tm-result-set">{SET_LABELS[c.set?.set_id] ?? c.set?.set_id}</span>
                    <div className="tm-result-actions">
                      {!alwaysFoil && normal > 0 && (
                        <button className="btn sm" onClick={() => consign(c.id, false)}>+ Add ({normal})</button>
                      )}
                      {foil > 0 && (
                        <button className="btn sm gold" onClick={() => consign(c.id, true)}>+ Foil ({foil})</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Totals + export */}
      <div className="tm-summary">
        <div className="tm-stat">
          <span className="tm-stat-label">For sale</span>
          <span className="tm-stat-value">{totals.availCount}</span>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">Asking total</span>
          <span className="tm-stat-value">{pricesLoading ? '…' : fmt$(totals.availValue)}</span>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">Sold</span>
          <span className="tm-stat-value">{totals.soldCount}</span>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">Sold total</span>
          <span className="tm-stat-value ok">{fmt$(totals.soldValue)}</span>
        </div>
        <div className="tm-summary-actions">
          <button className="btn" onClick={copyText} disabled={!totals.availCount}>
            {copied ? '✓ Copied' : 'Copy list'}
          </button>
          <button className="btn primary" onClick={exportImage} disabled={imgBusy || !totals.availCount}>
            {imgBusy ? 'Exporting…' : '🖼 Export image'}
          </button>
        </div>
      </div>

      {/* Consigned list */}
      {rows.length === 0 ? (
        <div className="tm-empty">Nothing with the vendor yet. Search a card above to consign it.</div>
      ) : (
        <div className="tm-list">
          {rows.map(({ entry, card, market, effPrice }) => (
            <MerchantRow
              key={entry.id}
              entry={entry}
              card={card}
              market={market}
              effPrice={effPrice}
              pricesLoading={pricesLoading}
              onReturn={returnCopy}
              onSell={sellCopy}
              onUnsell={unsellCopy}
              onSetAsk={setAsk}
              onRemove={removeEntry}
              onOpenModal={onOpenModal}
            />
          ))}
        </div>
      )}
    </div>
  );
}
