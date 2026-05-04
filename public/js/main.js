(function () {
  var State = window.NavidurState;
  var UI = window.NavidurUI;
  var Loc = window.NavidurLocation;
  var H = window.NavidurHelpers;
  var DAY_OFFSETS = [0, 1, 2, 3, 4];
  var AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function deviceType() {
    var w = window.innerWidth || 0;
    if (w >= 1280) return 'desktop';
    if (w >= 768) return 'tablet';
    return 'mobile';
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function dateToKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(dateKey, offset) {
    var base = new Date(dateKey + 'T00:00:00');
    base.setDate(base.getDate() + offset);
    return dateToKey(base);
  }

  function getDisplayLabel(dateKey, offset) {
    if (offset === 0) return 'اليوم';
    if (offset === 1) return 'غداً';
    var d = new Date(dateKey + 'T00:00:00');
    return AR_DAYS[d.getDay()] + ' +' + offset;
  }

  async function loadStations() {
    var res = await fetch('/api?route=stations', { cache: 'no-store' });
    var json = await res.json();
    var list = Array.isArray(json.stations) ? json.stations : [];
    return list.map(function (s) {
      return {
        id: s.id,
        name: s.name_ar || s.name || s.id,
        lat: Number(s.lat),
        lon: Number(s.lon != null ? s.lon : s.lng)
      };
    }).filter(function (s) {
      return s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon);
    });
  }

  function setDayStatus(text) {
    var el = H.byId('dayDataStatus');
    if (!el) return;
    el.textContent = text || '';
  }

  async function fetchAnalysisForDay(selectedDate, selectedStation) {
    if (!selectedStation || !selectedStation.id || !selectedDate) return null;
    var date = String(selectedDate);
    var station = selectedStation;
    var cached = State.getCached(station.id, date);
    if (cached) {
      var s0 = State.getState();
      s0.analysisDtoByDay[date] = cached;
      State.update({ analysisDtoByDay: s0.analysisDtoByDay });
      return cached;
    }
    var url = '/api?route=analysis&station_id=' + encodeURIComponent(station.id) + '&analysis_date=' + encodeURIComponent(date);
    var dto = null;
    try {
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('analysis_http_' + res.status);
      dto = await res.json();
      if (!dto || dto.ok === false || dto.error || !dto.environment) {
        dto = null;
      }
    } catch (_e) {
      dto = null;
    }
    State.setCached(station.id, date, dto);
    var s = State.getState();
    s.analysisDtoByDay[date] = dto;
    State.update({ analysisDtoByDay: s.analysisDtoByDay });
    return dto;
  }

  function renderDaySelector() {
    var wrap = H.byId('daySelector');
    var s = State.getState();
    if (!wrap) return;
    var today = new Date().toISOString().slice(0, 10);
    wrap.innerHTML = DAY_OFFSETS.map(function (offset) {
      var dk = addDays(today, offset);
      var active = s.selectedDate === dk ? ' active' : '';
      return '<button class="day-pill' + active + '" data-day-key="' + dk + '">' + getDisplayLabel(dk, offset) + '</button>';
    }).join('');
    wrap.querySelectorAll('.day-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dateKey = btn.getAttribute('data-day-key');
        if (!dateKey) return;
        onDayChange(dateKey);
      });
    });
  }

  function renderForDto(dto) {
    var s = State.getState();
    State.update({ currentSharedAnalysisDto: dto });
    try {
      console.debug('NAVIDUR_DATA_SOURCE', {
        source: dto && dto.environment ? dto.environment.forecast_source : null,
        is_mock: dto && dto.environment ? dto.environment.is_mock : null,
        has_real_api: !!(dto && dto.environment && String(dto.environment.forecast_source || '').toLowerCase().indexOf('open_meteo') >= 0 && dto.environment.is_mock !== true)
      });
    } catch (_srcErr) { /* ignore */ }
    try {
      console.debug('NAVIDUR_DECISION_SOURCE', {
        source: 'backend',
        score: dto && dto.decision ? dto.decision.score : null,
        decision: dto && dto.decision ? dto.decision.label : null
      });
    } catch (_srcDecisionErr) { /* ignore */ }
    UI.renderDashboard(dto, s);
    UI.renderMarineAnalysis(dto);
    UI.renderFishingRecommendation(dto);
    UI.renderMap(dto);
    UI.renderLocationModal(s);
  }

  async function renderAll() {
    var s = State.getState();
    if (!s.selectedStation) return;
    var dto = await fetchAnalysisForDay(s.selectedDate, s.selectedStation);
    if (!dto) {
      setDayStatus('لا تتوفر بيانات لهذا اليوم');
      renderForDto(null);
    } else {
      setDayStatus('');
      renderForDto(dto);
    }
    console.debug('NAVIDUR_UI_RENDER', {
      page: s.page,
      station: s.selectedStation.id,
      selectedDate: s.selectedDate,
      deviceType: deviceType(),
      hasLocation: !!s.userLocation
    });
  }

  async function onDayChange(dateKey) {
    var s = State.getState();
    if (!s.selectedStation) return;
    State.update({ selectedDate: dateKey });
    renderDaySelector();
    var dto = await fetchAnalysisForDay(dateKey, s.selectedStation);
    var dataLoaded = !!dto;
    if (!dto) {
      setDayStatus('لا تتوفر بيانات لهذا اليوم');
      renderForDto(null);
    } else {
      setDayStatus('');
      renderForDto(dto);
    }
    try {
      console.debug('NAVIDUR_DAY_DATA_CHECK', {
        date: dateKey,
        station_id: s.selectedStation.id,
        wind: dto && dto.environment ? dto.environment.wind_speed_kmh : null,
        wave: dto && dto.environment ? dto.environment.wave_height_m : null,
        current: dto && dto.environment && dto.environment.current_speed != null
          ? dto.environment.current_speed
          : dto && dto.tide ? dto.tide.current_speed_ms : null,
        temp: dto && dto.environment ? dto.environment.water_temp_c : null,
        tide: dto && dto.tide ? dto.tide.state : null,
        decision: dto && dto.decision ? dto.decision.label : dto && dto.fishing
          ? (dto.fishing.is_recommended ? 'مناسب' : 'حذر')
          : null
      });
    } catch (_dbgErr) { /* ignore */ }
    console.debug('NAVIDUR_DAY_CHANGE', {
      selectedDate: dateKey,
      station: s.selectedStation.id,
      dataLoaded: dataLoaded
    });
  }

  function applyPageVisibility(page) {
    document.querySelectorAll('[data-page-panel]').forEach(function (panel) {
      panel.classList.toggle('hidden', panel.getAttribute('data-page-panel') !== page);
    });
  }

  function bindNavigation() {
    document.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = btn.getAttribute('data-page');
        State.update({ page: page });
        applyPageVisibility(page);
        document.querySelectorAll('.nav-btn').forEach(function (x) {
          x.classList.toggle('active', x === btn);
        });
      });
    });
  }

  function bindStationSelector() {
    var select = H.byId('stationSelector');
    select.addEventListener('change', function () {
      var s = State.getState();
      var station = (s.stations || []).find(function (x) { return x.id === select.value; }) || null;
      State.update({ selectedStation: station, analysisDtoByDay: {} });
      renderAll();
    });
  }

  function fillStations(stations) {
    var select = H.byId('stationSelector');
    select.innerHTML = stations.map(function (s) {
      return '<option value="' + s.id + '">' + s.name + '</option>';
    }).join('');
  }

  function bindLocationModal() {
    H.byId('locationEnableBtn').addEventListener('click', async function () {
      var result = await Loc.requestLocation();
      var s = State.getState();
      if (result.ok) {
        var nearest = Loc.findNearestStation(s.stations, result.location);
        State.update({ userLocation: result.location, locationPromptDismissed: true, selectedStation: nearest || s.selectedStation });
        if (nearest) H.byId('stationSelector').value = nearest.id;
      } else {
        H.byId('locationHint').textContent = 'يمكنك اختيار المحطة يدويًا من القائمة.';
        State.update({ locationPromptDismissed: true });
      }
      console.debug('NAVIDUR_LOCATION_FLOW', {
        permissionStatus: result.ok ? 'granted' : 'denied',
        userLocation: result.ok ? result.location : null,
        selectedStation: (State.getState().selectedStation || {}).id || null
      });
      UI.renderLocationModal(State.getState());
      renderAll();
    });

    H.byId('locationSkipBtn').addEventListener('click', function () {
      State.update({ locationPromptDismissed: true });
      UI.renderLocationModal(State.getState());
    });
  }

  async function init() {
    var stations = await loadStations();
    State.update({ stations: stations, selectedStation: stations[0] || null });
    fillStations(stations);
    renderDaySelector();
    bindNavigation();
    bindStationSelector();
    bindLocationModal();
    UI.renderLocationModal(State.getState());
    applyPageVisibility('dashboard');
    renderAll();
  }

  init().catch(function (err) {
    H.byId('appContent').innerHTML = '<section class="card"><h3>تعذر التحميل</h3><p class="muted">' + String(err && err.message || err) + '</p></section>';
  });
})();
