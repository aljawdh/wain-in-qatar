(function (root) {
  var C = root.NavidurComponents;
  var H = root.NavidurHelpers;
  var NO_DATA_TEXT = 'لا تتوفر بيانات لهذا اليوم';
  var mapInstance = null;
  var mapStationLayer = null;
  var mapHeatLayer = null;
  var mapHotspotMarker = null;

  function noDataCard(title) {
    return C.card(title, '<p class="muted">' + NO_DATA_TEXT + '</p>');
  }

  function renderDashboard(dto, state) {
    var app = H.byId('appContent');
    if (!app) return;
    if (!dto || typeof dto !== 'object') {
      app.innerHTML = noDataCard('لوحة NAVIDUR');
      return;
    }
    var dur = dto && dto.dur ? dto.dur : {};
    var env = dto && dto.environment ? dto.environment : {};
    var fish = dto && dto.fishing ? dto.fishing : {};
    var waveVal = env.wave_height_m != null ? String(env.wave_height_m) : '—';
    var windVal = env.wind_speed_kmh != null ? String(env.wind_speed_kmh) : '—';
    var heatHint = 'نظرة مصغرة للنشاط — للتفاصيل انتقل للخريطة.';
    var heatBars = [0.35, 0.55, 0.4, 0.7, 0.5, 0.85, 0.45, 0.6].map(function (h) {
      return '<span class="heatmap-mini__bar" style="height:' + Math.round(h * 100) + '%"></span>';
    }).join('');

    app.innerHTML = ''
      + '<div class="dashboard-stack">'
      + C.card('الدور الحالي', '<div class="metric">' + (dur.period_name || '—') + '</div><p class="muted">اليوم داخل الدر: ' + (dur.day_in_period || '—') + ' · الدر التالي: ' + (dur.next_period_name || '—') + '</p>')
      + C.decisionCard(fish, dto && dto.decision ? dto.decision : null, true)
      + C.renderWindCompass(dto)
      + '<div class="dashboard-quick">'
      + '<div class="dashboard-quick__item"><span class="dashboard-quick__label">ارتفاع الموج</span><span class="dashboard-quick__value">' + waveVal + ' <span class="muted">م</span></span></div>'
      + '<div class="dashboard-quick__item"><span class="dashboard-quick__label">سرعة الرياح</span><span class="dashboard-quick__value">' + windVal + ' <span class="muted">كم/س</span></span></div>'
      + '</div>'
      + '<div class="map-and-gauge map-and-gauge--dashboard">'
      + C.card('مؤشر النشاط', '<div class="gauge-wrap"><div class="gauge-bar gauge-bar--dashboard"><div class="gauge-fill" style="width:' + Math.max(0, Math.min(100, Number(fish.confidence_score || 0))) + '%"></div></div><p class="muted">النشاط: ' + (fish.confidence_score != null ? fish.confidence_score : '—') + '%</p></div>')
      + C.card('خريطة النشاط', '<div class="heatmap-mini" aria-hidden="true"><div class="heatmap-mini__crosshair"></div><div class="heatmap-mini__bars">' + heatBars + '</div></div><p class="muted heatmap-mini__hint">' + heatHint + '</p>')
      + '</div>'
      + '</div>';
  }

  function renderMarineAnalysis(dto) {
    var el = H.byId('pageMarine');
    if (!el) return;
    if (!dto || typeof dto !== 'object') {
      el.innerHTML = noDataCard('تحليل البحر');
      return;
    }
    var env = dto && dto.environment ? dto.environment : {};
    var tide = dto && dto.tide ? dto.tide : {};

    var tide_state_ar = H.formatTideState(tide.state);
    var waveNum = H.formatMarineNumber(env.wave_height_m, 2);
    var waveHtml = waveNum == null ? 'غير متاح' : waveNum + '<span class="muted marine-unit"> م</span>';

    var windNum = H.formatMarineNumber(env.wind_speed_kmh, 1);
    var windHtml = windNum == null ? 'غير متاح' : windNum + '<span class="muted marine-unit"> كم/س</span>';

    var wind_direction_ar = H.formatWindDirection(env.wind_direction_deg);

    var curNum = H.formatMarineNumber(tide.current_speed_ms, 2);
    var currentHtml = curNum == null ? 'غير متاح' : curNum + '<span class="muted marine-unit"> م/ث</span>';

    var tempNum = H.formatMarineNumber(env.water_temp_c, 1);
    var waterHtml = tempNum == null ? 'غير متاح' : tempNum + '<span class="muted marine-unit">°</span>';

    try {
      console.debug('NAVIDUR_MARINE_PAGE_RENDER', {
        tide_state_ar: tide_state_ar,
        wave: waveNum,
        wind_speed: windNum,
        wind_direction_ar: wind_direction_ar,
        current: curNum,
        water_temp: tempNum
      });
    } catch (_e) { /* ignore */ }
    try {
      console.debug('NAVIDUR_TIDE_UI_RENDER', {
        has_series: !!(dto && dto.tide_series),
        source: dto && dto.tide_series ? dto.tide_series.source : undefined,
        timeline_count: dto && dto.tide_series && Array.isArray(dto.tide_series.timeline) ? dto.tide_series.timeline.length : 0,
        extremes_count: dto && dto.tide_series && Array.isArray(dto.tide_series.extremes) ? dto.tide_series.extremes.length : 0
      });
    } catch (_te) { /* ignore */ }

    el.innerHTML = '<div class="marine-page">'
      + C.marineIntroCard()
      + '<div class="marine-grid">'
      + C.marineMetricCard('حالة البحر', tide_state_ar)
      + C.marineMetricCard('ارتفاع الموج', waveHtml)
      + C.marineMetricCard('سرعة الرياح', windHtml)
      + C.marineMetricCard('اتجاه الرياح', wind_direction_ar)
      + C.marineMetricCard('التيار', currentHtml)
      + C.marineMetricCard('حرارة الماء', waterHtml)
      + '</div>'
      + C.marineTideTimelineSection(dto && dto.tide_series)
      + '</div>';
  }

  function renderFishingRecommendation(dto) {
    var el = H.byId('pageFishing');
    if (!el) return;
    if (!dto || typeof dto !== 'object') {
      el.innerHTML = noDataCard('توصية الصيد');
      return;
    }
    var fish = dto && dto.fishing ? dto.fishing : {};
    var species = (fish.species_activity || []).slice(0, 3);
    el.innerHTML = C.card('التوصية المختصرة', '<p>' + (fish.advice_text || 'لا توجد توصية حالياً') + '</p>')
      + C.card('أفضل وقت', '<p class="muted">من 05:30 صباحاً إلى 09:30 صباحاً (مثال تشغيلي)</p>')
      + C.card('نوع النشاط', '<p>' + ((dto && dto.dur && dto.dur.depth_mode) || 'ساحلي') + '</p>')
      + C.card('الأنواع المتوقعة', species.length ? species.map(function (s) { return C.fishRow(s, 'ملاءمة الظروف'); }).join('') : '<p class="muted">لا توجد أنواع الآن</p>');
  }

  function pointScore(p) {
    if (!p || typeof p !== 'object') return null;
    var n = Number(p.score);
    return Number.isFinite(n) ? n : null;
  }

  function renderMap(dto, state) {
    var el = H.byId('pageMap');
    if (!el) return;
    if (!dto || typeof dto !== 'object') {
      el.innerHTML = noDataCard('الخريطة / Heatmap');
      return;
    }
    var stations = state && Array.isArray(state.stations) ? state.stations : [];
    var st = state && state.selectedStation ? state.selectedStation : null;
    if ((!st || !Number.isFinite(Number(st.lat)) || !Number.isFinite(Number(st.lon))) && dto && dto.station_id) {
      st = stations.find(function (x) { return x && x.id === dto.station_id; }) || st;
    }
    var userLoc = state && state.userLocation ? state.userLocation : null;
    var lat = st && Number.isFinite(Number(st.lat)) ? Number(st.lat) : (userLoc && Number.isFinite(Number(userLoc.lat)) ? Number(userLoc.lat) : null);
    var lon = st && Number.isFinite(Number(st.lon)) ? Number(st.lon) : (userLoc && Number.isFinite(Number(userLoc.lon)) ? Number(userLoc.lon) : null);
    var stationName = st && (st.name_ar || st.name) ? (st.name_ar || st.name) : (dto && dto.station_id ? dto.station_id : '—');
    if (lat == null || lon == null) {
      el.innerHTML = C.card('الخريطة', '<p class="muted">لا توجد إحداثيات لهذه المحطة</p>');
      return;
    }
    var mapContainerId = 'navidurLeafletMap';
    el.innerHTML = C.card('الخريطة',
      '<p class="muted">المحطة الحالية: ' + stationName + '</p>'
      + '<p class="muted">الموقع: ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + '</p>'
      + '<div id="' + mapContainerId + '" style="width:100%;height:320px;border-radius:12px;overflow:hidden;"></div>'
      + '<p class="muted" id="mapSummaryText">جارٍ تحميل طبقات الخريطة...</p>');

    if (typeof L === 'undefined') {
      H.byId('mapSummaryText').textContent = 'تعذر تحميل مكتبة الخريطة';
      return;
    }

    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    mapStationLayer = null;
    mapHeatLayer = null;
    mapHotspotMarker = null;

    mapInstance = L.map(mapContainerId, { zoomControl: true }).setView([lat, lon], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapInstance);

    mapStationLayer = L.layerGroup().addTo(mapInstance);
    stations.forEach(function (s) {
      if (!s || !Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lon))) return;
      var title = s.name_ar || s.name || s.id || '—';
      L.circleMarker([Number(s.lat), Number(s.lon)], {
        radius: s.id === (st && st.id) ? 7 : 4,
        color: s.id === (st && st.id) ? '#22d3ee' : '#8fb8d8',
        weight: 1,
        fillOpacity: 0.85
      }).bindPopup(title).addTo(mapStationLayer);
    });

    var evaluated = Array.isArray(dto.evaluated_points) ? dto.evaluated_points : [];
    var heatTriplets = [];
    evaluated.forEach(function (p) {
      var pla = Number(p && p.lat);
      var plo = Number(p && (p.lon != null ? p.lon : p.lng));
      var score = pointScore(p);
      if (!Number.isFinite(pla) || !Number.isFinite(plo) || !Number.isFinite(score)) return;
      var intensity = Math.max(0.1, Math.min(1, score / 100));
      heatTriplets.push([pla, plo, intensity]);
    });
    if (heatTriplets.length && typeof L.heatLayer === 'function') {
      mapHeatLayer = L.heatLayer(heatTriplets, {
        radius: 22,
        blur: 18,
        maxZoom: 11,
        minOpacity: 0.25
      }).addTo(mapInstance);
    }

    var best = null;
    evaluated.forEach(function (p) {
      var score = pointScore(p);
      var pla = Number(p && p.lat);
      var plo = Number(p && (p.lon != null ? p.lon : p.lng));
      if (!Number.isFinite(score) || !Number.isFinite(pla) || !Number.isFinite(plo)) return;
      if (!best || score > best.score) best = { lat: pla, lon: plo, score: score };
    });
    if (best) {
      mapHotspotMarker = L.marker([best.lat, best.lon]).addTo(mapInstance);
      mapHotspotMarker.bindPopup('أفضل نقطة صيد: ' + best.score.toFixed(0) + '%');
    }

    var summary = H.byId('mapSummaryText');
    if (summary) {
      summary.textContent = 'محطات: ' + stations.length + ' | نقاط الحرارة: ' + heatTriplets.length + (best ? (' | أفضل نقطة: ' + best.score.toFixed(0) + '%') : '');
    }
    setTimeout(function () {
      if (mapInstance) mapInstance.invalidateSize();
    }, 0);
  }

  function renderLocationModal(state) {
    var modal = H.byId('locationModal');
    if (!modal) return;
    modal.classList.toggle('hidden', !!state.locationPromptDismissed || !!state.userLocation);
  }

  root.NavidurUI = {
    renderDashboard: renderDashboard,
    renderMarineAnalysis: renderMarineAnalysis,
    renderFishingRecommendation: renderFishingRecommendation,
    renderMap: renderMap,
    renderLocationModal: renderLocationModal
  };
})(window);
