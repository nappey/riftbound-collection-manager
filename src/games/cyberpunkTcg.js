// TCGplayer data for Cyberpunk TCG via tcgcsv (category 92).
//
// One request per set: {tcgcsvBase}/{groupId}/ProductsAndPrices.csv returns
// every product in the group with its price rows merged in (one row per
// product × subtype). That gives us three things at once:
//   • the TCGplayer product id for each printing (→ prices, like Riftbound)
//   • market/low prices per Normal/Foil subtype
//   • a TCGplayer scan to fall back on when Netdeck's signed image URL expires
//
// The JSON /products + /prices endpoints carry the same data and are used as a
// fallback for any group whose CSV fails to load.
import { parseCSV } from '../utils/csvImport';

async function fetchGroupCSV(base, gid) {
  const r = await fetch(`${base}/${gid}/ProductsAndPrices.csv`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`tcgcsv ${r.status}`);
  return parseCSV(await r.text()).map(row => ({ ...row, groupId: String(gid) }));
}

// Same row shape as the CSV, rebuilt from the JSON pair.
async function fetchGroupJSON(base, gid) {
  const [prod, price] = await Promise.all([
    fetch(`${base}/${gid}/products`).then(r => r.json()),
    fetch(`${base}/${gid}/prices`).then(r => r.json()),
  ]);
  const ext = (p, k) => p.extendedData?.find(e => e.name === k)?.value ?? '';
  const byId = new Map((prod.results ?? []).map(p => [String(p.productId), p]));
  const rows = [];
  for (const pr of price.results ?? []) {
    const p = byId.get(String(pr.productId));
    if (!p) continue;
    rows.push({
      productId: String(p.productId), name: p.name, cleanName: p.cleanName, imageUrl: p.imageUrl,
      groupId: String(gid), extNumber: ext(p, 'Number'), extRarity: ext(p, 'Rarity'),
      extCost: ext(p, 'Cost'), extPower: ext(p, 'Power'), extRAM: ext(p, 'RAM'), extEddies: ext(p, 'Eddies'),
      marketPrice: pr.marketPrice ?? '', lowPrice: pr.lowPrice ?? '', subTypeName: pr.subTypeName ?? 'Normal',
    });
  }
  return rows;
}

/** Fetch product+price rows for every group; sealed products are dropped. */
export async function fetchTcgRows(base, groupIds) {
  const results = await Promise.allSettled(groupIds.map(async (gid) => {
    try { return await fetchGroupCSV(base, gid); }
    catch { return fetchGroupJSON(base, gid); }
  }));
  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(row => (row.extNumber ?? '').trim() !== '');
}

// ── matching ───────────────────────────────────────────────────

// "β005a" / "B005a" / "005A" → { num: '005', variant: 'a' }
function splitNumber(label) {
  const s = String(label ?? '').trim().replace(/^β/, '').replace(/^B(?=\d)/i, '');
  const m = s.match(/^0*(\d+)\s*([a-z])?$/i);
  return m ? { num: String(parseInt(m[1], 10)), variant: m[2]?.toLowerCase() ?? null } : { num: s, variant: null };
}

const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "V - Streetkid (b)" → { name: 'v streetkid', variant: 'b' }
// "Adam Smasher - Ender of Legends (Epic)" → { name: 'adam smasher ender of legends', variant: null }
function splitProductName(name) {
  let variant = null;
  let s = String(name ?? '');
  const v = s.match(/\(([ab])\)\s*$/i);
  if (v) { variant = v[1].toLowerCase(); s = s.replace(v[0], ''); }
  s = s.replace(/\s*\([^)]*\)\s*$/, ''); // "(Epic)", "(007)"…
  return { name: normName(s), variant };
}

const bigImage = (url) => (url ? url.replace(/_\d+w\.(jpg|png|webp)/i, '_400w.$1') : null);

/**
 * Attach `tcgplayer_id` (and a TCGplayer image fallback) to each card by
 * matching set → group, then collector number + name. Returns new card objects.
 */
export function resolveTcgplayerIds(cards, rows, groupBySet) {
  // group → num → rows (de-duplicated by productId; price subtypes repeat rows)
  const index = new Map();
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.productId)) continue;
    seen.add(row.productId);
    const { num, variant } = splitNumber(row.extNumber);
    const pn = splitProductName(row.name);
    const key = `${row.groupId}|${num}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ row, variant: variant ?? pn.variant, name: pn.name });
  }

  return cards.map(card => {
    const gid = groupBySet[card.set?.set_id];
    if (!gid) return card;
    const { num, variant } = splitNumber(card.collector_label ?? card.collector_number);
    const candidates = index.get(`${gid}|${num}`) ?? [];
    if (!candidates.length) return card;

    const cardName = normName(card.name);
    const cardBase = normName(`${card.base_name ?? ''} ${card.subname ?? ''}`);
    const byName = candidates.filter(c => c.name === cardName || c.name === cardBase);
    const pool = byName.length ? byName : candidates;
    const hit = pool.find(c => c.variant === variant)
      ?? (pool.length === 1 ? pool[0] : null)
      ?? pool.find(c => c.variant == null)
      ?? pool[0];
    if (!hit) return card;

    const attrs = { ...card.attributes };
    const num0 = (v) => (v === '' || v == null ? null : Number(String(v).replace(/^x/i, '')));
    if (attrs.energy == null && hit.row.extCost) attrs.energy = num0(hit.row.extCost);
    if (attrs.power == null && hit.row.extPower) attrs.power = num0(hit.row.extPower);
    if (attrs.ram == null && hit.row.extRAM) attrs.ram = num0(hit.row.extRAM);

    return {
      ...card,
      tcgplayer_id: String(hit.row.productId),
      attributes: attrs,
      media: { ...card.media, fallback_image_url: bigImage(hit.row.imageUrl) },
    };
  });
}

/** { [productId]: { normal:{market,low}, foil:{market,low} } } — same shape as Riftbound's price map. */
export function buildPriceMap(rows) {
  const priceMap = {};
  for (const row of rows) {
    const market = parseFloat(row.marketPrice);
    if (!Number.isFinite(market)) continue;
    const id = String(row.productId);
    if (!priceMap[id]) priceMap[id] = { normal: null, foil: null };
    const low = parseFloat(row.lowPrice);
    const entry = { market, low: Number.isFinite(low) ? low : null };
    if (row.subTypeName === 'Foil') priceMap[id].foil = entry;
    else priceMap[id].normal = entry;
  }
  return priceMap;
}
