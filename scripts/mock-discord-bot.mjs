// Local stand-in for the riftbound-team-tracker bot API, for developing the
// Settings → Discord link without AWS. Implements POST /link, PUT /collection
// and DELETE /link per the handoff spec, logs every request, and adds two
// test-only routes:
//   POST /admin/code     → { key } a fresh one-time link key (10 min)
//   POST /admin/revoke   → revoke every token (simulates /collection unlink)
//   GET  /admin/log      → every request seen so far (bodies included)
//
//   node scripts/mock-discord-bot.mjs [port]     (default 8790)

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] ?? 8790);
const BASE = `http://localhost:${PORT}`;
const MAX_BODY = 512 * 1024;

const codes = new Map();   // normalized code → expiresAt
const tokens = new Map();  // token → user
const latest = new Map();  // user id → last accepted updatedAt
const log = [];

const norm = (c) => String(c ?? '').toUpperCase().replace(/-/g, '');
const newCode = () => {
  const raw = randomBytes(4).toString('hex').toUpperCase();
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  codes.set(norm(code), Date.now() + 10 * 60 * 1000);
  return code;
};

function send(res, status, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  });
  res.end(body ? JSON.stringify(body) : undefined);
}
const err = (res, status, error, message) => send(res, status, { error, message });

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
  req.on('end', () => {
    const path = new URL(req.url, BASE).pathname;
    if (req.method === 'OPTIONS') return send(res, 204);
    const text = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* handled per route */ }
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const user = tokens.get(auth);
    const entry = { at: new Date().toISOString(), method: req.method, path, size, auth: auth ? `${auth.slice(0, 4)}…` : null, body };
    if (!path.startsWith('/admin')) { log.push(entry); console.log(JSON.stringify(entry)); }

    if (req.method === 'POST' && path === '/admin/code') return send(res, 200, { key: `${BASE}/#${newCode()}` });
    if (req.method === 'POST' && path === '/admin/revoke') { tokens.clear(); return send(res, 200, { ok: true }); }
    if (req.method === 'GET' && path === '/admin/log') return send(res, 200, log);

    if (req.method === 'POST' && path === '/link') {
      const exp = codes.get(norm(body?.code));
      if (!exp || exp < Date.now()) return err(res, 400, 'invalid_code', 'Unknown, expired or used code');
      codes.delete(norm(body.code));
      const token = randomBytes(24).toString('base64url');
      const u = { id: '1234567890', name: 'heebs' };
      tokens.set(token, u);
      return send(res, 200, { token, user: u });
    }
    if (req.method === 'PUT' && path === '/collection') {
      if (!user) return err(res, 401, 'unlinked', 'Token revoked');
      if (size > MAX_BODY) return err(res, 413, 'too_large', 'Body over 512 KB');
      if (!body || body.format !== 1 || body.game !== 'riftbound' || typeof body.cards !== 'object') {
        return err(res, 400, 'bad_payload', 'Malformed body');
      }
      if ((latest.get(user.id) ?? 0) > body.updatedAt) return err(res, 409, 'stale', 'A newer push already landed');
      latest.set(user.id, body.updatedAt);
      return send(res, 200, { ok: true, cards: Object.keys(body.cards).length, updatedAt: body.updatedAt });
    }
    if (req.method === 'DELETE' && path === '/link') {
      if (!user) return err(res, 401, 'unlinked', 'Token revoked');
      tokens.delete(auth);
      return send(res, 204);
    }
    return err(res, 404, 'not_found', `${req.method} ${path}`);
  });
});

server.listen(PORT, () => console.log(`mock bot on ${BASE} — POST ${BASE}/admin/code for a link key`));
