/**
 * Public NAVIDUR: single source for "نصيحة اليوم" (UI only; reads analysis DTO fields).
 * @param {object} env
 * @param {number} [env.wave_height_m]
 * @param {number} [env.wind_speed_kmh]
 * @param {number} [env.current_speed_ms]
 * @param {string} [env.weather_status_ar]
 * @param {object} [env.tide]  e.g. { state: 'LOAD'|'FASAD'|... }
 */
(function (root) {
  'use strict';

  function n(v) {
    var x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function buildEnvFromAnalysisDto(dto) {
    if (!dto) return null;
    var e = dto.environment || {};
    var t = dto.tide || {};
    return {
      wave_height_m: e.wave_height_m,
      wind_speed_kmh: e.wind_speed_kmh,
      current_speed_ms: t.current_speed_ms,
      weather_status_ar: e.weather_status_ar,
      tide: { state: t.state }
    };
  }

  function generateDailyAdvice(env) {
    env = env && typeof env === 'object' ? env : {};
    var wave = n(env.wave_height_m);
    var wind = n(env.wind_speed_kmh);
    var cur = n(env.current_speed_ms);
    var weather = String(env.weather_status_ar == null ? '' : env.weather_status_ar).trim();
    var tide = env.tide && typeof env.tide === 'object' ? env.tide : {};
    var state = tide.state != null ? String(tide.state).toUpperCase() : '';

    if (wave != null && wave > 1.5) {
      return 'الموج مرتفع اليوم، يفضّل اختيار مواقع محمية أو تأجيل النزول.';
    }
    if (wind != null && wind > 25) {
      return 'الرياح نشطة، ركّز على المواقع القريبة والآمنة.';
    }
    var strongTide =
      (cur != null && cur > 0.5) ||
      (state && (state === 'LOAD' || state === 'FASAD') && (cur == null || cur >= 0.25));
    if (strongTide) {
      return 'حركة المد جيدة اليوم، فرص النشاط البحري مرتفعة.';
    }
    var hasAny = wave != null || wind != null || cur != null;
    var calm =
      hasAny &&
      (wave == null || wave <= 0.75) &&
      (wind == null || wind < 18) &&
      (cur == null || cur < 0.4);
    if (calm) {
      return 'الظروف البحرية مستقرة، فرصة مناسبة للنزول.';
    }
    if (weather && /عاصف|شديد|إنذار|تحذير/i.test(weather)) {
      return 'الظروف الجوية تتطلب حذراً إضافياً عند التخطيط للنزول.';
    }
    if (hasAny) {
      return 'الظروف البحرية متوسطة، راقب الموج والرياح عند اختيار الموقع.';
    }
    return 'البيانات الحالية لا تسمح بتقديم نصيحة دقيقة حالياً.';
  }

  var api = { generateDailyAdvice: generateDailyAdvice, buildEnvFromAnalysisDto: buildEnvFromAnalysisDto };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.NavidurDailyAdvice = api;
  root.generateDailyAdvice = generateDailyAdvice;
  root.buildEnvFromAnalysisDto = buildEnvFromAnalysisDto;
})(typeof globalThis !== 'undefined' ? globalThis : this);
