// Riftbound Thumbnail Maker — a 1280×720 YouTube thumbnail drawn on a canvas:
// a legend image on each side (slanted panels), the two player names with a
// big "VS" between them in the middle. Everything is local: images are read
// with object URLs and never uploaded; settings (not images) are remembered
// in localStorage.

const W = 1280, H = 720;
const STORE_KEY = 'rb-thumbnail-settings';
const LOGO_KEY = 'rb-thumbnail-logo'; // team logo as a (downscaled) data URL
const LOGO_MAX = 600;                 // px — logos are scaled down to this before saving

// Panel geometry: each side is a slanted quad; the middle band sits between.
const SLANT = 90;
const LEFT_TOP = 520, RIGHT_TOP = 850;            // x where the panels meet the top edge
const PANELS = {
  left:  [[0, 0], [LEFT_TOP, 0], [LEFT_TOP - SLANT, H], [0, H]],
  right: [[RIGHT_TOP, 0], [W, 0], [W, H], [RIGHT_TOP - SLANT, H]],
};
const CENTER_X = (LEFT_TOP + RIGHT_TOP - SLANT) / 2;
const NAME_MAX_W = 470;

// Always-available fallbacks before (or without) Local Font Access.
const DEFAULT_FONTS = [
  'Impact', 'Arial Black', 'Bahnschrift', 'Segoe UI', 'Trebuchet MS', 'Verdana',
  'Georgia', 'Times New Roman', 'Courier New', 'Helvetica Neue', 'Futura', 'Avenir Next',
  'system-ui', 'sans-serif', 'serif',
];

const $ = (id) => document.getElementById(id);
const canvas = $('thumb');
const ctx = canvas.getContext('2d');

const DEFAULTS = {
  p1: 'Player One', p2: 'Player Two', vs: 'VS', event: '',
  font: 'Impact', fontCustom: '', bold: true, italic: false, upper: true,
  cText: '#ffffff', cVs: '#ffc23d', cAccent: '#3d9bff', cBg: '#0b1020', cStroke: '#05070f',
  stroke: 8, glow: true,
  logoPos: 'top', logoSize: 130,
};

// Color presets. Each sets the five colors (+ outline/glow); everything
// else — names, font, logo — is left alone.
const PRESETS = {
  default: { label: 'Default', cText: '#ffffff', cVs: '#ffc23d', cAccent: '#3d9bff', cBg: '#0b1020', cStroke: '#05070f', stroke: 8, glow: true },
  ff:      { label: 'FF',      cText: '#ffffff', cVs: '#f6d93b', cAccent: '#dc661e', cBg: '#71300f', cStroke: '#2a1006', stroke: 8, glow: true },
};
const PRESET_KEYS = ['cText', 'cVs', 'cAccent', 'cBg', 'cStroke', 'stroke', 'glow'];
const SETTING_INPUTS = {
  p1: 'p1', p2: 'p2', vs: 'vs', event: 'event', fontCustom: 'font-custom',
  bold: 'bold', italic: 'italic', upper: 'upper',
  cText: 'c-text', cVs: 'c-vs', cAccent: 'c-accent', cBg: 'c-bg', cStroke: 'c-stroke',
  stroke: 'stroke', glow: 'glow',
  logoPos: 'logo-pos', logoSize: 'logo-size',
};

let settings = loadSettings();
// Per-side image + framing: zoom ≥ 1 (1 = cover the panel), pan in canvas px.
const sides = {
  left:  { img: null, url: null, zoom: 1, panX: 0, panY: 0, flip: false },
  right: { img: null, url: null, zoom: 1, panX: 0, panY: 0, flip: false },
};

// ── settings ──────────────────────────────────────────────────

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY)) }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

function bindSettings() {
  for (const [key, id] of Object.entries(SETTING_INPUTS)) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key];
    el.addEventListener('input', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      saveSettings();
      renderPresets();
      draw();
    });
  }
  $('font-select').addEventListener('change', (e) => {
    settings.font = e.target.value;
    settings.fontCustom = '';
    $('font-custom').value = '';
    saveSettings();
    draw();
  });
}

// ── presets ───────────────────────────────────────────────────

function renderPresets() {
  const box = $('presets');
  box.replaceChildren(...Object.entries(PRESETS).map(([id, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    const active = PRESET_KEYS.every((k) => String(settings[k]).toLowerCase() === String(p[k]).toLowerCase());
    b.className = `tm-preset${active ? ' active' : ''}`;
    const sw = document.createElement('span');
    sw.className = 'tm-swatches';
    for (const c of [p.cAccent, p.cVs, p.cBg]) { const i = document.createElement('i'); i.style.background = c; sw.append(i); }
    b.append(sw, p.label);
    b.addEventListener('click', () => applyPreset(id));
    return b;
  }));
}

function applyPreset(id) {
  const p = PRESETS[id];
  for (const k of PRESET_KEYS) settings[k] = p[k];
  saveSettings();
  bindValues();
  renderPresets();
  draw();
}

// ── team logo ─────────────────────────────────────────────────

let logo = null; // HTMLImageElement

function showLogo(img) {
  logo = img;
  const thumb = $('logo-thumb');
  if (img) { const t = new Image(); t.src = img.src; t.alt = 'Team logo'; thumb.replaceChildren(t); }
  else thumb.textContent = 'None';
  $('logo-clear').hidden = !img;
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

// Contain-fit the logo into a box `size` tall (up to 2× as wide), anchored by
// position. 'center' replaces the VS text, centered on the text block's middle.
const logoInMiddle = () => !!logo && settings.logoPos === 'center';
function logoRect(mid = H / 2) {
  if (!logo) return null;
  const size = settings.logoSize;
  const k = Math.min(size / logo.height, (size * 2) / logo.width);
  const w = logo.width * k, h = logo.height * k;
  const M = 24;
  const pos = settings.logoPos;
  const bottomY = H - M - h - (settings.event.trim() && pos === 'bottom' ? 110 : 0);
  const x = pos.endsWith('left') ? M : pos.endsWith('right') ? W - M - w : CENTER_X - w / 2;
  if (pos === 'center') return { x: CENTER_X - w / 2, y: mid - h / 2, w, h };
  const y = pos.startsWith('top') ? M : bottomY;
  return { x, y, w, h };
}

function drawLogo(mid) {
  const r = logoRect(mid);
  if (!r) return;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(logo, r.x, r.y, r.w, r.h);
  ctx.restore();
}

// ── fonts ─────────────────────────────────────────────────────

function fillFontSelect(families) {
  const sel = $('font-select');
  const list = [...new Set([...(families.includes(settings.font) ? [] : [settings.font]), ...families])];
  sel.replaceChildren(...list.map((f) => {
    const o = document.createElement('option');
    o.value = f; o.textContent = f; o.style.fontFamily = `"${f}"`;
    return o;
  }));
  sel.value = settings.font;
}

// Local Font Access API (Chrome/Edge): lists every installed font family. It
// needs a click and asks for permission; other browsers can still type a name.
async function loadLocalFonts() {
  const note = $('font-note');
  if (!('queryLocalFonts' in window)) {
    note.textContent = "This browser can't list installed fonts — type a font name instead.";
    return;
  }
  try {
    const fonts = await window.queryLocalFonts();
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    if (!families.length) { note.textContent = 'No fonts were shared.'; return; }
    fillFontSelect(families);
    note.textContent = `${families.length} installed fonts`;
  } catch {
    note.textContent = 'Font access was blocked — allow it in the site settings, or type a font name.';
  }
}

const fontFamily = () => (settings.fontCustom.trim() || settings.font);
function fontCss(size) {
  const fam = fontFamily();
  const generic = /^(system-ui|sans-serif|serif|monospace)$/.test(fam);
  return `${settings.italic ? 'italic ' : ''}${settings.bold ? '800 ' : '400 '}${size}px ${generic ? fam : `"${fam}"`}, Impact, sans-serif`;
}

// ── images ────────────────────────────────────────────────────

function setImage(side, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const s = sides[side];
  if (s.url) URL.revokeObjectURL(s.url);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    Object.assign(s, { img, url, zoom: 1, panX: 0, panY: 0 });
    $(`zoom-${side}`).value = 1;
    document.querySelector(`[data-clear="${side}"]`).hidden = false;
    draw();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("That file couldn't be read as an image."); };
  img.src = url;
}

function clearImage(side) {
  const s = sides[side];
  if (s.url) URL.revokeObjectURL(s.url);
  Object.assign(s, { img: null, url: null, zoom: 1, panX: 0, panY: 0 });
  document.querySelector(`[data-clear="${side}"]`).hidden = true;
  $(`zoom-${side}`).value = 1;
  draw();
}

const bounds = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

function quadPath(pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// Cover-fit the image into the panel's bounding box, then apply zoom/pan.
function drawPanel(side) {
  const s = sides[side];
  const pts = PANELS[side];
  const b = bounds(pts);
  ctx.save();
  quadPath(pts);
  ctx.clip();
  if (s.img) {
    const scale = Math.max(b.w / s.img.width, b.h / s.img.height) * s.zoom;
    const dw = s.img.width * scale, dh = s.img.height * scale;
    const cx = b.x + b.w / 2 + s.panX, cy = b.y + b.h / 2 + s.panY;
    ctx.translate(cx, cy);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -dw / 2, -dh / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
    g.addColorStop(0, side === 'left' ? shade(settings.cAccent, -0.55) : shade(settings.cBg, 0.12));
    g.addColorStop(1, side === 'left' ? shade(settings.cBg, 0.12) : shade(settings.cAccent, -0.55));
    ctx.fillStyle = g;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Drop ${side} legend image`, b.x + b.w / 2 - (side === 'left' ? 30 : -30), H / 2);
  }
  ctx.restore();
}

// Lighten (amt > 0) or darken (amt < 0) a hex color.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

// ── text ──────────────────────────────────────────────────────

// Largest size ≤ max at which the text fits maxW.
function fitSize(text, max, min, maxW) {
  let size = max;
  ctx.font = fontCss(size);
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = fontCss(size);
  }
  return size;
}

function drawText(text, x, y, size, fill, { glow = settings.glow, glowColor = settings.cAccent } = {}) {
  ctx.font = fontCss(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (settings.stroke > 0) {
    ctx.save();
    if (glow) { ctx.shadowColor = glowColor; ctx.shadowBlur = 28; }
    ctx.strokeStyle = settings.cStroke;
    ctx.lineWidth = settings.stroke * 2;
    ctx.strokeText(text, x, y);
    ctx.restore();
  } else if (glow) {
    ctx.save();
    ctx.shadowColor = glowColor; ctx.shadowBlur = 28;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

const cased = (t) => (settings.upper ? t.toUpperCase() : t);

// ── draw ──────────────────────────────────────────────────────

function draw() {
  ctx.clearRect(0, 0, W, H);
  $('vs').disabled = logoInMiddle();

  // Background: dark base with an accent glow behind the middle.
  ctx.fillStyle = settings.cBg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(CENTER_X, H / 2, 20, CENTER_X, H / 2, 520);
  glow.addColorStop(0, shade(settings.cAccent, -0.35));
  glow.addColorStop(1, settings.cBg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  drawPanel('left');
  drawPanel('right');

  // Glowing accent edges along both slants.
  ctx.save();
  ctx.strokeStyle = settings.cAccent;
  ctx.lineWidth = 7;
  ctx.shadowColor = settings.cAccent;
  ctx.shadowBlur = 24;
  for (const [a, b] of [[PANELS.left[1], PANELS.left[2]], [PANELS.right[0], PANELS.right[3]]]) {
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
  }
  ctx.restore();

  // Players and VS.
  const p1 = cased(settings.p1.trim() || 'Player One');
  const p2 = cased(settings.p2.trim() || 'Player Two');
  const vs = cased(settings.vs.trim() || 'VS');
  const nameSize = Math.min(fitSize(p1, 92, 30, NAME_MAX_W), fitSize(p2, 92, 30, NAME_MAX_W));
  const hasEvent = !!settings.event.trim();
  // Make room for a center logo: push the text block away from it.
  const lr = logoRect();
  const shift = !lr ? 0 : settings.logoPos === 'top' ? lr.h * 0.45 : settings.logoPos === 'bottom' ? -lr.h * 0.45 : 0;
  const mid = (hasEvent ? H / 2 - 30 : H / 2) + shift;
  // A big middle logo pushes the names apart so they don't overlap it.
  const gap = logoInMiddle() ? Math.max(150, logoRect(mid).h / 2 + nameSize * 0.55 + 12) : 150;
  drawText(p1, CENTER_X, mid - gap, nameSize, settings.cText);
  if (!logoInMiddle()) drawText(vs, CENTER_X, mid, fitSize(vs, 170, 60, 360), settings.cVs, { glowColor: settings.cVs });
  drawText(p2, CENTER_X, mid + gap, nameSize, settings.cText);

  // Event banner along the bottom.
  if (hasEvent) {
    const text = cased(settings.event.trim());
    const size = fitSize(text, 40, 18, 760);
    ctx.font = fontCss(size);
    const w = Math.min(820, ctx.measureText(text).width + 70);
    const y = H - 70;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeStyle = settings.cAccent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(CENTER_X - w / 2, y - size * 0.85, w, size * 1.7, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    drawText(text, CENTER_X, y, size, settings.cText, { glow: false });
  }

  drawLogo(mid);
}

// ── interaction: drag to pan, wheel to zoom, drop to place ───

// Which side a point (in canvas px) belongs to: split at the middle band.
const sideAt = (x) => (x < CENTER_X ? 'left' : 'right');
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, k: W / r.width };
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const p = toCanvas(e);
  const side = sideAt(p.x);
  if (!sides[side].img) return;
  drag = { side, x: p.x, y: p.y, panX: sides[side].panX, panY: sides[side].panY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCanvas(e);
  const s = sides[drag.side];
  s.panX = drag.panX + (p.x - drag.x);
  s.panY = drag.panY + (p.y - drag.y);
  draw();
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  const side = sideAt(toCanvas(e).x);
  const s = sides[side];
  if (!s.img) return;
  e.preventDefault();
  s.zoom = Math.min(3, Math.max(1, s.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
  $(`zoom-${side}`).value = s.zoom;
  draw();
}, { passive: false });

const wrap = $('canvas-wrap');
const hint = $('drop-hint');
wrap.addEventListener('dragover', (e) => {
  e.preventDefault();
  hint.hidden = false;
  $('drop-side').textContent = sideAt(toCanvas(e).x);
});
wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) hint.hidden = true; });
wrap.addEventListener('drop', (e) => {
  e.preventDefault();
  hint.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  if (files.length >= 2) { setImage('left', files[0]); setImage('right', files[1]); return; }
  setImage(sideAt(toCanvas(e).x), files[0]);
});

for (const side of ['left', 'right']) {
  $(`img-${side}`).addEventListener('change', (e) => { setImage(side, e.target.files[0]); e.target.value = ''; });
  $(`zoom-${side}`).addEventListener('input', (e) => { sides[side].zoom = Number(e.target.value); draw(); });
  $(`flip-${side}`).addEventListener('change', (e) => { sides[side].flip = e.target.checked; draw(); });
  document.querySelector(`[data-clear="${side}"]`).addEventListener('click', () => clearImage(side));
}

// ── export ────────────────────────────────────────────────────

const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
const fileName = () => {
  const slug = (t) => t.trim().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${[slug(settings.p1), 'vs', slug(settings.p2)].filter(Boolean).join('-') || 'thumbnail'}.png`;
};

$('btn-download').addEventListener('click', async () => {
  const blob = await toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]);
    toast('Copied to the clipboard.');
  } catch {
    toast("This browser can't copy images — use Download PNG.");
  }
});

$('btn-reset').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  saveSettings();
  clearImage('left');
  clearImage('right');
  for (const side of ['left', 'right']) { sides[side].flip = false; $(`flip-${side}`).checked = false; }
  clearLogo();
  bindValues();
  renderPresets();
  fillFontSelect(DEFAULT_FONTS);
  draw();
});

function bindValues() {
  for (const [key, id] of Object.entries(SETTING_INPUTS)) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
  }
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

// ── start ─────────────────────────────────────────────────────

$('btn-local-fonts').addEventListener('click', loadLocalFonts);
if (!('queryLocalFonts' in window)) $('font-note').textContent = 'Type any installed font name below if it isn\'t listed.';
$('logo-file').addEventListener('change', (e) => { setLogo(e.target.files[0]); e.target.value = ''; });
$('logo-clear').addEventListener('click', clearLogo);
fillFontSelect(DEFAULT_FONTS);
bindSettings();
renderPresets();
restoreLogo();
draw();
// Redraw once web/system fonts settle, so the first frame isn't a fallback face.
document.fonts?.ready.then(draw);
