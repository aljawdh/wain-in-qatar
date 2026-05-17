'use strict';

var store = require('./store');

function normRole(station) {
  return String(station && station.station_role_type || '').trim().toLowerCase();
}

function isReferenceStation(station) {
  if (!station || !station.id) return false;
  if (station.is_reference_station === true) return true;
  if (station.primary_reference === true) return true;
  var role = normRole(station);
  if (role === 'primary_reference') return true;
  return false;
}

function isOperationalStation(station) {
  if (!station) return false;
  if (isReferenceStation(station)) return false;
  if (station.is_operational_station === true) return true;
  if (station.is_operational_station === false) return false;
  var role = normRole(station);
  if (role === 'secondary_linked' || role === 'latlon_band_station') return true;
  return !isReferenceStation(station);
}

function sortStations(stations) {
  return stations.slice().sort(function (a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });
}

function listEligibleReferenceStations(referenceData, isEligibleFn) {
  var list = (referenceData.stations || []).filter(function (station) {
    return isEligibleFn(station) && isReferenceStation(station);
  });
  return sortStations(list);
}

function hourBucketIndex(dateCtx) {
  var hour = parseInt(String(dateCtx && dateCtx.hour || ''), 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    hour = new Date().getUTCHours();
  }
  var day = String(dateCtx && dateCtx.analysis_date || '');
  var dayNum = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    var parts = day.split('-');
    var d = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    dayNum = Math.floor(d / 86400000);
  }
  return dayNum * 24 + hour;
}

function poolKeyFromIds(ids) {
  return (ids || []).map(function (id) {
    return String(id);
  }).join('|');
}

async function resolveRotationIndex(referenceTotal, dateCtx, advance, stateKey, poolKey) {
  var n = referenceTotal;
  if (n < 1) return { index: 0, strategy: 'reference_rotation' };

  var key = stateKey || store.keys().refRotation();
  var state = await store.intelGet(key);
  var index;
  if (
    state
    && Number.isFinite(Number(state.last_index))
    && (!poolKey || String(state.pool_key || '') === String(poolKey))
  ) {
    index = advance
      ? (Math.floor(Number(state.last_index)) + 1) % n
      : Math.floor(Number(state.last_index)) % n;
  } else {
    index = hourBucketIndex(dateCtx) % n;
  }
  return { index: index, strategy: 'reference_rotation', previous: state || null, state_key: key };
}

async function persistRotationState(station, index, referenceTotal, stateKey, poolKey) {
  var key = stateKey || store.keys().refRotation();
  await store.intelSet(key, {
    last_station_id: String(station.id),
    last_index: index,
    reference_total: referenceTotal,
    pool_key: poolKey || '',
    updated_at: new Date().toISOString()
  });
}

async function selectReferenceRotationBatch(referenceList, dateCtx, limit, advance, rotationOpts) {
  var opts = rotationOpts || {};
  var refs = referenceList || [];
  var n = refs.length;
  var stateKey = opts.state_key || store.keys().refRotation();
  var poolKey = opts.pool_key || poolKeyFromIds(refs.map(function (s) {
    return s.id;
  }));
  var strategy = opts.strategy || 'reference_rotation';

  if (!n) {
    return {
      stations: [],
      reference_total: 0,
      selected_station_index: null,
      selected_station_strategy: strategy,
      rotation_state_key: stateKey
    };
  }

  if (opts.rotation_enabled === false) {
    var staticPick = refs.slice(0, Math.min(Math.max(limit, 1), n));
    return {
      stations: staticPick,
      reference_total: n,
      selected_station_index: 0,
      selected_station_strategy: 'static_first_n',
      rotation_state_key: stateKey
    };
  }

  var resolved = await resolveRotationIndex(n, dateCtx, advance, stateKey, poolKey);
  var picked = [];
  var idx = resolved.index;
  var max = Math.min(Math.max(limit, 1), n);
  for (var i = 0; i < max; i += 1) {
    picked.push(refs[(idx + i) % n]);
  }

  if (advance && picked.length && !dateCtx.dry_run) {
    var lastIdx = (idx + picked.length - 1) % n;
    await persistRotationState(picked[picked.length - 1], lastIdx, n, stateKey, poolKey);
  }

  return {
    stations: picked,
    reference_total: n,
    selected_station_index: idx,
    selected_station_strategy: strategy,
    rotation_state_key: stateKey
  };
}

module.exports = {
  isReferenceStation: isReferenceStation,
  isOperationalStation: isOperationalStation,
  listEligibleReferenceStations: listEligibleReferenceStations,
  selectReferenceRotationBatch: selectReferenceRotationBatch,
  hourBucketIndex: hourBucketIndex,
  poolKeyFromIds: poolKeyFromIds
};
