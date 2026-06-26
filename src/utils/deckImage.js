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
  a.download = `${(deckName || 'deck').replace(/[^\w\- ]/g, '').trim() || 'deck'}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
