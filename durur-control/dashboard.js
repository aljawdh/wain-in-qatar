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
  var stationMarkerLayer = null;
  var stationMarkerMap = null;

  var stationInfoBody = document.getElementById('stationInfoBody');
  var mapElement = document.getElementById('stationMap');

  function formatValue(value) {
    return value ? value : 'غير معروف';
  }

  function getStationId(station) {
    if (!station) return '';
    return station.id || station.station_id || station.code || station.name || '';
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
      '<div class="info-row"><span>الإحداثيات:</span><strong>' + formatValue(selectedStation.lat || selectedStation.latitude || selectedStation.location?.lat || selectedStation.latlng) + ' , ' + formatValue(selectedStation.lon || selectedStation.longitude || selectedStation.location?.lng || selectedStation.lng) + '</strong></div>' +
      '<div class="info-row"><span>نوع المحطة:</span><strong>' + typeValue + '</strong></div>';

    stationInfoBody.innerHTML = info;
  }

  function getMarkerStyle(station) {
    var selected = selectedStation && String(getStationId(selectedStation)) === String(getStationId(station));
    return {
      radius: selected ? 9 : 6,
      color: selected ? '#7ae2ff' : '#9ad9ff',
      fillColor: selected ? '#27beff' : '#0f5f8f',
      fillOpacity: selected ? 0.95 : 0.75,
      weight: selected ? 2 : 1
    };
  }

  function getStationCoords(station) {
    return {
      lat: Number(station.lat || station.latitude || (station.location && station.location.lat) || station.latlng),
      lon: Number(station.lon || station.longitude || (station.location && station.location.lng) || station.lng)
    };
  }

  function focusStationOnMap(station) {
    if (!map || !station) return;
    var coords = getStationCoords(station);
    if (!isFinite(coords.lat) || !isFinite(coords.lon)) return;
    map.flyTo([coords.lat, coords.lon], 8, { duration: 0.6 });
    renderStationsOnMap();
  }

  function handleStationClick(station) {
    selectedStation = station;
    updateStationInfo();
    focusStationOnMap(station);
  }

  function renderStationsOnMap() {
    if (!map || !stationMarkerLayer || !Array.isArray(stations)) return;
    stationMarkerLayer.clearLayers();
    stationMarkerMap = new Map();

    stations.forEach(function (station) {
      var coords = getStationCoords(station);
      if (!isFinite(coords.lat) || !isFinite(coords.lon)) return;

      var marker = L.circleMarker([coords.lat, coords.lon], getMarkerStyle(station));
      marker.bindPopup('<strong>' + formatValue(station.name || station.stationName || station.title) + '</strong><br>' + formatValue(station.country));
      marker.on('click', function () {
        handleStationClick(station);
      });
      marker.addTo(stationMarkerLayer);
      stationMarkerMap.set(getStationId(station) || coords.lat + ',' + coords.lon, marker);
    });
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
    map = L.map(mapElement, { zoomControl: true, attributionControl: false }).setView([24.7, 50.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);
    stationMarkerLayer = L.layerGroup().addTo(map);
    stationMarkerMap = new Map();
  }

  initMap();
  updateStationInfo();
  loadStations();
});
