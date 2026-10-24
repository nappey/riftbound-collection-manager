// Riftbound Thumbnail Maker — a 1280×720 YouTube "VS" thumbnail drawn on a
// canvas: an image, headline and tag on each side (split / diagonal / card
// duel), a VS badge in the middle, an optional top banner and team logo.
// Everything is local: images are read with object URLs and never uploaded;
// settings (not images) are remembered in localStorage.

const W = 1280, H = 720;
const U = W / 100;                     // 1% of the width — the design's cqw unit
const STORE_KEY = 'rb-thumbnail-settings-v2';
const LOGO_KEY = 'rb-thumbnail-logo';  // team logo as a (downscaled) data URL
const LOGO_MAX = 600;                  // px — logos are scaled down to this before saving
const DEG = Math.PI / 180;

const SWATCHES = ['#f4514f', '#0099f2', '#e3ae28', '#11bc6d', '#a167f1'];
const INK = '#020306';                 // outlines, hard shadows
const TAG_INK = '#05070b';
const BADGE = '#040609';
const WHITE = '#fcfcfc';
const RULE = '#f8f8f8';                // divider, badge ring, banner
const STRIPE_A = '#13161b', STRIPE_B = '#1a1d22';
const MONO = 'ui-monospace, Consolas, monospace';

// Thumbnail fonts (Google Fonts, loaded in index.html). Each tile sets the
// family and the weight that face ships in.
const FONTS = [
  { name: 'Bebas Neue', css: "'Bebas Neue', sans-serif", w: 400 },
  { name: 'Anton', css: "'Anton', sans-serif", w: 400 },
  { name: 'Cinzel', css: "'Cinzel', serif", w: 900 },
  { name: 'Oswald', css: "'Oswald', sans-serif", w: 700 },
  { name: 'Bangers', css: "'Bangers', cursive", w: 400 },
  { name: 'Teko', css: "'Teko', sans-serif", w: 600 },
  { name: 'Russo One', css: "'Russo One', sans-serif", w: 400 },
  { name: 'Archivo Black', css: "'Archivo Black', sans-serif", w: 400 },
];

// Panel boxes in canvas px. `poly` clips the box (fractions of its size);
// `card` panels are rotated, rounded and outlined in the side color.
const card = (x, rot) => ({ x, y: 0.1 * H, w: 0.306 * W, h: 0.76 * H, rot, r: 1.4 * U, card: true });
const GEO = {
  split: {
    a: { x: 0, y: 0, w: W / 2, h: H },
    b: { x: W / 2, y: 0, w: W / 2, h: H },
  },
  diagonal: {
    a: { x: 0, y: 0, w: 0.56 * W, h: H, poly: [[0, 0], [1, 0], [0.7857, 1], [0, 1]] },
    b: { x: 0.44 * W, y: 0, w: 0.56 * W, h: H, poly: [[0.2143, 0], [1, 0], [1, 1], [0, 1]] },
  },
  cards: { a: card(0.09 * W, -5), b: card(0.604 * W, 5) },
};
const LAYOUT_NAMES = { split: 'Split', diagonal: 'Diagonal', cards: 'Card duel' };
const EFFECTS = ['Stroke', 'Shadow', 'Glow'];
const BANNER_PRESETS = ['Which is correct?', 'You decide', 'Misplay?', 'Pro vs me'];
const SIDE_LABELS = { a: 'This play', b: 'Vs this play' };

// Color presets: the two side colors and the background.
const PRESETS = {
  default: { label: 'Default', a: SWATCHES[0], b: SWATCHES[1], bg: '#07090d' },
  ff:      { label: 'FF',      a: '#dc661e',   b: '#f6d93b',   bg: '#71300f' },
};

const DEFAULTS = {
  a: { title: 'This play', sub: 'Turn 3 · All-in', color: SWATCHES[0] },
  b: { title: 'This play', sub: 'Turn 3 · Hold mana', color: SWATCHES[1] },
  font: 'Bebas Neue', extraFonts: [], size: 100, upper: true,
  outline: 3, outlineColor: INK, textColor: WHITE, spacing: 0, slant: 0,
  effect: 'Stroke', layout: 'diagonal', vs: 'VS',
  banner: 'Which is correct?', safe: true, bg: '#07090d',
  logoPos: 'center', logoSize: 130,
};

const $ = (id) => document.getElementById(id);
const canvas = $('thumb');
const ctx = canvas.getContext('2d');

let settings = loadSettings();
// Per-side image + framing (as in the design): zoom %, x/y offset in % of the
// panel, mirrored, and contain (whole image over a blurred fill) or cover.
const freshImg = () => ({ img: null, url: null, zoom: 100, x: 0, y: 0, flip: false, fit: 'contain' });
let imgs = { a: freshImg(), b: freshImg() };
let fileFonts = []; // fonts uploaded this session (not remembered)

// ── settings ──────────────────────────────────────────────────

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return { ...DEFAULTS, ...s, a: { ...DEFAULTS.a, ...s.a }, b: { ...DEFAULTS.b, ...s.b } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

function set(patch) {
  Object.assign(settings, patch);
  saveSettings();
  render();
  draw();
}
function setSide(k, patch) { set({ [k]: { ...settings[k], ...patch } }); }
function setImg(k, patch) {
  Object.assign(imgs[k], patch);
  renderSide(k);
  draw();
}

// ── fonts ─────────────────────────────────────────────────────

const allFonts = () => [
  ...FONTS,
  ...settings.extraFonts.map((name) => ({ name, css: `'${name}'`, w: 400 })),
  ...fileFonts,
];
const currentFont = () => allFonts().find((f) => f.name === settings.font) || FONTS[0];
const fontCss = (px) => { const f = currentFont(); return `${f.w} ${px}px ${f.css}, Impact, sans-serif`; };
const cased = (t) => (settings.upper ? t.toUpperCase() : t);

// Canvas text only uses a web font once it has loaded — fetch it, then redraw.
function ensureFont() {
  const f = currentFont();
  document.fonts?.load(`${f.w} 40px ${f.css}`).then(draw, () => {});
}

function addFont(name, { file = false } = {}) {
  name = (name || '').trim();
  if (!name) return;
  const hit = allFonts().find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (hit) { set({ font: hit.name }); }
  else if (file) { fileFonts.push({ name, css: `'${name}'`, w: 400 }); set({ font: name }); }
  else { set({ extraFonts: [...settings.extraFonts, name], font: name }); }
  $('font-custom').value = '';
  ensureFont();
}

async function loadFontFile(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  try {
    const face = new FontFace(name, await file.arrayBuffer());
    document.fonts.add(await face.load());
    addFont(name, { file: true });
  } catch {
    toast("That file couldn't be read as a font.");
  }
}

// Local Font Access API (Chrome/Edge): lists every installed font family.
async function browseLocalFonts() {
  try {
    const fonts = await window.queryLocalFonts();
    const fams = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    if (!fams.length) return toast('No fonts were shared.');
    const sel = $('font-local');
    const head = new Option(`Choose from ${fams.length} installed fonts…`, '');
    sel.replaceChildren(head, ...fams.map((f) => new Option(f, f)));
    sel.hidden = false;
  } catch {
    toast('Font access was blocked — type the name instead.');
  }
}

// ── team logo ─────────────────────────────────────────────────

let logo = null; // HTMLImageElement

function showLogo(img) {
  logo = img;
  const thumb = $('logo-thumb');
  if (img) { const t = new Image(); t.src = img.src; t.alt = 'Team logo'; thumb.replaceChildren(t); }
  else thumb.textContent = 'None';
  $('logo-clear').hidden = !img;
  render();
  draw();
}

// Read, downscale (so it fits in localStorage), remember, show.
function setLogo(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, LOGO_MAX / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const data = c.toDataURL('image/png');
    try { localStorage.setItem(LOGO_KEY, data); }
    catch { toast("The logo is too large to remember — it'll stay until you close this page."); }
    const saved = new Image();
    saved.onload = () => showLogo(saved);
    saved.src = data;
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("That file couldn't be read as an image."); };
  img.src = url;
}

function clearLogo() {
  try { localStorage.removeItem(LOGO_KEY); } catch { /* ignore */ }
  showLogo(null);
}

function restoreLogo() {
  let data = null;
  try { data = localStorage.getItem(LOGO_KEY); } catch { /* ignore */ }
  if (!data) return;
  const img = new Image();
  img.onload = () => showLogo(img);
  img.src = data;
}

const logoInMiddle = () => !!logo && settings.logoPos === 'center';

// Contain-fit the logo into a box `size` tall (up to 2× as wide), anchored by
// position. 'center' takes the VS badge's place; 'top' sits under the banner.
function logoRect(bannerBottom) {
  const size = settings.logoSize;
  const k = Math.min(size / logo.height, (size * 2) / logo.width);
  const w = logo.width * k, h = logo.height * k;
  const M = 24;
  const pos = settings.logoPos;
  if (pos === 'center') return { x: W / 2 - w / 2, y: H / 2 - h / 2, w, h };
  const x = pos.endsWith('left') ? M : pos.endsWith('right') ? W - M - w : W / 2 - w / 2;
  const top = pos === 'top' && bannerBottom ? bannerBottom + 16 : M;
  return { x, y: pos.startsWith('top') ? top : H - M - h, w, h };
}

function drawLogo(bannerBottom) {
  if (!logo) return;
  const r = logoRect(bannerBottom);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(logo, r.x, r.y, r.w, r.h);
  ctx.restore();
}

// ── images ────────────────────────────────────────────────────

function setImage(k, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (imgs[k].url) URL.revokeObjectURL(imgs[k].url);
    setImg(k, { img, url, zoom: 100, x: 0, y: 0, fit: 'contain' });
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("That file couldn't be read as an image."); };
  img.src = url;
}

function clearImage(k) {
  if (imgs[k].url) URL.revokeObjectURL(imgs[k].url);
  setImg(k, { img: null, url: null });
}

// ── drawing helpers ───────────────────────────────────────────

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// Baseline that vertically centers the current font in a line box (like CSS).
function baselineIn(top, lineH, size) {
  const m = ctx.measureText('Hg');
  const asc = m.fontBoundingBoxAscent ?? size * 0.8;
  const desc = m.fontBoundingBoxDescent ?? size * 0.2;
  return top + (lineH - (asc + desc)) / 2 + asc;
}

// Largest size ≤ max at which the text fits maxW (sets ctx.font).
function fitSize(text, max, min, maxW) {
  let size = max;
  ctx.font = fontCss(size);
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = fontCss(size);
  }
  return size;
}

function wrap(text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Like CSS text-wrap: balance — the narrowest width that keeps the line count.
function balance(text, maxW) {
  const n = wrap(text, maxW).length;
  if (n < 2) return wrap(text, maxW);
  let lo = 0, hi = maxW;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(text, mid).length <= n) hi = mid; else lo = mid;
  }
  return wrap(text, hi);
}

const skew = (deg) => ctx.transform(1, 0, Math.tan(deg * DEG), 1, 0, 0);

function shapePath(g) {
  const x0 = -g.w / 2, y0 = -g.h / 2;
  ctx.beginPath();
  if (g.poly) g.poly.forEach(([fx, fy], i) => ctx[i ? 'lineTo' : 'moveTo'](x0 + fx * g.w, y0 + fy * g.h));
  else if (g.r) ctx.roundRect(x0, y0, g.w, g.h, g.r);
  else ctx.rect(x0, y0, g.w, g.h);
  ctx.closePath();
}

// The empty-panel 135° stripes.
function stripes(x0, y0, w, h) {
  ctx.fillStyle = STRIPE_A;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = STRIPE_B;
  ctx.lineWidth = 1.2 * U;
  ctx.beginPath();
  for (let c = 0; c < w + h; c += 2.4 * U * Math.SQRT2) {
    ctx.moveTo(x0 + c, y0);
    ctx.lineTo(x0 + c - h, y0 + h);
  }
  ctx.stroke();
}

function drawCover(img, x, y, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ── draw ──────────────────────────────────────────────────────

function drawPanel(k) {
  const g = GEO[settings.layout][k];
  const s = imgs[k];
  const color = settings[k].color;
  const x0 = -g.w / 2, y0 = -g.h / 2;
  ctx.save();
  ctx.translate(g.x + g.w / 2, g.y + g.h / 2);
  if (g.rot) ctx.rotate(g.rot * DEG);

  if (g.card) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowOffsetY = 2 * U;
    ctx.shadowBlur = 4 * U;
    ctx.fillStyle = STRIPE_A;
    shapePath(g);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  shapePath(g);
  ctx.clip();
  stripes(x0, y0, g.w, g.h);
  if (s.img) {
    if (s.fit === 'contain') {
      ctx.save();
      ctx.filter = `blur(${2.5 * U}px) brightness(0.6)`;
      drawCover(s.img, x0 - g.w * 0.05, y0 - g.h * 0.05, g.w * 1.1, g.h * 1.1);
      ctx.restore();
    }
    const fit = s.fit === 'contain' ? Math.min : Math.max;
    const f = fit(g.w / s.img.width, g.h / s.img.height);
    const dw = s.img.width * f, dh = s.img.height * f;
    const z = s.zoom / 100;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate((s.x / 100) * g.w, (s.y / 100) * g.h);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#7d8086';
    ctx.font = `400 ${1.3 * U}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${k.toUpperCase()} · drop image`, 0, 0);
  }
  const fade = ctx.createLinearGradient(0, -y0, 0, -y0 - g.h * 0.55);
  fade.addColorStop(0, rgba(color, 0.75));
  fade.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = fade;
  ctx.fillRect(x0, y0, g.w, g.h);
  ctx.restore();

  if (g.card) {
    const o = 0.25 * U;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5 * U;
    ctx.beginPath();
    ctx.roundRect(x0 - o, y0 - o, g.w + 2 * o, g.h + 2 * o, g.r + o);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDivider() {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  if (settings.layout === 'diagonal') ctx.rotate(12 * DEG);
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 2 * U;
  ctx.fillStyle = RULE;
  ctx.fillRect(-0.275 * U, -0.6 * H, 0.55 * U, 1.2 * H);
  ctx.restore();
}

// One headline line: the outline sits outside the glyphs (stroked at twice the
// thickness under the fill), slanted around its baseline, over the effect.
function drawTitleLine(t, x, y, color) {
  const ow = settings.outline, oc = settings.outlineColor;
  ctx.save();
  ctx.translate(x, y);
  if (settings.slant) skew(-settings.slant);
  ctx.lineJoin = 'round';
  ctx.lineWidth = ow * 2;
  ctx.strokeStyle = oc;
  const glyph = (dx = 0, dy = 0) => {
    if (ow) ctx.strokeText(t, dx, dy);
    ctx.fillText(t, dx, dy);
  };
  if (settings.effect === 'Stroke') {
    const d = 0.5 * U + ow / 2;
    ctx.fillStyle = oc;
    glyph(d, d);
  } else {
    const shadows = settings.effect === 'Shadow'
      ? [[0.6 * U, 2.2 * U, 'rgba(0,0,0,0.9)'], [0.2 * U, 0.4 * U, 'rgba(0,0,0,0.8)']]
      : [[0, 2.4 * U, color], [0, 0.8 * U, color], [0.3 * U, 0.4 * U, 'rgba(0,0,0,0.7)']];
    ctx.save();
    ctx.fillStyle = settings.textColor;
    for (const [dy, blur, c] of shadows) {
      ctx.shadowOffsetY = dy;
      ctx.shadowBlur = blur;
      ctx.shadowColor = c;
      glyph();
    }
    ctx.restore();
  }
  ctx.fillStyle = settings.textColor;
  glyph();
  ctx.restore();
}

// Skewed tag chip in the side color, its outer edge at x, its bottom at `bottom`.
function drawTag(t, x, bottom, isA, color) {
  const fs = 2.5 * U, padX = 1.2 * U, padY = 0.6 * U;
  ctx.font = fontCss(fs);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.03 * fs}px`;
  const bw = ctx.measureText(t).width + 2 * padX, bh = fs + 2 * padY;
  ctx.save();
  ctx.translate((isA ? x : x - bw) + bw / 2, bottom - bh / 2);
  skew(-8);
  ctx.fillStyle = color;
  ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
  ctx.fillStyle = TAG_INK;
  ctx.textAlign = 'center';
  ctx.fillText(t, 0, baselineIn(-fs / 2, fs, fs));
  ctx.restore();
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function drawSideText(k) {
  const d = settings[k], isA = k === 'a';
  const size = (settings.size / 100) * 8.5 * U, lineH = 0.9 * size;
  const x = isA ? 3.2 * U : W - 3.2 * U;
  const bottom = H - 3.2 * U;
  ctx.save();
  ctx.textAlign = isA ? 'left' : 'right';
  ctx.font = fontCss(size);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(settings.spacing / 100) * size}px`;
  const title = cased(d.title.trim());
  const lines = title ? balance(title, 44 * U) : [];
  const top = bottom - lines.length * lineH;
  lines.forEach((ln, i) => drawTitleLine(ln, x, baselineIn(top + i * lineH, lineH, size), d.color));
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const sub = cased(d.sub.trim());
  if (sub) drawTag(sub, x, lines.length ? top - 0.8 * U : bottom, isA, d.color);
  ctx.restore();
}

function drawBadge() {
  const R = 6.5 * U, ring = 0.6 * U;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-6 * DEG);
  const disc = (r) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); };
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowOffsetY = U;
  ctx.shadowBlur = 3 * U;
  ctx.fillStyle = BADGE;
  disc(R);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = rgba(BADGE, 0.6);
  disc(R + ring);
  ctx.fill();
  ctx.fillStyle = BADGE;
  disc(R);
  ctx.fill();
  ctx.strokeStyle = RULE;
  ctx.lineWidth = ring;
  disc(R - ring / 2);
  ctx.stroke();

  const vs = cased(settings.vs.trim() || 'VS');
  const fs = fitSize(vs, 6.4 * U, 2 * U, 2 * R - 2 * ring - 14);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.fillText(vs, 0, baselineIn(-fs / 2 + 0.2 * U, fs, fs));
  ctx.restore();
}

// Returns the banner's bottom edge (for a top-center logo), or 0 if hidden.
function drawBanner() {
  const t = cased(settings.banner.trim());
  if (!t) return 0;
  const padX = 2.2 * U, padY = 0.8 * U, top = 3 * U;
  const fs = fitSize(t, 4 * U, 2 * U, W - 200);
  const bw = ctx.measureText(t).width + 2 * padX, bh = fs + 2 * padY;
  ctx.save();
  ctx.translate(W / 2, top + bh / 2);
  skew(-8);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowOffsetY = 0.8 * U;
  ctx.shadowBlur = 2 * U;
  ctx.fillStyle = RULE;
  ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
  ctx.restore();
  ctx.fillStyle = BADGE;
  ctx.textAlign = 'center';
  ctx.fillText(t, 0, baselineIn(-fs / 2, fs, fs));
  ctx.restore();
  return top + bh;
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = settings.bg;
  ctx.fillRect(0, 0, W, H);
  for (const [k, cx] of [['a', 0.2 * W], ['b', 0.8 * W]]) {
    const r = 0.55 * Math.hypot(0.8 * W, H / 2); // 55% of the farthest corner
    const glow = ctx.createRadialGradient(cx, H / 2, 0, cx, H / 2, r);
    glow.addColorStop(0, rgba(settings[k].color, 0.35));
    glow.addColorStop(1, rgba(settings[k].color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  drawPanel('a');
  drawPanel('b');
  if (settings.layout !== 'cards') drawDivider();
  drawSideText('a');
  drawSideText('b');
  if (!logoInMiddle()) drawBadge();
  const bannerBottom = drawBanner();
  drawLogo(bannerBottom);
}

// ── interaction: drag to pan, wheel to zoom, drop to place ───

// Which side a point (canvas px) belongs to: the diagonal follows its slant.
function sideAt(x, y) {
  const split = settings.layout === 'diagonal' ? 0.56 * W - (0.12 * W * y) / H : W / 2;
  return x < split ? 'a' : 'b';
}
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const p = toCanvas(e);
  const k = sideAt(p.x, p.y);
  if (!imgs[k].img) return;
  drag = { k, px: p.x, py: p.y, x: imgs[k].x, y: imgs[k].y };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCanvas(e);
  const g = GEO[settings.layout][drag.k];
  const z = imgs[drag.k].zoom / 100;
  setImg(drag.k, {
    x: Math.round(clamp(drag.x + ((p.x - drag.px) / (g.w * z)) * 100, -40, 40)),
    y: Math.round(clamp(drag.y + ((p.y - drag.py) / (g.h * z)) * 100, -40, 40)),
  });
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  const p = toCanvas(e);
  const k = sideAt(p.x, p.y);
  if (!imgs[k].img) return;
  e.preventDefault();
  setImg(k, { zoom: Math.round(clamp(imgs[k].zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 50, 250)) });
}, { passive: false });

const wrapEl = $('canvas-wrap');
const hint = $('drop-hint');
wrapEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  const p = toCanvas(e);
  hint.hidden = false;
  $('drop-side').textContent = sideAt(p.x, p.y).toUpperCase();
});
wrapEl.addEventListener('dragleave', (e) => { if (!wrapEl.contains(e.relatedTarget)) hint.hidden = true; });
wrapEl.addEventListener('drop', (e) => {
  e.preventDefault();
  hint.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  if (files.length >= 2) { setImage('a', files[0]); setImage('b', files[1]); return; }
  const p = toCanvas(e);
  setImage(sideAt(p.x, p.y), files[0]);
});

// ── side panels ───────────────────────────────────────────────

const sideEls = {};

function buildSide(k) {
  const root = $(`side-${k}`);
  root.append($('side-tpl').content.cloneNode(true));
  const q = (sel) => root.querySelector(sel);
  const el = {
    root, drop: q('.tm-drop'), img: q('.tm-drop-img'), replace: q('.tm-drop-replace'), empty: q('.tm-drop-empty'),
    zoom: q('.js-zoom'), zoomOut: q('.js-zoom-out'), x: q('.js-x'), xOut: q('.js-x-out'), y: q('.js-y'), yOut: q('.js-y-out'),
    fit: q('.js-fit'), title: q('.js-title'), sub: q('.js-sub'), swatches: q('.js-swatches'),
  };
  q('.tm-side-label').textContent = SIDE_LABELS[k];
  q('.tm-side-key').textContent = `Side ${k.toUpperCase()}`;

  q('.js-file').addEventListener('change', (e) => { setImage(k, e.target.files[0]); e.target.value = ''; });
  el.drop.addEventListener('dragover', (e) => { e.preventDefault(); el.drop.classList.add('over'); });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'));
  el.drop.addEventListener('drop', (e) => { e.preventDefault(); el.drop.classList.remove('over'); setImage(k, e.dataTransfer.files[0]); });
  el.zoom.addEventListener('input', () => setImg(k, { zoom: +el.zoom.value }));
  el.x.addEventListener('input', () => setImg(k, { x: +el.x.value }));
  el.y.addEventListener('input', () => setImg(k, { y: +el.y.value }));
  el.fit.addEventListener('click', () => setImg(k, { fit: imgs[k].fit === 'contain' ? 'cover' : 'contain' }));
  q('.js-flip').addEventListener('click', () => setImg(k, { flip: !imgs[k].flip }));
  q('.js-clear').addEventListener('click', () => clearImage(k));
  el.title.addEventListener('input', () => setSide(k, { title: el.title.value }));
  el.sub.addEventListener('input', () => setSide(k, { sub: el.sub.value }));

  const pick = (color) => setSide(k, { color: color.toLowerCase() });
  el.swatchBtns = SWATCHES.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tm-swatch';
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', `Color ${c}`);
    b.addEventListener('click', () => pick(c));
    return b;
  });
  el.custom = document.createElement('label');
  el.custom.className = 'tm-swatch-custom';
  el.custom.title = 'Custom color';
  el.customInput = document.createElement('input');
  el.customInput.type = 'color';
  el.customInput.addEventListener('input', () => pick(el.customInput.value));
  el.custom.append(el.customInput);
  el.swatches.append(...el.swatchBtns, el.custom);
  sideEls[k] = el;
}

const setVal = (input, v) => { if (input.value !== String(v)) input.value = v; };

function renderSide(k) {
  const el = sideEls[k], s = imgs[k], d = settings[k];
  el.root.style.setProperty('--side', d.color);
  el.img.hidden = el.replace.hidden = !s.img;
  el.empty.hidden = !!s.img;
  if (s.img && el.img.src !== s.url) el.img.src = s.url;
  setVal(el.zoom, s.zoom); el.zoomOut.textContent = `${s.zoom}%`;
  setVal(el.x, s.x); el.xOut.textContent = s.x;
  setVal(el.y, s.y); el.yOut.textContent = s.y;
  el.fit.textContent = s.fit === 'contain' ? 'Fill frame' : 'Show whole image';
  setVal(el.title, d.title);
  setVal(el.sub, d.sub);
  const known = SWATCHES.includes(d.color);
  el.swatchBtns.forEach((b, i) => b.classList.toggle('on', SWATCHES[i] === d.color));
  el.custom.classList.toggle('on', !known);
  setVal(el.customInput, d.color);
}

// ── style cards ───────────────────────────────────────────────

function button(className, on, onClick, ...children) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${className}${on ? ' on' : ''}`;
  b.append(...children);
  b.addEventListener('click', onClick);
  return b;
}
const tag = (name, text) => { const e = document.createElement(name); if (text != null) e.textContent = text; return e; };

function renderFonts() {
  const cur = currentFont();
  $('font-name').textContent = cur.name;
  $('fonts').replaceChildren(...allFonts().map((f) => {
    const sample = tag('b', 'Vs');
    sample.style.fontFamily = f.css;
    sample.style.fontWeight = f.w;
    const b = button('tm-font', f.name === cur.name, () => { set({ font: f.name }); ensureFont(); }, sample, tag('small', f.name));
    b.title = f.name;
    return b;
  }));
}

function miniShape(g, color) {
  const i = document.createElement('i');
  Object.assign(i.style, {
    left: `${(g.x / W) * 100}%`, top: `${(g.y / H) * 100}%`,
    width: `${(g.w / W) * 100}%`, height: `${(g.h / H) * 100}%`,
    transform: g.rot ? `rotate(${g.rot}deg)` : '',
    clipPath: g.poly ? `polygon(${g.poly.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(',')})` : '',
    borderRadius: g.card ? '2px' : '0',
    background: color,
  });
  return i;
}

function renderLayouts() {
  $('layouts').replaceChildren(...Object.keys(GEO).map((id) => {
    const mini = tag('div');
    mini.className = 'tm-mini';
    mini.append(miniShape(GEO[id].a, settings.a.color), miniShape(GEO[id].b, settings.b.color));
    return button('tm-layout', id === settings.layout, () => set({ layout: id }), mini, LAYOUT_NAMES[id]);
  }));
  $('effects').replaceChildren(...EFFECTS.map((n) => button('', n === settings.effect, () => set({ effect: n }), n)));
}

function renderPresets() {
  $('presets').replaceChildren(...Object.values(PRESETS).map((p) => {
    const on = p.a === settings.a.color && p.b === settings.b.color && p.bg === settings.bg;
    const sw = tag('span');
    sw.className = 'tm-chip-sw';
    for (const c of [p.a, p.b, p.bg]) { const i = tag('i'); i.style.background = c; sw.append(i); }
    return button('tm-chip', on, () => set({ a: { ...settings.a, color: p.a }, b: { ...settings.b, color: p.b }, bg: p.bg }), sw, p.label);
  }));
}

// Plain inputs bound straight to a setting.
const GLOBAL_INPUTS = {
  size: ['size', Number], upper: ['upper', Boolean],
  outline: ['outline', Number], spacing: ['spacing', Number], slant: ['slant', Number],
  'text-color': ['textColor', String], 'outline-color': ['outlineColor', String], vs: ['vs', String], banner: ['banner', String],
  safe: ['safe', Boolean], bg: ['bg', String], 'logo-pos': ['logoPos', String], 'logo-size': ['logoSize', Number],
};

function bindGlobals() {
  for (const [id, [key, type]] of Object.entries(GLOBAL_INPUTS)) {
    const el = $(id);
    el.addEventListener('input', () => set({ [key]: type === Boolean ? el.checked : type(el.value) }));
  }
  $('banner-presets').replaceChildren(...BANNER_PRESETS.map((t) => button('tm-chip', false, () => set({ banner: t }), t)));
}

function renderGlobals() {
  for (const [id, [key, type]] of Object.entries(GLOBAL_INPUTS)) {
    const el = $(id);
    if (type === Boolean) el.checked = !!settings[key]; else setVal(el, settings[key]);
  }
  $('size-out').textContent = settings.size;
  $('outline-out').textContent = settings.outline;
  $('spacing-out').textContent = settings.spacing;
  $('slant-out').textContent = `${settings.slant}°`;
  $('logo-size-out').textContent = settings.logoSize;
  $('vs').disabled = logoInMiddle();
  $('safe-zone').hidden = !settings.safe;
}

function render() {
  renderSide('a');
  renderSide('b');
  renderFonts();
  renderLayouts();
  renderPresets();
  renderGlobals();
}

// ── header actions ────────────────────────────────────────────

const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

$('btn-download').addEventListener('click', async () => {
  const blob = await toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vs-thumbnail.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Exported vs-thumbnail.png · 1280×720');
});

$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]);
    toast('Copied to the clipboard.');
  } catch {
    toast("This browser can't copy images — use Export PNG.");
  }
});

$('btn-swap').addEventListener('click', () => {
  imgs = { a: imgs.b, b: imgs.a };
  set({ a: settings.b, b: settings.a });
});

// Back to the starting thumbnail. Added fonts and the team logo stay.
$('btn-reset').addEventListener('click', () => {
  clearImage('a');
  clearImage('b');
  imgs = { a: freshImg(), b: freshImg() };
  set({ ...structuredClone(DEFAULTS), extraFonts: settings.extraFonts, logoPos: settings.logoPos, logoSize: settings.logoSize });
  ensureFont();
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

// ── start ─────────────────────────────────────────────────────

buildSide('a');
buildSide('b');
bindGlobals();
$('font-add').addEventListener('click', () => addFont($('font-custom').value));
$('font-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFont($('font-custom').value); });
$('font-file').addEventListener('change', (e) => { loadFontFile(e.target.files[0]); e.target.value = ''; });
$('font-browse').hidden = !('queryLocalFonts' in window);
$('font-browse').addEventListener('click', browseLocalFonts);
$('font-local').addEventListener('change', (e) => { if (e.target.value) addFont(e.target.value); e.target.value = ''; });
$('logo-file').addEventListener('change', (e) => { setLogo(e.target.files[0]); e.target.value = ''; });
$('logo-clear').addEventListener('click', clearLogo);
render();
restoreLogo();
draw();
ensureFont();
// Redraw once web/system fonts settle, so the first frame isn't a fallback face.
document.fonts?.ready.then(draw);
