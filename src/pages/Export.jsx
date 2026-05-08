import { useMemo, useState, useCallback } from 'react';
import { generateDiscord, generateMarkdown, SET_ORDER, SET_LABELS } from '../utils/generateExport';

const DISCORD_LIMIT = 2000;

const DEFAULT_CONTENT = { foils: true, champions: true, signatures: false, allOwned: false, lookingFor: false, upForTrade: false };

export default function Export({ allCards, collection, foilCollection, prices, pricesLoading, lookingFor = {}, upForTrade = {} }) {
  const availableSets = useMemo(() => {
    const seen = new Set();
    for (const c of allCards) {
      const sid = c.set?.set_id;
      if (sid) seen.add(sid);
    }
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
    setSelectedSets(prev =>
      prev.includes(sid) ? prev.filter(s => s !== sid) : [...prev, sid]
    );
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
    <div className="exp-wrap">
      {/* ── Options panel ── */}
      <div className="exp-options">
        <h2 className="exp-heading">Export</h2>

        <section className="exp-section">
          <div className="exp-section-title">Format</div>
          <div className="exp-radio-group">
            {[['discord', '💬 Discord'], ['markdown', '📄 Markdown']].map(([val, lbl]) => (
              <label key={val} className={`exp-radio${format === val ? ' exp-radio--active' : ''}`}>
                <input type="radio" name="format" value={val}
                  checked={format === val} onChange={() => setFormat(val)} />
                {lbl}
              </label>
            ))}
          </div>
        </section>

        <section className="exp-section">
          <div className="exp-section-title">Content</div>
          {[
            ['foils',      '✦ Foils'],
            ['champions',  '👑 Champions'],
            ['signatures', '✨ Signature Cards'],
            ['allOwned',   '📦 All Owned'],
            ['lookingFor', '🔍 Looking For'],
            ['upForTrade', '🔄 Up For Trade'],
          ].map(([key, lbl]) => (
            <label key={key} className="exp-check-label">
              <input type="checkbox" checked={content[key]} onChange={() => toggleContent(key)} />
              {lbl}
            </label>
          ))}
        </section>

        <section className="exp-section">
          <div className="exp-section-title">Sets</div>
          <div className="exp-set-actions">
            <button className="exp-link-btn" onClick={() => setSelectedSets([...availableSets])}>All</button>
            <button className="exp-link-btn" onClick={() => setSelectedSets([])}>None</button>
          </div>
          <div className="exp-set-list">
            {availableSets.map(sid => (
              <label key={sid} className={`exp-set-chip${selectedSets.includes(sid) ? ' exp-set-chip--on' : ''}`}>
                <input type="checkbox" checked={selectedSets.includes(sid)}
                  onChange={() => toggleSet(sid)} style={{ display: 'none' }} />
                {SET_LABELS[sid] ?? sid}
              </label>
            ))}
          </div>
        </section>

        <section className="exp-section">
          <label className="exp-check-label">
            <input type="checkbox" checked={includePricing}
              onChange={e => setIncPricing(e.target.checked)}
              disabled={pricesLoading} />
            {pricesLoading ? 'Include pricing (loading…)' : 'Include pricing'}
          </label>
        </section>
      </div>

      {/* ── Preview panel ── */}
      <div className="exp-preview-col">
        <div className="exp-preview-toolbar">
          <div className="exp-char-count">
            <span className={overLimit ? 'exp-over-limit' : ''}>
              {charCount.toLocaleString()} chars
            </span>
            {overLimit && (
              <span className="exp-limit-warn">
                ⚠ Over Discord's 2000-char limit — consider fewer sets or sections
              </span>
            )}
          </div>
          <div className="exp-preview-actions">
            <button className={`exp-copy-btn${copied ? ' exp-copy-btn--done' : ''}`} onClick={copyToClipboard}>
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
            <button className="exp-dl-btn" onClick={download}>Download</button>
          </div>
        </div>
        <textarea className="exp-preview" value={output} readOnly spellCheck={false} />
      </div>
    </div>
  );
}
