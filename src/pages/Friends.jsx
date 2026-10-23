import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../games/GameContext';
import { useSync } from '../sync/SyncContext';
import { timeAgo } from '../sync/timeAgo';
import { cardTarget, ownedTotal, unitPrice, fmt$ } from '../utils/analysis';
import { formatPlaysetFor } from '../utils/playset';
import { remapKeys } from '../utils/remapIds';

// Friends: collections of the other people whose sync files share your sync
// folder (read-only). Shows trade matches both ways, then lets you browse
// what a friend owns next to your own counts.

const EMPTY = {};

function bySetThenNumber(setOrder) {
  return (a, b) => {
    const sa = setOrder.indexOf(a.set?.set_id);
    const sb = setOrder.indexOf(b.set?.set_id);
    if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    return (a.collector_number ?? 0) - (b.collector_number ?? 0);
  };
}

// "2 · 1 foil" style count for one person.
function countLabel(card, normal, foil) {
  const n = normal[card.id] ?? 0;
  const f = foil[card.id] ?? 0;
  const total = ownedTotal(card, normal, foil);
  const ps = formatPlaysetFor(total, cardTarget(card));
  if (!n && !f) return '—';
  const parts = [];
  if (n) parts.push(`${n}`);
  if (f) parts.push(`${f} foil`);
  return ps && ps.includes('playset') ? `${ps} (${parts.join(' + ')})` : parts.join(' + ');
}

function CardRow({ card, onOpenModal, setLabels, children }) {
  return (
    <div className="trade-row friends-row">
      <button className="trade-thumb" onClick={() => onOpenModal?.(card)} title="View details">
        {card.media?.image_url ? <img src={card.media.image_url} alt={card.name} loading="lazy" /> : null}
      </button>
      <div className="trade-info">
        <span className="trade-name">{card.name}</span>
        <span className="trade-set">
          {setLabels[card.set?.set_id] ?? card.set?.set_id}
          {card.metadata?.alternate_art && <span className="trade-alt"> · Alt Art</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

function MatchColumn({ title, sub, accent, cards, empty, spareOf, prices, pricesLoading, onOpenModal, setLabels }) {
  const total = cards.reduce((sum, c) => sum + (unitPrice(c, prices) ?? 0), 0);
  return (
    <div className="trade-col">
      <div className="trade-col-head" style={{ borderColor: accent }}>
        <div>
          <h2>{title}</h2>
          <span className="trade-col-sub">{sub}</span>
        </div>
        {!pricesLoading && total > 0 && <span className="trade-col-value">{fmt$(total)}</span>}
      </div>
      {cards.length === 0 ? (
        <div className="trade-empty">{empty}</div>
      ) : (
        <div className="trade-list">
          {cards.map((card) => {
            const spare = spareOf(card);
            const price = unitPrice(card, prices);
            return (
              <CardRow key={card.id} card={card} onOpenModal={onOpenModal} setLabels={setLabels}>
                {spare > 0
                  ? <span className="trade-spare" title="Spare copies beyond a playset">{spare} spare</span>
                  : <span className="friends-flag" title="Marked Up For Trade">UFT</span>}
                <span className="trade-price">{pricesLoading ? '…' : price != null ? fmt$(price) : '—'}</span>
              </CardRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

const MODES = [
  ['all', 'Everything they own'],
  ['missing', "They have, you don't"],
  ['spare', 'Their spares'],
];

export default function Friends({
  allCards, collection, foilCollection, lookingFor, upForTrade, prices, pricesLoading, onOpenModal, onOpenSettings,
}) {
  const game = useGame();
  const sync = useSync();
  const friends = sync?.friends ?? [];
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('all');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const friend = friends.find((f) => f.id === selectedId) ?? friends[0] ?? null;
  const data = friend?.games?.[game.id] ?? EMPTY;
  // A friend on an older version may still have cards saved under the game's
  // legacy ids; re-key their data the same way App re-keys ours.
  const { theirs, theirFoil, theirLF, theirUFT } = useMemo(() => {
    const re = (v) => (game.idRemap ? remapKeys(v ?? EMPTY, game.idRemap) : v ?? EMPTY);
    return { theirs: re(data.collection), theirFoil: re(data.foil), theirLF: re(data.lf), theirUFT: re(data.uft) };
  }, [data, game.idRemap]);

  const sorted = useMemo(
    () => [...allCards].sort(bySetThenNumber(game.setOrder)),
    [allCards, game.setOrder],
  );

  const theirSpare = (c) => Math.max(0, ownedTotal(c, theirs, theirFoil) - cardTarget(c));
  const mySpare = (c) => Math.max(0, ownedTotal(c, collection, foilCollection) - cardTarget(c));

  const { theyGive, youGive, owned, browse } = useMemo(() => {
    if (!friend) return { theyGive: [], youGive: [], owned: 0, browse: [] };
    const has = (c, n, f) => (n[c.id] ?? 0) + (f[c.id] ?? 0) > 0;
    const spareT = (c) => ownedTotal(c, theirs, theirFoil) - cardTarget(c);
    const spareM = (c) => ownedTotal(c, collection, foilCollection) - cardTarget(c);
    const q = search.trim().toLowerCase();
    const theyGive = [], youGive = [], browse = [];
    let owned = 0;
    for (const c of sorted) {
      const theyHave = has(c, theirs, theirFoil);
      if (theyHave) owned++;
      if (lookingFor[c.id] && theyHave && (spareT(c) > 0 || theirUFT[c.id])) theyGive.push(c);
      if (theirLF[c.id] && has(c, collection, foilCollection) && (spareM(c) > 0 || upForTrade[c.id])) youGive.push(c);
      if (!theyHave) continue;
      if (mode === 'missing' && ownedTotal(c, collection, foilCollection) > 0) continue;
      if (mode === 'spare' && spareT(c) <= 0) continue;
      if (q && !c.name.toLowerCase().includes(q)) continue;
      browse.push(c);
    }
    return { theyGive, youGive, owned, browse };
  }, [friend, sorted, theirs, theirFoil, theirLF, theirUFT, collection, foilCollection, lookingFor, upForTrade, mode, search]);

  if (!sync?.available || !sync.config?.path || friends.length === 0) {
    return (
      <div className="trade-wrap">
        <div className="trade-intro">
          <h1>Friends</h1>
          <p>
            See what your friends own and find trades. Everyone keeps their sync file in one shared folder
            (for example a shared Google Drive folder), and their collections show up here.
          </p>
        </div>
        <div className="settings-card friends-empty">
          {!sync?.available ? (
            <p className="settings-note">Friends needs the desktop app.</p>
          ) : !sync.config?.path ? (
            <>
              <p className="settings-note">Turn on sync first and put your sync file in a folder you share with friends.</p>
              <div className="settings-actions"><button className="btn primary" onClick={onOpenSettings}>Open Settings</button></div>
            </>
          ) : (
            <>
              <p className="settings-note">
                No friends' files in your sync folder yet. Share the folder with friends and have each of them choose
                <b> Create sync file…</b> inside it. Their collections appear here within a minute.
              </p>
              <div className="settings-actions">
                <button className="btn" onClick={() => sync.refreshFriends()}>Check again</button>
                <button className="btn ghost" onClick={onOpenSettings}>Settings</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const name = friend.name;
  const setLabels = game.setLabels;

  return (
    <div className="trade-wrap">
      <div className="friends-head">
        <div className="trade-intro">
          <h1>Friends</h1>
          <p>{name} owns {owned} {game.label} card{owned === 1 ? '' : 's'} · updated {timeAgo(friend.savedAt, now)}</p>
        </div>
        {friends.length > 1 && (
          <div className="seg friends-picker">
            {friends.map((f) => (
              <button key={f.id} className={f.id === friend.id ? 'active' : ''} onClick={() => setSelectedId(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="trade-cols">
        <MatchColumn
          title={`${name} can trade you`}
          sub="Cards you're Looking For that they have spare or marked UFT"
          accent="var(--accent)"
          cards={theyGive}
          empty={`Nothing yet. Mark cards LF and any ${name} has spare will show here.`}
          spareOf={theirSpare}
          prices={prices} pricesLoading={pricesLoading} onOpenModal={onOpenModal} setLabels={setLabels}
        />
        <MatchColumn
          title={`You can trade ${name}`}
          sub={`Cards ${name} is Looking For that you have spare or marked UFT`}
          accent="var(--ok)"
          cards={youGive}
          empty={`Nothing ${name} is Looking For matches your spares.`}
          spareOf={mySpare}
          prices={prices} pricesLoading={pricesLoading} onOpenModal={onOpenModal} setLabels={setLabels}
        />
      </div>

      <div className="trade-col">
        <div className="trade-col-head friends-browse-head" style={{ borderColor: 'var(--border-1)' }}>
          <div>
            <h2>{name}'s collection</h2>
            <span className="trade-col-sub">{browse.length} card{browse.length === 1 ? '' : 's'}</span>
          </div>
          <div className="trade-col-actions">
            <div className="seg">
              {MODES.map(([id, label]) => (
                <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>
              ))}
            </div>
            <input
              className="settings-input friends-search"
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {browse.length === 0 ? (
          <div className="trade-empty">No cards match.</div>
        ) : (
          <div className="trade-list">
            <div className="friends-row friends-row--head">
              <span /><span>Card</span><span>{name}</span><span>You</span>
            </div>
            {browse.map((card) => (
              <CardRow key={card.id} card={card} onOpenModal={onOpenModal} setLabels={setLabels}>
                <span className="friends-count">{countLabel(card, theirs, theirFoil)}</span>
                <span className="friends-count friends-count--mine">{countLabel(card, collection, foilCollection)}</span>
              </CardRow>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
