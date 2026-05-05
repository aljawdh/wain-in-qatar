(function (root) {
  var STORAGE_KEY = 'navidur_user_location';

  function isValidLocation(value) {
    return !!value &&
      Number.isFinite(Number(value.lat)) &&
      Number.isFinite(Number(value.lon));
  }

  function readSavedLocation() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!isValidLocation(parsed)) return null;
      return {
        lat: Number(parsed.lat),
        lon: Number(parsed.lon),
        saved_at: parsed.saved_at ? String(parsed.saved_at) : null
      };
    } catch (_e) {
      return null;
    }
  }

  function saveLocation(location) {
    if (!isValidLocation(location)) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        lat: Number(location.lat),
        lon: Number(location.lon),
        saved_at: new Date().toISOString()
      }));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function findNearestStation(stations, location) {
    var list = Array.isArray(stations) ? stations : [];
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
    var nearest = null;
    var best = Number.POSITIVE_INFINITY;
    list.forEach(function (s) {
      var dLat = Number(s.lat) - location.lat;
      var dLon = Number(s.lon) - location.lon;
      var score = (dLat * dLat) + (dLon * dLon);
      if (score < best) {
        best = score;
        nearest = s;
      }
    });
    return nearest;
  }

  function requestLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ ok: false, error: 'unavailable' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var loc = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          };
          saveLocation(loc);
          resolve({
            ok: true,
            location: loc
          });
        },
        function (err) {
          resolve({ ok: false, error: String(err && err.message || 'denied') });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }
      );
    });
  }

  root.NavidurLocation = {
    findNearestStation: findNearestStation,
    requestLocation: requestLocation,
    readSavedLocation: readSavedLocation,
    saveLocation: saveLocation,
    isValidLocation: isValidLocation
  };
})(window);
