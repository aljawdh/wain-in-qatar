document.addEventListener('DOMContentLoaded', function () {
  try {
    var isAuth = sessionStorage.getItem('durur-control-authenticated') === 'true';
    if (!isAuth) {
      window.location.href = '/durur-control/login';
      return;
    }
  } catch (e) {
    window.location.href = '/durur-control/login';
    return;
  }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      try {
        sessionStorage.removeItem('durur-control-authenticated');
      } catch (e) {
        // ignore
      }
      window.location.href = '/durur-control/login';
    });
  }

  var map = null;
  var stations = [];
  var selectedStation = null;
  var stationMarkers = [];

  var stationInfoBody = document.getElementById('stationInfoBody');
  var mapElement = document.getElementById('dururMap');

  function formatValue(value) {
    return value ? value : 'غير معروف';
  }

  function updateStationInfo() {
    if (!stationInfoBody) return;
    if (!selectedStation) {
      stationInfoBody.innerHTML = '<p>اختر محطة من الخريطة</p>';
      return;
    }

    var typeValue = formatValue(selectedStation.station_role_type || selectedStation.type || selectedStation.stationType);
    var info = '' +
      '<div class="info-row"><span>اسم المحطة:</span><strong>' + formatValue(selectedStation.name || selectedStation.stationName || selectedStation.title) + '</strong></div>' +
      '<div class="info-row"><span>station_id:</span><strong>' + formatValue(selectedStation.id || selectedStation.station_id || selectedStation.code) + '</strong></div>' +
      '<div class="info-row"><span>الدولة:</span><strong>' + formatValue(selectedStation.country) + '</strong></div>' +
      '<div class="info-row"><span>المنطقة:</span><strong>' + formatValue(selectedStation.region) + '</strong></div>' +
      '<div class="info-row"><span>الإحداثيات:</span><strong>' + formatValue(selectedStation.lat) + ' , ' + formatValue(selectedStation.lon) + '</strong></div>' +
      '<div class="info-row"><span>نوع المحطة:</span><strong>' + typeValue + '</strong></div>';

    stationInfoBody.innerHTML = info;
  }

  function getMarkerColor(station) {
    var typeValue = (station.station_role_type || station.type || station.stationType || '').toString();
    if (typeValue === 'primary_reference') return '#ff5252';
    if (typeValue === 'secondary_linked') return '#f8c146';
    if (typeValue === 'latlon_band_station') return '#ff8c00';
    return '#63d8ff';
  }

  function clearMarkers() {
    stationMarkers.forEach(function (entry) {
      if (entry.marker && map) {
        map.removeLayer(entry.marker);
      }
    });
    stationMarkers = [];
  }

  function handleStationClick(station, marker) {
    selectedStation = station;
    stationMarkers.forEach(function (entry) {
      entry.marker.setStyle({ weight: 1, radius: 8 });
    });
    marker.setStyle({ weight: 2, radius: 10 });
    updateStationInfo();
    if (map && station.lat && station.lon) {
      map.setView([station.lat, station.lon], Math.max(map.getZoom(), 8));
    }
  }

  function renderStationsOnMap() {
    if (!map || !Array.isArray(stations)) return;
    clearMarkers();

    stations.forEach(function (station) {
      var lat = Number(station.lat || station.latitude || (station.location && station.location.lat));
      var lon = Number(station.lon || station.longitude || (station.location && station.location.lng));
      if (!isFinite(lat) || !isFinite(lon)) return;

      var marker = L.circleMarker([lat, lon], {
        radius: 8,
        color: '#ffffff',
        weight: 1,
        fillColor: getMarkerColor(station),
        fillOpacity: 0.95
      }).addTo(map);

      marker.on('click', function () {
        handleStationClick(station, marker);
      });
      marker.bindTooltip(formatValue(station.name || station.stationName || station.title), {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.9
      });

      stationMarkers.push({ station: station, marker: marker });
    });

    if (stationMarkers.length) {
      var group = L.featureGroup(stationMarkers.map(function (item) { return item.marker; }));
      map.fitBounds(group.getBounds().pad(0.15));
    }
  }

  function loadStations() {
    fetch('/api/stations', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then(function (data) {
        stations = Array.isArray(data.stations) ? data.stations : (Array.isArray(data) ? data : []);
        renderStationsOnMap();
      })
      .catch(function () {
        stationInfoBody.innerHTML = '<p style="color: var(--muted);">تعذّر تحميل المحطات من النظام الحالي.</p>';
      });
  }

  function initMap() {
    if (map || !mapElement) return;
    map = L.map(mapElement, { zoomControl: true }).setView([24.7, 50.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }

  initMap();
  updateStationInfo();
  loadStations();
});
