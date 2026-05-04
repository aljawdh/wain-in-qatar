(function (root) {
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
          resolve({
            ok: true,
            location: {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude
            }
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
    requestLocation: requestLocation
  };
})(window);
