(function (global) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getStationId(station) {
    if (!station) return '';
    return station.id || station.station_id || station.code || station.name || '';
  }

  function getCoords(station) {
    return {
      lat: Number(station && (station.lat != null ? station.lat : station.latitude)),
      lon: Number(station && (station.lon != null ? station.lon : (station.lng != null ? station.lng : station.longitude)))
    };
  }

  function isReferenceStation(station) {
    return !!(station && station.is_reference_station);
  }

  function getDefaultMarkerStyle(station, options) {
    var selectedId = options && options.selectedStationId != null ? String(options.selectedStationId) : '';
    var isSelected = !!selectedId && String(getStationId(station)) === selectedId;
    var isAdminMode = !!(options && options.isAdminMode);
    var isReference = isAdminMode && isReferenceStation(station);
    return {
      radius: isSelected ? 10 : 7,
      color: isReference ? '#ffb3b3' : '#8fd8ff',
      fillColor: isReference ? '#ff5252' : '#0ea5e9',
      fillOpacity: isSelected ? 0.95 : 0.82,
      weight: isSelected ? 2 : 1.5
    };
  }

  function buildDefaultPopup(station, options) {
    var safeName = escapeHtml(station && (station.name || station.id || '--'));
    var safeStatus = escapeHtml(station && (station.status || '--'));
    if (!options || !options.isAdminMode) {
      return ''
        + '<div style="text-align:right;line-height:1.5;font-size:.9rem">'
        + '<strong>' + safeName + '</strong>'
        + '<div>الحالة: ' + safeStatus + '</div>'
        + '</div>';
    }
    var timing = options && typeof options.getTimingDetails === 'function'
      ? (options.getTimingDetails(station) || {})
      : {};
    var timingSource = escapeHtml(timing.timing_source_label_ar || timing.timing_source || '--');
    var suhailAnchorDate = escapeHtml(timing.suhail_anchor_date || '--');
    var cycleStartDate = escapeHtml(timing.cycle_start_date || '--');
    var latitudeBandKey = escapeHtml(station && station.latitude_band_key || '--');
    var isReference = station && station.is_reference_station ? 'نعم' : 'لا';
    var isVerified = station && station.is_verified ? 'نعم' : 'لا';
    var badgeHtml = station && station.is_reference_station
      ? '<div style="margin:4px 0 6px"><span style="display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;background:rgba(255,82,82,.14);border:1px solid rgba(255,82,82,.28);color:#ffd0d0;font-size:.76rem">محطة مرجعية</span></div>'
      : '';
    return ''
      + '<div style="text-align:right;line-height:1.5;font-size:.9rem">'
      + '<strong>' + safeName + '</strong>'
      + badgeHtml
      + '<div>الحالة: ' + safeStatus + '</div>'
      + '<div>مرجع معايرة: ' + isReference + '</div>'
      + '<div>موثق: ' + isVerified + '</div>'
      + '<div>حزام العرض: ' + latitudeBandKey + '</div>'
      + '<div>مصدر التوقيت: ' + timingSource + '</div>'
      + '<div>مرساة سهيل النهائية: ' + suhailAnchorDate + '</div>'
      + '<div>بداية الدورة النهائية: ' + cycleStartDate + '</div>'
      + '</div>';
  }

  function createContext(config) {
    if (typeof L === 'undefined') return null;
    var element = typeof config.elementId === 'string' ? document.getElementById(config.elementId) : config.elementId;
    if (!element) return null;
    var center = Array.isArray(config.center) ? config.center : [24.0, 53.0];
    var zoom = Number(config.zoom || 5);
    var map = L.map(element, {
      zoomControl: config.zoomControl !== false,
      attributionControl: config.attributionControl !== false
    }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: config.attribution || '&copy; OpenStreetMap contributors'
    }).addTo(map);
    return {
      map: map,
      markerLayer: L.layerGroup().addTo(map),
      markerMap: new Map()
    };
  }

  function renderStations(context, options) {
    if (!context || !context.map || !context.markerLayer) return context;
    var stations = Array.isArray(options && options.stations) ? options.stations : [];
    context.markerLayer.clearLayers();
    context.markerMap = new Map();
    stations.forEach(function (station) {
      var coords = getCoords(station);
      if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return;
      if (options && typeof options.filterStation === 'function' && !options.filterStation(station)) return;
      var style = options && typeof options.markerStyleBuilder === 'function'
        ? options.markerStyleBuilder(station, getDefaultMarkerStyle(station, options))
        : getDefaultMarkerStyle(station, options || {});
      var marker = L.circleMarker([coords.lat, coords.lon], style);
      var popupHtml = options && typeof options.popupBuilder === 'function'
        ? options.popupBuilder(station)
        : buildDefaultPopup(station, options || {});
      if (popupHtml) marker.bindPopup(popupHtml);
      var tooltipHtml = options && typeof options.tooltipBuilder === 'function'
        ? options.tooltipBuilder(station)
        : '';
      if (tooltipHtml) marker.bindTooltip(tooltipHtml, { permanent: false, direction: 'top' });
      if (options && typeof options.onMarkerClick === 'function') {
        marker.on('click', function (event) {
          options.onMarkerClick(station, marker, event);
        });
      }
      marker.addTo(context.markerLayer);
      context.markerMap.set(String(getStationId(station)), marker);
    });
    return context;
  }

  function fitBoundsToStations(context, stations, options) {
    if (!context || !context.map) return;
    var rows = Array.isArray(stations) ? stations : [];
    var validCoords = rows.map(getCoords).filter(function (coords) {
      return Number.isFinite(coords.lat) && Number.isFinite(coords.lon);
    });
    if (!validCoords.length || typeof L === 'undefined') return;
    if (validCoords.length === 1) {
      context.map.setView([validCoords[0].lat, validCoords[0].lon], Math.max(context.map.getZoom(), Number(options && options.singleZoom || 6)));
      return;
    }
    var bounds = L.latLngBounds(validCoords.map(function (coords) {
      return [coords.lat, coords.lon];
    }));
    context.map.fitBounds(bounds, {
      padding: Array.isArray(options && options.padding) ? options.padding : [24, 24],
      maxZoom: Number(options && options.maxZoom || 7)
    });
  }

  function focusStation(context, station, zoom, useFlyTo) {
    if (!context || !context.map || !station) return;
    var coords = getCoords(station);
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return;
    var nextZoom = Math.max(context.map.getZoom(), Number(zoom || context.map.getZoom() || 8));
    if (useFlyTo === false) {
      context.map.setView([coords.lat, coords.lon], nextZoom);
      return;
    }
    context.map.flyTo([coords.lat, coords.lon], nextZoom, { duration: 0.6 });
  }

  function openPopupForStation(context, stationId) {
    if (!context || !context.markerMap) return;
    var marker = context.markerMap.get(String(stationId));
    if (marker && typeof marker.openPopup === 'function') marker.openPopup();
  }

  global.NavidurStationMap = {
    createContext: createContext,
    renderStations: renderStations,
    fitBoundsToStations: fitBoundsToStations,
    focusStation: focusStation,
    openPopupForStation: openPopupForStation,
    escapeHtml: escapeHtml
  };
})(window);
