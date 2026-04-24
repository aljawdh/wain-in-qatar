(function () {
  var API_ENDPOINT = '/api?route=admin-analytics';
  var SETTINGS_ENDPOINT = '/api?route=admin-settings';
  var STATIONS_ENDPOINT = '/api?route=admin&path=stations';
  var ASTRO_DUR_ENDPOINT = '/api?route=astro-dur';
  var USERS_ENDPOINT = '/api?route=admin&path=users';
  var SUMMARY_ENDPOINT = '/api?route=admin-summary';
  var FEEDBACK_ENDPOINT = '/api?route=admin&path=feedback';
  var LOGIN_ENDPOINT = '/api?route=login';
  var LOGOUT_ENDPOINT = '/api?route=logout';

  var adminAuthenticated = false;
  var adminDataFilter = 'home';
  var homeDashboardTimer = null;
  var ECC_ADV_STORAGE = 'navidur_ecc_advanced';
  var refreshInFlight = false;
  var settingsInFlight = false;
  var latestSettings = null;
  var authToken = localStorage.getItem('navidur_admin_token') || '';
  var me = null;
  try {
    me = JSON.parse(localStorage.getItem('navidur_admin_user') || 'null');
  } catch (_err) {
    me = null;
  }
  var stationsCache = [];
  /** @type {null | { workbook_city_key: string, workbook_city_name: string, lat: number|null, lon: number|null }[]} */
  var usersCache = [];
  var latestSummaryCache = null;
  var latestFeedbackCache = [];
  var dururCache = [];
  var dururReferenceCache = [];
  var globalDururManagementCache = [];
  var dururGlobalOverridesCache = [];
  var dururIntelligenceGroupedCache = [];
  var selectedGlobalDurId = '';
  var seasonEventsCache = [];
  var traitsCache = [];
  var stationProfilesCache = [];
  var stationOverridesCache = [];
  var annualComparisonsCache = [];
  var fieldReviewPatternsById = {};
  var fieldReviewPendingPattern = null;
  var fieldReviewSelectedSession = null;
  var _loadedDururProfileSnapshot = null;
  var _currentDururProfileSource = null;
  var currentAnalyzedStationId = null; // currently viewed station in analytics panel
  var currentWeatherState = null;
  var currentStationAnalysisDto = null;
  var currentTransientPreviewPoint = null;
  var currentAnalysisRequestToken = 0;
  var currentStationId = null;
  var stationValidationCache = {};
  /** @type {'now_auto'|'now'|'custom'|'1m'|'3m'|'6m'|'1y'} */
  var currentAnalyticsPeriod = 'now_auto';

  var stationsAdminMap = null;
  var stationsAdminMapState = null;
  var stationAdminMarker = null;
  var allStationMarkersList = [];
  var selectedDururStationId = null;
  var stationsBodyClickDelegationBound = false;
  var dururMapFilters = { stationType: 'all', currentDur: 'all', seasonEvent: 'all' };
  var stationReverseRequestId = 0;
  var waterCheckState = { isWater: null, lat: null, lon: null, checking: false, result: 'unknown', fallback: false };
  // result values: 'unknown' | 'confirmed_water' | 'confirmed_land' | 'uncertain'
  // fallback: true means the result was produced by the lightweight fallback, not strict Overpass check
  var _waterCheckTimer = null;
  var _stationEditMode = false;
  var _stationNameUserEdited = false;
  var _lastStationFormId = null;
  var _pendingSuhailAnchorResolution = null;
  var _trueFinalRefDocCache = null;
  var _trueFinalRefLoadPromise = null;
  var LEGACY_SYSTEM_CANCELLED_MSG = 'تم إلغاء النظام القديم — الرجاء استخدام المرجع الجديد';
  var DUR_FILE_NO_STATION_DATA_MSG = 'لا توجد بيانات لهذه المحطة';
  var DUR_FILE_STATUS_FROM_REF_MSG = 'مُستمد من المرجع: data/true_final_station_reference.json';
  var STATION_ANALYTICS_NO_DATA_MSG = 'لا توجد بيانات تحليل لهذه المحطة';
  var STATION_SEASONAL_REF_MSG = 'لا يوجد مرجع موسمي لهذه المحطة';

  var COASTAL_REGIONS = {
    'قطر': ['الدوحة', 'الخور', 'الوكرة', 'دخان', 'الشمال', 'الرويس', 'أم باب', 'مسيعيد'],
    'السعودية': ['خفجي', 'الجبيل', 'الدمام', 'الخبر', 'العقير', 'حقل', 'ضبا', 'الوجه', 'أملج', 'ينبع', 'رابغ', 'جدة', 'الليث', 'القنفذة', 'جازان'],
    'البحرين': ['المنامة', 'المحرق', 'سترة', 'الحد', 'الدراز', 'البديع'],
    'الكويت': ['الكويت', 'الشويخ', 'الشعيبية', 'الفحيحيل', 'الخيران', 'الجليعة', 'الزور', 'الصبية', 'الدوحة'],
    'الإمارات': ['أبوظبي', 'دبي', 'الشارقة', 'عجمان', 'أم القيوين', 'رأس الخيمة', 'الفجيرة', 'كلباء', 'خورفكان'],
    'عمان': ['مسقط', 'مطرح', 'بركاء', 'صحار', 'شناص', 'صور', 'الدقم', 'صلالة', 'خصب'],
    'إيران': []
  };

  // ── Country name normalization: map Nominatim strings → canonical keys ────
  var COUNTRY_NAME_ALIASES = {
    'المملكة العربية السعودية': 'السعودية',
    'Saudi Arabia': 'السعودية',
    'Qatar': 'قطر',
    'Kuwait': 'الكويت',
    'Bahrain': 'البحرين',
    'الإمارات العربية المتحدة': 'الإمارات',
    'United Arab Emirates': 'الإمارات',
    'الإمارات': 'الإمارات',
    'عُمان': 'عمان',
    'Oman': 'عمان',
    'Iran': 'إيران',
    'ايران': 'إيران'
  };

  function normalizeCountryName(raw) {
    if (!raw) return '';
    var t = raw.trim();
    return COUNTRY_NAME_ALIASES[t] || t;
  }

  function calculateSuhailStart(lat) {
    var base = new Date(2026, 7, 15); // August 15, 2026
    var offsetDays = Math.floor((25 - lat) * 2); // Adjust days based on latitude deviation from 25°N
    base.setDate(base.getDate() + offsetDays);
    return base;
  }

  function generateDururTimeline(suhailStart) {
    var durur = [];
    for (var i = 1; i <= 28; i++) {
      var start = new Date(suhailStart);
      start.setDate(start.getDate() + (i - 1) * 13);
      var end = new Date(start);
      end.setDate(end.getDate() + 12);
      durur.push({
        id: 'dur_' + String(i).padStart(2, '0'),
        dur_number: i,
        name: 'Dur ' + i,
        start_date: start,
        end_date: end
      });
    }
    return durur;
  }

  function getCurrentDurForStation(station) {
    if (!station || !Number.isFinite(station.lat)) return null;
    var suhailStart = calculateSuhailStart(station.lat);
    var timeline = generateDururTimeline(suhailStart);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = 0; i < timeline.length; i++) {
      if (today >= timeline[i].start_date && today <= timeline[i].end_date) {
        return timeline[i];
      }
    }
    return null;
  }

  // Automatically infer coastal/deep from geographic position.
  // This is stored as station metadata only; the live analysis engine
  // always overrides it with the real per-station tidal decision.
  function inferFishingModeFromCoords(lat, lon, country) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'coastal';
    if (lon >= 32 && lon <= 44 && lat >= 12 && lat <= 30) return 'deep';          // Red Sea
    if (lon >= 54 && lon <= 62 && lat >= 16 && lat <= 26) return 'deep';          // Arabian Sea / Oman Sea
    if (lon >= 55 && lon <= 59 && lat >= 25 && lat <= 27) return 'deep';          // Gulf of Oman / Musandam
    if (lon >= 49 && lon <= 56 && lat >= 23 && lat <= 30) return 'coastal';       // Inner Arabian Gulf
    return 'coastal';
  }

  function showMarineTypeHint(mode) {
    var el = getEl('stMarineTypeHint');
    if (!el) return;
    el.style.display = '';
    if (mode === 'deep') {
      el.textContent = '🌊 النوع البحري المُستنتج تلقائياً: غزير (مياه أعمق)';
      el.style.color = '#6fdcff';
    } else {
      el.textContent = '🏖️ النوع البحري المُستنتج تلقائياً: ساحلي (مياه ضحلة)';
      el.style.color = '#8bf2ca';
    }
  }

  function syncInferredFishingModeToForm(lat, lon, country) {
    var mode = inferFishingModeFromCoords(lat, lon, country || '');
    var fmEl = getEl('stFishingMode');
    if (fmEl) fmEl.value = mode;
    showMarineTypeHint(mode);
  }

  function readFishingModeFromForm() {
    var el = getEl('stFishingMode');
    var v = el && String(el.value || '').trim().toLowerCase();
    if (v === 'deep' || v === 'coastal') return v;
    return inferFishingModeFromCoords(Number(getEl('stLat').value), Number(getEl('stLon').value), getEl('stCountry').value.trim());
  }

  // Try to find the best matching coastal region from Nominatim address fields.
  function findBestCoastalRegion(country, addr) {
    if (!country || !addr) return '';
    var regions = COASTAL_REGIONS[country] || [];
    if (!regions.length) return '';
    var candidates = [
      addr.city, addr.town, addr.municipality, addr.state_district,
      addr.county, addr.suburb, addr.neighbourhood, addr.state, addr.region
    ].filter(Boolean);
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      for (var j = 0; j < regions.length; j++) {
        if (c === regions[j] || c.includes(regions[j]) || regions[j].includes(c)) return regions[j];
      }
    }
    return '';
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function safeInput(value, maxLen) {
    if (value == null) return '';
    return String(value).trim().slice(0, maxLen || 1000);
  }

  function stripHiddenWhitespace(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/g, '');
  }

  function normalizeLoginIdentifier(value) {
    return stripHiddenWhitespace(value).trim().toLowerCase();
  }

  function normalizeLoginPassword(value) {
    return stripHiddenWhitespace(value).trim();
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
      credentials: 'include',
      cache: 'no-store',
      headers: headers,
      body: opts.body
    }).then(function (res) {
      if (res.status === 401 && adminAuthenticated) {
        // Token expired or secret rotated — clear session and redirect to login
        authToken = '';
        adminAuthenticated = false;
        localStorage.removeItem('navidur_admin_token');
        localStorage.removeItem('navidur_admin_user');
        me = null;
        var contentEl = getEl('adminContent');
        var loginEl = getEl('adminLoginForm');
        var passEl = getEl('adminPass');
        if (contentEl) contentEl.classList.remove('active');
        if (loginEl) loginEl.style.display = 'block';
        if (passEl) passEl.value = '';
        var errEl = document.getElementById('adminErr');
        if (errEl) { errEl.textContent = 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.'; errEl.style.display = 'block'; }
      }
      return res;
    });
  }

  function stopHomeDashboardAutoRefresh() {
    if (homeDashboardTimer) {
      clearInterval(homeDashboardTimer);
      homeDashboardTimer = null;
    }
  }

  function startHomeDashboardAutoRefresh() {
    stopHomeDashboardAutoRefresh();
    if (adminDataFilter !== 'home' || !adminAuthenticated) return;
    homeDashboardTimer = setInterval(function () {
      if (adminDataFilter === 'home' && adminAuthenticated && !refreshInFlight) {
        void renderAdminHomeDashboard();
      }
    }, 26000);
  }

  function eccApplyStatusRing(el, tier) {
    if (!el) return;
    el.classList.remove('ecc-st-green', 'ecc-st-yellow', 'ecc-st-red');
    if (tier === 'green') el.classList.add('ecc-st-green');
    else if (tier === 'yellow') el.classList.add('ecc-st-yellow');
    else if (tier === 'red') el.classList.add('ecc-st-red');
  }

  function eccSetApiPill(el, kind) {
    if (!el) return;
    el.className = 'ecc-pill ' + (kind === 'ok' ? 'ecc-pill-ok' : kind === 'warn' ? 'ecc-pill-warn' : kind === 'bad' ? 'ecc-pill-bad' : 'ecc-pill-down');
    el.textContent = kind === 'ok' ? 'OK' : kind === 'warn' ? 'degraded' : kind === 'bad' ? 'down' : '—';
  }

  function buildEccAlerts() {
    var mode = (latestSettings && latestSettings.site_mode) || 'live';
    var list = [];
    if (mode === 'maintenance') list.push({ sev: 3, text: 'وضع الصيانة — الوصول العام مغلق' });
    else if (mode === 'private_beta') list.push({ sev: 2, text: 'وضع الاختبار — وصول محدود' });
    var badRefs = getInvalidReferenceStations(stationsCache);
    if (badRefs && badRefs.length) list.push({ sev: 3, text: 'مرجعيّة بلا إحداثيات صالحة: ' + badRefs.length });
    list.sort(function (a, b) { return b.sev - a.sev; });
    return list;
  }

  var eccHomeBound = false;
  function initEccHomeUiOnce() {
    if (eccHomeBound) return;
    eccHomeBound = true;
    var root = getEl('eccHomeRoot');
    var tgl = getEl('eccAdminModeToggle');
    if (tgl && root) {
      tgl.checked = localStorage.getItem(ECC_ADV_STORAGE) === '1';
      root.classList.toggle('ecc-mode-advanced', !!tgl.checked);
      tgl.addEventListener('change', function () {
        localStorage.setItem(ECC_ADV_STORAGE, tgl.checked ? '1' : '0');
        root.classList.toggle('ecc-mode-advanced', !!tgl.checked);
      });
    }
    document.querySelectorAll('[data-ecc-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        var go = el.getAttribute('data-ecc-go');
        var focus = el.getAttribute('data-ecc-focus');
        if (go) activateAdminSection(go, focus ? { focusCard: focus } : null);
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    });
  }

  function focusEccHomeCard(focusId) {
    var map = { system: 'eccCardSystem', api: 'eccCardApi', alerts: 'eccCardAlerts' };
    var elId = map[focusId];
    if (!elId) return;
    var el = getEl(elId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ecc-focus-flash');
    window.setTimeout(function () {
      el.classList.remove('ecc-focus-flash');
    }, 1400);
  }

  /**
   * Central section activation: updates visibility, nav, and runs the data loader for the target.
   * @param {string} sectionName
   * @param {null|{ focusCard?: 'system'|'api'|'alerts' }} [options] — used when opening home from dashboard cards
   */
  function activateAdminSection(sectionName, options) {
    if (sectionName === 'durur') {
      console.warn('[admin] disabled durur section access attempt');
      return;
    }
    var f = sectionName || 'home';
    if (f === 'all') f = 'home';
    adminDataFilter = f;
    options = options || {};
    stopHomeDashboardAutoRefresh();
    document.querySelectorAll('.admin-block').forEach(function (block) {
      var section = block.getAttribute('data-section');
      var show = (adminDataFilter === 'home' && section === 'home')
        || (adminDataFilter !== 'home' && adminDataFilter === section);
      block.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('.admin-nav').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === adminDataFilter);
    });
    if (adminDataFilter === 'home' || adminDataFilter === 'stations') {
      window.setTimeout(function () {
        if (stationsAdminMap && typeof stationsAdminMap.invalidateSize === 'function') {
          stationsAdminMap.invalidateSize();
        }
      }, 120);
    }
    Promise.resolve().then(function () {
      var section = adminDataFilter;
      console.log('Loading section:', section);
      if (!adminAuthenticated) {
        console.warn('[admin] skip section loaders: not authenticated');
        return;
      }
      var focusAfter = (options && options.focusCard) ? options.focusCard : null;
      switch (section) {
        case 'home':
          void renderAdminHomeDashboard();
          startHomeDashboardAutoRefresh();
          if (focusAfter) {
            window.setTimeout(function () {
              focusEccHomeCard(focusAfter);
            }, 220);
          }
          break;
        case 'field-review':
          if (!me || me.role === 'admin' || me.role === 'super_admin') {
            void refreshFieldReview();
          } else {
            var frs = getEl('fieldReviewStatus');
            if (frs) frs.textContent = 'تتطلب صلاحية إدارية لعرض تحليل الميدان.';
            var frBody = getEl('fieldReviewSessionsBody');
            if (frBody) {
              frBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8ea4ba">لا توجد بيانات حالياً</td></tr>';
            }
          }
          break;
        case 'settings':
          void loadSettingsIntoAdmin();
          break;
        case 'feedback':
          void loadFeedback().catch(function () {
            var fs = getEl('feedbackStatusAdmin');
            if (fs) fs.textContent = 'تعذر تحميل البيانات';
            var body = getEl('feedbackBody');
            if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8ea4ba">تعذر تحميل البيانات</td></tr>';
          });
          break;
        case 'analytics':
          void renderSummarySection();
          break;
        case 'stations':
          void loadStations().then(function () {
            var sid = (getEl('stId') && getEl('stId').value) ? String(getEl('stId').value).trim() : '';
            if (sid) {
              void renderStationAnalytics();
            } else {
              clearAdminAnalysisDisplay('اختر محطة لعرض التحليل');
              var sm = getEl('stAnalyticsMsg');
              if (sm) sm.textContent = 'اختر محطة لعرض التحليل';
            }
          }).catch(function () {
            var ss = getEl('stationsStatus');
            if (ss) ss.textContent = 'تعذر تحميل بيانات المحطات';
          });
          break;
        case 'users':
          void loadUsers().catch(function () {
            var us = getEl('usersStatus');
            if (us) us.textContent = 'تعذر تحميل البيانات';
            var body = getEl('usersBody');
            if (body) body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8ea4ba">تعذر تحميل البيانات</td></tr>';
          });
          break;
        case 'astro-dur':
          void refreshAstroDurStatus();
          var sid0 = (getEl('stId') && getEl('stId').value) ? String(getEl('stId').value).trim() : '';
          if (sid0) {
            var st0 = stationsCache.find(function (s) {
              return s && String(s.id) === sid0;
            });
            if (st0) {
              var stM = getStationForLocalDurReadout(st0);
              void refreshStationLocalDurReadout(stM, getCanonicalNavidurAsOfIso());
            }
          }
          break;
        default:
          break;
      }
    });
  }

  function setAdminDataFilter(filter) {
    activateAdminSection(filter, null);
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
    var period = currentPeriod || 'all';
    var res = await apiFetch(SUMMARY_ENDPOINT + '?period=' + encodeURIComponent(period), { method: 'GET' });
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
        featurePrediction: features.featurePrediction !== false,
        astro_dur_engine_enabled: features.astro_dur_engine_enabled === true,
        astro_admin_preview_enabled: features.astro_admin_preview_enabled !== false
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
    setCheckboxField(['#astroDurEngineToggle'], s.features.astro_dur_engine_enabled === true);
    setCheckboxField(['#astroAdminPreviewToggle'], s.features.astro_admin_preview_enabled !== false);

    setTextField(
      ['#fishDataInput', '#fishData', 'textarea[name="fishData"]'],
      JSON.stringify(s.fishData, null, 2)
    );

    var adsJsonEl = queryFirst(['#adsJsonInput', '#adsJson', 'textarea[name="adsJson"]']);
    if (adsJsonEl) adsJsonEl.value = JSON.stringify(s.ads, null, 2);

    var featuresJsonEl = queryFirst(['#featuresJsonInput', '#featuresJson', 'textarea[name="featuresJson"]']);
    if (featuresJsonEl) featuresJsonEl.value = JSON.stringify(s.features, null, 2);

    syncPlatformToggle(s.site_mode || 'live');
  }

  function syncPlatformToggle(siteMode) {
    var isClosed = siteMode === 'maintenance' || siteMode === 'private_beta';
    var openBtn = getEl('platformModeOpenBtn');
    var closedBtn = getEl('platformModeClosedBtn');
    var infoEl = getEl('platformModeInfo');
    var msgWrap = getEl('closureMsgWrap');

    if (openBtn) {
      openBtn.classList.toggle('active-open', !isClosed);
      openBtn.classList.toggle('active-closed', false);
    }
    if (closedBtn) {
      closedBtn.classList.toggle('active-closed', isClosed);
      closedBtn.classList.toggle('active-open', false);
    }
    if (infoEl) {
      infoEl.className = 'platform-mode-info ' + (isClosed ? 'info-closed' : 'info-open');
      if (isClosed) {
        infoEl.textContent = '🔒 المنصة مغلقة — المديرون والأعضاء المسجّلون فقط يمكنهم الدخول. الجمهور محجوب.';
      } else {
        infoEl.textContent = '🌐 المنصة مفتوحة — الجميع يمكنهم الوصول.';
      }
    }
    if (msgWrap) msgWrap.style.display = isClosed ? '' : 'none';

    // Keep allowAdminBypass always enabled so admin is never locked out
    var bypassEl = getEl('allowAdminBypassInput');
    if (bypassEl) bypassEl.checked = true;
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
      features: (function () {
        var fromForm = {
          featurePrediction: getCheckboxField(['#featurePredictionToggle', '#featurePrediction', 'input[name="featurePrediction"]'], true),
          astro_dur_engine_enabled: getCheckboxField(['#astroDurEngineToggle'], false),
          astro_admin_preview_enabled: getCheckboxField(['#astroAdminPreviewToggle'], true)
        };
        if (featuresFromJson && typeof featuresFromJson === 'object') {
          return Object.assign({}, fromForm, featuresFromJson);
        }
        return fromForm;
      })(),
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
    console.log('Loader executed:', 'loadSettingsIntoAdmin');
    try {
      setSettingsBusy(true);
      showSettingsStatus('جاري تحميل الإعدادات...', false);
      latestSettings = await fetchSettings();
      renderSettingsToForm(latestSettings);
      showSettingsStatus('تم تحميل الإعدادات من الخادم.', false);
      if (adminDataFilter === 'home') void renderAdminHomeDashboard();
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
      if (adminDataFilter === 'home') void renderAdminHomeDashboard();
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

  function renderOpsBlock(s) {
    var stations = s.station_selection_counts || [];
    var countries = s.country_usage || [];
    var modes = s.fishing_mode_distribution || [];
    var topStation = stations[0] ? stations[0].station_name : '---';
    var topCountry = countries[0] ? countries[0].country : '---';
    var topMode = modes[0] ? (modes[0].mode === 'deep' ? 'غزير' : 'ساحلي') : '---';
    var totalAnalyses = Number(s.total_analyses || 0);
    var biggestDropOff = '---';
    var dropOff = (s.funnel && s.funnel.drop_off) || [];
    var maxDrop = -1;
    dropOff.forEach(function (d) {
      if (d.drop_off_pct !== null && d.drop_off_pct > maxDrop) {
        maxDrop = d.drop_off_pct;
        biggestDropOff = (d.from || '') + ' ← ' + (d.to || '') + ' (' + d.drop_off_pct + '%)';
      }
    });
    getEl('opsTopStation').textContent = topStation;
    getEl('opsTopCountry').textContent = topCountry;
    getEl('opsTopMode').textContent = topMode;
    getEl('opsTotalAnalyses').textContent = String(totalAnalyses);
    getEl('opsBiggestDropOff').textContent = biggestDropOff;
  }

  function renderFunnelHealth(funnel) {
    var panel = getEl('funnelHealthPanel');
    if (!panel) return;
    var steps = (funnel && funnel.steps) || [];
    if (!steps.length) {
      panel.innerHTML = '<div style="color:var(--txt3);font-size:.82rem">لا توجد بيانات قمع بعد.</div>';
      return;
    }
    var entry = steps[0].count || 1;
    var maxCount = Math.max.apply(null, steps.map(function (s) { return s.count || 0; })) || 1;
    panel.innerHTML = steps.map(function (step, i) {
      var retentionPct = i === 0 ? 100 : Math.round((step.count / entry) * 100);
      var barPct = Math.round(((step.count || 0) / maxCount) * 100);
      var cls = retentionPct >= 70 ? 'green' : (retentionPct >= 40 ? 'yellow' : 'red');
      var barColor = cls === 'green' ? '#26c281' : (cls === 'yellow' ? '#f0c040' : '#ff5252');
      return '<div class="funnel-health-row">' +
        '<div class="funnel-health-label">' + (step.label || step.step) + '</div>' +
        '<div class="funnel-health-bar-wrap"><div class="funnel-health-bar" style="width:' + barPct + '%;background:' + barColor + '"></div></div>' +
        '<div class="funnel-health-count">' + Number(step.count || 0) + '</div>' +
        '<div class="funnel-health-pct ' + cls + '">' + retentionPct + '%</div>' +
        '</div>';
    }).join('');
  }

  function generateInsights(s) {
    var container = getEl('opsInsights');
    if (!container) return;
    var insights = [];
    var stations = s.station_selection_counts || [];
    var countries = s.country_usage || [];
    var modes = s.fishing_mode_distribution || [];
    var dropOff = (s.funnel && s.funnel.drop_off) || [];
    if (stations[0]) {
      insights.push({ icon: '📍', text: 'المحطة الأكثر طلباً هي <strong>' + stations[0].station_name + '</strong> بـ ' + stations[0].count + ' اختيار.' });
    }
    if (countries[0]) {
      insights.push({ icon: '🌍', text: 'معظم الاستخدام قادم من <strong>' + countries[0].country + '</strong>.' });
    }
    if (modes[0]) {
      insights.push({ icon: '⚓', text: 'نوع الصيد السائد هو <strong>' + (modes[0].mode === 'deep' ? 'غزير' : 'ساحلي') + '</strong>.' });
    }
    var worstDrop = null;
    var worstPct = -1;
    dropOff.forEach(function (d) {
      if (d.drop_off_pct !== null && d.drop_off_pct > worstPct) {
        worstPct = d.drop_off_pct;
        worstDrop = d;
      }
    });
    if (worstDrop && worstPct > 30) {
      insights.push({ icon: '⚠️', text: 'أكبر تسرب بين <strong>' + (worstDrop.from || '') + '</strong> و<strong>' + (worstDrop.to || '') + '</strong> بنسبة ' + worstPct + '% — يستحق المراجعة.' });
    }
    if (!insights.length) {
      container.innerHTML = '<div style="color:var(--txt3);font-size:.82rem">لا توجد بيانات كافية لتوليد توصيات بعد.</div>';
      return;
    }
    container.innerHTML = insights.map(function (ins) {
      return '<div class="insight-card"><span class="insight-icon">' + ins.icon + '</span><span>' + ins.text + '</span></div>';
    }).join('');
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
      renderOpsBlock(s);
      var stTotal = (s.station_selection_counts || []).reduce(function (acc, x) { return acc + Number(x.count || 0); }, 0);
      renderKeyValueRows('selectionStationsBody', (s.station_selection_counts || []).map(function (x, i) {
        var share = stTotal > 0 ? ((Number(x.count || 0) / stTotal) * 100).toFixed(1) + '%' : '--';
        return '<td>' + (i + 1) + '</td><td><strong>' + (x.station_name || '--') + '</strong></td><td>' + (x.country || '--') + '</td><td>' + Number(x.count || 0) + '</td><td>' + share + '</td>';
      }), 'لا توجد اختيارات مسجلة بعد', 5);
      var modeTotal = (s.fishing_mode_distribution || []).reduce(function (acc, x) { return acc + Number(x.count || 0); }, 0);
      renderKeyValueRows('selectionModeBody', (s.fishing_mode_distribution || []).map(function (x) {
        var share = modeTotal > 0 ? ((Number(x.count || 0) / modeTotal) * 100).toFixed(1) + '%' : '--';
        return '<td>' + (x.mode === 'deep' ? 'غزير' : 'ساحلي') + '</td><td>' + Number(x.count || 0) + '</td><td>' + share + '</td>';
      }), 'لا توجد بيانات', 3);
      var cTotal = (s.country_usage || []).reduce(function (acc, x) { return acc + Number(x.count || 0); }, 0);
      renderKeyValueRows('selectionCountryBody', (s.country_usage || []).map(function (x) {
        var share = cTotal > 0 ? ((Number(x.count || 0) / cTotal) * 100).toFixed(1) + '%' : '--';
        return '<td>' + (x.country || '--') + '</td><td>' + Number(x.count || 0) + '</td><td>' + share + '</td>';
      }), 'لا توجد بيانات', 3);
      var insightsRows = [];
      (s.selection_insights && s.selection_insights.top_performing || []).forEach(function (x) {
        insightsRows.push('<td>Top</td><td>' + (x.station_name || '--') + '</td><td>' + Number(x.count || 0) + '</td>');
      });
      (s.selection_insights && s.selection_insights.low_usage || []).forEach(function (x) {
        insightsRows.push('<td>Low</td><td>' + (x.station_name || '--') + '</td><td>' + Number(x.count || 0) + '</td>');
      });
      renderKeyValueRows('selectionInsightsBody', insightsRows, 'لا توجد بيانات كافية لاستخراج insights', 3);

      // Funnel
      var funnel = s.funnel || { steps: [], drop_off: [] };
      renderFunnelHealth(funnel);
      generateInsights(s);
      renderKeyValueRows('funnelStepsBody', (funnel.steps || []).map(function (x) {
        return '<td>' + (x.label || x.step) + '</td><td><strong>' + Number(x.count || 0) + '</strong></td>';
      }), 'لا توجد بيانات funnel بعد — تبدأ بأول اختيار محطة', 2);
      renderKeyValueRows('funnelDropOffBody', (funnel.drop_off || []).map(function (x) {
        var pct = x.drop_off_pct !== null && x.drop_off_pct !== undefined ? x.drop_off_pct + '%' : '--';
        var color = (x.drop_off_pct !== null && x.drop_off_pct > 50) ? 'color:#ffb3b3' : 'color:#b9ffd8';
        return '<td>' + (x.from || '--') + '</td><td>' + (x.to || '--') + '</td><td>' + Number(x.to_count || 0) + '/' + Number(x.from_count || 0) + '</td><td style="' + color + '"><strong>' + pct + '</strong></td>';
      }), 'لا توجد بيانات', 4);
      updateFieldTestingChecklist(latestSummaryCache, latestFeedbackCache);
    } catch (_e) {
      latestSummaryCache = { total_yes: 0, total_no: 0 };
      getEl('sumYes').textContent = '0';
      getEl('sumNo').textContent = '0';
      getEl('sumAcc').textContent = '0%';
      getEl('sumScoreAcc').textContent = '0%';
      renderTopTable('summaryTopStationsBody', []);
      renderKeyValueRows('selectionStationsBody', [], 'لا توجد اختيارات مسجلة بعد', 5);
      renderKeyValueRows('selectionModeBody', [], 'لا توجد بيانات', 3);
      renderKeyValueRows('selectionCountryBody', [], 'لا توجد بيانات', 3);
      renderKeyValueRows('selectionInsightsBody', [], 'لا توجد بيانات كافية لاستخراج insights', 3);
      renderKeyValueRows('funnelStepsBody', [], 'لا توجد بيانات funnel بعد', 2);
      renderKeyValueRows('funnelDropOffBody', [], 'لا توجد بيانات', 4);
      var fhPanel = getEl('funnelHealthPanel');
      if (fhPanel) fhPanel.innerHTML = '';
      var oi = getEl('opsInsights');
      if (oi) oi.innerHTML = '';
      updateFieldTestingChecklist(latestSummaryCache, latestFeedbackCache);
    }
  }

  async function renderAiInsightLayer() {
    var row = getEl('eccAiRow');
    var empty = getEl('eccAiEmpty');
    var b = getEl('eccAiBodyBest');
    var wk = getEl('eccAiBodyWeak');
    var sm = getEl('eccAiBodySmart');
    var tr = getEl('eccAiTrend');
    if (!row || !b || !wk || !sm) return;
    var gen = (typeof window !== 'undefined' && window.NavidurAiInsight && window.NavidurAiInsight.generateNavidurInsights);
    if (!gen) {
      if (tr) { tr.style.display = 'none'; tr.textContent = ''; }
      if (empty) { empty.style.display = 'block'; empty.textContent = 'لا توجد بيانات كافية للتحليل'; }
      row.style.display = 'none';
      return;
    }
    try {
      var res = await apiFetch('/api?route=admin&path=field-review-sessions', { method: 'GET' });
      var j = await res.json();
      var sessions = (j && j.ok && j.sessions) ? j.sessions : (Array.isArray(j && j.sessions) ? j.sessions : []);
      if (sessions.length < 3) {
        row.style.display = 'none';
        if (tr) { tr.style.display = 'none'; tr.textContent = ''; }
        if (empty) { empty.style.display = 'block'; empty.textContent = 'لا توجد بيانات كافية للتحليل'; }
        return;
      }
      if (empty) empty.style.display = 'none';
      row.style.display = 'grid';
      var ins = gen({ fieldSessions: sessions, station: null, dateRange: null, now: Date.now() });
      if (ins && ins.best_fish) {
        var att = ins.best_fish.attempts != null ? ' · محاولات: ' + ins.best_fish.attempts : '';
        b.innerHTML = '<strong>' + escapeHtml(String(ins.best_fish.fish)) + '</strong><br/>معدل النجاح: ' + escapeHtml(String(ins.best_fish.success_rate)) + '%' + att + ' · ثقة: ' + escapeHtml(String(ins.best_fish.confidence));
      } else {
        b.textContent = '—';
      }
      if (ins && ins.weakest_pattern) {
        wk.innerHTML = '<strong>' + escapeHtml(String(ins.weakest_pattern.fish)) + '</strong><br/>' + escapeHtml(String(ins.weakest_pattern.issue));
      } else {
        wk.textContent = '—';
      }
      if (ins && ins.smart_recommendation) {
        var srec = ins.smart_recommendation;
        var t = srec.text || '—';
        var bc = srec.based_on ? ' · ' + srec.based_on : '';
        var sc = srec.confidence ? ' · موثوقية: ' + srec.confidence : '';
        sm.textContent = t + bc + sc;
      } else {
        sm.textContent = '—';
      }
      if (tr) {
        if (ins && ins.trend) {
          tr.textContent = 'اتجاه أسبوعي (7 أيام / السابعة): ' + ins.trend;
          tr.style.display = 'block';
        } else {
          tr.style.display = 'none';
          tr.textContent = '';
        }
      }
    } catch (_e) {
      if (row) row.style.display = 'none';
      if (tr) { tr.style.display = 'none'; tr.textContent = ''; }
      if (empty) { empty.style.display = 'block'; empty.textContent = 'لا توجد بيانات كافية للتحليل'; }
    }
  }

  async function renderAdminHomeDashboard() {
    if (!getEl('eccSystemLine')) {
      console.warn('Missing element:', 'eccSystemLine');
      return;
    }
    if (!latestSettings) {
      try {
        latestSettings = await fetchSettings();
      } catch (_e) { /* keep null */ }
    }
    var mode = (latestSettings && latestSettings.site_mode) || 'live';
    var sysLine = getEl('eccSystemLine');
    var sysSub = getEl('eccSystemSub');
    var cardSys = getEl('eccCardSystem');
    if (mode === 'live') {
      if (sysLine) sysLine.textContent = 'عام';
      if (sysSub) sysSub.textContent = 'المنصة نشطة للعموم';
      eccApplyStatusRing(cardSys, 'green');
    } else if (mode === 'private_beta') {
      if (sysLine) sysLine.textContent = 'اختبار';
      if (sysSub) sysSub.textContent = 'وصول محدود — راجع الإعدادات';
      eccApplyStatusRing(cardSys, 'yellow');
    } else {
      if (sysLine) sysLine.textContent = 'مغلق / صيانة';
      if (sysSub) sysSub.textContent = 'الوصول العام محجوب';
      eccApplyStatusRing(cardSys, 'red');
    }

    var elN = getEl('eccStationsVal');
    if (elN) elN.textContent = String(stationsCache.length);
    var elR = getEl('eccRefsVal');
    if (elR) elR.textContent = String(getReferenceStationCount(stationsCache));

    var tPanel = new Date();
    var meta = getEl('eccApiMeta');
    if (meta) {
      try {
        meta.textContent = 'آخر تحديث للوحة: ' + tPanel.toLocaleString('ar-QA', { dateStyle: 'short', timeStyle: 'short' });
      } catch (_e) {
        meta.textContent = '—';
      }
    }
    var detail = getEl('eccApiDetail');
    var pill = getEl('eccApiPill');
    if (detail) detail.textContent = 'جاري قياس الاستجابة…';
    if (pill) {
      pill.className = 'ecc-pill ecc-pill-ok';
      pill.textContent = '…';
    }
    var cardApi = getEl('eccCardApi');
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    apiFetch(SUMMARY_ENDPOINT + '?period=today', { method: 'GET' })
      .then(function (r) {
        var ms = Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0);
        var kind = 'ok';
        if (!r || !r.ok) kind = 'bad';
        else if (ms > 2000) kind = 'warn';
        eccSetApiPill(pill, kind);
        if (detail) {
          if (!r || !r.ok) detail.textContent = r ? ('HTTP ' + r.status) : 'متوقف';
          else if (ms > 2000) detail.textContent = 'مخفّض';
          else detail.textContent = 'سليم';
        }
        if (meta) {
          try {
            meta.textContent = 'زمن الاستجابة: ' + ms + ' ms — نبض: ' + new Date().toLocaleTimeString('ar-QA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          } catch (_e2) { /* ignore */ }
        }
        if (cardApi) {
          eccApplyStatusRing(cardApi, kind === 'ok' ? 'green' : kind === 'warn' ? 'yellow' : 'red');
        }
      })
      .catch(function () {
        eccSetApiPill(pill, 'bad');
        if (detail) detail.textContent = 'متوقف';
        if (meta) meta.textContent = 'تعذّر الاتصال بالخادم';
        eccApplyStatusRing(cardApi, 'red');
      });

    var alerts = buildEccAlerts();
    var cnt = getEl('eccAlertCount');
    var albl = getEl('eccAlertLabel');
    var atop = getEl('eccAlertTop');
    var cardAl = getEl('eccCardAlerts');
    if (cnt) cnt.textContent = String(alerts.length);
    if (albl) albl.textContent = alerts.length === 1 ? 'تنبيه' : 'تنبيهات';
    if (atop) {
      if (!alerts.length) {
        atop.textContent = 'لا توجد تنبيهات';
        eccApplyStatusRing(cardAl, 'green');
      } else {
        atop.textContent = alerts[0].text;
        var mx = alerts[0].sev;
        eccApplyStatusRing(cardAl, mx >= 3 ? 'red' : mx >= 2 ? 'yellow' : 'green');
      }
    }

    var lines = getEl('eccFieldLines');
    var fAdv = getEl('eccFieldAdv');
    if (lines) lines.textContent = 'جاري…';
    if (fAdv) fAdv.textContent = '—';
    Promise.all([
      apiFetch('/api?route=admin&path=field-review-summary', { method: 'GET' }).then(function (r) { return r.json(); }),
      apiFetch('/api?route=admin&path=field-review-patterns', { method: 'GET' }).then(function (r) { return r.json(); })
    ]).then(function (pair) {
      var jSum = pair[0];
      var jPat = pair[1];
      var s = (jSum && jSum.ok && jSum.summary) ? jSum.summary : null;
      var patterns = (jPat && jPat.ok && Array.isArray(jPat.patterns)) ? jPat.patterns : [];
      var topFish = (s && s.top_caught_fish && s.top_caught_fish[0]) ? String(s.top_caught_fish[0].key || '') : '';
      var sess = s && s.total_sessions != null ? s.total_sessions : 0;
      var rate = s && s.success_rate != null ? s.success_rate : '—';
      var weakest = null;
      patterns.forEach(function (p) {
        if (!p) return;
        if (!weakest) weakest = p;
        else {
          var wr = p.success_rate != null ? Number(p.success_rate) : 99;
          var vr = weakest.success_rate != null ? Number(weakest.success_rate) : 99;
          if (wr < vr) weakest = p;
          else if (wr === vr && (p.decision_strength != null) && (weakest.decision_strength != null) && Number(p.decision_strength) < Number(weakest.decision_strength)) weakest = p;
        }
      });
      var weakLine = '—';
      if (weakest) {
        weakLine = (weakest.fish || '؟') + ' · ' + (weakest.success_rate != null ? weakest.success_rate : '—') + '%';
      }
      if (lines) {
        lines.innerHTML = '<div><strong>الجلسات</strong> — ' + escapeHtml(String(sess)) + ' · <strong>النجاح</strong> ' + escapeHtml(String(rate)) + (rate === '—' ? '' : '%') + '</div>' +
          '<div>🔥 <strong>أشهر سمكة:</strong> ' + escapeHtml(topFish || '—') + '</div>' +
          '<div>⚠ <strong>أضعف نمط:</strong> ' + escapeHtml(weakLine) + '</div>';
      }
      if (fAdv && s) {
        fAdv.textContent = 'فاشلة: ' + (s.failed_sessions != null ? s.failed_sessions : '—') + (jSum && jSum.session_count != null ? ' — عيّنات: ' + jSum.session_count : '');
      }
    }).catch(function () {
      if (lines) lines.textContent = 'تعذّر تحميل بيانات الميدان';
    });

    void renderAiInsightLayer();
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
      loadFeedback(),
      loadDururData(),
      loadTraits(),
      loadDururReferenceData(),
      loadSeasonEvents(),
      loadStationProfiles(),
      loadStationOverrides(),
      loadAnnualComparisons()
    ]);
    await loadGlobalDururManagementData();
    await renderAdminHomeDashboard();
  }

  function getDurDateLabel(dur) {
    if (!dur) return '--';
    return (dur.gregorian_start_day || '?') + '/' + (dur.gregorian_start_month || '?') + ' ⇢ ' + (dur.gregorian_end_day || '?') + '/' + (dur.gregorian_end_month || '?');
  }

  function isDateWithinRange(month, day, dur) {
    if (!dur) return false;
    var start = dur.gregorian_start_month * 100 + dur.gregorian_start_day;
    var end = dur.gregorian_end_month * 100 + dur.gregorian_end_day;
    var target = month * 100 + day;
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

  function applyDururFilters() {
    dururMapFilters.stationType = getAdminReferenceOnlyEnabled() ? 'reference_only' : 'all';
    refreshAllStationMarkers(null, getVisibleAdminStations());
    updateDururStationInfoPanel();
  }

  function setDururTab(tabId) {
    ['dururDurTab', 'dururReferenceTab', 'seasonEventsTab', 'referenceStationsTab', 'dururAnalysisTab'].forEach(function (id) {
      var panel = getEl(id);
      if (panel) panel.classList.toggle('active', id === tabId);
    });
    ['dururDurTabBtn', 'dururReferenceTabBtn', 'seasonEventsTabBtn', 'referenceStationsTabBtn', 'dururAnalysisTabBtn'].forEach(function (btnId) {
      var btn = getEl(btnId);
      if (btn) btn.classList.toggle('active', btnId === tabId + 'Btn');
    });
  }

  function getCurrentStationDurLabel(station) {
    var date = new Date();
    var dur = getCurrentDurForDate(date);
    if (!dur) return 'لا يوجد در حالي';
    var override = stationOverridesCache.find(function (row) {
      return row.station_id === station.id && row.is_active && Number(row.dur_number) === Number(dur.dur_number);
    });
    if (override) {
      return 'در ' + dur.name + ' (تعديل محلي: offset ' + override.start_offset_days + '/' + override.end_offset_days + ')';
    }
    return dur.name || 'غير معرف';
  }

  function getDururProfileForStation(station) {
    return stationProfilesCache.find(function (row) { return row.station_id === station.id && row.is_active; }) || null;
  }

  function mapTraitValuesToIds(values, category) {
    if (!Array.isArray(values) || !values.length) return [];
    return values.reduce(function (result, value) {
      if (!value) return result;
      if (result.indexOf(value) >= 0) return result;
      var byId = traitsCache.find(function (item) { return item.id === value; });
      if (byId) {
        result.push(byId.id);
        return result;
      }
      mapDururTraitNamesToIds([value], category).forEach(function (id) {
        if (result.indexOf(id) < 0) result.push(id);
      });
      return result;
    }, []);
  }

  function mergeUniqueArrays() {
    var merged = [];
    Array.prototype.slice.call(arguments).forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (item) {
        if (item != null && merged.indexOf(item) < 0) merged.push(item);
      });
    });
    return merged;
  }

  function getResolvedDururProfileForStation(station) {
    var baseProfile = getDefaultDururProfileForStation(station);
    var profileRow = getDururProfileForStation(station);
    if (!profileRow) return baseProfile;

    var mergedProfile = Object.assign({}, baseProfile);
    mergedProfile.weather_traits = mergeUniqueArrays(
      baseProfile.weather_traits,
      mapTraitValuesToIds(profileRow.traits_weather || [], 'weather')
    );
    mergedProfile.marine_traits = mergeUniqueArrays(
      baseProfile.marine_traits,
      mapTraitValuesToIds(profileRow.traits_marine || [], 'marine')
    );
    mergedProfile.general_traits = mergeUniqueArrays(
      mapTraitValuesToIds(profileRow.traits_general || [], 'general'),
      mapTraitValuesToIds(profileRow.traits_heritage || [], 'heritage_signs')
    );
    mergedProfile.seasonal_traits = mergeUniqueArrays(
      baseProfile.seasonal_traits,
      mapTraitValuesToIds(profileRow.traits_seasonal_transition_traits || [], 'seasonal_transition_traits')
    );
    mergedProfile.fish_activity_traits = mergeUniqueArrays(
      baseProfile.fish_activity_traits,
      profileRow.traits_fish || [],
      profileRow.traits_fish_season || []
    );
    mergedProfile.expert_notes = profileRow.expert_summary || profileRow.notes_expert || profileRow.notes || baseProfile.expert_notes || '';
    mergedProfile.source = 'reference';
    mergedProfile.is_overridden = false;
    return mergedProfile;
  }

  function mapDtoTideStateToArabic(state) {
    if (state === 'LOAD') return 'حمل';
    if (state === 'FASAD') return 'فساد';
    return 'غير معروف';
  }

  function deriveMarineTraitsFromAnalysis(dto) {
    if (!dto || !dto.environment) return [];
    var environment = dto.environment || {};
    var tide = dto.tide || {};
    var traits = [];
    if (environment.wave_height_m != null) {
      if (environment.wave_height_m >= 1.5) traits.push('بحر مضطرب');
      else if (environment.wave_height_m >= 0.7) traits.push('نشاط الموج');
      else traits.push('بحر هادئ');
    }
    if (tide.current_speed_ms != null) {
      if (tide.current_speed_ms >= 0.8) traits.push('تيار قوي');
      else if (tide.current_speed_ms >= 0.45) traits.push('نشاط التيارات');
      else traits.push('تيار خفيف');
    }
    if (environment.wind_speed_kmh != null) {
      if (environment.wind_speed_kmh >= 30) traits.push('رياح قوية');
      else if (environment.wind_speed_kmh >= 18) traits.push('رياح متوسطة');
      else traits.push('رياح خفيفة');
    }
    return traits;
  }

  function deriveObservedTraitsFromAnalysis(dto) {
    var traits = deriveMarineTraitsFromAnalysis(dto);
    if (dto && dto.environment && dto.environment.temp_c != null) {
      if (dto.environment.temp_c >= 31) traits.push('جو حار وجاف');
      else if (dto.environment.temp_c <= 18) traits.push('جو بارد');
      else traits.push('اعتدال الجو');
    }
    return mergeUniqueArrays(traits);
  }

  function getObservedTraitsFromWeather(weatherState) {
    if (!weatherState) return [];
    var traits = [];
    if (weatherState.wave_height != null) {
      if (weatherState.wave_height >= 1.5) traits.push('بحر مضطرب');
      else if (weatherState.wave_height >= 0.7) traits.push('نشاط الموج');
      else traits.push('بحر هادئ');
    }
    if (weatherState.current_speed_ms != null) {
      if (weatherState.current_speed_ms >= 0.8) traits.push('تيار قوي');
      else if (weatherState.current_speed_ms >= 0.45) traits.push('نشاط التيارات');
      else traits.push('تيار خفيف');
    }
    if (weatherState.wind_speed_10m != null) {
      if (weatherState.wind_speed_10m >= 30) traits.push('رياح قوية');
      else if (weatherState.wind_speed_10m >= 18) traits.push('رياح متوسطة');
      else traits.push('رياح خفيفة');
    }
    if (weatherState.temperature_2m != null) {
      if (weatherState.temperature_2m >= 31) traits.push('جو حار وجاف');
      else if (weatherState.temperature_2m <= 18) traits.push('جو بارد');
      else traits.push('اعتدال الجو');
    }
    return mergeUniqueArrays(traits);
  }

  function getAnalyticsHistory(stationId, period) {
    var monthsBack;
    if (period === '1m') monthsBack = 1;
    else if (period === '3m') monthsBack = 3;
    else if (period === '6m') monthsBack = 6;
    else if (period === '1y') monthsBack = 12;
    else return Promise.reject(new Error('Invalid period'));
    var now = new Date();
    var startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    var query = 'station_id=' + encodeURIComponent(stationId) + '&start_date=' + encodeURIComponent(startDate.toISOString().split('T')[0]);
    return apiFetch('/api?route=admin&path=analytics-history&' + query, { method: 'GET' })
      .then(function (res) { return res.json(); })
      .then(function (data) { return Array.isArray(data.items) ? data.items : []; });
  }

  function getSeasonEventsForDur(dur) {
    if (!dur) return [];
    return seasonEventsCache.filter(function (e) { return Array.isArray(e.related_dur_ids) && e.related_dur_ids.includes(dur.id); });
  }

  function normalizeTraitString(value) {
    return String(value || '').trim().toLowerCase();
  }

  function mapDururTraitNamesToIds(names, category) {
    if (!Array.isArray(names) || names.length === 0) return [];
    return names.reduce(function (result, name) {
      if (!name) return result;
      var normalized = normalizeTraitString(name);
      var match = traitsCache.find(function (t) {
        return t.category === category && (
          normalizeTraitString(t.name_ar) === normalized ||
          normalizeTraitString(t.name) === normalized ||
          normalizeTraitString(t.name_en) === normalized
        );
      });
      if (match && result.indexOf(match.id) < 0) {
        result.push(match.id);
      }
      return result;
    }, []);
  }

  function getDefaultDururProfileForStation(station) {
    var profile = {
      current_dur_id: null,
      dur_entry_date: null,
      weather_traits: [],
      marine_traits: [],
      seasonal_traits: [],
      fish_activity_traits: [],
      expert_notes: '',
      source: 'system',
      is_overridden: false
    };
    var dur = getCurrentDurForStation(station);
    if (!dur) return profile;

    profile.current_dur_id = dur.id || null;
    profile.dur_entry_date = new Date().toISOString().split('T')[0];
    profile.weather_traits = mapDururTraitNamesToIds(dur.weather_traits || [], 'weather');
    profile.marine_traits = mapDururTraitNamesToIds(dur.marine_traits || [], 'marine');
    profile.seasonal_traits = getSeasonEventsForDur(dur).map(function (event) { return event.id; });
    profile.fish_activity_traits = Array.isArray(dur.fish_traits) ? dur.fish_traits.slice() : [];
    return profile;
  }

  function snapshotDururProfile(profile) {
    return {
      current_dur_id: profile.current_dur_id || '',
      dur_entry_date: profile.dur_entry_date || '',
      weather_traits: (profile.weather_traits || []).slice().sort(),
      marine_traits: (profile.marine_traits || []).slice().sort(),
      general_traits: (profile.general_traits || []).slice().sort(),
      seasonal_traits: (profile.seasonal_traits || []).slice().sort(),
      fish_activity_traits: (profile.fish_activity_traits || []).slice().sort(),
      expert_notes: profile.expert_notes || '',
      source: profile.source || '',
      is_overridden: !!profile.is_overridden
    };
  }

  function dururProfilesMatch(a, b) {
    if (!a || !b) return false;
    if (a.current_dur_id !== b.current_dur_id) return false;
    if (a.dur_entry_date !== b.dur_entry_date) return false;
    if (a.expert_notes !== b.expert_notes) return false;
    if (a.source !== b.source) return false;
    if (a.is_overridden !== b.is_overridden) return false;
    var arraysEqual = function (x, y) {
      if (!Array.isArray(x) || !Array.isArray(y)) return false;
      if (x.length !== y.length) return false;
      for (var i = 0; i < x.length; i += 1) {
        if (x[i] !== y[i]) return false;
      }
      return true;
    };
    return arraysEqual(a.weather_traits, b.weather_traits) &&
           arraysEqual(a.marine_traits, b.marine_traits) &&
           arraysEqual(a.general_traits, b.general_traits) &&
           arraysEqual(a.seasonal_traits, b.seasonal_traits) &&
           arraysEqual(a.fish_activity_traits, b.fish_activity_traits);
  }

  async function loadDururData() {
    try {
      var res = await apiFetch('/api?route=admin&path=durur', { method: 'GET' });
      if (!res.ok) throw new Error('durur_load_failed');
      var data = await res.json();
      dururCache = Array.isArray(data.items) ? data.items.map(normalizeDurRecordForUi) : [];
      globalDururManagementCache = dururCache.slice();
      var analysisDur = getEl('analysisDurFilter');
      if (analysisDur) {
        analysisDur.innerHTML = '<option value="">الكل</option>' + dururCache.slice().sort(function (a, b) { return Number(a.dur_number) - Number(b.dur_number); }).map(function (d) {
          return '<option value="' + (d.id || '') + '">' + (d.name || ('Dur ' + d.dur_number)) + '</option>';
        }).join('');
      }
      renderDururTable();
      applyDururFilters();
      renderGlobalDururList();
      renderGlobalDururEditor();
    } catch (e) {
      console.error('[durur] load failed', e);
    }
  }

  async function loadTraits() {
    try {
      var res = await apiFetch('/api?route=admin&path=trait-dictionaries', { method: 'GET' });
      if (!res.ok) throw new Error('traits_load_failed');
      var data = await res.json();
      traitsCache = Array.isArray(data.items) ? data.items : [];
      loadDururTraits();
    } catch (e) {
      console.error('[traits] load failed', e);
    }
  }

  function getDururReferenceStatusLabel(status) {
    if (status === 'approved') return 'معتمد';
    if (status === 'reviewed') return 'مراجع';
    if (status === 'draft') return 'مسودة';
    if (status === 'needs_revision') return 'يحتاج مراجعة';
    return 'غير معروف';
  }

  function filterDururReferenceItems() {
    var query = getEl('dururReferenceSearch') ? String(getEl('dururReferenceSearch').value || '').trim().toLowerCase() : '';
    var status = getEl('dururReferenceStatusFilter') ? String(getEl('dururReferenceStatusFilter').value || 'all') : 'all';
    var onlyReady = getEl('dururReferenceOverrideReady') ? getEl('dururReferenceOverrideReady').checked : false;
    return dururReferenceCache.filter(function (item) {
      if (status !== 'all' && String(item.review_status || 'draft') !== status) return false;
      if (onlyReady && !item.local_override_ready) return false;
      if (query) {
        var text = '' + (item.name_ar || '') + ' ' + (item.description || '') + ' ' + (item.notes || '');
        if (text.toLowerCase().indexOf(query) < 0) return false;
      }
      return true;
    });
  }

  function renderDururReferenceTable() {
    var body = getEl('dururReferenceBody');
    if (!body) return;
    var rows = filterDururReferenceItems();
    body.innerHTML = '';
    rows.forEach(function (item, idx) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
        '<td>' + (item.name_ar || '--') + '</td>' +
        '<td>' + (item.dur_number || '--') + '</td>' +
        '<td>' + getDururReferenceStatusLabel(item.review_status) + '</td>' +
        '<td>' + ((item.local_override_ready || false) ? 'نعم' : 'لا') + '</td>' +
        '<td><div class="inline-actions"><button class="small-btn" data-action="edit-durur-reference" data-id="' + (item.id || '') + '">تعديل</button><button class="small-btn danger" data-action="delete-durur-reference" data-id="' + (item.id || '') + '">حذف</button></div></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('button[data-action="edit-durur-reference"]').forEach(function (btn) {
      btn.addEventListener('click', function () { fillDururReferenceForm(btn.getAttribute('data-id')); });
    });
    body.querySelectorAll('button[data-action="delete-durur-reference"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!window.confirm('حذف المرجع نهائياً؟')) return;
        await apiFetch('/api?route=admin&path=durur-reference/' + encodeURIComponent(btn.getAttribute('data-id')), { method: 'DELETE' });
        await loadDururReferenceData();
      });
    });
  }

  function fillDururReferenceForm(id) {
    var item = dururReferenceCache.find(function (row) { return row.id === id; });
    if (!item) return;
    if (getEl('dururReferenceId')) getEl('dururReferenceId').value = item.id || '';
    if (getEl('dururReferenceNumber')) getEl('dururReferenceNumber').value = item.dur_number || '';
    if (getEl('dururReferenceName')) getEl('dururReferenceName').value = item.name_ar || '';
    if (getEl('dururReferenceSeason')) getEl('dururReferenceSeason').value = item.season_ar || '';
    if (getEl('dururReferenceZodiac')) getEl('dururReferenceZodiac').value = item.zodiac_ar || '';
    if (getEl('dururReferenceStatus')) getEl('dururReferenceStatus').value = item.review_status || 'draft';
    if (getEl('dururReferenceExpertReview')) getEl('dururReferenceExpertReview').checked = !!item.needs_expert_review;
    if (getEl('dururReferenceLocalReady')) getEl('dururReferenceLocalReady').checked = !!item.local_override_ready;
    if (getEl('dururReferenceWeatherTraits')) getEl('dururReferenceWeatherTraits').value = Array.isArray(item.weather_traits) ? item.weather_traits.join(',') : '';
    if (getEl('dururReferenceMarineTraits')) getEl('dururReferenceMarineTraits').value = Array.isArray(item.marine_traits) ? item.marine_traits.join(',') : '';
    if (getEl('dururReferenceFishTraits')) getEl('dururReferenceFishTraits').value = Array.isArray(item.fish_traits) ? item.fish_traits.join(',') : '';
    if (getEl('dururReferenceRelatedEvents')) getEl('dururReferenceRelatedEvents').value = Array.isArray(item.related_events) ? item.related_events.join(',') : '';
    if (getEl('dururReferenceNotes')) getEl('dururReferenceNotes').value = item.notes || '';
    setDururReferenceStatusMessage('جارٍ تحرير الدر المرجعي: ' + (item.name_ar || item.id || '--'), false);
  }

  function clearDururReferenceForm() {
    if (getEl('dururReferenceId')) getEl('dururReferenceId').value = '';
    if (getEl('dururReferenceNumber')) getEl('dururReferenceNumber').value = '';
    if (getEl('dururReferenceName')) getEl('dururReferenceName').value = '';
    if (getEl('dururReferenceSeason')) getEl('dururReferenceSeason').value = '';
    if (getEl('dururReferenceZodiac')) getEl('dururReferenceZodiac').value = '';
    if (getEl('dururReferenceStatus')) getEl('dururReferenceStatus').value = 'draft';
    if (getEl('dururReferenceExpertReview')) getEl('dururReferenceExpertReview').checked = false;
    if (getEl('dururReferenceLocalReady')) getEl('dururReferenceLocalReady').checked = false;
    if (getEl('dururReferenceWeatherTraits')) getEl('dururReferenceWeatherTraits').value = '';
    if (getEl('dururReferenceMarineTraits')) getEl('dururReferenceMarineTraits').value = '';
    if (getEl('dururReferenceFishTraits')) getEl('dururReferenceFishTraits').value = '';
    if (getEl('dururReferenceRelatedEvents')) getEl('dururReferenceRelatedEvents').value = '';
    if (getEl('dururReferenceNotes')) getEl('dururReferenceNotes').value = '';
    setDururReferenceStatusMessage('تم تفريغ النموذج.', false);
  }

  function readDururReferenceForm() {
    return {
      id: safeInput(getEl('dururReferenceId') ? getEl('dururReferenceId').value : '', 80),
      dur_number: Number(getEl('dururReferenceNumber') ? getEl('dururReferenceNumber').value : 0) || 0,
      name_ar: safeInput(getEl('dururReferenceName') ? getEl('dururReferenceName').value : '', 120),
      season_ar: safeInput(getEl('dururReferenceSeason') ? getEl('dururReferenceSeason').value : '', 120),
      zodiac_ar: safeInput(getEl('dururReferenceZodiac') ? getEl('dururReferenceZodiac').value : '', 120),
      review_status: getEl('dururReferenceStatus') ? getEl('dururReferenceStatus').value : 'draft',
      needs_expert_review: getEl('dururReferenceExpertReview') ? getEl('dururReferenceExpertReview').checked : false,
      local_override_ready: getEl('dururReferenceLocalReady') ? getEl('dururReferenceLocalReady').checked : false,
      weather_traits: (getEl('dururReferenceWeatherTraits') ? getEl('dururReferenceWeatherTraits').value : '').split(',').map(function (v) { return String(v || '').trim(); }).filter(Boolean),
      marine_traits: (getEl('dururReferenceMarineTraits') ? getEl('dururReferenceMarineTraits').value : '').split(',').map(function (v) { return String(v || '').trim(); }).filter(Boolean),
      fish_traits: (getEl('dururReferenceFishTraits') ? getEl('dururReferenceFishTraits').value : '').split(',').map(function (v) { return String(v || '').trim(); }).filter(Boolean),
      related_events: (getEl('dururReferenceRelatedEvents') ? getEl('dururReferenceRelatedEvents').value : '').split(',').map(function (v) { return String(v || '').trim(); }).filter(Boolean),
      notes: safeInput(getEl('dururReferenceNotes') ? getEl('dururReferenceNotes').value : '', 800),
      is_active: true
    };
  }

  function setDururReferenceStatusMessage(message, isError) {
    var statusEl = getEl('dururReferenceStatusMessage');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.style.color = isError ? '#d32f2f' : '#333';
  }

  async function loadDururReferenceData() {
    try {
      var res = await apiFetch('/api?route=admin&path=durur-reference', { method: 'GET' });
      if (!res.ok) throw new Error('durur_reference_load_failed');
      var data = await res.json();
      dururReferenceCache = Array.isArray(data.items) ? data.items : [];
      renderDururReferenceTable();
    } catch (e) {
      console.error('[durur-reference] load failed', e);
      dururReferenceCache = [];
    }
  }

  async function saveDururReferenceForm() {
    try {
      var payload = readDururReferenceForm();
      var endpoint = '/api?route=admin&path=durur-reference';
      if (payload.id) {
        endpoint += '/' + encodeURIComponent(payload.id);
      }
      var method = payload.id ? 'PUT' : 'POST';
      var res = await apiFetch(endpoint, { method: method, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('durur_reference_save_failed');
      await loadDururReferenceData();
      setDururReferenceStatusMessage('تم حفظ المرجع بنجاح.', false);
    } catch (e) {
      console.error('[durur-reference] save failed', e);
      setDururReferenceStatusMessage('فشل حفظ المرجع.', true);
    }
  }

  async function updateDururReferenceStatus(id, status) {
    try {
      var item = dururReferenceCache.find(function (row) { return row.id === id; });
      if (!item) {
        setDururReferenceStatusMessage('لم يتم العثور على در مرجعي للتحويل.', true);
        return;
      }
      var payload = {
        id: item.id,
        dur_number: item.dur_number,
        name_ar: item.name_ar,
        season_ar: item.season_ar,
        zodiac_ar: item.zodiac_ar,
        description: item.description,
        heritage_meaning: item.heritage_meaning,
        weather_traits: item.weather_traits || [],
        marine_traits: item.marine_traits || [],
        fish_traits: item.fish_traits || [],
        general_traits: item.general_traits || [],
        related_events: item.related_events || [],
        review_status: status,
        notes: item.notes || '',
        needs_expert_review: item.needs_expert_review || false,
        local_override_ready: item.local_override_ready || false,
        is_active: item.is_active != null ? item.is_active : true,
        created_at: item.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reviewed_at: status === 'reviewed' ? new Date().toISOString() : item.reviewed_at || null,
        approved_at: status === 'approved' ? new Date().toISOString() : (status === 'draft' ? null : item.approved_at || null)
      };
      var res = await apiFetch('/api?route=admin&path=durur-reference/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('durur_reference_status_failed');
      await loadDururReferenceData();
      setDururReferenceStatusMessage('تم تحديث حالة المراجعة إلى ' + getDururReferenceStatusLabel(status) + '.', false);
    } catch (e) {
      console.error('[durur-reference] status update failed', e);
      setDururReferenceStatusMessage('فشل تحديث حالة المراجعة.', true);
    }
  }

  async function markSelectedDururReferenceStatus(status) {
    var id = getEl('dururReferenceId') ? getEl('dururReferenceId').value : '';
    if (!id) {
      setDururReferenceStatusMessage('اختر در مرجعي أولاً.', true);
      return;
    }
    await updateDururReferenceStatus(id, status);
  }

  async function loadSeasonEvents() {
    try {
      var res = await apiFetch('/api?route=admin&path=season-events', { method: 'GET' });
      if (!res.ok) throw new Error('season_events_load_failed');
      var data = await res.json();
      seasonEventsCache = Array.isArray(data.items) ? data.items : [];
      renderSeasonEventsTable();
      applyDururFilters();
    } catch (e) {
      console.error('[season-events] load failed', e);
    }
  }

  async function loadStationProfiles() {
    try {
      var res = await apiFetch('/api?route=admin&path=station-dur-profiles', { method: 'GET' });
      if (!res.ok) throw new Error('station_profiles_load_failed');
      var data = await res.json();
      stationProfilesCache = Array.isArray(data.items) ? data.items : [];
      renderProfileTable();
    } catch (e) {
      console.error('[station-dur-profiles] load failed', e);
    }
  }

  async function loadStationOverrides() {
    try {
      var res = await apiFetch('/api?route=admin&path=station-dur-overrides', { method: 'GET' });
      if (!res.ok) throw new Error('station_overrides_load_failed');
      var data = await res.json();
      stationOverridesCache = Array.isArray(data.items) ? data.items : [];
      renderOverrideTable();
    } catch (e) {
      console.error('[station-dur-overrides] load failed', e);
    }
  }

  async function loadAnnualComparisons() {
    try {
      var res = await apiFetch('/api?route=admin&path=annual-comparisons', { method: 'GET' });
      if (!res.ok) throw new Error('annual_comparisons_load_failed');
      var data = await res.json();
      annualComparisonsCache = Array.isArray(data.items) ? data.items : [];
      renderAnalysisOptions();
      renderComparisonTable();
      renderAnalysisResults();
    } catch (e) {
      console.error('[annual-comparisons] load failed', e);
    }
  }

  function renderDururTable() {
    var body = getEl('dururBody');
    if (!body) return;
    body.innerHTML = '';
    dururCache.forEach(function (d, idx) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
        '<td>' + (d.name || '--') + '</td>' +
        '<td>' + (d.dur_number || '--') + '</td>' +
        '<td>' + getDurDateLabel(d) + '</td>' +
        '<td>' + (d.is_active !== false ? 'نشط' : 'معطل') + '</td>' +
        '<td><div class="inline-actions"><button class="small-btn" data-action="edit-dur" data-id="' + (d.id || '') + '">تعديل</button><button class="small-btn danger" data-action="delete-dur" data-id="' + (d.id || '') + '">حذف</button></div></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('button[data-action="edit-dur"]').forEach(function (btn) {
      btn.addEventListener('click', function () { fillDurForm(btn.getAttribute('data-id')); });
    });
    body.querySelectorAll('button[data-action="delete-dur"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!window.confirm('حذف الدر نهائياً؟')) return;
        await apiFetch('/api?route=admin&path=durur/' + encodeURIComponent(btn.getAttribute('data-id')), { method: 'DELETE' });
        await loadDururData();
      });
    });
  }

  function renderSeasonEventsTable() {
    var body = getEl('seasonEventsBody');
    if (!body) return;
    body.innerHTML = '';
    seasonEventsCache.forEach(function (e, idx) {
      var related = Array.isArray(e.related_dur_ids) ? e.related_dur_ids.join(', ') : '--';
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
        '<td>' + (e.name || '--') + '</td>' +
        '<td>' + getDurDateLabel(e) + '</td>' +
        '<td>' + related + '</td>' +
        '<td>' + (e.is_active !== false ? 'نشط' : 'معطل') + '</td>' +
        '<td><div class="inline-actions"><button class="small-btn" data-action="edit-event" data-id="' + (e.id || '') + '">تعديل</button><button class="small-btn danger" data-action="delete-event" data-id="' + (e.id || '') + '">حذف</button></div></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('button[data-action="edit-event"]').forEach(function (btn) {
      btn.addEventListener('click', function () { fillEventForm(btn.getAttribute('data-id')); });
    });
    body.querySelectorAll('button[data-action="delete-event"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!window.confirm('حذف الحدث نهائياً؟')) return;
        await apiFetch('/api?route=admin&path=season-events/' + encodeURIComponent(btn.getAttribute('data-id')), { method: 'DELETE' });
        await loadSeasonEvents();
      });
    });
  }

  function renderAnalysisOptions() {
    var stationFilter = getEl('analysisStationFilter');
    if (stationFilter) {
      stationFilter.innerHTML = '<option value="">الكل</option>' + stationsCache.map(function (s) { return '<option value="' + (s.id || '') + '">' + (s.name || s.id || '--') + '</option>'; }).join('');
    }
    var durFilter = getEl('analysisDurFilter');
    if (durFilter) {
      durFilter.innerHTML = '<option value="">الكل</option>' + dururCache.map(function (d) { return '<option value="' + (d.id || '') + '">' + (d.name || d.dur_number || '--') + '</option>'; }).join('');
    }
    setComparisonOptions();
  }

  function renderAnalysisResults() {
    renderComparisonTable();
  }

  function isAdminMode() {
    return !!(adminAuthenticated && (!me || me.role === 'admin' || me.role === 'super_admin'));
  }

  function parseStoredBooleanFlag(value) {
    if (value === true) return true;
    if (value === false) return false;
    if (value == null || value === '') return false;
    if (typeof value === 'string') {
      var s = value.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no') return false;
    }
    if (typeof value === 'number') return value !== 0;
    return false;
  }

  function readStationLatLon(row) {
    var r = row || {};
    var latRaw = r.lat != null ? r.lat : r.latitude;
    var lonRaw = r.lon != null ? r.lon : (r.lng != null ? r.lng : r.longitude);
    return { lat: Number(latRaw), lon: Number(lonRaw) };
  }

  function normalizeAdminStationRecord(station) {
    var row = station && typeof station === 'object' ? Object.assign({}, station) : {};
    var coord = readStationLatLon(row);
    var base = Object.assign({}, row);
    if (Number.isFinite(coord.lat)) base.lat = coord.lat;
    if (Number.isFinite(coord.lon)) base.lon = coord.lon;
    var refFlag = parseStoredBooleanFlag(row.is_reference_station);
    return Object.assign(base, {
      is_reference_station: refFlag,
      is_operational_station: row.is_operational_station !== false,
      operational_visibility: row.operational_visibility !== false,
      reference_anchor_mode: row.reference_anchor_mode || (refFlag ? 'coastal_land_anchor' : null),
      is_verified: !!row.is_verified,
      reference_priority: row.reference_priority != null && Number.isFinite(Number(row.reference_priority)) ? Number(row.reference_priority) : null,
      latitude_band_key: row.latitude_band_key || null,
      manual_suhail_anchor_date: row.manual_suhail_anchor_date || null,
      manual_cycle_start_date: row.manual_cycle_start_date || null,
      calibration_notes: row.calibration_notes || null
    });
  }

  function getAdminReferenceOnlyEnabled() {
    return !!(getEl('stationsReferenceOnlyToggle') && getEl('stationsReferenceOnlyToggle').checked);
  }

  function isReferenceAnchorDraft() {
    var checkbox = getEl('stIsReferenceStation');
    return !!(checkbox && checkbox.checked);
  }

  function getReferenceStationCount(rows) {
    return (Array.isArray(rows) ? rows : stationsCache).filter(isReferenceCalibrationStation).length;
  }

  function hasValidStationCoords(station) {
    var c = readStationLatLon(station);
    return !!(station && Number.isFinite(c.lat) && Number.isFinite(c.lon));
  }

  function getReferenceStationSamples(rows, limit) {
    return (Array.isArray(rows) ? rows : stationsCache)
      .filter(isReferenceCalibrationStation)
      .slice(0, Math.max(0, Number(limit) || 3))
      .map(function (station) {
        return {
          name: station.name || station.id || '--',
          lat: Number(station.lat),
          lon: Number(station.lon)
        };
      });
  }

  function getInvalidReferenceStations(rows) {
    return (Array.isArray(rows) ? rows : stationsCache)
      .filter(isReferenceCalibrationStation)
      .filter(function (station) { return !hasValidStationCoords(station); })
      .map(function (station) {
        return {
          name: station.name || station.id || '--',
          lat: station.lat,
          lon: station.lon
        };
      });
  }

  function countDrawableReferenceStations(list) {
    return (Array.isArray(list) ? list : []).filter(function (s) {
      return isReferenceCalibrationStation(s) && hasValidStationCoords(s);
    }).length;
  }

  function getVisibleAdminStations() {
    var referenceOnly = getAdminReferenceOnlyEnabled();
    return stationsCache.filter(function (st) {
      var isRef = isReferenceCalibrationStation(st);
      if (referenceOnly) return isRef;
      return hasValidStationCoords(st) || isRef;
    });
  }

  function fitAdminMapToStations(rows) {
    if (!stationsAdminMapState || !window.NavidurStationMap || !Array.isArray(rows) || !rows.length) return;
    window.NavidurStationMap.fitBoundsToStations(stationsAdminMapState, rows, {
      padding: [24, 24],
      maxZoom: 7,
      singleZoom: 6
    });
  }

  function renderAdminStationsTable(stations) {
    var body = getEl('stationsBody');
    if (!body) return;
    var rows = Array.isArray(stations) ? stations : [];
    body.innerHTML = '';
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8ea4ba">لا توجد محطات مطابقة للفلتر الحالي.</td></tr>';
      return;
    }
    rows.forEach(function (st, idx) {
      var isGulf = (st.region || '').toLowerCase() === 'gulf';
      var regionBg = isGulf ? 'rgba(255,185,0,.18)' : 'rgba(39,179,255,.12)';
      var regionBorder = isGulf ? 'rgba(255,185,0,.5)' : 'rgba(39,179,255,.3)';
      var regionLabel = isGulf ? ('\u26a0 ' + (st.region || '--')) : (st.region || '--');
      var isReference = isReferenceCalibrationStation(st);

      var fm = String(st.fishing_mode || '').toLowerCase();
      var fmBadge;
      if (fm === 'deep') {
        fmBadge = '<span style="background:rgba(100,200,100,.15);border:1px solid rgba(100,200,100,.4);border-radius:6px;padding:2px 7px;font-size:12px">\u0639\u0645\u0642</span>';
      } else if (fm === 'coastal') {
        fmBadge = '<span style="background:rgba(39,179,255,.12);border:1px solid rgba(39,179,255,.3);border-radius:6px;padding:2px 7px;font-size:12px">\u0633\u0627\u062d\u0644\u064a</span>';
      } else {
        fmBadge = '<span style="background:rgba(255,100,0,.18);border:1px solid rgba(255,100,0,.5);border-radius:6px;padding:2px 7px;font-size:12px">\u26a0 \u0644\u0645 \u064a\u064f\u062d\u062f\u062f</span>';
      }

      var tr = document.createElement('tr');
      if (isReference) tr.style.background = 'rgba(255,82,82,.05)';
      tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
        '<td><strong style="' + (isReference ? 'color:#ffd0d0' : '') + '">' + st.name + '</strong><br><span style="font-size:11px;color:#8ea4ba">' + st.id + '</span><div>' + buildReferenceBadgeHtml(st) + '</div></td>' +
        '<td><span style="background:' + regionBg + ';border:1px solid ' + regionBorder + ';border-radius:6px;padding:2px 7px;font-size:12px">' + regionLabel + '</span></td>' +
        '<td>' + (st.country || '--') + '</td>' +
        '<td>' + fmBadge + '</td>' +
        '<td>' + stationStatusBadge(st.status) + '</td>' +
        '<td>' + (st.default_radius != null ? st.default_radius : '--') + '</td>' +
        '<td>' +
          '<div class="inline-actions">' +
            '<button type="button" class="small-btn" data-action="edit" data-id="' + st.id + '">تعديل</button>' +
            '<button type="button" class="small-btn warn" data-action="toggle" data-id="' + st.id + '">' + (st.status === 'disabled' ? 'تفعيل' : 'تعطيل') + '</button>' +
            '<button type="button" class="small-btn danger" data-action="delete" data-id="' + st.id + '" data-name="' + (st.name || '').replace(/"/g, '&quot;') + '">حذف</button>' +
          '</div>' +
        '</td>';
      body.appendChild(tr);
    });
  }

  async function handleStationsTableAction(action, id, btn) {
    var station = stationsCache.find(function (s) { return String(s.id) === String(id); });
    if (!station) return;
    if (action === 'edit') {
      fillStationForm(station);
      selectDururStation(station.id, { centerMap: false, triggerAnalysis: false });
      selectStationForAnalysis(station);
      return;
    }
    if (action === 'toggle') {
      var nextStatus = station.status === 'disabled' ? 'active' : 'disabled';
      await apiFetch('/api?route=admin&path=stations/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      await loadStations();
      return;
    }
    if (action === 'delete') {
      var stName = btn && btn.getAttribute ? (btn.getAttribute('data-name') || id) : id;
      if (!window.confirm('حذف نهائي للمحطة "' + stName + '"؟\nلا يمكن التراجع عن هذا الإجراء.')) return;
      var delRes = await apiFetch('/api?route=admin&path=stations/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!delRes.ok) {
        var delErr = '';
        try { delErr = await delRes.text(); } catch (_) {}
        alert('فشل الحذف: ' + (delErr || delRes.status));
        return;
      }
      allStationMarkersList = allStationMarkersList.filter(function (m) {
        if (m.id === id) { if (stationsAdminMap) stationsAdminMap.removeLayer(m.marker); return false; }
        return true;
      });
      await loadStations();
    }
  }

  function initStationsTableDelegation() {
    var body = getEl('stationsBody');
    if (!body || stationsBodyClickDelegationBound) return;
    stationsBodyClickDelegationBound = true;
    body.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest('button[data-action]');
      if (!btn || !body.contains(btn)) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');
      if (!action || !id) return;
      ev.preventDefault();
      void handleStationsTableAction(action, id, btn);
    });
  }

  function getAdminMapTimingDetails(station) {
    var timingDur = currentStationAnalysisDto && currentStationAnalysisDto.station_id === station.id
      ? currentStationAnalysisDto.dur
      : null;
    return {
      timing_source: timingDur && timingDur.timing_source || '',
      timing_source_label_ar: timingDur ? getTimingSourceLabel(timingDur) : '--',
      suhail_anchor_date: timingDur && timingDur.suhail_anchor_date || '',
      cycle_start_date: timingDur && timingDur.cycle_start_date || ''
    };
  }

  function createDururPopupContent(station) {
    var timing = getAdminMapTimingDetails(station);
    var refId = (station && station.reference_station_id) ? String(station.reference_station_id).trim() : '';
    var refNameLine = '';
    if (!isReferenceCalibrationStation(station) && refId) {
      var refForPopup = stationsCache.find(function (s) { return s && s.id === refId; });
      var refDisp = (refForPopup && refForPopup.name) ? refForPopup.name : refId;
      refNameLine = '<div>مرجع DUR/التوقيت: ' + escapeHtml(refDisp) + '</div>';
    } else if (!isReferenceCalibrationStation(station) && !refId) {
      refNameLine = '<div>مرجع DUR/التوقيت: —</div>';
    }
    return ''
      + '<div style="text-align:right;line-height:1.5;font-size:.9rem">'
      + '<strong>' + escapeHtml(station.name || station.id || '--') + '</strong>'
      + (isReferenceCalibrationStation(station) ? '<div style="margin:4px 0 6px">' + buildReferenceBadgeHtml(station) + '</div>' : '')
      + '<div>الحالة: ' + escapeHtml(station.status || '--') + '</div>'
      + '<div>مرجع معايرة: ' + escapeHtml(station.is_reference_station ? 'نعم' : 'لا') + '</div>'
      + refNameLine
      + '<div>موثق: ' + escapeHtml(station.is_verified ? 'نعم' : 'لا') + '</div>'
      + '<div>حزام العرض: ' + escapeHtml(station.latitude_band_key || '--') + '</div>'
      + '<div>مصدر التوقيت: ' + escapeHtml(timing.timing_source_label_ar || '--') + '</div>'
      + '<div>مرساة سهيل النهائية: ' + escapeHtml(timing.suhail_anchor_date || '--') + '</div>'
      + '<div>بداية الدورة النهائية: ' + escapeHtml(timing.cycle_start_date || '--') + '</div>'
      + '</div>';
  }

  function selectDururStation(stationId, options) {
    options = options || {};
    selectedDururStationId = stationId || null;
    renderDururStationPreview();
    var target = getEl('dururStationInfoContent');
    if (!stationId) {
      if (target) target.innerHTML = '<div class="durur-empty-state">اختر محطة من الخريطة المشتركة لعرض تفاصيلها هنا.</div>';
      refreshAllStationMarkers();
      return;
    }
    var station = stationsCache.find(function (s) { return s.id === stationId; });
    if (!station) return;
    fillSelectedStationForms(station);
    refreshAllStationMarkers();
    if (stationsAdminMapState) {
      if (options.centerMap !== false) {
        window.NavidurStationMap.focusStation(stationsAdminMapState, station, 9, false);
      }
      if (options.openPopup) {
        window.NavidurStationMap.openPopupForStation(stationsAdminMapState, station.id);
      }
    }
    var dur = getCurrentDurForDate(new Date());
    var profile = getDururProfileForStation(station);
    var events = getSeasonEventsForDur(dur);
    var comparison = getComparisonForStationDur(station, dur);
    var timingDur = currentStationAnalysisDto && currentStationAnalysisDto.station_id === stationId ? currentStationAnalysisDto.dur : null;
    var html = '<div style="font-size:0.95rem;line-height:1.5">';
    html += '<strong>' + (station.name || '--') + '</strong><br>';
    if (isReferenceCalibrationStation(station)) {
      html += '<div style="margin:4px 0 6px">' + buildReferenceBadgeHtml(station) + '</div>';
    }
    html += '<div><strong>المعرف التقني:</strong> <span style="font-size:.78rem;color:#8fb4c8">' + (station.id || '--') + '</span></div>';
    html += '<div><strong>الدولة:</strong> ' + (station.country || '--') + '</div>';
    html += '<div><strong>المنطقة:</strong> ' + (station.region || '--') + '</div>';
    html += '<div><strong>الإحداثيات:</strong> ' + (station.lat || '--') + ', ' + (station.lon || '--') + '</div>';
    html += '<div><strong>نوع المحطة:</strong> ' + (station.station_role_type || '--') + '</div>';
    html += '<div><strong>مرجعية كبرى:</strong> ' + (station.primary_reference ? 'نعم' : 'لا') + '</div>';
    html += '<div><strong>مرجع معايرة:</strong> ' + (isReferenceCalibrationStation(station) ? 'نعم' : 'لا') + '</div>';
    html += '<div><strong>موثق:</strong> ' + (station.is_verified ? 'نعم' : 'لا') + '</div>';
    html += '<div><strong>مفتاح الحزام:</strong> ' + (station.latitude_band_key || '--') + '</div>';
    html += '<div><strong>مرساة سهيل اليدوية:</strong> ' + (station.manual_suhail_anchor_date || '--') + '</div>';
    html += '<div><strong>بداية الدورة اليدوية:</strong> ' + (station.manual_cycle_start_date || '--') + '</div>';
    (function () {
      var refId0 = (station.reference_station_id || '').trim();
      if (isReferenceCalibrationStation(station)) {
        html += '<div><strong>توقيت DUR:</strong> هذه المحطة مرجعية (مصدر التوقيت منها مباشرة، لا مرتبط بمرجع آخر)</div>';
        return;
      }
      if (refId0) {
        var refS = stationsCache.find(function (s) { return s && s.id === refId0; });
        var refDisp = (refS && (refS.name || refS.id)) ? (refS.name + ' (' + refId0 + ')') : refId0;
        html += '<div><strong>توقيت DUR/الدور يرتبط بمحطة:</strong> ' + escapeHtml(refDisp) + '</div>';
        if (station.reference_inheritance && station.reference_inheritance.method) {
          html += '<div><strong>طريقة ربط المرجع:</strong> ' + escapeHtml(getReferenceInheritanceMethodLabelAr(station.reference_inheritance.method)) + '</div>';
        }
      } else {
        html += '<div><strong>توقيت DUR/الدور يرتبط بمحطة:</strong> — (لم تُعيّن)</div>';
      }
    }());
    if (timingDur) {
      html += '<div><strong>مصدر التوقيت الحالي:</strong> ' + getTimingSourceLabel(timingDur) + '</div>';
      html += '<div><strong>سبب الاختيار:</strong> ' + getCalibrationReasonLabel(timingDur.calibration_selection_reason) + '</div>';
      html += '<div><strong>المرجع المستخدم:</strong> ' + (timingDur.calibration_reference_station_name || '--') + '</div>';
      html += '<div><strong>مرساة سهيل النهائية:</strong> ' + (timingDur.suhail_anchor_date || '--') + '</div>';
      html += '<div><strong>بداية الدورة النهائية:</strong> ' + (timingDur.cycle_start_date || '--') + '</div>';
    }
    html += '<div><strong>الدر الحالي:</strong> ' + (dur ? dur.name : '--') + '</div>';
    if (dur) {
      html += '<div><strong>مدى الدر:</strong> ' + getDurDateLabel(dur) + '</div>';
      html += '<div><strong>المعنى التراثي:</strong> ' + (dur.heritage_meaning || '--') + '</div>';
    }
    html += '<div><strong>المعرفة المحلية:</strong> ' + (profile ? (profile.local_definition || '--') : '--') + '</div>';
    html += '<div><strong>الأحداث الموسمية:</strong> ' + (events.length ? events.map(function (e) { return e.name; }).join(', ') : '--') + '</div>';
    if (comparison) {
      html += '<div><strong>تطابق سنوي:</strong> ' + ((Number(comparison.match_score) * 100).toFixed(0) + '%') + '</div>';
      html += '<div><strong>ملاحظات:</strong> ' + (comparison.notes || '--') + '</div>';
    }
    html += '<div><strong>الملاحظات:</strong> ' + (station.notes || '--') + '</div>';
    html += '</div>';
    if (target) target.innerHTML = html;
    if (options.triggerAnalysis !== false) {
      currentAnalyzedStationId = stationId;
      void renderStationAnalytics();
    }
  }

  function fillDurForm(id) {
    var dur = dururCache.find(function (d) { return d.id === id; });
    if (!dur) return;
    getEl('durId').value = dur.id || '';
    getEl('durNumber').value = dur.dur_number || '';
    getEl('durName').value = dur.name || '';
    getEl('durActive').checked = dur.is_active !== false;
    getEl('durDaysCount').value = dur.days_count || '';
    getEl('durStartMonth').value = dur.gregorian_start_month || '';
    getEl('durStartDay').value = dur.gregorian_start_day || '';
    getEl('durEndMonth').value = dur.gregorian_end_month || '';
    getEl('durEndDay').value = dur.gregorian_end_day || '';
    getEl('durDescription').value = dur.description || '';
    getEl('durHeritageMeaning').value = dur.heritage_meaning || '';
    getEl('durWeatherTraits').value = Array.isArray(dur.weather_traits) ? dur.weather_traits.join(',') : '';
    getEl('durMarineTraits').value = Array.isArray(dur.marine_traits) ? dur.marine_traits.join(',') : '';
    getEl('durFishTraits').value = Array.isArray(dur.fish_traits) ? dur.fish_traits.join(',') : '';
    getEl('durNotes').value = dur.notes || '';
  }

  function fillEventForm(id) {
    var ev = seasonEventsCache.find(function (e) { return e.id === id; });
    if (!ev) return;
    getEl('eventId').value = ev.id || '';
    getEl('eventName').value = ev.name || '';
    getEl('eventActive').checked = ev.is_active !== false;
    getEl('eventStartMonth').value = ev.start_month || '';
    getEl('eventStartDay').value = ev.start_day || '';
    getEl('eventEndMonth').value = ev.end_month || '';
    getEl('eventEndDay').value = ev.end_day || '';
    getEl('eventDaysCount').value = ev.days_count || '';
    getEl('eventRelatedDurIds').value = Array.isArray(ev.related_dur_ids) ? ev.related_dur_ids.join(',') : '';
    getEl('eventTraits').value = Array.isArray(ev.traits) ? ev.traits.join(',') : '';
    getEl('eventDescription').value = ev.description || '';
  }

  function readDurForm() {
    return {
      id: getEl('durId').value.trim() || undefined,
      dur_number: Number(getEl('durNumber').value || 0),
      name: getEl('durName').value.trim(),
      is_active: getEl('durActive').checked,
      days_count: Number(getEl('durDaysCount').value || 0),
      gregorian_start_month: Number(getEl('durStartMonth').value || 0),
      gregorian_start_day: Number(getEl('durStartDay').value || 0),
      gregorian_end_month: Number(getEl('durEndMonth').value || 0),
      gregorian_end_day: Number(getEl('durEndDay').value || 0),
      description: getEl('durDescription').value.trim(),
      heritage_meaning: getEl('durHeritageMeaning').value.trim(),
      weather_traits: splitCsv(getEl('durWeatherTraits').value),
      marine_traits: splitCsv(getEl('durMarineTraits').value),
      fish_traits: splitCsv(getEl('durFishTraits').value),
      notes: getEl('durNotes').value.trim()
    };
  }

  function readEventForm() {
    return {
      id: getEl('eventId').value.trim() || undefined,
      name: getEl('eventName').value.trim(),
      is_active: getEl('eventActive').checked,
      start_month: Number(getEl('eventStartMonth').value || 0),
      start_day: Number(getEl('eventStartDay').value || 0),
      end_month: Number(getEl('eventEndMonth').value || 0),
      end_day: Number(getEl('eventEndDay').value || 0),
      days_count: Number(getEl('eventDaysCount').value || 0),
      related_dur_ids: splitCsv(getEl('eventRelatedDurIds').value),
      traits: splitCsv(getEl('eventTraits').value),
      description: getEl('eventDescription').value.trim()
    };
  }

  function clearDurForm() {
    getEl('durId').value = '';
    getEl('durNumber').value = '';
    getEl('durName').value = '';
    getEl('durActive').checked = true;
    getEl('durDaysCount').value = '';
    getEl('durStartMonth').value = '';
    getEl('durStartDay').value = '';
    getEl('durEndMonth').value = '';
    getEl('durEndDay').value = '';
    getEl('durDescription').value = '';
    getEl('durHeritageMeaning').value = '';
    getEl('durWeatherTraits').value = '';
    getEl('durMarineTraits').value = '';
    getEl('durFishTraits').value = '';
    getEl('durNotes').value = '';
  }

  function clearEventForm() {
    getEl('eventId').value = '';
    getEl('eventName').value = '';
    getEl('eventActive').checked = true;
    getEl('eventStartMonth').value = '';
    getEl('eventStartDay').value = '';
    getEl('eventEndMonth').value = '';
    getEl('eventEndDay').value = '';
    getEl('eventDaysCount').value = '';
    getEl('eventRelatedDurIds').value = '';
    getEl('eventTraits').value = '';
    getEl('eventDescription').value = '';
  }

  async function saveDurForm() {
    try {
      var payload = readDurForm();
      var btnStatus = getEl('durStatus');
      if (btnStatus) btnStatus.textContent = 'جاري الحفظ...';
      var res = await apiFetch('/api?route=admin&path=durur', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('dur_save_failed');
      if (btnStatus) btnStatus.textContent = 'تم الحفظ.';
      clearDurForm();
      await loadDururData();
    } catch (err) {
      var btnStatus = getEl('durStatus');
      if (btnStatus) btnStatus.textContent = 'فشل حفظ الدر: ' + (err && err.message ? err.message : 'error');
    }
  }

  async function saveEventForm() {
    try {
      var payload = readEventForm();
      var btnStatus = getEl('eventStatus');
      if (btnStatus) btnStatus.textContent = 'جاري الحفظ...';
      var res = await apiFetch('/api?route=admin&path=season-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('event_save_failed');
      if (btnStatus) btnStatus.textContent = 'تم الحفظ.';
      clearEventForm();
      await loadSeasonEvents();
    } catch (err) {
      var btnStatus = getEl('eventStatus');
      if (btnStatus) btnStatus.textContent = 'فشل حفظ الحدث: ' + (err && err.message ? err.message : 'error');
    }
  }

  async function saveStationTypeUpdate() {
    if (!selectedDururStationId) {
      var status = getEl('stationTypeStatus');
      if (status) status.textContent = 'اختر محطة من الخريطة أولاً.';
      return;
    }
    try {
      var station = stationsCache.find(function (s) { return s.id === selectedDururStationId; });
      if (!station) throw new Error('station_not_selected');
      var payload = {
        id: station.id,
        station_role_type: getEl('refStRoleType').value,
        primary_reference: !!getEl('refStPrimaryReference').checked,
        is_reference_station: !!getEl('refStIsReferenceStation').checked,
        is_verified: !!getEl('refStIsVerified').checked,
        reference_station_id: getEl('refStReferenceStation').value.trim(),
        reference_priority: getEl('refStReferencePriority').value ? Number(getEl('refStReferencePriority').value) : null,
        latitude_band_key: getEl('refStLatitudeBandKey').value.trim() || null,
        manual_suhail_anchor_date: getEl('refStManualSuhailAnchorDate').value || null,
        manual_cycle_start_date: getEl('refStManualCycleStartDate').value || null,
        calibration_notes: getEl('refStCalibrationNotes').value.trim() || null,
        notes: getEl('refStLocalNotes').value.trim()
      };
      var res = await apiFetch('/api?route=admin&path=stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('station_type_save_failed');
      var data = await res.json();
      var status = getEl('stationTypeStatus');
      if (status) status.textContent = 'تم تحديث خصائص المحطة.';
      await loadStations();
      if (data.station) selectDururStation(data.station.id);
    } catch (err) {
      var status = getEl('stationTypeStatus');
      if (status) status.textContent = 'فشل التحديث: ' + (err && err.message ? err.message : 'error');
    }
  }

  function fillSelectedStationForms(station) {
    if (!station) return;
    selectedDururStationId = station.id;
    fillReferenceStationEditor(station);
    getEl('profileStationId').value = station.id;
    getEl('profileStationName').value = station.name || station.id || '';
    getEl('overrideStationId').value = station.id;
    getEl('overrideStationName').value = station.name || station.id || '';
    renderProfileTable();
    renderOverrideTable();
  }

  function fillReferenceStationEditor(station) {
    if (!station) return;
    selectedDururStationId = station.id;
    getEl('refStRoleType').value = station.station_role_type || 'secondary_linked';
    getEl('refStPrimaryReference').checked = !!station.primary_reference;
    getEl('refStIsReferenceStation').checked = !!station.is_reference_station;
    getEl('refStIsVerified').checked = !!station.is_verified;
    getEl('refStReferenceStation').value = station.reference_station_id || '';
    getEl('refStReferencePriority').value = station.reference_priority != null ? station.reference_priority : '';
    getEl('refStLatitudeBandKey').value = station.latitude_band_key || '';
    getEl('refStManualSuhailAnchorDate').value = station.manual_suhail_anchor_date || '';
    getEl('refStManualCycleStartDate').value = station.manual_cycle_start_date || '';
    getEl('refStCalibrationNotes').value = station.calibration_notes || '';
    getEl('refStLocalNotes').value = station.notes || '';
  }

  function fillProfileForm(profile) {
    getEl('profileId').value = profile.id || '';
    getEl('profileStationId').value = profile.station_id || '';
    getEl('profileStationName').value = (stationsCache.find(function (s) { return s.id === profile.station_id; }) || {}).name || profile.station_id || '';
    getEl('profileLocalDefinition').value = profile.local_definition || '';
    getEl('profileExpertSummary').value = profile.expert_summary || '';
    getEl('profileNotes').value = profile.notes || '';
    getEl('profileActive').checked = profile.is_active !== false;
  }

  function fillOverrideForm(override) {
    getEl('overrideId').value = override.id || '';
    getEl('overrideStationId').value = override.station_id || '';
    getEl('overrideStationName').value = (stationsCache.find(function (s) { return s.id === override.station_id; }) || {}).name || override.station_id || '';
    getEl('overrideDurNumber').value = override.dur_number || '';
    getEl('overrideStartOffset').value = override.start_offset_days || 0;
    getEl('overrideEndOffset').value = override.end_offset_days || 0;
    getEl('overrideLocalNotes').value = override.local_notes || '';
    getEl('overrideActive').checked = override.is_active !== false;
  }

  function clearProfileForm() {
    getEl('profileId').value = '';
    getEl('profileLocalDefinition').value = '';
    getEl('profileExpertSummary').value = '';
    getEl('profileNotes').value = '';
    getEl('profileActive').checked = true;
  }

  function clearOverrideForm() {
    getEl('overrideId').value = '';
    getEl('overrideDurNumber').value = '';
    getEl('overrideStartOffset').value = '';
    getEl('overrideEndOffset').value = '';
    getEl('overrideLocalNotes').value = '';
    getEl('overrideActive').checked = true;
  }

  function readProfileForm() {
    return {
      id: getEl('profileId').value.trim() || undefined,
      station_id: getEl('profileStationId').value.trim(),
      local_definition: getEl('profileLocalDefinition').value.trim(),
      expert_summary: getEl('profileExpertSummary').value.trim(),
      notes: getEl('profileNotes').value.trim(),
      is_active: getEl('profileActive').checked
    };
  }

  function readOverrideForm() {
    return {
      id: getEl('overrideId').value.trim() || undefined,
      station_id: getEl('overrideStationId').value.trim(),
      dur_number: Number(getEl('overrideDurNumber').value || 0),
      start_offset_days: Number(getEl('overrideStartOffset').value || 0),
      end_offset_days: Number(getEl('overrideEndOffset').value || 0),
      local_notes: getEl('overrideLocalNotes').value.trim(),
      is_active: getEl('overrideActive').checked
    };
  }

  async function saveProfileForm() {
    var status = getEl('profileStatus');
    try {
      var payload = readProfileForm();
      if (!payload.station_id) throw new Error('station_id_required');
      if (status) status.textContent = 'جاري الحفظ...';
      var res = await apiFetch('/api?route=admin&path=station-dur-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('profile_save_failed');
      var data = await res.json();
      if (status) status.textContent = 'تم حفظ الملف المحلي.';
      clearProfileForm();
      await loadStationProfiles();
      if (data.item) fillProfileForm(data.item);
    } catch (err) {
      if (status) status.textContent = 'فشل حفظ الملف: ' + (err && err.message ? err.message : 'error');
    }
  }

  async function saveOverrideForm() {
    var status = getEl('overrideStatus');
    try {
      var payload = readOverrideForm();
      if (!payload.station_id) throw new Error('station_id_required');
      if (status) status.textContent = 'جاري الحفظ...';
      var res = await apiFetch('/api?route=admin&path=station-dur-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('override_save_failed');
      var data = await res.json();
      if (status) status.textContent = 'تم حفظ التعديل المحلي.';
      clearOverrideForm();
      await loadStationOverrides();
      if (data.item) fillOverrideForm(data.item);
    } catch (err) {
      if (status) status.textContent = 'فشل حفظ التعديل: ' + (err && err.message ? err.message : 'error');
    }
  }

  function renderProfileTable() {
    var body = getEl('stationProfilesBody');
    if (!body) return;
    body.innerHTML = stationProfilesCache.map(function (item, idx) {
      var station = stationsCache.find(function (s) { return s.id === item.station_id; }) || {};
      return '<tr><td>' + (idx + 1) + '</td>' +
        '<td>' + (station.name || item.station_id || '--') + '</td>' +
        '<td>' + (item.is_active !== false ? 'نشط' : 'معطل') + '</td>' +
        '<td><button class="small-btn" data-action="edit-profile" data-id="' + (item.id || '') + '">اختر</button></td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:#8ea4ba">لا توجد ملفات محلية.</td></tr>';
    body.querySelectorAll('button[data-action="edit-profile"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = stationProfilesCache.find(function (row) { return row.id === btn.getAttribute('data-id'); });
        if (!item) return;
        fillProfileForm(item);
      });
    });
  }

  function renderOverrideTable() {
    var body = getEl('stationOverridesBody');
    if (!body) return;
    body.innerHTML = stationOverridesCache.map(function (item, idx) {
      var station = stationsCache.find(function (s) { return s.id === item.station_id; }) || {};
      return '<tr><td>' + (idx + 1) + '</td>' +
        '<td>' + (station.name || item.station_id || '--') + '</td>' +
        '<td>' + (item.dur_number || '--') + '</td>' +
        '<td>' + (item.is_active !== false ? 'نشط' : 'معطل') + '</td>' +
        '<td><button class="small-btn" data-action="edit-override" data-id="' + (item.id || '') + '">اختر</button></td></tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:#8ea4ba">لا توجد تعديلات محلية.</td></tr>';
    body.querySelectorAll('button[data-action="edit-override"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = stationOverridesCache.find(function (row) { return row.id === btn.getAttribute('data-id'); });
        if (!item) return;
        fillOverrideForm(item);
      });
    });
  }

  function renderComparisonTable() {
    var body = getEl('analysisResultsBody');
    if (!body) return;
    var stationId = getEl('analysisStationFilter') ? getEl('analysisStationFilter').value : '';
    var durId = getEl('analysisDurFilter') ? getEl('analysisDurFilter').value : '';
    var year = getEl('analysisYearFilter') ? getEl('analysisYearFilter').value : '';
    var rows = annualComparisonsCache.slice();
    if (stationId) rows = rows.filter(function (x) { return x.station_id === stationId; });
    if (durId) rows = rows.filter(function (x) { return x.dur_id === durId; });
    if (year) rows = rows.filter(function (x) { return String(x.year) === String(year); });
    body.innerHTML = rows.map(function (row, idx) {
      var station = stationsCache.find(function (s) { return s.id === row.station_id; }) || {};
      var dur = dururCache.find(function (d) { return d.id === row.dur_id; }) || {};
      return '<tr><td>' + (row.year || '--') + '</td><td>' + (station.name || row.station_id || '--') + '</td><td>' + (dur.name || row.dur_id || '--') + '</td><td>' + ((Number(row.match_score) * 100).toFixed(0) + '%') + '</td><td>' + (row.summary || '--') + '</td><td><button class="small-btn" data-action="edit-comparison" data-id="' + row.id + '">تعديل</button></td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#8ea4ba">لا توجد نتائج.</td></tr>';
    body.querySelectorAll('button[data-action="edit-comparison"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmp = annualComparisonsCache.find(function (row) { return row.id === btn.getAttribute('data-id'); });
        if (!cmp) return;
        fillComparisonForm(cmp);
      });
    });
  }

  function fillComparisonForm(comparison) {
    getEl('comparisonId').value = comparison.id || '';
    getEl('comparisonYear').value = comparison.year || new Date().getFullYear();
    getEl('comparisonStationFilter').value = comparison.station_id || '';
    getEl('comparisonDurFilter').value = comparison.dur_id || '';
    getEl('analysisStationFilter').value = comparison.station_id || '';
    getEl('analysisDurFilter').value = comparison.dur_id || '';
    getEl('comparisonExpectedTraits').value = (Array.isArray(comparison.expected_traits) ? comparison.expected_traits.join('\n') : '');
    getEl('comparisonObservedTraits').value = (Array.isArray(comparison.observed_traits) ? comparison.observed_traits.join('\n') : '');
    getEl('comparisonMatchScore').value = comparison.match_score != null ? comparison.match_score : 0;
    getEl('comparisonSummary').value = comparison.summary || '';
    getEl('comparisonNotes').value = comparison.notes || '';
    getEl('comparisonActive').checked = comparison.is_active !== false;
  }

  function clearComparisonForm() {
    getEl('comparisonId').value = '';
    getEl('comparisonYear').value = new Date().getFullYear();
    getEl('comparisonStationFilter').value = '';
    getEl('comparisonDurFilter').value = '';
    getEl('comparisonExpectedTraits').value = '';
    getEl('comparisonObservedTraits').value = '';
    getEl('comparisonMatchScore').value = 0;
    getEl('comparisonSummary').value = '';
    getEl('comparisonNotes').value = '';
    getEl('comparisonActive').checked = true;
  }

  function readComparisonForm() {
    return {
      id: getEl('comparisonId').value.trim() || undefined,
      year: Number(getEl('comparisonYear').value || new Date().getFullYear()),
      station_id: getEl('comparisonStationFilter').value || '',
      dur_id: getEl('comparisonDurFilter').value || '',
      expected_traits: String(getEl('comparisonExpectedTraits').value || '').split('\n').map(function (v) { return v.trim(); }).filter(Boolean),
      observed_traits: String(getEl('comparisonObservedTraits').value || '').split('\n').map(function (v) { return v.trim(); }).filter(Boolean),
      match_score: Number(getEl('comparisonMatchScore').value || 0),
      summary: getEl('comparisonSummary').value.trim(),
      notes: getEl('comparisonNotes').value.trim(),
      is_active: getEl('comparisonActive').checked
    };
  }

  async function saveComparisonForm() {
    var status = getEl('comparisonStatus');
    try {
      var payload = readComparisonForm();
      if (!payload.station_id) throw new Error('station_id_required');
      if (!payload.dur_id) throw new Error('dur_id_required');
      if (status) status.textContent = 'جاري الحفظ...';
      var res = await apiFetch('/api?route=admin&path=annual-comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('comparison_save_failed');
      var data = await res.json();
      if (status) status.textContent = 'تم حفظ المقارنة السنوية.';
      clearComparisonForm();
      await loadAnnualComparisons();
      if (data.item) fillComparisonForm(data.item);
    } catch (err) {
      if (status) status.textContent = 'فشل حفظ المقارنة: ' + (err && err.message ? err.message : 'error');
    }
  }

  function setComparisonOptions() {
    var stationEl = getEl('comparisonStationFilter');
    if (stationEl) {
      stationEl.innerHTML = '<option value="">الكل</option>' + stationsCache.map(function (s) { return '<option value="' + (s.id || '') + '">' + (s.name || s.id || '--') + '</option>'; }).join('');
    }
    var durEl = getEl('comparisonDurFilter');
    if (durEl) {
      durEl.innerHTML = '<option value="">الكل</option>' + dururCache.map(function (d) { return '<option value="' + (d.id || '') + '">' + (d.name || d.dur_number || '--') + '</option>'; }).join('');
    }
  }

  function renderReferenceStationsTable() {
    var body = getEl('referenceStationsBody');
    if (!body) return;
    var referenceStations = stationsCache.filter(function (station) {
      return isReferenceCalibrationStation(station);
    });
    if (!referenceStations.length) {
      body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#8ea4ba">لا توجد محطات مرجعية حتى الآن.</td></tr>';
      return;
    }
    body.innerHTML = referenceStations.map(function (station, idx) {
      var stateParts = [];
      stateParts.push(station.is_verified ? 'موثق' : 'غير موثق');
      if (station.latitude_band_key) stateParts.push('الحزام: ' + station.latitude_band_key);
      if (station.reference_priority != null) stateParts.push('أولوية: ' + station.reference_priority);
      return '<tr><td>' + (idx + 1) + '</td>' +
        '<td><strong>' + (station.name || '--') + '</strong><div style="margin-top:4px">' + buildReferenceBadgeHtml(station) + '</div></td>' +
        '<td>' + stateParts.join(' • ') + '</td>' +
        '<td><button class="small-btn" data-action="select-ref" data-id="' + (station.id || '') + '">اختر</button></td></tr>';
    }).join('');
    body.querySelectorAll('button[data-action="select-ref"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var station = stationsCache.find(function (s) { return s.id === btn.getAttribute('data-id'); });
        if (!station) return;
        fillReferenceStationEditor(station);
        selectDururStation(station.id);
      });
    });
  }

  function renderDururAnalysisControls() {
    renderAnalysisOptions();
    renderAnalysisResults();
  }

  function updateDururStationInfoPanel() {
    if (selectedDururStationId) {
      selectDururStation(selectedDururStationId);
    }
  }

  async function refreshAdminDururUI() {
    renderDururTable();
    renderSeasonEventsTable();
    renderReferenceStationsTable();
    renderAnalysisResults();
    applyDururFilters();
  }

  function stationStatusBadge(status) {
    if (status === 'active') return '<span class="badge ok">active</span>';
    if (status === 'archived') return '<span class="badge off">archived</span>';
    return '<span class="badge off">disabled</span>';
  }

  function splitCsv(text) {
    return String(text || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function parseListInput(text) {
    return String(text || '')
      .split(/\r?\n|,/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTraitCountLabel(count, suffix) {
    var extra = suffix ? ' ' + suffix : '';
    return String(Number(count) || 0) + ' سمة' + extra;
  }

  function isReferenceCalibrationStation(station) {
    return parseStoredBooleanFlag(station && station.is_reference_station);
  }

  function isVerifiedCalibrationStation(station) {
    return isReferenceCalibrationStation(station) && !!(station && station.is_verified);
  }

  function buildReferenceBadgeHtml(station) {
    if (!isReferenceCalibrationStation(station)) return '';
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,82,82,.14);border:1px solid rgba(255,82,82,.35);color:#ffb3b3;border-radius:999px;padding:2px 8px;font-size:11px;margin-top:4px">محطة مرجعية</span>';
  }

  function getTimingSourceLabel(dur) {
    if (dur && dur.timing_source_label_ar) return dur.timing_source_label_ar;
    var source = dur && dur.timing_source ? dur.timing_source : '';
    if (source === 'true_final_station_reference') {
      return 'المرجع النهائي الخاص بالمحطة (يوم/شهر فقط)';
    }
    if (source === 'operational_workbook' || source === 'resolved_local_station_windows') {
      return 'ملف الدرور المحلي (قديم) — dur_windows';
    }
    if (source === 'calibrated_reference_anchor') return 'مرساة معايرة يدوية';
    if (source === 'nearest_reference_station') return 'محطة مرجعية قريبة';
    return '—';
  }

  function formatTimingModeAr(dur) {
    if (!dur || !dur.timing_mode) return '—';
    if (dur.timing_mode === 'month_day_only') return 'يوم/شهر فقط (دون الاعتماد على السنة الميلادية)';
    return String(dur.timing_mode);
  }

  function formatDurTableSourceAr(dur) {
    if (!dur || !dur.source) return '—';
    if (dur.source === 'true_final_station_reference') {
      return 'المرجع النهائي المشتق لكل محطة (الجدول المرجعي المحلي)';
    }
    return String(dur.source);
  }

  function getCalibrationReasonLabel(reason) {
    if (reason === 'true_final_station_workbook_only') return 'المرجع النهائي لكل محطة (الملف المشتق)';
    if (reason === 'self') return 'مرجع ذاتي';
    if (reason === 'linked_reference_station') return 'محطة مرتبطة مباشرة';
    if (reason === 'latitude_band_key') return 'حزام عرض مطابق';
    if (reason === 'nearest_latitude') return 'أقرب مرجع عرضي';
    return 'بدون معايرة';
  }

  function getReferenceInheritanceMethodLabelAr(method) {
    if (method === 'exact_area_match') return 'مطابقة دولة/منطقة/منطقة محلية';
    if (method === 'latitude_band_match') return 'مطابقة حزام العرض (latitude_band_key)';
    if (method === 'country_region_closest') return 'أقرب محطة مرجعية ضمن نفس الدولة والمنطقة (حد أقصى للمسافة)';
    if (method === 'manual') return 'تعيين يدوي';
    return method ? String(method) : '—';
  }

  function buildTimingStatusText(dur) {
    var parts = [getTimingSourceLabel(dur)];
    if (dur && dur.timing_as_of) {
      parts.push('اعتباراً من ' + dur.timing_as_of);
    }
    if (dur && dur.calibration_reference_station_name && dur.timing_source !== 'pure_engine') {
      parts.push(dur.calibration_reference_station_name);
    }
    if (dur && dur.calibration_latitude_band_key) {
      parts.push('الحزام: ' + dur.calibration_latitude_band_key);
    }
    return parts.join(' • ');
  }

  function normalizeDurRecordForUi(item) {
    var row = item || {};
    return Object.assign({}, row, {
      name: row.name || row.name_ar || row.name_en || ('Dur ' + (row.dur_number || '')),
      days_count: row.days_count != null ? row.days_count : row.default_days_count,
      gregorian_start_month: row.gregorian_start_month != null ? row.gregorian_start_month : (row.gregorian_window_hint && row.gregorian_window_hint.start_month),
      gregorian_start_day: row.gregorian_start_day != null ? row.gregorian_start_day : (row.gregorian_window_hint && row.gregorian_window_hint.start_day),
      gregorian_end_month: row.gregorian_end_month != null ? row.gregorian_end_month : (row.gregorian_window_hint && row.gregorian_window_hint.end_month),
      gregorian_end_day: row.gregorian_end_day != null ? row.gregorian_end_day : (row.gregorian_window_hint && row.gregorian_window_hint.end_day),
      description: row.description || row.description_ar || row.description_en || '',
      heritage_meaning: row.heritage_meaning || row.heritage_meaning_ar || row.heritage_meaning_en || '',
      notes: row.notes || row.notes_ar || row.notes_en || '',
      review_status: row.review_status || 'draft',
      advice_text: row.advice_text == null ? null : String(row.advice_text)
    });
  }

  function listInputValue(values) {
    return Array.isArray(values) ? values.join('\n') : '';
  }

  function buildTraitChipHtml(values, bgColor, borderColor, textColor) {
    return (Array.isArray(values) && values.length ? values : []).map(function (value) {
      return '<span style="display:inline-block;padding:4px 8px;background:' + (bgColor || 'rgba(92,225,255,.16)') + ';border:1px solid ' + (borderColor || 'rgba(92,225,255,.28)') + ';border-radius:999px;color:' + (textColor || '#dff8ff') + ';font-size:.78rem">' + escapeHtml(value) + '</span>';
    }).join('');
  }

  var DURUR_MANAGEMENT_REVIEW_OPTIONS = [
    { value: 'draft', label: 'مسودة' },
    { value: 'reviewed', label: 'مراجع' },
    { value: 'approved', label: 'معتمد' },
    { value: 'needs_revision', label: 'يحتاج مراجعة' }
  ];

  function uniqueNonEmptyValues(values) {
    var out = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var clean = safeInput(value, 240);
      if (clean && out.indexOf(clean) < 0) out.push(clean);
    });
    return out;
  }

  function joinArabicValues(values) {
    return uniqueNonEmptyValues(values).join('، ');
  }

  function collectDurFieldValues(rows, key) {
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      if (Array.isArray(row[key])) out = out.concat(row[key]);
      else if (row[key]) out.push(row[key]);
      (Array.isArray(row.phases) ? row.phases : []).forEach(function (phase) {
        if (!phase) return;
        if (Array.isArray(phase[key])) out = out.concat(phase[key]);
        else if (phase[key]) out.push(phase[key]);
      });
    });
    return uniqueNonEmptyValues(out);
  }

  function sortArabicText(values) {
    return uniqueNonEmptyValues(values).sort(function (a, b) {
      return String(a).localeCompare(String(b), 'ar');
    });
  }

  function getDururManagementOptionSource() {
    var durRows = Array.isArray(globalDururManagementCache) && globalDururManagementCache.length ? globalDururManagementCache : dururCache;
    var weatherOptions = [];
    var marineOptions = [];
    var generalOptions = collectDurFieldValues(durRows, 'general_traits');
    var fishOptions = collectDurFieldValues(durRows, 'fish_traits');
    (Array.isArray(traitsCache) ? traitsCache : []).forEach(function (item) {
      if (!item || item.is_active === false) return;
      var name = safeInput(item.name_ar || item.name || item.name_en, 120);
      if (!name) return;
      if (item.category === 'weather') weatherOptions.push(name);
      if (item.category === 'marine') marineOptions.push(name);
      if (item.category === 'general' || item.category === 'general_traits') generalOptions.push(name);
      if (item.category === 'fish' || item.category === 'fish_traits') fishOptions.push(name);
    });
    (Array.isArray(seasonEventsCache) ? seasonEventsCache : []).forEach(function (item) {
      if (!item || item.is_active === false) return;
      fishOptions = fishOptions.concat(Array.isArray(item.fish_traits) ? item.fish_traits : []);
      weatherOptions = weatherOptions.concat(Array.isArray(item.weather_traits) ? item.weather_traits : []);
      marineOptions = marineOptions.concat(Array.isArray(item.marine_traits) ? item.marine_traits : []);
    });
    return {
      reviewStatus: DURUR_MANAGEMENT_REVIEW_OPTIONS.slice(),
      seasons: sortArabicText((durRows || []).map(function (row) { return row && row.season_ar; })),
      astronomicalMarkers: sortArabicText((durRows || []).map(function (row) { return row && row.astronomical_marker_ar; })),
      generalTraits: sortArabicText(generalOptions),
      weatherTraits: sortArabicText(weatherOptions.concat(collectDurFieldValues(durRows, 'weather_traits'))),
      marineTraits: sortArabicText(marineOptions.concat(collectDurFieldValues(durRows, 'marine_traits'))),
      fishTraits: sortArabicText(fishOptions),
      events: (Array.isArray(seasonEventsCache) ? seasonEventsCache : []).filter(function (item) {
        return item && item.is_active !== false;
      }).map(function (item) {
        return {
          value: item.id || '',
          label: (item.name_ar || item.name || item.id || '') + (item.id ? ' [' + item.id + ']' : '')
        };
      })
    };
  }

  function getDururManagementReviewLabel(value) {
    var match = DURUR_MANAGEMENT_REVIEW_OPTIONS.find(function (item) { return item.value === value; });
    return match ? match.label : (value || '--');
  }

  function getDurLabelById(durId) {
    var item = (Array.isArray(globalDururManagementCache) ? globalDururManagementCache : []).find(function (row) {
      return row && row.id === durId;
    }) || (Array.isArray(dururCache) ? dururCache : []).find(function (row) {
      return row && row.id === durId;
    });
    return item ? (item.name_ar || item.name || item.id || durId) : (durId || '--');
  }

  function formatIntelligencePercent(value) {
    var num = Number(value);
    return Number.isFinite(num) ? (num.toFixed(1) + '%') : '--';
  }

  function formatIntelligenceDate(value) {
    if (!value) return '--';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('ar');
  }

  function needsDurIntelligenceWarning(summary) {
    if (!summary) return false;
    return Number(summary.avg_score || 0) < 60 || Number(summary.failure_rate || 0) > 40;
  }

  function openDurEditorFromIntelligence(durId) {
    selectedGlobalDurId = durId || '';
    renderGlobalDururList();
    renderGlobalDururEditor();
    var block = getEl('globalDururManagementBlock');
    if (block && typeof block.scrollIntoView === 'function') {
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function splitSelectedAndCustomValues(values, options, useOptionObjects) {
    var knownValues = (Array.isArray(options) ? options : []).map(function (item) {
      return useOptionObjects ? item.value : item;
    });
    var selected = [];
    var custom = [];
    uniqueNonEmptyValues(values).forEach(function (value) {
      if (knownValues.indexOf(value) >= 0) selected.push(value);
      else custom.push(value);
    });
    return { selected: selected, custom: custom };
  }

  function buildStructuredSelectField(fieldId, label, values, options, useOptionObjects, size) {
    var normalizedOptions = Array.isArray(options) ? options : [];
    var split = splitSelectedAndCustomValues(values, normalizedOptions, !!useOptionObjects);
    var hasOther = split.custom.length > 0;
    return ''
      + '<div data-structured-field="' + fieldId + '" style="display:grid;gap:6px">'
      + '  <label style="display:block;margin-bottom:2px;color:#9fc1d7">' + label + '</label>'
      + '  <select id="' + fieldId + '" multiple size="' + String(size || 6) + '" style="width:100%;background:var(--bg3);color:var(--txt);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px">'
      + normalizedOptions.map(function (item) {
          var value = useOptionObjects ? item.value : item;
          var text = useOptionObjects ? item.label : item;
          var selected = split.selected.indexOf(value) >= 0 ? ' selected' : '';
          return '<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(text) + '</option>';
        }).join('')
      + '    <option value="__other__"' + (hasOther ? ' selected' : '') + '>أخرى</option>'
      + '  </select>'
      + '  <textarea id="' + fieldId + '__other" placeholder="أدخل القيم الأخرى، كل قيمة في سطر" style="width:100%;min-height:58px;' + (hasOther ? '' : 'display:none;') + '">' + escapeHtml(split.custom.join('\n')) + '</textarea>'
      + '</div>';
  }

  function bindStructuredSelectFields(scope) {
    (scope || document).querySelectorAll('select[id$="__selector_placeholder__"]');
  }

  function bindStructuredFieldOtherToggle(scope) {
    (scope || document).querySelectorAll('[data-structured-field] select').forEach(function (select) {
      select.addEventListener('change', function () {
        var other = getEl(select.id + '__other');
        if (!other) return;
        var selected = Array.prototype.slice.call(select.selectedOptions || []).map(function (option) { return option.value; });
        other.style.display = selected.indexOf('__other__') >= 0 ? '' : 'none';
      });
    });
  }

  function getStructuredFieldValues(fieldId) {
    var select = getEl(fieldId);
    var other = getEl(fieldId + '__other');
    if (!select) return [];
    var values = Array.prototype.slice.call(select.selectedOptions || []).map(function (option) { return option.value; }).filter(function (value) {
      return value && value !== '__other__';
    });
    if (other && other.style.display !== 'none') {
      values = values.concat(parseListInput(other.value));
    }
    return uniqueNonEmptyValues(values);
  }

  function setStructuredFieldValues(fieldId, values) {
    var select = getEl(fieldId);
    var other = getEl(fieldId + '__other');
    if (!select) return;
    var options = Array.prototype.slice.call(select.options || []).map(function (option) { return option.value; });
    var split = splitSelectedAndCustomValues(values, options.filter(function (value) { return value !== '__other__'; }), false);
    Array.prototype.slice.call(select.options || []).forEach(function (option) {
      option.selected = split.selected.indexOf(option.value) >= 0 || (option.value === '__other__' && split.custom.length > 0);
    });
    if (other) {
      other.value = split.custom.join('\n');
      other.style.display = split.custom.length > 0 ? '' : 'none';
    }
  }

  function ensureDururManagementPanel() {
    if (getEl('globalDururManagementBlock')) return;
    var analyticsDetails = getEl('stAnalyticsRefreshBtn');
    if (!analyticsDetails || !analyticsDetails.closest) return;
    var anchor = analyticsDetails.closest('details');
    if (!anchor || !anchor.parentNode) return;
    var wrapper = document.createElement('details');
    wrapper.className = 'adv-options';
    wrapper.id = 'globalDururManagementBlock';
    wrapper.style.margin = '14px 0';
    wrapper.innerHTML = ''
      + '<summary style="cursor:pointer;font-size:.88rem;color:#9fc1d7;background:var(--bg3);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:9px 14px;user-select:none"><i class="fa-solid fa-globe" style="margin-left:6px"></i> إدارة مرجع الدرور</summary>'
      + '<div style="margin-top:12px;display:grid;gap:12px">'
      + '  <div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(360px,1.7fr);gap:12px;align-items:start">'
      + '    <div style="padding:12px;background:rgba(92,225,255,.06);border:1px solid rgba(92,225,255,.18);border-radius:10px">'
      + '      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px"><strong style="color:#dff8ff">قائمة الدرور</strong><span id="globalDururCount" style="font-size:.8rem;color:#9fc1d7">0</span></div>'
      + '      <div id="globalDururList" style="display:grid;gap:6px;max-height:420px;overflow:auto"></div>'
      + '    </div>'
      + '    <div style="padding:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:10px">'
      + '      <div id="globalDururEditorState" style="color:#9fc1d7;font-size:.85rem">اختر دراً من القائمة لفتح المحرر.</div>'
      + '      <div id="globalDururEditor" style="display:none;gap:10px"></div>'
      + '    </div>'
      + '  </div>'
      + '  <div style="padding:12px;background:rgba(38,194,129,.06);border:1px solid rgba(38,194,129,.18);border-radius:10px">'
      + '    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px"><strong style="color:#dff8ff">معاينة محطة</strong><span id="dururStationPreviewStatus" style="font-size:.8rem;color:#9fc1d7">--</span></div>'
      + '    <div id="dururStationPreviewBody" style="display:grid;gap:8px;color:#c5d5e0;font-size:.84rem">اختر محطة ثم حمّل التحليل لعرض المرجع الفعال بعد الدمج.</div>'
      + '  </div>'
      + '  <div style="padding:12px;background:rgba(255,185,0,.06);border:1px solid rgba(255,185,0,.18);border-radius:10px">'
      + '    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px"><strong style="color:#dff8ff">تحليل أداء الدرور</strong><span id="dururIntelligenceStatus" style="font-size:.8rem;color:#9fc1d7">--</span></div>'
      + '    <div id="dururIntelligenceBody" style="display:grid;gap:10px;color:#c5d5e0;font-size:.84rem">جاري تحميل بيانات الذكاء...</div>'
      + '  </div>'
      + '</div>';
    anchor.parentNode.insertBefore(wrapper, anchor.nextSibling);
  }

  function renderGlobalDururList() {
    var container = getEl('globalDururList');
    var countEl = getEl('globalDururCount');
    if (!container) return;
    container.innerHTML = '';
    if (countEl) countEl.textContent = String(globalDururManagementCache.length);
    globalDururManagementCache.slice().sort(function (a, b) {
      return Number(a.order_index || a.dur_number || 0) - Number(b.order_index || b.dur_number || 0);
    }).forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'small-btn';
      btn.setAttribute('data-dur-id', item.id || '');
      btn.style.textAlign = 'right';
      btn.style.padding = '9px 10px';
      btn.style.background = item.id === selectedGlobalDurId ? 'rgba(92,225,255,.18)' : 'rgba(255,255,255,.04)';
      btn.style.border = item.id === selectedGlobalDurId ? '1px solid rgba(92,225,255,.34)' : '1px solid rgba(255,255,255,.08)';
      btn.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px"><strong>' + escapeHtml(item.name || '--') + '</strong><span style="color:#9fc1d7">#' + escapeHtml(item.dur_number || '--') + '</span></div>'
        + '<div style="font-size:.78rem;color:#9fc1d7;margin-top:4px">' + escapeHtml(getDururManagementReviewLabel(item.review_status || 'draft')) + '</div>';
      btn.addEventListener('click', function () {
        selectedGlobalDurId = item.id || '';
        renderGlobalDururList();
        renderGlobalDururEditor();
      });
      container.appendChild(btn);
    });
  }

  function buildGlobalDururEditorHtml(item) {
    var phases = Array.isArray(item.phases) ? item.phases : [];
    var options = getDururManagementOptionSource();
    return ''
      + '<div style="padding:12px;background:rgba(92,225,255,.05);border:1px solid rgba(92,225,255,.18);border-radius:10px">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px"><strong style="color:#dff8ff">المرجع العام للدرة</strong><span style="font-size:.75rem;color:#8fb4c8">المعرف التقني: ' + escapeHtml(item.id || '') + '</span></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">اسم الدرة</label><input id="globalDurNameAr" type="text" value="' + escapeHtml(item.name_ar || item.name || '') + '" style="width:100%"></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">حالة المراجعة</label><select id="globalDurReviewStatus" style="width:100%">' + options.reviewStatus.map(function (opt) { return '<option value="' + escapeHtml(opt.value) + '">' + escapeHtml(opt.label) + '</option>'; }).join('') + '</select></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">رقم الدر</label><input id="globalDurNumber" type="number" value="' + escapeHtml(item.dur_number || '') + '" style="width:100%"></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">الترتيب</label><input id="globalDurOrderIndex" type="number" value="' + escapeHtml(item.order_index || '') + '" style="width:100%"></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">عدد الأيام</label><input id="globalDurDefaultDays" type="number" value="' + escapeHtml(item.default_days_count || item.days_count || '') + '" style="width:100%"></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">المعرف</label><input id="globalDurId" type="text" readonly value="' + escapeHtml(item.id || '') + '" style="width:100%"></div>'
      + '</div>'
      + '<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + buildStructuredSelectField('globalDurSeasonAr', 'الموسم', item.season_ar ? [item.season_ar] : [], options.seasons, false, 4)
      + buildStructuredSelectField('globalDurMarkerAr', 'العلامة الفلكية', item.astronomical_marker_ar ? [item.astronomical_marker_ar] : [], options.astronomicalMarkers, false, 4)
      + '</div>'
      + '<div><label style="display:block;margin:8px 0 4px;color:#9fc1d7">المعنى التراثي</label><textarea id="globalDurHeritageMeaningAr" style="width:100%;min-height:70px">' + escapeHtml(item.heritage_meaning_ar || item.heritage_meaning || '') + '</textarea></div>'
      + '<div><label style="display:block;margin:8px 0 4px;color:#9fc1d7">الوصف</label><textarea id="globalDurDescriptionAr" style="width:100%;min-height:70px">' + escapeHtml(item.description_ar || item.description || '') + '</textarea></div>'
      + '<div><label style="display:block;margin:8px 0 4px;color:#9fc1d7">الملاحظات</label><textarea id="globalDurNotesAr" style="width:100%;min-height:70px">' + escapeHtml(item.notes_ar || item.notes || '') + '</textarea></div>'
      + '<div><label style="display:block;margin:8px 0 4px;color:#9fc1d7">النصيحة المرجعية</label><textarea id="globalDurAdviceText" style="width:100%;min-height:56px">' + escapeHtml(item.advice_text || '') + '</textarea></div>'
      + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">'
      + buildStructuredSelectField('globalDurGeneralTraits', 'السمات العامة', item.general_traits || [], options.generalTraits, false, 7)
      + buildStructuredSelectField('globalDurWeatherTraits', 'سمات الطقس', item.weather_traits || [], options.weatherTraits, false, 7)
      + buildStructuredSelectField('globalDurMarineTraits', 'سمات البحر', item.marine_traits || [], options.marineTraits, false, 7)
      + buildStructuredSelectField('globalDurFishTraits', 'سمات السمك', item.fish_traits || [], options.fishTraits, false, 7)
      + '</div>'
      + buildStructuredSelectField('globalDurRelatedEvents', 'الأحداث المرتبطة', item.related_event_ids || [], options.events, true, 6)
      + '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><button type="button" id="globalDurSaveCurrentBtn" class="small-btn">حفظ الحالة الحالية</button><button type="button" id="globalDurSaveDraftBtn" class="small-btn">حفظ كمسودة</button><button type="button" id="globalDurSaveApprovedBtn" class="small-btn">حفظ واعتماد</button><span id="globalDurSaveStatus" style="color:#9fc1d7;font-size:.82rem">جاهز</span></div>'
      + '</div>'
      + '<div style="margin-top:12px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.02)"><strong style="color:#dff8ff">مراحل الدرة</strong><div id="globalDurPhaseEditor" style="display:grid;gap:10px;margin-top:10px">'
      + phases.map(function (phase) {
          var phasePrefix = 'globalDurPhase_' + (phase.phase_id || '');
          return '<details open style="border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;background:rgba(255,255,255,.02)">'
            + '<summary style="cursor:pointer;color:#cfeaff"><strong>اسم المرحلة:</strong> ' + escapeHtml(phase.title_ar || phase.phase_id || '--') + ' <span style="font-size:.74rem;color:#8fb4c8">(' + escapeHtml(phase.phase_id || '--') + ')</span></summary>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'
            +   '<div><label style="display:block;margin-bottom:4px;color:#9fc1d7">اسم المرحلة</label><input data-phase-field="title_ar" data-phase-id="' + escapeHtml(phase.phase_id || '') + '" type="text" value="' + escapeHtml(phase.title_ar || '') + '" style="width:100%"></div>'
            +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><div><label style="display:block;margin-bottom:4px;color:#9fc1d7">من يوم</label><input data-phase-field="start_day" data-phase-id="' + escapeHtml(phase.phase_id || '') + '" type="number" value="' + escapeHtml(phase.start_day || '') + '"></div><div><label style="display:block;margin-bottom:4px;color:#9fc1d7">إلى يوم</label><input data-phase-field="end_day" data-phase-id="' + escapeHtml(phase.phase_id || '') + '" type="number" value="' + escapeHtml(phase.end_day || '') + '"></div></div>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px">'
            +   buildStructuredSelectField(phasePrefix + '_general_traits', 'السمات العامة', phase.general_traits || [], options.generalTraits, false, 6)
            +   buildStructuredSelectField(phasePrefix + '_weather_traits', 'سمات الطقس', phase.weather_traits || [], options.weatherTraits, false, 6)
            +   buildStructuredSelectField(phasePrefix + '_marine_traits', 'سمات البحر', phase.marine_traits || [], options.marineTraits, false, 6)
            +   buildStructuredSelectField(phasePrefix + '_fish_traits', 'سمات السمك', phase.fish_traits || [], options.fishTraits, false, 6)
            + '</div>'
            + '<div style="margin-top:8px">' + buildStructuredSelectField(phasePrefix + '_related_event_ids', 'الأحداث المرتبطة', phase.related_event_ids || [], options.events, true, 5) + '</div>'
            + '<div style="margin-top:8px"><label style="display:block;margin-bottom:4px;color:#9fc1d7">الملاحظات</label><textarea data-phase-field="notes_ar" data-phase-id="' + escapeHtml(phase.phase_id || '') + '" style="width:100%;min-height:56px">' + escapeHtml(phase.notes_ar || '') + '</textarea></div>'
            + '<div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button type="button" class="small-btn" data-save-phase="' + escapeHtml(phase.phase_id || '') + '">حفظ المرحلة</button><span style="font-size:.74rem;color:#8fb4c8">المعرف التقني: ' + escapeHtml(phase.phase_id || '--') + '</span></div>'
            + '</details>';
        }).join('')
      + '</div></div>'
      + '<div style="margin-top:12px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.02)"><strong style="color:#dff8ff">التخصيصات الخاصة</strong><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">معرف التخصيص</label><input id="globalOverrideId" type="text" placeholder="يُنشأ تلقائياً عند الإضافة" style="width:100%"></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">معرف المحطة (فارغ = عام)</label><input id="globalOverrideStationId" type="text" value="' + escapeHtml(selectedDururStationId || '') + '" style="width:100%"></div>'
      + '  <div><label style="display:block;margin-bottom:4px;color:#9fc1d7">المرحلة</label><select id="globalOverridePhaseId" style="width:100%;background:var(--bg3);color:var(--txt);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px"><option value="">المرجع العام للدرة</option>' + phases.map(function (phase) { return '<option value="' + escapeHtml(phase.phase_id || '') + '">' + escapeHtml(phase.phase_id || '') + '</option>'; }).join('') + '</select></div>'
      + buildStructuredSelectField('globalOverrideSeasonKey', 'الموسم', [], options.seasons, false, 4)
      + '</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px">'
      + buildStructuredSelectField('globalOverrideGeneralTraits', 'السمات العامة', [], options.generalTraits, false, 5)
      + buildStructuredSelectField('globalOverrideWeatherTraits', 'سمات الطقس', [], options.weatherTraits, false, 5)
      + buildStructuredSelectField('globalOverrideMarineTraits', 'سمات البحر', [], options.marineTraits, false, 5)
      + buildStructuredSelectField('globalOverrideFishTraits', 'سمات السمك', [], options.fishTraits, false, 5)
      + '</div><div style="margin-top:8px"><label style="display:block;margin-bottom:4px;color:#9fc1d7">النصيحة المرجعية</label><textarea id="globalOverrideAdviceText" style="width:100%;min-height:56px"></textarea></div><div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button type="button" id="globalOverrideSaveBtn" class="small-btn">حفظ التخصيص</button><span id="globalOverrideStatus" style="color:#9fc1d7;font-size:.82rem">جاهز</span></div><div id="globalOverrideList" style="display:grid;gap:6px;margin-top:10px"></div></div>';
  }

  function renderGlobalDururEditor() {
    var stateEl = getEl('globalDururEditorState');
    var editor = getEl('globalDururEditor');
    if (!editor || !stateEl) return;
    var item = globalDururManagementCache.find(function (row) { return row.id === selectedGlobalDurId; });
    if (!item) {
      stateEl.style.display = '';
      editor.style.display = 'none';
      editor.innerHTML = '';
      return;
    }
    stateEl.style.display = 'none';
    editor.style.display = 'grid';
    editor.innerHTML = buildGlobalDururEditorHtml(item);
    var reviewEl = getEl('globalDurReviewStatus');
    if (reviewEl) reviewEl.value = item.review_status || 'draft';
    bindStructuredFieldOtherToggle(editor);
    var saveCurrentBtn = getEl('globalDurSaveCurrentBtn');
    var saveDraftBtn = getEl('globalDurSaveDraftBtn');
    var saveApprovedBtn = getEl('globalDurSaveApprovedBtn');
    if (saveCurrentBtn) saveCurrentBtn.addEventListener('click', function () { saveSelectedGlobalDur(); });
    if (saveDraftBtn) saveDraftBtn.addEventListener('click', function () { saveSelectedGlobalDur('draft'); });
    if (saveApprovedBtn) saveApprovedBtn.addEventListener('click', function () { saveSelectedGlobalDur('approved'); });
    editor.querySelectorAll('button[data-save-phase]').forEach(function (btn) {
      btn.addEventListener('click', function () { saveSelectedDurPhase(btn.getAttribute('data-save-phase')); });
    });
    var overrideSaveBtn = getEl('globalOverrideSaveBtn');
    if (overrideSaveBtn) overrideSaveBtn.addEventListener('click', saveSelectedDurOverride);
    renderGlobalOverrideList(item.id);
  }

  function collectSelectedDurFields() {
    return {
      name_ar: safeInput(getEl('globalDurNameAr') ? getEl('globalDurNameAr').value : '', 120),
      dur_number: Number(getEl('globalDurNumber') ? getEl('globalDurNumber').value : 0) || 0,
      order_index: Number(getEl('globalDurOrderIndex') ? getEl('globalDurOrderIndex').value : 0) || 0,
      default_days_count: Number(getEl('globalDurDefaultDays') ? getEl('globalDurDefaultDays').value : 0) || 0,
      review_status: safeInput(getEl('globalDurReviewStatus') ? getEl('globalDurReviewStatus').value : 'draft', 40) || 'draft',
      season_ar: joinArabicValues(getStructuredFieldValues('globalDurSeasonAr')),
      astronomical_marker_ar: joinArabicValues(getStructuredFieldValues('globalDurMarkerAr')),
      heritage_meaning_ar: safeInput(getEl('globalDurHeritageMeaningAr') ? getEl('globalDurHeritageMeaningAr').value : '', 1200),
      description_ar: safeInput(getEl('globalDurDescriptionAr') ? getEl('globalDurDescriptionAr').value : '', 1200),
      notes_ar: safeInput(getEl('globalDurNotesAr') ? getEl('globalDurNotesAr').value : '', 1200),
      advice_text: safeInput(getEl('globalDurAdviceText') ? getEl('globalDurAdviceText').value : '', 1200) || null,
      general_traits: getStructuredFieldValues('globalDurGeneralTraits'),
      weather_traits: getStructuredFieldValues('globalDurWeatherTraits'),
      marine_traits: getStructuredFieldValues('globalDurMarineTraits'),
      fish_traits: getStructuredFieldValues('globalDurFishTraits'),
      related_event_ids: getStructuredFieldValues('globalDurRelatedEvents')
    };
  }

  function collectSelectedPhaseFields(phaseId) {
    var phasePrefix = 'globalDurPhase_' + phaseId;
    var fields = {};
    ['title_ar', 'start_day', 'end_day', 'notes_ar'].forEach(function (key) {
      var el = document.querySelector('[data-phase-id="' + phaseId + '"][data-phase-field="' + key + '"]');
      if (!el) return;
      if (key === 'start_day' || key === 'end_day') fields[key] = Number(el.value || 0) || 0;
      else fields[key] = safeInput(el.value, 1200);
    });
    fields.general_traits = getStructuredFieldValues(phasePrefix + '_general_traits');
    fields.weather_traits = getStructuredFieldValues(phasePrefix + '_weather_traits');
    fields.marine_traits = getStructuredFieldValues(phasePrefix + '_marine_traits');
    fields.fish_traits = getStructuredFieldValues(phasePrefix + '_fish_traits');
    fields.related_event_ids = getStructuredFieldValues(phasePrefix + '_related_event_ids');
    return fields;
  }

  async function loadGlobalDururManagementData() {
    ensureDururManagementPanel();
    try {
      var pair = await Promise.all([
        apiFetch('/api?route=admin&path=durur', { method: 'GET' }).then(function (res) { return res.json(); }),
        apiFetch('/api?route=admin&path=durur-overrides', { method: 'GET' }).then(function (res) { return res.json(); }),
        apiFetch('/api?route=admin&path=durur-intelligence', { method: 'GET' }).then(function (res) { return res.json(); })
      ]);
      globalDururManagementCache = Array.isArray(pair[0].items) ? pair[0].items.map(normalizeDurRecordForUi) : [];
      dururGlobalOverridesCache = Array.isArray(pair[1].items) ? pair[1].items : [];
      dururIntelligenceGroupedCache = Array.isArray(pair[2].grouped) ? pair[2].grouped : [];
      if (!selectedGlobalDurId && globalDururManagementCache.length) selectedGlobalDurId = globalDururManagementCache[0].id || '';
      renderGlobalDururList();
      renderGlobalDururEditor();
      renderDururStationPreview();
      renderDururIntelligencePanel();
    } catch (err) {
      console.error('[durur-management] load failed', err);
      dururIntelligenceGroupedCache = [];
      renderDururIntelligencePanel();
    }
  }

  function renderGlobalOverrideList(durId) {
    var list = getEl('globalOverrideList');
    if (!list) return;
    var items = dururGlobalOverridesCache.filter(function (item) { return item && item.dur_id === durId; });
    list.innerHTML = items.length ? items.map(function (item) {
      return '<button type="button" class="small-btn" data-load-override="' + escapeHtml(item.override_id || item.id || '') + '" style="text-align:right;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)"><strong>' + escapeHtml((item.station_id || 'مرجع عام')) + '</strong> | ' + escapeHtml(item.phase_id || 'المرجع العام') + ' | ' + escapeHtml(item.season_key || 'كل المواسم') + '</button>';
    }).join('') : '<div style="color:#9fc1d7;font-size:.8rem">لا توجد تخصيصات خاصة لهذه الدرة بعد.</div>';
    list.querySelectorAll('button[data-load-override]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var override = dururGlobalOverridesCache.find(function (item) { return (item.override_id || item.id) === btn.getAttribute('data-load-override'); });
        if (!override) return;
        if (getEl('globalOverrideId')) getEl('globalOverrideId').value = override.override_id || override.id || '';
        if (getEl('globalOverrideStationId')) getEl('globalOverrideStationId').value = override.station_id || '';
        if (getEl('globalOverridePhaseId')) getEl('globalOverridePhaseId').value = override.phase_id || '';
        setStructuredFieldValues('globalOverrideSeasonKey', override.season_key ? [override.season_key] : []);
        setStructuredFieldValues('globalOverrideGeneralTraits', override.fields && override.fields.general_traits);
        setStructuredFieldValues('globalOverrideWeatherTraits', override.fields && override.fields.weather_traits);
        setStructuredFieldValues('globalOverrideMarineTraits', override.fields && override.fields.marine_traits);
        setStructuredFieldValues('globalOverrideFishTraits', override.fields && override.fields.fish_traits);
        if (getEl('globalOverrideAdviceText')) getEl('globalOverrideAdviceText').value = override.fields && override.fields.advice_text ? override.fields.advice_text : '';
      });
    });
  }

  function renderDururIntelligencePanel() {
    var body = getEl('dururIntelligenceBody');
    var status = getEl('dururIntelligenceStatus');
    if (!body || !status) return;
    if (!Array.isArray(dururIntelligenceGroupedCache) || !dururIntelligenceGroupedCache.length) {
      status.textContent = 'لا توجد بيانات';
      body.innerHTML = '<div style="color:#9fc1d7">لا توجد ملخصات تحقق كافية بعد لعرض تحليل الأداء.</div>';
      return;
    }
    status.textContent = String(dururIntelligenceGroupedCache.length) + ' درة';
    body.innerHTML = dururIntelligenceGroupedCache.map(function (group) {
      var summary = group && group.summary ? group.summary : {};
      var durId = group && group.dur_id ? group.dur_id : '';
      var durLabel = getDurLabelById(durId);
      var warning = needsDurIntelligenceWarning(summary);
      var phases = Array.isArray(group && group.phases) ? group.phases : [];
      return ''
        + '<div style="padding:10px;border:1px solid ' + (warning ? 'rgba(255,120,120,.28)' : 'rgba(255,255,255,.08)') + ';border-radius:10px;background:' + (warning ? 'rgba(255,120,120,.05)' : 'rgba(255,255,255,.02)') + '">'
        + '  <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap">'
        + '    <div><strong style="color:#dff8ff">' + escapeHtml(durLabel) + '</strong><div style="font-size:.74rem;color:#8fb4c8">المعرف التقني: ' + escapeHtml(durId || '--') + '</div></div>'
        + '    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="small-btn" data-open-intelligence-dur="' + escapeHtml(durId) + '">فتح المحرر</button>' + (warning ? '<span style="color:#ffb3b3;font-size:.8rem">⚠ هذا الدر يحتاج مراجعة</span>' : '') + '</div>'
        + '  </div>'
        + '  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px">'
        + '    <div><strong style="color:#9fc1d7">متوسط الدقة</strong><br>' + escapeHtml(summary.avg_score != null ? String(summary.avg_score) : '--') + '</div>'
        + '    <div><strong style="color:#9fc1d7">نسبة النجاح</strong><br>' + escapeHtml(formatIntelligencePercent(summary.success_rate)) + '</div>'
        + '    <div><strong style="color:#9fc1d7">نسبة الفشل</strong><br>' + escapeHtml(formatIntelligencePercent(summary.failure_rate)) + '</div>'
        + '    <div><strong style="color:#9fc1d7">عدد مرات التحقق</strong><br>' + escapeHtml(summary.total_runs != null ? String(summary.total_runs) : '0') + '</div>'
        + '  </div>'
        + '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'
        + '    <div><strong style="color:#9fc1d7">أكثر السمات فشلًا</strong><br>' + (summary.most_failed_traits && summary.most_failed_traits.length ? buildTraitChipHtml(summary.most_failed_traits, 'rgba(255,120,120,.12)', 'rgba(255,120,120,.22)', '#ffd8d8') : '<span style="color:#9fc1d7">--</span>') + '</div>'
        + '    <div><strong style="color:#9fc1d7">أكثر السمات الزائدة</strong><br>' + (summary.most_extra_traits && summary.most_extra_traits.length ? buildTraitChipHtml(summary.most_extra_traits, 'rgba(255,185,0,.12)', 'rgba(255,185,0,.22)', '#ffe7aa') : '<span style="color:#9fc1d7">--</span>') + '</div>'
        + '  </div>'
        + '  <div style="margin-top:8px"><strong style="color:#9fc1d7">آخر تحديث</strong><br>' + escapeHtml(formatIntelligenceDate(summary.last_updated)) + '</div>'
        + (phases.length ? ('<div style="margin-top:10px"><strong style="color:#9fc1d7">تفصيل المراحل</strong><div style="display:grid;gap:6px;margin-top:6px">' + phases.map(function (phase) {
            var phaseWarning = needsDurIntelligenceWarning(phase);
            return '<button type="button" class="small-btn" data-open-intelligence-dur="' + escapeHtml(durId) + '" style="text-align:right;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)"><strong>' + escapeHtml(phase.phase_id || 'بدون مرحلة') + '</strong> | متوسط الدقة: ' + escapeHtml(String(phase.avg_score != null ? phase.avg_score : '--')) + ' | نسبة الفشل: ' + escapeHtml(formatIntelligencePercent(phase.failure_rate)) + (phaseWarning ? ' | ⚠ يحتاج مراجعة' : '') + '</button>';
          }).join('') + '</div></div>') : '')
        + '</div>';
    }).join('');
    body.querySelectorAll('button[data-open-intelligence-dur]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openDurEditorFromIntelligence(btn.getAttribute('data-open-intelligence-dur'));
      });
    });
  }

  async function saveSelectedGlobalDur(reviewStatusOverride) {
    var statusEl = getEl('globalDurSaveStatus');
    if (!selectedGlobalDurId) return;
    if (statusEl) statusEl.textContent = 'جاري الحفظ...';
    try {
      if (reviewStatusOverride && getEl('globalDurReviewStatus')) getEl('globalDurReviewStatus').value = reviewStatusOverride;
      var res = await apiFetch('/api?route=admin&path=durur-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dur_id: selectedGlobalDurId, fields: collectSelectedDurFields() })
      });
      if (!res.ok) throw new Error('durur_update_failed');
      if (statusEl) statusEl.textContent = 'تم حفظ الدر.';
      await loadDururData();
      await loadGlobalDururManagementData();
    } catch (err) {
      if (statusEl) statusEl.textContent = 'فشل حفظ الدر.';
    }
  }

  async function saveSelectedDurPhase(phaseId) {
    var statusEl = getEl('globalDurSaveStatus');
    if (!selectedGlobalDurId || !phaseId) return;
    if (statusEl) statusEl.textContent = 'جاري حفظ المرحلة...';
    try {
      var res = await apiFetch('/api?route=admin&path=durur-phase-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dur_id: selectedGlobalDurId, phase_id: phaseId, fields: collectSelectedPhaseFields(phaseId) })
      });
      if (!res.ok) throw new Error('durur_phase_update_failed');
      if (statusEl) statusEl.textContent = 'تم حفظ المرحلة.';
      await loadGlobalDururManagementData();
    } catch (err) {
      if (statusEl) statusEl.textContent = 'فشل حفظ المرحلة.';
    }
  }

  async function saveSelectedDurOverride() {
    var statusEl = getEl('globalOverrideStatus');
    if (!selectedGlobalDurId) return;
    if (statusEl) statusEl.textContent = 'جاري حفظ التخصيص...';
    try {
      var overrideId = safeInput(getEl('globalOverrideId') ? getEl('globalOverrideId').value : '', 80);
      var path = overrideId ? 'durur-override-update' : 'durur-override-create';
      var payload = {
        override_id: overrideId || undefined,
        station_id: safeInput(getEl('globalOverrideStationId') ? getEl('globalOverrideStationId').value : '', 80) || null,
        dur_id: selectedGlobalDurId,
        phase_id: safeInput(getEl('globalOverridePhaseId') ? getEl('globalOverridePhaseId').value : '', 80) || null,
        season_key: getStructuredFieldValues('globalOverrideSeasonKey')[0] || null,
        fields: {
          general_traits: getStructuredFieldValues('globalOverrideGeneralTraits'),
          weather_traits: getStructuredFieldValues('globalOverrideWeatherTraits'),
          marine_traits: getStructuredFieldValues('globalOverrideMarineTraits'),
          fish_traits: getStructuredFieldValues('globalOverrideFishTraits'),
          advice_text: safeInput(getEl('globalOverrideAdviceText') ? getEl('globalOverrideAdviceText').value : '', 1200) || null
        }
      };
      var res = await apiFetch('/api?route=admin&path=' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('durur_override_save_failed');
      if (statusEl) statusEl.textContent = 'تم حفظ التخصيص.';
      await loadGlobalDururManagementData();
    } catch (err) {
      if (statusEl) statusEl.textContent = 'فشل حفظ التخصيص.';
    }
  }

  function renderDururStationPreview() {
    var body = getEl('dururStationPreviewBody');
    var status = getEl('dururStationPreviewStatus');
    if (!body || !status) return;
    if (!selectedDururStationId) {
      status.textContent = '--';
      body.innerHTML = 'اختر محطة ثم حمّل التحليل لعرض المرجع الفعال بعد الدمج.';
      return;
    }
    status.textContent = selectedDururStationId;
    if (!currentStationAnalysisDto || !currentStationAnalysisDto.dur) {
      body.innerHTML = 'يُستند التحليل إلى المرجع النهائي في «تحليل المحطة» (data/true_final_station_reference.json) — بلا خدمة تحليل مباشر.';
      return;
    }
    var dto = currentStationAnalysisDto;
    if (dto.station_id && selectedDururStationId && dto.station_id !== selectedDururStationId) {
      body.innerHTML = 'تم تغيير المحطة. حدّث التحليل لهذه المحطة لعرض المرجع الفعال الصحيح.';
      return;
    }
    var ref = dto.dur.reference || {};
    var phase = dto.dur.active_phase_reference || {};
    var analysisDate = dto.analysis_timestamp ? new Date(dto.analysis_timestamp) : null;
    var startDate = null;
    var endDate = null;
    var useMmddPeriod = normalizeString(dto.dur.period_start) && normalizeString(dto.dur.period_end);
    if (!useMmddPeriod && analysisDate && dto.dur.day_in_period != null) {
      startDate = new Date(analysisDate.getTime());
      startDate.setUTCDate(startDate.getUTCDate() - Math.max(0, Number(dto.dur.day_in_period || 1) - 1));
    }
    if (!useMmddPeriod && analysisDate && dto.dur.days_remaining != null) {
      endDate = new Date(analysisDate.getTime());
      endDate.setUTCDate(endDate.getUTCDate() + Math.max(0, Number(dto.dur.days_remaining || 0)));
    }
    var baseTraits = []
      .concat(ref.general_traits || [])
      .concat(ref.weather_traits || [])
      .concat(ref.marine_traits || [])
      .concat(ref.fish_traits || []);
    var effectiveTraits = []
      .concat(ref.general_traits || [])
      .concat(ref.weather_traits || [])
      .concat(ref.marine_traits || [])
      .concat(ref.fish_traits || [])
      .concat(phase.general_traits || [])
      .concat(phase.weather_traits || [])
      .concat(phase.marine_traits || [])
      .concat(phase.fish_traits || []);
    var uniqueBase = [];
    var unique = [];
    baseTraits.forEach(function (value) { if (value && uniqueBase.indexOf(value) < 0) uniqueBase.push(value); });
    effectiveTraits.forEach(function (value) { if (value && unique.indexOf(value) < 0) unique.push(value); });
    var appliedReferenceLabel = dto.dur.overrides_applied ? 'عليه تخصيص' : 'مرجع عام';
    var tideLabel = mapDtoTideStateToArabic(dto.tide && dto.tide.state);
    var phaseLabel = phase.title_ar || phase.phase_id || dto.dur.active_phase_id || '--';
    var baseReferenceLabel = ref.name_ar || dto.dur.period_name || '--';
    var timingSourceLabel = getTimingSourceLabel(dto.dur || {});
    var calibrationReferenceLabel = dto.dur.calibration_reference_station_name || '--';
    var calibrationBandLabel = dto.dur.calibration_latitude_band_key || '--';
    var calibrationReasonLabel = getCalibrationReasonLabel(dto.dur.calibration_selection_reason);
    var resolvedAnchorLabel = dto.dur.suhail_anchor_date || '--';
    var resolvedCycleStartLabel = dto.dur.cycle_start_date || '--';
    body.innerHTML = ''
      + '<div style="padding:10px;border:1px solid rgba(92,225,255,.18);border-radius:10px;background:rgba(92,225,255,.05)">'
      + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">'
      + '  <div><strong style="color:#9fc1d7">الدر الحالي الآن:</strong><br>' + escapeHtml(dto.dur.period_name || '--') + '</div>'
      + '  <div><strong style="color:#9fc1d7">اليوم داخل الدر:</strong><br>' + escapeHtml(dto.dur.day_in_period != null ? dto.dur.day_in_period : '--') + '</div>'
      + '  <div><strong style="color:#9fc1d7">المرحلة الحالية:</strong><br>' + escapeHtml(phaseLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">بداية الدر (يوم/شهر):</strong><br>' + escapeHtml(useMmddPeriod ? dto.dur.period_start : (startDate ? startDate.toISOString().slice(0, 10) : '--')) + '</div>'
      + '  <div><strong style="color:#9fc1d7">نهاية الدر (يوم/شهر):</strong><br>' + escapeHtml(useMmddPeriod ? dto.dur.period_end : (endDate ? endDate.toISOString().slice(0, 10) : '--')) + '</div>'
      + '  <div><strong style="color:#9fc1d7">الدر التالي:</strong><br>' + escapeHtml(dto.dur.next_period_name || '--') + '</div>'
      + '  <div><strong style="color:#9fc1d7">الأيام المتبقية:</strong><br>' + escapeHtml(dto.dur.days_remaining != null ? dto.dur.days_remaining : '--') + '</div>'
      + '  <div><strong style="color:#9fc1d7">المرجع المطبق:</strong><br>' + escapeHtml(appliedReferenceLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">حالة الحمل / الفساد الحالية:</strong><br>' + escapeHtml(tideLabel || '--') + '</div>'
      + '</div>'
      + '</div>'
      + '<div style="margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.02)">'
      + '<div style="margin-bottom:6px"><strong style="color:#9fc1d7">المرجع العام للدرة</strong> <span style="font-size:.75rem;color:#8fb4c8">(' + escapeHtml(baseReferenceLabel) + ')</span></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">' + (uniqueBase.length ? buildTraitChipHtml(uniqueBase, 'rgba(92,225,255,.16)', 'rgba(92,225,255,.28)', '#dff8ff') : '<span style="color:#9fc1d7">-- لا توجد سمات مرجعية --</span>') + '</div>'
      + '</div>'
      + '<div style="margin-top:10px;padding:10px;border:1px solid rgba(38,194,129,.18);border-radius:10px;background:rgba(38,194,129,.05)">'
      + '<div style="margin-bottom:6px"><strong style="color:#9fc1d7">المرجع الفعال بعد الدمج</strong> <span style="font-size:.75rem;color:#8fb4c8">(يشمل المرحلة الحالية' + (dto.dur.overrides_applied ? ' والتخصيصات' : '') + ')</span></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">' + (unique.length ? buildTraitChipHtml(unique, 'rgba(38,194,129,.16)', 'rgba(38,194,129,.28)', '#dfffea') : '<span style="color:#9fc1d7">-- لا توجد سمات فعالة --</span>') + '</div>'
      + '</div>'
      + '<div style="margin-top:10px;padding:10px;border:1px solid rgba(255,82,82,.18);border-radius:10px;background:rgba(255,82,82,.05)">'
      + '<div style="margin-bottom:6px"><strong style="color:#ffb3b3">مصدر التوقيت (المرجع النهائي)</strong></div>'
      + '<p style="margin:0 0 8px;font-size:.76rem;color:#b8a8a8;line-height:1.4">توقيم يوم/شهر لكل محطة — دون المحرك القديم ودون الاعتماد على السنة الميلادية.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">'
      + '  <div><strong style="color:#9fc1d7">وصف مصدر التوقيت:</strong><br>' + escapeHtml(timingSourceLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">وضع التوقيت:</strong><br>' + escapeHtml(formatTimingModeAr(dto.dur)) + '</div>'
      + '  <div><strong style="color:#9fc1d7">مصدر جدول الدر:</strong><br>' + escapeHtml(formatDurTableSourceAr(dto.dur)) + '</div>'
      + '  <div><strong style="color:#9fc1d7">سبب اختيار المعايرة:</strong><br>' + escapeHtml(calibrationReasonLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">المحطة المستخدمة في المعايرة:</strong><br>' + escapeHtml(calibrationReferenceLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">حزام العرض:</strong><br>' + escapeHtml(calibrationBandLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">مرساة سهيل (للملاحظة):</strong><br>' + escapeHtml(resolvedAnchorLabel) + '</div>'
      + '  <div><strong style="color:#9fc1d7">بداية الدورة (للملاحظة):</strong><br>' + escapeHtml(resolvedCycleStartLabel) + '</div>'
      + '</div>'
      + '</div>';
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

  function setReferenceAnchorStatus() {
    setWaterStatus('unknown', 'محطة مرجعية: يسمح بوضعها على اليابسة كمرساة معايرة ساحلية.');
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
    // Harbours, marinas, docks, basins are water-context even though tagged under landuse/leisure
    var WATER_LANDUSE = ['basin', 'reservoir', 'harbour', 'port'];
    var LAND_LANDUSE = ['residential', 'commercial', 'industrial', 'retail', 'construction', 'farmland', 'farmyard', 'allotments'];
    var LAND_PLACE = ['city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter'];
    var LAND_HIGHWAY = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'footway', 'path', 'cycleway', 'living_street'];
    var waterScore = 0, landScore = 0;
    (elements || []).forEach(function (el) {
      var tags = el.tags || {};
      // Water indicators
      if (WATER_NATURAL.indexOf(tags.natural) !== -1) waterScore += 3;
      if (tags.place === 'sea' || tags.place === 'ocean') waterScore += 3;
      if (tags.waterway && tags.waterway !== 'riverbank') waterScore += 2;
      if (tags.waterway === 'dock') waterScore += 2;
      if (WATER_LANDUSE.indexOf(tags.landuse) !== -1) waterScore += 2;
      if (tags.leisure === 'marina') waterScore += 3;
      if (tags.seamark) waterScore += 3;
      // Land indicators
      if (LAND_LANDUSE.indexOf(tags.landuse) !== -1) landScore += 3;
      if (LAND_PLACE.indexOf(tags.place) !== -1) landScore += 2;
      if (tags.building) landScore += 4;
      if (LAND_HIGHWAY.indexOf(tags.highway) !== -1) landScore += 2;
    });
    return { waterScore: waterScore, landScore: landScore };
  }

  // Classify into one of three deterministic states:
  //   confirmed_water — water clearly dominates, no strong nearby land, point not hugging coastline
  //   confirmed_land  — land score (including nearby features) exceeds water by a clear margin
  //   uncertain       — scores tied/close, or very near coastline, or conflicting signals
  //
  // Parameters:
  //   scores          — { waterScore, landScore } from classifyIsInElements (is_in areas)
  //   hasCoastlineNearby — any coastline way found within 300 m
  //   coastlineDist   — metres to nearest coastline segment, or null if none found
  //   nearbyLandScore — score from classifyNearbyLandFeatures (buildings/roads within 80 m)
  function classifyWaterResult(scores, hasCoastlineNearby, coastlineDist, nearbyLandScore) {
    var W = scores.waterScore;
    var L = scores.landScore;
    var NL = nearbyLandScore || 0;
    var effectiveL = L + NL;

    // No OSM features of any kind — if no coastline nearby, assume deep/open sea
    if (W === 0 && effectiveL === 0) {
      return hasCoastlineNearby ? 'uncertain' : 'confirmed_water';
    }

    // Point is very close to a mapped coastline (< 60 m): require clear water dominance
    if (coastlineDist !== null && coastlineDist < 60) {
      if (W > effectiveL + 2) return 'confirmed_water';
      if (effectiveL > W + 2) return 'confirmed_land';
      return 'uncertain';
    }

    if (W > effectiveL) return 'confirmed_water';      // water wins (strict greater-than)
    if (effectiveL >= W + 2) return 'confirmed_land';  // land wins by clear margin
    return 'uncertain';                                  // close scores — coastal fringe
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

  // Compute minimum distance in metres from (lat, lon) to any mid-point of coastline segments.
  // Returns null when no coastline ways are supplied.
  function minDistToCoastline(lat, lon, coastlineWays) {
    var EARTH_R = 6371000;
    var cosLat = Math.cos(lat * Math.PI / 180);
    var minDist = Infinity;
    (coastlineWays || []).forEach(function (way) {
      var nodes = way.geometry || [];
      for (var i = 0; i < nodes.length - 1; i++) {
        var midLat = (nodes[i].lat + nodes[i + 1].lat) / 2;
        var midLon = (nodes[i].lon + nodes[i + 1].lon) / 2;
        var dy = (midLat - lat) * EARTH_R * (Math.PI / 180);
        var dx = (midLon - lon) * EARTH_R * (Math.PI / 180) * cosLat;
        var dist = Math.sqrt(dy * dy + dx * dx);
        if (dist < minDist) minDist = dist;
      }
    });
    return minDist === Infinity ? null : minDist;
  }

  // Score nearby land features (buildings, roads) returned by around-radius Overpass queries.
  // These elements are NOT from is_in; they are physically near the point.
  function classifyNearbyLandFeatures(elements) {
    var LAND_HIGHWAY = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service'];
    var score = 0;
    (elements || []).forEach(function (el) {
      var tags = el.tags || {};
      if (tags.building) score += 4;
      if (LAND_HIGHWAY.indexOf(tags.highway) !== -1) score += 2;
    });
    return score;
  }

  // ── Lightweight fallback when Overpass is unavailable ──────────────────────
  // Scores three independent signals:
  //   1. Reverse-geocode display name contains a water keyword
  //   2. No nearby buildings or highways detected (nearbyLandScore === 0, or unknown if null)
  //   3. Point is > 100 m from nearest coastline segment (or coastline unknown)
  //
  // Returns one of:
  //   'confirmed_water' — strong enough hint to treat as water (score >= 2)
  //   'uncertain'       — weak hints, cannot upgrade
  //   'confirmed_land'  — NEVER returned; fallback cannot confirm land
  //
  // RULE: this function is only ever called when Overpass fails or returns empty.
  //       It MUST NOT override a prior confirmed_land result.
  function applyFallbackWaterHint(displayName, nearbyLandScore, coastlineDist) {
    var WATER_KEYWORDS = ['sea', 'bay', 'gulf', 'water', 'ocean', 'strait', 'بحر', 'خليج', 'مياه', 'بحيرة'];
    var score = 0;

    // Signal 1 — reverse-geocode name contains a water keyword (+2, strongest signal)
    var lowerName = String(displayName || '').toLowerCase();
    var hasWaterKeyword = WATER_KEYWORDS.some(function (kw) { return lowerName.indexOf(kw) !== -1; });
    if (hasWaterKeyword) score += 2;

    // Signal 2 — no nearby buildings or roads detected (nearbyLandScore known = 0)
    // If nearbyLandScore is null it means no data was available; skip this signal
    if (nearbyLandScore !== null && nearbyLandScore === 0) score += 1;

    // Signal 3 — point is > 100 m away from any mapped coastline (or coastline unknown)
    if (coastlineDist === null || coastlineDist > 100) score += 1;

    return score >= 2 ? 'confirmed_water' : 'uncertain';
  }

  async function detectAndAutoOffsetWater(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    waterCheckState.checking = true;
    waterCheckState.lat = lat;
    waterCheckState.lon = lon;
    waterCheckState.isWater = null;
    waterCheckState.result = 'unknown';
    waterCheckState.fallback = false;
    setWaterStatus('checking', '⏳ جاري فحص الموقع...');
    try {
      var lat6 = lat.toFixed(6);
      var lon6 = lon.toFixed(6);
      // Combined query:
      //   is_in     — all OSM areas containing the point (water/land polygons)
      //   coastline — ways within 300 m for offset geometry and distance measurement
      //   buildings — ways/nodes within 80 m (strong land-presence signal)
      //   highways  — major roads within 60 m (land-presence confirmation)
      var query = '[out:json][timeout:15];(' +
        'is_in(' + lat6 + ',' + lon6 + ');' +
        'way[natural=coastline](around:300,' + lat6 + ',' + lon6 + ');' +
        'way[building](around:80,' + lat6 + ',' + lon6 + ');' +
        'node[building](around:80,' + lat6 + ',' + lon6 + ');' +
        'way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"](around:60,' + lat6 + ',' + lon6 + ');' +
        ');out tags geom;';
      var data = await callOverpass(query, 16000);
      var elements = data.elements || [];

      // ── Empty-response guard: Overpass returned no data at all ──────────────
      // This can happen on partial failure or if the point is in deep open sea
      // with no OSM features mapped within the query radius.
      // Run the fallback before classifying so sea points are not left 'unknown'.
      if (elements.length === 0) {
        var emptyNominatimData = null;
        try {
          var emptyRevUrl = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ar,en&lat=' +
            encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
          var emptyRevRes = await fetch(emptyRevUrl, { headers: { 'Accept': 'application/json' } });
          if (emptyRevRes.ok) emptyNominatimData = await emptyRevRes.json();
        } catch (_fe) { /* ignore — fallback works without geocode name too */ }
        var emptyDisplayName = emptyNominatimData && emptyNominatimData.display_name ? emptyNominatimData.display_name : '';
        var emptyFallbackResult = applyFallbackWaterHint(emptyDisplayName, 0, null);
        waterCheckState.checking = false;
        waterCheckState.fallback = true;
        if (emptyFallbackResult === 'confirmed_water') {
          waterCheckState.isWater = true;
          waterCheckState.result = 'confirmed_water';
          setWaterStatus('water', '🌊 في الماء — تم التحقق (دقة عالية)');
          reverseGeocodeStation(lat, lon);
        } else {
          waterCheckState.isWater = null;
          waterCheckState.result = 'uncertain';
          setWaterStatus('unknown', '⚠️ الموقع غير مؤكد — انقل النقطة إلى البحر');
          reverseGeocodeStation(lat, lon);
        }
        return;
      }

      // Separate elements by source:
      //   coastline ways — natural=coastline (tagged way)
      //   nearby land    — have building or highway tag (from around queries)
      //   is_in areas    — everything else (containing polygon features)
      var coastlineWays = elements.filter(function (el) {
        return el.type === 'way' && el.tags && el.tags.natural === 'coastline';
      });
      var nearbyLandEls = elements.filter(function (el) {
        var tags = el.tags || {};
        return !!tags.building || !!tags.highway;
      });
      var isInEls = elements.filter(function (el) {
        var tags = el.tags || {};
        return !(el.type === 'way' && tags.natural === 'coastline') && !tags.building && !tags.highway;
      });

      var scores = classifyIsInElements(isInEls);
      var coastlineDist = minDistToCoastline(lat, lon, coastlineWays);
      var nearbyLandScore = classifyNearbyLandFeatures(nearbyLandEls);
      var checkResult = classifyWaterResult(scores, coastlineWays.length > 0, coastlineDist, nearbyLandScore);

      if (checkResult === 'confirmed_water') {
        waterCheckState.isWater = true;
        waterCheckState.result = 'confirmed_water';
        waterCheckState.checking = false;
        waterCheckState.fallback = false;
        setWaterStatus('water', '🌊 في الماء — تحقق دقيق');
        reverseGeocodeStation(lat, lon);
        return;
      }

      if (checkResult === 'uncertain') {
        // Coastal fringe — not a confirmed marine point; block save with warning
        waterCheckState.isWater = null;
        waterCheckState.result = 'uncertain';
        waterCheckState.checking = false;
        setWaterStatus('unknown', '⚠️ الموقع غير مؤكد — انقل النقطة إلى البحر');
        reverseGeocodeStation(lat, lon);
        return;
      }

      // confirmed_land — attempt auto coastal offset toward sea
      if (coastlineWays.length > 0) {
        var offsetPt = computeSeaOffsetFromCoastline(lat, lon, coastlineWays);
        if (offsetPt) {
          var verifyQuery = '[out:json][timeout:8];(' +
            'is_in(' + offsetPt.lat.toFixed(6) + ',' + offsetPt.lon.toFixed(6) + ');' +
            'way[natural=coastline](around:300,' + offsetPt.lat.toFixed(6) + ',' + offsetPt.lon.toFixed(6) + ');' +
            ');out tags geom;';
          try {
            var verifyData = await callOverpass(verifyQuery, 10000);
            var ve = verifyData.elements || [];
            var vCoastlines = ve.filter(function (el) {
              return el.type === 'way' && el.tags && el.tags.natural === 'coastline';
            });
            var vIsIn = ve.filter(function (el) {
              var tags = el.tags || {};
              return !(el.type === 'way' && tags.natural === 'coastline');
            });
            var vs = classifyIsInElements(vIsIn);
            var vDist = minDistToCoastline(offsetPt.lat, offsetPt.lon, vCoastlines);
            var verifyResult = classifyWaterResult(vs, vCoastlines.length > 0, vDist, 0);
            if (verifyResult === 'confirmed_water') {
              // Set state BEFORE calling applyStationPointFromMap so that
              // the immediate reverseGeocodeStation call sees the correct water state.
              waterCheckState.isWater = true;
              waterCheckState.result = 'confirmed_water';
              waterCheckState.lat = offsetPt.lat;
              waterCheckState.lon = offsetPt.lon;
              waterCheckState.checking = false;
              setWaterStatus('water', '🌊 في الماء — تحقق دقيق');
              applyStationPointFromMap(offsetPt.lat, offsetPt.lon, true, true, true);
              return;
            }
            if (verifyResult === 'uncertain') {
              // Offset is coastal fringe — not confirmed water; warn and surface the shifted point
              waterCheckState.isWater = null;
              waterCheckState.result = 'uncertain';
              waterCheckState.lat = offsetPt.lat;
              waterCheckState.lon = offsetPt.lon;
              waterCheckState.checking = false;
              setWaterStatus('unknown', '⚠️ الموقع غير مؤكد — انقل النقطة إلى البحر');
              applyStationPointFromMap(offsetPt.lat, offsetPt.lon, true, true, true);
              return;
            }
          } catch (_e) { /* verification fetch failed — fall through */ }
        }
      }
      // Still confirmed land with no valid offset
      waterCheckState.isWater = false;
      waterCheckState.result = 'confirmed_land';
      waterCheckState.fallback = false;
      waterCheckState.checking = false;
      setWaterStatus('land', '⛔ الموقع على اليابسة — لا يمكن الحفظ');
    } catch (e) {
      // ── Overpass failure path: attempt lightweight fallback ──────────────────
      // This catches timeouts (AbortError), HTTP errors, and network failures.
      // We never produce confirmed_land here — only confirmed_water (with fallback
      // flag) or uncertain/unknown so the admin can decide.
      waterCheckState.checking = false;
      waterCheckState.fallback = true;

      var fallbackDisplayName = '';
      var fallbackNearbyLandScore = null; // unknown — Overpass did not respond
      var fallbackCoastlineDist = null;   // unknown
      try {
        var fbRevUrl = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ar,en&lat=' +
          encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
        var fbRevRes = await fetch(fbRevUrl, { headers: { 'Accept': 'application/json' } });
        if (fbRevRes.ok) {
          var fbRevData = await fbRevRes.json();
          fallbackDisplayName = fbRevData && fbRevData.display_name ? fbRevData.display_name : '';
        }
      } catch (_fe) { /* ignore reverse-geocode failure; fallback still runs */ }

      var fallbackResult = applyFallbackWaterHint(fallbackDisplayName, fallbackNearbyLandScore, fallbackCoastlineDist);
      if (fallbackResult === 'confirmed_water') {
        waterCheckState.isWater = true;
        waterCheckState.result = 'confirmed_water';
        setWaterStatus('water', '🌊 في الماء — تم التحقق (دقة عالية)');
        reverseGeocodeStation(lat, lon);
      } else {
        waterCheckState.isWater = null;
        waterCheckState.result = 'uncertain';
        setWaterStatus('unknown', '⚠️ الموقع غير مؤكد — انقل النقطة إلى البحر');
      }
    }
  }

  function scheduleWaterCheck(lat, lon) {
    if (isReferenceAnchorDraft()) {
      if (_waterCheckTimer) clearTimeout(_waterCheckTimer);
      _waterCheckTimer = null;
      waterCheckState.isWater = null;
      waterCheckState.checking = false;
      waterCheckState.result = 'unknown';
      waterCheckState.lat = lat;
      waterCheckState.lon = lon;
      setReferenceAnchorStatus();
      return;
    }
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

  function refreshAllStationMarkers(editingId, visibleStations) {
    if (!stationsAdminMapState || !window.NavidurStationMap) return;
    if (stationsAdminMap && typeof stationsAdminMap.invalidateSize === 'function') {
      stationsAdminMap.invalidateSize();
    }
    var rows = Array.isArray(visibleStations) ? visibleStations : getVisibleAdminStations();
    window.NavidurStationMap.renderStations(stationsAdminMapState, {
      stations: rows,
      isAdminMode: true,
      selectedStationId: selectedDururStationId || currentStationId || '',
      popupBuilder: createDururPopupContent,
      tooltipBuilder: function (station) {
        return isReferenceCalibrationStation(station) ? 'محطة مرجعية' : '';
      },
      onMarkerClick: function (station, marker, event) {
        if (event) L.DomEvent.stop(event);
        fillStationForm(station, true);
        selectDururStation(station.id, { centerMap: false, openPopup: true, triggerAnalysis: true });
        if (marker && typeof marker.openPopup === 'function') marker.openPopup();
      }
    });
    allStationMarkersList = Array.from(stationsAdminMapState.markerMap.entries()).map(function (entry) {
      return { id: entry[0], marker: entry[1] };
    });
    var refOnly = getAdminReferenceOnlyEnabled();
    if (refOnly && rows.length) {
      fitAdminMapToStations(rows);
    }
    var actualMarkerCount = stationsAdminMapState.markerMap ? stationsAdminMapState.markerMap.size : 0;
    if (isAdminMode()) {
      console.info('[admin][stations-map]', {
        totalStationsLoaded: stationsCache.length,
        totalReferenceStationsLoadedIntoCache: getReferenceStationCount(stationsCache),
        referenceStationsInFilteredView: rows.filter(isReferenceCalibrationStation).length,
        drawableReferenceStationsOnMap: countDrawableReferenceStations(rows),
        totalMarkersDrawn: actualMarkerCount,
        totalFilteredStationsShown: rows.length,
        referenceOnly: refOnly,
        isAdminMode: true
      });
    }
  }

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
      var rawCountry = addr.country || '';
      var normCountry = normalizeCountryName(rawCountry);
      var isNewDraft = !getEl('stId').value.trim();

      // Auto-set country (normalized) for new stations or when empty
      if (normCountry) {
        var countryEl = getEl('stCountry');
        if (countryEl && (!_stationEditMode || isNewDraft || !countryEl.value)) {
          countryEl.value = normCountry;
          rebuildRegionSelect(normCountry, getEl('stRegion').value.trim());
        }
      }

      var effectiveCountry = (getEl('stCountry') && getEl('stCountry').value) || normCountry;

      // Auto-suggest region from address, then auto-generate station name
      var regionNow = getEl('stRegion').value.trim();
      if (!_stationEditMode && (!regionNow || regionNow === 'gulf')) {
        var matchedRegion = findBestCoastalRegion(effectiveCountry, addr);
        if (matchedRegion) {
          var sel = getEl('stRegion');
          if (sel) sel.value = matchedRegion;
          if (!_stationNameUserEdited) {
            var autoN = suggestAutoNumber(effectiveCountry, matchedRegion);
            var nameEl = getEl('stName');
            var hintEl2 = getEl('stNameAutoHint');
            if (autoN && nameEl) { nameEl.value = autoN; }
            if (hintEl2) hintEl2.textContent = '(تلقائي)';
          }
        }
      }

      showMarineTypeHint(inferFishingModeFromCoords(lat, lon, effectiveCountry));

      // Use loose coordinate tolerance (1e-4 ≈ 11 m) to accommodate auto-offset shift
      var coordsMatchWaterCheck = waterCheckState &&
        Math.abs(Number(waterCheckState.lat || 0) - Number(lat || 0)) < 1e-4 &&
        Math.abs(Number(waterCheckState.lon || 0) - Number(lon || 0)) < 1e-4;
      var pointIsConfirmedWater = coordsMatchWaterCheck &&
        (waterCheckState.result === 'confirmed_water' || waterCheckState.isWater === true);
      // For confirmed_water: always use marine wording — Nominatim often returns coastal roads.
      // For uncertain / unknown: show the raw Nominatim label so the admin sees real context.
      var placeText;
      if (pointIsConfirmedWater) {
        placeText = formatMarinePlaceSuggestion(addr);
      } else {
        placeText = (data && data.display_name)
          ? data.display_name
          : [suggestedRegion, suggestedCountry].filter(Boolean).join(' - ');
      }
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
    syncInferredFishingModeToForm(lat, lon, getEl('stCountry') ? getEl('stCountry').value : '');
    if (runReverse) reverseGeocodeStation(lat, lon);
    if (!skipWaterCheck) scheduleWaterCheck(lat, lon);
    if (!getEl('stId').value.trim()) {
      renderTransientStationPreview(lat, lon);
    }
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
    stationsAdminMapState = window.NavidurStationMap
      ? window.NavidurStationMap.createContext({
          elementId: mapEl,
          center: [24.0, 53.0],
          zoom: 5,
          attributionControl: true
        })
      : null;
    if (!stationsAdminMapState) return;
    stationsAdminMap = stationsAdminMapState.map;
    window.setTimeout(function () {
      if (stationsAdminMap && typeof stationsAdminMap.invalidateSize === 'function') {
        stationsAdminMap.invalidateSize();
      }
    }, 300);

    stationsAdminMap.on('click', function (e) {
      applyStationPointFromMap(e.latlng.lat, e.latlng.lng, true, true);
    });

    getEl('stLat').addEventListener('input', function () { syncStationMapFromInputs(false); });
    getEl('stLon').addEventListener('input', function () { syncStationMapFromInputs(false); });

    // ── Analytics panel (true-final dur + live analysis) ──────────────────
    var refreshBtn = getEl('stAnalyticsRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', onAnalyticsRefresh);
    var periodSel = getEl('stAnalyticsPeriod');
    if (periodSel) periodSel.addEventListener('change', onAnalyticsPeriodChange);
    var asOfInp = getEl('stAnalyticsAsOfDate');
    if (asOfInp) {
      asOfInp.addEventListener('change', function () {
        if (currentAnalyticsPeriod === 'custom') {
          void renderStationAnalytics();
        }
      });
    }
    updateStAnalyticsAsOfRowVisibility();

    updateStationCoordPreview(NaN, NaN);
    setStationPlaceSuggestion('الموقع المختار: --');
  }

  function readStationForm() {
    var active = !!getEl('stActive').checked;
    var isReferenceStation = getEl('stIsReferenceStation') ? getEl('stIsReferenceStation').checked : false;
    var currentId = getEl('stId').value.trim();
    var prev = currentId ? stationsCache.find(function (s) { return String(s.id) === String(currentId); }) : null;
    var payload = {
      id: currentId || undefined,
      name: getEl('stName').value.trim(),
      lat: Number(getEl('stLat').value),
      lon: Number(getEl('stLon').value),
      country: getEl('stCountry').value.trim(),
      region: getEl('stRegion').value.trim() || '',
      fishing_mode: readFishingModeFromForm(),
      status: active ? 'active' : 'disabled',
      sort_order: Number(getEl('stSort').value || 0),
      default_radius: Number(getEl('stRadius').value || 0.02),
      station_role_type: getEl('stRoleType') ? getEl('stRoleType').value : 'secondary_linked',
      primary_reference: getEl('stPrimaryReference') ? getEl('stPrimaryReference').checked : false,
      is_reference_station: isReferenceStation,
      is_operational_station: !isReferenceStation,
      operational_visibility: !isReferenceStation,
      reference_anchor_mode: isReferenceStation ? 'coastal_land_anchor' : null,
      reference_priority: getEl('stReferencePriority') && getEl('stReferencePriority').value ? Number(getEl('stReferencePriority').value) : null,
      latitude_band_key: getEl('stLatitudeBandKey') ? (getEl('stLatitudeBandKey').value.trim() || null) : null,
      manual_suhail_anchor_date: getEl('stManualSuhailAnchorDate') ? (getEl('stManualSuhailAnchorDate').value || null) : null,
      manual_cycle_start_date: getEl('stManualCycleStartDate') ? (getEl('stManualCycleStartDate').value || null) : null,
      is_verified: getEl('stIsVerified') ? getEl('stIsVerified').checked : false,
      calibration_notes: getEl('stCalibrationNotes') ? (getEl('stCalibrationNotes').value.trim() || null) : null,
      reference_station_id: getEl('stReferenceStation') ? getEl('stReferenceStation').value.trim() : '',
      notes: getEl('stNotes').value.trim(),
      assigned_members: splitCsv(getEl('stMembers').value),
      workbook_city_key: null,
      workbook_city_name: null,
      workbook_match_mode: null,
      workbook_assignment_status: null
    };

    var wbSel = getEl('stWorkbookCitySelect');
    if (wbSel) {
      var wbConfirmed = getEl('stWorkbookMappingConfirmed');
      var skEl = getEl('stWorkbookSuggestKey');
      var smEl = getEl('stWorkbookSuggestMode');
      var ssEl = getEl('stWorkbookSuggestStatus');
      var wbKey = wbSel && wbSel.value ? String(wbSel.value).trim() : '';
      var wbOpt =
        wbSel && wbSel.selectedOptions && wbSel.selectedOptions.length
          ? wbSel.selectedOptions[0]
          : null;
      var wbDisp = wbOpt
        ? wbOpt.getAttribute('data-city-name') || wbOpt.textContent || ''
        : '';
      wbDisp = wbDisp.trim();
      var sugKey = skEl && skEl.value ? String(skEl.value).trim() : '';
      var sugMode = smEl && smEl.value ? String(smEl.value).trim() : '';
      var sugStat = ssEl && ssEl.value ? String(ssEl.value).trim() : '';
      var confirmed = !!(wbConfirmed && wbConfirmed.checked);

      if (!wbKey) {
        payload.workbook_city_key = null;
        payload.workbook_city_name = null;
        payload.workbook_match_mode = null;
        payload.workbook_assignment_status = null;
      } else {
        payload.workbook_city_key = wbKey;
        payload.workbook_city_name = wbDisp || wbKey;
        if (confirmed) {
          payload.workbook_match_mode = 'manual';
          payload.workbook_assignment_status = 'manual_confirmed';
        } else if (sugKey === wbKey && sugMode && sugStat) {
          payload.workbook_match_mode = sugMode;
          payload.workbook_assignment_status = sugStat;
        } else {
          payload.workbook_match_mode = 'manual';
          payload.workbook_assignment_status = 'needs_review';
        }
      }
    } else if (prev) {
      var pk = prev.workbook_city_key != null ? String(prev.workbook_city_key).trim() : '';
      if (!pk) {
        payload.workbook_city_key = null;
        payload.workbook_city_name = null;
        payload.workbook_match_mode = null;
        payload.workbook_assignment_status = null;
      } else {
        payload.workbook_city_key = pk;
        payload.workbook_city_name = prev.workbook_city_name != null && String(prev.workbook_city_name).trim() !== '' ? String(prev.workbook_city_name).trim() : pk;
        payload.workbook_match_mode = prev.workbook_match_mode != null ? prev.workbook_match_mode : 'manual';
        payload.workbook_assignment_status =
          prev.workbook_assignment_status != null ? prev.workbook_assignment_status : 'needs_review';
      }
    }
    payload.suhail_anchor_resolution =
      _pendingSuhailAnchorResolution != null
        ? _pendingSuhailAnchorResolution
        : prev && prev.suhail_anchor_resolution
          ? prev.suhail_anchor_resolution
          : null;
    if (prev && !!prev.is_reference_station === !!payload.is_reference_station) {
      payload.is_operational_station = prev.is_operational_station;
      payload.operational_visibility = prev.operational_visibility;
      payload.reference_anchor_mode = prev.reference_anchor_mode;
    }
    return payload;
  }

  function readTraitCheckboxes(containerId) {
    var container = getEl(containerId);
    if (!container) return [];
    var checked = [];
    Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).forEach(function (cb) {
      var val = cb.getAttribute('data-trait-id');
      if (val) checked.push(val);
    });
    return checked;
  }

  function selectStationForAnalysis(station) {
    if (!station || !station.id) return;

    currentTransientPreviewPoint = null;
    currentStationId = station.id;
    currentAnalyzedStationId = station.id;

    if (getEl('stId')) {
      getEl('stId').value = station.id;
    }
  }

  function clearTrueFinalReferenceCache() {
    _trueFinalRefDocCache = null;
    _trueFinalRefLoadPromise = null;
  }

  function isValidDdMmField(s) {
    var m = String(s || '')
      .trim()
      .match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return false;
    var d = Number(m[1]);
    var mo = Number(m[2]);
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12;
  }

  function clientErrorForHttp(err) {
    var m = err && err.message ? String(err.message) : '';
    if (m === 'http_410' || m.indexOf('http_410') >= 0 || m.indexOf('_410') >= 0) {
      return LEGACY_SYSTEM_CANCELLED_MSG;
    }
    return m || 'خطأ غير معروف';
  }

  function setTrueFinalFormFieldsFromRow(row) {
    var d = row || {};
    var set = function (id, v) {
      var el = getEl(id);
      if (el) el.value = v != null && v !== '' ? String(v) : '';
    };
    set('tfCurrentDur', d.current_dur_name_ar);
    set('tfCurrentDurDay', d.current_dur_day_sheet != null ? d.current_dur_day_sheet : '');
    set('tfCurrentDurStart', d.current_dur_start_md);
    set('tfCurrentDurEnd', d.current_dur_end_md);
    set('tfNextDur', d.next_dur_name_ar);
  }

  function clearTrueFinalFormFields() {
    setTrueFinalFormFieldsFromRow(null);
  }

  function findTrueFinalRowForStation(doc, st) {
    if (!doc || !st) return null;
    var list = Array.isArray(doc.stations) ? doc.stations : [];
    var sid = st.id != null ? String(st.id).trim() : '';
    if (sid) {
      for (var i = 0; i < list.length; i += 1) {
        var r = list[i];
        if (r && String(r.station_id || '').trim() === sid) {
          return r;
        }
      }
    }
    return findTrueFinalRowByStationNameAr(doc, st.name);
  }

  /**
   * @param {object} st — station row from cache
   */
  function refreshTrueFinalReferencePanel(st) {
    var statusEl = getEl('stTrueFinalRefStatus');
    if (getEl('tfCurrentDur') == null) return;
    if (!st || !String(st.id || '').trim()) {
      clearTrueFinalFormFields();
      if (statusEl) statusEl.textContent = 'اختر محطة من الجدول.';
      if (statusEl) statusEl.style.color = '#9ad9ff';
      return;
    }
    if (statusEl) {
      statusEl.textContent = 'جاري التحميل...';
      statusEl.style.color = '#9ad9ff';
    }
    loadTrueFinalStationReferenceDoc()
      .then(function (doc) {
        var row = findTrueFinalRowForStation(doc, st);
        if (!row) {
          clearTrueFinalFormFields();
          if (statusEl) {
            statusEl.textContent = 'لا صف في المرجع يطابق هذه المحطة (المعرف أو الاسم العربي).';
            statusEl.style.color = '#ff9b9b';
          }
          return;
        }
        setTrueFinalFormFieldsFromRow(row);
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.style.color = '#9ad9ff';
        }
      })
      .catch(function (e) {
        clearTrueFinalFormFields();
        if (statusEl) {
          statusEl.textContent = clientErrorForHttp(e);
          statusEl.style.color = '#ff9b9b';
        }
      });
  }

  function saveTrueFinalReferenceEdits() {
    if (!isAdminMode()) return;
    var stId = getEl('stId') && getEl('stId').value.trim();
    var nameAr = getEl('stName') && getEl('stName').value.trim();
    var statusEl = getEl('stTrueFinalRefStatus');
    if (!stId) {
      if (statusEl) {
        statusEl.textContent = 'احفظ معرّف المحطة أولاً.';
        statusEl.style.color = '#ff9b9b';
      }
      return;
    }
    if (!nameAr) {
      if (statusEl) {
        statusEl.textContent = 'أدخل اسماً عربيّاً يطابق عمود «اسم المحطة» في المرجع.';
        statusEl.style.color = '#ff9b9b';
      }
      return;
    }
    var cur = getEl('tfCurrentDur') ? getEl('tfCurrentDur').value.trim() : '';
    var next = getEl('tfNextDur') ? getEl('tfNextDur').value.trim() : '';
    var dayStr = getEl('tfCurrentDurDay') ? getEl('tfCurrentDurDay').value : '';
    var startMd = getEl('tfCurrentDurStart') ? getEl('tfCurrentDurStart').value.trim() : '';
    var endMd = getEl('tfCurrentDurEnd') ? getEl('tfCurrentDurEnd').value.trim() : '';
    if (!cur || !next) {
      if (statusEl) {
        statusEl.textContent = 'أدخل الدر الحالي والدر التالي.';
        statusEl.style.color = '#ff9b9b';
      }
      return;
    }
    if (!isValidDdMmField(startMd) || !isValidDdMmField(endMd)) {
      if (statusEl) {
        statusEl.textContent = 'تنسيق بداية/نهاية الدر: يوم-شهر (مثال 16-04).';
        statusEl.style.color = '#ff9b9b';
      }
      return;
    }
    var dayN = Number(dayStr);
    if (!Number.isFinite(dayN) || dayN < 1) {
      if (statusEl) {
        statusEl.textContent = 'أدخل رقماً صحيحاً ليوم الدر (≥ 1).';
        statusEl.style.color = '#ff9b9b';
      }
      return;
    }
    if (statusEl) {
      statusEl.textContent = 'جاري الحفظ...';
      statusEl.style.color = '#9ad9ff';
    }
    var body = JSON.stringify({
      station_id: stId,
      station_name_ar: nameAr,
      patch: {
        current_dur_name_ar: cur,
        current_dur_day_sheet: dayN,
        current_dur_start_md: startMd,
        current_dur_end_md: endMd,
        next_dur_name_ar: next
      }
    });
    apiFetch('/api?route=admin&path=true-final-reference', {
      method: 'PUT',
      body: body,
      headers: { 'Content-Type': 'application/json' }
    })
      .then(function (res) {
        if (res.status === 410) {
          return Promise.reject(new Error('http_410'));
        }
        return res.json().then(function (j) {
          if (!res.ok) {
            return Promise.reject(new Error((j && j.error) || 'http_' + res.status));
          }
          return j;
        });
      })
      .then(function () {
        clearTrueFinalReferenceCache();
        if (statusEl) {
          statusEl.textContent = 'تم حفظ التعديل في المرجع المحلي';
          statusEl.style.color = '#9ad9ff';
        }
        var st = stationsCache.find(function (s) {
          return s && String(s.id) === String(stId);
        });
        if (st) {
          void refreshTrueFinalReferencePanel(st);
          void refreshDururFilePanelFromTrueFinal(st);
          void refreshStationLocalDurReadout(st, getCanonicalNavidurAsOfIso());
        }
        window.setTimeout(function () {
          if (statusEl && statusEl.textContent === 'تم حفظ التعديل في المرجع المحلي') {
            statusEl.textContent = '';
          }
        }, 4500);
      })
      .catch(function (e) {
        if (statusEl) {
          statusEl.textContent = clientErrorForHttp(e);
          statusEl.style.color = '#ff9b9b';
        }
      });
  }

  function fillStationForm(st, editMode) {
    _stationEditMode = (editMode !== false);
    _stationNameUserEdited = false;
    if (String(_lastStationFormId || '') !== String((st && st.id) || '')) {
      _pendingSuhailAnchorResolution = null;
      clearTrueFinalReferenceCache();
    }
    _lastStationFormId = (st && st.id) || '';
    getEl('stId').value = st.id || '';
    if (isAdminMode()) {
      console.info('[admin][station-edit]', { stationIdLoaded: st.id || null });
    }
    getEl('stCountry').value = st.country || '';
    rebuildRegionSelect(st.country || '', st.region || '');
    getEl('stName').value = st.name || '';
    var coord = readStationLatLon(st);
    getEl('stLat').value = Number.isFinite(coord.lat) ? coord.lat : (st.lat != null ? st.lat : '');
    getEl('stLon').value = Number.isFinite(coord.lon) ? coord.lon : (st.lon != null ? st.lon : '');
    var fmEl = getEl('stFishingMode');
    if (fmEl) fmEl.value = st.fishing_mode === 'deep' ? 'deep' : 'coastal';
    getEl('stActive').checked = st.status !== 'disabled' && st.status !== 'archived';
    getEl('stSort').value = st.sort_order != null ? st.sort_order : 1;
    getEl('stRadius').value = st.default_radius != null ? st.default_radius : 0.02;
    getEl('stRoleType').value = st.station_role_type || 'secondary_linked';
    getEl('stPrimaryReference').checked = !!st.primary_reference;
    if (getEl('stIsReferenceStation')) getEl('stIsReferenceStation').checked = !!st.is_reference_station;
    if (getEl('stReferencePriority')) getEl('stReferencePriority').value = st.reference_priority != null ? st.reference_priority : '';
    if (getEl('stLatitudeBandKey')) getEl('stLatitudeBandKey').value = st.latitude_band_key || '';
    if (getEl('stManualSuhailAnchorDate')) getEl('stManualSuhailAnchorDate').value = st.manual_suhail_anchor_date || '';
    if (getEl('stManualCycleStartDate')) getEl('stManualCycleStartDate').value = st.manual_cycle_start_date || '';
    if (getEl('stIsVerified')) getEl('stIsVerified').checked = !!st.is_verified;
    if (getEl('stCalibrationNotes')) getEl('stCalibrationNotes').value = st.calibration_notes || '';
    getEl('stReferenceStation').value = st.reference_station_id || '';
    getEl('stNotes').value = st.notes || '';
    getEl('stMembers').value = Array.isArray(st.assigned_members) ? st.assigned_members.join(',') : '';
    void refreshTrueFinalReferencePanel(st);
    var pAn = getEl('stAnalyticsPeriod');
    if (pAn) {
      pAn.value = 'now_auto';
      currentAnalyticsPeriod = 'now_auto';
    }
    var dAn = getEl('stAnalyticsAsOfDate');
    if (dAn) dAn.value = getCanonicalNavidurAsOfIso();
    updateStAnalyticsAsOfRowVisibility();
    var hintEl = getEl('stNameAutoHint');
    if (hintEl) hintEl.textContent = '';
    var wrapEl = getEl('newRegionWrap');
    if (wrapEl) wrapEl.style.display = 'none';
    syncStationMapFromInputs(true);
    refreshAllStationMarkers(_stationEditMode ? (st.id || null) : null);
    var fLat = coord.lat;
    var fLon = coord.lon;
    if (Number.isFinite(fLat) && Number.isFinite(fLon)) {
      showMarineTypeHint(fmEl && fmEl.value === 'deep' ? 'deep' : 'coastal');
      reverseGeocodeStation(fLat, fLon);
    } else {
      var mHint = getEl('stMarineTypeHint');
      if (mHint) mHint.style.display = 'none';
      setStationPlaceSuggestion('الموقع المختار: --');
    }

    // ── Fill Durur Profile ──────────────────────────────────────────────────────
    var dururProfile = getResolvedDururProfileForStation(st);
    st.durur_profile = dururProfile;
    _currentDururProfileSource = dururProfile.source || 'reference';
    fillDururProfile(st);
    _loadedDururProfileSnapshot = snapshotDururProfile(dururProfile);
    void refreshStationLocalDurReadout(st, getCanonicalNavidurAsOfIso());
    void updateTrueFinalSuhailButtonAvailability(st);
    if (st && st.id) {
      currentStationId = st.id;
      currentAnalyzedStationId = st.id;
    }
    void renderStationAnalytics();
  }

  function updateTrueFinalSuhailButtonAvailability(st) {
    var btn = getEl('stFetchWorkbookSuhailBtn');
    if (!btn) return;
    var defTitle = 'من الملف: data/true_final_station_reference.json';
    if (!st || !String(st.name || '').trim()) {
      btn.disabled = false;
      btn.setAttribute('title', defTitle);
      return;
    }
    btn.disabled = false;
    btn.setAttribute('title', defTitle);
    loadTrueFinalStationReferenceDoc()
      .then(function (doc) {
        var row = findTrueFinalRowForStation(doc, st);
        if (!row) return;
        var m = row.astronomical_suhail_entry_md != null ? String(row.astronomical_suhail_entry_md).trim() : '';
        if (!m) {
          btn.disabled = true;
          btn.setAttribute('title', 'مرساة سهيل غير متاحة في المرجع الجديد');
        } else {
          btn.disabled = false;
          btn.setAttribute('title', defTitle);
        }
      })
      .catch(function () {
        btn.disabled = false;
        btn.setAttribute('title', defTitle);
      });
  }

  function fillDururProfile(station, opts) {
    void opts;
    if (!station || !station.id) {
      clearDururFilePanelNotFound();
      return;
    }
    void refreshDururFilePanelFromTrueFinal(station);
  }

  function setDurFilePanelValue(id, value) {
    var el = getEl(id);
    if (!el) return;
    if (value == null || value === '' || value === '--') {
      el.value = '';
    } else {
      el.value = String(value);
    }
  }

  function clearDururFilePanelNotFound() {
    setDurFilePanelValue('stDururCurrentName', '');
    setDurFilePanelValue('stDururDayInPeriod', '');
    setDurFilePanelValue('stDururActivePhase', '');
    setDurFilePanelValue('stDururStartDate', '');
    setDurFilePanelValue('stDururEndDate', '');
    setDurFilePanelValue('stDururNextName', '');
    setDurFilePanelValue('stDururDaysRemaining', '');
    var statusEl = getEl('stDururStatus');
    if (statusEl) {
      statusEl.textContent = DUR_FILE_NO_STATION_DATA_MSG;
    }
  }

  function applyTrueFinalRowToDurFilePanel(row) {
    setDurFilePanelValue('stDururCurrentName', row.current_dur_name_ar);
    setDurFilePanelValue('stDururDayInPeriod', row.current_dur_day_sheet != null ? String(row.current_dur_day_sheet) : '');
    setDurFilePanelValue('stDururActivePhase', row.seasonal_model != null ? String(row.seasonal_model) : '');
    setDurFilePanelValue('stDururStartDate', row.current_dur_start_md);
    setDurFilePanelValue('stDururEndDate', row.current_dur_end_md);
    setDurFilePanelValue('stDururNextName', row.next_dur_name_ar);
    var rem = row.remaining_days_sheet != null ? row.remaining_days_sheet : row.remaining_days;
    setDurFilePanelValue('stDururDaysRemaining', rem != null ? String(rem) : '');
    var statusEl = getEl('stDururStatus');
    if (statusEl) {
      statusEl.textContent = DUR_FILE_STATUS_FROM_REF_MSG;
    }
  }

  function refreshDururFilePanelFromTrueFinal(st) {
    st = getStationForLocalDurReadout(st);
    if (!st || !st.id) {
      clearDururFilePanelNotFound();
      return;
    }
    return loadTrueFinalStationReferenceDoc()
      .then(function (doc) {
        var row = findTrueFinalRowForStation(doc, st);
        if (!row) {
          clearDururFilePanelNotFound();
          return;
        }
        applyTrueFinalRowToDurFilePanel(row);
      })
      .catch(function () {
        clearDururFilePanelNotFound();
      });
  }

  function populateTraitCheckboxes(containerId, selectedIds) {
    var container = getEl(containerId);
    if (!container) return;
    Array.from(container.querySelectorAll('input[type="checkbox"]')).forEach(function (cb) {
      var traitId = cb.getAttribute('data-trait-id');
      cb.checked = selectedIds.indexOf(traitId) >= 0;
    });
  }

  function clearStationForm() {
    console.info('[RESET_CLICK]');
    _stationEditMode = false;
    selectedDururStationId = null;
    currentStationId = null;
    currentAnalyzedStationId = null;
    currentTransientPreviewPoint = null;
    fillStationForm({
      id: '',
      name: '',
      lat: '',
      lon: '',
      country: '',
      region: '',
      fishing_mode: 'coastal',
      status: 'active',
      sort_order: 1,
      default_radius: 0.02,
      notes: '',
      assigned_members: [],
      station_role_type: 'secondary_linked',
      primary_reference: false,
      is_reference_station: false,
      is_verified: false,
      reference_priority: null,
      latitude_band_key: '',
      manual_suhail_anchor_date: '',
      manual_cycle_start_date: '',
      calibration_notes: '',
      reference_station_id: '',
      workbook_city_key: null,
      workbook_city_name: null,
      workbook_match_mode: null,
      workbook_assignment_status: null
    }, false);
    var fmClear = getEl('stFishingMode');
    if (fmClear) fmClear.value = 'coastal';
    selectDururStation(null, { centerMap: false });
    if (stationAdminMarker && stationsAdminMap) {
      stationsAdminMap.removeLayer(stationAdminMarker);
      stationAdminMarker = null;
    }
    refreshAllStationMarkers(null, getVisibleAdminStations());
    updateStationCoordPreview(NaN, NaN);
    setStationPlaceSuggestion('الموقع المختار: --');
    var mHintClear = getEl('stMarineTypeHint');
    if (mHintClear) mHintClear.style.display = 'none';
    waterCheckState.isWater = null;
    waterCheckState.lat = null;
    waterCheckState.lon = null;
    waterCheckState.checking = false;
    waterCheckState.result = 'unknown';
    if (_waterCheckTimer) { clearTimeout(_waterCheckTimer); _waterCheckTimer = null; }
    setWaterStatus('unknown', '');

    clearReadOnlyDurProfile('--');
    clearStationLocalDurPanel();
    clearAdminAnalysisDisplay('جاهز');
    _lastStationFormId = null;
    _pendingSuhailAnchorResolution = null;
    console.info('[RESET_DONE]');
  }

  function setStationLocalField(id, value) {
    var el = getEl(id);
    if (!el) return;
    if (value == null || value === '' || value === '--') {
      el.value = '';
    } else {
      el.value = String(value);
    }
  }

  function getStationForLocalDurReadout(st) {
    if (!st || !st.id) return st;
    var id = String(st.id).trim();
    var cached = stationsCache.find(function (s) {
      return s && String(s.id) === id;
    });
    var base = cached ? Object.assign({}, cached) : Object.assign({}, st);
    var manualEl = getEl('stManualSuhailAnchorDate');
    if (manualEl && manualEl.value && String(manualEl.value).trim() !== '') {
      base.manual_suhail_anchor_date = String(manualEl.value).trim();
    }
    var nameEl = getEl('stName');
    if (nameEl && nameEl.value && String(nameEl.value).trim() !== '') {
      base.name = String(nameEl.value).trim();
    }
    if (_pendingSuhailAnchorResolution) {
      base.suhail_anchor_resolution = _pendingSuhailAnchorResolution;
    }
    return base;
  }

  function onStationIdentityChangedForLocalPanel() {
    var stId = getEl('stId') && getEl('stId').value.trim();
    if (!stId) return;
    var st = stationsCache.find(function (s) {
      return s && String(s.id) === stId;
    });
    if (!st) return;
    void refreshDururFilePanelFromTrueFinal(st);
    void refreshStationLocalDurReadout(st, getCanonicalNavidurAsOfIso());
  }

  function onManualSuhailChangedForLocalPanel() {
    var stId = getEl('stId') && getEl('stId').value.trim();
    if (!stId) return;
    var st = stationsCache.find(function (s) {
      return s && String(s.id) === stId;
    });
    if (st) {
      void refreshDururFilePanelFromTrueFinal(st);
      void refreshStationLocalDurReadout(st, getCanonicalNavidurAsOfIso());
    } else {
      void refreshDururFilePanelFromTrueFinal({ id: stId, name: (getEl('stName') && getEl('stName').value.trim()) || '' });
      void refreshStationLocalDurReadout(
        { id: stId, name: (getEl('stName') && getEl('stName').value.trim()) || '' },
        getCanonicalNavidurAsOfIso()
      );
    }
  }

  function clearStationLocalDurPanel() {
    setStationLocalField('stStationLocalAnchorDateRo', '');
    setStationLocalField('stStationLocalAnchorMeaningRo', '');
    setStationLocalField('stStationLocalDurNameRo', '');
    setStationLocalField('stStationLocalDayInDurRo', '');
    setStationLocalField('stStationLocalStartRo', '');
    setStationLocalField('stStationLocalEndRo', '');
    setStationLocalField('stStationLocalNextRo', '');
    var msg = getEl('stStationLocalDurMsg');
    if (msg) {
      msg.textContent = '';
    }
  }

  function applyTrueFinalRowToLocalDurPanel(st, row) {
    setStationLocalField('stStationLocalDurNameRo', row.current_dur_name_ar);
    setStationLocalField('stStationLocalDayInDurRo', row.current_dur_day_sheet != null ? String(row.current_dur_day_sheet) : '');
    setStationLocalField('stStationLocalStartRo', row.current_dur_start_md);
    setStationLocalField('stStationLocalEndRo', row.current_dur_end_md);
    setStationLocalField('stStationLocalNextRo', row.next_dur_name_ar);
    if (st && st.manual_suhail_anchor_date) {
      setStationLocalField('stStationLocalAnchorDateRo', st.manual_suhail_anchor_date);
    } else {
      setStationLocalField('stStationLocalAnchorDateRo', row.reference_date_md != null ? String(row.reference_date_md).trim() : '');
    }
    var sar = st && st.suhail_anchor_resolution;
    if (sar && sar.dur_name_ar != null) {
      var dPart = sar.day_in_dur != null && sar.day_in_dur !== '' ? ' / اليوم ' + String(sar.day_in_dur) : '';
      setStationLocalField('stStationLocalAnchorMeaningRo', String(sar.dur_name_ar) + dPart);
    } else {
      var dn = row.dur_at_astronomical_entry != null ? String(row.dur_at_astronomical_entry).trim() : '';
      var di = row.dur_day_at_astronomical_entry != null ? String(row.dur_day_at_astronomical_entry) : '';
      if (dn) {
        setStationLocalField('stStationLocalAnchorMeaningRo', (di ? 'عند دخول سهيل: ' : '') + dn + (di ? ' — اليوم ' + di : ''));
      } else {
        setStationLocalField('stStationLocalAnchorMeaningRo', '');
      }
    }
    var line = getEl('stStationLocalDurMsg');
    if (line) {
      line.textContent = 'مُستمدّ من المرجع النهائي للمحطة (data/true_final_station_reference.json).';
      line.style.color = '#b8d4e8';
    }
  }

  function applyNoTrueFinalRowForLocalPanel(st) {
    setStationLocalField('stStationLocalDurNameRo', '');
    setStationLocalField('stStationLocalDayInDurRo', '');
    setStationLocalField('stStationLocalStartRo', '');
    setStationLocalField('stStationLocalEndRo', '');
    setStationLocalField('stStationLocalNextRo', '');
    setStationLocalField('stStationLocalAnchorDateRo', st && st.manual_suhail_anchor_date ? st.manual_suhail_anchor_date : '');
    var sar = st && st.suhail_anchor_resolution;
    if (sar && sar.dur_name_ar != null) {
      setStationLocalField('stStationLocalAnchorMeaningRo', sar.dur_name_ar + ' / اليوم ' + String(sar.day_in_dur != null ? sar.day_in_dur : ''));
    } else {
      setStationLocalField('stStationLocalAnchorMeaningRo', '');
    }
    var line = getEl('stStationLocalDurMsg');
    if (line) {
      line.textContent = 'لا يوجد مرجع محلي لهذه المحطة';
      line.style.color = '#e8c49a';
    }
  }

  function refreshStationLocalDurReadout(st, asOfIso) {
    console.log('Loader executed:', 'refreshStationLocalDurReadout');
    if (!getEl('stStationLocalDurDetails')) {
      console.warn('Missing element:', 'stStationLocalDurDetails');
      return;
    }
    st = getStationForLocalDurReadout(st);
    if (!st || !st.id) {
      clearStationLocalDurPanel();
      return;
    }
    var line = getEl('stStationLocalDurMsg');
    if (line) {
      line.textContent = 'جاري التحميل...';
      line.style.color = '#b8d4e8';
    }
    return loadTrueFinalStationReferenceDoc()
      .then(function (doc) {
        var row = findTrueFinalRowForStation(doc, st);
        if (!row) {
          applyNoTrueFinalRowForLocalPanel(st);
          return;
        }
        applyTrueFinalRowToLocalDurPanel(st, row);
      })
      .catch(function (e) {
        clearStationLocalDurPanel();
        if (line) {
          line.textContent = clientErrorForHttp(e);
          line.style.color = '#ff9b9b';
        }
      });
  }

  function setReadOnlyFieldValue(id, value) {
    var el = getEl(id);
    if (!el) return;
    el.value = value == null || value === '' ? '--' : String(value);
  }

  function clearReadOnlyDurProfile(statusText) {
    void statusText;
    var stId = getEl('stId') && getEl('stId').value.trim();
    var st = stId
      ? stationsCache.find(function (s) {
          return s && String(s.id) === stId;
        })
      : null;
    if (st) {
      void refreshDururFilePanelFromTrueFinal(st);
    } else {
      clearDururFilePanelNotFound();
    }
  }

  function renderTraitList(containerId, values, bgColor, borderColor, textColor, emptyText) {
    var container = getEl(containerId);
    if (!container) return;
    var normalized = uniqueNonEmptyValues(values);
    container.innerHTML = normalized.length
      ? buildTraitChipHtml(normalized, bgColor, borderColor, textColor)
      : '<span style="color:#9fc1d7">' + escapeHtml(emptyText || '--') + '</span>';
  }

  function renderValidationExplanation(dto, observedTraitsOverride) {
    var dur = dto && dto.dur ? dto.dur : {};
    var ref = dur.reference || {};
    var phase = dur.active_phase_reference || {};
    var expectedTraits;
    if (Array.isArray(dur.unified_expected_traits) && dur.unified_expected_traits.length) {
      expectedTraits = uniqueNonEmptyValues(dur.unified_expected_traits);
    } else {
      expectedTraits = uniqueNonEmptyValues([]
        .concat(ref.general_traits || [])
        .concat(ref.weather_traits || [])
        .concat(ref.marine_traits || [])
        .concat(phase.general_traits || [])
        .concat(phase.weather_traits || [])
        .concat(phase.marine_traits || [])
        .concat(phase.fish_traits || []));
    }
    var observedTraits = uniqueNonEmptyValues(Array.isArray(observedTraitsOverride) ? observedTraitsOverride : deriveObservedTraitsFromAnalysis(dto));
    var matchedTraits = expectedTraits.filter(function (trait) { return observedTraits.indexOf(trait) >= 0; });
    var missingTraits = expectedTraits.filter(function (trait) { return observedTraits.indexOf(trait) < 0; });
    var extraTraits = observedTraits.filter(function (trait) { return expectedTraits.indexOf(trait) < 0; });
    renderTraitList('stAnalyticsExpectedTraitList', expectedTraits, 'rgba(92,225,255,.16)', 'rgba(92,225,255,.28)', '#dff8ff', 'لا توجد سمات متوقعة');
    renderTraitList('stAnalyticsObservedTraitList', observedTraits, 'rgba(38,194,129,.16)', 'rgba(38,194,129,.28)', '#dfffea', 'لا توجد سمات مرصودة');
    renderTraitList('stAnalyticsMatchedTraitList', matchedTraits, 'rgba(110,231,183,.18)', 'rgba(110,231,183,.28)', '#dfffea', 'لا توجد سمات متطابقة');
    renderTraitList('stAnalyticsMissingTraitList', missingTraits, 'rgba(255,120,120,.12)', 'rgba(255,120,120,.22)', '#ffd8d8', 'لا توجد سمات مفقودة');
    renderTraitList('stAnalyticsExtraTraitList', extraTraits, 'rgba(255,185,0,.12)', 'rgba(255,185,0,.22)', '#ffe7aa', 'لا توجد سمات زائدة');
    var expCountEl = getEl('stAnalyticsExpectedCount');
    var obsCountEl = getEl('stAnalyticsObservedCount');
    if (expCountEl) expCountEl.textContent = String(expectedTraits.length) + ' سمة';
    if (obsCountEl) obsCountEl.textContent = String(observedTraits.length) + ' سمة';
    var sc = getEl('stAnalyticsScore');
    var st = getEl('stAnalyticsStatus');
    if (expectedTraits.length && observedTraits.length) {
      var pct = Math.round((matchedTraits.length / expectedTraits.length) * 1000) / 10;
      if (sc) sc.textContent = String(pct) + '%';
      if (st) st.textContent = pct >= 70 ? 'متطابق' : pct >= 40 ? 'متوسط' : 'ضعيف';
    } else {
      if (sc) sc.textContent = '—';
      if (st) st.textContent = 'بانتظار البيانات';
    }
  }

  // ── Durur Profile Functions ───────────────────────────────────────────────

  function loadDururTraits() {
    // Clear existing checkboxes
    ['stDururWeatherTraits', 'stDururMarineTraits', 'stDururSeasonalTraits', 'stDururFishTraits'].forEach(function (id) {
      var el = getEl(id);
      if (el) el.innerHTML = '';
    });

    // Load weather traits
    var weatherTraits = traitsCache.filter(function (t) { return t.category === 'weather'; });
    populateTraitContainer('stDururWeatherTraits', weatherTraits);

    // Load marine traits
    var marineTraits = traitsCache.filter(function (t) { return t.category === 'marine'; });
    populateTraitContainer('stDururMarineTraits', marineTraits);

    // Load general transition traits
    var generalTraits = traitsCache.filter(function (t) { return t.category === 'general'; });
    populateTraitContainer('stDururGeneralTraits', generalTraits);

    // Load seasonal traits
    var seasonalTraits = seasonEventsCache;
    populateSeasonEventContainer('stDururSeasonalTraits', seasonalTraits);

    // Load fish activity traits (from durur fish_traits)
    var fishTraits = [];
    dururCache.forEach(function (d) {
      (d.fish_traits || []).forEach(function (ft) {
        if (!fishTraits.find(function (x) { return x === ft; })) {
          fishTraits.push(ft);
        }
      });
    });
    populateFishTraitContainer('stDururFishTraits', fishTraits);
  }

  function populateTraitContainer(containerId, traits) {
    var container = getEl(containerId);
    if (!container) return;
    traits.forEach(function (trait) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:6px';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-trait-id', trait.id);
      cb.style.cursor = 'pointer';
      var label = document.createElement('label');
      label.style.cssText = 'cursor:pointer;font-size:.85rem;color:#c5d5e0;margin:0';
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + (trait.name_ar || trait.name || trait.id)));
      div.appendChild(label);
      container.appendChild(div);
    });
  }

  function populateSeasonEventContainer(containerId, seasonEvents) {
    var container = getEl(containerId);
    if (!container) return;
    seasonEvents.forEach(function (event) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:6px';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-trait-id', event.id);
      cb.style.cursor = 'pointer';
      var label = document.createElement('label');
      label.style.cssText = 'cursor:pointer;font-size:.85rem;color:#c5d5e0;margin:0';
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + (event.name_ar || event.name || event.id)));
      div.appendChild(label);
      container.appendChild(div);
    });
  }

  function populateFishTraitContainer(containerId, fishTraits) {
    var container = getEl(containerId);
    if (!container) return;
    fishTraits.forEach(function (trait) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:6px';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-trait-id', trait);
      cb.style.cursor = 'pointer';
      var label = document.createElement('label');
      label.style.cssText = 'cursor:pointer;font-size:.85rem;color:#c5d5e0;margin:0';
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + trait));
      div.appendChild(label);
      container.appendChild(div);
    });
  }

  function getSelectedFishActivityTraits() {
    var container = getEl('stDururFishTraits');
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(function (cb) {
      return cb.getAttribute('data-trait-id');
    }).filter(function (v) { return v; });
  }

  function getFishTraitsForDur(durId) {
    var dur = getDururById(durId);
    return dur && Array.isArray(dur.fish_traits) ? dur.fish_traits.slice() : [];
  }

  function updateFishActivityOptions(durId, manualTraits) {
    var container = getEl('stDururFishTraits');
    if (!container) return;
    var selectedTraits = Array.isArray(manualTraits) ? manualTraits.slice() : getSelectedFishActivityTraits();
    var defaultTraits = getFishTraitsForDur(durId);
    var combinedTraits = defaultTraits.slice();
    selectedTraits.forEach(function (trait) {
      if (combinedTraits.indexOf(trait) < 0) {
        combinedTraits.push(trait);
      }
    });

    container.innerHTML = '';
    populateFishTraitContainer('stDururFishTraits', combinedTraits);
    populateTraitCheckboxes('stDururFishTraits', selectedTraits);

    var noteId = 'stDururFishTraitNote';
    var note = getEl(noteId);
    if (!note) {
      note = document.createElement('div');
      note.id = noteId;
      note.style.cssText = 'font-size:.78rem;color:#9fc1d7;margin-top:8px;line-height:1.4';
      if (container.parentNode) container.parentNode.insertBefore(note, container.nextSibling);
    }
    var noteText = 'السمك الافتراضي من المرجع: ' + (defaultTraits.length ? defaultTraits.join(', ') : '--');
    var manualOnly = selectedTraits.filter(function (trait) { return defaultTraits.indexOf(trait) < 0; });
    if (manualOnly.length > 0) {
      noteText += ' | القيم اليدوية: ' + manualOnly.join(', ');
    }
    note.textContent = noteText;
  }

  function getSelectedTraitIds(containerId) {
    var container = getEl(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(function (cb) {
      return cb.getAttribute('data-trait-id');
    }).filter(function (id) { return id; });
  }

  function getSeasonEventsByIds(ids) {
    if (!Array.isArray(ids)) return [];
    return seasonEventsCache.filter(function (e) { return ids.indexOf(e.id) >= 0; });
  }

  function getTraitLabelsByIds(ids) {
    if (!Array.isArray(ids)) return [];
    return traitsCache.filter(function (t) { return ids.indexOf(t.id) >= 0; }).map(function (t) {
      return t.name_ar || t.name || t.id;
    });
  }

  function getDurReferenceTraitIds(dur, category) {
    if (!dur || !Array.isArray(dur[category + '_traits'])) return [];
    return mapDururTraitNamesToIds(dur[category + '_traits'], category).filter(function (id) { return id; });
  }

  function getDurReferenceTraitLabels(dur, category) {
    if (!dur || !Array.isArray(dur[category + '_traits'])) return [];
    var labels = dur[category + '_traits'].slice();
    var ids = mapDururTraitNamesToIds(dur[category + '_traits'], category);
    return labels.map(function (label, index) {
      var id = ids[index];
      if (!id) return label;
      var trait = traitsCache.find(function (t) { return t.id === id; });
      return trait ? (trait.name_ar || trait.name || label) : label;
    }).filter(Boolean);
  }

  function updateDurReferenceDisplay(durId, manualWeatherIds, manualMarineIds, manualGeneralIds, manualSeasonIds, manualFishTraits) {
    var dur = getDururById(durId);
    var noteId = 'stDururReferenceInfo';
    var container = getEl(noteId);
    if (!container) {
      var statusNode = getEl('stDururStatus');
      if (!statusNode || !statusNode.parentNode) return;
      container = document.createElement('div');
      container.id = noteId;
      container.style.cssText = 'margin-top:10px;font-size:.84rem;color:#9fc1d7;line-height:1.5';
      if (statusNode.nextSibling) {
        statusNode.parentNode.insertBefore(container, statusNode.nextSibling);
      } else {
        statusNode.parentNode.appendChild(container);
      }
    }
    if (!dur) {
      container.innerHTML = '<div>معلومات الدر المرجعية غير متاحة.</div>';
      return;
    }
    var details = [];
    details.push('اسم الدر: ' + (dur.name_ar || dur.name || '--'));
    details.push('رقم الدر: ' + (dur.dur_number != null ? dur.dur_number : '--'));
    if (dur.season_ar) details.push('الموسم: ' + dur.season_ar);
    if (dur.heritage_meaning_ar) details.push('المعنى التقليدي: ' + dur.heritage_meaning_ar);
    var description = dur.notes_ar || dur.description_ar || dur.description || '';
    if (description) details.push('الوصف: ' + description);

    var referenceWeather = getDurReferenceTraitLabels(dur, 'weather');
    var referenceWeatherIds = getDurReferenceTraitIds(dur, 'weather');
    if (referenceWeather.length > 0) {
      details.push('سمات الطقس المرجعية: ' + referenceWeather.join(', '));
    } else {
      details.push('لا توجد سمات طقس مرجعية.');
    }

    var referenceMarine = getDurReferenceTraitLabels(dur, 'marine');
    var referenceMarineIds = getDurReferenceTraitIds(dur, 'marine');
    if (referenceMarine.length > 0) {
      details.push('سمات البحر المرجعية: ' + referenceMarine.join(', '));
    } else {
      details.push('لا توجد سمات بحرية مرجعية.');
    }

    var referenceGeneral = getDurReferenceTraitLabels(dur, 'general');
    var referenceGeneralIds = getDurReferenceTraitIds(dur, 'general');
    if (referenceGeneral.length > 0) {
      details.push('سمات عامة مرجعية: ' + referenceGeneral.join(', '));
    } else {
      details.push('لا توجد سمات عامة مرجعية.');
    }

    var referenceFish = Array.isArray(dur.fish_traits) ? dur.fish_traits.slice() : [];
    if (referenceFish.length > 0) {
      details.push('سمات السمك المرجعية: ' + referenceFish.join(', '));
    } else {
      details.push('لا توجد سمات سمك مرجعية.');
    }

    var referenceEvents = getSeasonEventsForDur(dur);
    if (referenceEvents.length > 0) {
      details.push('الأحداث الموسمية المرجعية: ' + referenceEvents.map(function (e) { return e.name_ar || e.name || e.id; }).join(', '));
    } else {
      details.push('لا توجد أحداث موسمية مرجعية مرتبطة.');
    }

    var selectedManualWeather = Array.isArray(manualWeatherIds) ? manualWeatherIds : getSelectedTraitIds('stDururWeatherTraits');
    var manualWeatherIdsOnly = selectedManualWeather.filter(function (id) { return referenceWeatherIds.indexOf(id) < 0; });
    if (manualWeatherIdsOnly.length > 0) {
      details.push('سمات الطقس اليدوية: ' + getTraitLabelsByIds(manualWeatherIdsOnly).join(', '));
    }

    var selectedManualMarine = Array.isArray(manualMarineIds) ? manualMarineIds : getSelectedTraitIds('stDururMarineTraits');
    var manualMarineIdsOnly = selectedManualMarine.filter(function (id) { return referenceMarineIds.indexOf(id) < 0; });
    if (manualMarineIdsOnly.length > 0) {
      details.push('سمات البحر اليدوية: ' + getTraitLabelsByIds(manualMarineIdsOnly).join(', '));
    }

    var selectedManualGeneral = Array.isArray(manualGeneralIds) ? manualGeneralIds : getSelectedTraitIds('stDururGeneralTraits');
    var manualGeneralIdsOnly = selectedManualGeneral.filter(function (id) { return referenceGeneralIds.indexOf(id) < 0; });
    if (manualGeneralIdsOnly.length > 0) {
      details.push('سمات عامة يدوية: ' + getTraitLabelsByIds(manualGeneralIdsOnly).join(', '));
    }

    var selectedManualFish = Array.isArray(manualFishTraits) ? manualFishTraits : getSelectedFishActivityTraits();
    var manualFishOnly = selectedManualFish.filter(function (trait) { return referenceFish.indexOf(trait) < 0; });
    if (manualFishOnly.length > 0) {
      details.push('سمات السمك اليدوية: ' + manualFishOnly.join(', '));
    }

    var selectedManualSeason = Array.isArray(manualSeasonIds) ? manualSeasonIds : getSelectedTraitIds('stDururSeasonalTraits');
    var manualSeasonIdsOnly = selectedManualSeason.filter(function (id) { return referenceEvents.every(function (e) { return e.id !== id; }); });
    if (manualSeasonIdsOnly.length > 0) {
      var manualEvents = getSeasonEventsByIds(manualSeasonIdsOnly);
      details.push('الأحداث الموسمية اليدوية: ' + (manualEvents.length ? manualEvents.map(function (e) { return e.name_ar || e.name || e.id; }).join(', ') : manualSeasonIdsOnly.join(', ')));
    }

    container.innerHTML = details.map(function (line) {
      return '<div>' + line + '</div>';
    }).join('');
  }

  function ensureAnalyticsDurReferenceFields() {
    var container = getEl('stAnalyticsDerivedReading');
    if (!container) return;
    ['stAnalyticsDurSeason', 'stAnalyticsDurMeaning', 'stAnalyticsDurDescription', 'stAnalyticsDurGeneral', 'stAnalyticsDurWeather', 'stAnalyticsDurMarine', 'stAnalyticsDurFish', 'stAnalyticsDurEvents', 'stAnalyticsDurManualWeather', 'stAnalyticsDurManualMarine', 'stAnalyticsDurManualFish', 'stAnalyticsDurManualDurEvents'].forEach(function (id) {
      if (!getEl(id)) {
        var label = 'الموسم:';
        if (id === 'stAnalyticsDurMeaning') label = 'المعنى التقليدي:';
        if (id === 'stAnalyticsDurDescription') label = 'الوصف:';
        if (id === 'stAnalyticsDurGeneral') label = 'السمات العامة المرجعية:';
        if (id === 'stAnalyticsDurWeather') label = 'سمات الطقس المرجعية:';
        if (id === 'stAnalyticsDurMarine') label = 'سمات البحر المرجعية:';
        if (id === 'stAnalyticsDurFish') label = 'سمات السمك المرجعية:';
        if (id === 'stAnalyticsDurEvents') label = 'الأحداث الموسمية المرجعية:';
        if (id === 'stAnalyticsDurManualWeather') label = 'سمات الطقس اليدوية:';
        if (id === 'stAnalyticsDurManualMarine') label = 'سمات البحر اليدوية:';
        if (id === 'stAnalyticsDurManualFish') label = 'سمات السمك اليدوية:';
        if (id === 'stAnalyticsDurManualDurEvents') label = 'الأحداث الموسمية اليدوية:';
        var div = document.createElement('div');
        div.innerHTML = '<strong style="color:#9fc1d7">' + label + '</strong> <span id="' + id + '">--</span>';
        container.appendChild(div);
      }
    });
  }

  function updateAnalyticsDurReferenceDisplay(dur, manualWeatherIds, manualMarineIds, manualGeneralIds, manualSeasonIds, manualFishTraits) {
    ensureAnalyticsDurReferenceFields();
    var resolvedReference = dur && dur.reference ? dur.reference : null;
    var seasonEl = getEl('stAnalyticsDurSeason');
    var meaningEl = getEl('stAnalyticsDurMeaning');
    var descriptionEl = getEl('stAnalyticsDurDescription');
    var generalEl = getEl('stAnalyticsDurGeneral');
    var weatherEl = getEl('stAnalyticsDurWeather');
    var marineEl = getEl('stAnalyticsDurMarine');
    var fishEl = getEl('stAnalyticsDurFish');
    var eventsEl = getEl('stAnalyticsDurEvents');
    var manualWeatherEl = getEl('stAnalyticsDurManualWeather');
    var manualMarineEl = getEl('stAnalyticsDurManualMarine');
    var manualFishEl = getEl('stAnalyticsDurManualFish');
    var manualSeasonEl = getEl('stAnalyticsDurManualDurEvents');
    if (!seasonEl || !meaningEl || !descriptionEl || !generalEl || !weatherEl || !marineEl || !fishEl || !eventsEl || !manualWeatherEl || !manualMarineEl || !manualFishEl || !manualSeasonEl) return;
    seasonEl.textContent = resolvedReference ? (resolvedReference.season_ar || '--') : (dur && dur.season_ar ? dur.season_ar : '--');
    meaningEl.textContent = resolvedReference
      ? (resolvedReference.heritage_meaning_ar || '--')
      : (dur && dur.heritage_meaning_ar ? dur.heritage_meaning_ar : '--');
    descriptionEl.textContent = resolvedReference
      ? (resolvedReference.notes_ar || resolvedReference.description_ar || '--')
      : (dur ? (dur.notes_ar || dur.description_ar || dur.description || '--') : '--');
    generalEl.textContent = resolvedReference && Array.isArray(resolvedReference.general_traits) && resolvedReference.general_traits.length
      ? resolvedReference.general_traits.join(', ')
      : '--';

    var referenceWeather = resolvedReference ? (resolvedReference.weather_traits || []).slice() : (dur ? getDurReferenceTraitLabels(dur, 'weather') : []);
    var referenceWeatherIds = resolvedReference ? mapTraitValuesToIds(referenceWeather, 'weather') : (dur ? getDurReferenceTraitIds(dur, 'weather') : []);
    var referenceMarine = resolvedReference ? (resolvedReference.marine_traits || []).slice() : (dur ? getDurReferenceTraitLabels(dur, 'marine') : []);
    var referenceMarineIds = resolvedReference ? mapTraitValuesToIds(referenceMarine, 'marine') : (dur ? getDurReferenceTraitIds(dur, 'marine') : []);
    var referenceFish = resolvedReference ? (resolvedReference.fish_traits || []).slice() : (dur && Array.isArray(dur.fish_traits) ? dur.fish_traits.slice() : []);
    var referenceEvents = resolvedReference ? (resolvedReference.seasonal_events || []).slice() : (dur ? getSeasonEventsForDur(dur) : []);

    weatherEl.textContent = referenceWeather.length ? referenceWeather.join(', ') : '--';
    marineEl.textContent = referenceMarine.length ? referenceMarine.join(', ') : '--';
    fishEl.textContent = referenceFish.length ? referenceFish.join(', ') : '--';
    eventsEl.textContent = referenceEvents.length ? referenceEvents.map(function (e) { return e.name_ar || e.name || e.id; }).join(', ') : '--';

    var manualWeatherOnly = Array.isArray(manualWeatherIds) ? manualWeatherIds.filter(function (id) { return referenceWeatherIds.indexOf(id) < 0; }) : [];
    var manualMarineOnly = Array.isArray(manualMarineIds) ? manualMarineIds.filter(function (id) { return referenceMarineIds.indexOf(id) < 0; }) : [];
    var manualFishSelected = Array.isArray(manualFishTraits) ? manualFishTraits : getSelectedFishActivityTraits();
    var manualFishOnly = manualFishSelected.filter(function (trait) { return referenceFish.indexOf(trait) < 0; });
    var manualSeasonOnly = Array.isArray(manualSeasonIds) ? manualSeasonIds.filter(function (id) { return referenceEvents.every(function (e) { return e.id !== id; }); }) : [];

    manualWeatherEl.textContent = manualWeatherOnly.length ? getTraitLabelsByIds(manualWeatherOnly).join(', ') : '--';
    manualMarineEl.textContent = manualMarineOnly.length ? getTraitLabelsByIds(manualMarineOnly).join(', ') : '--';
    manualFishEl.textContent = manualFishOnly.length ? manualFishOnly.join(', ') : '--';
    manualSeasonEl.textContent = manualSeasonOnly.length ? getSeasonEventsByIds(manualSeasonOnly).map(function (e) { return e.name_ar || e.name || e.id; }).join(', ') : '--';
  }

  function getDururById(id) {
    if (!id) return null;
    return dururCache.find(function (d) { return d.id === id; }) || null;
  }

  function getOrderedActiveDururs() {
    return dururCache.slice().filter(function (d) { return d.is_active !== false; }).sort(function (a, b) {
      return Number(a.dur_number) - Number(b.dur_number);
    });
  }

  function getNextDurur(currentDur) {
    var list = getOrderedActiveDururs();
    if (!currentDur || !list.length) return null;
    var index = list.findIndex(function (d) { return d.id === currentDur.id; });
    if (index < 0) return list[0] || null;
    return list[(index + 1) % list.length] || null;
  }

  function safeParseYmd(value) {
    if (!value) return null;
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatYmd(date) {
    return date ? date.toISOString().split('T')[0] : '--';
  }

  /** One explicit UTC calendar day for NaviDur: local GET, analysis POST, and profile must align. */
  function getCanonicalNavidurAsOfIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function getDurEndDate(dur, entryDate) {
    if (!dur || !entryDate || !dur.gregorian_end_month || !dur.gregorian_end_day) return null;
    var year = entryDate.getFullYear();
    var endDate = new Date(year, dur.gregorian_end_month - 1, dur.gregorian_end_day);
    if (entryDate > endDate) {
      endDate = new Date(year + 1, dur.gregorian_end_month - 1, dur.gregorian_end_day);
    }
    endDate.setHours(0, 0, 0, 0);
    return endDate;
  }

  function getDaysDifference(targetDate) {
    if (!targetDate) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function getNextDurStartDate(currentDur) {
    var nextDur = getNextDurur(currentDur);
    if (!nextDur || !nextDur.gregorian_start_month || !nextDur.gregorian_start_day) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var year = today.getFullYear();
    var nextStart = new Date(year, nextDur.gregorian_start_month - 1, nextDur.gregorian_start_day);
    nextStart.setHours(0, 0, 0, 0);
    if (nextStart <= today) {
      nextStart = new Date(year + 1, nextDur.gregorian_start_month - 1, nextDur.gregorian_start_day);
      nextStart.setHours(0, 0, 0, 0);
    }
    return nextStart;
  }

  function setAnalyticsSpanText(id, value) {
    var el = getEl(id);
    if (!el) return;
    if (value == null || value === '' || value === '--') {
      el.textContent = '';
    } else {
      el.textContent = String(value);
    }
  }

  function applyStationAnalyticsNoData(optionalStatusMsg) {
    ['stAnalyticsDurName', 'stAnalyticsDurDay', 'stAnalyticsDurEntryDate', 'stAnalyticsElapsedDays', 'stAnalyticsDaysRemaining', 'stAnalyticsNextDur', 'stAnalyticsDurStart', 'stAnalyticsDurEnd'].forEach(function (id) {
      setAnalyticsSpanText(id, '');
    });
    var m = getEl('stAnalyticsMsg');
    if (m) {
      m.textContent =
        optionalStatusMsg != null && String(optionalStatusMsg) !== '' ? String(optionalStatusMsg) : STATION_ANALYTICS_NO_DATA_MSG;
    }
  }

  function clearAnalyticsWeatherAndTraits() {
    var ex = getEl('stAnalyticsExpectedTraits');
    if (ex) ex.innerHTML = '';
    var n = getEl('stAnalyticsExpertNotes');
    if (n) n.textContent = '';
    setTextIfEl('stWeatherTemp', '');
    setTextIfEl('stWeatherWindSpeed', '');
    setTextIfEl('stWeatherWindDir', '');
    setTextIfEl('stWeatherWaveHeight', '');
    setTextIfEl('stWeatherSeaTemp', '');
    setTextIfEl('stWeatherLastUpdate', '');
    setTextIfEl('stWeatherStatusNote', '');
    setTextIfEl('stWeatherCurrentSpeed', '');
    setTextIfEl('stAnalyticsTideState', '');
    setTextIfEl('stAnalyticsFishRec', '');
  }

  function setTextIfEl(id, text) {
    var el = getEl(id);
    if (el) el.textContent = text == null ? '' : String(text);
  }

  async function fetchSharedLiveAnalysisBundle(station, opts) {
    opts = opts || {};
    if (!window.NavidurLiveAnalysis || typeof window.NavidurLiveAnalysis.getStationAnalysis !== 'function') {
      throw new Error('shared_live_engine_unavailable');
    }
    var nowIso = opts.datetime || new Date().toISOString();
    return window.NavidurLiveAnalysis.getStationAnalysis(station, { datetime: nowIso });
  }

  function renderAdminAnalysisDto(dto, stationId, expertNotes, modeLabel, durStateOpt) {
    if (!dto) return;
    currentStationAnalysisDto = dto;
    var observedTraits = deriveObservedTraitsFromAnalysis(dto);
    var d = dto.dur || {};
    var hasSeasonal = !!(
      durStateOpt ||
      (!dto.true_final_lookup_failed && String(d.timing_resolution || '') !== 'true_final_error' && String(d.period_name || '').trim() !== '')
    );

    currentWeatherState = {
      station_id: stationId || null,
      temperature_2m: dto.environment && dto.environment.temp_c,
      wind_speed_10m: dto.environment && dto.environment.wind_speed_kmh,
      wind_direction_10m: dto.environment && dto.environment.wind_direction_deg,
      wave_height: dto.environment && dto.environment.wave_height_m,
      current_speed_ms: dto.tide && dto.tide.current_speed_ms,
      checked_at: dto.analysis_timestamp,
      source: 'shared_navidur_engine'
    };

    if (durStateOpt) {
      setTextIfEl('stAnalyticsDurName', durStateOpt.current_dur);
      setTextIfEl('stAnalyticsDurDay', durStateOpt.dur_day != null ? String(durStateOpt.dur_day) : '');
      setTextIfEl('stAnalyticsElapsedDays', durStateOpt.elapsed != null ? String(durStateOpt.elapsed) : '');
      setTextIfEl('stAnalyticsDaysRemaining', durStateOpt.remaining != null ? String(durStateOpt.remaining) : '');
      setTextIfEl('stAnalyticsNextDur', durStateOpt.next_dur);
      setTextIfEl('stAnalyticsDurStart', durStateOpt.start);
      setTextIfEl('stAnalyticsDurEnd', durStateOpt.end);
      setTextIfEl('stAnalyticsDurEntryDate', durStateOpt.as_of_iso || '');
    } else if (hasSeasonal) {
      setTextIfEl('stAnalyticsDurName', d.period_name || '');
      setTextIfEl('stAnalyticsDurDay', d.day_in_period != null ? String(d.day_in_period) : '');
      setTextIfEl('stAnalyticsElapsedDays', d.day_in_period != null ? String(Math.max(0, Number(d.day_in_period) - 1)) : '');
      setTextIfEl('stAnalyticsDaysRemaining', d.days_remaining != null ? String(d.days_remaining) : '');
      setTextIfEl('stAnalyticsNextDur', d.next_period_name || '');
      setTextIfEl('stAnalyticsDurStart', formatAnalyticsMmddToDdmm(d.period_start) || '');
      setTextIfEl('stAnalyticsDurEnd', formatAnalyticsMmddToDdmm(d.period_end) || '');
      setTextIfEl('stAnalyticsDurEntryDate', d.timing_as_of || (dto.analysis_timestamp ? dto.analysis_timestamp.slice(0, 10) : ''));
    } else {
      ['stAnalyticsDurName', 'stAnalyticsDurDay', 'stAnalyticsElapsedDays', 'stAnalyticsDaysRemaining', 'stAnalyticsNextDur', 'stAnalyticsDurStart', 'stAnalyticsDurEnd', 'stAnalyticsDurEntryDate'].forEach(function (id) {
        setAnalyticsSpanText(id, '');
      });
    }

    var expTraits = Array.isArray(d && d.unified_expected_traits) && d.unified_expected_traits.length
      ? uniqueNonEmptyValues(d.unified_expected_traits)
      : uniqueNonEmptyValues([]
        .concat(d && d.reference && d.reference.general_traits || [])
        .concat(d && d.reference && d.reference.weather_traits || [])
        .concat(d && d.reference && d.reference.marine_traits || []));
    var ex = getEl('stAnalyticsExpectedTraits');
    if (ex) {
      ex.innerHTML = expTraits.length
        ? buildTraitChipHtml(expTraits, 'rgba(92,225,255,.2)', 'rgba(92,225,255,.3)', '#5ce1ff')
        : '<span style="color:#9fc1d7">لا توجد سمات مرجعية في هذه القراءة</span>';
    }
    setTextIfEl('stAnalyticsExpertNotes', expertNotes != null && String(expertNotes) !== '' ? String(expertNotes) : (dto.fishing && dto.fishing.advice_text) || '');

    setTextIfEl('stWeatherTemp', dto.environment && dto.environment.temp_c != null ? dto.environment.temp_c + ' °C' : '');
    setTextIfEl('stWeatherWindSpeed', dto.environment && dto.environment.wind_speed_kmh != null ? dto.environment.wind_speed_kmh + ' km/h' : '');
    setTextIfEl('stWeatherWindDir', dto.environment && dto.environment.wind_direction_deg != null ? dto.environment.wind_direction_deg + '°' : '');
    setTextIfEl('stWeatherWaveHeight', dto.environment && dto.environment.wave_height_m != null ? dto.environment.wave_height_m + ' m' : '');
    setTextIfEl('stWeatherSeaTemp', dto.environment && dto.environment.temp_c != null ? dto.environment.temp_c + ' °C' : '');
    setTextIfEl('stWeatherCurrentSpeed', dto.tide && dto.tide.current_speed_ms != null ? String(dto.tide.current_speed_ms) + ' m/s' : '');
    setTextIfEl('stAnalyticsTideState', mapDtoTideStateToArabic(dto.tide && dto.tide.state));
    setTextIfEl(
      'stAnalyticsFishRec',
      dto.fishing
        ? (dto.fishing.is_recommended ? 'موصى به — ثقة ' + String(dto.fishing.confidence_score != null ? dto.fishing.confidence_score : '') + '%' : 'بحذر — ثقة ' + String(dto.fishing.confidence_score != null ? dto.fishing.confidence_score : '') + '%')
        : ''
    );
    setTextIfEl('stWeatherLastUpdate', dto.analysis_timestamp ? new Date(dto.analysis_timestamp).toLocaleString() : '');
    setTextIfEl(
      'stWeatherStatusNote',
      dto.environment && dto.environment.weather_status_ar ? String(dto.environment.weather_status_ar) : ''
    );

    renderValidationExplanation(dto, observedTraits);
    updateAnalyticsDurReferenceDisplay(d, [], [], [], [], []);

    var editedSid = getEl('stId') && getEl('stId').value ? String(getEl('stId').value).trim() : '';
    var analysisStationId = dto.station_id ? String(dto.station_id).trim() : '';
    if (editedSid && analysisStationId === editedSid) {
      var stSynced = stationsCache.find(function (s) {
        return s && String(s.id) === editedSid;
      });
      if (stSynced) {
        void refreshStationLocalDurReadout(
          stSynced,
          d.timing_as_of && String(d.timing_as_of) ? d.timing_as_of : (durStateOpt && durStateOpt.as_of_iso) ? durStateOpt.as_of_iso : getCanonicalNavidurAsOfIso()
        );
      }
    }
    var msgEl = getEl('stAnalyticsMsg');
    if (msgEl) {
      if (!hasSeasonal) {
        msgEl.textContent = STATION_SEASONAL_REF_MSG;
      } else {
        var tideL = mapDtoTideStateToArabic(dto.tide && dto.tide.state);
        var rec = dto.fishing && dto.fishing.is_recommended;
        msgEl.textContent = modeLabel + ' · ' + tideL + ' · ' + (rec ? 'موصى به' : 'بحذر');
      }
    }
    refreshAllStationMarkers();
    renderDururStationPreview();
  }

  function buildValidationObject(stationId, dururProfile) {
    if (!stationValidationCache[stationId]) {
      stationValidationCache[stationId] = [];
    }
    var period = currentAnalyticsPeriod || 'now_auto';
    var existingVal = stationValidationCache[stationId].find(function (v) {
      return v.period === period && v.current_dur_id === dururProfile.current_dur_id;
    });
    var expectedTraits = []
      .concat(dururProfile.weather_traits || [])
      .concat(dururProfile.marine_traits || [])
      .concat(dururProfile.seasonal_traits || [])
      .concat(dururProfile.fish_activity_traits || []);
    expectedTraits = Array.from(new Set(expectedTraits.filter(Boolean)));
    var useCurrentWeather = currentWeatherState && currentAnalyzedStationId === stationId;
    var observedTraits = useCurrentWeather ? getObservedTraitsFromWeather(currentWeatherState) : [];
    var matchingTraits = useCurrentWeather ? observedTraits.filter(function (t) { return expectedTraits.indexOf(t) >= 0; }) : [];
    var percentage = null;
    var status = 'بانتظار الرصد';
    if (useCurrentWeather) {
      if (expectedTraits.length === 0) {
        status = 'لا سمات متوقعة';
      } else {
        percentage = (matchingTraits.length / expectedTraits.length) * 100;
        if (percentage >= 70) status = 'متطابق';
        else if (percentage >= 40) status = 'متوسط';
        else status = 'ضعيف';
      }
    }
    if (existingVal) {
      existingVal.expected_traits = expectedTraits;
      existingVal.observed_traits = observedTraits;
      existingVal.matching_traits = matchingTraits;
      existingVal.validation_score = percentage;
      existingVal.validation_status = status;
      existingVal.last_checked_at = useCurrentWeather ? currentWeatherState.checked_at : existingVal.last_checked_at;
    } else {
      stationValidationCache[stationId].push({
        station_id: stationId,
        period: period,
        current_dur_id: dururProfile.current_dur_id,
        expected_traits: expectedTraits,
        observed_traits: observedTraits,
        matching_traits: matchingTraits,
        validation_score: percentage,
        validation_status: status,
        last_checked_at: useCurrentWeather ? currentWeatherState.checked_at : new Date().toISOString()
      });
    }
    return existingVal;
  }

  function showDururAnalytics() {
    var stationId = getEl('stId').value.trim();
    if (!stationId) {
      alert('يرجى حفظ المحطة أولاً قبل عرض التحليلات');
      return;
    }
    currentAnalyzedStationId = stationId;
    void renderStationAnalytics();
  }

  function clearAdminAnalysisDisplay(message) {
    currentStationAnalysisDto = null;
    if (String(message) === 'جاهز') {
      applyStationAnalyticsNoData();
      if (getEl('stAnalyticsMsg')) {
        getEl('stAnalyticsMsg').textContent = 'جاهز';
      }
    } else {
      applyStationAnalyticsNoData(message != null && String(message) !== '' ? String(message) : null);
    }
    clearAnalyticsWeatherAndTraits();
    renderValidationExplanation(null, []);
    setTextIfEl('stAnalyticsScore', '');
    setTextIfEl('stAnalyticsStatus', '');
    void clearReadOnlyDurProfile();
    refreshAllStationMarkers();
    renderDururStationPreview();
  }

  function renderTransientStationPreview(lat, lon) {
    currentTransientPreviewPoint = { lat: lat, lon: lon };
    currentAnalysisRequestToken += 1;
    currentStationAnalysisDto = null;
    if (getEl('stAnalyticsMsg')) {
      getEl('stAnalyticsMsg').textContent = 'معاينة إحداثيات — بلا بيانات مرجعية حتى تُحفظ محطة';
    }
    applyStationAnalyticsNoData();
    clearAnalyticsWeatherAndTraits();
  }

  function onAnalyticsPeriodChange() {
    var sel = getEl('stAnalyticsPeriod');
    currentAnalyticsPeriod = sel && sel.value ? String(sel.value) : 'now_auto';
    updateStAnalyticsAsOfRowVisibility();
    void renderStationAnalytics();
  }

  async function renderStationAnalytics() {
    console.log('Loader executed:', 'renderStationAnalytics');
    currentTransientPreviewPoint = null;
    currentAnalysisRequestToken += 1;
    var requestToken = currentAnalysisRequestToken;
    var stationId =
      currentAnalyzedStationId ||
      (getEl('stId') ? getEl('stId').value : '') ||
      currentStationId ||
      '';
    currentStationId = stationId;
    currentAnalyzedStationId = stationId;
    var period = currentAnalyticsPeriod || 'now_auto';

    if (!stationId) {
      clearAdminAnalysisDisplay('لا توجد محطة محددة');
      return;
    }
    var station = stationsCache.find(function (s) {
      return s && s.id === stationId;
    });
    if (!station) {
      clearAdminAnalysisDisplay('لا توجد بيانات المحطة');
      return;
    }

    if (getEl('stAnalyticsMsg')) {
      getEl('stAnalyticsMsg').textContent = 'جاري التحميل...';
    }
    var st = getStationForLocalDurReadout(station);
    var profile = getResolvedDururProfileForStation(station);
    station.durur_profile = profile;
    var asOfDate = resolveAnalyticsAsOfDate();
    var analysisIso = asOfDate.toISOString();

    var durState = null;
    try {
      durState = await getDurState(station, asOfDate);
    } catch (_e) {
      durState = null;
    }
    if (requestToken !== currentAnalysisRequestToken) return;

    currentStationAnalysisDto = null;
    try {
      var dto = await fetchSharedLiveAnalysisBundle(station, { datetime: analysisIso });
      if (requestToken !== currentAnalysisRequestToken) return;
      renderAdminAnalysisDto(dto, stationId, profile.expert_notes || profile.expert_summary || '', 'تم تحديث التحليل', null);
      if (['1m', '3m', '6m', '1y'].indexOf(period) >= 0) {
        try {
          var historyRecords = await getAnalyticsHistory(stationId, period);
          var historyCount = Array.isArray(historyRecords) ? historyRecords.length : 0;
          var hm = getEl('stAnalyticsMsg');
          if (hm) hm.textContent = (hm.textContent || '') + ' | سجل ' + period + ': ' + historyCount + ' قراءة';
        } catch (_h) { /* keep main msg */ }
      }
      void refreshDururFilePanelFromTrueFinal(st);
      buildValidationObject(stationId, profile);
    } catch (_liveErr) {
      if (requestToken !== currentAnalysisRequestToken) return;
      if (durState) {
        var partial = {
          station_id: stationId,
          analysis_timestamp: analysisIso,
          true_final_reference_active: true,
          true_final_lookup_failed: false,
          dur: {
            period_name: durState.current_dur,
            day_in_period: durState.dur_day,
            days_remaining: durState.remaining,
            next_period_name: durState.next_dur,
            period_start: '',
            period_end: '',
            timing_as_of: durState.as_of_iso,
            timing_resolution: 'true_final_station_reference',
            reference: { general_traits: [], weather_traits: [], marine_traits: [] }
          },
          environment: { temp_c: null, wind_speed_kmh: null, wind_direction_deg: null, wave_height_m: null },
          tide: { state: 'UNKNOWN', current_speed_ms: null },
          fishing: { is_recommended: false, advice_text: '', species_activity: [], confidence_score: 0 }
        };
        renderAdminAnalysisDto(partial, stationId, profile.expert_notes || '', 'تعذر الطقس الحي — عرض الموسم فقط', durState);
        if (getEl('stAnalyticsMsg')) {
          getEl('stAnalyticsMsg').textContent = 'تعذر طلب التحليل المباشر — عُرض الموسم من المرجع فقط';
        }
      } else {
        clearAdminAnalysisDisplay(STATION_SEASONAL_REF_MSG);
      }
      void refreshDururFilePanelFromTrueFinal(st);
    }
    refreshAllStationMarkers();
  }

  function onAnalyticsRefresh() {
    var sid = getEl('stId') && getEl('stId').value ? String(getEl('stId').value).trim() : '';
    if (!sid) {
      if (getEl('stAnalyticsMsg')) {
        getEl('stAnalyticsMsg').textContent = 'لا توجد محطة محددة';
      }
      return;
    }
    currentAnalyzedStationId = sid;
    currentStationId = sid;
    currentAnalyticsPeriod = 'now_auto';
    var pSel = getEl('stAnalyticsPeriod');
    if (pSel) pSel.value = 'now_auto';
    var dInp = getEl('stAnalyticsAsOfDate');
    if (dInp) dInp.value = getCanonicalNavidurAsOfIso();
    updateStAnalyticsAsOfRowVisibility();
    clearTrueFinalReferenceCache();
    void renderStationAnalytics();
  }

  // ── Region helpers ────────────────────────────────────────────────────────

  function getRegionsForCountry(country) {
    if (!country) return [];
    var predefined = (COASTAL_REGIONS[country] || []).slice();
    var seen = new Set(predefined);
    stationsCache.forEach(function (st) {
      if (st.country !== country) return;
      var r = st.region || '';
      if (r && !seen.has(r)) { seen.add(r); predefined.push(r); }
    });
    return predefined;
  }

  function rebuildRegionSelect(country, selectedRegion) {
    var sel = getEl('stRegion');
    if (!sel) return;
    var regions = getRegionsForCountry(country);
    sel.innerHTML = '<option value="">اختر المنطقة...</option>';
    regions.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      sel.appendChild(opt);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add_new__';
    addOpt.textContent = '+ إضافة منطقة جديدة...';
    sel.appendChild(addOpt);
    if (selectedRegion) {
      sel.value = selectedRegion;
      // If not matched (custom region from DB), add it
      if (sel.value !== selectedRegion) {
        var customOpt = document.createElement('option');
        customOpt.value = selectedRegion;
        customOpt.textContent = selectedRegion;
        sel.insertBefore(customOpt, sel.querySelector('option[value="__add_new__"]'));
        sel.value = selectedRegion;
      }
    }
  }

  function suggestAutoNumber(country, region) {
    if (!region) return '';
    var existing = stationsCache.filter(function (st) {
      return (!country || st.country === country) && st.region === region;
    });
    return region + ' ' + String(existing.length + 1).padStart(2, '0');
  }

  async function loadStations() {
    var res = await apiFetch(STATIONS_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('stations_load_failed');
    var data = await res.json();
    var rawFromApi = Array.isArray(data.stations) ? data.stations : [];
    var storedRefStrictTrueAtSource = rawFromApi.filter(function (r) {
      return r && r.is_reference_station === true;
    }).length;
    stationsCache = rawFromApi.map(normalizeAdminStationRecord);
    dururMapFilters.stationType = getAdminReferenceOnlyEnabled() ? 'reference_only' : 'all';
    var visibleStations = getVisibleAdminStations();
    var invalidReferenceStations = getInvalidReferenceStations(stationsCache);

    // Gulf warning bar
    var gulfCount = stationsCache.filter(function (s) { return (s.region || '').toLowerCase() === 'gulf'; }).length;
    var warnEl = getEl('gulfWarningBar');
    if (warnEl) {
      if (gulfCount > 0) {
        warnEl.style.display = '';
        warnEl.textContent = '\u26a0 ' + gulfCount + ' \u0645\u062d\u0637\u0629 \u0644\u0627 \u062a\u0632\u0627\u0644 \u062a\u0633\u062a\u062e\u062f\u0645 region = gulf \u2014 \u0627\u0646\u0642\u0631 \u062a\u0639\u062f\u064a\u0644 \u0644\u062a\u0635\u062d\u064a\u062d \u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0641\u0639\u0644\u064a\u0629.';
      } else {
        warnEl.style.display = 'none';
      }
    }

    var editingId = _stationEditMode ? (getEl('stId').value.trim() || null) : null;
    var refInTable = visibleStations.filter(isReferenceCalibrationStation).length;
    if (isAdminMode()) {
      console.info('[admin][stations-load]', {
        totalStationRecordsFromSource: rawFromApi.length,
        storedReferenceStationsStrictTrueAtSource: storedRefStrictTrueAtSource,
        totalReferenceStationsLoadedIntoCache: getReferenceStationCount(stationsCache),
        totalStationsLoaded: stationsCache.length,
        totalReferenceStationsShownInTable: refInTable,
        drawableReferenceStationsInCurrentView: countDrawableReferenceStations(visibleStations),
        totalFilteredStationsShown: visibleStations.length,
        referenceOnly: getAdminReferenceOnlyEnabled(),
        referenceSamples: getReferenceStationSamples(stationsCache, 3)
      });
    }
    if (invalidReferenceStations.length) {
      console.warn('[admin][stations-invalid-reference-coords]', invalidReferenceStations);
    }

    renderAdminStationsTable(visibleStations);
    renderReferenceStationsTable();
    refreshAllStationMarkers(editingId, visibleStations);
    updateDururStationInfoPanel();
    updateAstroPreviewStationOptions();
  }

  function updateAstroPreviewStationOptions() {
    var sel = getEl('astroPreviewStationSelect');
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML = '<option value="">—</option>';
    stationsCache.forEach(function (s) {
      if (!s || !s.id) return;
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = (s.name || s.id) + ' (' + (s.latitude_band_key || '\u2014') + ')';
      sel.appendChild(opt);
    });
    if (keep) sel.value = keep;
  }

  function astroYnAr(v) {
    return v === true || v === 'true' || v === 1 ? 'نعم' : 'لا';
  }

  function astroFmtNum(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    return Number.isFinite(n) ? String(n) : escapeHtml(v);
  }

  function astroWorkbookModeAr(code) {
    var m = {
      exact_name: 'تطابق الاسم',
      manual: 'يدوي',
      nearest_city: 'أقرب مدينة',
      same_region: 'منطقة / تجميعة'
    };
    return m[code] || escapeHtml(code || '—');
  }

  function astroAssignmentAr(code) {
    var m = {
      auto_assigned: 'معيّن آليًا',
      manual_confirmed: 'معتمد يدويًا',
      needs_review: 'يحتاج مراجعة'
    };
    return m[code] || escapeHtml(code || '—');
  }

  function renderAstroMonitoringCards(payload) {
    var j = payload || {};
    if (!j.ok) {
      return '<div class="astro-card"><p style="margin:0;color:#ffb3b3">تعذّر تحميل حالة الطبقة.</p></div>';
    }

    var wb = j.workbook_import_monitoring || {};
    var map = j.workbook_station_mapping_stats || {};
    var seq = j.dur_sequence_import_summary || {};
    var star = j.star_events_import_summary || {};
    var seqPartial = seq.partial === true;
    var starPartial = star.partial === true;
    var wbPartial = wb.partial === true;

    var srcLabel = wb.source_label;
    if (!srcLabel || srcLabel === 'workbook_import') srcLabel = 'وارد من ملف الربط (بيانات مساعدة)';
    var summaryHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title"><span class="astro-badge">' + escapeHtml(srcLabel) + '</span> ملخص الربط والدليل (لا يضبط التوقيت)</h5>' +
      '<div class="astro-grid">' +
      '<div class="astro-stat"><span class="astro-stat-label">المدن في الدليل</span><span class="astro-stat-value">' + astroFmtNum(wb.imported_cities) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">سنوات في الدليل</span><span class="astro-stat-value">' + astroFmtNum(wb.imported_years) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">نوافذ الدرور (دليل)</span><span class="astro-stat-value">' + astroFmtNum(wb.imported_dur_windows != null ? wb.imported_dur_windows : wb.workbook_windows_row_count) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">حجم الدليل</span><span class="astro-stat-value">' + astroFmtNum(map.workbook_city_catalog_size) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">محطات مربوطة</span><span class="astro-stat-value">' + astroFmtNum(map.mapped_stations) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">غير مربوطة</span><span class="astro-stat-value">' + astroFmtNum(map.unmapped_stations) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">معتمد يدويًا</span><span class="astro-stat-value">' + astroFmtNum(map.manual_confirmed) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">تحت المراجعة</span><span class="astro-stat-value">' + astroFmtNum(map.needs_review) + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">مفتاح غير صالح</span><span class="astro-stat-value">' + astroFmtNum(map.invalid_workbook_key) + '</span></div>' +
      '</div></div>';

    var metaHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">بيانات الاستيراد والمصدر</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">اسم الملف</span><span class="astro-kv-v">' +
      escapeHtml((wb.source_file_path || '').split('/').pop() || seq.source_file_name || star.source_file_name || '—') +
      '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">المسار</span><span class="astro-kv-v">' + escapeHtml(wb.source_file_path || seq.source_file_path || star.source_file_path || '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">تاريخ الاستيراد</span><span class="astro-kv-v">' + escapeHtml(wb.imported_at || seq.imported_at || star.imported_at || '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">إصدار الاستيراد</span><span class="astro-kv-v">' + escapeHtml(wb.import_version || seq.import_version || star.import_version || '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">عدد التحذيرات</span><span class="astro-kv-v">' +
      astroFmtNum(
        wb.warnings_count != null
          ? wb.warnings_count
          : Array.isArray(seq.warnings)
            ? seq.warnings.length
            : Array.isArray(star.warnings)
              ? star.warnings.length
              : null
      ) +
      '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">استيراد جزئي</span><span class="astro-kv-v">' + astroYnAr(wbPartial || seqPartial || starPartial) + '</span></div>' +
      '</div>';

    var techHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">حالة الطبقة التقنية</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">نسخة خريطة التسلسل</span><span class="astro-kv-v">' + astroFmtNum(j.sequence_map_version) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">نسخة أحداث النجوم</span><span class="astro-kv-v">' + astroFmtNum(j.star_events_version) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">نوافذ الدور ناقصة</span><span class="astro-kv-v">' + astroYnAr(!!j.dur_windows_incomplete) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">سبب النقص</span><span class="astro-kv-v">' + escapeHtml(j.dur_windows_reason || '—') + '</span></div>' +
      '</div>';

    var seqHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">استيراد تسلسل الدور</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">صفوف</span><span class="astro-kv-v">' + astroFmtNum(seq.row_count) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">أوراق الاستيراد</span><span class="astro-kv-v">' + escapeHtml(Array.isArray(seq.source_sheet_names) ? seq.source_sheet_names.join('، ') : '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">جزئي</span><span class="astro-kv-v">' + astroYnAr(seqPartial) + '</span></div>' +
      '</div>';

    var starHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">استيراد أحداث النجوم</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">صفوف</span><span class="astro-kv-v">' + astroFmtNum(star.row_count) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">صفوف متخطاة</span><span class="astro-kv-v">' + astroFmtNum(star.skipped_rows) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">أوراق الاستيراد</span><span class="astro-kv-v">' + escapeHtml(Array.isArray(star.source_sheet_names) ? star.source_sheet_names.join('، ') : '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">جزئي</span><span class="astro-kv-v">' + astroYnAr(starPartial) + '</span></div>' +
      '</div>';

    var anchors = j.anchors || {};
    var bands = Array.isArray(anchors.bands_tracked_from_star_events) ? anchors.bands_tracked_from_star_events : [];
    var anchorsHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">مراسي حزام العرض (مرجع قديم)</h5>' +
      '<p style="margin:0 0 8px;font-size:.78rem;color:#8ea4ba">عدد الحزم المعروضة: ' +
      astroFmtNum(bands.length) +
      '. المعروف من السجل: ' +
      astroFmtNum((anchors.known_keys_from_registry || []).length) +
      '</p>' +
      '</div>';

    return summaryHtml + metaHtml + techHtml + seqHtml + starHtml + anchorsHtml;
  }

  function renderWorkbookPreviewCards(apiJson, stationRow) {
    var j = apiJson || {};
    var st = stationRow || {};
    var srcTag =
      !j.source || j.source === 'workbook_import'
        ? 'دليل المدن (للمقارنة — ليس التوقيت التشغيلي)'
        : escapeHtml(String(j.source));
    var src =
      '<div class="astro-card">' +
      '<span class="astro-badge">' +
      srcTag +
      '</span> <span style="font-size:.78rem;color:#8ea4ba">للمسؤولين فقط؛ لا تُستبدل المرجع النهائي لكل محطة</span>' +
      '</div>';

    if (j.state === 'unmapped') {
      return (
        src +
        '<div class="astro-card"><p style="margin:0;color:#ffb3b3">' +
        escapeHtml(j.message_ar || 'المحطة غير مربوطة بمفتاح مدينة في الدليل.') +
        '</p></div>'
      );
    }
    if (j.state === 'missing_year_source' || j.state === 'no_windows_for_city') {
      return (
        src +
        '<div class="astro-card"><p style="margin:0;color:#ffb3b3">' +
        escapeHtml(j.message_ar || 'لا توجد نوافذ لهذه المدينة في بيانات الدليل المستوردة.') +
        '</p><div class="astro-kv-row"><span class="astro-kv-k">مفتاح المدينة في الدليل</span><span class="astro-kv-v">' +
        escapeHtml(j.workbook_city_name || '—') +
        '</span></div></div>'
      );
    }

    if (j.state === 'date_outside_workbook_windows' || j.state === 'no_windows_for_workbook_cycle' || j.state === 'bad_iso_date') {
      return (
        src +
        '<div class="astro-card">' +
        '<h5 class="astro-card-title">معاينة من الدليل (للمقارنة فقط)</h5>' +
        '<div class="astro-kv-row"><span class="astro-kv-k">مفتاح المدينة في الدليل</span><span class="astro-kv-v">' +
        escapeHtml(j.workbook_city_name || '—') +
        '</span></div>' +
        '<div class="astro-kv-row"><span class="astro-kv-k">تاريخ الاستعلام</span><span class="astro-kv-v">' +
        escapeHtml(j.gregorian_preview_date || j.iso_date || '—') +
        '</span></div>' +
        '<div class="astro-kv-row"><span class="astro-kv-k">سنة الدورة في الدليل</span><span class="astro-kv-v">' +
        astroFmtNum(j.workbook_cycle_year) +
        '</span></div>' +
        '<p style="margin:10px 0 0;color:#ffb3b3">' +
        escapeHtml(j.message_ar || '—') +
        '</p></div>'
      );
    }

    var cur = j.current_dur || {};
    var nx = j.next_dur || {};
    var wbCity = escapeHtml(j.workbook_city_name || '—');
    var modeAr = astroWorkbookModeAr(st.workbook_match_mode);
    var statAr = astroAssignmentAr(st.workbook_assignment_status);

    var gregDate = escapeHtml(j.gregorian_preview_date || j.iso_date || '—');
    var gYear = j.gregorian_year_of_preview_date != null ? astroFmtNum(j.gregorian_year_of_preview_date) : '—';
    var cycleY = j.workbook_cycle_year != null ? astroFmtNum(j.workbook_cycle_year) : astroFmtNum(j.year);
    var diffNote =
      j.cycle_year_differs_from_gregorian_year === true
        ? '<div class="astro-kv-row"><span class="astro-kv-k">ملاحظة</span><span class="astro-kv-v">سنة التاريخ (' +
          gYear +
          ') تختلف عن سنة الدورة في الدليل (' +
          cycleY +
          ')</span></div>'
        : '';

    var durHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">معاينة من الدليل (للمقارنة — ليس التوقيت التشغيلي)</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">مفتاح المدينة في الدليل</span><span class="astro-kv-v">' + wbCity + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">وضع المطابقة في الدليل</span><span class="astro-kv-v">' + modeAr + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">حالة الربط</span><span class="astro-kv-v">' + statAr + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">تاريخ الاستعلام</span><span class="astro-kv-v">' + gregDate + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">سنة الدورة في الدليل</span><span class="astro-kv-v">' + cycleY + '</span></div>' +
      diffNote +
      '<div class="astro-kv-row"><span class="astro-kv-k">وضع البحث في الدليل</span><span class="astro-kv-v">' +
      escapeHtml(j.lookup_mode === 'restricted_workbook_cycle_year' ? 'مقيّد بدورة محددة' : 'بحث بالتاريخ عبر دورات الدليل') +
      '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">مصدر السطور</span><span class="astro-kv-v">دليل المدن المستورد (غير المرجع النهائي)</span></div>' +
      '</div>';

    var curHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">الدرة الحالية</h5>' +
      '<div class="astro-grid">' +
      '<div class="astro-stat"><span class="astro-stat-label">اسم الدرة</span><span class="astro-stat-value">' + escapeHtml(cur.dur_name_ar || '—') + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">بداية الدر</span><span class="astro-stat-value">' + escapeHtml(cur.dur_start || '—') + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">نهاية الدر</span><span class="astro-stat-value">' + escapeHtml(cur.dur_end || '—') + '</span></div>' +
      '<div class="astro-stat"><span class="astro-stat-label">اليوم داخل الدر</span><span class="astro-stat-value">' + astroFmtNum(cur.day_in_dur) + '</span></div>' +
      '</div></div>';

    var nextHtml =
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">الدرة التالية</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">الاسم</span><span class="astro-kv-v">' + escapeHtml(nx.dur_name_ar || '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">البداية</span><span class="astro-kv-v">' + escapeHtml(nx.dur_start || '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">النهاية</span><span class="astro-kv-v">' + escapeHtml(nx.dur_end || '—') + '</span></div>' +
      '</div>';

    if (!cur || !cur.dur_name_ar) {
      return (
        src +
        durHtml +
        '<div class="astro-card"><p style="margin:0;color:#ffb3b3">لا يوجد در يطابق هذا التاريخ ضمن استجابة المعاينة.</p></div>'
      );
    }

    return src + durHtml + curHtml + nextHtml;
  }

  function renderBandPreviewCards(apiJson) {
    var j = apiJson || {};
    var band = escapeHtml(j.latitude_band_key || '—');
    var wins = Array.isArray(j.windows_preview) ? j.windows_preview : [];
    var der = j.derived_current_state || {};
    var rows = wins
      .slice(0, 12)
      .map(function (w) {
        return (
          '<div class="astro-kv-row"><span class="astro-kv-k">' +
          escapeHtml(w.dur_name_ar || w.dur_id || '—') +
          '</span><span class="astro-kv-v">' +
          escapeHtml((w.start_date || '') + ' ← ' + (w.end_date || '')) +
          '</span></div>'
        );
      })
      .join('');
    var more = wins.length > 12 ? '<p style="margin:8px 0 0;font-size:.76rem;color:#8ea4ba">عرض 12 من أصل ' + wins.length + '</p>' : '';

    return (
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">معاينة حزام العرض (طريقة قديمة)</h5>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">حزام العرض</span><span class="astro-kv-v">' + band + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">السنة</span><span class="astro-kv-v">' + astroFmtNum(j.year) + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">اليوم</span><span class="astro-kv-v">' + escapeHtml(j.iso_date || '—') + '</span></div>' +
      '<div class="astro-kv-row"><span class="astro-kv-k">ناقص / غير جاهز</span><span class="astro-kv-v">' + astroYnAr(!!der.incomplete) + '</span></div>' +
      '</div>' +
      '<div class="astro-card">' +
      '<h5 class="astro-card-title">قائمة النوافذ (مختصرة)</h5>' +
      (rows || '<p class="astro-placeholder">لا توجد نوافذ متولدة لهذا الحزام.</p>') +
      more +
      '</div>'
    );
  }

  async function refreshAstroDurStatus() {
    console.log('Loader executed:', 'refreshAstroDurStatus');
    var root = getEl('astroDurMonitoringRoot');
    var raw = getEl('astroDurStatusRaw');
    if (!root) {
      console.warn('Missing element:', 'astroDurMonitoringRoot');
      return;
    }
    if (!isAdminMode()) {
      root.innerHTML = '<div class="astro-card"><p style="margin:0;color:#ffb3b3">تتطلب صلاحية إدارة.</p></div>';
      return;
    }
    root.innerHTML = '<p class="astro-placeholder">جاري التحميل...</p>';
    try {
      var res = await apiFetch(ASTRO_DUR_ENDPOINT + '&path=status', { method: 'GET' });
      if (!res.ok) throw new Error('http_' + res.status);
      var j = await res.json();
      root.innerHTML = renderAstroMonitoringCards(j);
      if (raw) raw.textContent = JSON.stringify(j, null, 2);
    } catch (e) {
      var astroErr0 = clientErrorForHttp(e);
      root.innerHTML =
        '<div class="astro-card"><p style="margin:0;color:#ffb3b3">خطأ: ' +
        escapeHtml(astroErr0) +
        '</p></div>';
      if (raw) raw.textContent = '';
    }
  }

  async function runAstroPreview() {
    var root = getEl('astroDurPreviewRoot');
    var raw = getEl('astroDurPreviewRaw');
    if (!root) return;
    if (!isAdminMode()) {
      root.innerHTML = '<div class="astro-card"><p style="margin:0;color:#ffb3b3">تتطلب صلاحية إدارة.</p></div>';
      return;
    }
    root.innerHTML = '<p class="astro-placeholder">جاري التحميل...</p>';
    var bandEl = getEl('astroPreviewBandInput');
    var yearEl = getEl('astroPreviewYearInput');
    var dateEl = getEl('astroPreviewDateInput');
    var stEl = getEl('astroPreviewStationSelect');
    var st = stEl && stEl.value ? stEl.value.trim() : '';
    var band = bandEl && bandEl.value ? bandEl.value.trim() : '';
    var year = yearEl && yearEl.value ? yearEl.value : '';
    var isoDate = dateEl && dateEl.value ? String(dateEl.value).trim() : '';

    try {
      if (st) {
        var qWb = 'path=workbook-preview&station_id=' + encodeURIComponent(st);
        if (isoDate) qWb += '&date=' + encodeURIComponent(isoDate);
        var restrictEl = getEl('astroPreviewRestrictWorkbookCycle');
        if (restrictEl && restrictEl.checked && year) {
          qWb += '&workbook_cycle_year=' + encodeURIComponent(year);
        }
        var resWb = await apiFetch(ASTRO_DUR_ENDPOINT + '&' + qWb, { method: 'GET' });
        if (!resWb.ok) throw new Error('http_' + resWb.status);
        var jWb = await resWb.json();
        var stRow =
          stationsCache.find(function (s) {
            return s && String(s.id) === String(st);
          }) || {};
        root.innerHTML = renderWorkbookPreviewCards(jWb, stRow);
        if (raw) raw.textContent = JSON.stringify(jWb, null, 2);
        return;
      }

      var q = 'path=preview';
      if (band) q += '&band=' + encodeURIComponent(band);
      if (year) q += '&year=' + encodeURIComponent(year);
      if (isoDate) q += '&date=' + encodeURIComponent(isoDate);
      var res = await apiFetch(ASTRO_DUR_ENDPOINT + '&' + q, { method: 'GET' });
      if (!res.ok) throw new Error('http_' + res.status);
      var j = await res.json();
      root.innerHTML = renderBandPreviewCards(j);
      if (raw) raw.textContent = JSON.stringify(j, null, 2);
    } catch (e) {
      var astroErr1 = clientErrorForHttp(e);
      root.innerHTML =
        '<div class="astro-card"><p style="margin:0;color:#ffb3b3">خطأ: ' +
        escapeHtml(astroErr1) +
        '</p></div>';
      if (raw) raw.textContent = '';
    }
  }

  function nfcStringAdmin(value) {
    var raw = String(value == null ? '' : value).trim();
    try {
      return raw.normalize ? raw.normalize('NFC') : raw;
    } catch (_e) {
      return raw;
    }
  }

  /** True-final seasonal day math (data/true_final_station_reference.json) — same rules as server lookup. */
  function tfrParseDayMonthDdMm(s) {
    var t = String(s == null ? '' : s).trim();
    var m = t.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    var day = Number(m[1]);
    var mo = Number(m[2]);
    if (!day || !mo || mo > 12 || day > 31) return null;
    return { d: day, m: mo };
  }

  function tfrIsAsOfInWindowKeys(sKey, eKey, aKey) {
    if (sKey == null || eKey == null || aKey == null) return false;
    if (sKey <= eKey) {
      return aKey >= sKey && aKey <= eKey;
    }
    return aKey >= sKey || aKey <= eKey;
  }

  function tfrSyntheticTimelineMs(pStart, pEnd, asM, asD) {
    if (!pStart || !pEnd) return null;
    var sKey = pStart.m * 100 + pStart.d;
    var eKey = pEnd.m * 100 + pEnd.d;
    var aKey = asM * 100 + asD;
    var Y0 = 2000;
    var Y1 = 2001;
    var startMs = Date.UTC(Y0, pStart.m - 1, pStart.d, 0, 0, 0, 0);
    var wrap = sKey > eKey;
    if (!wrap) {
      var endMs = Date.UTC(Y0, pEnd.m - 1, pEnd.d, 0, 0, 0, 0);
      var asMs0 = Date.UTC(Y0, asM - 1, asD, 0, 0, 0, 0);
      if (aKey < sKey || aKey > eKey) return null;
      return { startMs: startMs, endMs: endMs, asMs: asMs0 };
    }
    var endMsW = Date.UTC(Y1, pEnd.m - 1, pEnd.d, 0, 0, 0, 0);
    if (!tfrIsAsOfInWindowKeys(sKey, eKey, aKey)) return null;
    var asMsW;
    if (aKey >= sKey) {
      asMsW = Date.UTC(Y0, asM - 1, asD, 0, 0, 0, 0);
    } else {
      asMsW = Date.UTC(Y1, asM - 1, asD, 0, 0, 0, 0);
    }
    return { startMs: startMs, endMs: endMsW, asMs: asMsW };
  }

  function trueFinalSeasonalSnapshotFromRow(row, asOfIso) {
    if (!row || !asOfIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(asOfIso).trim())) {
      return { ok: false };
    }
    var pStart = tfrParseDayMonthDdMm(row.current_dur_start_md);
    var pEnd = tfrParseDayMonthDdMm(row.current_dur_end_md);
    if (!pStart || !pEnd) {
      return { ok: false };
    }
    var asDate = new Date(String(asOfIso).trim() + 'T12:00:00.000Z');
    if (Number.isNaN(asDate.getTime())) {
      return { ok: false };
    }
    var asM = asDate.getUTCMonth() + 1;
    var asD = asDate.getUTCDate();
    var aKey = asM * 100 + asD;
    var sKey = pStart.m * 100 + pStart.d;
    var eKey = pEnd.m * 100 + pEnd.d;
    if (!tfrIsAsOfInWindowKeys(sKey, eKey, aKey)) {
      return { ok: false, code: 'AS_OF_OUTSIDE_SHEET_WINDOW' };
    }
    var tl = tfrSyntheticTimelineMs(pStart, pEnd, asM, asD);
    if (!tl) {
      return { ok: false };
    }
    var totalDaysInclusive = Math.floor((tl.endMs - tl.startMs) / 86400000) + 1;
    var dayInDur = Math.floor((tl.asMs - tl.startMs) / 86400000) + 1;
    var daysRem = totalDaysInclusive - dayInDur;
    if (dayInDur < 1) {
      return { ok: false };
    }
    if (daysRem < 0) daysRem = 0;
    return {
      ok: true,
      current_dur_name_ar: row.current_dur_name_ar,
      next_dur_name_ar: String(row.next_dur_name_ar != null ? row.next_dur_name_ar : '').trim(),
      day_in_dur: dayInDur,
      days_remaining_in_dur: daysRem
    };
  }

  function formatAnalyticsMmddToDdmm(mmdd) {
    var t = String(mmdd == null ? '' : mmdd).trim();
    var m = t.match(/^(\d{2})-(\d{2})$/);
    if (!m) return t || '';
    return m[2] + '-' + m[1];
  }

  function resolveAnalyticsAsOfDate() {
    var p = currentAnalyticsPeriod || 'now_auto';
    if (p === 'custom') {
      var inp = getEl('stAnalyticsAsOfDate');
      var v = inp && inp.value ? String(inp.value).trim() : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return new Date(v + 'T12:00:00.000Z');
      }
    }
    var iso = getCanonicalNavidurAsOfIso();
    return new Date(iso + 'T12:00:00.000Z');
  }

  function updateStAnalyticsAsOfRowVisibility() {
    var p = currentAnalyticsPeriod || 'now_auto';
    var row = getEl('stAnalyticsAsOfRow');
    if (row) row.style.display = p === 'custom' ? 'inline-flex' : 'none';
  }

  /**
   * Dur adapter: true-final JSON only (month-day), matched by station id or Arabic name.
   * @param {object} station
   * @param {Date|number|string} asOfDate
   */
  async function getDurState(station, asOfDate) {
    if (!station) return null;
    var d = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
    if (Number.isNaN(d.getTime())) d = new Date();
    var y = d.getUTCFullYear();
    var mo = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    var asOfIso = y + '-' + String(mo).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var doc = await loadTrueFinalStationReferenceDoc();
    if (!doc) return null;
    var st = getStationForLocalDurReadout(station);
    var row = findTrueFinalRowForStation(doc, st);
    if (!row) return null;
    var tf = trueFinalSeasonalSnapshotFromRow(row, asOfIso);
    if (!tf || !tf.ok) return null;
    return {
      current_dur: String(tf.current_dur_name_ar != null ? tf.current_dur_name_ar : '').trim(),
      dur_day: tf.day_in_dur,
      elapsed: Math.max(0, (Number(tf.day_in_dur) || 1) - 1),
      remaining: tf.days_remaining_in_dur,
      next_dur: String(tf.next_dur_name_ar != null ? tf.next_dur_name_ar : '').trim(),
      start: String(row.current_dur_start_md != null ? row.current_dur_start_md : '').trim(),
      end: String(row.current_dur_end_md != null ? row.current_dur_end_md : '').trim(),
      as_of_iso: asOfIso
    };
  }

  function loadTrueFinalStationReferenceDoc() {
    if (_trueFinalRefDocCache) return Promise.resolve(_trueFinalRefDocCache);
    if (_trueFinalRefLoadPromise) return _trueFinalRefLoadPromise;
    var url =
      adminAuthenticated && authToken
        ? '/api?route=admin&path=true-final-reference'
        : '/data/true_final_station_reference.json';
    _trueFinalRefLoadPromise = apiFetch(url, { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('http_' + res.status);
        return res.json();
      })
      .then(function (j) {
        var doc = j && j.document && typeof j.document === 'object' ? j.document : j;
        _trueFinalRefDocCache = doc && typeof doc === 'object' ? doc : null;
        return _trueFinalRefDocCache;
      })
      .finally(function () {
        _trueFinalRefLoadPromise = null;
      });
    return _trueFinalRefLoadPromise;
  }

  function findTrueFinalRowByStationNameAr(doc, stationNameAr) {
    var want = nfcStringAdmin(stationNameAr);
    var list = doc && Array.isArray(doc.stations) ? doc.stations : [];
    for (var i = 0; i < list.length; i += 1) {
      if (nfcStringAdmin(list[i].station_name_ar) === want) return list[i];
    }
    return null;
  }

  function ddMmToIsoDateWithYear(ddmm, year) {
    var m = String(ddmm || '').match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return '';
    var day = Number(m[1]);
    var month = Number(m[2]);
    if (!day || !month || month > 12 || day > 31) return '';
    if (!Number.isFinite(year) || year < 1600 || year > 2500) return '';
    var iso = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var t = new Date(iso + 'T12:00:00.000Z');
    if (Number.isNaN(t.getTime())) return '';
    if (t.getUTCFullYear() !== year || t.getUTCMonth() + 1 !== month || t.getUTCDate() !== day) return '';
    return iso;
  }

  async function fetchWorkbookSuhailAnchorIntoForm() {
    if (!isAdminMode()) return;
    var sid = getEl('stId') && getEl('stId').value.trim();
    if (!sid) {
      alert('اختر محطة ذات معرف أو افتح محطة محفوظة.');
      return;
    }
    var nameAr = (getEl('stName') && getEl('stName').value.trim()) || '';
    if (!nameAr) {
      var st = stationsCache.find(function (s) { return s && s.id === sid; });
      if (st && st.name) nameAr = String(st.name).trim();
    }
    if (!nameAr) {
      alert('عيّن اسماً عربيّاً للمحطة (كما في المرجع) أو افتح محطة من الجدول.');
      return;
    }
    var yEl = getEl('stSuhailAnchorYearInput');
    var y =
      yEl && yEl.value !== '' && yEl.value != null ? Number(yEl.value) : new Date().getUTCFullYear();
    if (!Number.isFinite(y)) {
      alert('أدخل سنة صالحة لربط دخول سهيل الفلكي (عام مرجعي).');
      return;
    }
    var status = getEl('stationsStatus');
    var doc;
    try {
      doc = await loadTrueFinalStationReferenceDoc();
    } catch (e) {
      alert('تعذّر تحميل المرجع النهائي. تحقق من الاتصال ومن توفر الملف data/true_final_station_reference.json');
      return;
    }
    if (!doc || !Array.isArray(doc.stations) || !doc.stations.length) {
      alert('المرجع النهائي غير مكتمل. أنشئ الملف data/true_final_station_reference.json من الجدول المرجعي.');
      return;
    }
    var row = findTrueFinalRowByStationNameAr(doc, nameAr);
    if (!row) {
      alert('لا تطابق لاسم المحطة في المرجع النهائي. راجع التطابق مع عمود «اسم المحطة» (العربي) في الجدول.');
      return;
    }
    var suhailMd = row.astronomical_suhail_entry_md != null ? String(row.astronomical_suhail_entry_md).trim() : '';
    if (!suhailMd) {
      alert('مرساة سهيل غير متاحة في المرجع الجديد');
      return;
    }
    var ds = ddMmToIsoDateWithYear(suhailMd, y);
    if (!ds) {
      alert('قيمة دخول سهيل الفلكي (يوم-شهر) في المرجع غير صالحة.');
      return;
    }
    var durN = row.dur_at_astronomical_entry != null ? String(row.dur_at_astronomical_entry) : '—';
    var dayIn = row.dur_day_at_astronomical_entry != null ? String(row.dur_day_at_astronomical_entry) : '—';
    var sWin = row.dur_start_at_astronomical_entry_md != null ? String(row.dur_start_at_astronomical_entry_md) : '—';
    var eWin = row.dur_end_at_astronomical_entry_md != null ? String(row.dur_end_at_astronomical_entry_md) : '—';
    var summary =
      'تأكيد: تعبئة مرساة سهيل من المرجع النهائي\n' +
      '— تاريخ دخول سهيل (فلكي) للسنة ' +
      y +
      ': ' +
      ds +
      '\n' +
      '— الدر عند الدخول: ' +
      durN +
      '\n' +
      '— اليوم داخل الدر: ' +
      dayIn +
      '\n' +
      '— نافذة الدر (يوم/شهر في المرجع): ' +
      sWin +
      ' → ' +
      eWin +
      '\n\nاعتماد التاريخ اليدوي في الحقل وربطه بالمحطة عند الحفظ؟';
    if (!window.confirm(summary)) return;
    var sIso = row.dur_start_at_astronomical_entry_md
      ? ddMmToIsoDateWithYear(row.dur_start_at_astronomical_entry_md, y)
      : null;
    var eIso = row.dur_end_at_astronomical_entry_md
      ? ddMmToIsoDateWithYear(row.dur_end_at_astronomical_entry_md, y)
      : null;
    if (sIso && eIso) {
      var tS = new Date(sIso + 'T12:00:00.000Z');
      var tE = new Date(eIso + 'T12:00:00.000Z');
      if (tE < tS) eIso = ddMmToIsoDateWithYear(row.dur_end_at_astronomical_entry_md, y + 1);
    }
    _pendingSuhailAnchorResolution = {
      engine_version: 'true_final_station_reference_v1',
      resolved_at: new Date().toISOString().slice(0, 10),
      astronomical_event_date: ds,
      operational_workbook_file: null,
      operational_cycle_label: null,
      dur_name_ar: row.dur_at_astronomical_entry
        ? String(row.dur_at_astronomical_entry).trim()
        : null,
      day_in_dur: Number.isFinite(Number(row.dur_day_at_astronomical_entry))
        ? Number(row.dur_day_at_astronomical_entry)
        : null,
      days_remaining_in_dur: null,
      next_dur_name_ar: null,
      current_dur_start_iso: sIso,
      current_dur_end_iso: eIso,
      next_dur_start_iso: null,
      star_events_year: y,
      workbook_city_name_used: null
    };
    var suhailEl = getEl('stManualSuhailAnchorDate');
    if (suhailEl) suhailEl.value = ds;
    if (status) {
      status.textContent =
        'تمت تعبئة مرساة سهيل من المرجع النهائي (data/true_final_station_reference.json) — اضغط «حفظ محطة» للتثبيت.';
    }
    var stRef = stationsCache.find(function (s) {
      return s && String(s.id) === sid;
    });
    if (stRef) {
      var stMerged = Object.assign({}, stRef, {
        manual_suhail_anchor_date: ds,
        suhail_anchor_resolution: _pendingSuhailAnchorResolution
      });
      void refreshDururFilePanelFromTrueFinal(stMerged);
      void refreshStationLocalDurReadout(stMerged, getCanonicalNavidurAsOfIso());
    }
  }

  function fieldReviewStationNameById(sid) {
    if (!sid) return '—';
    var s = stationsCache.find(function (x) {
      return x && String(x.id) === String(sid);
    });
    return s ? (s.name || s.id || '—') : String(sid);
  }

  function buildFieldReviewSessionsUrl() {
    var params = new URLSearchParams();
    var station = getEl('fieldReviewFilterStation');
    if (station && station.value) params.set('station_id', station.value);
    var fish = getEl('fieldReviewFilterFish');
    if (fish && fish.value.trim()) params.set('fish', fish.value.trim());
    var water = getEl('fieldReviewFilterWater');
    if (water && water.value) params.set('water_state', water.value);
    var tide = getEl('fieldReviewFilterTide');
    if (tide && tide.value) params.set('tide_state', tide.value);
    var dur = getEl('fieldReviewFilterDur');
    if (dur && dur.value.trim()) params.set('dur', dur.value.trim());
    var review = getEl('fieldReviewFilterReview');
    if (review && review.value) params.set('review_status', review.value);
    var succ = getEl('fieldReviewFilterSuccess');
    if (succ && succ.value) params.set('success', succ.value);
    var df = getEl('fieldReviewDateFrom');
    if (df && df.value) params.set('date_from', df.value + 'T00:00:00.000Z');
    var dt = getEl('fieldReviewDateTo');
    if (dt && dt.value) params.set('date_to', dt.value + 'T23:59:59.999Z');
    var q = params.toString();
    return '/api?route=admin&path=field-review-sessions' + (q ? '&' + q : '');
  }

  function populateFieldReviewStationSelect() {
    var sel = getEl('fieldReviewFilterStation');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">— الكل —</option>' +
      stationsCache.map(function (s) {
        return '<option value="' + String(s.id || '').replace(/"/g, '&quot;') + '">' + (s.name || s.id || '--') + '</option>';
      }).join('');
    if (cur) sel.value = cur;
  }

  function fieldReviewStatusLabel(st) {
    if (st === 'approved') return 'معتمد';
    if (st === 'rejected') return 'مرفوض';
    return 'معلّق';
  }

  async function refreshFieldReview() {
    console.log('Loader executed:', 'refreshFieldReview');
    if (!adminAuthenticated) {
      console.warn('[admin] refreshFieldReview skipped: not authenticated');
      return;
    }
    var statusEl = getEl('fieldReviewStatus');
    if (statusEl) statusEl.textContent = 'جاري تحميل تحليل الميدان...';
    try {
      populateFieldReviewStationSelect();
      var sumRes = await apiFetch('/api?route=admin&path=field-review-summary', { method: 'GET' });
      var sumData = await sumRes.json();
      if (!sumData || !sumData.ok) throw new Error((sumData && sumData.error) || 'summary_failed');

      var sessRes = await apiFetch(buildFieldReviewSessionsUrl(), { method: 'GET' });
      var sessData = await sessRes.json();
      if (!sessData || !sessData.ok) throw new Error((sessData && sessData.error) || 'sessions_failed');

      var patRes = await apiFetch('/api?route=admin&path=field-review-patterns', { method: 'GET' });
      var patData = await patRes.json();
      if (!patData || !patData.ok) throw new Error((patData && patData.error) || 'patterns_failed');

      var setRes = await apiFetch('/api?route=admin&path=field-review-learning-settings', { method: 'GET' });
      var setData = await setRes.json();
      var learnOn = !!(setData && setData.ok && setData.settings && setData.settings.learning_layer_enabled);
      var toggle = getEl('learningLayerToggle');
      if (toggle) toggle.checked = learnOn;

      var adjRes = await apiFetch('/api?route=admin&path=list-learning-adjustments', { method: 'GET' });
      var adjData = await adjRes.json();
      var adjustments = (adjData && adjData.ok && Array.isArray(adjData.adjustments)) ? adjData.adjustments : [];

      var sum = sumData.summary || {};
      var row = getEl('fieldReviewSummaryRow');
      if (row) {
        var topFish = (sum.top_caught_fish && sum.top_caught_fish[0]) ? (sum.top_caught_fish[0].key + ' (' + sum.top_caught_fish[0].count + ')') : '—';
        var topSt = (sum.most_active_stations && sum.most_active_stations[0])
          ? (fieldReviewStationNameById(sum.most_active_stations[0].key) + ' (' + sum.most_active_stations[0].count + ')')
          : '—';
        var topDur = (sum.most_validated_dur && sum.most_validated_dur[0]) ? (sum.most_validated_dur[0].key + ' (' + sum.most_validated_dur[0].count + ')') : '—';
        var topW = (sum.most_validated_water && sum.most_validated_water[0]) ? (sum.most_validated_water[0].key + ' (' + sum.most_validated_water[0].count + ')') : '—';
        row.innerHTML =
          '<div class="as-card"><div class="as-val">' + (sum.total_sessions != null ? sum.total_sessions : '0') + '</div><div class="as-lbl">إجمالي الجلسات</div></div>' +
          '<div class="as-card"><div class="as-val">' + (sum.success_rate != null ? sum.success_rate + '%' : '—') + '</div><div class="as-lbl">معدل النجاح</div></div>' +
          '<div class="as-card"><div class="as-val">' + (sum.failed_sessions != null ? sum.failed_sessions : '0') + '</div><div class="as-lbl">جلسات فاشلة</div></div>' +
          '<div class="as-card"><div class="as-val" style="font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(topFish) + '">' + escapeHtml(topFish) + '</div><div class="as-lbl">أشهر سمكة</div></div>' +
          '<div class="as-card"><div class="as-val" style="font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(topSt) + '">' + escapeHtml(topSt) + '</div><div class="as-lbl">أنشط محطة</div></div>' +
          '<div class="as-card"><div class="as-val" style="font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(topDur) + '">' + escapeHtml(topDur) + '</div><div class="as-lbl">أكثر در تحققاً</div></div>' +
          '<div class="as-card"><div class="as-val" style="font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(topW) + '">' + escapeHtml(topW) + '</div><div class="as-lbl">حالة ماء (تحقق)</div></div>' +
          '<div class="as-card"><div class="as-val">' + String((sessData.total != null ? sessData.total : (sessData.sessions || []).length)) + '</div><div class="as-lbl">بعد التصفية</div></div>';
        row.style.gridTemplateColumns = 'repeat(4, minmax(0,1fr))';
      }

      var accEl = getEl('fieldReviewAccuracy');
      if (accEl) {
        var a = sum.accuracy || {};
        accEl.innerHTML = 'مُوصى به وتم صيده: <strong>' + (a.recommended_and_caught != null ? a.recommended_and_caught : 0) + '</strong> — ' +
          'مُوصى به ولم يُصطد: <strong>' + (a.recommended_not_caught != null ? a.recommended_not_caught : 0) + '</strong> — ' +
          'غير مُوصى به وتم صيده: <strong>' + (a.not_recommended_but_caught != null ? a.not_recommended_but_caught : 0) + '</strong>';
      }

      var sessions = Array.isArray(sessData.sessions) ? sessData.sessions : [];
      var sessBody = getEl('fieldReviewSessionsBody');
      if (sessBody) {
        sessBody.innerHTML = '';
        if (!sessions.length) {
          sessBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8ea4ba">لا جلسات مطابقة للتصفية</td></tr>';
        } else {
          sessions.forEach(function (s) {
            var tr = document.createElement('tr');
            var t = s.analysis_timestamp || s.created_at || '—';
            var pred = (s.species_predicted || []).join('، ') || '—';
            var act = (s.actual_species || []).join('، ') || '—';
            tr.innerHTML = '<td>' + escapeHtml(s.station_name || '—') + '</td>' +
              '<td style="font-size:.78rem">' + escapeHtml(String(t)) + '</td>' +
              '<td style="font-size:.8rem">' + escapeHtml(s.dur_name || '—') + '</td>' +
              '<td style="font-size:.78rem">' + escapeHtml((s.water_state || '—') + ' / ' + (s.tide_state || '—')) + '</td>' +
              '<td style="font-size:.72rem;max-width:200px;word-break:break-word">موصى: ' + escapeHtml(pred) + '<br>فعلي: ' + escapeHtml(act) + '</td>' +
              '<td style="font-size:.78rem">' + escapeHtml(fieldReviewStatusLabel(s.review_status)) + '</td>' +
              '<td><button type="button" class="small-btn" data-field-detail="' + escapeHtml(s.catch_id || '') + '">تفاصيل</button></td>';
            sessBody.appendChild(tr);
          });
          sessBody.querySelectorAll('button[data-field-detail]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var id = btn.getAttribute('data-field-detail');
              var s = sessions.find(function (x) { return x && x.catch_id === id; });
              if (s) openFieldSessionDetail(s);
            });
          });
        }
      }

      var patterns = Array.isArray(patData.patterns) ? patData.patterns : [];
      fieldReviewPatternsById = {};
      patterns.forEach(function (p) {
        if (p && p.pattern_id) fieldReviewPatternsById[p.pattern_id] = p;
      });
      var patBody = getEl('fieldReviewPatternsBody');
      if (patBody) {
        patBody.innerHTML = '';
        if (!patterns.length) {
          patBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8ea4ba">لا أنماط بعد</td></tr>';
        } else {
          patterns.forEach(function (p) {
            var tr = document.createElement('tr');
            var st = p.decision_strength != null ? p.decision_strength : 0;
            var label = p.decision_strength_label || p.confidence || '—';
            var canApprove = st >= 55;
            var summaryLine = escapeHtml(p.fish || '—') + ' @ ' + escapeHtml(p.station || '—') + ' — در: ' + escapeHtml(p.dur || '—') + ' — ' + escapeHtml(p.waterState || '—') + ' / ' + escapeHtml(p.tideState || '—');
            var btnHtml = canApprove
              ? '<button type="button" class="settings-btn field-review-apply-btn" data-pattern-id="' + escapeHtml(p.pattern_id || '') + '">اعتماد التعديلات</button>'
              : '<button type="button" class="settings-btn" disabled>اعتماد التعديلات</button><div class="section-subtitle" style="font-size:.68rem;margin-top:4px;color:#f0a8a8">لا توجد أدلة كافية لاعتماد هذا التعديل</div>';
            tr.innerHTML = '<td style="font-size:.78rem;max-width:180px;word-break:break-word">' + summaryLine + '</td>' +
              '<td>' + (p.evidence_count != null ? p.evidence_count : '0') + '</td>' +
              '<td>' + (p.success_rate != null ? p.success_rate + '%' : '—') + '</td>' +
              '<td><strong>' + st + '</strong> — ' + escapeHtml(label) + '</td>' +
              '<td style="font-size:.72rem;max-width:200px;word-break:break-word">' + escapeHtml(p.strength_reason || '—') + '</td>' +
              '<td>' + (p.suggested_adjustment != null ? String(p.suggested_adjustment) : '0') + '</td>' +
              '<td style="min-width:120px;vertical-align:top">' + btnHtml + '</td>';
            patBody.appendChild(tr);
          });
          patBody.querySelectorAll('button.field-review-apply-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var pid = btn.getAttribute('data-pattern-id');
              var p = fieldReviewPatternsById[pid];
              if (p) beginApproveLearningPattern(p);
            });
          });
        }
      }

      var adjBody = getEl('fieldReviewAdjBody');
      if (adjBody) {
        adjBody.innerHTML = '';
        if (!adjustments.length) {
          adjBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8ea4ba">لا تعديلات معتمدة بعد</td></tr>';
        } else {
          adjustments.forEach(function (a) {
            var tr = document.createElement('tr');
            var cond = a.conditions || {};
            var condStr = [cond.station, cond.dur, cond.waterState, cond.tideState].filter(Boolean).join(' — ') || '—';
            var active = a.active !== false;
            var audit = 'المصدر: ' + (a.source || '—') + ' | اعتماد: ' + (a.approved_by || '—') + ' | ' + (a.created_at || '—') + ' | قوة: ' + (a.decision_strength != null ? a.decision_strength : '—');
            var toggleBtn = active
              ? '<button type="button" class="small-btn" data-adj-toggle="' + escapeHtml(a.id || '') + '" data-adj-want="0">إيقاف</button>'
              : '<button type="button" class="small-btn" data-adj-toggle="' + escapeHtml(a.id || '') + '" data-adj-want="1">تفعيل</button>';
            tr.innerHTML = '<td>' + escapeHtml(a.fish || '—') + '</td>' +
              '<td style="font-size:.72rem;max-width:200px;word-break:break-word">' + escapeHtml(condStr) + '</td>' +
              '<td>' + (a.score_adjustment != null ? String(a.score_adjustment) : '0') + '</td>' +
              '<td>' + (a.decision_strength != null ? a.decision_strength : '—') + ' / ' + escapeHtml(a.decision_strength_label || '') + '</td>' +
              '<td style="font-size:.68rem">' + escapeHtml(audit) + '</td>' +
              '<td>' + toggleBtn + ' <button type="button" class="small-btn danger" data-adj-del="' + escapeHtml(a.id || '') + '">حذف</button></td>';
            adjBody.appendChild(tr);
          });
          adjBody.querySelectorAll('button[data-adj-toggle]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              var id = btn.getAttribute('data-adj-toggle');
              var want = btn.getAttribute('data-adj-want') === '1';
              if (!id) return;
              var res = await apiFetch('/api?route=admin&path=toggle-learning-adjustment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, active: want })
              });
              var j = await res.json();
              if (j && j.ok) void refreshFieldReview();
              else if (statusEl) statusEl.textContent = 'تعذّر تغيير حالة التعديل.';
            });
          });
          adjBody.querySelectorAll('button[data-adj-del]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              var id = btn.getAttribute('data-adj-del');
              if (!id) return;
              if (!window.confirm('حذف هذا التعديل نهائياً من طبقة التعلم؟')) return;
              var res = await apiFetch('/api?route=admin&path=delete-learning-adjustment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
              });
              var j = await res.json();
              if (j && j.ok) void refreshFieldReview();
            });
          });
        }
      }

      if (statusEl) statusEl.textContent = 'تم التحديث — ' + new Date().toLocaleString('ar-QA', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.textContent = 'تعذّر التحميل: ' + (e && e.message ? e.message : String(e));
    }
  }

  function openFieldSessionDetail(s) {
    fieldReviewSelectedSession = s;
    var d = getEl('fieldSessionDetailContent');
    var m = getEl('fieldSessionDetailModal');
    if (!d || !m) return;
    var snap = 'حرارة: ' + (s.temperature != null ? s.temperature : '—') + ' | ريح: ' + (s.wind_speed != null ? s.wind_speed : '—') + ' | اتجاه: ' + (s.wind_direction != null ? s.wind_direction : '—');
    var photo = s.photo_url
      ? ('<div style="margin-top:8px"><img src="' + escapeHtml(s.photo_url) + '" alt="" style="max-width:100%;max-height:200px;border-radius:8px"></div>')
      : '<div style="color:#8ea4ba;font-size:.8rem">لا صورة</div>';
    d.innerHTML =
      '<div><strong>المحطة:</strong> ' + escapeHtml(s.station_name || '—') + '</div>' +
      '<div><strong>الوقت / التحليل:</strong> ' + escapeHtml(String(s.analysis_timestamp || s.created_at || '—')) + '</div>' +
      '<div><strong>الدر:</strong> ' + escapeHtml(s.dur_name || '—') + '</div>' +
      '<div><strong>حالة الماء:</strong> ' + escapeHtml(s.water_state || '—') + '</div>' +
      '<div><strong>حالة المد:</strong> ' + escapeHtml(s.tide_state || '—') + '</div>' +
      '<div><strong>لقطة طقس (من السجل):</strong> ' + escapeHtml(snap) + '</div>' +
      '<div style="margin-top:8px"><strong>الموصى بها:</strong> ' + escapeHtml((s.species_predicted || []).join('، ') || '—') + '</div>' +
      '<div><strong>الصاد فعلياً:</strong> ' + escapeHtml((s.actual_species || []).join('، ') || '—') + '</div>' +
      '<div><strong>نجاح:</strong> ' + (s.catch_success ? 'نعم' : 'لا') + '</div>' +
      '<div style="margin-top:8px"><strong>ملاحظات المشغل:</strong> ' + escapeHtml(s.user_note || s.water_observation || '—') + '</div>' +
      (s.review_notes ? ('<div><strong>ملاحظات مراجعة:</strong> ' + escapeHtml(s.review_notes) + '</div>') : '') +
      photo;
    var rs = getEl('fieldSessionReviewStatus');
    if (rs) rs.value = s.review_status && ['pending', 'approved', 'rejected'].indexOf(s.review_status) >= 0 ? s.review_status : 'pending';
    m.showModal();
  }

  function beginApproveLearningPattern(p) {
    if (!p || p.decision_strength == null || p.decision_strength < 55) return;
    fieldReviewPendingPattern = p;
    var modal = getEl('learningConfirmModal');
    if (modal) modal.showModal();
  }

  function closeLearningModal() {
    var modal = getEl('learningConfirmModal');
    if (modal) modal.close();
    fieldReviewPendingPattern = null;
  }

  async function confirmApplyLearningFromModal() {
    var p = fieldReviewPendingPattern;
    fieldReviewPendingPattern = null;
    var lmodal = getEl('learningConfirmModal');
    if (lmodal) lmodal.close();
    if (!p) return;
    var st = p.decision_strength != null ? p.decision_strength : 0;
    if (st < 55) return;
    var payload = {
      decision_strength: st,
      decision_strength_label: p.decision_strength_label || p.confidence || '',
      fish: p.fish,
      score_adjustment: p.suggested_adjustment != null ? p.suggested_adjustment : 0,
      source: 'FIELD',
      pattern_id: p.pattern_id,
      conditions: {
        station: p.station,
        station_id: p.station_id,
        dur: p.dur && p.dur !== '—' ? p.dur : '',
        waterState: p.waterState,
        tideState: p.tideState
      },
      approved_by: (me && me.username) ? me.username : 'admin',
      active: true
    };
    var res = await apiFetch('/api?route=admin&path=apply-learning-adjustment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var j = await res.json();
    var statusEl = getEl('fieldReviewStatus');
    if (j && j.ok) {
      if (statusEl) statusEl.textContent = 'تم اعتماد التعديل (طبقة مساعدة).';
      void refreshFieldReview();
    } else {
      if (statusEl) statusEl.textContent = 'فشل الاعتماد: ' + ((j && j.error) || res.status);
    }
  }

  function initFieldReviewPanel() {
    var refresh = getEl('fieldReviewRefreshBtn');
    if (refresh) {
      refresh.addEventListener('click', function () {
        void refreshFieldReview();
      });
    }
    var applyF = getEl('fieldReviewApplyFiltersBtn');
    if (applyF) {
      applyF.addEventListener('click', function () {
        void refreshFieldReview();
      });
    }
    var learnToggle = getEl('learningLayerToggle');
    if (learnToggle) {
      learnToggle.addEventListener('change', async function () {
        var on = learnToggle.checked;
        var res = await apiFetch('/api?route=admin&path=field-review-learning-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ learning_layer_enabled: on })
        });
        var j = await res.json();
        if (!j || !j.ok) learnToggle.checked = !on;
      });
    }
    var mc = getEl('learningModalCancel');
    if (mc) mc.addEventListener('click', function () { closeLearningModal(); });
    var mOk = getEl('learningModalOk');
    if (mOk) mOk.addEventListener('click', function () { void confirmApplyLearningFromModal(); });
    var fdClose = getEl('fieldSessionDetailClose');
    if (fdClose) {
      fdClose.addEventListener('click', function () {
        var m = getEl('fieldSessionDetailModal');
        if (m) m.close();
      });
    }
    var saveRev = getEl('fieldSessionReviewSaveBtn');
    if (saveRev) {
      saveRev.addEventListener('click', async function () {
        var s = fieldReviewSelectedSession;
        if (!s || !s.catch_id) return;
        var stSel = getEl('fieldSessionReviewStatus');
        var status = stSel ? stSel.value : 'pending';
        var res = await apiFetch('/api?route=admin&path=field-session-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catch_id: s.catch_id,
            review_status: status,
            notes: s.review_notes || null,
            photo_url: s.photo_url || null
          })
        });
        var j = await res.json();
        if (j && j.ok) {
          s.review_status = status;
          void refreshFieldReview();
          var m = getEl('fieldSessionDetailModal');
          if (m) m.close();
        }
      });
    }
  }

  function initAstroDurPanel() {
    var r = getEl('astroDurRefreshBtn');
    if (r) {
      r.addEventListener('click', function () {
        void refreshAstroDurStatus();
      });
    }
    var p = getEl('astroPreviewBtn');
    if (p) {
      p.addEventListener('click', function () {
        void runAstroPreview();
      });
    }
  }

  async function saveStationFromForm() {
    console.info('[SAVE_CLICK]');
    var status = getEl('stationsStatus');
    if (!status) {
      console.info('[SAVE_VALIDATE]', { ok: false, reason: 'stationsStatus_missing' });
      return;
    }
    try {
      var payload = readStationForm();
      console.info('[SAVE_VALIDATE]', { ok: true, step: 'after_read_form' });

      if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lon)) {
        console.info('[SAVE_VALIDATE]', { ok: false, reason: 'invalid_coordinates' });
        status.textContent = 'يرجى تحديد موقع المحطة على الخريطة أولاً';
        return;
      }

      if (!payload.is_reference_station) {
        if (waterCheckState.checking) {
          console.info('[SAVE_VALIDATE]', { ok: false, reason: 'water_check_in_progress' });
          status.textContent = 'جاري التحقق من موقع المحطة، يرجى الانتظار...';
          return;
        }
        var latMatch = Math.abs((waterCheckState.lat || 0) - payload.lat) < 1e-5;
        var lonMatch = Math.abs((waterCheckState.lon || 0) - payload.lon) < 1e-5;
        if (!latMatch || !lonMatch || waterCheckState.isWater === null) {
          console.info('[SAVE_VALIDATE]', { ok: false, reason: 'water_check_pending', latMatch: latMatch, lonMatch: lonMatch });
          status.textContent = 'جاري التحقق من موقع المحطة...';
          await detectAndAutoOffsetWater(payload.lat, payload.lon);
          payload = readStationForm();
        }
        if (waterCheckState.result === 'confirmed_land' || waterCheckState.isWater === false) {
          console.info('[SAVE_VALIDATE]', { ok: false, reason: 'confirmed_land' });
          status.textContent = '⛔ يرجى وضع المحطة داخل البحر وليس على اليابسة';
          return;
        }
        if (waterCheckState.result === 'uncertain') {
          console.info('[SAVE_VALIDATE]', { ok: false, reason: 'uncertain_water' });
          status.textContent = '⚠️ الموقع غير مؤكد (منطقة ساحلية / ميناء) — انقل نقطة المحطة إلى البحر المفتوح وأعد الفحص';
          return;
        }
      } else {
        waterCheckState.lat = payload.lat;
        waterCheckState.lon = payload.lon;
        waterCheckState.isWater = null;
        waterCheckState.checking = false;
        waterCheckState.result = 'unknown';
        setReferenceAnchorStatus();
      }
      console.info('[SAVE_VALIDATE]', { ok: true, step: 'water_rules_passed' });

      status.textContent = payload.is_reference_station ? 'جاري حفظ المحطة المرجعية...' : 'جاري الحفظ...';
      if (isAdminMode()) {
        console.info('[admin][station-save]', { stationIdSent: payload.id || null });
      }
      console.info('[SAVE_PAYLOAD]', payload);
      var res = await apiFetch(STATIONS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.info('[SAVE_RESULT]', { ok: res.ok, status: res.status });
      if (!res.ok) {
        var err = await res.text();
        throw new Error(err || 'station_save_failed');
      }
      status.textContent = 'تم الحفظ.';
      clearStationForm();
      await loadStations();
    } catch (e) {
      console.info('[SAVE_RESULT]', { ok: false, error: e && e.message ? e.message : String(e) });
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
          await apiFetch('/api?route=admin&path=users/' + encodeURIComponent(id) + '/password', {
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
    if (!getEl('feedbackBody')) {
      console.warn('Missing element:', 'feedbackBody');
      return;
    }
    console.log('Loader executed:', 'loadFeedback');
    var params = new URLSearchParams();
    var d = getEl('fbDateFilter') ? getEl('fbDateFilter').value : '';
    var st = getEl('fbStationFilter') ? getEl('fbStationFilter').value.trim() : '';
    var u = getEl('fbUserFilter') ? getEl('fbUserFilter').value.trim() : '';
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
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8ea4ba">لا توجد بيانات حالياً</td></tr>';
      var fs0 = getEl('feedbackStatusAdmin');
      if (fs0) fs0.textContent = 'إجمالي النتائج: 0';
      updateFieldTestingChecklist(latestSummaryCache, latestFeedbackCache);
      return;
    }
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
    var user = normalizeLoginIdentifier(getEl('adminUser').value);
    var pass = normalizeLoginPassword(getEl('adminPass').value);
    var errEl = getEl('adminErr');

    try {
      console.info('[admin] login request', {
        username: user,
        passwordProvided: !!pass
      });
      var res = await fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      console.info('[admin] login response', { status: res.status });
      var contentType = String(res.headers.get('content-type') || '').toLowerCase();
      if (contentType.indexOf('application/json') === -1) throw new Error('invalid_login_response');
      if (!res.ok) throw new Error('login_failed');
      var data = await res.json();
      authToken = data.token || '';
      me = data.user || null;
      localStorage.setItem('navidur_admin_token', authToken);
      localStorage.setItem('navidur_admin_user', JSON.stringify(me || null));

      if (!me || (me.role !== 'admin' && me.role !== 'super_admin')) throw new Error('role_not_allowed');

      adminAuthenticated = true;
      errEl.style.display = 'none';
      getEl('adminLoginForm').style.display = 'none';
      getEl('adminContent').classList.add('active');
      await renderAdminDashboard();
      setAdminDataFilter('home');
      loadSettingsIntoAdmin();
      clearStationForm();
      clearTrueFinalReferenceCache();
    } catch (_err) {
      errEl.style.display = 'block';
      getEl('adminPass').value = '';
    }
  }

  async function logout() {
    try {
      await fetch(LOGOUT_ENDPOINT, { method: 'POST', credentials: 'include' });
    } catch (_e) {}
    localStorage.removeItem('navidur_admin_token');
    localStorage.removeItem('navidur_admin_user');
    authToken = '';
    me = null;
    adminAuthenticated = false;
    stopHomeDashboardAutoRefresh();
    getEl('adminContent').classList.remove('active');
    getEl('adminLoginForm').style.display = 'block';
    clearTrueFinalReferenceCache();
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

    // Platform mode toggle buttons — auto-save immediately on click so the
    // change is globally visible without requiring a separate "حفظ" press.
    var openBtn = getEl('platformModeOpenBtn');
    var closedBtn = getEl('platformModeClosedBtn');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        var sel = getEl('siteModeInput');
        if (sel) sel.value = 'live';
        syncPlatformToggle('live');
        if (!settingsInFlight) saveSettingsFromAdmin();
      });
    }
    if (closedBtn) {
      closedBtn.addEventListener('click', function () {
        var sel = getEl('siteModeInput');
        if (sel) sel.value = 'maintenance';
        syncPlatformToggle('maintenance');
        if (!settingsInFlight) saveSettingsFromAdmin();
      });
    }
  }

  function initStationFormBindings() {
    var countryEl = getEl('stCountry');
    var regionEl = getEl('stRegion');
    var nameEl = getEl('stName');
    var hintEl = getEl('stNameAutoHint');

    if (countryEl) {
      countryEl.addEventListener('change', function () {
        rebuildRegionSelect(countryEl.value, '');
        if (!_stationEditMode && !_stationNameUserEdited) {
          if (nameEl) nameEl.value = '';
          if (hintEl) hintEl.textContent = '';
        }
      });
    }

    if (regionEl) {
      regionEl.addEventListener('change', function () {
        var v = regionEl.value;
        if (v === '__add_new__') {
          regionEl.value = '';
          var wrap = getEl('newRegionWrap');
          if (wrap) { wrap.style.display = 'block'; }
          var inp = getEl('stRegionNew');
          if (inp) inp.focus();
          return;
        }
        if (!_stationEditMode && !_stationNameUserEdited && v) {
          var suggested = suggestAutoNumber(countryEl ? countryEl.value : '', v);
          if (nameEl) nameEl.value = suggested;
          if (hintEl) hintEl.textContent = '(تلقائي)';
          _stationNameUserEdited = false;
        }
      });
    }

    if (nameEl) {
      nameEl.addEventListener('input', function () {
        _stationNameUserEdited = true;
        if (hintEl) hintEl.textContent = '';
        onStationIdentityChangedForLocalPanel();
      });
    }

    var suhailManualEl = getEl('stManualSuhailAnchorDate');
    if (suhailManualEl) {
      suhailManualEl.addEventListener('input', onManualSuhailChangedForLocalPanel);
      suhailManualEl.addEventListener('change', onManualSuhailChangedForLocalPanel);
    }

    var isReferenceEl = getEl('stIsReferenceStation');
    if (isReferenceEl) {
      isReferenceEl.addEventListener('change', function () {
        var lat = Number(getEl('stLat').value);
        var lon = Number(getEl('stLon').value);
        if (isReferenceEl.checked) {
          setReferenceAnchorStatus();
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            waterCheckState.lat = lat;
            waterCheckState.lon = lon;
          }
          waterCheckState.isWater = null;
          waterCheckState.checking = false;
          waterCheckState.result = 'unknown';
          return;
        }
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          scheduleWaterCheck(lat, lon);
        } else {
          setWaterStatus('unknown', '');
        }
      });
    }

    var addRegionBtn = getEl('addRegionBtn');
    if (addRegionBtn) {
      addRegionBtn.addEventListener('click', function () {
        var wrap = getEl('newRegionWrap');
        if (!wrap) return;
        var isHidden = wrap.style.display === 'none' || wrap.style.display === '';
        wrap.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          var inp = getEl('stRegionNew');
          if (inp) inp.focus();
        }
      });
    }

    function confirmNewRegion() {
      var newName = (getEl('stRegionNew') ? getEl('stRegionNew').value.trim() : '');
      if (!newName) return;
      var sel = getEl('stRegion');
      if (!sel) return;
      var exists = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === newName) { exists = true; break; }
      }
      if (!exists) {
        var opt = document.createElement('option');
        opt.value = newName;
        opt.textContent = newName;
        var addNewOpt = sel.querySelector('option[value="__add_new__"]');
        if (addNewOpt) sel.insertBefore(opt, addNewOpt);
        else sel.appendChild(opt);
      }
      sel.value = newName;
      getEl('stRegionNew').value = '';
      getEl('newRegionWrap').style.display = 'none';
      if (!_stationEditMode && !_stationNameUserEdited) {
        var suggested = suggestAutoNumber(countryEl ? countryEl.value : '', newName);
        if (nameEl) nameEl.value = suggested;
        if (hintEl) hintEl.textContent = '(تلقائي)';
        _stationNameUserEdited = false;
      }
    }

    var confirmRegionBtn = getEl('confirmRegionBtn');
    if (confirmRegionBtn) {
      confirmRegionBtn.addEventListener('click', confirmNewRegion);
    }
    var stRegionNew = getEl('stRegionNew');
    if (stRegionNew) {
      stRegionNew.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmNewRegion(); }
      });
    }

    var saveTrueFinalBtn = getEl('stTrueFinalSaveBtn');
    if (saveTrueFinalBtn) {
      saveTrueFinalBtn.addEventListener('click', function () {
        saveTrueFinalReferenceEdits();
      });
    }

    var fetchSuhailBtn = getEl('stFetchWorkbookSuhailBtn');
    if (fetchSuhailBtn) {
      fetchSuhailBtn.addEventListener('click', function () {
        void fetchWorkbookSuhailAnchorIntoForm();
      });
    }
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
        if (btn.disabled) return;
        var df = btn.getAttribute('data-filter');
        if (df) setAdminDataFilter(df);
      });
    });
    document.querySelectorAll('.ecc-ac-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var g = btn.getAttribute('data-go');
        if (g) setAdminDataFilter(g);
      });
    });

    var dururTabButtons = [
      {id:'dururDurTabBtn', tab:'dururDurTab'},
      {id:'dururReferenceTabBtn', tab:'dururReferenceTab'},
      {id:'seasonEventsTabBtn', tab:'seasonEventsTab'},
      {id:'referenceStationsTabBtn', tab:'referenceStationsTab'},
      {id:'dururAnalysisTabBtn', tab:'dururAnalysisTab'}
    ];
    dururTabButtons.forEach(function (item) {
      var btn = getEl(item.id);
      if (btn) {
        btn.addEventListener('click', function () {
          setDururTab(item.tab);
        });
      }
    });

    var stationsReferenceOnlyToggle = getEl('stationsReferenceOnlyToggle');
    if (stationsReferenceOnlyToggle) stationsReferenceOnlyToggle.addEventListener('change', function () {
      dururMapFilters.stationType = getAdminReferenceOnlyEnabled() ? 'reference_only' : 'all';
      var visibleStations = getVisibleAdminStations();
      renderAdminStationsTable(visibleStations);
      refreshAllStationMarkers(null, visibleStations);
      if (isAdminMode()) {
        console.info('[admin][toggle-reference-filter]', {
          referenceOnly: getAdminReferenceOnlyEnabled(),
          totalStations: stationsCache.length,
          totalReferenceStations: getReferenceStationCount(stationsCache),
          totalReferenceStationsShownInTable: visibleStations.filter(isReferenceCalibrationStation).length,
          visibleStations: visibleStations.length
        });
      }
    });

    var dururReferenceSearch = getEl('dururReferenceSearch');
    if (dururReferenceSearch) dururReferenceSearch.addEventListener('input', renderDururReferenceTable);
    var dururReferenceStatusFilter = getEl('dururReferenceStatusFilter');
    if (dururReferenceStatusFilter) dururReferenceStatusFilter.addEventListener('change', renderDururReferenceTable);
    var dururReferenceOverrideReady = getEl('dururReferenceOverrideReady');
    if (dururReferenceOverrideReady) dururReferenceOverrideReady.addEventListener('change', renderDururReferenceTable);

    var saveDururReferenceBtn = getEl('saveDururReferenceBtn');
    var clearDururReferenceBtn = getEl('clearDururReferenceBtn');
    var markDururReferenceReviewedBtn = getEl('markDururReferenceReviewedBtn');
    var markDururReferenceApprovedBtn = getEl('markDururReferenceApprovedBtn');
    var resetDururReferenceDraftBtn = getEl('resetDururReferenceDraftBtn');

    if (saveDururReferenceBtn) saveDururReferenceBtn.addEventListener('click', saveDururReferenceForm);
    if (clearDururReferenceBtn) clearDururReferenceBtn.addEventListener('click', clearDururReferenceForm);
    if (markDururReferenceReviewedBtn) markDururReferenceReviewedBtn.addEventListener('click', function () { markSelectedDururReferenceStatus('reviewed'); });
    if (markDururReferenceApprovedBtn) markDururReferenceApprovedBtn.addEventListener('click', function () { markSelectedDururReferenceStatus('approved'); });
    if (resetDururReferenceDraftBtn) resetDururReferenceDraftBtn.addEventListener('click', function () { markSelectedDururReferenceStatus('draft'); });

    ['analysisStationFilter','analysisDurFilter','analysisYearFilter'].forEach(function (id) {
      var el = getEl(id);
      if (el) el.addEventListener('change', renderAnalysisResults);
    });

    var dururAnalysisBtn = getEl('loadDururAnalysisBtn');
    if (dururAnalysisBtn) dururAnalysisBtn.addEventListener('click', renderAnalysisResults);

    var saveDurBtn = getEl('saveDurBtn');
    var clearDurBtn = getEl('clearDurBtn');
    var saveEventBtn = getEl('saveEventBtn');
    var clearEventBtn = getEl('clearEventBtn');
    var saveStationTypeBtn = getEl('saveStationTypeBtn');
    var saveProfileBtn = getEl('saveProfileBtn');
    var clearProfileBtn = getEl('clearProfileBtn');
    var saveOverrideBtn = getEl('saveOverrideBtn');
    var clearOverrideBtn = getEl('clearOverrideBtn');
    var saveComparisonBtn = getEl('saveComparisonBtn');
    var clearComparisonBtn = getEl('clearComparisonBtn');
    var loadAnalysisBtn = getEl('loadDururAnalysisBtn');

    if (saveDurBtn) saveDurBtn.addEventListener('click', saveDurForm);
    if (clearDurBtn) clearDurBtn.addEventListener('click', clearDurForm);
    if (saveEventBtn) saveEventBtn.addEventListener('click', saveEventForm);
    if (clearEventBtn) clearEventBtn.addEventListener('click', clearEventForm);
    if (saveStationTypeBtn) saveStationTypeBtn.addEventListener('click', saveStationTypeUpdate);
    if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfileForm);
    if (clearProfileBtn) clearProfileBtn.addEventListener('click', clearProfileForm);
    if (saveOverrideBtn) saveOverrideBtn.addEventListener('click', saveOverrideForm);
    if (clearOverrideBtn) clearOverrideBtn.addEventListener('click', clearOverrideForm);
    if (saveComparisonBtn) saveComparisonBtn.addEventListener('click', saveComparisonForm);
    if (clearComparisonBtn) clearComparisonBtn.addEventListener('click', clearComparisonForm);
    if (loadAnalysisBtn) loadAnalysisBtn.addEventListener('click', renderAnalysisResults);

    var saveStationBtn = getEl('saveStationBtn');
    var clearStationBtn = getEl('clearStationBtn');
    if (saveStationBtn) {
      saveStationBtn.addEventListener('click', function () {
        void saveStationFromForm();
      });
    }
    if (clearStationBtn) {
      clearStationBtn.addEventListener('click', function () {
        clearStationForm();
      });
    }

    document.querySelectorAll('.time-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (currentPeriod === btn.getAttribute('data-period')) return;
        currentPeriod = btn.getAttribute('data-period');
        document.querySelectorAll('.time-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderSummarySection();
      });
    });

    initStationsAdminMap();
    initStationsTableDelegation();
    initStationFormBindings();
    ensureDururManagementPanel();

    bindSettingsActions();
    initAstroDurPanel();
    initEccHomeUiOnce();
    initFieldReviewPanel();

    if (authToken) {
      getEl('adminLoginForm').style.display = 'none';
      getEl('adminContent').classList.add('active');
      adminAuthenticated = true;
      clearTrueFinalReferenceCache();
      setAdminDataFilter('home');
      renderAdminDashboard().then(function () {
        if (stationsAdminMap && typeof stationsAdminMap.invalidateSize === 'function') {
          stationsAdminMap.invalidateSize();
        }
        refreshAllStationMarkers();
      });
      loadSettingsIntoAdmin();
      clearStationForm();
      return;
    }

    if (userInput) userInput.focus();
  }

  window.showAdminLogin = function () {
    getEl('adminLoginForm').style.display = 'block';
    getEl('adminContent').classList.remove('active');
    getEl('adminUser').focus();
  };

  window.refreshFieldReview = refreshFieldReview;
  window.loadSettingsIntoAdmin = loadSettingsIntoAdmin;
  window.loadFeedback = loadFeedback;
  window.renderStationAnalytics = renderStationAnalytics;
  window.refreshAstroDurStatus = refreshAstroDurStatus;
  window.refreshStationLocalDurReadout = refreshStationLocalDurReadout;

  document.addEventListener('DOMContentLoaded', initAdminPage);
})();
