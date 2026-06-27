'use strict';

// Electron 41 only intercepts require('electron') when loaded from an asar.
// For dev mode: pack a minimal asar (electron files only, no dist/) and launch
// the win-unpacked binary with ELECTRON_IS_DEV=1.
// The React frontend loads from the Vite dev server at localhost:5173.

const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const asar = require('@electron/asar');

const root    = path.join(__dirname, '..');
const tmpDir  = path.join(root, 'release', 'asar-dev-tmp');
const asarOut = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const binary  = path.join(root, 'release', 'win-unpacked', 'Riftbound Collection Manager.exe');

if (!fs.existsSync(binary)) {
  console.error('win-unpacked not found — run npm run electron:build first.');
  process.exit(1);
}

(async () => {
  // Build a minimal asar: electron/ files + slimmed package.json (no dist/)
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'electron'), { recursive: true });

  for (const f of fs.readdirSync(path.join(root, 'electron'))) {
    fs.copyFileSync(path.join(root, 'electron', f), path.join(tmpDir, 'electron', f));
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main })
  );

  // Use the Node API (not the CLI) so paths with spaces pack reliably.
  await asar.createPackage(tmpDir, asarOut);
  fs.rmSync(tmpDir, { recursive: true });
  console.log('Dev asar ready — launching Electron...');

  const child = spawn(binary, [], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_IS_DEV: '1' },
  });
  child.on('close', () => process.exit(0));
})().catch(err => { console.error('electron-dev failed:', err); process.exit(1); });
