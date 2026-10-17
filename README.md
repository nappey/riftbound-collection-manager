# Riftbound Collection Manager

Desktop app for tracking your Riftbound TCG collection — prices, playsets, foils, deck checking, set entry wizard, and Discord-ready exports. Also supports **Cyberpunk TCG** — switch games from the header; each game keeps its own collection, decks and trade lists.

## Download

Go to [Releases](../../releases) and download the latest:

- **Windows** — the `.exe` installer
- **Mac (Apple Silicon — M1/M2/M3/M4)** — the `-arm64.dmg`. Open it and drag the app into Applications.

The Mac build isn't notarized by Apple, so the first launch is blocked with *"app is damaged"* or *"can't be opened"*. Clear the download quarantine once in Terminal:

```bash
xattr -cr "/Applications/Riftbound Collection Manager.app"
```

On Mac the app tells you when an update is out and links to the new `.dmg` (Windows updates install automatically).

## Features

- **Collection tracking** — track normal and foil copies per card, grouped by set
- **Playset detection** — automatically shows "1 playset", "1 playset +1", etc.
- **Live pricing** — market prices from TCGPlayer via tcgcsv.com
- **Rares/Showcase/Alt Art** handled as foil-only (no non-foil versions)
- **Set Entry Wizard** — step through cards domain-by-domain to log your collection
- **Deck Check** — paste a deck list and see what you're missing
- **Export** — Discord-ready code blocks or Markdown, filtered by set and content type
- **CSV Import/Export** — round-trips with Piltover Archive export format
- **Sync between devices** — Settings (⚙) → pick a file in Google Drive / iCloud / Dropbox / OneDrive; collection, decks, trade lists and Merchant stay in sync automatically
- **Multi-game** — Riftbound (cards from riftcodex, prices from tcgcsv category 89) and Cyberpunk TCG (cards + every printing from the Netdeck.gg API behind cyberpunktcg.com, prices/product ids from tcgcsv category 92 `ProductsAndPrices.csv`). Game configs live in `src/games/` — adding a game means adding a config + adapter there.
- **Cyberpunk deck builder** — 3 Legends, 40–50 card deck, 7-card sideboard, per-color RAM budget validation, Netdeck-format decklist import/export

## Sync between devices

The app can keep your data in step across computers (e.g. a Mac and a Windows PC) through any folder your cloud drive syncs. It doesn't need a Google sign-in.

1. Install the desktop app for your cloud drive: [Google Drive for desktop](https://www.google.com/drive/download/), iCloud Drive, Dropbox or OneDrive.
2. **First computer:** ⚙ Settings → **Create sync file…** → save it inside the synced folder.
3. **Other computers:** ⚙ Settings → **Use existing sync file…** → pick that same file → choose **Use data from file**.

From then on, every change is saved to the file within a couple of seconds. When another computer's newer changes arrive, they load automatically, replacing this computer's data; the newest change wins. Settings has **Undo last sync load** if that ever overwrites something you wanted. Turn on *Also save a collection CSV* to get a readable `riftbound-collection.csv` (Piltover Archive format) next to the sync file.

Tip: avoid editing on two computers at the same moment; the later save wins.

### Compare collections with friends

Put everyone's sync file in **one shared folder** and each person's collection shows up in the **Friends** tab:

1. Share a Google Drive folder with your friends. Each friend adds it to their own *My Drive* (right-click → *Organize → Add shortcut*) so Google Drive for desktop syncs it.
2. Everyone sets **Your name** in ⚙ Settings, then **Create sync file…** inside that shared folder. Each person gets their own file, e.g. `card-manager-alex.json`. Only use *Use existing* to pick **your own** file on your other computers.
3. Mark cards **LF** (Looking For) and **UFT** (Up For Trade) as usual.

The Friends tab then shows:
- what each friend can trade you, meaning cards you're Looking For that they have spare or marked UFT
- what you can trade them
- their full collection next to your counts

Clicking a card shows which friends own it. Friends' files are only ever read, never changed. Everyone in the folder can see your collection, decks and trade lists.

## Development

```bash
npm install              # install dependencies
npm run dev              # browser-only dev server → http://localhost:5173
npm run electron:dev     # Electron window + Vite hot-reload
npm run electron:build   # build installer for the current OS → release/
npm run electron:build:mac  # Apple Silicon .dmg/.zip → release/ (run on a Mac)
npm run electron:build:win  # Windows installer → release/
```

## Publishing a Release

1. Update `"version"` in `package.json`
2. Commit: `git commit -am "chore: bump to vX.Y.Z"`
3. Tag and push: `git tag vX.Y.Z && git push origin main --tags`

GitHub Actions builds the Windows installer and the Apple Silicon Mac `.dmg` and creates a release automatically. Friends download from the [Releases](../../releases) page.

# How to use

## Main Collection Tab
<img width="1397" height="836" alt="image" src="https://github.com/user-attachments/assets/a9a1a464-bac0-4cd5-b503-ac5955d07799" />

Click checkbox for playset, otherwise add cards by hitting +

## Set Entry Wizard
Will go through whichever set you select and domain and go through the cards in an ascending order for energy cost.
<img width="1416" height="793" alt="image" src="https://github.com/user-attachments/assets/af1e959f-9dbd-45e6-b2d3-3b6fcb4cacbb" />

## Deck Check
Paste deck list in text form 

<img width="1402" height="880" alt="image" src="https://github.com/user-attachments/assets/684ebfa9-225b-4b0d-88be-2fea7ef53970" />

##  Export

If you want to share with friends what foils you have you can create an export for different sets and what cards you want to export

<img width="1400" height="831" alt="image" src="https://github.com/user-attachments/assets/a5f70b47-f008-47cc-80e2-589330458784" />

## Exporting your database
- Exports as csv I would do this when you finish entering your collection. IF your data ever disappears you can reimport it.
