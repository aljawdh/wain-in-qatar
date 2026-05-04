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

  root.NavidurHelpers = {
    byId: byId,
    toNumber: toNumber,
    decideBadgeClass: decideBadgeClass,
    formatDirection: formatDirection
  };
})(window);
