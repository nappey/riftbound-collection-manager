import { useState } from 'react';
import DeckBuilder from './DeckBuilder';
import DeckCheck from './DeckCheck';

// Unified "Decks" tab: build & save decks, or check a pasted decklist
// against your collection. Toggled by a segmented control up top.
export default function Decks({
  allCards, collection, foilCollection, prices, pricesLoading,
  decks, setDecks, onOpenModal,
}) {
  const [mode, setMode] = useState('builder'); // 'builder' | 'check'

  return (
    <div className="decks-wrap">
      <div className="decks-modebar">
        <div className="seg">
          <button className={mode === 'builder' ? 'active' : ''} onClick={() => setMode('builder')}>Builder</button>
          <button className={mode === 'check' ? 'active' : ''} onClick={() => setMode('check')}>Deck Check</button>
        </div>
      </div>

      {mode === 'builder' ? (
        <DeckBuilder
          allCards={allCards}
          collection={collection}
          foilCollection={foilCollection}
          prices={prices}
          pricesLoading={pricesLoading}
          decks={decks}
          setDecks={setDecks}
          onOpenModal={onOpenModal}
        />
      ) : (
        <DeckCheck allCards={allCards} collection={collection} />
      )}
    </div>
  );
}
