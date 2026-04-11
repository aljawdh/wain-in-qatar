'use strict';

const { readJsonFile, writeJsonFile, createId, nowIso } = require('./_lib/data-store');
const { isAllowedOrigin, setNoCache, parseBody, cleanString } = require('./_lib/security');
const { getAuthUser } = require('./_lib/auth');

function normalizeSpeciesName(value) {
  return cleanString(value, 80);
}

function normalizeRegions(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => cleanString(x, 30).toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeSpecies(input, existing) {
  const base = existing || {};
  const now = nowIso();
  const name = normalizeSpeciesName(input.name != null ? input.name : base.name);
  if (!name) throw new Error('fish_name_required');

  const statusRaw = cleanString(input.status != null ? input.status : base.status, 20).toLowerCase();
  const status = statusRaw === 'archived' ? 'archived' : 'active';

  return {
    id: cleanString(base.id || input.id, 80) || createId('fish'),
    name,
    icon: cleanString(input.icon != null ? input.icon : base.icon, 8) || '🐟',
    regions: normalizeRegions(input.regions != null ? input.regions : base.regions),
    status,
    archived_at: status === 'archived' ? (base.archived_at || now) : null,
    created_at: base.created_at || now,
    updated_at: now
  };
}

function hasDuplicateName(rows, name, skipId) {
  const target = String(name || '').trim().toLowerCase();
  return rows.some((row) => {
    if (!row) return false;
    if (skipId && row.id === skipId) return false;
    if (String(row.status || 'active').toLowerCase() === 'archived') return false;
    return String(row.name || '').trim().toLowerCase() === target;
  });
}

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });

  if (req.method === 'GET') {
    const includeArchived = String((req.query && req.query.include_archived) || '') === '1';
    const rows = await readJsonFile('fish_species', []);
    const fishSpecies = rows
      .filter((row) => row && (includeArchived || String(row.status || 'active').toLowerCase() !== 'archived'))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    return res.status(200).json({ ok: true, total: fishSpecies.length, fish_species: fishSpecies });
  }

  const actor = await getAuthUser(req);
  if (!actor) return res.status(401).json({ error: 'unauthorized' });

  if (req.method === 'POST') {
    try {
      const body = parseBody(req);
      const rows = await readJsonFile('fish_species', []);
      const next = normalizeSpecies(body);
      if (hasDuplicateName(rows, next.name)) {
        return res.status(409).json({ error: 'fish_name_exists' });
      }
      rows.push(next);
      await writeJsonFile('fish_species', rows);
      return res.status(201).json({ ok: true, fish: next });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'fish_create_failed' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const body = parseBody(req);
      const fishId = cleanString(body.id, 80);
      if (!fishId) return res.status(400).json({ error: 'fish_id_required' });
      const rows = await readJsonFile('fish_species', []);
      const idx = rows.findIndex((row) => row && row.id === fishId);
      if (idx < 0) return res.status(404).json({ error: 'fish_not_found' });
      const next = normalizeSpecies({ ...rows[idx], ...body }, rows[idx]);
      if (hasDuplicateName(rows, next.name, fishId)) {
        return res.status(409).json({ error: 'fish_name_exists' });
      }
      rows[idx] = next;
      await writeJsonFile('fish_species', rows);
      return res.status(200).json({ ok: true, fish: next });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'fish_update_failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'method_not_allowed' });
};
