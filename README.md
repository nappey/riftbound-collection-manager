# Riftbound Collection Manager

Desktop app for tracking your Riftbound TCG collection — prices, playsets, foils, deck checking, set entry wizard, and Discord-ready exports.

## Download

Go to [Releases](../../releases) and download the latest `.exe` installer (Windows).

## Features

- **Collection tracking** — track normal and foil copies per card, grouped by set
- **Playset detection** — automatically shows "1 playset", "1 playset +1", etc.
- **Live pricing** — market prices from TCGPlayer via tcgcsv.com
- **Rares/Showcase/Alt Art** handled as foil-only (no non-foil versions)
- **Set Entry Wizard** — step through cards domain-by-domain to log your collection
- **Deck Check** — paste a deck list and see what you're missing
- **Export** — Discord-ready code blocks or Markdown, filtered by set and content type
- **CSV Import/Export** — round-trips with Piltover Archive export format

## Development

```bash
npm install              # install dependencies
npm run dev              # browser-only dev server → http://localhost:5173
npm run electron:dev     # Electron window + Vite hot-reload
npm run electron:build   # build Windows installer → release/
```

## Publishing a Release

1. Update `"version"` in `package.json`
2. Commit: `git commit -am "chore: bump to vX.Y.Z"`
3. Tag and push: `git tag vX.Y.Z && git push origin main --tags`

GitHub Actions builds the Windows installer and creates a release automatically. Friends download from the [Releases](../../releases) page.

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
