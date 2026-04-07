#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');

const TARGETS = [
  {
    key: 'users',
    file: path.join(DATA_DIR, 'users.json'),
    isTest: (x) => {
      const id = String(x.id || '').toLowerCase();
      const name = String(x.username || '').toLowerCase();
      return id.includes('test') || name.startsWith('test');
    }
  },
  {
    key: 'stations',
    file: path.join(DATA_DIR, 'stations.json'),
    isTest: (x) => {
      const id = String(x.id || '').toLowerCase();
      const name = String(x.name || '').toLowerCase();
      return id.includes('test') || name.includes('test');
    }
  },
  {
    key: 'feedback',
    file: path.join(DATA_DIR, 'feedback.json'),
    isTest: (x) => {
      const id = String(x.id || '').toLowerCase();
      const user = String(x.user_id || '').toLowerCase();
      const stationId = String(x.station_id || '').toLowerCase();
      const station = String(x.station || '').toLowerCase();
      return id.includes('test') || user.includes('test') || stationId.includes('test') || station.includes('test');
    }
  },
  {
    key: 'tracking',
    file: path.join(DATA_DIR, 'tracking.json'),
    isTest: (x) => {
      const id = String(x.id || '').toLowerCase();
      const session = String(x.session_id || '').toLowerCase();
      return id.includes('test') || session.includes('test');
    }
  }
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function run(apply) {
  const out = {};

  for (const t of TARGETS) {
    if (!fs.existsSync(t.file)) {
      out[t.key] = { before: 0, removed: 0, after: 0, missing: true };
      continue;
    }

    const rows = Array.isArray(readJson(t.file)) ? readJson(t.file) : [];
    const keep = rows.filter((x) => !t.isTest(x));
    const removed = rows.length - keep.length;

    if (apply && removed > 0) {
      writeJson(t.file, keep);
    }

    out[t.key] = {
      before: rows.length,
      removed,
      after: apply ? keep.length : rows.length,
      mode: apply ? 'apply' : 'dry-run'
    };
  }

  return out;
}

const apply = process.argv.includes('--apply');
const result = run(apply);
console.log(JSON.stringify(result, null, 2));
