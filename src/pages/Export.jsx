import { useMemo, useState, useCallback } from 'react';
import { generateDiscord, generateMarkdown, SET_ORDER, SET_LABELS } from '../utils/generateExport';

const DISCORD_LIMIT = 2000;
const DEFAULT_CONTENT = { foils: true, champions: true, signatures: false, allOwned: false, lookingFor: false, upForTrade: false };

export default function Export({ allCards, collection, foilCollection, prices, pricesLoading, lookingFor = {}, upForTrade = {} }) {
  const availableSets = useMemo(() => {
    const seen = new Set();
    for (const c of allCards) { const sid = c.set?.set_id; if (sid) seen.add(sid); }
    return [...SET_ORDER.filter(s => seen.has(s)), ...[...seen].filter(s => !SET_ORDER.includes(s))];
  }, [allCards]);

  const [selectedSets, setSelectedSets] = useState(() => [...SET_ORDER]);
  const [content, setContent]           = useState(DEFAULT_CONTENT);
  const [includePricing, setIncPricing] = useState(true);
  const [format, setFormat]             = useState('discord');
  const [copied, setCopied]             = useState(false);

  const opts = { allCards, collection, foilCollection, prices, selectedSets, content, includePricing, lookingFor, upForTrade };

  const output = useMemo(() => {
    if (allCards.length === 0) return 'Loading cards…';
    return format === 'discord' ? generateDiscord(opts) : generateMarkdown(opts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards, collection, foilCollection, prices, selectedSets, content, includePricing, format, lookingFor, upForTrade]);

  const charCount = output.length;
  const overLimit = format === 'discord' && charCount > DISCORD_LIMIT;

  function toggleSet(sid) {
    setSelectedSets(prev => prev.includes(sid) ? prev.filter(s => s !== sid) : [...prev, sid]);
  }
  function toggleContent(key) {
    setContent(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const copyToClipboard = useCallback(async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  function download() {
    const ext  = format === 'discord' ? 'txt' : 'md';
    const mime = format === 'discord' ? 'text/plain' : 'text/markdown';
    const blob = new Blob([output], { type: `${mime};charset=utf-8` });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `riftbound-export-${new Date().toISOString().slice(0,10)}.${ext}`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  return (
    <div className="export-wrap">
      {/* Options panel */}
      <aside className="export-options">
        <h2>Export</h2>
        <p style={{fontSize: 12.5, color: 'var(--text-2)', margin: 0}}>Share or back up your collection.</p>

        <div className="export-section">
          <span className="export-section-title">Format</span>
          <div className="yn" style={{width: '100%'}}>
            <button className={`yes${format === 'discord' ? ' active' : ''}`} onClick={() => setFormat('discord')} style={{flex: 1}}>Discord</button>
            <button className={`yes${format === 'markdown' ? ' active' : ''}`} onClick={() => setFormat('markdown')} style={{flex: 1}}>Markdown</button>
          </div>
        </div>

        <div className="export-section">
          <span className="export-section-title">Sets</span>
          <div style={{display: 'flex', gap: 6, marginBottom: 6}}>
            <button className="btn ghost" style={{fontSize: 11, height: 24, padding: '0 8px'}} onClick={() => setSelectedSets([...availableSets])}>All</button>
            <button className="btn ghost" style={{fontSize: 11, height: 24, padding: '0 8px'}} onClick={() => setSelectedSets([])}>None</button>
          </div>
          <div className="chip-list">
            {availableSets.map(sid => (
              <button
                key={sid}
                className={`chip${selectedSets.includes(sid) ? ' active' : ''}`}
                onClick={() => toggleSet(sid)}
              >{SET_LABELS[sid] ?? sid}</button>
            ))}
          </div>
        </div>

        <div className="export-section">
          <span className="export-section-title">Include</span>
          <div className="export-toggle-list">
            {[
              ['foils',      'Foil indicators'],
              ['champions',  'Champions'],
              ['signatures', 'Signature spells'],
              ['allOwned',   'All owned (not just playsets)'],
              ['lookingFor', 'Looking-for list'],
              ['upForTrade', 'Up-for-trade list'],
            ].map(([key, lbl]) => (
              <label key={key} className="export-check">
                <input type="checkbox" checked={content[key]} onChange={() => toggleContent(key)} />
                <span>{lbl}</span>
              </label>
            ))}
            <label className="export-check">
              <input type="checkbox" checked={includePricing} onChange={e => setIncPricing(e.target.checked)} disabled={pricesLoading} />
              <span>{pricesLoading ? 'Pricing (loading…)' : 'Pricing'}</span>
            </label>
          </div>
        </div>
      </aside>

      {/* Preview panel */}
      <div className="export-preview-col">
        <div className="export-toolbar">
          <span className="char-count" style={{color: overLimit ? 'var(--miss)' : 'var(--text-3)'}}>
            {charCount.toLocaleString()} chars{format === 'discord' && ` / ${DISCORD_LIMIT}`}
          </span>
          {overLimit && <span style={{fontSize: 11, color: 'var(--warn)'}}>⚠ Over Discord limit</span>}
          <div style={{marginLeft: 'auto', display: 'flex', gap: 8}}>
            <button className={`btn${copied ? ' primary' : ''}`} onClick={copyToClipboard}>
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
            <button className="btn" onClick={download}>Download</button>
          </div>
        </div>
        <textarea className="export-preview" value={output} readOnly spellCheck={false} />
      </div>
    </div>
  );
}
