'use strict';

const { Redis } = require('@upstash/redis');
const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const FILES = {
  users: 'users.json',
  stations: 'stations.json',
  feedback: 'feedback.json',
  audit: 'audit_logs.json',
  tracking: 'tracking.json'
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

function getRuntimeStoreBaseUrl() {
  const explicit = String(process.env.NAVIDUR_STORE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const appUrl = String(process.env.NAVIDUR_APP_URL || 'https://navidur.app').trim();
  return (/^https?:\/\//i.test(appUrl) ? appUrl : 'https://' + appUrl).replace(/\/$/, '');
}

function shouldUseRuntimeStore() {
  return !getKv() && !!process.env.VERCEL;
}

function getRuntimeStoreSecret() {
  return String(process.env.NAVIDUR_STORE_SECRET || process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret');
}

async function runtimeStoreRead(key) {
  const url = getRuntimeStoreBaseUrl() + '/api/runtime-store?key=' + encodeURIComponent(key);
  const headers = { 'x-navidur-store-secret': getRuntimeStoreSecret() };
  const res = await fetch(url, {
    method: 'GET',
    headers
  });
  if (!res.ok) throw new Error('runtime_store_read_failed_' + res.status);
  return res.json();
}

async function runtimeStoreWrite(key, value) {
  const url = getRuntimeStoreBaseUrl() + '/api/runtime-store';
  const headers = {
    'Content-Type': 'application/json',
    'x-navidur-store-secret': getRuntimeStoreSecret()
  };
  const body = JSON.stringify({ key, value });
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body
  });
  if (!res.ok) throw new Error('runtime_store_write_failed_' + res.status);
}

async function readFromFileStore(key, fallback) {
  const full = filePath(key);
  try {
    const raw = await fs.readFile(full, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return JSON.parse(JSON.stringify(fallback));
    }
    return JSON.parse(JSON.stringify(fallback));
  }
}

async function writeToFileStore(key, value) {
  await ensureDataDir();
  const full = filePath(key);
  const tmp = full + '.tmp';
  const content = JSON.stringify(value, null, 2) + '\n';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, full);
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(key) {
  const name = FILES[key];
  if (!name) throw new Error('unknown_store_key_' + key);
  return path.join(DATA_DIR, name);
}

async function readJsonFile(key, fallback) {
  const kv = getKv();
  if (kv) {
    const storeKey = kvStoreKey(key);
    try {
      const raw = await kv.get(storeKey);
      if (raw != null) {
        if (typeof raw === 'string') return JSON.parse(raw);
        return raw;
      }
      const seeded = await readFromFileStore(key, fallback);
      await kv.set(storeKey, JSON.stringify(seeded));
      return JSON.parse(JSON.stringify(seeded));
    } catch (_err) {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  if (shouldUseRuntimeStore()) {
    try {
      const storeKey = kvStoreKey(key);
      const payload = await runtimeStoreRead(storeKey);
      if (payload && payload.found) {
        return JSON.parse(JSON.stringify(payload.value));
      }
      const seeded = await readFromFileStore(key, fallback);
      await runtimeStoreWrite(storeKey, seeded);
      return JSON.parse(JSON.stringify(seeded));
    } catch (_err) {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  return readFromFileStore(key, fallback);
}

async function writeJsonFile(key, value) {
  const kv = getKv();
  if (kv) {
    await kv.set(kvStoreKey(key), JSON.stringify(value));
    return;
  }

  if (shouldUseRuntimeStore()) {
    await runtimeStoreWrite(kvStoreKey(key), value);
    return;
  }

  await writeToFileStore(key, value);
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
