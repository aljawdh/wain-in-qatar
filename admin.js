(function () {
  var API_ENDPOINT = '/api/admin-analytics';
  var SETTINGS_ENDPOINT = '/api/admin-settings';
  var adminAuthenticated = false;
  var adminDataFilter = 'all';
  var ADMIN_USER = 'Mohamed_Admin';
  var ADMIN_PASS = 'NaviDur@2026#Stats';
  var refreshInFlight = false;
  var settingsInFlight = false;
  var latestSettings = null;

  function getEl(id) {
    return document.getElementById(id);
  }

  function dateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
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
  }

  function renderTopTable(bodyId, items) {
    var body = getEl(bodyId);
    if (!body) return;
    body.innerHTML = '';
    if (!items || !items.length) {
      body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#8ea4ba">لا توجد بيانات بعد</td></tr>';
      return;
    }
    items.forEach(function (item, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td><td><strong>' + item[0] + '</strong></td><td>' + item[1] + '</td>';
      body.appendChild(tr);
    });
  }

  function showBackendStatus(data) {
    var suffix = '';
    if (data && data.source) suffix += ' [' + data.source + ']';
    if (data && data.noData) {
      console.log('[admin] ' + (data.message || 'No data yet') + suffix);
      return;
    }
    console.log('[admin] Analytics connected' + suffix);
  }

  function renderFeatureTable(items) {
    var labels = {
      tide_calculation: 'Tide calculation',
      fish_info: 'Fish Info'
    };
    var normalized = (items || []).map(function (item) {
      return [labels[item[0]] || item[0], item[1]];
    });
    renderTopTable('aFeatureBody', normalized);
  }

  function renderGeoTable(geo) {
    var body = getEl('aGeoBody');
    if (!body) return;
    body.innerHTML = '';
    if (!geo || !geo.length) {
      body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#8ea4ba">لا توجد بيانات مدن بعد</td></tr>';
      return;
    }
    var total = geo.reduce(function (sum, row) { return sum + Number(row[1] || 0); }, 0) || 1;
    geo.forEach(function (row) {
      var pct = ((Number(row[1] || 0) / total) * 100).toFixed(1);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><strong>' + row[0] + '</strong></td><td>' + row[1] + '</td><td><div style="background:#27b3ff;height:6px;border-radius:3px;width:' + pct + '%;min-width:4px"></div> ' + pct + '%</td>';
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

  async function fetchStats() {
    var res = await fetch(API_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('analytics fetch failed');
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

    return {
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
    var res = await fetch(SETTINGS_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('settings fetch failed');
    var data = await res.json();
    return normalizeSettingsPayload(data.settings || data);
  }

  async function saveSettings(payload) {
    var res = await fetch(SETTINGS_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
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
      showSettingsStatus('تم حفظ الإعدادات في Redis بنجاح.', false);
    } catch (e) {
      console.error('[admin] saveSettingsFromAdmin failed:', e && e.message ? e.message : e);
      showSettingsStatus('فشل حفظ الإعدادات.', true);
    } finally {
      setSettingsBusy(false);
    }
  }

  function bindSettingsActions() {
    var saveBtn = queryFirst([
      '#saveSettingsBtn',
      '#adminSaveBtn',
      '[data-action="save-settings"]',
      '.save-settings-btn'
    ]);
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (settingsInFlight) return;
        saveSettingsFromAdmin();
      });
    }

    var reloadBtn = queryFirst([
      '#reloadSettingsBtn',
      '[data-action="reload-settings"]',
      '.reload-settings-btn'
    ]);
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        if (settingsInFlight) return;
        loadSettingsIntoAdmin();
      });
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

  async function renderAdminDashboard() {
    var data;
    setRefreshBusy(true);

    try {
      data = await fetchStats();
    } catch (e) {
      data = { visits: { today: 0, week: 0, total: 0, history: [] }, cities: [], fishClicks: [], topFeatures: [] };
    } finally {
      setRefreshBusy(false);
    }

    showBackendStatus(data);

    getEl('aVisitToday').textContent = Number(data.visits.today || 0);
    getEl('aVisitWeek').textContent = data.visits.week || 0;
    getEl('aVisitTotal').textContent = data.visits.total || 0;

    renderVisitChart(data.visits.history || []);
    renderGeoTable(Array.isArray(data.cities) ? data.cities : []);
    renderTopTable('aFishBody', data.fishClicks || []);
    renderFeatureTable(data.topFeatures || []);
  }

  async function exportAdminExcel() {
    var data;
    try {
      data = await fetchStats();
    } catch (e) {
      data = { visits: { today: 0, week: 0, total: 0 }, cities: [], fishClicks: [], topFeatures: [] };
    }

    var csv = '\uFEFF';
    csv += 'إحصائيات الزوار\n';
    csv += 'اليوم,الأسبوع,الإجمالي\n';
    csv += (data.visits.today || 0) + ',' + (data.visits.week || 0) + ',' + (data.visits.total || 0) + '\n\n';
    csv += 'التصنيف الجغرافي\n';
    csv += 'المدينة,الزيارات\n';
    (data.cities || []).forEach(function (g) { csv += g[0] + ',' + g[1] + '\n'; });
    csv += '\n';
    csv += 'أكثر الأسماك نقراً\n';
    csv += 'السمكة,النقرات\n';
    (data.fishClicks || []).forEach(function (f) { csv += f[0] + ',' + f[1] + '\n'; });
    csv += '\n';
    csv += 'الميزات الأكثر استخداماً\n';
    csv += 'الميزة,الاستخدام\n';
    (data.topFeatures || []).forEach(function (f) { csv += f[0] + ',' + f[1] + '\n'; });

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

  function onLogin() {
    var user = (getEl('adminUser').value || '').trim();
    var pass = getEl('adminPass').value || '';
    var errEl = getEl('adminErr');

    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      adminAuthenticated = true;
      errEl.style.display = 'none';
      getEl('adminLoginForm').style.display = 'none';
      getEl('adminContent').classList.add('active');
      renderAdminDashboard();
      setAdminDataFilter('all');
      loadSettingsIntoAdmin();
      return;
    }

    errEl.style.display = 'block';
    getEl('adminPass').value = '';
  }

  function initAdminPage() {
    var loginBtn = getEl('adminLoginBtn');
    var passInput = getEl('adminPass');
    var exportBtn = getEl('adminExportBtn');
    var refreshBtn = getEl('adminRefresh');
    var userInput = getEl('adminUser');

    if (loginBtn) loginBtn.addEventListener('click', onLogin);
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

    bindSettingsActions();
    loadSettingsIntoAdmin();

    if (userInput) userInput.focus();
  }

  window.showAdminLogin = function () {
    getEl('adminLoginForm').style.display = 'block';
    getEl('adminContent').classList.remove('active');
    getEl('adminUser').focus();
  };

  document.addEventListener('DOMContentLoaded', initAdminPage);
})();
