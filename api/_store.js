'use strict';

function getStoreSecret() {
  return process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret';
}

function getStore() {
  if (!globalThis.__NAVIDUR_RUNTIME_STORE__) {
    globalThis.__NAVIDUR_RUNTIME_STORE__ = Object.create(null);
  }
  return globalThis.__NAVIDUR_RUNTIME_STORE__;
}

function isAuthorized(req) {
  return String(req.headers['x-navidur-store-secret'] || '') === getStoreSecret();
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
    const key = String(body.key || '');
    if (!key) return res.status(400).json({ error: 'key_required' });
    store[key] = body.value;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
};