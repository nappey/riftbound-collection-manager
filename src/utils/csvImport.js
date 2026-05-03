import { isAlwaysFoil } from './playset';

// Parse a CSV line respecting quoted fields with commas
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

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseCSVLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
    });
}

// Build a lookup map from normalized riftbound_id prefix → internal card id
// riftbound_id format: "unl-001-219"  →  key: "unl-001"
export function buildRidMap(cards) {
  const map = {};
  for (const card of cards) {
    const rid = card.riftbound_id;
    if (!rid) continue;
    const key = rid.replace(/-\d+$/, ''); // strip trailing -NNN
    if (!map[key]) map[key] = card;       // store full card so we can check isAlwaysFoil
  }
  return map;
}

// Normalize a CSV Variant Number to a riftbound_id prefix key
// "UNL-001"            → "unl-001"
// "UNL-145a"           → "unl-145a"
// "UNL-169-PreRelease" → "unl-169"
function normalizeVariantNumber(varNum) {
  return varNum
    .toLowerCase()
    .replace(/-prerelease$/, '')
    .replace(/-promo$/, '')
    .replace(/-\w+promo$/, '');
}

// Returns { updates, foilUpdates, unmatched }
// Rare / Showcase / Epic / Promo / Alt Art cards → foilUpdates (no unfoiled printing)
// Common / Uncommon → updates
export function matchCSVRows(rows, ridMap, cards) {
  // Fallback: name+set lookup for unresolved rows
  const nameMap = {};
  for (const card of cards) {
    const key = `${card.set?.set_id ?? ''}|${card.name}`.toLowerCase();
    nameMap[key] = card;
  }

  const updates     = {};   // cardId → qty (normal copies)
  const foilUpdates = {};   // cardId → qty (foil copies)
  const unmatched   = [];

  for (const row of rows) {
    const qty = parseInt(row['Quantity'], 10);
    if (!qty || qty <= 0) continue;

    const varNum   = row['Variant Number'] ?? '';
    const setPrefix = (row['Set Prefix'] ?? '').toLowerCase();
    const cardName  = (row['Card Name'] ?? '').toLowerCase();

    const ridKey = normalizeVariantNumber(varNum);
    let card = ridMap[ridKey];

    if (!card) {
      card = nameMap[`${setPrefix}|${cardName}`];
    }

    if (card) {
      // Foil variants in CSV, or cards that are always foil → foilUpdates
      const variantType = (row['Variant Type'] ?? '').toLowerCase();
      const isFoilRow   = variantType === 'foil' || isAlwaysFoil(card);

      if (isFoilRow) {
        foilUpdates[card.id] = (foilUpdates[card.id] ?? 0) + qty;
      } else {
        updates[card.id] = (updates[card.id] ?? 0) + qty;
      }
    } else {
      unmatched.push(varNum);
    }
  }

  return { updates, foilUpdates, unmatched };
}
