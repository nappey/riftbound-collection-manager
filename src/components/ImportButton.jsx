import { useRef, useState } from 'react';
import { parseCSV, buildRidMap, matchCSVRows } from '../utils/csvImport';

export default function ImportButton({ allCards, onImport }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      const ridMap = buildRidMap(allCards);
      const { updates, foilUpdates, unmatched } = matchCSVRows(rows, ridMap, allCards);

      onImport({ updates, foilUpdates });
      const matched = Object.keys(updates).length + Object.keys(foilUpdates).length;
      setStatus({ matched, unmatched: unmatched.length, unmatched_list: unmatched });
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
      <button className="btn" onClick={() => inputRef.current?.click()}>
        Import CSV
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {status && (
        <span style={{fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6}}>
          {status.matched} imported
          {status.unmatched > 0 && (
            <span style={{color: 'var(--warn)'}} title={status.unmatched_list.join(', ')}>
              · {status.unmatched} unmatched
            </span>
          )}
          <button className="btn ghost btn-sq" style={{height: 20, width: 20}} onClick={() => setStatus(null)}>×</button>
        </span>
      )}
    </div>
  );
}
