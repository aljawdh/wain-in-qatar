'use strict';

const crypto = require('crypto');
const auth = require('./_lib/auth');

function getStoreSecret() {
  return String(process.env.NAVIDUR_STORE_SECRET || process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret');
}

function getStore() {
  if (!globalThis.__NAVIDUR_RUNTIME_STORE__) {
    globalThis.__NAVIDUR_RUNTIME_STORE__ = Object.create(null);
  }
  return globalThis.__NAVIDUR_RUNTIME_STORE__;
}

function isAuthorized(req) {
  const provided = String(req.headers['x-navidur-store-secret'] || '');
  return provided === getStoreSecret();
}

function getAuthSalt() {
  return process.env.NAVIDUR_AUTH_SALT || 'navidur-static-salt';
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '') + '|' + getAuthSalt()).digest('hex');
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getStoreSecret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function createToken(user) {
  return signPayload({
    user_id: user.id,
    role: user.role,
    username: user.username,
    exp: Date.now() + (12 * 60 * 60 * 1000)
  });
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized_store_access' });
  }

  const store = getStore();

  if (req.method === 'GET') {
    const key = String((req.query && req.query.key) || '');
    if (!key) return res.status(400).json({ error: 'key_required' });
    if (!Object.prototype.hasOwnProperty.call(store, key)) {
      return res.status(200).json({ ok: true, found: false, value: null });
    }
    return res.status(200).json({ ok: true, found: true, value: store[key] });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (body && body.action === 'bootstrap_field_accounts') {
      if (!auth.isFieldAccountsEnabled()) {
        return res.status(403).json({
          ok: false,
          error: 'field_accounts_disabled',
          hint: 'Set NAVIDUR_ALLOW_FIELD_ACCOUNTS=true and NAVIDUR_FIELD_ACCOUNTS_JSON'
        });
      }
      const fieldDefs = auth.getFieldAccounts();
      if (!fieldDefs.length) {
        return res.status(400).json({
          ok: false,
          error: 'field_accounts_not_configured',
          hint: 'NAVIDUR_FIELD_ACCOUNTS_JSON is missing or invalid'
        });
      }
      const now = new Date().toISOString();
      const users = fieldDefs.map(function (def) {
        return {
          id: def.id,
          username: def.username,
          hashed_password: hashPassword(def.password),
          role: def.role,
          active_status: true,
          assigned_stations: [],
          created_at: now,
          last_login: null,
          trust_score: null
        };
      });
      store.navidur_store_users = users;
      const tokens = {};
      users.forEach(function (u) {
        tokens[u.username] = createToken(u);
      });
      return res.status(200).json({
        ok: true,
        seeded_users: users.map(function (u) { return { id: u.id, username: u.username, role: u.role }; }),
        tokens: tokens
      });
    }

    const key = String(body.key || '');
    if (!key) return res.status(400).json({ error: 'key_required' });
    store[key] = body.value;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
};