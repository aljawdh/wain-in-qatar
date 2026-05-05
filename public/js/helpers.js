(function (root) {
  function byId(id) {
    return document.getElementById(id);
  }

  function toNumber(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function decideBadgeClass(isRecommended, confidence) {
    if (!isRecommended) return 'badge-bad';
    if (toNumber(confidence, 0) >= 70) return 'badge-good';
    return 'badge-caution';
  }

  function formatDirection(deg) {
    if (deg == null) return '—';
    var d = toNumber(deg, null);
    if (d == null) return '—';
    var dirs = ['ش', 'ش.ش.ق', 'ش.ق', 'ق.ش.ق', 'ق', 'ق.ج.ق', 'ج.ق', 'ج.ج.ق', 'ج', 'ج.ج.غ', 'ج.غ', 'غ.ج.غ', 'غ', 'غ.ش.غ', 'ش.غ', 'ش.ش.غ'];
    return dirs[Math.round(d / 22.5) % 16];
  }

  function formatTideState(value) {
    if (value == null || value === '') return 'غير متاح';
    var raw = String(value).trim();
    if (raw === '') return 'غير متاح';
    var s = raw.toUpperCase();
    if (s === 'NAN' || s === 'NULL' || s === 'UNDEFINED' || s === 'UNKNOWN') return 'غير متاح';
    if (s === 'FASAD') return 'فساد';
    if (s === 'LOAD' || s === 'HAMAL') return 'حمل';
    if (raw === 'فساد' || raw === 'حمل') return raw;
    return 'غير متاح';
  }

  function windDirNameFromDeg(n) {
    var d = ((n % 360) + 360) % 360;
    var names = ['شمال', 'شمال شرقي', 'شرق', 'جنوب شرقي', 'جنوب', 'جنوب غربي', 'غرب', 'شمال غربي'];
    return names[Math.round(d / 45) % 8];
  }

  function formatWindDirection(degOrText) {
    if (degOrText == null || degOrText === '') return 'غير متاح';
    var bad = String(degOrText).trim().toUpperCase();
    if (bad === 'NAN' || bad === 'NULL' || bad === 'UNKNOWN' || bad === 'UNDEFINED') return 'غير متاح';

    if (typeof degOrText === 'number' && Number.isFinite(degOrText)) {
      var d0 = ((degOrText % 360) + 360) % 360;
      return windDirNameFromDeg(d0) + ' ' + Math.round(d0) + '°';
    }

    var str = String(degOrText).trim();
    if (str === '') return 'غير متاح';
    var cleaned = str.replace(/°/g, '').trim().replace(',', '.');
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      var n = Number(cleaned);
      if (Number.isFinite(n)) {
        var d = ((n % 360) + 360) % 360;
        return windDirNameFromDeg(d) + ' ' + Math.round(d) + '°';
      }
    }

    var enMap = {
      N: 'شمال',
      NE: 'شمال شرقي',
      E: 'شرق',
      SE: 'جنوب شرقي',
      S: 'جنوب',
      SW: 'جنوب غربي',
      W: 'غرب',
      NW: 'شمال غربي'
    };
    var letters = str.replace(/[^nsewNEWS]/gi, '').toUpperCase();
    if (letters && enMap[letters]) return enMap[letters];
    return 'غير متاح';
  }

  function formatMarineNumber(value, maxDecimals) {
    if (value == null || value === '') return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    var d = maxDecimals == null ? 1 : maxDecimals;
    return Number(n.toFixed(d)).toString();
  }

  root.NavidurHelpers = {
    byId: byId,
    toNumber: toNumber,
    decideBadgeClass: decideBadgeClass,
    formatDirection: formatDirection,
    formatTideState: formatTideState,
    formatWindDirection: formatWindDirection,
    formatMarineNumber: formatMarineNumber
  };
})(window);
