// Compose a deck (legend + chosen champion + main deck) onto a single canvas
// and download it as a PNG. Card images come from external CDNs; in the
// packaged/Electron app, main.cjs injects CORS headers so the canvas stays
// clean and can be exported.

const BG = '#0f0f17';
const FG = '#f2f2f5';
const MUTED = '#8a8a98';
const SUB = '#c8c8d0';
const CARD_BG = '#1c1c26';

function loadFromSrc(src, cors) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadImage(url) {
  if (!url) return null;
  // In Electron, fetch via the main process (no CORS) → data URL, which never
  // taints the canvas. Falls back to a CORS image load in the browser.
  const bridge = typeof window !== 'undefined' ? window.__electron__ : null;
  if (bridge?.fetchImageDataUrl) {
    try {
      const dataUrl = await bridge.fetchImageDataUrl(url);
      if (dataUrl) {
        const img = await loadFromSrc(dataUrl, false);
        if (img) return img;
      }
    } catch { /* fall through to direct load */ }
  }
  return loadFromSrc(url, true);
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw a card image with cover-fit (object-fit: cover, top-aligned) into a rounded box.
function drawCard(ctx, img, name, x, y, w, h) {
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.save();
  ctx.clip();
  if (img) {
    const ir = img.width / img.height;
    const tr = w / h;
    let sw, sh;
    if (ir > tr) { sh = img.height; sw = sh * tr; } else { sw = img.width; sh = sw / tr; }
    const sx = (img.width - sw) / 2;
    ctx.drawImage(img, sx, 0, sw, sh, x, y, w, h);
  } else {
    ctx.fillStyle = CARD_BG;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = MUTED;
    ctx.font = '11px Geist, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name ?? '', x + w / 2, y + h / 2, w - 12);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawQty(ctx, qty, x, y, w) {
  const text = `×${qty}`;
  ctx.font = '700 13px "Geist Mono", monospace';
  const bw = ctx.measureText(text).width + 12;
  const bh = 20;
  const bx = x + w - bw - 5;
  const by = y + 5;
  roundRectPath(ctx, bx, by, bw, bh, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/**
 * Build and download a PNG of the deck.
 * @param {{ deckName, legend, champion, mainRows }} deck
 *   mainRows: [{ card, qty }]
 */
export async function exportDeckImage({ deckName, legend, champion, mainRows }) {
  const P = 28, GAP = 12, TITLE_H = 54, LABEL_H = 20;
  const IDW = 200, IDH = Math.round(IDW * 7 / 5);
  const MW = 152, MH = Math.round(MW * 7 / 5);
  const COLS = 8;

  const identity = [['Legend', legend], ['Champion', champion]].filter(([, c]) => c);
  const cards = mainRows ?? [];
  const rows = Math.ceil(cards.length / COLS);

  const idBlockH = identity.length ? LABEL_H + IDH : 0;
  const gridLabelH = cards.length ? 30 : 0;
  const gridH = rows ? rows * MH + (rows - 1) * GAP : 0;

  const W = COLS * MW + (COLS - 1) * GAP + 2 * P;
  const H = P + TITLE_H + idBlockH + (idBlockH ? GAP * 2 : 0) + gridLabelH + gridH + P;

  const scale = 2; // crisp on hi-dpi
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = FG;
  ctx.font = '600 30px Geist, sans-serif';
  ctx.fillText(deckName || 'Deck', P, P);

  // Preload images
  const idImgs = await Promise.all(identity.map(([, c]) => loadImage(c.media?.image_url)));
  const cardImgs = await Promise.all(cards.map(({ card }) => loadImage(card.media?.image_url)));

  let y = P + TITLE_H;

  // Identity row (legend + champion)
  if (identity.length) {
    let x = P;
    identity.forEach(([label, c], i) => {
      ctx.fillStyle = MUTED;
      ctx.font = '600 12px "Geist Mono", monospace';
      ctx.fillText(label.toUpperCase(), x, y);
      drawCard(ctx, idImgs[i], c.name, x, y + LABEL_H, IDW, IDH);
      x += IDW + GAP;
    });
    y += idBlockH + GAP * 2;
  }

  // Main deck grid
  if (cards.length) {
    const total = cards.reduce((n, r) => n + r.qty, 0);
    ctx.fillStyle = SUB;
    ctx.font = '600 16px Geist, sans-serif';
    ctx.fillText(`Main Deck — ${total} cards`, P, y);
    y += gridLabelH;
    cards.forEach(({ card, qty }, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = P + col * (MW + GAP);
      const cy = y + row * (MH + GAP);
      drawCard(ctx, cardImgs[i], card.name, cx, cy, MW, MH);
      drawQty(ctx, qty, cx, cy, MW);
    });
  }

  await downloadCanvas(canvas, deckName || 'deck');
}

// Render a canvas to a PNG and trigger a browser download.
async function downloadCanvas(canvas, baseName) {
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas export produced no data')), 'image/png');
    } catch (err) {
      reject(err);
    }
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName.replace(/[^\w\- ]/g, '').trim() || 'deck'}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── siding guide image ──────────────────────────────────────────
const OUT_COLOR = '#e5484d'; // side out (red)
const IN_COLOR = '#46a758';  // side in (green)

// Draw a card's art cropped to a circle. Portrait art is cover-fit and
// top-aligned so the character's face stays inside the circle.
function drawCircle(ctx, img, name, cx, cy, d, ring) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx + r, cy + r, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    const ir = img.width / img.height; // target is square (tr = 1)
    let sw, sh;
    if (ir > 1) { sh = img.height; sw = sh; } else { sw = img.width; sh = sw; }
    const sx = (img.width - sw) / 2;
    ctx.drawImage(img, sx, 0, sw, sh, cx, cy, d, d);
  } else {
    ctx.fillStyle = CARD_BG;
    ctx.fillRect(cx, cy, d, d);
    ctx.fillStyle = MUTED;
    ctx.font = '10px Geist, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name ?? '', cx + r, cy + r, d - 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx + r, cy + r, r - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();
}

// Small quantity badge pinned to the bottom-right of a circle.
function drawCircleQty(ctx, qty, cx, cy, d, ring) {
  const text = `×${qty}`;
  ctx.font = '700 12px "Geist Mono", monospace';
  const bw = ctx.measureText(text).width + 12;
  const bh = 20;
  const bx = cx + d - bw;
  const by = cy + d - bh;
  roundRectPath(ctx, bx, by, bw, bh, bh / 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

// Wrap a name into at most `maxLines` lines that fit `maxW`, ellipsizing overflow.
function wrapLines(ctx, text, maxW, maxLines) {
  const words = (text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(t).width <= maxW) {
      cur = t;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Ellipsize the final line if content was truncated or a single word overflows.
  if (lines.length) {
    let last = lines[lines.length - 1];
    if (ctx.measureText(last).width > maxW) {
      while (last.length && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}…`;
    }
  }
  return lines;
}

/**
 * Build and download a PNG "siding guide" — a color key (legend) plus, per
 * matchup, the opponent legend and the cards to side out / side in shown as
 * circular art crops with names.
 * @param {{ deckName, plans }} guide
 *   plans: [{ opp: card, out: [{card, qty}], in: [{card, qty}] }]
 */
export async function exportSidingImage({ deckName, plans }) {
  const P = 32, GAP = 16;
  const CELL_D = 92, CELL_W = 104, ROW_GAP = 14, NAME_H = 30;
  const COLS = 6;
  const TITLE_H = 40, KEY_H = 30, HEAD_H = 66, SUBLABEL_H = 26, EMPTY_H = 26, PLAN_GAP = 26;

  const list = (plans ?? []).filter(p => p);
  const rowsFor = (n) => Math.max(1, Math.ceil(n / COLS));
  const gridH = (n) => n ? rowsFor(n) * (CELL_D + NAME_H) + (rowsFor(n) - 1) * ROW_GAP : EMPTY_H;
  const sideH = (n) => SUBLABEL_H + gridH(n);
  const planH = (p) => HEAD_H + sideH(p.out.length) + 10 + sideH(p.in.length);

  const W = COLS * CELL_W + (COLS - 1) * GAP + 2 * P;
  let H = P + TITLE_H + KEY_H + GAP;
  list.forEach((p, i) => { H += planH(p) + (i < list.length - 1 ? PLAN_GAP : 0); });
  H += P;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Preload every distinct card image once.
  const urls = new Set();
  for (const p of list) {
    if (p.opp?.media?.image_url) urls.add(p.opp.media.image_url);
    for (const { card } of [...p.out, ...p.in]) if (card?.media?.image_url) urls.add(card.media.image_url);
  }
  const urlList = [...urls];
  const loaded = await Promise.all(urlList.map(loadImage));
  const imgMap = new Map(urlList.map((u, i) => [u, loaded[i]]));
  const imgOf = (card) => (card?.media?.image_url ? imgMap.get(card.media.image_url) : null) ?? null;

  // Title
  ctx.fillStyle = FG;
  ctx.font = '600 26px Geist, sans-serif';
  ctx.fillText(`${deckName || 'Deck'} — Siding Guide`, P, P);

  // Color key (legend)
  let ky = P + TITLE_H;
  const keyItem = (x, color, label) => {
    ctx.beginPath();
    ctx.arc(x + 7, ky + 8, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = SUB;
    ctx.font = '500 13px Geist, sans-serif';
    ctx.fillText(label, x + 20, ky + 1);
    return x + 20 + ctx.measureText(label).width + 26;
  };
  let kx = keyItem(P, OUT_COLOR, 'Side out — from main deck');
  keyItem(kx, IN_COLOR, 'Side in — from sideboard');

  // Draw a wrapped grid of card circles; returns the y after the grid.
  const drawGrid = (rows, y, ring) => {
    if (!rows.length) {
      ctx.fillStyle = MUTED;
      ctx.font = 'italic 13px Geist, sans-serif';
      ctx.fillText('— none —', P + 2, y + 4);
      return y + EMPTY_H;
    }
    rows.forEach(({ card, qty }, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cellX = P + col * (CELL_W + GAP);
      const cx = cellX + (CELL_W - CELL_D) / 2;
      const cy = y + row * (CELL_D + NAME_H + ROW_GAP);
      drawCircle(ctx, imgOf(card), card.name, cx, cy, CELL_D, ring);
      if (qty > 1) drawCircleQty(ctx, qty, cx, cy, CELL_D, ring);
      // Name below the circle (up to two centered lines).
      ctx.fillStyle = SUB;
      ctx.font = '11px Geist, sans-serif';
      ctx.textAlign = 'center';
      const nameLines = wrapLines(ctx, card.name, CELL_W, 2);
      nameLines.forEach((ln, li) => ctx.fillText(ln, cellX + CELL_W / 2, cy + CELL_D + 4 + li * 13));
      ctx.textAlign = 'left';
    });
    return y + gridH(rows.length);
  };

  let y = ky + KEY_H + GAP;
  list.forEach((p, idx) => {
    const outTotal = p.out.reduce((n, r) => n + r.qty, 0);
    const inTotal = p.in.reduce((n, r) => n + r.qty, 0);

    // Matchup header: opponent legend circle + "vs Name" + balance.
    const oppD = 48;
    drawCircle(ctx, imgOf(p.opp), p.opp?.name, P, y, oppD, 'rgba(255,255,255,0.18)');
    ctx.fillStyle = FG;
    ctx.font = '600 19px Geist, sans-serif';
    ctx.fillText(`vs ${p.opp?.name ?? 'Unknown legend'}`, P + oppD + 14, y + 6);
    const balText = `−${outTotal} / +${inTotal}${outTotal === inTotal ? ' ✓' : ' ⚠'}`;
    ctx.font = '600 13px "Geist Mono", monospace';
    ctx.fillStyle = outTotal === inTotal ? IN_COLOR : '#e2a336';
    ctx.fillText(balText, P + oppD + 14, y + 30);
    y += HEAD_H;

    // Side out
    ctx.fillStyle = OUT_COLOR;
    ctx.font = '700 13px "Geist Mono", monospace';
    ctx.fillText(`SIDE OUT · ${outTotal}`, P, y);
    y = drawGrid(p.out, y + SUBLABEL_H, OUT_COLOR) + 10;

    // Side in
    ctx.fillStyle = IN_COLOR;
    ctx.font = '700 13px "Geist Mono", monospace';
    ctx.fillText(`SIDE IN · ${inTotal}`, P, y);
    y = drawGrid(p.in, y + SUBLABEL_H, IN_COLOR);

    if (idx < list.length - 1) {
      y += PLAN_GAP / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(P, y);
      ctx.lineTo(W - P, y);
      ctx.stroke();
      y += PLAN_GAP / 2;
    }
  });

  downloadCanvas(canvas, `${deckName || 'deck'} siding`);
}

// ── traveling merchant "for sale" sheet ─────────────────────────
const GOLD = '#e2b13c';

/**
 * Build and download a PNG sale sheet of cards consigned to a vendor.
 * @param {{ vendorName, rows, totalValue, soldCount, soldValue }} sheet
 *   rows: [{ card, foil, qty, price }] — price is per-copy (asking or market).
 */
export async function exportMerchantImage({ vendorName, rows, totalValue, soldCount, soldValue }) {
  const P = 28, GAP = 12, TITLE_H = 40, SUB_H = 30;
  const MW = 150, MH = Math.round(MW * 7 / 5), NAME_H = 40;
  const COLS = 6;

  const cards = rows ?? [];
  const gridRows = Math.ceil(cards.length / COLS);
  const gridH = gridRows ? gridRows * (MH + NAME_H) + (gridRows - 1) * GAP : 40;

  const W = COLS * MW + (COLS - 1) * GAP + 2 * P;
  const H = P + TITLE_H + SUB_H + gridH + P;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const imgs = await Promise.all(cards.map(({ card }) => loadImage(card.media?.image_url)));

  // Title
  ctx.fillStyle = FG;
  ctx.font = '600 26px Geist, sans-serif';
  ctx.fillText(`${vendorName || 'Traveling Merchant'} — For Sale`, P, P);

  // Subtitle: counts + totals
  const count = cards.reduce((n, r) => n + r.qty, 0);
  let sub = `${count} card${count === 1 ? '' : 's'} available`;
  if (totalValue != null) sub += ` · ${fmtMoney(totalValue)}`;
  if (soldCount) sub += `   ·   ${soldCount} sold${soldValue != null ? ` (${fmtMoney(soldValue)})` : ''}`;
  ctx.fillStyle = SUB;
  ctx.font = '500 14px Geist, sans-serif';
  ctx.fillText(sub, P, P + TITLE_H);

  let y = P + TITLE_H + SUB_H;
  if (!cards.length) {
    ctx.fillStyle = MUTED;
    ctx.font = 'italic 14px Geist, sans-serif';
    ctx.fillText('No cards currently for sale.', P, y + 4);
  }

  cards.forEach(({ card, foil, qty, price }, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = P + col * (MW + GAP);
    const cy = y + row * (MH + NAME_H + GAP);
    drawCard(ctx, imgs[i], card.name, cx, cy, MW, MH);
    if (qty > 1) drawQty(ctx, qty, cx, cy, MW);
    if (foil) drawFoilBadge(ctx, cx, cy);

    // Name + price beneath the card.
    ctx.textAlign = 'center';
    ctx.fillStyle = SUB;
    ctx.font = '12px Geist, sans-serif';
    const [nameLine] = wrapLines(ctx, card.name, MW, 1);
    ctx.fillText(nameLine ?? card.name, cx + MW / 2, cy + MH + 5);
    ctx.fillStyle = GOLD;
    ctx.font = '700 13px "Geist Mono", monospace';
    const priceText = price != null ? `${fmtMoney(price)} ea` : '—';
    ctx.fillText(priceText, cx + MW / 2, cy + MH + 22);
    ctx.textAlign = 'left';
  });

  downloadCanvas(canvas, `${vendorName || 'merchant'} for sale`);
}

function fmtMoney(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}

// A small gold "FOIL" tag pinned to the top-left of a card.
function drawFoilBadge(ctx, x, y) {
  const text = 'FOIL';
  ctx.font = '700 10px "Geist Mono", monospace';
  const bw = ctx.measureText(text).width + 10;
  const bh = 17;
  roundRectPath(ctx, x + 5, y + 5, bw, bh, 4);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.fillStyle = '#1a1400';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5 + bw / 2, y + 5 + bh / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
