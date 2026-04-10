'use strict';

const { Redis } = require('@upstash/redis');
const fs = require('fs/promises');
const path = require('path');

// Bundled seed data shipped with the deployment (read-only on Vercel).
// Used ONLY for one-time KV bootstrap and local development writes.
const DATA_SEED_DIR = path.join(__dirname, '..', '..', 'data');

const FILES = {
  users: 'users.json',
  stations: 'stations.json',
  feedback: 'feedback.json',
  audit: 'audit_logs.json',
  tracking: 'tracking.json',
  catch_logs: 'catch_logs.json'
};

let _kvClient = null;

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.KV_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url, token };
}

function getKv() {
  if (_kvClient) return _kvClient;
  const cfg = getKvConfig();
  if (!cfg) return null;
  _kvClient = new Redis({ url: cfg.url, token: cfg.token });
  return _kvClient;
}

function kvStoreKey(key) {
  if (!FILES[key]) throw new Error('unknown_store_key_' + key);
  return 'navidur_store_' + key;
}

// Read the bundled seed file. Used for:
//   1. One-time KV bootstrap on first deploy or after a KV flush.
//   2. All reads/writes in local development (data/ is writable).
async function readSeedFile(key, fallback) {
  const fname = FILES[key];
  if (!fname) return JSON.parse(JSON.stringify(fallback));
  try {
    const raw = await fs.readFile(path.join(DATA_SEED_DIR, fname), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return JSON.parse(JSON.stringify(fallback));
  }
}

// Write directly to data/ — only used in local development (not on Vercel).
async function writeToSeedFile(key, value) {
  await fs.mkdir(DATA_SEED_DIR, { recursive: true });
  const fname = FILES[key];
  if (!fname) throw new Error('unknown_store_key_' + key);
  const full = path.join(DATA_SEED_DIR, fname);
  const tmp = full + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, full);
}

// On Vercel without KV configured, throw a clear error so callers surface a
// meaningful 500 / 503 instead of silently returning stale or ephemeral data.
function assertPersistentStoreAvailable() {
  if (process.env.VERCEL && !getKv()) {
    throw new Error(
      'persistent_store_not_configured: ' +
      'Set KV_REST_API_URL and KV_REST_API_TOKEN (Upstash Redis) ' +
      'in Vercel project environment variables to enable persistent station storage.'
    );
  }
}

async function readJsonFile(key, fallback) {
  const kv = getKv();

  if (kv) {
    const storeKey = kvStoreKey(key);
    // Let KV errors propagate — callers should surface them, not swallow them.
    const raw = await kv.get(storeKey);
    if (raw != null) {
      if (typeof raw === 'string') return JSON.parse(raw);
      return raw;
    }
    // KV key absent — one-time bootstrap from bundled seed file.
    // This only happens on first deploy or after an explicit KV flush.
    // After this point the seed file is never consulted for reads again.
    const seeded = await readSeedFile(key, fallback);
    await kv.set(storeKey, JSON.stringify(seeded));
    return JSON.parse(JSON.stringify(seeded));
  }

  // No KV configured.
  assertPersistentStoreAvailable(); // throws on Vercel — keeps ephemeral storage out of the write path

  // Local development: read/write directly from data/
  return readSeedFile(key, fallback);
}

async function writeJsonFile(key, value) {
  const kv = getKv();

  if (kv) {
    await kv.set(kvStoreKey(key), JSON.stringify(value));
    return;
  }

  assertPersistentStoreAvailable(); // throws on Vercel

  // Local development only
  await writeToSeedFile(key, value);
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return prefix + '_' + Date.now().toString(36) + rand;
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  nowIso,
  createId
};
