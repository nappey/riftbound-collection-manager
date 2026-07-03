import { formatPlayset } from './playset';

export const SET_ORDER = ['OGN', 'OGS', 'SFD', 'UNL', 'OPP', 'PR', 'JDG', 'RWB'];
export const SET_LABELS = {
  OGN: 'Origins', OGS: 'Proving Grounds', SFD: 'Spiritforged', UNL: 'Unleashed',
  OPP: 'Organized Play Promos', PR: 'Promotional Cards', JDG: 'Judge Promos', RWB: 'Worlds Bundle 2025',
};

// ── helpers ────────────────────────────────────────────────────

function pad(str, len) { return String(str).padEnd(len, ' '); }
function rpad(str, len) { return String(str).padStart(len, ' '); }

function cardValue(card, count, foilCount, prices, includePricing) {
  if (!includePricing) return 0;
  const p = prices[card.tcgplayer_id] ?? {};
  return (count * (p.normal?.market ?? 0)) + (foilCount * (p.foil?.market ?? p.normal?.market ?? 0));
}

function fmt$(n) { return n > 0 ? `$${n.toFixed(2)}` : null; }

// ── gather owned cards per section ─────────────────────────────

export function gatherSections({ allCards, collection, foilCollection, prices,
  selectedSets, content, includePricing, lookingFor = {}, upForTrade = {} }) {

  const inSet = (c) => selectedSets.includes(c.set?.set_id ?? '');

  const sections = [];

  if (content.foils) {
    const cards = allCards.filter(c => inSet(c) && (foilCollection[c.id] ?? 0) > 0);
    if (cards.length) sections.push({ key: 'foils', label: '✦ Foils', cards, foilMode: true });
  }
  if (content.champions) {
    const cards = allCards.filter(c => inSet(c) && c.classification?.supertype === 'Champion'
      && ((collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0));
    if (cards.length) sections.push({ key: 'champions', label: '👑 Champions', cards, foilMode: false });
  }
  if (content.signatures) {
    const cards = allCards.filter(c => inSet(c) && c.classification?.supertype === 'Signature'
      && ((collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0));
    if (cards.length) sections.push({ key: 'signatures', label: '✨ Signature Cards', cards, foilMode: false });
  }
  if (content.allOwned) {
    const cards = allCards.filter(c => inSet(c) && ((collection[c.id] ?? 0) > 0 || (foilCollection[c.id] ?? 0) > 0));
    if (cards.length) sections.push({ key: 'all', label: '📦 Full Collection', cards, foilMode: false });
  }
  if (content.lookingFor) {
    const cards = allCards.filter(c => inSet(c) && lookingFor[c.id]);
    if (cards.length) sections.push({ key: 'lf', label: '🔍 Looking For', cards, foilMode: false });
  }
  if (content.upForTrade) {
    const cards = allCards.filter(c => inSet(c) && upForTrade[c.id]);
    if (cards.length) sections.push({ key: 'uft', label: '🔄 Up For Trade', cards, foilMode: false });
  }

  // Attach computed values
  return sections.map(s => ({
    ...s,
    totalValue: s.cards.reduce((sum, c) => {
      const cnt = s.foilMode ? (foilCollection[c.id] ?? 0) : (collection[c.id] ?? 0);
      const fcnt = s.foilMode ? 0 : (foilCollection[c.id] ?? 0);
      return sum + cardValue(c, cnt, fcnt, prices, includePricing);
    }, 0),
  }));
}

// ── Simple name-only list for LF / UFT sections ────────────────

function discordListSection(section) {
  const { label, cards } = section;
  const bySet = {};
  for (const c of cards) {
    const sid = c.set?.set_id ?? 'UNK';
    (bySet[sid] = bySet[sid] || []).push(c);
  }
  const setIds = [...SET_ORDER.filter(s => bySet[s]),
                  ...Object.keys(bySet).filter(s => !SET_ORDER.includes(s))];
  let out = '';
  for (const sid of setIds) {
    out += `**${label} — ${SET_LABELS[sid] ?? sid}**\n\`\`\`\n`;
    for (const c of bySet[sid]) {
      const isAlt = c.metadata?.alternate_art;
      out += c.name + (isAlt ? ' ✦ Alt Art' : '') + '\n';
    }
    out += '```\n\n';
  }
  return out;
}

function mdListSection(section) {
  const { label, cards } = section;
  const bySet = {};
  for (const c of cards) {
    const sid = c.set?.set_id ?? 'UNK';
    (bySet[sid] = bySet[sid] || []).push(c);
  }
  const setIds = [...SET_ORDER.filter(s => bySet[s]),
                  ...Object.keys(bySet).filter(s => !SET_ORDER.includes(s))];
  let out = `## ${label}\n\n`;
  for (const sid of setIds) {
    out += `### ${SET_LABELS[sid] ?? sid}\n\n`;
    for (const c of bySet[sid]) {
      const isAlt = c.metadata?.alternate_art;
      out += `- **${c.name}**${isAlt ? ' ✦ Alt Art' : ''}\n`;
    }
    out += '\n';
  }
  return out;
}

// ── Discord format ─────────────────────────────────────────────

function discordSection(section, collection, foilCollection, prices, includePricing) {
  const { label, cards, foilMode } = section;

  // Group by set
  const bySet = {};
  for (const c of cards) {
    const sid = c.set?.set_id ?? 'UNK';
    (bySet[sid] = bySet[sid] || []).push(c);
  }

  const setIds = [...SET_ORDER.filter(s => bySet[s]),
                  ...Object.keys(bySet).filter(s => !SET_ORDER.includes(s))];

  let out = '';

  for (const sid of setIds) {
    const setCards = bySet[sid];
    const setLabel = SET_LABELS[sid] ?? sid;
    const setVal = setCards.reduce((sum, c) => {
      const cnt  = foilMode ? (foilCollection[c.id] ?? 0) : (collection[c.id] ?? 0);
      const fcnt = foilMode ? 0 : (foilCollection[c.id] ?? 0);
      return sum + cardValue(c, cnt, fcnt, prices, includePricing);
    }, 0);

    const headerVal = includePricing && setVal > 0 ? ` \`${fmt$(setVal)}\`` : '';
    out += `**${label} — ${setLabel}**${headerVal}\n`;
    out += '```\n';

    const maxName = Math.min(36, Math.max(...setCards.map(c => c.name.length)));

    for (const c of setCards) {
      const count     = foilMode ? (foilCollection[c.id] ?? 0) : (collection[c.id] ?? 0);
      const foilCount = foilMode ? 0 : (foilCollection[c.id] ?? 0);
      const ps        = foilMode ? null : formatPlayset(count);
      const pObj      = prices[c.tcgplayer_id] ?? {};
      const price     = foilMode ? (pObj.foil?.market ?? pObj.normal?.market) : pObj.normal?.market;

      let line = pad(c.name, maxName + 1);
      line += foilMode ? `✦ ×${count}` : `  ×${count}`;

      if (!foilMode && foilCount > 0) line += `  ✦×${foilCount}`;

      if (includePricing && price != null) {
        const total = price * count;
        line += `   ${rpad(fmt$(total), 7)}`;
        if (count > 1) line += `  (${fmt$(price)} ea)`;
      }

      if (ps?.includes('playset')) line += `  ● ${ps}`;

      out += line.trimEnd() + '\n';
    }

    out += '```\n\n';
  }

  return out;
}

export function generateDiscord({ allCards, collection, foilCollection, prices,
  selectedSets, content, includePricing, lookingFor, upForTrade }) {
  const sections = gatherSections({ allCards, collection, foilCollection, prices,
    selectedSets, content, includePricing, lookingFor, upForTrade });

  if (!sections.length) return '*(nothing to export with these options)*';

  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const setList = selectedSets.map(s => SET_LABELS[s] ?? s).join(', ');
  const totalVal = sections.reduce((s, sec) => s + sec.totalValue, 0);
  const valStr = includePricing && totalVal > 0 ? ` • Total value: **${fmt$(totalVal)}**` : '';

  let out = `**Riftbound Collection** • ${setList} • ${date}${valStr}\n\n`;
  for (const sec of sections) {
    out += (sec.key === 'lf' || sec.key === 'uft')
      ? discordListSection(sec)
      : discordSection(sec, collection, foilCollection, prices, includePricing);
  }

  return out.trimEnd();
}

// ── Markdown format ────────────────────────────────────────────

function mdSection(section, collection, foilCollection, prices, includePricing) {
  const { label, cards, foilMode, totalValue } = section;

  const bySet = {};
  for (const c of cards) {
    const sid = c.set?.set_id ?? 'UNK';
    (bySet[sid] = bySet[sid] || []).push(c);
  }
  const setIds = [...SET_ORDER.filter(s => bySet[s]),
                  ...Object.keys(bySet).filter(s => !SET_ORDER.includes(s))];

  let out = `## ${label}`;
  if (includePricing && totalValue > 0) out += ` — ${fmt$(totalValue)}`;
  out += '\n\n';

  for (const sid of setIds) {
    out += `### ${SET_LABELS[sid] ?? sid}\n\n`;
    for (const c of bySet[sid]) {
      const count     = foilMode ? (foilCollection[c.id] ?? 0) : (collection[c.id] ?? 0);
      const foilCount = foilMode ? 0 : (foilCollection[c.id] ?? 0);
      const ps        = foilMode ? null : formatPlayset(count);
      const pObj      = prices[c.tcgplayer_id] ?? {};
      const price     = foilMode ? (pObj.foil?.market ?? pObj.normal?.market) : pObj.normal?.market;
      const fPrice    = foilMode ? null : pObj.foil?.market;

      let line = `- `;
      if (foilMode) line += `✦ `;
      line += `**${c.name}**`;
      line += foilMode ? ` — ×${count}` : ` — ×${count}`;
      if (!foilMode && foilCount > 0) line += ` · ✦ ×${foilCount} foil`;
      if (ps?.includes('playset')) line += ` *(${ps})*`;
      if (includePricing && price != null) {
        const total = price * count;
        line += ` — ${fmt$(total)}`;
        if (count > 1) line += ` (${fmt$(price)} ea)`;
      }
      if (includePricing && !foilMode && fPrice != null && foilCount > 0) {
        line += ` · ✦ ${fmt$(fPrice * foilCount)}`;
      }
      out += line + '\n';
    }
    out += '\n';
  }

  return out;
}

export function generateMarkdown({ allCards, collection, foilCollection, prices,
  selectedSets, content, includePricing, lookingFor, upForTrade }) {
  const sections = gatherSections({ allCards, collection, foilCollection, prices,
    selectedSets, content, includePricing, lookingFor, upForTrade });

  if (!sections.length) return '*Nothing to export with these options.*';

  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const totalVal = sections.reduce((s, sec) => s + sec.totalValue, 0);

  let out = `# Riftbound Collection\n\n*${date}*`;
  if (includePricing && totalVal > 0) out += ` · **Total value: ${fmt$(totalVal)}**`;
  out += '\n\n---\n\n';

  for (const sec of sections) {
    out += (sec.key === 'lf' || sec.key === 'uft')
      ? mdListSection(sec)
      : mdSection(sec, collection, foilCollection, prices, includePricing);
  }

  return out.trimEnd();
}
