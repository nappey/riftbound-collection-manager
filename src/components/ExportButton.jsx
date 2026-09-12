import { useGame } from '../games/GameContext';

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

// The CSV layout is per game (Riftbound: Piltover Archive format; Cyberpunk:
// set code + number + printing id) — see each game's `csv.generate`.
export default function ExportButton({ allCards, collection, foilCollection }) {
  const game = useGame();
  const date = new Date().toISOString().slice(0, 10);

  function handleExportCSV() {
    download(
      game.csv.generate(allCards, collection, foilCollection),
      `${game.id}-collection-${date}.csv`,
      'text/csv;charset=utf-8',
    );
  }

  return (
    <button className="btn" onClick={handleExportCSV}>Export CSV</button>
  );
}
