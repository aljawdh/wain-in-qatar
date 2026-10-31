'use strict';

const SNAPSHOT_INDEX_KEY = 'navidur_station_snapshot_index';
const SNAPSHOT_RECORD_PREFIX = 'navidur_station_snapshot:';
const SNAPSHOT_SCAN_PAGE_SIZE = 500;

const EVIDENCE_FIELDS = {
  temp_c: { unit: 'degC' },
  wind_speed_kmh: { unit: 'km/h' },
  wind_direction_deg: { unit: 'degree' },
  humidity_pct: { unit: '%' },
  wave_height_m: { unit: 'm' },
  wave_direction_deg: { unit: 'degree' },
  current_speed_ms: { unit: 'm/s' },
  current_direction_deg: { unit: 'degree' },
  tide_height_m: { unit: 'm' }
};

const ALLOWED_PROVIDERS = {
  'open-meteo': 'open-meteo',
  stormglass: 'stormglass',
  navidur: 'navidur',
  unknown: 'unknown'
};

const ALLOWED_DATASETS = {
  'open-meteo-weather': 'open-meteo-weather',
  'open-meteo-marine': 'open-meteo-marine',
  'stormglass-point': 'stormglass-point',
  'saved-snapshot': 'saved-snapshot',
  unknown: 'unknown'
};

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidStationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
}

function parseRecord(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    throw new Error('snapshot_record_invalid');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('snapshot_record_invalid');
    }
    return parsed;
  } catch (error) {
    if (error && error.message === 'snapshot_record_invalid') throw error;
    throw new Error('snapshot_record_invalid_json');
  }
}

function parseTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeTimestamp(value) {
  const timestamp = parseTimestamp(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function normalizeSnapshotDate(snapshot) {
  return typeof snapshot.analysis_date === 'string' ? snapshot.analysis_date : '';
}

function isValidDateInput(value) {
  return typeof value === 'string' && isValidDate(value);
}

function isValidStationIdInput(value) {
  return isValidStationId(value);
}

function stableSerialize(value) {
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableSerialize(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function snapshotEvidenceSignature(snapshot) {
  return stableSerialize({
    timestamp: snapshot.timestamp == null ? null : snapshot.timestamp,
    dur_id: snapshot.dur_id || '',
    dur_name: snapshot.dur_name || '',
    observed_weather: snapshot.observed_weather || {},
    observed_marine: snapshot.observed_marine || {},
    observed_tide: snapshot.observed_tide || {},
    live_analysis_outputs: snapshot.live_analysis_outputs || {}
  });
}

function incomplete(reason) {
  return { found: false, status: 'incomplete', reason: reason };
}

async function getSnapshotByStationDate(options) {
  const opts = options || {};
  const storage = opts.storage;
  const stationId = typeof opts.stationId === 'string' ? opts.stationId.trim() : '';
  const date = typeof opts.date === 'string' ? opts.date.trim() : '';

  if (!storage || typeof storage.lrange !== 'function' || typeof storage.mget !== 'function') {
    throw new TypeError('readonly_snapshot_storage_required');
  }
  if (!isValidStationId(stationId)) throw new TypeError('station_id_invalid');
  if (!isValidDate(date)) throw new TypeError('date_invalid');

  const configuredLimit = Number(opts.scanLimit);
  const scanLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : Number.MAX_SAFE_INTEGER;

  let firstMatch = null;
  let hasConflictingMatch = false;
  let pageRequests = 0;
  let exhausted = false;
  let firstPageIds = null;
  let startRevision;
  if (typeof storage.getIndexRevision === 'function') {
    startRevision = await storage.getIndexRevision(SNAPSHOT_INDEX_KEY);
  }

  for (let offset = 0; offset < scanLimit; offset += SNAPSHOT_SCAN_PAGE_SIZE) {
    const pageSize = Math.min(SNAPSHOT_SCAN_PAGE_SIZE, scanLimit - offset);
    pageRequests += 1;
    const ids = await storage.lrange(SNAPSHOT_INDEX_KEY, offset, offset + pageSize - 1);
    if (!Array.isArray(ids)) return incomplete('malformed_index_data');
    if (ids.some(function (id) { return typeof id !== 'string' || !id.trim(); })) {
      return incomplete('malformed_index_data');
    }
    if (offset === 0) firstPageIds = ids.slice();
    if (!ids.length) {
      exhausted = true;
      break;
    }

    const uniqueIds = ids.slice();

    if (uniqueIds.length) {
      const records = await storage.mget.apply(
        storage,
        uniqueIds.map(function (id) { return SNAPSHOT_RECORD_PREFIX + id; })
      );
      if (!Array.isArray(records) || records.length !== uniqueIds.length) return incomplete('malformed_storage_response');

      for (let i = 0; i < records.length; i += 1) {
        let snapshot;
        try {
          snapshot = parseRecord(records[i]);
        } catch (_error) {
          return incomplete('malformed_snapshot_record');
        }
        if (snapshot == null) return incomplete('dangling_index_entry');
        if (
          snapshot &&
          String(snapshot.station_id || '') === stationId &&
          normalizeSnapshotDate(snapshot) === date
        ) {
          if (!firstMatch) firstMatch = snapshot;
          else if (snapshotEvidenceSignature(snapshot) !== snapshotEvidenceSignature(firstMatch)) {
            hasConflictingMatch = true;
          }
        }
      }
    }

    if (ids.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  if (!exhausted) return incomplete('search_limit_reached');

  if (pageRequests > 1) {
    if (
      typeof storage.getIndexRevision !== 'function' ||
      startRevision == null
    ) {
      return incomplete('pagination_consistency_unverified');
    }
    const endRevision = await storage.getIndexRevision(SNAPSHOT_INDEX_KEY);
    if (endRevision == null || startRevision !== endRevision) {
      return incomplete('index_changed_during_scan');
    }
    const verifyIds = await storage.lrange(
      SNAPSHOT_INDEX_KEY,
      0,
      Math.max(0, (firstPageIds || []).length - 1)
    );
    if (!Array.isArray(verifyIds) || stableSerialize(verifyIds) !== stableSerialize(firstPageIds)) {
      return incomplete('index_changed_during_scan');
    }
  }

  if (hasConflictingMatch) return { found: false, status: 'conflict', reason: 'duplicate_records_conflict' };
  if (firstMatch) return { found: true, status: 'found', record: firstMatch };

  return { found: false, reason: 'not_found' };
}

function normalizeEvidenceValue(input, options) {
  const value = input || {};
  const opts = options || {};
  const field = String(value.field || '');
  const fieldSpec = EVIDENCE_FIELDS[field];
  if (!fieldSpec) throw new TypeError('evidence_field_not_allowed');

  const validNumericValue = typeof value.value === 'number' && Number.isFinite(value.value);
  const missing = value.missing === true || !validNumericValue;
  const defaulted = !missing && value.defaulted === true;
  const cached = !missing && !defaulted && value.cached === true;
  const measurementKind = ['observation', 'forecast', 'derived', 'reference'].indexOf(value.measurement_kind) >= 0
    ? value.measurement_kind
    : 'unknown';

  const provider = ALLOWED_PROVIDERS[String(value.provider || '').toLowerCase()] || 'unknown';
  const dataset = ALLOWED_DATASETS[String(value.dataset || '').toLowerCase()] || 'unknown';
  let availabilityStatus = 'unknown';
  if (missing) availabilityStatus = 'missing';
  else if (defaulted) availabilityStatus = 'default';
  else if (cached) availabilityStatus = 'cached';
  else if (provider !== 'unknown' && dataset !== 'unknown' && measurementKind !== 'unknown') availabilityStatus = 'live';
  else if (opts.historical === true) availabilityStatus = 'historical_record';

  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const staleAfterSeconds = Number.isFinite(opts.staleAfterSeconds) && opts.staleAfterSeconds >= 0
    ? opts.staleAfterSeconds
    : 3600;
  const observedAtMs = parseTimestamp(value.observed_at);
  const validFromMs = parseTimestamp(value.valid_from);
  const validUntilMs = parseTimestamp(value.valid_until);
  let freshnessStatus = 'unknown';
  let ageSeconds = null;
  if (missing) {
    freshnessStatus = 'unknown';
  } else if (defaulted) {
    freshnessStatus = 'not_applicable';
  } else if (measurementKind === 'forecast' && validFromMs != null && validUntilMs != null && validFromMs <= validUntilMs) {
    if (nowMs < validFromMs) {
      freshnessStatus = 'not_yet_valid';
    } else if (nowMs > validUntilMs) {
      freshnessStatus = 'stale';
      ageSeconds = Math.floor((nowMs - validUntilMs) / 1000);
    } else {
      freshnessStatus = 'fresh';
      ageSeconds = 0;
    }
  } else if (observedAtMs != null) {
    if (observedAtMs > nowMs) {
      freshnessStatus = 'unknown';
    } else {
      ageSeconds = Math.floor((nowMs - observedAtMs) / 1000);
      freshnessStatus = ageSeconds > staleAfterSeconds ? 'stale' : 'fresh';
    }
  }

  let qualityStatus = ['usable', 'degraded', 'unusable', 'unknown'].indexOf(value.quality_status) >= 0
    ? value.quality_status
    : 'unknown';
  if (missing) qualityStatus = 'unusable';
  else if (defaulted || freshnessStatus === 'stale' || (observedAtMs != null && observedAtMs > nowMs)) {
    qualityStatus = 'degraded';
  }

  const historical = opts.historical === true;
  const currentObservation =
    !historical &&
    !cached &&
    !defaulted &&
    !missing &&
    provider !== 'unknown' &&
    measurementKind === 'observation' &&
    freshnessStatus === 'fresh' &&
    qualityStatus === 'usable';

  return {
    field: field,
    value: missing || typeof value.value !== 'number' || !Number.isFinite(value.value) ? null : value.value,
    unit: fieldSpec.unit,
    source: { provider: provider, dataset: dataset },
    measurement_kind: measurementKind,
    observed_at: normalizeTimestamp(value.observed_at),
    valid_for: {
      start: normalizeTimestamp(value.valid_from),
      end: normalizeTimestamp(value.valid_until)
    },
    retrieved_at: normalizeTimestamp(opts.retrievedAt || value.retrieved_at),
    freshness: { status: freshnessStatus, age_seconds: ageSeconds },
    quality: { status: qualityStatus },
    availability_status: availabilityStatus,
    temporal_context: historical ? 'historical' : 'unspecified',
    is_current_measurement: currentObservation,
    provenance: {
      cached: cached,
      defaulted: defaulted,
      missing: missing
    }
  };
}

function pickNumericFields(source, fields) {
  const row = source && typeof source === 'object' ? source : {};
  const result = {};
  fields.forEach(function (field) {
    const value = row[field];
    result[field] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
  return result;
}

function buildHistoricalEvidenceBundle(options) {
  const opts = options || {};
  const snapshot = opts.snapshot;
  const requestedDate = typeof opts.requestedDate === 'string' ? opts.requestedDate : '';
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot_required');
  if (!isValidDate(requestedDate)) throw new TypeError('date_invalid');
  if (opts.stationId != null && (!isValidStationId(opts.stationId) || String(snapshot.station_id || '') !== opts.stationId)) {
    throw new Error('snapshot_station_mismatch');
  }
  if (!isValidStationId(String(snapshot.station_id || ''))) throw new Error('snapshot_station_invalid');
  if (String(snapshot.analysis_date || '') !== requestedDate) throw new Error('snapshot_date_mismatch');

  const timestampMs = parseTimestamp(snapshot.timestamp);
  const timestampDate = timestampMs == null ? null : new Date(timestampMs).toISOString().slice(0, 10);
  if (timestampDate && timestampDate !== requestedDate) throw new Error('snapshot_timestamp_date_conflict');
  const timestampInvalid = snapshot.timestamp != null && timestampMs == null;
  const observedWeather = snapshot.observed_weather || {};
  const observedMarine = snapshot.observed_marine || {};
  const observedTide = snapshot.observed_tide || {};
  const values = [
    { field: 'temp_c', value: observedWeather.temp_c },
    { field: 'wind_speed_kmh', value: observedWeather.wind_speed_kmh },
    { field: 'wind_direction_deg', value: observedWeather.wind_direction_deg },
    { field: 'humidity_pct', value: observedWeather.humidity_pct },
    { field: 'wave_height_m', value: observedMarine.wave_height_m },
    { field: 'wave_direction_deg', value: observedMarine.wave_direction_deg },
    { field: 'current_speed_ms', value: observedMarine.current_speed_ms },
    { field: 'current_direction_deg', value: observedMarine.current_direction_deg },
    { field: 'tide_height_m', value: observedTide.height_m }
  ];
  const retrievedAt = normalizeTimestamp(opts.retrievedAt) || new Date().toISOString();
  const requestedEngineVersion = typeof opts.engineVersion === 'string' ? opts.engineVersion.trim() : '';
  const engineVersion = /^[A-Za-z0-9._+-]{1,80}$/.test(requestedEngineVersion)
    ? requestedEngineVersion
    : 'unknown';

  return {
    schema_version: '1.0',
    requested_date: requestedDate,
    retrieved_at: retrievedAt,
    analysis_engine: {
      name: 'NAVIDUR',
      version: engineVersion
    },
    station: {
      station_id: String(snapshot.station_id || ''),
      name: String(snapshot.station_name || '')
    },
    record: {
      record_id: String(snapshot.snapshot_id || ''),
      analysis_date: requestedDate,
      timestamp: timestampMs == null ? null : new Date(timestampMs).toISOString(),
      dur_id: typeof snapshot.dur_id === 'string' ? snapshot.dur_id : '',
      dur_name: typeof snapshot.dur_name === 'string' ? snapshot.dur_name : '',
      observed_weather: pickNumericFields(observedWeather, ['temp_c', 'wind_speed_kmh', 'wind_direction_deg', 'humidity_pct']),
      observed_marine: pickNumericFields(observedMarine, ['wave_height_m', 'wave_direction_deg', 'current_speed_ms', 'current_direction_deg']),
      observed_tide: pickNumericFields(observedTide, ['height_m']),
      live_analysis_outputs: {
        tide_state: typeof (snapshot.live_analysis_outputs || {}).tide_state === 'string'
          ? snapshot.live_analysis_outputs.tide_state
          : '',
        species_activity: Array.isArray((snapshot.live_analysis_outputs || {}).species_activity)
          ? (snapshot.live_analysis_outputs || {}).species_activity.filter(function (item) {
            return typeof item === 'string';
          }).slice(0, 20)
          : [],
        is_recommended: (snapshot.live_analysis_outputs || {}).is_recommended === true,
        confidence_score: typeof (snapshot.live_analysis_outputs || {}).confidence_score === 'number' &&
          Number.isFinite((snapshot.live_analysis_outputs || {}).confidence_score)
          ? (snapshot.live_analysis_outputs || {}).confidence_score
          : null
      }
    },
    evidence: values.map(function (item) {
      return normalizeEvidenceValue({
        field: item.field,
        value: item.value,
        provider: 'unknown',
        dataset: 'saved-snapshot',
        measurement_kind: 'unknown',
        quality_status: 'unknown',
        missing: item.value == null
      }, { historical: true, retrievedAt: retrievedAt });
    }),
    limitations: [
      'saved snapshot does not include reliable provider, observation-time, or freshness metadata'
    ].concat(timestampInvalid ? ['saved snapshot timestamp is malformed or timezone-ambiguous'] : [])
  };
}

module.exports = {
  getSnapshotByStationDate: getSnapshotByStationDate,
  normalizeEvidenceValue: normalizeEvidenceValue,
  buildHistoricalEvidenceBundle: buildHistoricalEvidenceBundle,
  isValidDateInput: isValidDateInput,
  isValidStationIdInput: isValidStationIdInput
};
