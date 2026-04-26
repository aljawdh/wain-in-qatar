'use strict';

/**
 * Arabic UI strings for station health report (errors + review notes).
 * Keys match internal error tokens; unknown → generic Arabic.
 */

const LATEST_ERROR_AR = {
  missing_or_invalid_lat_lon: 'إحداثيات غير مكتملة',
  missing_coordinates: 'إحداثيات غير مكتملة',
  missing_reference: 'لا توجد محطة مرجعية مرتبطة',
  operational_missing_reference_link: 'لا توجد محطة مرجعية مرتبطة',
  'operational_missing_reference_link; weather_unavailable':
    'لا توجد محطة مرجعية مرتبطة؛ وتعذّر التحقق من الطقس',
  weather_api_unavailable_or_empty_payload: 'تعذّر جلب بيانات الطقس',
  weather_fetch_failed: 'تعذّر جلب بيانات الطقس',
  timeout: 'انتهت مهلة الاتصال',
  network_error: 'خطأ في الاتصال',
  invalid_response: 'استجابة غير صالحة من المصدر',
  open_meteo_http: 'تعذّر جلب بيانات الطقس',
  empty_weather_marine: 'تعذّر جلب بيانات الطقس'
};

const GENERIC_UNKNOWN_AR = 'خطأ غير معروف';

function latestErrorToAr(raw) {
  if (raw == null || raw === '') return '—';
  const s = String(raw).trim();
  if (!s) return '—';
  if (Object.prototype.hasOwnProperty.call(LATEST_ERROR_AR, s)) {
    return LATEST_ERROR_AR[s];
  }
  const lower = s.toLowerCase();
  if (lower.includes('timeout')) return LATEST_ERROR_AR.timeout;
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch failed')) {
    return LATEST_ERROR_AR.network_error;
  }
  if (lower.includes('invalid') && lower.includes('response')) return LATEST_ERROR_AR.invalid_response;
  if (lower.includes('weather') || lower.includes('open_meteo') || lower.includes('meteo')) {
    return LATEST_ERROR_AR.weather_fetch_failed;
  }
  return GENERIC_UNKNOWN_AR;
}

/**
 * @param {{ data_status?: string, weather_fetch_status?: string, active_status?: string, station_type?: string }} row
 */
function reviewNoteAr(row) {
  const ds = row && row.data_status;
  const ws = row && row.weather_fetch_status;
  const st = row && row.station_type;
  const active = row && row.active_status != null ? String(row.active_status).toLowerCase() : '';

  if (active && active !== 'active') {
    return 'المحطة غير مفعّلة';
  }
  if (ds === 'reference_without_operational_children') {
    return 'محطة مرجعية بلا محطات تشغيلية تابعة';
  }
  if (ds === 'missing_reference' || (st === 'operational' && ds === 'missing_reference')) {
    return 'محطة تشغيلية بلا ربط مرجعي';
  }
  if (ds === 'missing_coordinates') {
    return 'تحتاج إضافة الإحداثيات';
  }
  if (ds === 'failed' || ws === 'failed') {
    return 'تعذّر التحقق من الحالة الجوية';
  }
  return 'يستلزم مراجعة';
}

module.exports = {
  latestErrorToAr,
  reviewNoteAr,
  LATEST_ERROR_AR,
  GENERIC_UNKNOWN_AR
};
