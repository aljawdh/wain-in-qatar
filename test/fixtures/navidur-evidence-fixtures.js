'use strict';

const SAVED_SNAPSHOTS = [
  {
    snapshot_id: 'snapshot-north-2026-10-20',
    station_id: 'station-north',
    station_name: 'North Station',
    analysis_date: '2026-10-20',
    timestamp: '2026-10-20T11:55:00.000Z',
    dur_id: 'dur-17',
    dur_name: 'Synthetic Dur',
    observed_weather: { temp_c: 29, wind_speed_kmh: 13, wind_direction_deg: 215 },
    observed_marine: { wave_height_m: 0.7, current_speed_ms: 0.6 },
    observed_tide: { height_m: 1.1 },
    live_analysis_outputs: {
      tide_state: 'LOAD',
      species_activity: ['synthetic fish'],
      is_recommended: true,
      confidence_score: 72
    },
    operator_username: 'must-not-leak',
    user_note: 'must not appear in response',
    api_token: 'synthetic-decoy-never-return'
  },
  {
    snapshot_id: 'snapshot-north-2026-10-19',
    station_id: 'station-north',
    station_name: 'North Station',
    analysis_date: '2026-10-19',
    timestamp: '2026-10-19T11:55:00.000Z',
    observed_weather: { temp_c: 28 },
    observed_marine: {},
    observed_tide: {},
    live_analysis_outputs: {}
  },
  {
    snapshot_id: 'snapshot-south-2026-10-20',
    station_id: 'station-south',
    station_name: 'South Station',
    analysis_date: '2026-10-20',
    timestamp: '2026-10-20T11:55:00.000Z',
    observed_weather: { temp_c: 31 },
    observed_marine: {},
    observed_tide: {},
    live_analysis_outputs: {}
  }
];

const PROVENANCE_CASES = {
  forecast: {
    field: 'wave_height_m',
    value: 0.8,
    provider: 'open-meteo',
    dataset: 'open-meteo-marine',
    measurement_kind: 'forecast',
    valid_from: '2026-10-26T00:00:00.000Z',
    valid_until: '2026-10-26T03:00:00.000Z'
  },
  observation: {
    field: 'wind_speed_kmh',
    value: 14,
    provider: 'stormglass',
    dataset: 'stormglass-point',
    measurement_kind: 'observation',
    observed_at: '2026-10-26T00:30:00.000Z',
    quality_status: 'usable'
  },
  cached: {
    field: 'temp_c',
    value: 27,
    provider: 'open-meteo',
    dataset: 'open-meteo-weather',
    measurement_kind: 'observation',
    observed_at: '2026-10-25T23:30:00.000Z',
    retrieved_at: '2026-10-26T00:00:00.000Z',
    cached: true
  },
  defaulted: {
    field: 'current_speed_ms',
    value: 0.5,
    defaulted: true
  },
  stale: {
    field: 'wave_height_m',
    value: 1.2,
    provider: 'stormglass',
    measurement_kind: 'observation',
    observed_at: '2026-10-25T00:00:00.000Z'
  },
  missing: {
    field: 'temp_c',
    value: null,
    missing: true
  },
  missingProvenance: {
    field: 'wind_speed_kmh',
    value: 10,
    retrieved_at: '2026-10-26T00:00:00.000Z'
  }
};

module.exports = {
  SAVED_SNAPSHOTS: SAVED_SNAPSHOTS,
  PROVENANCE_CASES: PROVENANCE_CASES
};
