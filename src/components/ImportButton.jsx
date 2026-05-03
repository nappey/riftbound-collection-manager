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
    <div className="import-wrap">
      <button className="import-btn" onClick={() => inputRef.current?.click()}>
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
        <span className="import-status">
          {status.matched} card{status.matched !== 1 ? 's' : ''} imported
          {status.unmatched > 0 && (
            <span className="import-warn" title={status.unmatched_list.join(', ')}>
              {' '}· {status.unmatched} unmatched
            </span>
          )}
          <button className="import-dismiss" onClick={() => setStatus(null)}>×</button>
        </span>
      )}
    </div>
  );
}
