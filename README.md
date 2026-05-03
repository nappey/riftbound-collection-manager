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
