(function () {
  var API_ENDPOINT = '/api/admin-analytics';
  var SETTINGS_ENDPOINT = '/api/admin-settings';
  var STATIONS_ENDPOINT = '/api/admin/stations';
  var USERS_ENDPOINT = '/api/admin/users';
  var SUMMARY_ENDPOINT = '/api/admin/summary';
  var FEEDBACK_ENDPOINT = '/api/admin/feedback';
  var LOGIN_ENDPOINT = '/api/login';
  var LOGOUT_ENDPOINT = '/api/logout';

  var adminAuthenticated = false;
  var adminDataFilter = 'all';
  var refreshInFlight = false;
  var settingsInFlight = false;
  var latestSettings = null;
  var authToken = localStorage.getItem('navidur_admin_token') || '';
  var me = null;
  var stationsCache = [];
  var usersCache = [];
  var latestSummaryCache = null;
  var latestFeedbackCache = [];
  var stationsAdminMap = null;
  var stationAdminMarker = null;
  var stationReverseRequestId = 0;
  var waterCheckState = { isWater: null, lat: null, lon: null, checking: false };
  var _waterCheckTimer = null;

  function getEl(id) {
    return document.getElementById(id);
  }

  function dateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function apiFetch(url, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    return fetch(url, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: opts.body
    });
  }

  function setAdminDataFilter(filter) {
    adminDataFilter = filter || 'all';
    document.querySelectorAll('.admin-block').forEach(function (block) {
      var section = block.getAttribute('data-section');
      block.style.display = adminDataFilter === 'all' || adminDataFilter === section ? '' : 'none';
    });
    document.querySelectorAll('.admin-nav').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === adminDataFilter);
    });
    if (adminDataFilter === 'all' || adminDataFilter === 'stations') {
      window.setTimeout(function () {
        if (stationsAdminMap && typeof stationsAdminMap.invalidateSize === 'function') {
          stationsAdminMap.invalidateSize();
        }
      }, 120);
    }
  }

  function renderTopTable(bodyId, items) {
    var body = getEl(bodyId);
    if (!body) return;
    body.innerHTML = '';
    if (!items || !items.length) {
      body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#8ea4ba">لا توجد بيانات بعد</td></tr>';
      return;
    }
    items.forEach(function (item, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td><td><strong>' + item.station + '</strong></td><td>' + item.total + '</td><td>' + (item.accuracy != null ? (item.accuracy + '%') : '--') + '</td>';
      body.appendChild(tr);
    });
  }

  function renderKeyValueRows(bodyId, rows, emptyMessage, colSpan) {
    var body = getEl(bodyId);
    if (!body) return;
    body.innerHTML = '';
    if (!rows || !rows.length) {
      body.innerHTML = '<tr><td colspan="' + String(colSpan || 3) + '" style="text-align:center;color:#8ea4ba">' + (emptyMessage || 'لا توجد بيانات بعد') + '</td></tr>';
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML = row;
      body.appendChild(tr);
    });
  }

  function renderVisitChart(history) {
    var canvas = getEl('aVisitChart');
    if (!canvas) return;

    var days = {};
    var now = new Date();
    for (var i = 13; i >= 0; i--) {
      var d = new Date(now.getTime());
      d.setDate(now.getDate() - i);
      days[dateKey(d)] = 0;
    }

    (history || []).forEach(function (row) {
      if (Object.prototype.hasOwnProperty.call(days, row.date)) {
        days[row.date] += Number(row.count || 0);
      }
    });

    var labels = Object.keys(days).map(function (k) { return k.slice(5); });
    var values = Object.keys(days).map(function (k) { return days[k]; });

    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'زيارات',
          data: values,
          backgroundColor: 'rgba(14,165,233,.5)',
          borderColor: '#0ea5e9',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#c7d5e4' } },
          x: { grid: { display: false }, ticks: { color: '#c7d5e4', maxRotation: 45, font: { size: 9 } } }
        }
      }
    });
  }

  function updateFieldTestingChecklist(summary, feedbackList) {
    var list = Array.isArray(feedbackList) ? feedbackList : [];
    var yesByMember = list.some(function (row) {
      var uid = String((row && row.user_id) || '');
      var ans = String((row && row.answer) || '').toUpperCase();
      return ans === 'YES' && (uid.indexOf('usr_field_member_') === 0 || uid.indexOf('field_member') !== -1);
    });
    var noByMember = list.some(function (row) {
      var uid = String((row && row.user_id) || '');
      var ans = String((row && row.answer) || '').toUpperCase();
      return ans === 'NO' && (uid.indexOf('usr_field_member_') === 0 || uid.indexOf('field_member') !== -1);
    });
    var stationTested = list.some(function (row) {
      return String((row && row.station) || '').trim().length > 0;
    });
    var sum = summary && typeof summary === 'object' ? summary : null;
    var summaryUpdated = !!(sum && ((Number(sum.total_yes || 0) + Number(sum.total_no || 0)) > 0));

    var yesEl = getEl('ftCheckYes');
    var noEl = getEl('ftCheckNo');
    var stationEl = getEl('ftCheckStation');
    var summaryEl = getEl('ftCheckSummary');
    if (yesEl) yesEl.checked = yesByMember;
    if (noEl) noEl.checked = noByMember;
    if (stationEl) stationEl.checked = stationTested;
    if (summaryEl) summaryEl.checked = summaryUpdated;

    var readyCount = [yesByMember, noByMember, stationTested, summaryUpdated].filter(Boolean).length;
    var noteEl = getEl('fieldChecklistStatus');
    if (noteEl) {
      noteEl.textContent = readyCount === 4
        ? 'جاهز للتشغيل الميداني: جميع عناصر checklist مكتملة.'
        : 'الحالة الحالية: ' + readyCount + '/4 مكتملة.';
    }
  }

  async function fetchStats() {
    var res = await apiFetch(API_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('analytics fetch failed');
    return res.json();
  }

  async function fetchSummary() {
    var res = await apiFetch(SUMMARY_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('summary fetch failed');
    return res.json();
  }

  function queryFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function getTextField(selectors, fallback) {
    var el = queryFirst(selectors);
    if (!el) return fallback;
    return (el.value || '').trim();
  }

  function getCheckboxField(selectors, fallback) {
    var el = queryFirst(selectors);
    if (!el) return fallback;
    return !!el.checked;
  }

  function setTextField(selectors, value) {
    var el = queryFirst(selectors);
    if (!el) return;
    el.value = value == null ? '' : String(value);
  }

  function setCheckboxField(selectors, value) {
    var el = queryFirst(selectors);
    if (!el) return;
    el.checked = !!value;
  }

  function parseJsonText(text, fallback) {
    if (!text || !String(text).trim()) return fallback;
    try {
      return JSON.parse(text);
    } catch (e) {
      return fallback;
    }
  }

  function normalizeSettingsPayload(input) {
    var src = input && typeof input === 'object' ? input : {};
    var ads = src.ads && typeof src.ads === 'object' ? src.ads : {};
    var adBanner = ads.adBanner && typeof ads.adBanner === 'object' ? ads.adBanner : (src.adBanner || {});
    var features = src.features && typeof src.features === 'object' ? src.features : {};
    var fishData = src.fishData && typeof src.fishData === 'object' ? src.fishData : (src.fish || {});

    var headerColor = String(src.headerColor || '#27b3ff').trim();
    if (!/^#[0-9a-fA-F]{3,6}$/.test(headerColor)) headerColor = '#27b3ff';
    var hijriOffset = typeof src.hijriOffset === 'number' ? src.hijriOffset : parseInt(src.hijriOffset, 10);
    if (Number.isNaN(hijriOffset)) hijriOffset = -1;
    hijriOffset = Math.max(-5, Math.min(5, Math.round(hijriOffset)));

    var siteMode = String(src.site_mode || 'live').trim().toLowerCase();
    if (siteMode !== 'live' && siteMode !== 'maintenance' && siteMode !== 'private_beta') siteMode = 'live';

    var stationListMode = String(src.station_list_mode || 'grouped').trim().toLowerCase();
    if (stationListMode !== 'chips' && stationListMode !== 'classic' && stationListMode !== 'grouped') stationListMode = 'grouped';

    var locationMode = String(src.location_mode || 'ask').trim().toLowerCase();
    if (locationMode !== 'off' && locationMode !== 'ask' && locationMode !== 'auto') locationMode = 'ask';

    return {
      site_mode: siteMode,
      maintenance_message: String(src.maintenance_message || '').trim().slice(0, 500),
      allow_admin_bypass: !!src.allow_admin_bypass,
      station_list_mode: stationListMode,
      location_mode: locationMode,
      sort_stations_by_distance: !!src.sort_stations_by_distance,
      headerText: String(src.headerText || '').trim().slice(0, 120),
      headerColor: headerColor,
      hijriOffset: hijriOffset,
      footerName: String(src.footerName || '').trim().slice(0, 120),
      footerPhone: String(src.footerPhone || '').trim().slice(0, 60),
      footerEmail: String(src.footerEmail || '').trim().slice(0, 120),
      footerSponsor: String(src.footerSponsor || '').trim().slice(0, 160),
      footerSponsorLink: String(src.footerSponsorLink || '').trim(),
      ads: {
        adBanner: {
          enabled: !!adBanner.enabled,
          imageUrl: String(adBanner.imageUrl || '').trim(),
          linkUrl: String(adBanner.linkUrl || '').trim()
        }
      },
      features: {
        featurePrediction: features.featurePrediction !== false
      },
      fishData: {
        featured: Array.isArray(fishData.featured) ? fishData.featured : []
      }
    };
  }

  async function fetchSettings() {
    var res = await apiFetch(SETTINGS_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('settings fetch failed');
    var data = await res.json();
    return normalizeSettingsPayload(data.settings || data);
  }

  async function saveSettings(payload) {
    var res = await apiFetch(SETTINGS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: payload })
    });
    if (!res.ok) {
      var errText = '';
      try { errText = await res.text(); } catch (e) { errText = ''; }
      throw new Error('settings save failed: HTTP ' + res.status + (errText ? (' | ' + errText) : ''));
    }
    var data = await res.json();
    return normalizeSettingsPayload(data.settings || data);
  }

  function renderSettingsToForm(settings) {
    var s = normalizeSettingsPayload(settings || {});
    setTextField(['#siteModeInput'], s.site_mode || 'live');
    setTextField(['#stationListModeInput'], s.station_list_mode || 'grouped');
    setTextField(['#locationModeInput'], s.location_mode || 'ask');
    setTextField(['#maintenanceMessageInput'], s.maintenance_message || '');
    setCheckboxField(['#allowAdminBypassInput'], !!s.allow_admin_bypass);
    setCheckboxField(['#sortStationsByDistanceInput'], !!s.sort_stations_by_distance);
    setTextField(['#headerTextInput', '#headerText', 'input[name="headerText"]'], s.headerText);
    setTextField(['#headerColorInput', '#headerColor', 'input[name="headerColor"]'], s.headerColor);
    setTextField(['#hijriOffsetInput', 'input[name="hijriOffset"]'], s.hijriOffset);
    setTextField(['#footerNameInput', 'input[name="footerName"]'], s.footerName);
    setTextField(['#footerPhoneInput', 'input[name="footerPhone"]'], s.footerPhone);
    setTextField(['#footerEmailInput', 'input[name="footerEmail"]'], s.footerEmail);
    setTextField(['#footerSponsorInput', 'input[name="footerSponsor"]'], s.footerSponsor);
    setTextField(['#footerSponsorLinkInput', 'input[name="footerSponsorLink"]'], s.footerSponsorLink);
    setCheckboxField(['#adBannerEnabled', '#adEnabled', 'input[name="adBannerEnabled"]'], s.ads.adBanner.enabled);
    setTextField(['#adBannerImageInput', '#adBannerImage', '#adImageInput', '#adImage', 'input[name="adImage"]'], s.ads.adBanner.imageUrl);
    setTextField(['#adBannerLinkInput', '#adBannerLink', '#adLinkInput', '#adLink', 'input[name="adLink"]'], s.ads.adBanner.linkUrl);
    setCheckboxField(['#featurePredictionToggle', '#featurePrediction', 'input[name="featurePrediction"]'], s.features.featurePrediction);

    setTextField(
      ['#fishDataInput', '#fishData', 'textarea[name="fishData"]'],
      JSON.stringify(s.fishData, null, 2)
    );

    var adsJsonEl = queryFirst(['#adsJsonInput', '#adsJson', 'textarea[name="adsJson"]']);
    if (adsJsonEl) adsJsonEl.value = JSON.stringify(s.ads, null, 2);

    var featuresJsonEl = queryFirst(['#featuresJsonInput', '#featuresJson', 'textarea[name="featuresJson"]']);
    if (featuresJsonEl) featuresJsonEl.value = JSON.stringify(s.features, null, 2);
  }

  function collectSettingsFromForm() {
    var adsFromJson = parseJsonText(
      getTextField(['#adsJsonInput', '#adsJson', 'textarea[name="adsJson"]'], ''),
      null
    );
    var featuresFromJson = parseJsonText(
      getTextField(['#featuresJsonInput', '#featuresJson', 'textarea[name="featuresJson"]'], ''),
      null
    );
    var fishDataFromText = parseJsonText(
      getTextField(['#fishDataInput', '#fishData', 'textarea[name="fishData"]'], ''),
      { featured: [] }
    );

    var base = latestSettings || {};
    var hijriOffsetRaw = getTextField(['#hijriOffsetInput', 'input[name="hijriOffset"]'], String(base.hijriOffset == null ? -1 : base.hijriOffset));
    var hijriOffset = parseInt(hijriOffsetRaw, 10);
    if (Number.isNaN(hijriOffset)) hijriOffset = -1;

    var payload = {
      site_mode: getTextField(['#siteModeInput'], base.site_mode || 'live'),
      maintenance_message: getTextField(['#maintenanceMessageInput'], base.maintenance_message || ''),
      allow_admin_bypass: getCheckboxField(['#allowAdminBypassInput'], base.allow_admin_bypass !== false),
      station_list_mode: getTextField(['#stationListModeInput'], base.station_list_mode || 'grouped'),
      location_mode: getTextField(['#locationModeInput'], base.location_mode || 'ask'),
      sort_stations_by_distance: getCheckboxField(['#sortStationsByDistanceInput'], !!base.sort_stations_by_distance),
      headerText: getTextField(['#headerTextInput', '#headerText', 'input[name="headerText"]'], base.headerText || ''),
      headerColor: getTextField(['#headerColorInput', '#headerColor', 'input[name="headerColor"]'], base.headerColor || '#27b3ff'),
      hijriOffset: hijriOffset,
      footerName: getTextField(['#footerNameInput', 'input[name="footerName"]'], base.footerName || ''),
      footerPhone: getTextField(['#footerPhoneInput', 'input[name="footerPhone"]'], base.footerPhone || ''),
      footerEmail: getTextField(['#footerEmailInput', 'input[name="footerEmail"]'], base.footerEmail || ''),
      footerSponsor: getTextField(['#footerSponsorInput', 'input[name="footerSponsor"]'], base.footerSponsor || ''),
      footerSponsorLink: getTextField(['#footerSponsorLinkInput', 'input[name="footerSponsorLink"]'], base.footerSponsorLink || ''),
      ads: adsFromJson || {
        adBanner: {
          enabled: getCheckboxField(['#adBannerEnabled', '#adEnabled', 'input[name="adBannerEnabled"]'], false),
          imageUrl: getTextField(['#adBannerImageInput', '#adBannerImage', '#adImageInput', '#adImage', 'input[name="adImage"]'], ''),
          linkUrl: getTextField(['#adBannerLinkInput', '#adBannerLink', '#adLinkInput', '#adLink', 'input[name="adLink"]'], '')
        }
      },
      features: featuresFromJson || {
        featurePrediction: getCheckboxField(['#featurePredictionToggle', '#featurePrediction', 'input[name="featurePrediction"]'], true)
      },
      fishData: fishDataFromText
    };

    return normalizeSettingsPayload(payload);
  }

  function setSettingsBusy(isBusy) {
    settingsInFlight = !!isBusy;
    var saveBtn = queryFirst([
      '#saveSettingsBtn',
      '#adminSaveBtn',
      '[data-action="save-settings"]',
      '.save-settings-btn'
    ]);
    if (!saveBtn) return;
    saveBtn.disabled = settingsInFlight;
    saveBtn.style.opacity = settingsInFlight ? '0.65' : '1';
  }

  function showSettingsStatus(message, isError) {
    var statusEl = queryFirst(['#settingsStatus', '#adminSettingsStatus', '.settings-status']);
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.style.color = isError ? '#ff9b9b' : '#9ad9ff';
  }

  async function loadSettingsIntoAdmin() {
    try {
      setSettingsBusy(true);
      showSettingsStatus('جاري تحميل الإعدادات...', false);
      latestSettings = await fetchSettings();
      renderSettingsToForm(latestSettings);
      showSettingsStatus('تم تحميل الإعدادات من الخادم.', false);
    } catch (e) {
      showSettingsStatus('تعذر تحميل الإعدادات.', true);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function saveSettingsFromAdmin() {
    try {
      setSettingsBusy(true);
      showSettingsStatus('جاري حفظ الإعدادات...', false);
      var payload = collectSettingsFromForm();
      latestSettings = await saveSettings(payload);
      renderSettingsToForm(latestSettings);
      showSettingsStatus('تم حفظ الإعدادات بنجاح.', false);
    } catch (e) {
      console.error('[admin] saveSettingsFromAdmin failed:', e && e.message ? e.message : e);
      showSettingsStatus('فشل حفظ الإعدادات.', true);
    } finally {
      setSettingsBusy(false);
    }
  }

  function setRefreshBusy(isBusy) {
    refreshInFlight = !!isBusy;
    var btn = getEl('adminRefresh');
    if (!btn) return;
    btn.disabled = refreshInFlight;
    btn.style.opacity = refreshInFlight ? '0.65' : '1';
    btn.textContent = refreshInFlight ? 'جاري التحديث...' : 'تحديث';
  }

  async function renderSummarySection() {
    try {
      var s = await fetchSummary();
      latestSummaryCache = s;
      getEl('sumYes').textContent = String(s.total_yes || 0);
      getEl('sumNo').textContent = String(s.total_no || 0);
      getEl('sumAcc').textContent = String(s.accuracy || 0) + '%';
      getEl('sumScoreAcc').textContent = String(s.score_accuracy || 0) + '%';
      renderTopTable('summaryTopStationsBody', s.best_stations || []);
      renderKeyValueRows('selectionStationsBody', (s.station_selection_counts || []).map(function (x, i) {
        return '<td>' + (i + 1) + '</td><td><strong>' + (x.station_name || '--') + '</strong></td><td>' + Number(x.count || 0) + '</td>';
      }), 'لا توجد اختيارات مسجلة بعد', 3);
      renderKeyValueRows('selectionModeBody', (s.fishing_mode_distribution || []).map(function (x) {
        return '<td>' + (x.mode === 'deep' ? 'غزير' : 'ساحلي') + '</td><td>' + Number(x.count || 0) + '</td>';
      }), 'لا توجد بيانات', 2);
      renderKeyValueRows('selectionCountryBody', (s.country_usage || []).map(function (x) {
        return '<td>' + (x.country || '--') + '</td><td>' + Number(x.count || 0) + '</td>';
      }), 'لا توجد بيانات', 2);
      var insightsRows = [];
      (s.selection_insights && s.selection_insights.top_performing || []).forEach(function (x) {
        insightsRows.push('<td>Top</td><td>' + (x.station_name || '--') + '</td><td>' + Number(x.count || 0) + '</td>');
      });
      (s.selection_insights && s.selection_insights.low_usage || []).forEach(function (x) {
        insightsRows.push('<td>Low</td><td>' + (x.station_name || '--') + '</td><td>' + Number(x.count || 0) + '</td>');
      });
      renderKeyValueRows('selectionInsightsBody', insightsRows, 'لا توجد بيانات كافية لاستخراج insights', 3);
      updateFieldTestingChecklist(latestSummaryCache, latestFeedbackCache);
    } catch (_e) {
      latestSummaryCache = { total_yes: 0, total_no: 0 };
      getEl('sumYes').textContent = '0';
      getEl('sumNo').textContent = '0';
      getEl('sumAcc').textContent = '0%';
      getEl('sumScoreAcc').textContent = '0%';
      renderTopTable('summaryTopStationsBody', []);
      renderKeyValueRows('selectionStationsBody', [], 'لا توجد اختيارات مسجلة بعد', 3);
      renderKeyValueRows('selectionModeBody', [], 'لا توجد بيانات', 2);
      renderKeyValueRows('selectionCountryBody', [], 'لا توجد بيانات', 2);
      renderKeyValueRows('selectionInsightsBody', [], 'لا توجد بيانات كافية لاستخراج insights', 3);
      updateFieldTestingChecklist(latestSummaryCache, latestFeedbackCache);
    }
  }

  async function renderAdminDashboard() {
    var data;
    setRefreshBusy(true);

    try {
      data = await fetchStats();
    } catch (e) {
      data = { visits: { today: 0, week: 0, total: 0, history: [] } };
    } finally {
      setRefreshBusy(false);
    }

    renderVisitChart(data.visits.history || []);
    await Promise.all([
      renderSummarySection(),
      loadStations(),
      loadUsers(),
      loadFeedback()
    ]);
  }

  function stationStatusBadge(status) {
    if (status === 'active') return '<span class="badge ok">active</span>';
    if (status === 'archived') return '<span class="badge off">archived</span>';
    return '<span class="badge off">disabled</span>';
  }

  function splitCsv(text) {
    return String(text || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function getFishingModeLabel(mode) {
    return mode === 'deep' ? 'غزير' : 'ساحلي';
  }

  function updateStationCoordPreview(lat, lon) {
    var preview = getEl('stCoordPreview');
    if (!preview) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      preview.textContent = 'الإحداثيات الحالية: -- , --';
      return;
    }
    preview.textContent = 'الإحداثيات الحالية: ' + lat.toFixed(6) + ' , ' + lon.toFixed(6);
  }

  function setStationPlaceSuggestion(text) {
    var el = getEl('stPlaceSuggestion');
    if (!el) return;
    el.textContent = text || 'الموقع المختار: --';
  }

  function formatMarinePlaceSuggestion(address) {
    var addr = address && typeof address === 'object' ? address : {};
    var country = String(addr.country || '').trim();
    var locality = String(
      addr.city || addr.town || addr.municipality || addr.state_district || addr.county || addr.state || ''
    ).trim();
    if (locality && country) return 'نقطة بحرية قرب ' + locality + '، ' + country;
    if (country) return 'موقع بحري داخل المياه ' + country;
    if (locality) return 'مياه ' + locality;
    return 'موقع بحري داخل المياه الإقليمية';
  }

  // ── Water placement validation ──────────────────────────────────────────────

  function setWaterStatus(state, msg) {
    var el = getEl('stWaterStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'st-water-status st-water-' + (state || 'unknown');
    el.style.display = msg ? '' : 'none';
  }

  async function callOverpass(query, timeoutMs) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000);
    try {
      var url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);
      var res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(tid);
      if (!res.ok) throw new Error('overpass_http_' + res.status);
      return await res.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  }

  function classifyIsInElements(elements) {
    var WATER_NATURAL = ['sea', 'bay', 'water', 'strait', 'ocean'];
    var LAND_LANDUSE = ['residential', 'commercial', 'industrial', 'retail', 'construction', 'farmland', 'farmyard', 'allotments'];
    var LAND_PLACE = ['city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter'];
    var LAND_HIGHWAY = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'footway', 'path', 'cycleway', 'living_street'];
    var waterScore = 0, landScore = 0;
    (elements || []).forEach(function (el) {
      var tags = el.tags || {};
      if (WATER_NATURAL.indexOf(tags.natural) !== -1) waterScore += 3;
      if (tags.place === 'sea' || tags.place === 'ocean') waterScore += 3;
      if (tags.waterway && tags.waterway !== 'riverbank') waterScore += 2;
      if (LAND_LANDUSE.indexOf(tags.landuse) !== -1) landScore += 3;
      if (LAND_PLACE.indexOf(tags.place) !== -1) landScore += 2;
      if (tags.building) landScore += 4;
      if (LAND_HIGHWAY.indexOf(tags.highway) !== -1) landScore += 2;
    });
    return { waterScore: waterScore, landScore: landScore };
  }

  // Offset a lat/lon point by `meters` in direction (normLat, normLon)
  function offsetLatLon(lat, lon, normLat, normLon, meters) {
    var EARTH_R = 6371000;
    var mag = Math.sqrt(normLat * normLat + normLon * normLon);
    if (mag < 1e-9) return null;
    var uLat = normLat / mag;
    var uLon = normLon / mag;
    var latOffset = (meters * uLat) / EARTH_R * (180 / Math.PI);
    var lonOffset = (meters * uLon) / (EARTH_R * Math.cos(lat * Math.PI / 180)) * (180 / Math.PI);
    return { lat: lat + latOffset, lon: lon + lonOffset };
  }

  // In OSM, natural=coastline runs CCW around land: land=LEFT, sea=RIGHT.
  // The right-hand normal in (lon=x, lat=y) space: rotate CW → normLat=-dLon, normLon=dLat
  function computeSeaOffsetFromCoastline(lat, lon, coastlineWays) {
    var nearestDist = Infinity;
    var nearestSegment = null;
    coastlineWays.forEach(function (way) {
      var nodes = way.geometry || [];
      for (var i = 0; i < nodes.length - 1; i++) {
        var midLat = (nodes[i].lat + nodes[i + 1].lat) / 2;
        var midLon = (nodes[i].lon + nodes[i + 1].lon) / 2;
        var cosLat = Math.cos(lat * Math.PI / 180);
        var dist = Math.sqrt(Math.pow(midLat - lat, 2) + Math.pow((midLon - lon) * cosLat, 2));
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSegment = [nodes[i], nodes[i + 1]];
        }
      }
    });
    if (!nearestSegment) return null;
    var dLat = nearestSegment[1].lat - nearestSegment[0].lat;
    var dLon = nearestSegment[1].lon - nearestSegment[0].lon;
    // right-hand normal → sea side: normLat = -dLon, normLon = dLat
    return offsetLatLon(lat, lon, -dLon, dLat, 50);
  }

  async function detectAndAutoOffsetWater(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    waterCheckState.checking = true;
    waterCheckState.lat = lat;
    waterCheckState.lon = lon;
    waterCheckState.isWater = null;
    setWaterStatus('checking', '⏳ جاري فحص الموقع...');
    try {
      // Single Overpass call: is_in + nearby coastline ways (for offset geometry)
      var query = '[out:json][timeout:9];(' +
        'is_in(' + lat.toFixed(6) + ',' + lon.toFixed(6) + ');' +
        'way[natural=coastline](around:250,' + lat.toFixed(6) + ',' + lon.toFixed(6) + ');' +
        ');out geom;';
      var data = await callOverpass(query, 11000);
      var elements = data.elements || [];
      var isInEls = elements.filter(function (el) {
        return !(el.type === 'way' && el.tags && el.tags.natural === 'coastline');
      });
      var coastlineWays = elements.filter(function (el) {
        return el.type === 'way' && el.tags && el.tags.natural === 'coastline';
      });
      var scores = classifyIsInElements(isInEls);
      var isLand = scores.landScore > scores.waterScore;
      if (!isLand) {
        waterCheckState.isWater = true;
        waterCheckState.checking = false;
        setWaterStatus('water', '🌊 في الماء — الموضع صحيح');
        reverseGeocodeStation(lat, lon);
        return;
      }
      // On land — attempt auto coastal offset toward sea
      if (coastlineWays.length > 0) {
        var offsetPt = computeSeaOffsetFromCoastline(lat, lon, coastlineWays);
        if (offsetPt) {
          var verifyQuery = '[out:json][timeout:6];is_in(' +
            offsetPt.lat.toFixed(6) + ',' + offsetPt.lon.toFixed(6) + ');out tags;';
          try {
            var verifyData = await callOverpass(verifyQuery, 8000);
            var vs = classifyIsInElements(verifyData.elements || []);
            if (vs.landScore <= vs.waterScore) {
              // Offset point is in water — apply it silently
              waterCheckState.checking = false;
              applyStationPointFromMap(offsetPt.lat, offsetPt.lon, true, true, true);
              waterCheckState.isWater = true;
              waterCheckState.lat = offsetPt.lat;
              waterCheckState.lon = offsetPt.lon;
              setWaterStatus('water', '🌊 تم تعديل الموضع تلقائياً نحو البحر (±50م)');
              return;
            }
          } catch (_e) { /* verification fetch failed — fall through */ }
        }
      }
      // Still on land with no valid offset
      waterCheckState.isWater = false;
      waterCheckState.checking = false;
      setWaterStatus('land', '⛔ على اليابسة — يرجى وضع المحطة داخل البحر');
    } catch (e) {
      waterCheckState.checking = false;
      waterCheckState.isWater = null;
      var isTimeout = e && (e.name === 'AbortError' || String(e.message || '').indexOf('timeout') !== -1);
      setWaterStatus('unknown', isTimeout
        ? '⚠️ انتهت مهلة فحص الموقع — يمكنك الحفظ بحذر'
        : '⚠️ تعذر فحص الموقع — يمكنك الحفظ بحذر');
    }
  }

  function scheduleWaterCheck(lat, lon) {
    if (_waterCheckTimer) clearTimeout(_waterCheckTimer);
    waterCheckState.isWater = null;
    waterCheckState.checking = false;
    setWaterStatus('checking', '⏳ جاري فحص الموقع...');
    _waterCheckTimer = setTimeout(function () {
      _waterCheckTimer = null;
      detectAndAutoOffsetWater(lat, lon);
    }, 800);
  }

  // ── End water placement validation ─────────────────────────────────────────

  function setStationMarker(lat, lon, shouldCenter) {
    if (!stationsAdminMap || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!stationAdminMarker) {
      stationAdminMarker = L.marker([lat, lon], { draggable: true }).addTo(stationsAdminMap);
      stationAdminMarker.on('dragend', function () {
        var p = stationAdminMarker.getLatLng();
        applyStationPointFromMap(p.lat, p.lng, true, true);
      });
    } else {
      stationAdminMarker.setLatLng([lat, lon]);
    }
    if (shouldCenter) {
      stationsAdminMap.setView([lat, lon], Math.max(stationsAdminMap.getZoom(), 10));
    }
  }

  async function reverseGeocodeStation(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    stationReverseRequestId += 1;
    var currentRequestId = stationReverseRequestId;
    try {
      var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ar,en&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
      var res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return;
      var data = await res.json();
      if (currentRequestId !== stationReverseRequestId) return;

      var addr = data && data.address ? data.address : {};
      var suggestedRegion = addr.state || addr.region || addr.county || '';
      var suggestedCountry = addr.country || '';
      var regionValue = getEl('stRegion').value.trim();
      var isNewDraft = !getEl('stId').value.trim();

      if ((!regionValue || (isNewDraft && regionValue === 'gulf')) && suggestedRegion) getEl('stRegion').value = suggestedRegion;
      if (suggestedCountry) getEl('stCountry').value = suggestedCountry;

      var pointLooksMarine = waterCheckState && waterCheckState.isWater === true &&
        Math.abs(Number(waterCheckState.lat || 0) - Number(lat || 0)) < 1e-5 &&
        Math.abs(Number(waterCheckState.lon || 0) - Number(lon || 0)) < 1e-5;
      var placeText = pointLooksMarine
        ? formatMarinePlaceSuggestion(addr)
        : (data && data.display_name ? data.display_name : [suggestedRegion, suggestedCountry].filter(Boolean).join(' - '));
      setStationPlaceSuggestion('الموقع المختار: ' + (placeText || '--'));
    } catch (_e) {
      setStationPlaceSuggestion('الموقع المختار: تعذّر جلب العنوان التقديري، يمكنك إدخاله يدويًا.');
    }
  }

  function applyStationPointFromMap(lat, lon, shouldCenter, runReverse, skipWaterCheck) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      updateStationCoordPreview(NaN, NaN);
      return;
    }
    getEl('stLat').value = lat.toFixed(6);
    getEl('stLon').value = lon.toFixed(6);
    updateStationCoordPreview(lat, lon);
    setStationMarker(lat, lon, shouldCenter);
    if (runReverse) reverseGeocodeStation(lat, lon);
    if (!skipWaterCheck) scheduleWaterCheck(lat, lon);
  }

  function syncStationMapFromInputs(shouldCenter) {
    var lat = Number(getEl('stLat').value);
    var lon = Number(getEl('stLon').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      updateStationCoordPreview(NaN, NaN);
      return;
    }
    updateStationCoordPreview(lat, lon);
    setStationMarker(lat, lon, shouldCenter);
  }

  function initStationsAdminMap() {
    var mapEl = getEl('stationsAdminMap');
    if (!mapEl || typeof L === 'undefined') return;
    if (stationsAdminMap) return;

    stationsAdminMap = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView([25.2854, 51.5310], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(stationsAdminMap);

    stationsAdminMap.on('click', function (e) {
      applyStationPointFromMap(e.latlng.lat, e.latlng.lng, true, true);
    });

    getEl('stLat').addEventListener('input', function () { syncStationMapFromInputs(false); });
    getEl('stLon').addEventListener('input', function () { syncStationMapFromInputs(false); });

    updateStationCoordPreview(NaN, NaN);
    setStationPlaceSuggestion('الموقع المختار: --');
  }

  function readStationForm() {
    var active = !!getEl('stActive').checked;
    return {
      id: getEl('stId').value.trim() || undefined,
      name: getEl('stName').value.trim(),
      lat: Number(getEl('stLat').value),
      lon: Number(getEl('stLon').value),
      country: getEl('stCountry').value.trim(),
      region: getEl('stRegion').value.trim() || 'gulf',
      fishing_mode: getEl('stFishingMode').value === 'deep' ? 'deep' : 'coastal',
      status: active ? 'active' : 'disabled',
      sort_order: Number(getEl('stSort').value || 0),
      default_radius: Number(getEl('stRadius').value || 0.02),
      notes: getEl('stNotes').value.trim(),
      assigned_members: splitCsv(getEl('stMembers').value)
    };
  }

  function fillStationForm(st) {
    getEl('stId').value = st.id || '';
    getEl('stName').value = st.name || '';
    getEl('stLat').value = st.lat != null ? st.lat : '';
    getEl('stLon').value = st.lon != null ? st.lon : '';
    getEl('stCountry').value = st.country || '';
    getEl('stRegion').value = st.region || 'gulf';
    getEl('stFishingMode').value = st.fishing_mode === 'deep' ? 'deep' : 'coastal';
    getEl('stActive').checked = st.status !== 'disabled' && st.status !== 'archived';
    getEl('stSort').value = st.sort_order != null ? st.sort_order : 1;
    getEl('stRadius').value = st.default_radius != null ? st.default_radius : 0.02;
    getEl('stNotes').value = st.notes || '';
    getEl('stMembers').value = Array.isArray(st.assigned_members) ? st.assigned_members.join(',') : '';
    syncStationMapFromInputs(true);
    if (st.lat != null && st.lon != null) {
      reverseGeocodeStation(Number(st.lat), Number(st.lon));
    } else {
      setStationPlaceSuggestion('الموقع المختار: --');
    }
  }

  function clearStationForm() {
    fillStationForm({ id: '', name: '', lat: '', lon: '', country: '', region: 'gulf', fishing_mode: 'coastal', status: 'active', sort_order: 1, default_radius: 0.02, notes: '', assigned_members: [] });
    if (stationAdminMarker && stationsAdminMap) {
      stationsAdminMap.removeLayer(stationAdminMarker);
      stationAdminMarker = null;
    }
    updateStationCoordPreview(NaN, NaN);
    setStationPlaceSuggestion('الموقع المختار: --');
    waterCheckState.isWater = null;
    waterCheckState.lat = null;
    waterCheckState.lon = null;
    waterCheckState.checking = false;
    if (_waterCheckTimer) { clearTimeout(_waterCheckTimer); _waterCheckTimer = null; }
    setWaterStatus('unknown', '');
  }

  async function loadStations() {
    var res = await apiFetch(STATIONS_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('stations_load_failed');
    var data = await res.json();
    stationsCache = Array.isArray(data.stations) ? data.stations : [];

    var body = getEl('stationsBody');
    body.innerHTML = '';
    stationsCache.forEach(function (st, idx) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
        '<td><strong>' + st.name + '</strong><br><span style="font-size:12px;color:#8ea4ba">' + st.id + '</span></td>' +
        '<td>' + stationStatusBadge(st.status) + '</td>' +
        '<td>' + (st.country || '--') + '</td>' +
        '<td>' + getFishingModeLabel(st.fishing_mode) + '</td>' +
        '<td>' + (st.default_radius != null ? st.default_radius : '--') + '</td>' +
        '<td>' +
          '<div class="inline-actions">' +
            '<button class="small-btn" data-action="edit" data-id="' + st.id + '">تعديل</button>' +
            '<button class="small-btn warn" data-action="toggle" data-id="' + st.id + '">' + (st.status === 'disabled' ? 'تفعيل' : 'تعطيل') + '</button>' +
            '<button class="small-btn danger" data-action="archive" data-id="' + st.id + '">Archive</button>' +
          '</div>' +
        '</td>';
      body.appendChild(tr);
    });

    body.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        var station = stationsCache.find(function (s) { return s.id === id; });
        if (!station) return;

        if (action === 'edit') {
          fillStationForm(station);
          return;
        }

        if (action === 'toggle') {
          var nextStatus = station.status === 'disabled' ? 'active' : 'disabled';
          await apiFetch('/api/admin/stations/' + encodeURIComponent(id) + '/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus })
          });
          await loadStations();
          return;
        }

        if (action === 'archive') {
          await apiFetch('/api/admin/stations/' + encodeURIComponent(id), { method: 'DELETE' });
          await loadStations();
        }
      });
    });
  }

  async function saveStationFromForm() {
    var status = getEl('stationsStatus');
    try {
      var payload = readStationForm();

      if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lon)) {
        status.textContent = 'يرجى تحديد موقع المحطة على الخريطة أولاً';
        return;
      }

      // ── Water placement validation ──────────────────────────────────────────
      if (waterCheckState.checking) {
        status.textContent = 'جاري التحقق من موقع المحطة، يرجى الانتظار...';
        return;
      }
      var latMatch = Math.abs((waterCheckState.lat || 0) - payload.lat) < 1e-5;
      var lonMatch = Math.abs((waterCheckState.lon || 0) - payload.lon) < 1e-5;
      if (!latMatch || !lonMatch || waterCheckState.isWater === null) {
        status.textContent = 'جاري التحقق من موقع المحطة...';
        await detectAndAutoOffsetWater(payload.lat, payload.lon);
        payload = readStationForm(); // re-read in case pin was auto-shifted
      }
      if (waterCheckState.isWater === false) {
        status.textContent = 'يرجى وضع المحطة داخل البحر وليس على اليابسة';
        return;
      }
      // ── End water validation ────────────────────────────────────────────────

      status.textContent = 'جاري الحفظ...';
      var method = payload.id ? 'PUT' : 'POST';
      var url = payload.id ? ('/api/admin/stations/' + encodeURIComponent(payload.id)) : STATIONS_ENDPOINT;
      var res = await apiFetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        var err = await res.text();
        throw new Error(err || 'station_save_failed');
      }
      status.textContent = 'تم الحفظ.';
      clearStationForm();
      await loadStations();
    } catch (e) {
      status.textContent = 'فشل حفظ المحطة: ' + (e && e.message ? e.message : 'error');
    }
  }

  function roleBadge(role) {
    return '<span class="badge">' + role + '</span>';
  }

  async function loadUsers() {
    var res = await apiFetch(USERS_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('users_load_failed');
    var data = await res.json();
    usersCache = Array.isArray(data.users) ? data.users : [];

    var body = getEl('usersBody');
    body.innerHTML = '';
    usersCache.forEach(function (u) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><strong>' + u.username + '</strong><br><span style="font-size:12px;color:#8ea4ba">' + u.id + '</span></td>' +
        '<td>' + roleBadge(u.role) + '</td>' +
        '<td>' + (u.active_status ? '<span class="badge ok">active</span>' : '<span class="badge off">disabled</span>') + '</td>' +
        '<td>' + ((u.assigned_stations || []).join(', ') || '--') + '</td>' +
        '<td><div class="inline-actions">' +
          '<button class="small-btn" data-user="' + u.id + '" data-act="toggle">' + (u.active_status ? 'تعطيل' : 'تفعيل') + '</button>' +
          '<button class="small-btn warn" data-user="' + u.id + '" data-act="reset">Reset Pass</button>' +
        '</div></td>';
      body.appendChild(tr);
    });

    body.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-user');
        var act = btn.getAttribute('data-act');
        var user = usersCache.find(function (x) { return x.id === id; });
        if (!user) return;

        if (act === 'toggle') {
          await apiFetch(USERS_ENDPOINT, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, active_status: !user.active_status })
          });
          await loadUsers();
          return;
        }

        if (act === 'reset') {
          var nextPass = prompt('كلمة المرور الجديدة للمستخدم ' + user.username);
          if (!nextPass) return;
          await apiFetch('/api/admin/users/' + encodeURIComponent(id) + '/password', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: nextPass })
          });
          var status = getEl('usersStatus');
          status.textContent = 'تم تحديث كلمة المرور.';
        }
      });
    });
  }

  async function createUserFromForm() {
    var status = getEl('usersStatus');
    try {
      status.textContent = 'جاري إنشاء المستخدم...';
      var payload = {
        username: getEl('newUserName').value.trim(),
        password: getEl('newUserPass').value.trim(),
        role: getEl('newUserRole').value,
        assigned_stations: splitCsv(getEl('newUserStations').value)
      };
      var res = await apiFetch(USERS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      status.textContent = 'تم إنشاء المستخدم.';
      getEl('newUserName').value = '';
      getEl('newUserPass').value = '';
      getEl('newUserStations').value = '';
      await loadUsers();
    } catch (e) {
      status.textContent = 'فشل الإنشاء: ' + (e && e.message ? e.message : 'error');
    }
  }

  async function loadFeedback() {
    var params = new URLSearchParams();
    var d = getEl('fbDateFilter').value;
    var st = getEl('fbStationFilter').value.trim();
    var u = getEl('fbUserFilter').value.trim();
    if (d) params.set('date', d);
    if (st) params.set('station', st);
    if (u) params.set('user_id', u);

    var url = FEEDBACK_ENDPOINT + (params.toString() ? ('?' + params.toString()) : '');
    var res = await apiFetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('feedback_load_failed');
    var data = await res.json();
    var list = Array.isArray(data.feedback) ? data.feedback : [];
    latestFeedbackCache = list;

    var body = getEl('feedbackBody');
    body.innerHTML = '';
    list.forEach(function (f) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + String(f.timestamp || '').replace('T', ' ').slice(0, 19) + '</td>' +
        '<td>' + (f.station || '--') + '</td>' +
        '<td>' + (f.answer || '--') + '</td>' +
        '<td>' + (f.score != null ? f.score : '--') + '</td>' +
        '<td>' + (f.user_id || 'anonymous') + '</td>' +
        '<td><button class="small-btn danger" data-fb="' + f.id + '">Archive</button></td>';
      body.appendChild(tr);
    });

    body.querySelectorAll('button[data-fb]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-fb');
        await apiFetch(FEEDBACK_ENDPOINT, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, action: 'archive' })
        });
        await loadFeedback();
      });
    });

    getEl('feedbackStatusAdmin').textContent = 'إجمالي النتائج: ' + list.length;
    updateFieldTestingChecklist(latestSummaryCache, latestFeedbackCache);
  }

  async function exportAdminExcel() {
    var s;
    try {
      s = await fetchSummary();
    } catch (e) {
      s = { total_yes: 0, total_no: 0, accuracy: 0, score_accuracy: 0, top_locations: [] };
    }

    var csv = '\uFEFF';
    csv += 'NAVIDUR Summary\n';
    csv += 'YES,NO,Accuracy,Score Accuracy\n';
    csv += (s.total_yes || 0) + ',' + (s.total_no || 0) + ',' + (s.accuracy || 0) + '%,' + (s.score_accuracy || 0) + '%\n\n';
    csv += 'Top Stations\n';
    csv += 'Station,Total,YES,NO\n';
    (s.top_locations || []).forEach(function (x) { csv += x.station + ',' + x.total + ',' + x.yes + ',' + x.no + '\n'; });

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'NaviDur_Admin_Report_' + dateKey(new Date()) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function onLogin() {
    var user = (getEl('adminUser').value || '').trim();
    var pass = getEl('adminPass').value || '';
    var errEl = getEl('adminErr');

    try {
      var res = await fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      if (!res.ok) throw new Error('login_failed');
      var data = await res.json();
      authToken = data.token || '';
      me = data.user || null;
      localStorage.setItem('navidur_admin_token', authToken);

      if (!me || (me.role !== 'admin' && me.role !== 'super_admin')) throw new Error('role_not_allowed');

      adminAuthenticated = true;
      errEl.style.display = 'none';
      getEl('adminLoginForm').style.display = 'none';
      getEl('adminContent').classList.add('active');
      await renderAdminDashboard();
      setAdminDataFilter('all');
      loadSettingsIntoAdmin();
      clearStationForm();
    } catch (_err) {
      errEl.style.display = 'block';
      getEl('adminPass').value = '';
    }
  }

  async function logout() {
    try {
      await fetch(LOGOUT_ENDPOINT, { method: 'POST', credentials: 'same-origin' });
    } catch (_e) {}
    localStorage.removeItem('navidur_admin_token');
    authToken = '';
    adminAuthenticated = false;
    getEl('adminContent').classList.remove('active');
    getEl('adminLoginForm').style.display = 'block';
  }

  function bindSettingsActions() {
    var saveBtn = getEl('saveSettingsBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (settingsInFlight) return;
        saveSettingsFromAdmin();
      });
    }

    var reloadBtn = getEl('reloadSettingsBtn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        if (settingsInFlight) return;
        loadSettingsIntoAdmin();
      });
    }

    var logoutBtn = getEl('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
  }

  function initAdminPage() {
    var loginBtn = getEl('adminLoginBtn');
    var passInput = getEl('adminPass');
    var exportBtn = getEl('adminExportBtn');
    var refreshBtn = getEl('adminRefresh');
    var userInput = getEl('adminUser');

    if (loginBtn) loginBtn.addEventListener('click', function () { onLogin(); });
    if (passInput) {
      passInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') onLogin();
      });
    }
    if (exportBtn) exportBtn.addEventListener('click', exportAdminExcel);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        if (adminAuthenticated && !refreshInFlight) {
          renderAdminDashboard();
        }
      });
    }

    document.querySelectorAll('.admin-nav').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAdminDataFilter(btn.getAttribute('data-filter'));
      });
    });

    getEl('saveStationBtn').addEventListener('click', saveStationFromForm);
    getEl('clearStationBtn').addEventListener('click', clearStationForm);
    getEl('createUserBtn').addEventListener('click', createUserFromForm);
    getEl('loadFeedbackBtn').addEventListener('click', function () { loadFeedback(); });
    initStationsAdminMap();

    bindSettingsActions();

    if (authToken) {
      getEl('adminLoginForm').style.display = 'none';
      getEl('adminContent').classList.add('active');
      adminAuthenticated = true;
      renderAdminDashboard();
      loadSettingsIntoAdmin();
      clearStationForm();
      setAdminDataFilter('all');
      return;
    }

    if (userInput) userInput.focus();
  }

  window.showAdminLogin = function () {
    getEl('adminLoginForm').style.display = 'block';
    getEl('adminContent').classList.remove('active');
    getEl('adminUser').focus();
  };

  document.addEventListener('DOMContentLoaded', initAdminPage);
})();
