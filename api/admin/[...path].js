'use strict';

const { readJsonFile, writeJsonFile, createId, nowIso } = require('../_lib/data-store');
const { requireRole, createUser, hashPassword } = require('../_lib/auth');
const { normalizeStationInput, hasDuplicateStation, normalizeStatus } = require('../_lib/stations');
const { isAllowedOrigin, parseBody, cleanString, setNoCache } = require('../_lib/security');

async function writeAudit(action, actor, details) {
  const audit = await readJsonFile('audit', []);
  audit.push({
    id: createId('audit'),
    action,
    actor_user_id: actor ? actor.id : null,
    actor_username: actor ? actor.username : null,
    details: details || {},
    timestamp: nowIso()
  });
  await writeJsonFile('audit', audit);
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active_status: user.active_status !== false,
    assigned_stations: Array.isArray(user.assigned_stations) ? user.assigned_stations : [],
    created_at: user.created_at || null,
    last_login: user.last_login || null,
    trust_score: user.trust_score != null ? user.trust_score : null
  };
}

function getPathSegments(req) {
  const p = req.query && req.query.path;
  if (Array.isArray(p)) return p;
  if (typeof p === 'string' && p) return [p];
  const rawUrl = String((req && req.url) || '');
  const noQuery = rawUrl.split('?')[0];
  const marker = '/api/admin/';
  const idx = noQuery.indexOf(marker);
  if (idx >= 0) {
    return noQuery.slice(idx + marker.length).split('/').map((x) => cleanString(x, 120)).filter(Boolean);
  }
  return [];
}

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });

  const actor = await requireRole('admin')(req, res);
  if (!actor) return;

  const segments = getPathSegments(req);
  const [root, id, action] = segments;

  if (root === 'feedback') {
    if (req.method === 'GET') {
      const station = cleanString(req.query && req.query.station, 100);
      const userId = cleanString(req.query && req.query.user_id, 80);
      const date = cleanString(req.query && req.query.date, 20);
      const rows = await readJsonFile('feedback', []);
      const filtered = rows.filter((r) => {
        if (r.archived) return false;
        if (station && String(r.station || '') !== station) return false;
        if (userId && String(r.user_id || '') !== userId) return false;
        if (date && String(r.timestamp || '').slice(0, 10) !== date) return false;
        return true;
      });
      return res.status(200).json({ ok: true, total: filtered.length, feedback: filtered });
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const feedbackId = cleanString(body.id, 80);
      if (!feedbackId) return res.status(400).json({ error: 'feedback_id_required' });
      const rows = await readJsonFile('feedback', []);
      const idx = rows.findIndex((x) => x.id === feedbackId);
      if (idx < 0) return res.status(404).json({ error: 'feedback_not_found' });
      if (body.action === 'archive') {
        rows[idx].archived = true;
        rows[idx].updated_at = nowIso();
        await writeJsonFile('feedback', rows);
        await writeAudit('feedback_archived', actor, { feedback_id: feedbackId });
        return res.status(200).json({ ok: true, feedback: rows[idx] });
      }
      return res.status(400).json({ error: 'invalid_action' });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'stations') {
    if (!id) {
      if (req.method === 'GET') {
        const rows = await readJsonFile('stations', []);
        const out = rows.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
        return res.status(200).json({ ok: true, total: out.length, stations: out });
      }
      if (req.method === 'POST') {
        try {
          const body = parseBody(req);
          const rows = await readJsonFile('stations', []);
          const requestedId = cleanString(body.id, 80);
          const existingIdx = requestedId ? rows.findIndex((s) => s.id === requestedId) : -1;

          // Upsert by id on the root endpoint to avoid route mismatch issues on some deployments.
          if (existingIdx >= 0) {
            const station = normalizeStationInput({ ...rows[existingIdx], ...body, id: requestedId }, rows[existingIdx]);
            if (hasDuplicateStation(rows, station, requestedId)) {
              return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
            }
            rows[existingIdx] = station;
            await writeJsonFile('stations', rows);
            await writeAudit('station_updated', actor, { station_id: station.id, station_name: station.name });
            return res.status(200).json({ ok: true, station });
          }

          const station = normalizeStationInput({
            ...body,
            id: requestedId || createId('st'),
            sort_order: body.sort_order != null ? body.sort_order : (rows.length + 1),
            status: body.status || 'active'
          });
          if (hasDuplicateStation(rows, station)) {
            return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
          }
          rows.push(station);
          await writeJsonFile('stations', rows);
          await writeAudit('station_created', actor, { station_id: station.id, station_name: station.name });
          return res.status(201).json({ ok: true, station });
        } catch (err) {
          return res.status(400).json({ error: err && err.message ? err.message : 'station_create_failed' });
        }
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    if (action === 'status') {
      if (req.method !== 'PATCH') {
        res.setHeader('Allow', 'PATCH');
        return res.status(405).json({ error: 'method_not_allowed' });
      }
      const body = parseBody(req);
      const nextStatus = normalizeStatus(body.status);
      const rows = await readJsonFile('stations', []);
      const idx = rows.findIndex((s) => s.id === id);
      if (idx < 0) return res.status(404).json({ error: 'station_not_found' });
      rows[idx] = { ...rows[idx], status: nextStatus, updated_at: nowIso() };
      await writeJsonFile('stations', rows);
      await writeAudit('station_status_changed', actor, { station_id: rows[idx].id, status: nextStatus });
      return res.status(200).json({ ok: true, station: rows[idx] });
    }

    const rows = await readJsonFile('stations', []);
    const idx = rows.findIndex((s) => s.id === id);
    if (idx < 0) return res.status(404).json({ error: 'station_not_found' });

    if (req.method === 'PUT') {
      try {
        const body = parseBody(req);
        const next = normalizeStationInput({ ...rows[idx], ...body, id }, rows[idx]);
        if (hasDuplicateStation(rows, next, id)) {
          return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
        }
        rows[idx] = next;
        await writeJsonFile('stations', rows);
        await writeAudit('station_updated', actor, { station_id: next.id, station_name: next.name });
        return res.status(200).json({ ok: true, station: next });
      } catch (err) {
        return res.status(400).json({ error: err && err.message ? err.message : 'station_update_failed' });
      }
    }

    if (req.method === 'DELETE') {
      rows[idx] = { ...rows[idx], status: 'archived', updated_at: nowIso() };
      await writeJsonFile('stations', rows);
      await writeAudit('station_archived', actor, { station_id: rows[idx].id, station_name: rows[idx].name });
      return res.status(200).json({ ok: true, station: rows[idx] });
    }

    res.setHeader('Allow', 'PUT, DELETE, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (root === 'users') {
    if (!id) {
      if (req.method === 'GET') {
        const users = await readJsonFile('users', []);
        return res.status(200).json({ ok: true, total: users.length, users: users.map(safeUser) });
      }
      if (req.method === 'POST') {
        try {
          const body = parseBody(req);
          const user = await createUser(body, actor);
          await writeAudit('user_created', actor, { user_id: user.id, username: user.username, role: user.role });
          return res.status(201).json({ ok: true, user: safeUser(user) });
        } catch (err) {
          return res.status(400).json({ error: err && err.message ? err.message : 'user_create_failed' });
        }
      }
      if (req.method === 'PATCH') {
        const body = parseBody(req);
        const userId = cleanString(body.id, 80);
        if (!userId) return res.status(400).json({ error: 'user_id_required' });
        const users = await readJsonFile('users', []);
        const userIdx = users.findIndex((u) => u.id === userId);
        if (userIdx < 0) return res.status(404).json({ error: 'user_not_found' });
        if (typeof body.active_status === 'boolean') users[userIdx].active_status = body.active_status;
        if (Array.isArray(body.assigned_stations)) {
          users[userIdx].assigned_stations = body.assigned_stations.map((x) => cleanString(x, 80)).filter(Boolean).slice(0, 300);
        }
        await writeJsonFile('users', users);
        await writeAudit('user_updated', actor, { user_id: userId, active_status: users[userIdx].active_status });
        return res.status(200).json({ ok: true, user: safeUser(users[userIdx]) });
      }
      res.setHeader('Allow', 'GET, POST, PATCH');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    if (action === 'password') {
      if (req.method !== 'PATCH') {
        res.setHeader('Allow', 'PATCH');
        return res.status(405).json({ error: 'method_not_allowed' });
      }
      const body = parseBody(req);
      const nextPassword = cleanString(body.password, 200);
      if (!nextPassword) return res.status(400).json({ error: 'user_id_password_required' });
      const users = await readJsonFile('users', []);
      const userIdx = users.findIndex((u) => u.id === id);
      if (userIdx < 0) return res.status(404).json({ error: 'user_not_found' });
      users[userIdx].hashed_password = hashPassword(nextPassword);
      await writeJsonFile('users', users);
      await writeAudit('password_changed', actor, { user_id: id });
      return res.status(200).json({ ok: true });
    }
  }

  return res.status(404).json({ error: 'admin_route_not_found' });
};