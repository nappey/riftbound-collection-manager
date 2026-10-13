// Riftbound Set Entry — standalone, static, no build step.
// Ports the desktop app's Set Entry wizard + CSV import/export logic
// (collection-manager/src/pages/SetEntry.jsx, src/utils/csvImport.js,
// src/games/riftbound.js) into vanilla JS so it can run as a plain
// GitHub Pages site with no backend. Card data is fetched live from the
// same public riftcodex API the desktop app uses.

// ── Constants ────────────────────────────────────────────────
const API_BASE = 'https://api.riftcodex.com';
const PAGE_SIZE = 100;

// Matches collection-manager/src/games/riftboundRules.js's SETS order.
const SET_ORDER = ['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'RAD', 'OPP', 'PR', 'JDG', 'RWB'];
const SET_LABELS = {
  OGN: 'Origins', OGS: 'Proving Grounds', SFD: 'Spiritforged', UNL: 'Unleashed',
  VEN: 'Vendetta', RAD: 'Radiance', OPP: 'Organized Play Promos', PR: 'Promotional Cards',
  JDG: 'Judge Promos', RWB: 'Worlds Bundle 2025',
};
const PROMO_FOLD_SETS = new Set(['OPP', 'PR', 'JDG', 'RWB']);
const PROMO_SHORT = { OPP: 'OP Promo', PR: 'Promo', JDG: 'Judge', RWB: 'Worlds' };
const FOIL_RARITIES = new Set(['rare', 'showcase', 'epic', 'promo']);

// Sentinel set id for "All Sets" — step through every real set's cards for a
// domain in one pass, for a mixed/unsorted pile.
const ALL_SETS = '__all__';

const LS_KEYS = { collection: 'rbse-collection', foil: 'rbse-foilCollection', progress: 'rbse-progress' };

// ── Card rule helpers (ported from riftboundRules.js) ──────────
function isAlwaysFoil(card) {
  const rarity = card.classification?.rarity?.toLowerCase() ?? '';
  return card.metadata?.alternate_art === true || FOIL_RARITIES.has(rarity);
}
function isSingleton(card) {
  const t = card.classification?.type;
  return t === 'Legend' || t === 'Battlefield';
}
function isBattlefield(card) {
  return card.classification?.type === 'Battlefield';
}

// ── API fetch (ported from src/games/riftbound.js) ─────────────
async function fetchAllCards() {
  const first = await fetch(`${API_BASE}/cards?size=${PAGE_SIZE}&page=1`, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
  });
  const remaining = [];
  for (let p = 2; p <= first.pages; p++) {
    remaining.push(fetch(`${API_BASE}/cards?size=${PAGE_SIZE}&page=${p}`, { cache: 'no-store' }).then((r) => r.json()));
  }
  const rest = await Promise.all(remaining);
  return [first, ...rest].flatMap((d) => d.items);
}

// ── CSV utilities (ported verbatim from src/utils/csvImport.js) ─
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
}
function csvField(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows) {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n');
}
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
}
function buildRidMap(cards) {
  const map = {};
  for (const card of cards) {
    const rid = card.riftbound_id;
    if (!rid) continue;
    const key = rid.replace(/-\d+$/, '');
    if (!map[key]) map[key] = card;
  }
  return map;
}
function normalizeVariantNumber(varNum) {
  return varNum.toLowerCase().replace(/-prerelease$/, '').replace(/-promo$/, '').replace(/-\w+promo$/, '');
}
function matchCSVRows(rows, ridMap, cards) {
  const nameMap = {};
  for (const card of cards) {
    const key = `${card.set?.set_id ?? ''}|${card.name}`.toLowerCase();
    nameMap[key] = card;
  }
  const updates = {}, foilUpdates = {}, unmatched = [];
  for (const row of rows) {
    const qty = parseInt(row['Quantity'], 10);
    if (!qty || qty <= 0) continue;
    const varNum = row['Variant Number'] ?? '';
    const setPrefix = (row['Set Prefix'] ?? '').toLowerCase();
    const cardName = (row['Card Name'] ?? '').toLowerCase();
    const ridKey = normalizeVariantNumber(varNum);
    let card = ridMap[ridKey];
    if (!card) card = nameMap[`${setPrefix}|${cardName}`];
    if (card) {
      const variantType = (row['Variant Type'] ?? '').toLowerCase();
      const isFoilRow = variantType === 'foil' || isAlwaysFoil(card);
      if (isFoilRow) foilUpdates[card.id] = (foilUpdates[card.id] ?? 0) + qty;
      else updates[card.id] = (updates[card.id] ?? 0) + qty;
    } else {
      unmatched.push(varNum);
    }
  }
  return { updates, foilUpdates, unmatched };
}

// ── Riftbound CSV glue ("Piltover Archive" format, ported from
//    src/games/riftbound.js) ────────────────────────────────────
function variantNumber(card) {
  const rid = card.riftbound_id;
  if (rid) return rid.replace(/-\d+$/, '').toUpperCase();
  const num = String(card.collector_number ?? '').padStart(3, '0');
  return `${card.set?.set_id ?? 'UNK'}-${num}`;
}
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function generateCSV(allCards, collection, foilCollection) {
  const rows = [[
    'Variant Number', 'Card Name', 'Set', 'Set Prefix', 'Rarity',
    'Variant Type', 'Variant Label', 'Quantity', 'Language', 'Condition',
    'Grading Company', 'Grading Value', 'Grading Label', 'Notes',
  ]];
  for (const card of allCards) {
    const count = collection[card.id] ?? 0;
    const foilCount = foilCollection[card.id] ?? 0;
    if (count === 0 && foilCount === 0) continue;
    const varNum = variantNumber(card);
    const setId = card.set?.set_id ?? '';
    const setName = SET_LABELS[setId] ?? card.set?.label ?? setId;
    const rarity = capitalize(card.classification?.rarity ?? '');
    const isAlt = card.metadata?.alternate_art;
    if (count > 0) {
      rows.push([varNum, card.name, setName, setId, rarity, isAlt ? 'Alt Art' : 'Standard', isAlt ? 'Alt Art' : 'Standard', count, 'English', 'Near Mint', '', '', '', '']);
    }
    if (foilCount > 0) {
      rows.push([varNum, card.name, setName, setId, rarity, 'Foil', 'Foil', foilCount, 'English', 'Near Mint', '', '', '', '']);
    }
  }
  return toCSV(rows);
}
function matchCSV(rows, allCards) {
  return matchCSVRows(rows, buildRidMap(allCards), allCards);
}

// ── Persisted state (localStorage — this page has no desktop app
//    collection behind it) ──────────────────────────────────────
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
}

const State = {
  allCards: [],
  promoByName: {},
  collection: loadJSON(LS_KEYS.collection, {}),
  foilCollection: loadJSON(LS_KEYS.foil, {}),
  progress: loadJSON(LS_KEYS.progress, {}), // "<setId>:<domain>" -> index, survives reloads
  session: null, // { cards, setId, domain, key, index }
};

function adjust(cardId, delta) {
  const val = (State.collection[cardId] ?? 0) + delta;
  if (val <= 0) delete State.collection[cardId]; else State.collection[cardId] = val;
  saveJSON(LS_KEYS.collection, State.collection);
}
function adjustFoil(cardId, delta) {
  const val = (State.foilCollection[cardId] ?? 0) + delta;
  if (val <= 0) delete State.foilCollection[cardId]; else State.foilCollection[cardId] = val;
  saveJSON(LS_KEYS.foil, State.foilCollection);
}
function setCount(card, n) {
  const delta = n - (State.collection[card.id] ?? 0);
  if (delta !== 0) adjust(card.id, delta);
}
function setFoilCount(card, n) {
  const delta = n - (State.foilCollection[card.id] ?? 0);
  if (delta !== 0) adjustFoil(card.id, delta);
}
function setProgress(key, index) {
  State.progress[key] = index;
  saveJSON(LS_KEYS.progress, State.progress);
}

// ── Toast ────────────────────────────────────────────────────
let toastTimer = null;
function showToast(html, ms = 5000) {
  const el = document.getElementById('toast');
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Allowlist a value for use as a CSS custom-property fragment (e.g. the
// domain name inside `var(--d-${...})`) — strips anything but lowercase
// letters/digits/hyphen so card data can never inject CSS/HTML there,
// independent of escapeHtml's attribute-boundary escaping.
function cssIdent(s) {
  const cleaned = String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return cleaned || 'none';
}

// ── Sorting / filtering ─────────────────────────────────────
function sortByEnergy(cards) {
  return [...cards].sort((a, b) => {
    const ea = a.attributes?.energy, eb = b.attributes?.energy;
    if (ea == null && eb == null) return (a.collector_number ?? 0) - (b.collector_number ?? 0);
    if (ea == null) return 1;
    if (eb == null) return -1;
    if (ea !== eb) return ea - eb;
    return (a.collector_number ?? 0) - (b.collector_number ?? 0);
  });
}
function inSet(card, selectedSet) {
  return selectedSet === ALL_SETS || card.set?.set_id === selectedSet;
}

// ── Config screen (port of SetEntry.jsx's ConfigScreen) ─────────
let cfgSelectedSet = '';
let cfgSelectedDomain = '';

function realSets() {
  const seen = new Set();
  for (const c of State.allCards) {
    if (c.set?.set_id && c.classification?.type !== 'Rune') seen.add(c.set.set_id);
  }
  return [...seen].sort((a, b) => {
    const ia = SET_ORDER.indexOf(a), ib = SET_ORDER.indexOf(b);
    return (ia === -1 ? SET_ORDER.length : ia) - (ib === -1 ? SET_ORDER.length : ib) || a.localeCompare(b);
  });
}
function domainsFor(selectedSet) {
  if (!selectedSet) return [];
  const seen = new Set();
  for (const c of State.allCards) {
    if (inSet(c, selectedSet)) (c.classification?.domain ?? []).forEach((d) => seen.add(d));
  }
  return [...seen].sort();
}
function sliceFor(selectedSet, selectedDomain) {
  return State.allCards.filter((c) =>
    inSet(c, selectedSet) &&
    (c.classification?.domain ?? []).includes(selectedDomain) &&
    !c.metadata?.alternate_art
  );
}

function renderConfigScreen() {
  const app = document.getElementById('app');
  const sets = realSets();
  const domains = domainsFor(cfgSelectedSet);
  const cardCount = cfgSelectedSet && cfgSelectedDomain ? sliceFor(cfgSelectedSet, cfgSelectedDomain).length : 0;

  app.innerHTML = `
    <div class="se-config">
      <div class="se-config-head">
        <h2>Set Entry</h2>
        <p>Step through cards one set &amp; domain at a time. Keyboard-first. Export/import CSV any time.</p>
      </div>
      <div class="se-config-form">
        <div class="se-config-field">
          <label>Set</label>
          <div class="chip-list" id="set-chips">
            <button type="button" class="chip chip-all${cfgSelectedSet === ALL_SETS ? ' active' : ''}" data-set="${ALL_SETS}" title="Step through every set's cards together, grouped only by domain and cost">✨ All sets (mixed)</button>
            ${sets.map((s) => `<button type="button" class="chip${cfgSelectedSet === s ? ' active' : ''}" data-set="${escapeHtml(s)}">${escapeHtml(SET_LABELS[s] ?? s)}</button>`).join('')}
          </div>
        </div>
        <div class="se-config-field">
          <label>Domain${!cfgSelectedSet ? '<span class="se-config-dim">(choose a set first)</span>' : ''}</label>
          <div class="chip-list" id="domain-chips">
            ${domains.map((d) => `<button type="button" class="chip${cfgSelectedDomain === d ? ' active' : ''}" data-domain="${escapeHtml(d)}"><span class="chip-dot" style="--c: var(--d-${cssIdent(d)})"></span>${escapeHtml(d)}</button>`).join('')}
            ${!cfgSelectedSet ? '<span style="font-size:12px;color:var(--text-3);padding:4px 8px;">—</span>' : ''}
          </div>
        </div>
        <div class="se-config-summary">
          <span>${cardCount > 0 ? `${cardCount} cards in this slice` : 'Select a set and domain'}</span>
          <button type="button" class="btn primary" id="btn-start" ${(!cfgSelectedSet || !cfgSelectedDomain) ? 'disabled' : ''}>Start →</button>
        </div>
      </div>
    </div>
  `;

  app.querySelectorAll('#set-chips .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      cfgSelectedSet = btn.dataset.set;
      cfgSelectedDomain = '';
      renderConfigScreen();
    });
  });
  app.querySelectorAll('#domain-chips .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      cfgSelectedDomain = btn.dataset.domain;
      renderConfigScreen();
    });
  });
  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.addEventListener('click', startSession);
}

function startSession() {
  if (!cfgSelectedSet || !cfgSelectedDomain) return;
  const cards = sortByEnergy(sliceFor(cfgSelectedSet, cfgSelectedDomain));
  if (!cards.length) return;
  const key = `${cfgSelectedSet}:${cfgSelectedDomain}`;
  const index = Math.min(State.progress[key] ?? 0, cards.length - 1);
  State.session = { cards, setId: cfgSelectedSet, domain: cfgSelectedDomain, key, index };
  renderEntryScreen();
}
function endSession() {
  State.session = null;
  renderConfigScreen();
}

// ── Entry screen (port of SetEntry.jsx's CardEntryScreen) ───────
function cardPromos(card) {
  const list = State.promoByName[card.name.toLowerCase().trim()] ?? [];
  return list.map((p) => ({
    card: p,
    label: PROMO_SHORT[p.set?.set_id] ?? 'Promo',
    alwaysFoil: isAlwaysFoil(p),
    count: State.collection[p.id] ?? 0,
    foilCount: State.foilCollection[p.id] ?? 0,
  }));
}

function renderEntryScreen() {
  const s = State.session;
  const card = s.cards[s.index];
  const alwaysFoil = isAlwaysFoil(card);
  const singleton = isSingleton(card);
  const battlefield = isBattlefield(card);
  const count = State.collection[card.id] ?? 0;
  const foilCount = State.foilCollection[card.id] ?? 0;
  const combined = alwaysFoil ? foilCount : count + foilCount;
  const promos = cardPromos(card);
  const rarity = (card.classification?.rarity ?? '').toLowerCase();
  const type = [card.classification?.supertype, card.classification?.type].filter(Boolean).join(' ');
  const imgSrc = card.media?.image_url ?? null;
  const domain0 = card.classification?.domain?.[0] ?? '';
  const showCardSet = s.setId === ALL_SETS;

  const psBadge = combined >= 3 ? `Playset${combined > 3 ? ` +${combined - 3}` : ''}` : combined > 0 ? `${combined}/3` : null;
  const foilBadge = !alwaysFoil && foilCount > 0
    ? (foilCount >= 3 ? `Foil playset${foilCount > 3 ? ` +${foilCount - 3}` : ''}` : `${foilCount}/3 foil`)
    : null;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="entry-wrap">
      <div class="entry-card">
        <div class="entry-art-wrap">
          ${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(card.name)}" />` : `<div class="entry-art-placeholder">[${escapeHtml(type)} · ${escapeHtml((card.id ?? '').toString().toUpperCase())}]</div>`}
        </div>
        <div class="entry-meta-row">
          <span style="font-family:var(--font-mono);color:var(--text-3);font-size:11px;">${escapeHtml((card.code ?? card.id ?? '').toString().toUpperCase())}</span>
          ${showCardSet ? `<span style="color:var(--accent);font-size:12px;">${escapeHtml(SET_LABELS[card.set?.set_id] ?? card.set?.set_id ?? '')}</span>` : ''}
          <span style="color:var(--d-${cssIdent(domain0)});font-size:12px;">${escapeHtml(domain0)}</span>
        </div>
      </div>

      <div class="entry-detail">
        <div class="entry-progress-row">
          <button type="button" class="btn ghost" id="btn-back" style="font-size:11px;">← Back</button>
          <span class="se-pill set-pill">${s.setId === ALL_SETS ? 'All sets' : escapeHtml(SET_LABELS[s.setId] ?? s.setId)}</span>
          <span class="se-pill"><span class="dot" style="--c:var(--d-${cssIdent(s.domain)})"></span>${escapeHtml(s.domain)}</span>
          <div class="entry-progress-bar"><div class="fill" style="width:${((s.index + 1) / s.cards.length) * 100}%"></div></div>
          <span class="entry-pos">${s.index + 1} / ${s.cards.length}</span>
        </div>

        <div class="entry-head">
          <h1 class="entry-title">
            ${escapeHtml(card.name)}
            ${['epic', 'rare', 'showcase'].includes(rarity) ? `<span class="rarity-tag ${rarity}">${escapeHtml(card.classification?.rarity ?? '')}</span>` : ''}
            ${alwaysFoil ? `<span class="foil-only-tag">✦ Foil only</span>` : ''}
          </h1>
          <div class="se-stat-tiles">
            ${['energy', 'power', 'might'].map((k) => card.attributes?.[k] != null
              ? `<div class="se-stat-tile"><span class="se-lbl">${capitalize(k)}</span><span class="se-val">${escapeHtml(card.attributes[k])}</span></div>`
              : '').join('')}
          </div>
        </div>

        ${singleton ? `
        <div class="entry-question">
          <div class="q-head">
            <div class="q-label">Have it?</div>
            <div class="yn${battlefield ? ' three' : ''}">
              <button type="button" data-act="singleton-no" class="no${count === 0 && foilCount === 0 ? ' active' : ''}">No</button>
              <button type="button" data-act="singleton-normal" class="yes${count > 0 ? ' active' : ''}">Normal</button>
              ${battlefield ? `<button type="button" data-act="singleton-foil" class="yes${foilCount > 0 ? ' active' : ''}">✦ Foil</button>` : ''}
            </div>
          </div>
        </div>` : ''}

        ${!singleton && !alwaysFoil ? `
        <div class="entry-question">
          <div class="q-head">
            <div class="q-label">Playset? <span class="q-sub">(×3)</span></div>
            <div class="yn">
              <button type="button" data-act="count-no" class="no${count === 0 ? ' active' : ''}">No <span class="key">N</span></button>
              <button type="button" data-act="count-yes" class="yes${combined >= 3 ? ' active' : ''}">Yes <span class="key">Y</span></button>
            </div>
          </div>
          <div class="se-partial-row">
            <span class="se-partial-label">Have:</span>
            <div class="stepper-big">
              <button type="button" data-act="count-dec" ${count === 0 ? 'disabled' : ''}>−</button>
              <span class="val">${count}</span>
              <button type="button" data-act="count-inc">+</button>
            </div>
            ${psBadge ? `<span class="se-ps-badge">${psBadge}</span>` : ''}
          </div>
        </div>` : ''}

        ${!singleton ? `
        <div class="entry-question foil-q">
          <div class="q-head">
            <div class="q-label">✦ ${alwaysFoil ? 'Playset? (×3)' : 'Foils?'}</div>
            ${alwaysFoil ? `
            <div class="yn">
              <button type="button" data-act="foil-no" class="no${foilCount === 0 ? ' active' : ''}">No</button>
              <button type="button" data-act="foil-yes3" class="yes${foilCount >= 3 ? ' active' : ''}">Yes <span class="key">F</span></button>
            </div>` : ''}
          </div>
          <div class="se-partial-row">
            <span class="se-partial-label">${alwaysFoil ? 'Have:' : '✦'}</span>
            <div class="stepper-big foil">
              <button type="button" data-act="foil-dec" ${foilCount === 0 ? 'disabled' : ''}>−</button>
              <span class="val">${foilCount}</span>
              <button type="button" data-act="foil-inc">+</button>
            </div>
            ${(alwaysFoil ? psBadge : foilBadge) ? `<span class="se-ps-badge foil">${alwaysFoil ? psBadge : foilBadge}</span>` : ''}
          </div>
        </div>` : ''}

        ${promos.map(({ card: p, label, alwaysFoil: pFoil, count: pCount, foilCount: pFoilCount }) => {
          const pCombined = pFoil ? pFoilCount : pCount + pFoilCount;
          return `
          <div class="entry-question promo-q" data-promo-id="${escapeHtml(p.id)}">
            <div class="q-head">
              <div class="q-label promo-label">${escapeHtml(label)}${pFoil ? ' ✦' : ''} variant</div>
              <div class="yn">
                <button type="button" data-act="promo-no" class="no${pCombined === 0 ? ' active' : ''}">No</button>
                <button type="button" data-act="promo-yes" class="yes${pCombined >= 3 ? ' active' : ''}">Yes</button>
              </div>
            </div>
            <div class="se-partial-row">
              <span class="se-partial-label">Have:</span>
              <div class="stepper-big${pFoil ? ' foil' : ''}">
                <button type="button" data-act="promo-dec" ${(pFoil ? pFoilCount : pCount) === 0 ? 'disabled' : ''}>−</button>
                <span class="val">${pFoil ? pFoilCount : pCount}</span>
                <button type="button" data-act="promo-inc">+</button>
              </div>
              ${!pFoil ? `
              <span class="se-partial-label" style="margin-left:4px;">✦</span>
              <div class="stepper-big foil">
                <button type="button" data-act="promo-foil-dec" ${pFoilCount === 0 ? 'disabled' : ''}>−</button>
                <span class="val">${pFoilCount}</span>
                <button type="button" data-act="promo-foil-inc">+</button>
              </div>` : ''}
            </div>
          </div>`;
        }).join('')}

        <div class="entry-foot">
          <div class="kbd-hints">
            <span><kbd>Y</kbd>Yes</span>
            <span><kbd>N</kbd>No</span>
            <span><kbd>0</kbd>–<kbd>9</kbd>Count</span>
            <span><kbd>F</kbd>Foil+1</span>
            <span><kbd>←</kbd><kbd>→</kbd>Nav</span>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="btn-prev" ${s.index === 0 ? 'disabled' : ''}>← Back</button>
            ${s.index < s.cards.length - 1
              ? `<button type="button" class="btn primary" id="btn-next">Next →</button>`
              : `<button type="button" class="btn primary" id="btn-done" style="background:var(--ok);">✓ Done</button>`}
          </div>
        </div>
      </div>
    </div>
  `;

  wireEntryHandlers(card, promos);
}

function advance(by) {
  const s = State.session;
  s.index = Math.max(0, Math.min(s.cards.length - 1, s.index + by));
  setProgress(s.key, s.index);
  renderEntryScreen();
}

function wireEntryHandlers(card, promos) {
  const app = document.getElementById('app');
  const count = State.collection[card.id] ?? 0;
  const foilCount = State.foilCollection[card.id] ?? 0;

  const on = (act, fn) => { const el = app.querySelector(`[data-act="${act}"]`); if (el) el.addEventListener('click', fn); };

  on('singleton-no', () => { setCount(card, 0); setFoilCount(card, 0); renderEntryScreen(); });
  on('singleton-normal', () => { setCount(card, count > 0 ? 0 : 1); renderEntryScreen(); });
  on('singleton-foil', () => { setFoilCount(card, foilCount > 0 ? 0 : 1); renderEntryScreen(); });

  on('count-no', () => { setCount(card, 0); renderEntryScreen(); });
  on('count-yes', () => { setCount(card, Math.max(0, 3 - foilCount)); renderEntryScreen(); });
  on('count-dec', () => { setCount(card, Math.max(0, count - 1)); renderEntryScreen(); });
  on('count-inc', () => { setCount(card, count + 1); renderEntryScreen(); });

  on('foil-no', () => { setFoilCount(card, 0); renderEntryScreen(); });
  on('foil-yes3', () => { setFoilCount(card, 3); renderEntryScreen(); });
  on('foil-dec', () => { setFoilCount(card, Math.max(0, foilCount - 1)); renderEntryScreen(); });
  on('foil-inc', () => { setFoilCount(card, foilCount + 1); renderEntryScreen(); });

  app.querySelectorAll('[data-promo-id]').forEach((block) => {
    const pid = block.dataset.promoId;
    const p = promos.find((x) => x.card.id === pid);
    if (!p) return;
    const setPC = (n) => { const d = n - p.count; if (d) adjust(p.card.id, d); };
    const setPFC = (n) => { const d = n - p.foilCount; if (d) adjustFoil(p.card.id, d); };
    const click = (sel, fn) => { const el = block.querySelector(sel); if (el) el.addEventListener('click', () => { fn(); renderEntryScreen(); }); };
    click('[data-act="promo-no"]', () => { setPC(0); setPFC(0); });
    click('[data-act="promo-yes"]', () => { p.alwaysFoil ? setPFC(3) : setPC(Math.max(0, 3 - p.foilCount)); });
    click('[data-act="promo-dec"]', () => { p.alwaysFoil ? setPFC(Math.max(0, p.foilCount - 1)) : setPC(Math.max(0, p.count - 1)); });
    click('[data-act="promo-inc"]', () => { p.alwaysFoil ? setPFC(p.foilCount + 1) : setPC(p.count + 1); });
    click('[data-act="promo-foil-dec"]', () => setPFC(Math.max(0, p.foilCount - 1)));
    click('[data-act="promo-foil-inc"]', () => setPFC(p.foilCount + 1));
  });

  const backBtn = document.getElementById('btn-back');
  if (backBtn) backBtn.addEventListener('click', endSession);
  const prevBtn = document.getElementById('btn-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => advance(-1));
  const nextBtn = document.getElementById('btn-next');
  if (nextBtn) nextBtn.addEventListener('click', () => advance(1));
  const doneBtn = document.getElementById('btn-done');
  if (doneBtn) doneBtn.addEventListener('click', endSession);
}

// Global keyboard shortcuts, live only while an entry screen is open —
// same bindings as the desktop app's Set Entry wizard.
document.addEventListener('keydown', (e) => {
  const s = State.session;
  if (!s) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const card = s.cards[s.index];
  const singleton = isSingleton(card);
  const count = State.collection[card.id] ?? 0;
  const foilCount = State.foilCollection[card.id] ?? 0;

  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    advance(1);
  } else if (e.key === 'ArrowLeft') {
    advance(-1);
  } else if (e.key === 'y' || e.key === 'Y') {
    if (singleton) setCount(card, 1); else setCount(card, Math.max(3, count));
    renderEntryScreen();
  } else if (e.key === 'n' || e.key === 'N') {
    setCount(card, 0); setFoilCount(card, 0);
    renderEntryScreen();
  } else if (e.key >= '0' && e.key <= '9') {
    setCount(card, parseInt(e.key, 10));
    renderEntryScreen();
  } else if (e.key === 'f' || e.key === 'F') {
    setFoilCount(card, Math.min(3, foilCount + 1));
    renderEntryScreen();
  }
});

// ── Header: export / import / reset ─────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  if (!State.allCards.length) return;
  const csv = generateCSV(State.allCards, State.collection, State.foilCollection);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `riftbound-collection-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSV exported.');
});

document.getElementById('csv-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCSV(String(reader.result));
      const { updates, foilUpdates, unmatched } = matchCSV(rows, State.allCards);
      State.collection = { ...State.collection, ...updates };
      State.foilCollection = { ...State.foilCollection, ...foilUpdates };
      saveJSON(LS_KEYS.collection, State.collection);
      saveJSON(LS_KEYS.foil, State.foilCollection);
      const matchedCount = Object.keys(updates).length + Object.keys(foilUpdates).length;
      showToast(
        `<strong>${matchedCount}</strong> card${matchedCount === 1 ? '' : 's'} imported` +
        (unmatched.length ? ` · <strong>${unmatched.length}</strong> unmatched: ${unmatched.slice(0, 8).map(escapeHtml).join(', ')}${unmatched.length > 8 ? '…' : ''}` : ''),
        8000
      );
      if (State.session) renderEntryScreen(); else renderConfigScreen();
    } catch (err) {
      showToast(`Import failed: ${escapeHtml(err.message ?? String(err))}`);
    }
  };
  reader.readAsText(file);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Clear all counts and progress stored in this browser? This cannot be undone (export a CSV backup first if you want one).')) return;
  State.collection = {};
  State.foilCollection = {};
  State.progress = {};
  saveJSON(LS_KEYS.collection, State.collection);
  saveJSON(LS_KEYS.foil, State.foilCollection);
  saveJSON(LS_KEYS.progress, State.progress);
  State.session = null;
  renderConfigScreen();
  showToast('Local data cleared.');
});

// ── Init ─────────────────────────────────────────────────────
function buildPromoByName(allCards) {
  const map = {};
  for (const card of allCards) {
    if (PROMO_FOLD_SETS.has(card.set?.set_id) && card.classification?.type !== 'Rune') {
      const key = card.name.toLowerCase().trim();
      (map[key] = map[key] || []).push(card);
    }
  }
  return map;
}

async function init() {
  const statusEl = document.getElementById('status-msg');
  try {
    const cards = await fetchAllCards();
    State.allCards = cards;
    State.promoByName = buildPromoByName(cards);
    renderConfigScreen();
  } catch (err) {
    statusEl.textContent = `Couldn't load card data: ${err.message ?? err}. Try reloading the page.`;
    statusEl.classList.add('error');
  }
}

init();
