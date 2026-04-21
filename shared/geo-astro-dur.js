/** Phase 1 — mirrors serverless_api/_lib/geo-astro-dur getStationBandKey for browser bundles. */
(function (global) {
  function getStationBandKey(station) {
    if (!station || typeof station !== 'object') return null;
    var k = station.latitude_band_key;
    if (k == null || k === '') return null;
    var s = String(k).trim();
    return s || null;
  }

  global.NavidurGeoAstroDur = Object.assign(global.NavidurGeoAstroDur || {}, {
    getStationBandKey: getStationBandKey
  });
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
