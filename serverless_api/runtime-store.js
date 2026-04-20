'use strict';

const crypto = require('crypto');

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
      const users = [
        {
          id: 'usr_super_001',
          username: 'Mohamed_Admin',
          hashed_password: hashPassword('SuperAdmin2026!'),
          role: 'super_admin',
          active_status: true,
          assigned_stations: [],
          created_at: '2026-04-06T00:00:00.000Z',
          last_login: null,
          trust_score: null
        },
        {
          id: 'usr_field_admin_001',
          username: 'field_admin',
          hashed_password: hashPassword('FieldAdmin2026!'),
          role: 'admin',
          active_status: true,
          assigned_stations: [],
          created_at: '2026-04-07T00:00:00.000Z',
          last_login: null,
          trust_score: null
        },
        {
          id: 'usr_field_member_a',
          username: 'field_member_a',
          hashed_password: hashPassword('FieldTestA2026!'),
          role: 'member',
          active_status: true,
          assigned_stations: [],
          created_at: '2026-04-07T00:00:00.000Z',
          last_login: null,
          trust_score: null
        },
        {
          id: 'usr_field_member_b',
          username: 'field_member_b',
          hashed_password: hashPassword('FieldTestB2026!'),
          role: 'member',
          active_status: true,
          assigned_stations: [],
          created_at: '2026-04-07T00:00:00.000Z',
          last_login: null,
          trust_score: null
        }
      ];
      store.navidur_store_users = users;
      return res.status(200).json({
        ok: true,
        seeded_users: users.map((u) => ({ id: u.id, username: u.username, role: u.role })),
        tokens: {
          Mohamed_Admin: createToken(users[0]),
          field_admin: createToken(users[1]),
          field_member_a: createToken(users[2]),
          field_member_b: createToken(users[3])
        }
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