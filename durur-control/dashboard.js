document.addEventListener('DOMContentLoaded', function () {
  window.location.href = '/naviduror/dashboard';
  return;

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

  var map = null;
  var stations = [];
  var dururCache = [];
  var seasonEventsCache = [];
  var stationProfilesCache = [];
  var stationOverridesCache = [];
  var selectedStation = null;
  var stationMarkerLayer = null;
  var stationMarkerMap = null;

  var summaryStations = document.getElementById('summaryStations');
  var summaryDurCount = document.getElementById('summaryDurCount');
  var summaryEvents = document.getElementById('summaryEvents');
  var visibleStations = document.getElementById('visibleStations');
  var summarySelectedStation = document.getElementById('summarySelectedStation');
  var summaryTodayDur = document.getElementById('summaryTodayDur');
  var stationInfoTitle = document.getElementById('stationInfoTitle');
  var stationInfoSubtitle = document.getElementById('stationInfoSubtitle');
  var stationRoleBadge = document.getElementById('stationRoleBadge');
  var stationOverview = document.getElementById('stationOverview');
  var stationDurOverview = document.getElementById('stationDurOverview');
  var stationEventOverview = document.getElementById('stationEventOverview');
  var stationKnowledgeOverview = document.getElementById('stationKnowledgeOverview');
  var mapElement = document.getElementById('stationMap');
  var logoutBtn = document.getElementById('logoutBtn');
  var stationSearch = document.getElementById('stationSearch');
  var stationTypeFilter = document.getElementById('stationTypeFilter');
  var durFilter = document.getElementById('durFilter');
  var seasonEventFilter = document.getElementById('seasonEventFilter');
  var stationStatusFilter = document.getElementById('stationStatusFilter');

  function safeText(value) {
    return value != null && value !== '' ? value : 'غير معروف';
  }

  function getStationId(station) {
    if (!station) return '';
    return station.id || station.station_id || station.code || station.name || '';
  }

  function getStationTypeLabel(station) {
    var type = station.station_role_type || station.type || station.stationType || station.category || station.status || '';
    if (!type) return 'غير محدد';
    if (type === 'primary_reference') return 'رئيسية مرجعية';
    if (type === 'secondary_linked') return 'تابعة';
    if (type === 'latlon_band_station') return 'مرتبطة بخطوط';
    if (type === 'active') return 'نشطة';
    if (type === 'inactive') return 'غير نشطة';
    return type;
  }

  function getStationCoords(station) {
    return {
      lat: Number(station.lat || station.latitude || (station.location && station.location.lat) || station.latlng),
      lon: Number(station.lon || station.longitude || (station.location && station.location.lng) || station.lng)
    };
  }

  function getDurLabel(dur) {
    if (!dur) return 'غير معروف';
    return dur.name || ('در ' + dur.dur_number);
  }

  function getDurDateLabel(dur) {
    if (!dur) return '--';
    return (dur.gregorian_start_day || '?') + '/' + (dur.gregorian_start_month || '?') + ' ⇢ ' + (dur.gregorian_end_day || '?') + '/' + (dur.gregorian_end_month || '?');
  }

  function isDateWithinRange(month, day, dur) {
    if (!dur) return false;
    var start = Number(dur.gregorian_start_month) * 100 + Number(dur.gregorian_start_day);
    var end = Number(dur.gregorian_end_month) * 100 + Number(dur.gregorian_end_day);
    var target = Number(month) * 100 + Number(day);
    if (start <= end) {
      return target >= start && target <= end;
    }
    return target >= start || target <= end;
  }

  function getCurrentDurForDate(date) {
    if (!Array.isArray(dururCache)) return null;
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return dururCache.find(function (d) {
      return d.is_active !== false && isDateWithinRange(month, day, d);
    }) || null;
  }

  function getStationDurOverride(station, dur) {
    if (!station || !dur) return null;
    return stationOverridesCache.find(function (row) {
      return row.station_id === station.id && row.is_active && Number(row.dur_number) === Number(dur.dur_number);
    }) || null;
  }

  function getDurProfileForStation(station) {
    if (!station) return null;
    return stationProfilesCache.find(function (row) {
      return row.station_id === station.id && row.is_active;
    }) || null;
  }

  function getSeasonEventsForDur(dur) {
    if (!dur) return [];
    return seasonEventsCache.filter(function (e) {
      return Array.isArray(e.related_dur_ids) && e.related_dur_ids.includes(dur.id);
    });
  }

  function getMarkerColor(station) {
    if (!station) return '#9ad9ff';
    var type = station.station_role_type || station.type || station.stationType || station.category || '';
    if (type === 'primary_reference') return '#ff5252';
    if (type === 'secondary_linked') return '#f8c146';
    if (type === 'latlon_band_station') return '#ff8c00';
    if (type === 'popular') return '#5bc6ff';
    if (type === 'nearby') return '#63d8ff';
    return '#9ad9ff';
  }

  function getMarkerStyle(station) {
    var isSelected = selectedStation && String(getStationId(selectedStation)) === String(getStationId(station));
    return {
      radius: isSelected ? 10 : 6,
      color: isSelected ? '#7ae2ff' : '#9ad9ff',
      fillColor: isSelected ? '#27beff' : getMarkerColor(station),
      fillOpacity: isSelected ? 0.95 : 0.8,
      weight: isSelected ? 2 : 1
    };
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

  function safeFetchJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('fetch_failed');
      return res.json();
    });
  }

  function tryFetch(primary, fallback) {
    return safeFetchJson(primary).catch(function () {
      return safeFetchJson(fallback);
    });
  }

  function updateSummary() {
    if (summaryStations) summaryStations.textContent = stations.length;
    if (summaryDurCount) summaryDurCount.textContent = dururCache.length;
    if (summaryEvents) summaryEvents.textContent = seasonEventsCache.length;
    if (summaryTodayDur) {
      var todayDur = getCurrentDurForDate(new Date());
      summaryTodayDur.textContent = todayDur ? getDurLabel(todayDur) : 'لا يوجد';
    }
    if (visibleStations) {
      visibleStations.textContent = stations.filter(filterStation).length;
    }
    if (summarySelectedStation) {
      summarySelectedStation.textContent = selectedStation ? safeText(selectedStation.name || selectedStation.stationName) : 'لا توجد';
    }
  }

  function updateStationPanels() {
    if (!selectedStation) {
      stationInfoTitle.textContent = 'معلومات المحطة';
      stationInfoSubtitle.textContent = 'اختر محطة من الخريطة لبدء العمل.';
      stationRoleBadge.textContent = '---';
      stationOverview.innerHTML = '<p>اختر محطة من الخريطة لعرض المعلومات الأساسية.</p>';
      stationDurOverview.innerHTML = '<p>الدر سيتم عرضه هنا بعد اختيار محطة.</p>';
      stationEventOverview.innerHTML = '<p>الأحداث المرتبطة ستظهر هنا بعد اختيار محطة.</p>';
      stationKnowledgeOverview.innerHTML = '<p>الملف المعرفي المحلي سيظهر هنا بعد اختيار محطة.</p>';
      updateSummary();
      return;
    }

    stationInfoTitle.textContent = selectedStation.name || selectedStation.stationName || 'محطة غير معروفة';
    stationInfoSubtitle.textContent = 'تفاصيل المحطة، الدور، والمعرفة المحلية.';
    stationRoleBadge.textContent = getStationTypeLabel(selectedStation);

    var coords = getStationCoords(selectedStation);

    stationOverview.innerHTML = '' +
      '<div class="info-row"><span>المعرف:</span><strong>' + safeText(getStationId(selectedStation)) + '</strong></div>' +
      '<div class="info-row"><span>الدولة:</span><strong>' + safeText(selectedStation.country) + '</strong></div>' +
      '<div class="info-row"><span>المنطقة:</span><strong>' + safeText(selectedStation.region) + '</strong></div>' +
      '<div class="info-row"><span>الإحداثيات:</span><strong>' + safeText(coords.lat) + ' , ' + safeText(coords.lon) + '</strong></div>' +
      '<div class="info-row"><span>حالة المحطة:</span><strong>' + safeText(selectedStation.status || '--') + '</strong></div>' +
      '<div class="info-row"><span>التصنيف:</span><strong>' + safeText(selectedStation.category || '--') + '</strong></div>' +
      '<div class="info-row"><span>ملاحظات:</span><strong>' + safeText(selectedStation.notes || 'لا توجد') + '</strong></div>';

    var currentDur = getCurrentDurForDate(new Date());
    var override = getStationDurOverride(selectedStation, currentDur);
    var durRows = [];
    if (currentDur) {
      durRows.push('<div class="info-row"><span>الدر اليوم:</span><strong>' + safeText(getDurLabel(currentDur)) + '</strong></div>');
      durRows.push('<div class="info-row"><span>تواريخ الدر:</span><strong>' + getDurDateLabel(currentDur) + '</strong></div>');
      durRows.push('<div class="info-row"><span>وصف الدر:</span><strong>' + safeText(currentDur.description || '--') + '</strong></div>');
      if (override) {
        durRows.push('<div class="info-row"><span>تعديل محلي:</span><strong>offset ' + (override.start_offset_days || 0) + '/' + (override.end_offset_days || 0) + '</strong></div>');
        durRows.push('<div class="info-row"><span>ملاحظات التعديل:</span><strong>' + safeText(override.local_notes || '--') + '</strong></div>');
      }
    } else {
      durRows.push('<p>لا يوجد دور نشط اليوم.</p>');
    }
    stationDurOverview.innerHTML = durRows.join('');

    var eventRows = [];
    if (currentDur) {
      var events = getSeasonEventsForDur(currentDur);
      if (events.length) {
        events.forEach(function (event) {
          eventRows.push('<div class="info-row"><span>' + safeText(event.name) + ':</span><strong>' + safeText(event.description || '--') + '</strong></div>');
        });
      } else {
        eventRows.push('<p>لا توجد أحداث موسمية مرتبطة بالدر الحالي.</p>');
      }
    } else {
      eventRows.push('<p>لا توجد معلومات أحداث لليوم.</p>');
    }
    stationEventOverview.innerHTML = eventRows.join('');

    var profile = getDurProfileForStation(selectedStation);
    var knowledgeRows = [];
    if (profile) {
      knowledgeRows.push('<div class="info-row"><span>التعريف المحلي:</span><strong>' + safeText(profile.local_definition || '--') + '</strong></div>');
      knowledgeRows.push('<div class="info-row"><span>ملخص الخبير:</span><strong>' + safeText(profile.expert_summary || '--') + '</strong></div>');
      knowledgeRows.push('<div class="info-row"><span>ملاحظات:</span><strong>' + safeText(profile.notes || '--') + '</strong></div>');
    } else {
      knowledgeRows.push('<p>لا توجد بيانات تعريف محلي مضمنة لهذه المحطة.</p>');
    }
    stationKnowledgeOverview.innerHTML = knowledgeRows.join('');

    updateSummary();
  }

  function filterStation(station) {
    if (!station) return false;
    var searchText = stationSearch ? String(stationSearch.value || '').trim().toLowerCase() : '';
    if (searchText) {
      var haystack = [station.name, station.country, station.region, station.id, station.station_id].filter(Boolean).join(' ').toLowerCase();
      if (haystack.indexOf(searchText) < 0) return false;
    }

    var typeFilter = stationTypeFilter ? stationTypeFilter.value : 'all';
    if (typeFilter !== 'all') {
      var role = station.station_role_type || station.type || station.stationType || station.category || '';
      if (role !== typeFilter) return false;
    }

    var statusFilter = stationStatusFilter ? stationStatusFilter.value : 'all';
    if (statusFilter !== 'all') {
      var status = String(station.status || '').toLowerCase();
      if (statusFilter === 'active' && status !== 'active') return false;
      if (statusFilter === 'inactive' && status === 'active') return false;
    }

    var selectedDurId = durFilter ? durFilter.value : 'all';
    if (selectedDurId !== 'all') {
      var currentDur = getCurrentDurForDate(new Date());
      if (!currentDur || currentDur.id !== selectedDurId) return false;
    }

    var selectedEventId = seasonEventFilter ? seasonEventFilter.value : 'all';
    if (selectedEventId !== 'all') {
      var currentDur = getCurrentDurForDate(new Date());
      var events = currentDur ? getSeasonEventsForDur(currentDur) : [];
      if (!events.some(function (event) { return event.id === selectedEventId; })) return false;
    }

    return true;
  }

  function renderStationsOnMap() {
    if (!map || !stationMarkerLayer || !Array.isArray(stations)) return;
    stationMarkerLayer.clearLayers();
    stationMarkerMap = new Map();

    stations.filter(filterStation).forEach(function (station) {
      var coords = getStationCoords(station);
      if (!isFinite(coords.lat) || !isFinite(coords.lon)) return;
      var marker = L.circleMarker([coords.lat, coords.lon], getMarkerStyle(station));
      marker.bindPopup('<strong>' + safeText(station.name || station.stationName || station.title) + '</strong><br>' + safeText(station.country || station.region));
      marker.on('click', function () {
        selectedStation = station;
        updateStationPanels();
        focusStationOnMap(station);
      });
      marker.addTo(stationMarkerLayer);
      stationMarkerMap.set(getStationId(station) || coords.lat + ',' + coords.lon, marker);
    });
    updateSummary();
  }

  function focusStationOnMap(station) {
    if (!map || !station) return;
    var coords = getStationCoords(station);
    if (!isFinite(coords.lat) || !isFinite(coords.lon)) return;
    map.flyTo([coords.lat, coords.lon], 8, { duration: 0.5 });
    renderStationsOnMap();
  }

  function activateTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === tabId + 'Panel');
    });
  }

  function setFilterListeners() {
    [stationSearch, stationTypeFilter, durFilter, seasonEventFilter, stationStatusFilter].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', renderStationsOnMap);
      if (el.tagName === 'INPUT') {
        el.addEventListener('input', renderStationsOnMap);
      }
    });
  }

  async function loadStationData() {
    try {
      var data = await tryFetch('/api/stations', '/data/stations.json');
      stations = Array.isArray(data.stations) ? data.stations : (Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[durur-control] failed to load stations', e);
      stations = [];
    }
  }

  async function loadDururData() {
    try {
      var data = await tryFetch('/api/admin/durur', '/data/durur.json');
      dururCache = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
      if (durFilter) {
        durFilter.innerHTML = '<option value="all">الكل</option>' + dururCache.slice().sort(function (a, b) {
          return Number(a.dur_number) - Number(b.dur_number);
        }).map(function (d) {
          return '<option value="' + (d.id || '') + '">' + safeText(d.name || ('در ' + d.dur_number)) + '</option>';
        }).join('');
      }
    } catch (e) {
      console.error('[durur-control] failed to load durur data', e);
      dururCache = [];
    }
  }

  async function loadSeasonEvents() {
    try {
      var data = await tryFetch('/api/admin/season-events', '/data/season_events.json');
      seasonEventsCache = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
      if (seasonEventFilter) {
        seasonEventFilter.innerHTML = '<option value="all">الكل</option>' + seasonEventsCache.map(function (event) {
          return '<option value="' + (event.id || '') + '">' + safeText(event.name) + '</option>';
        }).join('');
      }
    } catch (e) {
      console.error('[durur-control] failed to load season events', e);
      seasonEventsCache = [];
    }
  }

  async function loadStationProfiles() {
    try {
      var data = await tryFetch('/api/admin/station-dur-profiles', '/data/station_dur_profiles.json');
      stationProfilesCache = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[durur-control] failed to load station profiles', e);
      stationProfilesCache = [];
    }
  }

  async function loadStationOverrides() {
    try {
      var data = await tryFetch('/api/admin/station-dur-overrides', '/data/station_dur_overrides.json');
      stationOverridesCache = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[durur-control] failed to load station overrides', e);
      stationOverridesCache = [];
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      try {
        sessionStorage.removeItem('durur-control-authenticated');
      } catch (e) {
        // ignore storage errors
      }
      window.location.href = '/durur-control/login';
    });
  }

  document.querySelectorAll('.tab-btn').forEach(function (button) {
    button.addEventListener('click', function () {
      activateTab(button.dataset.tab);
    });
  });

  setFilterListeners();
  initMap();
  updateStationPanels();

  Promise.all([loadStationData(), loadDururData(), loadSeasonEvents(), loadStationProfiles(), loadStationOverrides()])
    .then(function () {
      renderStationsOnMap();
      updateSummary();
    });
});
