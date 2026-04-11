'use strict';

const { readJsonFile, writeJsonFile, createId } = require('./_lib/data-store');
const { isAllowedOrigin, setNoCache, parseBody, cleanString } = require('./_lib/security');
const { getAuthUser, canUserAddStations } = require('./_lib/auth');
const { normalizeStationInput, hasDuplicateStation } = require('./_lib/stations');

module.exports = async function handler(req, res) {
  setNoCache(res);

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });
  if (req.method === 'POST') {
    const actor = await getAuthUser(req);
    if (!actor) return res.status(401).json({ error: 'unauthorized' });
    if (!canUserAddStations(actor)) return res.status(403).json({ error: 'forbidden_station_create' });

    try {
      const body = parseBody(req);
      const rows = await readJsonFile('stations', []);

      const requestedId = cleanString(body.id, 80);
      const station = normalizeStationInput({
        ...body,
        id: requestedId || createId('st'),
        sort_order: body.sort_order != null ? body.sort_order : (rows.length + 1),
        status: body.status || 'active',
        added_from_field: body.added_from_field != null ? !!body.added_from_field : true,
        source_tag: body.source_tag || 'field'
      });

      if (hasDuplicateStation(rows, station)) {
        return res.status(409).json({ error: 'duplicate_station_name_coordinates' });
      }

      rows.push(station);
      await writeJsonFile('stations', rows);
      return res.status(201).json({ ok: true, station });
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : 'station_create_failed' });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const all = await readJsonFile('stations', []);
  const active = all
    .filter((s) => s && s.status !== 'archived' && s.status !== 'disabled')
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  return res.status(200).json({
    ok: true,
    total: active.length,
    stations: active
  });
};
