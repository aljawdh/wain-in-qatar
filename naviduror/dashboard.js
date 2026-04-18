(function () {
  var AUTH_TOKEN_KEY = 'naviduror_token';
  var AUTH_USER_KEY = 'naviduror_user';

  var map = null;
  var tileLayer = null;
  var stationLayer = null;

  var DEFAULT_GULF_CENTER = [25.3, 51.3];
  var DEFAULT_GULF_ZOOM = 5;
  var stations = [];
  var dururCache = [];
  var seasonEventsCache = [];
  var stationProfilesCache = [];
  var stationOverridesCache = [];
  var comparisonsCache = [];
  var selectedStation = null;
  var tempStationMarker = null;
  var tempStationLayer = null;
  var editingStation = null;
  var stationFormState = {
    isNew: true,
    originalId: '',
    card: null,
    id: null,
    name: null,
    lat: null,
    lon: null,
    country: null,
    region: null,
    roleType: null,
    referenceId: null,
    status: null,
    notes: null,
    saveBtn: null,
    cancelBtn: null,
    statusArea: null
  };
  var availableTraits = {
    general: [],
    weather: [],
    marine: [],
    fish: [],
    heritage: [],
    seasonal_transition_traits: [],
    advice: []
  };
  var traitDictionaries = [];
  var fishSeasonTags = [];
  var adviceBasisTags = [];
  var calibrationStore = {};
  var currentYear = new Date().getFullYear();

  var controls = {
    currentUserName: getEl('currentUserName'),
    logoutBtn: getEl('logoutBtn'),
    stationTypeFilter: getEl('stationTypeFilter'),
    durFilter: getEl('durFilter'),
    yearFilter: getEl('yearFilter'),
    seasonEventFilter: getEl('seasonEventFilter'),
    stationSearch: getEl('stationSearch'),
    recalculateBtn: getEl('recalculateBtn'),
    summaryStations: getEl('summaryStations'),
    summaryDurCount: getEl('summaryDurCount'),
    summaryEvents: getEl('summaryEvents'),
    summaryTodayDur: getEl('summaryTodayDur'),
    summarySelectedStation: getEl('summarySelectedStation'),
    identityBody: getEl('identityBody'),
    calibDurSelect: getEl('calibDurSelect'),
    calibStartMonth: getEl('calibStartMonth'),
    calibStartDay: getEl('calibStartDay'),
    calibDaysCount: getEl('calibDaysCount'),
    calibSummaryArea: getEl('calibSummaryArea'),
    calibSaveBtn: getEl('calibSaveBtn'),
    calibResetBtn: getEl('calibResetBtn'),
    calibStatus: getEl('calibStatus'),
    distributionPreview: getEl('distributionPreview'),
    validationYearLabel: getEl('validationYearLabel'),
    validationStatusLabel: getEl('validationStatusLabel'),
    validationScoreLabel: getEl('validationScoreLabel'),
    validationTraitsExpected: getEl('validationTraitsExpected'),
    validationTraitsObserved: getEl('validationTraitsObserved'),
    validationSummaryText: getEl('validationSummaryText'),
    validationTrend: getEl('validationTrend'),
    stationFormCard: getEl('stationFormCard'),
    stationFormId: getEl('stationFormId'),
    stationFormName: getEl('stationFormName'),
    stationFormLat: getEl('stationFormLat'),
    stationFormLon: getEl('stationFormLon'),
    stationFormCountry: getEl('stationFormCountry'),
    stationFormRegion: getEl('stationFormRegion'),
    stationFormRoleType: getEl('stationFormRoleType'),
    stationFormReferenceId: getEl('stationFormReferenceId'),
    stationFormStatus: getEl('stationFormStatus'),
    stationFormNotes: getEl('stationFormNotes'),
    stationFormSaveBtn: getEl('stationFormSaveBtn'),
    stationFormCancelBtn: getEl('stationFormCancelBtn'),
    stationFormFeedback: getEl('stationFormFeedback'),
    traitInputs: {
      general: getEl('traitInput-general'),
      weather: getEl('traitInput-weather'),
      marine: getEl('traitInput-marine'),
      fish: getEl('traitInput-fish'),
      heritage: getEl('traitInput-heritage')
    }
  };

  function getEl(id) {
    return document.getElementById(id);
  }


  function isAuthenticated() {
    return !!localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function getAuthUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null') || {};
    } catch (e) {
      return {};
    }
  }

  function redirectToLogin() {
    window.location.href = '/naviduror/login';
  }

  function setText(id, text) {
    var el = getEl(id);
    if (!el) return;
    el.textContent = text != null ? text : '';
  }

  function parseNumber(value, fallback) {
    var num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeString(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeTagObject(input) {
    if (typeof input === 'string') {
      return { id: String(input).trim(), label: String(input).trim() };
    }
    return {
      id: String(input.id || input.label || input.name_ar || input.name_en || '').trim(),
      label: String(input.label || input.name_ar || input.name_en || input.id || '').trim(),
      name_ar: input.name_ar || '',
      name_en: input.name_en || ''
    };
  }

  function tagMatchesValue(tag, value) {
    var normalizedValue = normalizeString(value);
    if (!normalizedValue) return false;
    var tagId = normalizeString(tag.id || '');
    var tagLabel = normalizeString(tag.label || '');
    var tagNameAr = normalizeString(tag.name_ar || '');
    var tagNameEn = normalizeString(tag.name_en || '');
    return normalizedValue === tagId || normalizedValue === tagLabel || normalizedValue === tagNameAr || normalizedValue === tagNameEn;
  }

  function getTagLabel(tag) {
    tag = normalizeTagObject(tag);
    return tag.label || tag.id || 'غير معروف';
  }

  function getSelectedTagLabel(group, value) {
    var options = Array.isArray(availableTraits[group]) ? availableTraits[group] : [];
    var normalizedValue = normalizeString(value);
    var found = options.find(function (option) {
      return tagMatchesValue(option, normalizedValue);
    });
    return found ? getTagLabel(found) : String(value || '').trim();
  }

  function getTagDisplayList(group, selected) {
    if (!Array.isArray(selected) || !selected.length) return '--';
    return selected.map(function (value) {
      return getSelectedTagLabel(group, value);
    }).filter(Boolean).join('، ') || '--';
  }

  function safeUnique(items) {
    return Array.isArray(items) ? items.filter(Boolean).map(String).reduce(function (acc, item) {
      var value = item.trim();
      if (value && acc.indexOf(value) === -1) acc.push(value);
      return acc;
    }, []) : [];
  }

  function safeFetchJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('fetch_failed');
      return res.json();
    });
  }

  function apiFetch(path, options) {
    options = options || {};
    var headers = options.headers ? Object.assign({}, options.headers) : {};
    var authToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (authToken) {
      headers.Authorization = 'Bearer ' + authToken;
    }
    var body = null;
    if (options.body != null) {
      if (typeof options.body === 'string') {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
      }
    }
    return fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: body
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return null; }).then(function (payload) {
          var err = new Error('api_error');
          err.status = res.status;
          err.payload = payload;
          throw err;
        });
      }
      return res.json();
    });
  }

  function tryFetch(primary, fallback) {
    return safeFetchJson(primary).catch(function () {
      return safeFetchJson(fallback);
    });
  }

  function setCalibrationStatus(message, type) {
    if (!controls.calibStatus) return;
    controls.calibStatus.textContent = message || '';
    controls.calibStatus.className = 'status-line' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
  }

  function getStationId(station) {
    if (!station) return '';
    return station.id || station.station_id || station.code || station.name || '';
  }

  function getStationCoords(station) {
    if (!station) {
      return { lat: NaN, lon: NaN };
    }
    var latValue = station.lat != null ? station.lat : station.latitude != null ? station.latitude : station.lng == null && station.latlng && station.latlng.lat != null ? station.latlng.lat : station.location && station.location.lat != null ? station.location.lat : null;
    var lonValue = station.lon != null ? station.lon : station.longitude != null ? station.longitude : station.latlng && station.latlng.lng != null ? station.latlng.lng : station.location && station.location.lng != null ? station.location.lng : station.lng != null ? station.lng : null;
    return {
      lat: Number(latValue),
      lon: Number(lonValue)
    };
  }

  function getStationRoleType(station) {
    if (!station) return 'latlon_band_station';
    if (station.role_type) return station.role_type;
    if (station.category === 'primary' || station.category === 'reference' || station.featured) return 'primary_reference';
    if (station.category === 'secondary' || (Array.isArray(station.tags) && station.tags.includes('secondary'))) return 'secondary_linked';
    return 'latlon_band_station';
  }

  function getRoleLabel(type) {
    if (type === 'primary_reference') return 'رئيسية مرجعية';
    if (type === 'secondary_linked') return 'تابعة';
    if (type === 'latlon_band_station') return 'مرتبطة بخطوط';
    if (type === 'active') return 'نشطة';
    if (type === 'inactive') return 'غير نشطة';
    return 'غير محدد';
  }

  function getRoleColor(type) {
    if (type === 'primary_reference') return '#ff5252';
    if (type === 'secondary_linked') return '#f8c146';
    if (type === 'latlon_band_station') return '#ff8c00';
    return '#5ce1ff';
  }

  function getDurById(id) {
    return dururCache.find(function (dur) { return dur.id === id; }) || null;
  }

  function getDurLabel(dur) {
    if (!dur) return 'غير معروف';
    return dur.name_ar || dur.name || ('در ' + (dur.dur_number != null ? dur.dur_number : '?'));
  }

  function getDurDateRange(dur) {
    if (!dur) return '--';
    var startMonth = parseNumber(dur.gregorian_start_month, 0);
    var startDay = parseNumber(dur.gregorian_start_day, 0);
    var endMonth = parseNumber(dur.gregorian_end_month, 0);
    var endDay = parseNumber(dur.gregorian_end_day, 0);
    if (startMonth && startDay && endMonth && endDay) {
      return startDay + '/' + startMonth + ' ⇢ ' + endDay + '/' + endMonth;
    }
    var hint = dur.gregorian_window_hint || {};
    if (hint.start_month && hint.start_day && hint.end_month && hint.end_day) {
      return hint.start_day + '/' + hint.start_month + ' ⇢ ' + hint.end_day + '/' + hint.end_month;
    }
    return '--';
  }

  function getDurStartTimestamp(dur, year) {
    if (!dur) return null;
    var month = parseNumber(dur.gregorian_start_month, 1);
    var day = parseNumber(dur.gregorian_start_day, 1);
    var date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    return date;
  }

  function getDurEndTimestamp(dur, year) {
    if (!dur) return null;
    var month = parseNumber(dur.gregorian_end_month, 1);
    var day = parseNumber(dur.gregorian_end_day, 1);
    var date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
    return date;
  }

  function isDateWithinDur(date, dur) {
    if (!date || !dur) return false;
    var month = date.getUTCMonth() + 1;
    var day = date.getUTCDate();
    var start = parseNumber(dur.gregorian_start_month, 0) * 100 + parseNumber(dur.gregorian_start_day, 0);
    var end = parseNumber(dur.gregorian_end_month, 0) * 100 + parseNumber(dur.gregorian_end_day, 0);
    var current = month * 100 + day;
    if (start <= end) {
      return current >= start && current <= end;
    }
    return current >= start || current <= end;
  }

  function getCurrentDurForDate(date) {
    if (!Array.isArray(dururCache)) return null;
    return dururCache.find(function (dur) {
      return dur.is_active !== false && isDateWithinDur(date, dur);
    }) || null;
  }

  function sortDurByStartDate(items) {
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      var aKey = parseNumber(a.gregorian_start_month, 0) * 100 + parseNumber(a.gregorian_start_day, 0);
      var bKey = parseNumber(b.gregorian_start_month, 0) * 100 + parseNumber(b.gregorian_start_day, 0);
      return aKey - bKey;
    });
  }

  function sortDurByMasterOrder(items) {
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      return parseNumber(a.order_index, Number.MAX_SAFE_INTEGER) - parseNumber(b.order_index, Number.MAX_SAFE_INTEGER);
    });
  }

  function getNextDur(currentDur) {
    var sorted = sortDurByStartDate(dururCache.filter(function (dur) { return dur.is_active !== false; }));
    if (!sorted.length) return null;
    if (!currentDur) return sorted[0] || null;
    var currentIndex = sorted.findIndex(function (dur) { return dur.id === currentDur.id; });
    if (currentIndex < 0 || currentIndex === sorted.length - 1) return sorted[0];
    return sorted[currentIndex + 1];
  }

  function daysBetween(dateA, dateB) {
    var ms = dateB.getTime() - dateA.getTime();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  function computeMatchScore(expected, observed) {
    var e = Array.isArray(expected) ? expected.map(String).map(function (item) { return item.trim(); }).filter(Boolean) : [];
    var o = Array.isArray(observed) ? observed.map(String).map(function (item) { return item.trim(); }).filter(Boolean) : [];
    if (!e.length || !o.length) return 0;
    var set = {};
    e.forEach(function (item) { set[item] = true; });
    var intersection = 0;
    o.forEach(function (item) { if (set[item]) intersection += 1; set[item] = true; });
    var unionCount = Object.keys(set).length;
    return unionCount === 0 ? 0 : Math.min(1, intersection / unionCount);
  }

  function getDistanceKm(pointA, pointB) {
    var toRad = function (value) { return value * Math.PI / 180; };
    var lat1 = pointA.lat;
    var lon1 = pointA.lon;
    var lat2 = pointB.lat;
    var lon2 = pointB.lon;
    if (!isFinite(lat1) || !isFinite(lon1) || !isFinite(lat2) || !isFinite(lon2)) return Infinity;
    var R = 6371;
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function assignStationRoles() {
    var primaryStations = stations.filter(function (station) {
      return station.featured || station.category === 'primary' || station.category === 'reference' || (Array.isArray(station.tags) && station.tags.includes('primary'));
    });
    if (!primaryStations.length && stations.length) {
      primaryStations = [stations[0]];
    }
    var primaryIds = primaryStations.map(function (station) { return getStationId(station); });
    stations.forEach(function (station) {
      var role = getStationRoleType(station);
      if (primaryIds.indexOf(getStationId(station)) >= 0) {
        role = 'primary_reference';
      }
      station.role_type = role;
    });
    var primarySet = stations.filter(function (station) { return station.role_type === 'primary_reference'; });
    stations.forEach(function (station) {
      if (station.role_type !== 'primary_reference') {
        var stationCoords = getStationCoords(station);
        var nearest = primarySet.reduce(function (best, primary) {
          var primaryCoords = getStationCoords(primary);
          var distance = getDistanceKm(stationCoords, primaryCoords);
          if (!best || distance < best.distance) {
            return { station: primary, distance: distance };
          }
          return best;
        }, null);
        if (nearest && nearest.distance <= 90) {
          station.role_type = 'secondary_linked';
        } else {
          station.role_type = 'latlon_band_station';
        }
      }
    });
  }

  function getStationCalibration(station) {
    if (!station) return null;
    var stationId = getStationId(station);
    if (!stationId) return null;
    if (!calibrationStore[stationId]) {
      calibrationStore[stationId] = buildDefaultCalibration(station);
    }
    return calibrationStore[stationId];
  }

  function buildDefaultCalibration(station) {
    var currentDur = getCurrentDurForDate(new Date());
    var result = {
      durId: currentDur ? currentDur.id : '',
      startMonth: currentDur ? parseNumber(currentDur.gregorian_start_month, 1) : 1,
      startDay: currentDur ? parseNumber(currentDur.gregorian_start_day, 1) : 1,
      daysCount: currentDur ? parseNumber(currentDur.default_days_count, parseNumber(currentDur.days_count, 30)) : 30,
      traits: {
        general: [],
        weather: currentDur && Array.isArray(currentDur.weather_traits) ? currentDur.weather_traits.slice() : [],
        marine: currentDur && Array.isArray(currentDur.marine_traits) ? currentDur.marine_traits.slice() : [],
        fish: currentDur && Array.isArray(currentDur.fish_traits) ? currentDur.fish_traits.slice() : [],
        heritage: currentDur && currentDur.heritage_meaning ? [currentDur.heritage_meaning] : [],
        seasonal_transition_traits: [],
        advice: []
      },
      notes: {
        local: '',
        expert: '',
        interpretation: '',
        correction: ''
      }
    };
    return result;
  }

  function updateAuthUi() {
    if (controls.currentUserName) {
      var user = getAuthUser();
      controls.currentUserName.textContent = user.username || 'مستخدم NAVIDUROR';
    }
  }

  function createMap() {
    var container = getEl('navidurorMap');
    if (!container || typeof L === 'undefined') return;
    if (map) return;

    map = L.map(container, { zoomControl: true, attributionControl: true }).setView([25.3, 51.3], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    stationLayer = L.layerGroup().addTo(map);
    tempStationLayer = L.layerGroup().addTo(map);

    map.on('click', function (event) {
      if (!event || !event.latlng) return;
      openStationForm(null, event.latlng);
    });

    window.addEventListener('orientationchange', function () {
      if (map) { try { map.invalidateSize(); } catch (e) {} }
    });
  }

  function resizeMap() {
    if (!map) return;
    try { map.invalidateSize(); } catch (e) {}
  }
  
  function frameMapToStations(markerLayerOrGroup, selectedLatLng) {
    if (!map) return;

    if (selectedLatLng) {
      map.flyTo(selectedLatLng, 8, { duration: 0.5 });
      resizeMap();
      setTimeout(resizeMap, 300);
      return;
    }

    try {
      var bounds = markerLayerOrGroup && markerLayerOrGroup.getBounds ? markerLayerOrGroup.getBounds() : null;
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [30, 30],
          maxZoom: 7
        });
        resizeMap();
        setTimeout(resizeMap, 300);
        return;
      }
    } catch (e) {}

    map.setView(DEFAULT_GULF_CENTER, DEFAULT_GULF_ZOOM);
    resizeMap();
    setTimeout(resizeMap, 300);
  }

  function renderFilters() {
    if (controls.durFilter) {
      controls.durFilter.innerHTML = '<option value="all">الكل</option>' + sortDurByMasterOrder(dururCache).map(function (dur) {
        return '<option value="' + dur.id + '">' + getDurLabel(dur) + '</option>';
      }).join('');
    }
    if (controls.seasonEventFilter) {
      controls.seasonEventFilter.innerHTML = '<option value="all">الكل</option>' + seasonEventsCache.map(function (event) {
        return '<option value="' + event.id + '">' + (event.name || 'حدث موسمي') + '</option>';
      }).join('');
    }
    if (controls.yearFilter) {
      var years = Array.from(new Set(comparisonsCache.map(function (item) { return item.year; })).add(currentYear)).sort(function (a, b) { return b - a; });
      controls.yearFilter.innerHTML = '<option value="all">الكل</option>' + years.map(function (year) {
        return '<option value="' + year + '">' + year + '</option>';
      }).join('');
    }
    if (controls.calibDurSelect) {
      controls.calibDurSelect.innerHTML = '<option value="">اختر الدر</option>' + sortDurByMasterOrder(dururCache).map(function (dur) {
        return '<option value="' + dur.id + '">' + getDurLabel(dur) + '</option>';
      }).join('');
    }
    if (controls.stationFormCard) {
      controls.stationFormCard.hidden = true;
    }
  }

  function getStationFormPayload() {
    return {
      id: controls.stationFormId && String(controls.stationFormId.value || '').trim(),
      name: controls.stationFormName && String(controls.stationFormName.value || '').trim(),
      lat: parseNumber(controls.stationFormLat && controls.stationFormLat.value, null),
      lon: parseNumber(controls.stationFormLon && controls.stationFormLon.value, null),
      country: controls.stationFormCountry && String(controls.stationFormCountry.value || '').trim(),
      region: controls.stationFormRegion && String(controls.stationFormRegion.value || '').trim(),
      station_role_type: controls.stationFormRoleType && String(controls.stationFormRoleType.value || '').trim(),
      reference_station_id: controls.stationFormReferenceId && String(controls.stationFormReferenceId.value || '').trim(),
      status: controls.stationFormStatus && String(controls.stationFormStatus.value || '').trim(),
      notes: controls.stationFormNotes && String(controls.stationFormNotes.value || '').trim()
    };
  }

  function setStationFormMessage(message, type) {
    if (!controls.stationFormFeedback) return;
    controls.stationFormFeedback.textContent = message || '';
    controls.stationFormFeedback.style.color = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--muted)';
  }

  function clearStationFormMessage() {
    if (!controls.stationFormFeedback) return;
    controls.stationFormFeedback.textContent = '';
  }

  function hideStationForm() {
    if (controls.stationFormCard) {
      controls.stationFormCard.hidden = true;
    }
    if (tempStationLayer && map) {
      try {
        tempStationLayer.clearLayers();
      } catch (e) {}
    }
    tempStationMarker = null;
    editingStation = null;
  }

  function openStationForm(station, latlng) {
    if (!controls.stationFormCard) return;
    clearStationFormMessage();
    stationFormState.isNew = !station;
    editingStation = station || null;
    stationFormState.originalId = station ? getStationId(station) : '';

    if (station) {
      controls.stationFormId.value = station.id || '';
      controls.stationFormName.value = station.name || '';
      var coords = getStationCoords(station);
      controls.stationFormLat.value = coords.lat || '';
      controls.stationFormLon.value = coords.lon || '';
      controls.stationFormCountry.value = station.country || '';
      controls.stationFormRegion.value = station.region || '';
      controls.stationFormRoleType.value = station.station_role_type || station.role_type || 'secondary_linked';
      controls.stationFormReferenceId.value = station.reference_station_id || station.referenceStationId || '';
      controls.stationFormStatus.value = station.status || 'active';
      controls.stationFormNotes.value = station.notes || '';
    } else {
      controls.stationFormId.value = '';
      controls.stationFormName.value = '';
      controls.stationFormCountry.value = '';
      controls.stationFormRegion.value = 'gulf';
      controls.stationFormRoleType.value = 'secondary_linked';
      controls.stationFormReferenceId.value = '';
      controls.stationFormStatus.value = 'active';
      controls.stationFormNotes.value = '';
      if (latlng) {
        controls.stationFormLat.value = latlng.lat || '';
        controls.stationFormLon.value = latlng.lng || latlng.lon || '';
      }
    }

    if (controls.stationFormCard) {
      controls.stationFormCard.hidden = false;
      try {
        controls.stationFormCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {}
    }

    if (tempStationLayer && map) {
      try {
        tempStationLayer.clearLayers();
      } catch (e) {}
    }
    tempStationMarker = null;
    if (!station && latlng && map) {
      tempStationMarker = L.circleMarker([latlng.lat, latlng.lng], {
        radius: 22,
        color: '#00ffdd',
        fillColor: '#00aaff',
        fillOpacity: 1,
        weight: 5,
        opacity: 1
      }).addTo(tempStationLayer);
      if (tempStationMarker && typeof tempStationMarker.bringToFront === 'function') {
        tempStationMarker.bringToFront();
      }
      map.setView([latlng.lat, latlng.lng], 8);
    }
  }

  function saveStationForm() {
    if (!controls.stationFormSaveBtn) return;
    var payload = getStationFormPayload();
    if (!payload.name || payload.lat == null || payload.lon == null) {
      setStationFormMessage('الاسم والإحداثيات مطلوبان.', 'error');
      return Promise.reject(new Error('validation_failed'));
    }
    var isNew = stationFormState.isNew;
    var endpoint = isNew ? '/api/stations' : '/api/admin/stations/' + encodeURIComponent(stationFormState.originalId || payload.id);
    var method = isNew ? 'POST' : 'PUT';
    if (!isNew) {
      payload.id = stationFormState.originalId || payload.id;
    }
    setStationFormMessage(isNew ? 'جارٍ إنشاء المحطة...' : 'جارٍ تحديث المحطة...', '');
    return apiFetch(endpoint, { method: method, body: payload }).then(function (response) {
      var station = response && (response.station || response.item || response);
      if (!station) throw new Error('station_save_failed');
      if (isNew) {
        stations.push(station);
      } else {
        var idx = stations.findIndex(function (item) { return getStationId(item) === getStationId(station); });
        if (idx >= 0) {
          stations[idx] = station;
        } else {
          stations.push(station);
        }
      }
      assignStationRoles();
      renderStationMarkers();
      selectStation(station);
      setStationFormMessage('تم حفظ بيانات المحطة بنجاح.', 'success');
      hideStationForm();
      return station;
    }).catch(function (error) {
      var msg = 'فشل حفظ المحطة. تحقق من البيانات والصلاحيات.';
      if (error && error.payload && error.payload.error) {
        msg = String(error.payload.error);
      }
      setStationFormMessage(msg, 'error');
      throw error;
    });
  }

  function getCurrentDurSummary() {
    var currentDur = getCurrentDurForDate(new Date());
    if (!currentDur) return '--';
    var nextDur = getNextDur(currentDur);
    return getDurLabel(currentDur) + ' • ' + getDurDateRange(currentDur) + (nextDur ? ' | الدر التالي: ' + getDurLabel(nextDur) : '');
  }

  function updateHeaderSummary() {
    if (controls.summaryStations) controls.summaryStations.textContent = stations.length;
    if (controls.summaryDurCount) controls.summaryDurCount.textContent = dururCache.length;
    if (controls.summaryEvents) controls.summaryEvents.textContent = seasonEventsCache.length;
    if (controls.summaryTodayDur) controls.summaryTodayDur.textContent = getCurrentDurSummary();
    if (controls.summarySelectedStation) controls.summarySelectedStation.textContent = selectedStation ? (selectedStation.name || getStationId(selectedStation)) : 'لا توجد';
  }

  function filterStation(station) {
    if (!station) return false;
    var searchValue = normalizeString(controls.stationSearch && controls.stationSearch.value);
    if (searchValue) {
      var haystack = [station.name, station.country, station.region, station.id, station.station_id, station.category].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(searchValue)) return false;
    }
    var typeFilter = controls.stationTypeFilter ? controls.stationTypeFilter.value : 'all';
    if (typeFilter !== 'all') {
      var role = station.role_type || getStationRoleType(station);
      if (typeFilter === 'active' && String(station.status || '').toLowerCase() !== 'active') return false;
      if (typeFilter === 'inactive' && String(station.status || '').toLowerCase() === 'active') return false;
      if (typeFilter !== 'active' && typeFilter !== 'inactive' && role !== typeFilter) return false;
    }
    var selectedDurId = controls.durFilter ? controls.durFilter.value : 'all';
    if (selectedDurId !== 'all') {
      var currentDur = getCurrentDurForDate(new Date());
      if (!currentDur || currentDur.id !== selectedDurId) return false;
    }
    var selectedEventId = controls.seasonEventFilter ? controls.seasonEventFilter.value : 'all';
    if (selectedEventId !== 'all') {
      var currentDur = getCurrentDurForDate(new Date());
      var events = currentDur ? seasonEventsCache.filter(function (event) {
        return Array.isArray(event.related_dur_ids) && event.related_dur_ids.includes(currentDur.id);
      }) : [];
      if (!events.some(function (event) { return event.id === selectedEventId; })) return false;
    }
    return true;
  }

  function getStationStyle(station) {
    var isSelected = selectedStation && getStationId(station) === getStationId(selectedStation);
    return {
      radius: isSelected ? 14 : 11,
      color: isSelected ? '#ffffff' : '#0f4f7d',
      fillColor: getRoleColor(station.role_type || getStationRoleType(station)),
      fillOpacity: isSelected ? 0.98 : 0.95,
      weight: isSelected ? 3 : 2,
      opacity: 1
    };
  }

  function selectStation(station) {
    if (!station) return;
    selectedStation = station;
    renderStationMarkers();
    renderSelectedStationCards();
    renderDistributionPreview();
    renderValidationPanel();
    focusStation(station);
    loadStationCalibration(station).then(function () {
      renderSelectedStationCards();
      renderValidationPanel();
    }).catch(function (error) {
      console.warn('[naviduror] loadStationCalibration failed', error);
      setCalibrationStatus('فشل تحميل معايرة المحطة من الخادم.', 'error');
    });
  }

  function focusStation(station) {
    if (!station || !map) return;
    var coords = getStationCoords(station);
    if (!isFinite(coords.lat) || !isFinite(coords.lon)) return;
    map.flyTo([coords.lat, coords.lon], 8, { duration: 0.5 });
    resizeMap();
    setTimeout(resizeMap, 300);
  }

  function renderStationMarkers() {
    if (!map) return;
    if (stationLayer) {
      try {
        map.removeLayer(stationLayer);
      } catch (e) {}
      stationLayer = null;
    }
    stationLayer = L.layerGroup().addTo(map);
    var visibleStations = stations.filter(filterStation);
    var validMarkers = [];
    visibleStations.forEach(function (station) {
      var coords = getStationCoords(station);
      if (!isFinite(coords.lat) || !isFinite(coords.lon)) return;
      var marker = L.circleMarker([coords.lat, coords.lon], getStationStyle(station));
      marker.bindTooltip('<strong>' + (station.name || 'محطة') + '</strong>', { direction: 'top', offset: [0, -9], opacity: 0.95 });
      marker.on('click', function (event) {
        if (event) {
          if (event.originalEvent && typeof event.originalEvent.stopPropagation === 'function') {
            event.originalEvent.stopPropagation();
          }
          if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
          }
        }
        selectStation(station);
        openStationForm(station, coords);
      });
      marker.addTo(stationLayer);
      if (typeof marker.bringToFront === 'function') {
        marker.bringToFront();
      }
      validMarkers.push(marker);
    });
    updateHeaderSummary();
    resizeMap();
    if (selectedStation) {
      var selectedCoords = getStationCoords(selectedStation);
      if (isFinite(selectedCoords.lat) && isFinite(selectedCoords.lon)) {
        map.flyTo([selectedCoords.lat, selectedCoords.lon], 8, { duration: 0.5 });
        resizeMap();
        return;
      }
    }
    if (validMarkers.length === 1) {
      map.flyTo(validMarkers[0].getLatLng(), 8, { duration: 0.5 });
      resizeMap();
      return;
    }
    if (validMarkers.length > 1) {
      var bounds = L.featureGroup(validMarkers).getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [30, 30],
          maxZoom: 7
        });
        resizeMap();
        return;
      }
    }
    map.setView(DEFAULT_GULF_CENTER, DEFAULT_GULF_ZOOM);
    resizeMap();
  }

  function getNearestPrimaryForStation(station) {
    var candidate = null;
    var stationCoords = getStationCoords(station);
    stations.filter(function (item) { return item.role_type === 'primary_reference' && getStationId(item) !== getStationId(station); }).forEach(function (primary) {
      var distance = getDistanceKm(stationCoords, getStationCoords(primary));
      if (!candidate || distance < candidate.distance) {
        candidate = { station: primary, distance: distance };
      }
    });
    return candidate;
  }

  function getDerivedStations(station, limit) {
    if (!station) return [];
    var stationCoords = getStationCoords(station);
    var others = stations.filter(function (item) { return getStationId(item) !== getStationId(station); });
    var list = others.map(function (item) {
      return {
        station: item,
        distanceKm: getDistanceKm(stationCoords, getStationCoords(item)),
        role: item.role_type || getStationRoleType(item)
      };
    }).sort(function (a, b) {
      return a.distanceKm - b.distanceKm;
    });
    return list.slice(0, limit || 6);
  }

  function getStationReferenceId(station) {
    if (!station) return '';
    return String(station.reference_station_id || station.referenceStationId || station.reference_id || station.ref_station_id || '').trim();
  }

  function getStationPrimaryGroupId(station) {
    if (!station) return '';
    var stationId = getStationId(station);
    var role = getStationRoleType(station);
    if (role === 'primary_reference') return stationId;
    var explicitRef = getStationReferenceId(station);
    if (explicitRef) return explicitRef;
    var nearest = getNearestPrimaryForStation(station);
    return nearest && nearest.station ? getStationId(nearest.station) : '';
  }

  function getRelationBasisLabel(other, selected, selectedPrimaryId) {
    var otherRefId = getStationReferenceId(other);
    var otherPrimaryId = getStationPrimaryGroupId(other);
    if (otherRefId && otherRefId === getStationId(selected)) return 'تابعة مباشرة';
    if (selectedPrimaryId && otherPrimaryId && selectedPrimaryId === otherPrimaryId) return 'نفس المرجع الرئيسي';
    if (getStationRoleType(other) === getStationRoleType(selected)) return 'نفس نوع الدور';
    return 'قرب جغرافي';
  }

  function getCalibrationPreviewValues(calibration) {
    if (!calibration) return null;
    var dur = getDurById(calibration.durId) || getCurrentDurForDate(new Date());
    var startMonth = parseNumber(calibration.startMonth, 0);
    var startDay = parseNumber(calibration.startDay, 0);
    var startDate = (startMonth && startDay) ? new Date(Date.UTC(currentYear, startMonth - 1, startDay, 0, 0, 0)) : getDurStartTimestamp(dur, currentYear) || new Date();
    var daysCount = parseNumber(calibration.daysCount, dur ? parseNumber(dur.default_days_count, parseNumber(dur.days_count, 30)) : 30);
    var endDate = new Date(startDate.getTime() + (Math.max(1, daysCount) * 24 * 60 * 60 * 1000));
    var currentDate = new Date();
    var daysRemaining = daysBetween(currentDate, endDate);
    return {
      dur: dur,
      nextDur: getNextDur(dur),
      startDate: startDate,
      daysCount: daysCount,
      daysRemaining: daysRemaining
    };
  }

  function formatPreviewDate(date) {
    if (!date || !(date instanceof Date) || !isFinite(date.getTime())) return '--';
    return date.getUTCDate() + '/' + (date.getUTCMonth() + 1);
  }

  function getRelatedStations(selected, limit) {
    if (!selected) return [];
    var selectedId = getStationId(selected);
    var selectedRole = getStationRoleType(selected);
    var selectedRefId = getStationReferenceId(selected);
    var selectedPrimaryId = getStationPrimaryGroupId(selected);
    var selectedCoords = getStationCoords(selected);
    var candidates = stations.filter(function (item) { return getStationId(item) !== selectedId; }).map(function (item) {
      var role = item.role_type || getStationRoleType(item);
      var distanceKm = getDistanceKm(selectedCoords, getStationCoords(item));
      var otherRefId = getStationReferenceId(item);
      var otherPrimaryId = getStationPrimaryGroupId(item);
      var score = 0;
      if (otherRefId && otherRefId === selectedId) score += 10;
      if (selectedRefId && otherRefId && selectedRefId === otherRefId) score += 8;
      if (selectedPrimaryId && otherPrimaryId && selectedPrimaryId === otherPrimaryId) score += 6;
      if (selectedRole === 'primary_reference' && role === 'secondary_linked' && otherPrimaryId === selectedId) score += 5;
      if (role === selectedRole) score += 2;
      if (distanceKm <= 90) score += 1;
      return {
        station: item,
        role: role,
        distanceKm: distanceKm,
        referenceId: otherRefId,
        primaryId: otherPrimaryId,
        score: score
      };
    });
    var explicit = candidates.filter(function (item) {
      return item.score >= 3;
    });
    if (!explicit.length) {
      explicit = candidates.filter(function (item) {
        return item.primaryId === selectedPrimaryId && selectedPrimaryId;
      });
    }
    if (!explicit.length && selectedRole === 'primary_reference') {
      explicit = candidates.filter(function (item) {
        return item.role === 'secondary_linked' && item.distanceKm <= 90;
      });
    }
    if (!explicit.length) {
      return [];
    }
    return explicit.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.distanceKm - b.distanceKm;
    }).slice(0, limit || 6);
  }

  function getComparisonRecord(stationId, durId, year) {
    return comparisonsCache.find(function (record) {
      return record.station_id === stationId && record.dur_id === durId && Number(record.year) === Number(year);
    }) || null;
  }

  function renderSelectedStationCards() {
    if (!selectedStation) {
      if (controls.identityBody) {
        controls.identityBody.innerHTML = '<p>اختر محطة من الخريطة لبدء معايرة وتحقق الدر.</p>';
      }
      renderDurCalibrationCard();
      renderDistributionPreview();
      renderValidationPanel();
      return;
    }
    var coords = getStationCoords(selectedStation);
    var profile = stationProfilesCache.find(function (item) {
      return item.station_id === getStationId(selectedStation);
    });
    var roleLabel = getRoleLabel(selectedStation.role_type || getStationRoleType(selectedStation));
    controls.identityBody.innerHTML = '' +
      '<div class="info-row"><span>المعرف:</span><strong>' + getStationId(selectedStation) + '</strong></div>' +
      '<div class="info-row"><span>الاسم:</span><strong>' + (selectedStation.name || 'غير معروف') + '</strong></div>' +
      '<div class="info-row"><span>الدولة:</span><strong>' + (selectedStation.country || 'غير محدد') + '</strong></div>' +
      '<div class="info-row"><span>المنطقة:</span><strong>' + (selectedStation.region || 'غير محدد') + '</strong></div>' +
      '<div class="info-row"><span>الإحداثيات:</span><strong>' + coords.lat + ' , ' + coords.lon + '</strong></div>' +
      '<div class="info-row"><span>دور المحطة:</span><strong>' + roleLabel + '</strong></div>' +
      '<div class="info-row"><span>الحالة:</span><strong>' + (selectedStation.status || 'غير محدد') + '</strong></div>' +
      '<div class="info-row"><span>ملف التعريف المحلي:</span><strong>' + (profile ? (profile.local_definition || 'لا توجد') : 'لا توجد') + '</strong></div>';

    renderDurCalibrationCard();
    renderDistributionPreview();
    renderValidationPanel();
  }

  function updateCalibrationFields() {
    var calibration = selectedStation ? getStationCalibration(selectedStation) : null;
    if (!calibration) return;
    if (controls.calibDurSelect) controls.calibDurSelect.value = calibration.durId || '';
    if (controls.calibStartMonth) controls.calibStartMonth.value = calibration.startMonth || '';
    if (controls.calibStartDay) controls.calibStartDay.value = calibration.startDay || '';
    if (controls.calibDaysCount) controls.calibDaysCount.value = calibration.daysCount || '';
    renderCalibrationSummary();
    renderTraitGroups();
    renderExpertNotes();
  }

  function renderCalibrationSummary() {
    var calibration = selectedStation ? getStationCalibration(selectedStation) : null;
    if (!controls.calibSummaryArea) return;
    if (!selectedStation || !calibration) {
      controls.calibSummaryArea.innerHTML = '<p>اختر محطة لعرض المعايرة الحالية.</p>';
      return;
    }
    var dur = getDurById(calibration.durId) || getCurrentDurForDate(new Date());
    var nextDur = getNextDur(dur);
    var startDate = calibration.startMonth && calibration.startDay ? calibration.startDay + '/' + calibration.startMonth : '--';
    var activeDays = calibration.daysCount != null ? calibration.daysCount : '--';
    var defaultDays = dur && dur.default_days_count != null ? dur.default_days_count : '--';
    var currentDate = new Date();
    var nextDurLabel = nextDur ? getDurLabel(nextDur) : '--';
    var daysUntilNext = nextDur ? daysBetween(currentDate, getDurStartTimestamp(nextDur, currentYear)) : '--';
    controls.calibSummaryArea.innerHTML = '' +
      '<div class="info-row"><span>اسم الدر:</span><strong>' + getDurLabel(dur) + '</strong></div>' +
      '<div class="info-row"><span>رقم الدر:</span><strong>' + (dur && dur.dur_number != null ? dur.dur_number : '--') + '</strong></div>' +
      '<div class="info-row"><span>أيام الدر الافتراضية:</span><strong>' + defaultDays + '</strong></div>' +
      '<div class="info-row"><span>عدد الأيام الفعلي:</span><strong>' + activeDays + '</strong></div>' +
      '<div class="info-row"><span>نطاق الدر:</span><strong>' + (dur ? getDurDateRange(dur) : '--') + '</strong></div>' +
      '<div class="info-row"><span>الدر التالي المتوقع:</span><strong>' + nextDurLabel + '</strong></div>' +
      '<div class="info-row"><span>أيام حتى الدر التالي:</span><strong>' + (nextDur ? daysUntilNext : '--') + '</strong></div>' +
      '<div class="info-row"><span>السمات العامة:</span><strong>' + getTagDisplayList('general', calibration.traits.general) + '</strong></div>' +
      '<div class="info-row"><span>سمات الطقس:</span><strong>' + getTagDisplayList('weather', calibration.traits.weather) + '</strong></div>' +
      '<div class="info-row"><span>سمات البحر:</span><strong>' + getTagDisplayList('marine', calibration.traits.marine) + '</strong></div>' +
      '<div class="info-row"><span>علامات موسم الصيد:</span><strong>' + getTagDisplayList('fish_season', calibration.traits.fish_season) + '</strong></div>' +
      '<div class="info-row"><span>إشارات محلية:</span><strong>' + getTagDisplayList('heritage', calibration.traits.heritage) + '</strong></div>' +
      '<div class="info-row"><span>الانتقالات الموسمية:</span><strong>' + getTagDisplayList('seasonal_transition_traits', calibration.traits.seasonal_transition_traits) + '</strong></div>' +
      '<div class="info-row"><span>أساس النصيحة:</span><strong>' + getTagDisplayList('advice', calibration.traits.advice) + '</strong></div>';
  }

  function renderTraitGroups() {
    var calibration = selectedStation ? getStationCalibration(selectedStation) : null;
    var groups = ['general', 'weather', 'marine', 'fish', 'fish_season', 'heritage', 'seasonal_transition_traits', 'advice'];
    groups.forEach(function (group) {
      var container = getEl('traitGroup-' + group);
      if (!container) return;
      container.innerHTML = '';
      var options = Array.isArray(availableTraits[group]) ? availableTraits[group] : [];
      var selected = calibration && calibration.traits && Array.isArray(calibration.traits[group]) ? calibration.traits[group] : [];
      options.forEach(function (tag) {
        tag = normalizeTagObject(tag);
        var isActive = selected.some(function (value) {
          return tagMatchesValue(tag, value);
        });
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'trait-chip' + (isActive ? ' active' : '');
        chip.textContent = tag.label;
        chip.dataset.group = group;
        chip.dataset.tag = tag.id;
        chip.addEventListener('click', function () {
          toggleTraitTag(group, tag.id);
        });
        container.appendChild(chip);
      });
      if (!options.length) {
        var hint = document.createElement('div');
        hint.textContent = 'لا توجد سمات مسجلة بعد. أضف سمة جديدة.';
        hint.style.color = 'var(--muted)';
        container.appendChild(hint);
      }
    });
  }

  function toggleTraitTag(group, tag) {
    if (!selectedStation) return;
    var calibration = getStationCalibration(selectedStation);
    if (!calibration || !calibration.traits) return;
    var list = Array.isArray(calibration.traits[group]) ? calibration.traits[group].slice() : [];
    var normalizedTag = normalizeString(tag);
    var index = list.findIndex(function (item) {
      return normalizeString(item) === normalizedTag;
    });
    if (index >= 0) {
      list.splice(index, 1);
    } else {
      list.push(String(tag));
    }
    calibration.traits[group] = list;
    calibrationStore[getStationId(selectedStation)] = calibration;
    renderTraitGroups();
  }

  function addTraitFromInput(group) {
    if (!selectedStation) return;
    var input = controls.traitInputs[group];
    if (!input) return;
    var value = normalizeString(input.value || '');
    if (!value) return;
    input.value = '';
    var tagObject = normalizeTagObject({ id: value, label: value });
    availableTraits[group] = availableTraits[group] || [];
    if (!availableTraits[group].some(function (item) { return tagMatchesValue(normalizeTagObject(item), tagObject.id); })) {
      availableTraits[group].push(tagObject);
    }
    var calibration = getStationCalibration(selectedStation);
    var list = Array.isArray(calibration.traits[group]) ? calibration.traits[group].slice() : [];
    if (!list.some(function (item) { return normalizeString(item) === normalizeString(value); })) {
      list.push(value);
    }
    calibration.traits[group] = list;
    calibrationStore[getStationId(selectedStation)] = calibration;
    renderTraitGroups();
  }

  function renderExpertNotes() {
    if (!selectedStation) return;
    var calibration = getStationCalibration(selectedStation);
    if (!calibration) return;
    var localNotes = getEl('expertLocalNotes');
    var summaryNotes = getEl('expertSummaryNotes');
    var interpretation = getEl('expertInterpretation');
    var correction = getEl('expertCorrectionNotes');
    if (localNotes) localNotes.value = calibration.notes.local || '';
    if (summaryNotes) summaryNotes.value = calibration.notes.expert || '';
    if (interpretation) interpretation.value = calibration.notes.interpretation || '';
    if (correction) correction.value = calibration.notes.correction || '';
  }

  function persistExpertNotes() {
    if (!selectedStation) return;
    var calibration = getStationCalibration(selectedStation);
    if (!calibration) return;
    var localNotes = getEl('expertLocalNotes');
    var summaryNotes = getEl('expertSummaryNotes');
    var interpretation = getEl('expertInterpretation');
    var correction = getEl('expertCorrectionNotes');
    calibration.notes.local = localNotes ? localNotes.value.trim() : calibration.notes.local;
    calibration.notes.expert = summaryNotes ? summaryNotes.value.trim() : calibration.notes.expert;
    calibration.notes.interpretation = interpretation ? interpretation.value.trim() : calibration.notes.interpretation;
    calibration.notes.correction = correction ? correction.value.trim() : calibration.notes.correction;
    calibrationStore[getStationId(selectedStation)] = calibration;
  }

  function persistCalibrationForm() {
    if (!selectedStation) return;
    var calibration = getStationCalibration(selectedStation);
    if (!calibration) return;
    if (controls.calibDurSelect) {
      calibration.durId = controls.calibDurSelect.value || '';
    }
    if (controls.calibStartMonth) {
      calibration.startMonth = parseNumber(controls.calibStartMonth.value, calibration.startMonth);
    }
    if (controls.calibStartDay) {
      calibration.startDay = parseNumber(controls.calibStartDay.value, calibration.startDay);
    }
    if (controls.calibDaysCount) {
      calibration.daysCount = parseNumber(controls.calibDaysCount.value, calibration.daysCount);
    }
    calibrationStore[getStationId(selectedStation)] = calibration;
  }

  function renderDurCalibrationCard() {
    if (!selectedStation) {
      if (controls.calibSummaryArea) {
        controls.calibSummaryArea.innerHTML = '<p>اختر محطة لعرض معايرة الدر.</p>';
      }
      return;
    }
    updateCalibrationFields();
  }

  function renderDistributionPreview() {
    if (!controls.distributionPreview) return;
    if (!selectedStation) {
      if (controls.distributionSummary) {
        controls.distributionSummary.textContent = 'اختر محطة لعرض معاينة التوزيع الجغرافي.';
      }
      controls.distributionPreview.innerHTML = '<p>اختر محطة لعرض تأثير المعايرة على المحطات الأخرى.</p>';
      return;
    }
    var calibration = getStationCalibration(selectedStation);
    var hasSavedCalibration = calibration && calibration.savedProfileId;
    var related = getRelatedStations(selectedStation, 6);
    if (!hasSavedCalibration) {
      if (controls.distributionSummary) {
        controls.distributionSummary.innerHTML = '<div class="distribution-summary-card"><div class="info-row"><span>المحطة المحددة:</span><strong>' + (selectedStation.name || getStationId(selectedStation)) + '</strong></div><div class="info-row"><span>دور المحطة:</span><strong>' + getRoleLabel(selectedStation.role_type || getStationRoleType(selectedStation)) + '</strong></div><div class="info-row"><span>عدد المحطات المرتبطة:</span><strong>0</strong></div></div>';
      }
      controls.distributionPreview.innerHTML = '<p>لم يتم حفظ معايرة لهذه المحطة بعد.</p>';
      return;
    }
    var preview = getCalibrationPreviewValues(calibration);
    if (!related.length) {
      if (controls.distributionSummary) {
        controls.distributionSummary.innerHTML = '<div class="distribution-summary-card"><div class="info-row"><span>المحطة المحددة:</span><strong>' + (selectedStation.name || getStationId(selectedStation)) + '</strong></div><div class="info-row"><span>الدور:</span><strong>' + getRoleLabel(selectedStation.role_type || getStationRoleType(selectedStation)) + '</strong></div><div class="info-row"><span>الدر المشتق:</span><strong>' + getDurLabel(preview.dur) + '</strong></div><div class="info-row"><span>بداية الدر:</span><strong>' + formatPreviewDate(preview.startDate) + '</strong></div><div class="info-row"><span>أيام الدر:</span><strong>' + preview.daysCount + '</strong></div><div class="info-row"><span>عدد المحطات المرتبطة:</span><strong>0</strong></div></div>';
      }
      controls.distributionPreview.innerHTML = '<p>لا توجد محطات مرتبطة كافية للعرض.</p>';
      return;
    }
    if (controls.distributionSummary) {
      controls.distributionSummary.innerHTML = '<div class="distribution-summary-card"><div class="info-row"><span>المحطة المحددة:</span><strong>' + (selectedStation.name || getStationId(selectedStation)) + '</strong></div><div class="info-row"><span>الدور:</span><strong>' + getRoleLabel(selectedStation.role_type || getStationRoleType(selectedStation)) + '</strong></div><div class="info-row"><span>الدر المشتق:</span><strong>' + getDurLabel(preview.dur) + '</strong></div><div class="info-row"><span>بداية الدر:</span><strong>' + formatPreviewDate(preview.startDate) + '</strong></div><div class="info-row"><span>أيام الدر:</span><strong>' + preview.daysCount + '</strong></div><div class="info-row"><span>عدد المحطات المرتبطة:</span><strong>' + related.length + '</strong></div></div>';
    }
    var itemsHtml = related.map(function (item) {
      var relationLabel = getRelationBasisLabel(item.station, selectedStation, getStationPrimaryGroupId(selectedStation));
      return '<div class="distribution-preview-item">' +
        '<div class="distribution-item-head"><div class="distribution-item-title">' + (item.station.name || getStationId(item.station)) + '</div><div class="distribution-item-role">' + getRoleLabel(item.role) + '</div></div>' +
        '<div class="distribution-item-row"><span class="distribution-label">المعرف:</span><strong>' + getStationId(item.station) + '</strong></div>' +
        '<div class="distribution-item-row"><span class="distribution-label">العلاقة:</span><strong>' + relationLabel + '</strong></div>' +
        '<div class="distribution-item-row"><span class="distribution-label">الدر الحالي:</span><strong>' + getDurLabel(preview.dur) + '</strong></div>' +
        '<div class="distribution-item-row"><span class="distribution-label">الدر التالي:</span><strong>' + getDurLabel(preview.nextDur) + '</strong></div>' +
        '<div class="distribution-item-row"><span class="distribution-label">أيام حتى التالي:</span><strong>' + preview.daysRemaining + '</strong></div>' +
        '<div class="distribution-item-row distribution-distance"><span>المسافة:</span><strong>' + item.distanceKm.toFixed(1) + ' كم</strong></div>' +
        '</div>';
    }).join('');
    controls.distributionPreview.innerHTML = '<div class="distribution-preview-list">' + itemsHtml + '</div>';
  }

  function renderValidationPanel() {
    if (!controls.validationSummaryText) return;
    if (!selectedStation) {
      controls.validationYearLabel.textContent = '...';
      controls.validationStatusLabel.textContent = 'لا توجد';
      controls.validationScoreLabel.textContent = '--';
      controls.validationTraitsExpected.innerHTML = '';
      controls.validationTraitsObserved.innerHTML = '';
      controls.validationSummaryText.textContent = 'اختر محطة وسنة لعرض التحقق السنوي.';
      controls.validationTrend.innerHTML = '';
      return;
    }
    var stationId = getStationId(selectedStation);
    var calibration = getStationCalibration(selectedStation);
    var dur = getDurById(calibration.durId) || getCurrentDurForDate(new Date());
    var yearValue = controls.yearFilter ? controls.yearFilter.value : String(currentYear);
    var year = yearValue === 'all' ? currentYear : Number(yearValue);
    var record = getComparisonRecord(stationId, dur ? dur.id : '', year);
    var expectedTraits = [];
    var observedTraits = [];

    if (record) {
      expectedTraits = Array.isArray(record.expected_traits) ? record.expected_traits : [];
      observedTraits = Array.isArray(record.observed_traits) ? record.observed_traits : [];
    } else if (dur) {
      expectedTraits = ([]).concat(dur.weather_traits || [], dur.marine_traits || [], dur.fish_traits || []);
      observedTraits = [];
    }

    var matchScore = record && typeof record.match_score === 'number' ? record.match_score : computeMatchScore(expectedTraits, observedTraits);
    var status = record ? (matchScore >= 0.7 ? 'معتمد' : 'يحتاج تصحيح') : 'بيانات غير كافية';

    controls.validationYearLabel.textContent = year;
    controls.validationStatusLabel.textContent = status;
    controls.validationScoreLabel.textContent = record ? (Math.round(matchScore * 100) + '%') : 'غير متاح';
    controls.validationSummaryText.textContent = record ? (record.summary || record.notes || 'لا توجد ملخصات إضافية.') : 'لا توجد مقارنة فعلية لهذا العام. سيعتمد التحقق على السمات المتاحة لاحقًا.';
    renderTraitChips(controls.validationTraitsExpected, expectedTraits, 'متوقع');
    renderTraitChips(controls.validationTraitsObserved, observedTraits, 'مرصود');
    renderValidationTrend(stationId, dur ? dur.id : '', year);
  }

  function renderTraitChips(container, tags, label) {
    if (!container) return;
    container.innerHTML = '<strong style="display:block; margin-bottom:10px;">' + label + '</strong>';
    if (!Array.isArray(tags) || !tags.length) {
      container.innerHTML += '<div class="info-row"><span>لا توجد سمات.</span></div>';
      return;
    }
    tags.forEach(function (tag) {
      var chip = document.createElement('span');
      chip.className = 'trait-chip active';
      chip.textContent = tag;
      container.appendChild(chip);
    });
  }

  function renderValidationTrend(stationId, durId, selectedYear) {
    if (!controls.validationTrend) return;
    var trends = comparisonsCache.filter(function (record) {
      return record.station_id === stationId && record.dur_id === durId && Number(record.year) <= Number(selectedYear);
    }).sort(function (a, b) { return Number(b.year) - Number(a.year); }).slice(0, 4);
    if (!trends.length) {
      controls.validationTrend.innerHTML = '<p style="color:var(--muted);">لا توجد بيانات سابقة للمقارنة.</p>';
      return;
    }
    var html = trends.map(function (record) {
      var score = typeof record.match_score === 'number' ? Math.round(record.match_score * 100) + '%' : 'غير محدد';
      return '<div class="trend-row"><span>' + record.year + '</span><strong>' + score + '</strong></div>';
    }).join('');
    controls.validationTrend.innerHTML = html;
  }

  function renderTraitOptions() {
    availableTraits = {
      general: [],
      weather: [],
      marine: [],
      fish: [],
      fish_season: [],
      heritage: [],
      seasonal_transition_traits: [],
      advice: []
    };

    traitDictionaries.forEach(function (item) {
      if (!item || item.is_active === false) return;
      var categoryMap = {
        heritage_signs: 'heritage',
        seasonal_transition_traits: 'seasonal_transition_traits',
        weather: 'weather',
        marine: 'marine',
        general: 'general',
        fish: 'fish'
      };
      var group = categoryMap[item.category] || item.category || 'general';
      var tag = normalizeTagObject({
        id: item.id,
        label: item.name_ar || item.name_en || item.id,
        name_ar: item.name_ar,
        name_en: item.name_en
      });
      if (!availableTraits[group]) {
        availableTraits[group] = [];
      }
      availableTraits[group].push(tag);
    });

    fishSeasonTags.forEach(function (item) {
      if (!item || item.is_active === false) return;
      var tag = normalizeTagObject({
        id: item.id,
        label: item.name_ar || item.name_en || item.id,
        name_ar: item.name_ar,
        name_en: item.name_en
      });
      availableTraits.fish_season.push(tag);
    });

    adviceBasisTags.forEach(function (item) {
      if (!item || item.is_active === false) return;
      var tag = normalizeTagObject({
        id: item.id,
        label: item.name_ar || item.name_en || item.id,
        name_ar: item.name_ar,
        name_en: item.name_en
      });
      availableTraits.advice.push(tag);
    });

    Object.keys(availableTraits).forEach(function (group) {
      var seen = {};
      availableTraits[group] = (Array.isArray(availableTraits[group]) ? availableTraits[group] : []).map(function (item) {
        var tag = normalizeTagObject(item);
        var key = normalizeString(tag.id || tag.label);
        if (!key || seen[key]) return null;
        seen[key] = true;
        return tag;
      }).filter(Boolean);
    });
  }

  function buildCalibrationPayload(station, calibration) {
    var dur = getDurById(calibration.durId);
    return {
      id: calibration.savedProfileId || calibration.id || undefined,
      station_id: getStationId(station),
      station_role_type: station.role_type || getStationRoleType(station),
      reference_station_id: (getNearestPrimaryForStation(station) || {}).station ? getStationId(getNearestPrimaryForStation(station).station) : '',
      dur_id: calibration.durId || '',
      dur_number: dur ? parseNumber(dur.dur_number, 0) : 0,
      dur_start_month: calibration.startMonth || 1,
      dur_start_day: calibration.startDay || 1,
      dur_days_count: calibration.daysCount || 0,
      traits_general: Array.isArray(calibration.traits.general) ? calibration.traits.general.slice() : [],
      traits_weather: Array.isArray(calibration.traits.weather) ? calibration.traits.weather.slice() : [],
      traits_marine: Array.isArray(calibration.traits.marine) ? calibration.traits.marine.slice() : [],
      traits_fish: Array.isArray(calibration.traits.fish) ? calibration.traits.fish.slice() : [],
      traits_fish_season: Array.isArray(calibration.traits.fish_season) ? calibration.traits.fish_season.slice() : [],
      traits_heritage: Array.isArray(calibration.traits.heritage) ? calibration.traits.heritage.slice() : [],
      traits_seasonal_transition_traits: Array.isArray(calibration.traits.seasonal_transition_traits) ? calibration.traits.seasonal_transition_traits.slice() : [],
      advice_tags: Array.isArray(calibration.traits.advice) ? calibration.traits.advice.slice() : [],
      notes_local: calibration.notes.local || '',
      notes_expert: calibration.notes.expert || '',
      notes_interpretation: calibration.notes.interpretation || '',
      notes_correction: calibration.notes.correction || '',
      local_definition: calibration.local_definition || '',
      expert_summary: calibration.expert_summary || '',
      is_active: calibration.is_active != null ? !!calibration.is_active : true,
      updated_by: getAuthUser().username || getAuthUser().id || 'naviduror'
    };
  }

  function chooseLatestCalibration(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    })[0] || null;
  }

  function applyCalibrationRecord(station, record) {
    var id = getStationId(station);
    var calibration = buildDefaultCalibration(station);
    if (record) {
      calibration.savedProfileId = record.id;
      calibration.local_definition = record.local_definition || record.local_definition || '';
      calibration.expert_summary = record.expert_summary || record.expert_summary || '';
      calibration.durId = record.dur_id || calibration.durId;
      calibration.startMonth = parseNumber(record.dur_start_month, calibration.startMonth);
      calibration.startDay = parseNumber(record.dur_start_day, calibration.startDay);
      calibration.daysCount = parseNumber(record.dur_days_count, calibration.daysCount);
      calibration.traits.general = Array.isArray(record.traits_general) ? record.traits_general.slice() : calibration.traits.general;
      calibration.traits.weather = Array.isArray(record.traits_weather) ? record.traits_weather.slice() : calibration.traits.weather;
      calibration.traits.marine = Array.isArray(record.traits_marine) ? record.traits_marine.slice() : calibration.traits.marine;
      calibration.traits.fish = Array.isArray(record.traits_fish) ? record.traits_fish.slice() : calibration.traits.fish;
      calibration.traits.fish_season = Array.isArray(record.traits_fish_season) ? record.traits_fish_season.slice() : calibration.traits.fish_season;
      calibration.traits.heritage = Array.isArray(record.traits_heritage) ? record.traits_heritage.slice() : calibration.traits.heritage;
      calibration.traits.seasonal_transition_traits = Array.isArray(record.traits_seasonal_transition_traits) ? record.traits_seasonal_transition_traits.slice() : calibration.traits.seasonal_transition_traits;
      calibration.traits.advice = Array.isArray(record.advice_tags) ? record.advice_tags.slice() : calibration.traits.advice;
      calibration.notes.local = record.notes_local || calibration.notes.local;
      calibration.notes.expert = record.notes_expert || calibration.notes.expert;
      calibration.notes.interpretation = record.notes_interpretation || calibration.notes.interpretation;
      calibration.notes.correction = record.notes_correction || calibration.notes.correction;
      calibration.is_active = record.is_active != null ? !!record.is_active : true;
      calibration.updated_at = record.updated_at || null;
      calibration.updated_by = record.updated_by || null;
    }
    calibrationStore[id] = calibration;
    calibrationStore[id].loadedFromServer = !!record;
    return calibration;
  }

  function loadStationCalibration(station) {
    if (!station) return Promise.resolve(null);
    var stationId = getStationId(station);
    if (!stationId) return Promise.resolve(null);
    var current = calibrationStore[stationId];
    if (current && current.loadedFromServer) return Promise.resolve(current);
    return apiFetch('/api/admin/station-dur-profiles?station_id=' + encodeURIComponent(stationId), { method: 'GET' })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        var record = chooseLatestCalibration(items);
        return applyCalibrationRecord(station, record);
      }).catch(function (error) {
        console.warn('[naviduror] failed to load calibration', error);
        return applyCalibrationRecord(station, null);
      });
  }

  function saveCalibrationRecord(station, calibration) {
    var stationId = getStationId(station);
    var payload = buildCalibrationPayload(station, calibration);
    var makePut = function (record) {
      return apiFetch('/api/admin/station-dur-profiles/' + encodeURIComponent(record.id), { method: 'PUT', body: payload });
    };
    var makePost = function () {
      return apiFetch('/api/admin/station-dur-profiles', { method: 'POST', body: payload });
    };
    if (calibration.savedProfileId) {
      return makePut({ id: calibration.savedProfileId });
    }
    return apiFetch('/api/admin/station-dur-profiles?station_id=' + encodeURIComponent(stationId) + '&dur_id=' + encodeURIComponent(payload.dur_id), { method: 'GET' })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        var existing = chooseLatestCalibration(items);
        if (existing) {
          return makePut(existing);
        }
        return makePost();
      });
  }

  function saveCurrentStationCalibration() {
    if (!selectedStation) return;
    setCalibrationStatus('جارٍ حفظ معايرة المحطة...', '');
    var calibration = getStationCalibration(selectedStation);
    if (!calibration) {
      setCalibrationStatus('تعذر الحصول على بيانات المعايرة الحالية.', 'error');
      return;
    }
    saveCalibrationRecord(selectedStation, calibration)
      .then(function (response) {
        if (response && response.item) {
          var saved = response.item;
          calibration.savedProfileId = saved.id;
          calibration.updated_at = saved.updated_at || calibration.updated_at;
          calibration.updated_by = saved.updated_by || calibration.updated_by;
          calibrationStore[getStationId(selectedStation)] = calibration;
          setCalibrationStatus('تم حفظ معايرة المحطة بنجاح.', 'success');
        } else if (response && response.ok && response.item) {
          var savedItem = response.item;
          calibration.savedProfileId = savedItem.id;
          calibration.updated_at = savedItem.updated_at || calibration.updated_at;
          calibration.updated_by = savedItem.updated_by || calibration.updated_by;
          calibrationStore[getStationId(selectedStation)] = calibration;
          setCalibrationStatus('تم حفظ معايرة المحطة بنجاح.', 'success');
        } else {
          setCalibrationStatus('تم حفظ معايرة المحطة بنجاح.', 'success');
        }
        renderCalibrationSummary();
        renderValidationPanel();
      })
      .catch(function (error) {
        console.error('[naviduror] save calibration failed', error);
        setCalibrationStatus('فشل حفظ معايرة المحطة. تحقق من الاتصال أو الصلاحيات.', 'error');
      });
  }

  function resetCalibrationForm() {
    if (!selectedStation) return;
    calibrationStore[getStationId(selectedStation)] = buildDefaultCalibration(selectedStation);
    renderSelectedStationCards();
    if (controls.calibStatus) setCalibrationStatus('تم إعادة ضبط المعايرة على القيم الافتراضية.', 'success');
  }

  function bindEvents() {
    if (controls.logoutBtn) {
      controls.logoutBtn.addEventListener('click', function () {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        redirectToLogin();
      });
    }
    [controls.stationSearch, controls.stationTypeFilter, controls.durFilter, controls.seasonEventFilter, controls.yearFilter].forEach(function (control) {
      if (!control) return;
      var eventName = control.tagName === 'INPUT' ? 'input' : 'change';
      control.addEventListener(eventName, function () {
        renderStationMarkers();
        if (control === controls.yearFilter) renderValidationPanel();
      });
    });
    if (controls.recalculateBtn) {
      controls.recalculateBtn.addEventListener('click', function () {
        renderStationMarkers();
        renderDistributionPreview();
        renderValidationPanel();
      });
    }
    if (controls.calibDurSelect) {
      controls.calibDurSelect.addEventListener('change', function () {
        var calibration = selectedStation ? getStationCalibration(selectedStation) : null;
        if (!calibration) return;
        var dur = getDurById(controls.calibDurSelect.value);
        if (dur) {
          calibration.startMonth = parseNumber(dur.gregorian_start_month, calibration.startMonth);
          calibration.startDay = parseNumber(dur.gregorian_start_day, calibration.startDay);
          calibration.daysCount = parseNumber(dur.default_days_count, calibration.daysCount);
          calibrationStore[getStationId(selectedStation)] = calibration;
          if (controls.calibDaysCount) {
            controls.calibDaysCount.value = calibration.daysCount;
          }
          renderCalibrationSummary();
          renderTraitGroups();
        }
      });
    }
    if (controls.calibSaveBtn) {
      controls.calibSaveBtn.addEventListener('click', function () {
        persistExpertNotes();
        persistCalibrationForm();
        saveCurrentStationCalibration();
      });
    }
    if (controls.calibResetBtn) {
      controls.calibResetBtn.addEventListener('click', resetCalibrationForm);
    }
    if (controls.stationFormSaveBtn) {
      controls.stationFormSaveBtn.addEventListener('click', function (event) {
        event.preventDefault();
        saveStationForm().catch(function () {});
      });
    }
    if (controls.stationFormCancelBtn) {
      controls.stationFormCancelBtn.addEventListener('click', function (event) {
        event.preventDefault();
        hideStationForm();
      });
    }
    document.querySelectorAll('[data-action="addTrait"]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        var group = event.target.dataset.group;
        if (group) addTraitFromInput(group);
      });
    });
    ['expertLocalNotes', 'expertSummaryNotes', 'expertInterpretation', 'expertCorrectionNotes'].forEach(function (id) {
      var field = getEl(id);
      if (field) {
        field.addEventListener('blur', persistExpertNotes);
      }
    });
    window.addEventListener('resize', resizeMap);
  }

  function buildDefaultStationRoles() {
    stations.forEach(function (station) {
      station.role_type = getStationRoleType(station);
    });
    assignStationRoles();
  }

  function initApp() {
    if (!isAuthenticated()) {
      redirectToLogin();
      return;
    }
    updateAuthUi();
    createMap();
    bindEvents();
    Promise.all([
      apiFetch('/api/stations', { method: 'GET' }).catch(function () { return safeFetchJson('/data/stations.json'); }),
      apiFetch('/api/admin/durur-master', { method: 'GET' }).catch(function () { return safeFetchJson('/data/durur_master.json'); }),
      apiFetch('/api/admin/season-events', { method: 'GET' }).catch(function () { return safeFetchJson('/data/season_events.json'); }),
      apiFetch('/api/admin/station-dur-profiles', { method: 'GET' }).catch(function () { return safeFetchJson('/data/station_dur_profiles.json'); }),
      apiFetch('/api/admin/station-dur-overrides', { method: 'GET' }).catch(function () { return safeFetchJson('/data/station_dur_overrides.json'); }),
      apiFetch('/api/admin/annual-comparisons', { method: 'GET' }).catch(function () { return safeFetchJson('/data/annual_comparisons.json'); }),
      apiFetch('/api/admin/trait-dictionaries', { method: 'GET' }).catch(function () { return safeFetchJson('/data/trait_dictionaries.json'); }),
      apiFetch('/api/admin/fish-season-tags', { method: 'GET' }).catch(function () { return safeFetchJson('/data/fish_season_tags.json'); }),
      apiFetch('/api/admin/advice-basis-tags', { method: 'GET' }).catch(function () { return safeFetchJson('/data/advice_basis_tags.json'); })
    ]).then(function (results) {
      var stationData = results[0];
      stations = Array.isArray(stationData.stations) ? stationData.stations : (Array.isArray(stationData) ? stationData : []);
      var dururData = results[1];
      dururCache = Array.isArray(dururData.items) ? dururData.items : (Array.isArray(dururData) ? dururData : []);
      var eventData = results[2];
      seasonEventsCache = Array.isArray(eventData.items) ? eventData.items : (Array.isArray(eventData) ? eventData : []);
      var profileData = results[3];
      stationProfilesCache = Array.isArray(profileData.items) ? profileData.items : (Array.isArray(profileData) ? profileData : []);
      var overrideData = results[4];
      stationOverridesCache = Array.isArray(overrideData.items) ? overrideData.items : (Array.isArray(overrideData) ? overrideData : []);
      var comparisonData = results[5];
      comparisonsCache = Array.isArray(comparisonData.items) ? comparisonData.items : (Array.isArray(comparisonData) ? comparisonData : []);
      var traitData = results[6];
      traitDictionaries = Array.isArray(traitData.items) ? traitData.items : (Array.isArray(traitData) ? traitData : []);
      var fishTagData = results[7];
      fishSeasonTags = Array.isArray(fishTagData.items) ? fishTagData.items : (Array.isArray(fishTagData) ? fishTagData : []);
      var adviceData = results[8];
      adviceBasisTags = Array.isArray(adviceData.items) ? adviceData.items : (Array.isArray(adviceData) ? adviceData : []);
      buildDefaultStationRoles();
      renderFilters();
      renderTraitOptions();
      renderStationMarkers();
      renderSelectedStationCards();
      renderValidationPanel();
    }).catch(function (error) {
      console.error('[naviduror] initialization failed', error);
    });
  }

  initApp();
})();

