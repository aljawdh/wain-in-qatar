/**
 * NAVIDUR AI Insight Layer — Phase 1.1 (read-only, no learning, no scoring).
 * Analyzes FIELD session rows for display in admin only.
 */
(function (root) {
  'use strict';

  var MS_DAY = 86400000;

  function toArray(x) {
    return Array.isArray(x) ? x : [];
  }

  function norm(s) {
    return String(s == null ? '' : s).trim();
  }

  /**
   * Wilson lower bound (95%) for binomial p = ok/n; reduces small-n bias when ranking.
   */
  function wilsonLower95(ok, n) {
    if (n <= 0) return 0;
    if (ok > n) ok = n;
    var p = ok / n;
    var z = 1.96;
    var zz = z * z;
    var denom = 1 + zz / n;
    var center = p + zz / (2 * n);
    var margin = z * Math.sqrt((p * (1 - p) + zz / (4 * n)) / n);
    return (center - margin) / denom;
  }

  /**
   * @param {object[]} fieldSessions
   * @param {object|null} station — optional { id | station_id }
   * @param {object|null} dateRange — optional { from: ISO, to: ISO }
   */
  function filterFieldSessions(fieldSessions, station, dateRange) {
    var list = toArray(fieldSessions);
    if (station && (station.id != null || station.station_id != null)) {
      var sid = String(station.station_id != null ? station.station_id : station.id);
      list = list.filter(function (s) { return s && String(s.station_id) === sid; });
    }
    if (dateRange && dateRange.from) {
      var from = String(dateRange.from);
      list = list.filter(function (s) {
        var t = (s && (s.analysis_timestamp || s.created_at)) || '';
        return t >= from;
      });
    }
    if (dateRange && dateRange.to) {
      var to = String(dateRange.to);
      list = list.filter(function (s) {
        var t = (s && (s.analysis_timestamp || s.created_at)) || '';
        return t <= to;
      });
    }
    return list;
  }

  function confidenceLabelByAttempts(attempts) {
    if (attempts >= 10) return 'عالٍ';
    if (attempts >= 5) return 'متوسط';
    if (attempts >= 3) return 'محدود';
    return 'ضعيف';
  }

  function smartConfidenceLabel(nSessions) {
    if (nSessions >= 15) return 'قوي';
    if (nSessions >= 8) return 'متوسط';
    if (nSessions >= 3) return 'ضعيف';
    return 'ضعيف';
  }

  /**
   * Best fish: min 3 attempts (per-fish rows in actual_species); rank by Wilson 95% lower bound
   * (counters small-n bias) then by attempts as tie-break; display raw success %.
   */
  function computeBestFish(sessions) {
    var byFish = {};
    toArray(sessions).forEach(function (s) {
      if (!s) return;
      toArray(s.actual_species).forEach(function (fish) {
        var f = norm(fish);
        if (!f) return;
        if (!byFish[f]) byFish[f] = { n: 0, ok: 0 };
        byFish[f].n += 1;
        if (s.catch_success) byFish[f].ok += 1;
      });
    });
    var bestF = null;
    var bestScore = -1;
    var bestN = -1;
    Object.keys(byFish).forEach(function (f) {
      var b = byFish[f];
      if (b.n < 3) return;
      var wlb = wilsonLower95(b.ok, b.n);
      var volW = 0.5 + 0.5 * Math.min(1, b.n / 12);
      var score = wlb * volW;
      if (score > bestScore || (score === bestScore && b.n > bestN)) {
        bestScore = score;
        bestN = b.n;
        bestF = f;
      }
    });
    if (bestF == null) return null;
    var chosen = byFish[bestF];
    var rawRate = chosen.n > 0 ? Math.round((chosen.ok / chosen.n) * 1000) / 10 : 0;
    return {
      type: 'best_fish',
      fish: bestF,
      success_rate: rawRate,
      attempts: chosen.n,
      confidence: confidenceLabelByAttempts(chosen.n)
    };
  }

  function computeWeakestPattern(sessions) {
    var cells = {};
    toArray(sessions).forEach(function (s) {
      if (!s) return;
      var dur = norm(s.dur_name) || '—';
      var water = norm(s.water_state) || '—';
      var actualSet = {};
      toArray(s.actual_species).forEach(function (fish) {
        var a = norm(fish);
        if (a) actualSet[a] = true;
      });
      toArray(s.species_predicted).forEach(function (fish) {
        var f = norm(fish);
        if (!f) return;
        if (actualSet[f]) return;
        var key = f + '\t' + dur + '\t' + water;
        if (!cells[key]) {
          cells[key] = { fish: f, dur: dur, water: water, failures: 0 };
        }
        cells[key].failures += 1;
      });
    });
    var bestKey = null;
    var maxF = 0;
    Object.keys(cells).forEach(function (k) {
      var c = cells[k];
      if (c.failures >= 3 && c.failures > maxF) {
        maxF = c.failures;
        bestKey = k;
      }
    });
    if (bestKey == null) return null;
    var cell = cells[bestKey];
    return {
      type: 'weakest_pattern',
      fish: cell.fish,
      dur: cell.dur,
      water: cell.water,
      failures: cell.failures,
      issue: 'نفس الدرّة/المياه: في «' + cell.dur + '» مع ' + cell.water + ' — وُصي بـ ' + cell.fish + ' ' + cell.failures + ' مرات دون رصد صيد'
    };
  }

  function dominantStringFromSessions(sessions, key) {
    var counts = {};
    toArray(sessions).forEach(function (s) {
      if (!s) return;
      var v = norm(s[key]);
      if (!v) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    var bestK = null;
    var m = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > m) {
        m = counts[k];
        bestK = k;
      }
    });
    return bestK;
  }

  function buildSmartText(bestFishName, dur, water) {
    var parts = [];
    if (bestFishName) parts.push('ركّز على ' + bestFishName);
    if (dur) parts.push('في ' + dur);
    if (water) parts.push('مع ' + water);
    if (!parts.length) return 'استمر بمراقبة جلسات الميدان وتحديث السجلات.';
    return parts.join(' ') + ' — النتائج مرتفعة نسبياً في العينة الحالية';
  }

  function parseSessionTime(s) {
    var t = s && (s.analysis_timestamp || s.created_at);
    if (!t) return null;
    var d = new Date(t);
    if (isNaN(d.getTime())) return null;
    return d.getTime();
  }

  /**
   * last 7 days vs previous 7 days; success = catch_success on session.
   */
  function computeTrend(sessions, nowMs) {
    var now = nowMs != null ? nowMs : (typeof Date !== 'undefined' ? Date.now() : 0);
    var tLastStart = now - 7 * MS_DAY;
    var tPrevStart = now - 14 * MS_DAY;
    var tPrevEnd = tLastStart;
    var lastN = 0;
    var lastOk = 0;
    var prevN = 0;
    var prevOk = 0;
    toArray(sessions).forEach(function (s) {
      if (!s) return;
      var ts = parseSessionTime(s);
      if (ts == null) return;
      var ok = !!s.catch_success;
      if (ts >= tLastStart && ts <= now) {
        lastN += 1;
        if (ok) lastOk += 1;
      } else if (ts >= tPrevStart && ts < tPrevEnd) {
        prevN += 1;
        if (ok) prevOk += 1;
      }
    });
    if (lastN < 1 || prevN < 1) return null;
    var rL = lastOk / lastN;
    var rP = prevOk / prevN;
    var diff = rL - rP;
    if (diff > 0.1 || (diff > 0.05 && rL > rP * 1.2)) return '📈 يتحسن';
    if (diff < -0.1 || (diff < -0.05 && rL < rP * 0.8)) return '📉 يتراجع';
    return '➖ ثابت';
  }

  function generateNavidurInsights(options) {
    var opts = options || {};
    var raw = toArray(opts.fieldSessions);
    var sessions = filterFieldSessions(raw, opts.station || null, opts.dateRange || null);
    var nowMs = opts.now != null && typeof opts.now === 'number' ? opts.now : null;

    if (sessions.length < 3) {
      return {
        best_fish: null,
        weakest_pattern: null,
        smart_recommendation: null,
        trend: null
      };
    }

    var best = computeBestFish(sessions);
    var weak = computeWeakestPattern(sessions);
    var dur = dominantStringFromSessions(sessions, 'dur_name') || '—';
    var water = dominantStringFromSessions(sessions, 'water_state') || '—';
    var bestName = best && best.fish ? best.fish : null;
    var nSess = sessions.length;
    var smartConf = smartConfidenceLabel(nSess);
    var smart = {
      type: 'smart_recommendation',
      text: buildSmartText(bestName, dur !== '—' ? dur : null, water !== '—' ? water : null),
      confidence: smartConf,
      based_on: nSess + ' جلسات'
    };
    var trend = computeTrend(sessions, nowMs);

    return {
      best_fish: best,
      weakest_pattern: weak,
      smart_recommendation: smart,
      trend: trend
    };
  }

  var api = {
    generateNavidurInsights: generateNavidurInsights
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.NavidurAiInsight = api;
})(
  typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
      : this
);
