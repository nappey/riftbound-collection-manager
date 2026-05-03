import { formatPlayset } from '../utils/playset';

const SET_ORDER = ['OGN', 'OGS', 'SFD', 'UNL', 'OPP', 'PR', 'JDG', 'RWB'];

const SET_DISPLAY = {
  OGN: 'Origins',
  OGS: 'Skirmish',
  SFD: 'Spiritforged',
  UNL: 'Unleashed',
  OPP: 'Nexus Night Promos',
  PR:  'Promotional Cards',
  JDG: 'Judge Promos',
  RWB: 'Worlds Bundle 2025',
};

// ── CSV helpers ────────────────────────────────────────────────

function csvField(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// "unl-001-219" → "UNL-001",  "unl-145a-219" → "UNL-145a"
function variantNumber(card) {
  const rid = card.riftbound_id;
  if (rid) return rid.replace(/-\d+$/, '').toUpperCase();
  const num = String(card.collector_number ?? '').padStart(3, '0');
  return `${card.set?.set_id ?? 'UNK'}-${num}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function generateCSV(allCards, collection, foilCollection) {
  const HEADERS = [
    'Variant Number', 'Card Name', 'Set', 'Set Prefix', 'Rarity',
    'Variant Type', 'Variant Label', 'Quantity', 'Language', 'Condition',
    'Grading Company', 'Grading Value', 'Grading Label', 'Notes',
  ];

  const rows = [HEADERS.map(csvField).join(',')];

  for (const card of allCards) {
    const count     = collection[card.id] ?? 0;
    const foilCount = foilCollection[card.id] ?? 0;
    if (count === 0 && foilCount === 0) continue;

    const varNum  = variantNumber(card);
    const setId   = card.set?.set_id ?? '';
    const setName = SET_DISPLAY[setId] ?? card.set?.label ?? setId;
    const rarity  = capitalize(card.classification?.rarity ?? '');
    const isAlt   = card.metadata?.alternate_art;

    if (count > 0) {
      rows.push([
        varNum, card.name, setName, setId, rarity,
        isAlt ? 'Alt Art' : 'Standard',
        isAlt ? 'Alt Art' : 'Standard',
        count, 'English', 'Near Mint', '', '', '', '',
      ].map(csvField).join(','));
    }

    if (foilCount > 0) {
      rows.push([
        varNum, card.name, setName, setId, rarity,
        'Foil', 'Foil',
        foilCount, 'English', 'Near Mint', '', '', '', '',
      ].map(csvField).join(','));
    }
  }

  return rows.join('\r\n');
}

// ── Markdown helpers ───────────────────────────────────────────

function cardLine(card, count, foilCount) {
  const parts = [];
  if (count > 0) {
    const ps = formatPlayset(count);
    parts.push(ps?.includes('playset') ? `×${count} (${ps})` : `×${count}`);
  }
  if (foilCount > 0) {
    const ps = formatPlayset(foilCount);
    parts.push(ps?.includes('playset') ? `✦ ×${foilCount} foil (${ps})` : `✦ ×${foilCount} foil`);
  }
  return `- **${card.name}** — ${parts.join(' · ')}`;
}

function sectionMarkdown(title, cards, collection, foilCollection) {
  const owned = cards.filter(
    (c) => (collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0
  );
  if (owned.length === 0) return '';

  const bySet = {};
  for (const card of owned) {
    const sid = card.set?.set_id ?? 'UNKNOWN';
    (bySet[sid] = bySet[sid] || []).push(card);
  }
  const setIds = [
    ...SET_ORDER.filter((s) => bySet[s]),
    ...Object.keys(bySet).filter((s) => !SET_ORDER.includes(s)),
  ];

  let md = `## ${title}\n\n`;
  for (const sid of setIds) {
    md += `### ${SET_DISPLAY[sid] ?? sid}\n\n`;
    for (const card of bySet[sid]) {
      md += cardLine(card, collection[card.id] ?? 0, foilCollection[card.id] ?? 0) + '\n';
    }
    md += '\n';
  }
  return md;
}

function generateMarkdown(allCards, collection, foilCollection) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const champions  = allCards.filter((c) => c.classification?.supertype === 'Champion');
  const signatures = allCards.filter((c) => c.classification?.supertype === 'Signature');
  const foils      = allCards.filter((c) => (foilCollection[c.id] ?? 0) > 0);

  let md = `# Riftbound Collection — Highlights\n\n*Exported ${date}*\n\n---\n\n`;
  md += sectionMarkdown('Champions', champions, collection, foilCollection);
  md += sectionMarkdown('Signature Cards', signatures, collection, foilCollection);

  if (foils.length > 0) {
    md += '## Foil Cards\n\n';
    const bySet = {};
    for (const card of foils) {
      const sid = card.set?.set_id ?? 'UNKNOWN';
      (bySet[sid] = bySet[sid] || []).push(card);
    }
    const setIds = [
      ...SET_ORDER.filter((s) => bySet[s]),
      ...Object.keys(bySet).filter((s) => !SET_ORDER.includes(s)),
    ];
    for (const sid of setIds) {
      md += `### ${SET_DISPLAY[sid] ?? sid}\n\n`;
      for (const card of bySet[sid]) {
        const foilCount = foilCollection[card.id] ?? 0;
        const ps = formatPlayset(foilCount);
        md += `- ✦ **${card.name}** — ×${foilCount}${ps?.includes('playset') ? ` (${ps})` : ''}\n`;
      }
      md += '\n';
    }
  }
  return md;
}

// ── Shared download util ───────────────────────────────────────

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────

export default function ExportButton({ allCards, collection, foilCollection }) {
  const date = new Date().toISOString().slice(0, 10);

  function handleExportMD() {
    download(
      generateMarkdown(allCards, collection, foilCollection),
      `riftbound-collection-${date}.md`,
      'text/markdown;charset=utf-8',
    );
  }

  function handleExportCSV() {
    download(
      generateCSV(allCards, collection, foilCollection),
      `riftbound-collection-${date}.csv`,
      'text/csv;charset=utf-8',
    );
  }

  return (
    <button className="export-btn" onClick={handleExportCSV}>Export CSV</button>
  );
}
