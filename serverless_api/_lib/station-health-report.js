'use strict';

const { readJsonFile } = require('./data-store');
const { toNumber, cleanString } = require('./security');
const { getWeatherData } = require('./navidur-analysis-runtime');

const WEATHER_CONCURRENCY = 4;

/**
 * Read-only NAVIDUR station health + reference linkage report.
 * Does not write station data or weather cache (uses getWeatherData only).
 */
async function buildStationHealthReport() {
  const raw = await readJsonFile('stations', []);
  const list = Array.isArray(raw) ? raw : [];
  const idToStation = {};
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    if (!s || s.id == null) continue;
    const sid = String(s.id).trim();
    if (sid) idToStation[sid] = s;
  }

  const stationRows = [];
  for (let i = 0; i < list.length; i += WEATHER_CONCURRENCY) {
    const chunk = list.slice(i, i + WEATHER_CONCURRENCY);
    const part = await Promise.all(chunk.map((s) => buildOneStationRow(s, idToStation)));
    for (let j = 0; j < part.length; j += 1) {
      stationRows.push(part[j]);
    }
  }

  const referenceGroups = [];
  for (let r = 0; r < stationRows.length; r += 1) {
    const row = stationRows[r];
    if (row.station_type === 'reference') {
      referenceGroups.push({
        reference_station_id: row.station_id,
        reference_station_name: row.station_name,
        linked_operational_stations: []
      });
    }
  }
  const refGroupIndex = {};
  for (let g = 0; g < referenceGroups.length; g += 1) {
    refGroupIndex[referenceGroups[g].reference_station_id] = g;
  }

  const operationalWithoutReference = [];

  for (let r = 0; r < stationRows.length; r += 1) {
    const row = stationRows[r];
    if (row.station_type === 'operational' && row.data_status === 'missing_reference') {
      operationalWithoutReference.push({
        station_id: row.station_id,
        station_name: row.station_name,
        country: row.country,
        region: row.region,
        area: row.area,
        lat: row.lat,
        lon: row.lon,
        data_status: row.data_status
      });
    }
    if (row.station_type === 'operational' && row.reference_station_id) {
      const rid = String(row.reference_station_id).trim();
      if (rid) {
        const gi = refGroupIndex[rid];
        if (gi != null) {
          referenceGroups[gi].linked_operational_stations.push({
            station_id: row.station_id,
            station_name: row.station_name,
            country: row.country,
            region: row.region,
            area: row.area,
            lat: row.lat,
            lon: row.lon,
            data_status: row.data_status
          });
        }
      }
    }
  }

  const referenceWithoutOperationalChildren = [];
  for (let g = 0; g < referenceGroups.length; g += 1) {
    const grp = referenceGroups[g];
    if (!grp.linked_operational_stations.length) {
      referenceWithoutOperationalChildren.push({
        reference_station_id: grp.reference_station_id,
        reference_station_name: grp.reference_station_name
      });
    }
  }

  const needsReview = [];
  for (let r = 0; r < stationRows.length; r += 1) {
    const row = stationRows[r];
    if (
      row.data_status === 'failed' ||
      row.data_status === 'missing_coordinates' ||
      row.data_status === 'missing_reference'
    ) {
      needsReview.push({
        station_id: row.station_id,
        station_name: row.station_name,
        station_type: row.station_type,
        country: row.country,
        region: row.region,
        area: row.area,
        data_status: row.data_status,
        weather_fetch_status: row.weather_fetch_status,
        latest_error: row.latest_error,
        reference_station_id: row.reference_station_id,
        resolved_reference_station_name: row.resolved_reference_station_name
      });
    }
  }
  for (let c = 0; c < referenceWithoutOperationalChildren.length; c += 1) {
    const o = referenceWithoutOperationalChildren[c];
    needsReview.push({
      station_id: o.reference_station_id,
      station_name: o.reference_station_name,
      station_type: 'reference',
      country: null,
      region: null,
      area: null,
      data_status: 'reference_without_operational_children',
      weather_fetch_status: 'skipped',
      latest_error: null,
      reference_station_id: null,
      resolved_reference_station_name: null
    });
  }

  let working = 0;
  let failed = 0;
  let missingCoordinates = 0;
  for (let r = 0; r < stationRows.length; r += 1) {
    const ds = stationRows[r].data_status;
    if (ds === 'working') working += 1;
    else if (ds === 'failed') failed += 1;
    else if (ds === 'missing_coordinates') missingCoordinates += 1;
  }

  const generatedAt = new Date().toISOString();

  return {
    generated_at: generatedAt,
    summary: {
      total_stations: stationRows.length,
      working_stations: working,
      failed_stations: failed,
      missing_coordinates_stations: missingCoordinates,
      operational_without_reference: operationalWithoutReference.length,
      reference_without_operational_children: referenceWithoutOperationalChildren.length
    },
    stations: stationRows,
    reference_groups: referenceGroups,
    operational_without_reference: operationalWithoutReference,
    reference_without_operational_children: referenceWithoutOperationalChildren,
    needs_review: needsReview
  };
}

async function buildOneStationRow(s, idToStation) {
  const checkedAt = new Date().toISOString();
  const stationId = s && s.id != null ? cleanString(String(s.id), 80) || String(s.id) : '';
  const stationName = s ? cleanString(s.name, 100) || '' : '';
  const isRef = !!(s && s.is_reference_station);
  const stationType = isRef ? 'reference' : 'operational';
  const country = s && s.country != null ? cleanString(s.country, 80) || null : null;
  const region = s && s.region != null ? cleanString(s.region, 80) || null : null;
  const area = s && s.local_area != null ? cleanString(s.local_area, 80) || null : null;
  const activeStatus = s && s.status != null ? cleanString(String(s.status), 20) || 'active' : 'active';

  const lat = toNumber(s && s.lat);
  const lon = toNumber(s && s.lon != null ? s.lon : s && s.lng);

  let referenceStationId = null;
  let resolvedReferenceName = null;
  if (!isRef) {
    const refRaw = cleanString(s.reference_station_id, 80);
    const refTrim = refRaw && String(refRaw).trim() ? String(refRaw).trim() : null;
    referenceStationId = refTrim;
    if (refTrim && idToStation[refTrim]) {
      resolvedReferenceName = cleanString(idToStation[refTrim].name, 100) || null;
    } else if (refTrim) {
      resolvedReferenceName = null;
    }
  }

  const hasValidCoords =
    lat != null &&
    lon != null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;

  if (!hasValidCoords) {
    return {
      station_id: stationId,
      station_name: stationName,
      station_type: stationType,
      country,
      region,
      area,
      lat: lat != null ? lat : null,
      lon: lon != null ? lon : null,
      active_status: activeStatus,
      reference_station_id: referenceStationId,
      resolved_reference_station_name: resolvedReferenceName,
      data_status: 'missing_coordinates',
      weather_fetch_status: 'skipped',
      latest_error: 'missing_or_invalid_lat_lon',
      last_checked_at: checkedAt
    };
  }

  const forWeather = { id: stationId, name: stationName, lat, lon };
  const pack = await getWeatherData(forWeather, '');

  const weatherFailed = !!pack.from_defaults;
  const weatherFetchStatus = weatherFailed ? 'failed' : 'ok';

  let dataStatus;
  let latestError = null;
  if (!isRef && !referenceStationId) {
    dataStatus = 'missing_reference';
    if (weatherFailed) {
      latestError = 'operational_missing_reference_link; weather_unavailable';
    } else {
      latestError = 'operational_missing_reference_link';
    }
  } else if (weatherFailed) {
    dataStatus = 'failed';
    latestError = 'weather_api_unavailable_or_empty_payload';
  } else {
    dataStatus = 'working';
    latestError = null;
  }

  return {
    station_id: stationId,
    station_name: stationName,
    station_type: stationType,
    country,
    region,
    area,
    lat,
    lon,
    active_status: activeStatus,
    reference_station_id: referenceStationId,
    resolved_reference_station_name: resolvedReferenceName,
    data_status: dataStatus,
    weather_fetch_status: weatherFetchStatus,
    latest_error: latestError,
    last_checked_at: new Date().toISOString()
  };
}

module.exports = {
  buildStationHealthReport
};
