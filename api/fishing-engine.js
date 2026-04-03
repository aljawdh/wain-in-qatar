let APP_TIMEZONE = 'Asia/Riyadh';
let HIJRI_OFFSET = -1;

const DORAH_RING_CODES = Array.from({length: 36}, (_, index) => (index + 1) * 10);
const MARITIME_DORAH_ANCHOR = {month: 4, day: 2, dorahNumber: 230};
const maritimeLookupCache = new Map();
const MARITIME_CHART_BLOCKS = [
  {name:'الصفري', season:'الخريف', sm:9, sd:15, em:10, ed:14, fa:'جيد', metWarning:'التغير الخريفي ونشاط رياح الإكذيب قد يبدلان البحر بسرعة.', coastalTargets:['السبيطي','الصافي','الشعم'], deepTargets:['الهامور','الشعري','النقرور'], coastalBias:76, deepBias:68},
  {name:'الوسمي', season:'الخريف', sm:10, sd:15, em:11, ed:14, fa:'ممتاز', metWarning:'أمطار الوسمي الخفيفة قد تقلل الرؤية مع تبدل الرياح.', coastalTargets:['السبيطي','الشعم','الصافي'], deepTargets:['الهامور','الشعري','الحمرا'], coastalBias:88, deepBias:78},
  {name:'الكهلة', season:'الشتاء', sm:11, sd:15, em:12, ed:14, fa:'متوسط', metWarning:'بارح الشمال وارد ويؤثر مباشرة على الرحلات المفتوحة.', coastalTargets:['السبيطي','الشعري','الشعم'], deepTargets:['الهامور','النقرور','الحمرا'], coastalBias:58, deepBias:46},
  {name:'كلة الشتاء', season:'الشتاء', sm:12, sd:15, em:1, ed:14, fa:'ضعيف', metWarning:'أمطار وبرد شديدان. الأولوية للسلامة وتأجيل الغزير.', coastalTargets:['سبيطي','شعري'], deepTargets:['الهامور','النقرور'], coastalBias:40, deepBias:24},
  {name:'المربعانية', season:'الشتاء', sm:1, sd:15, em:2, ed:23, fa:'ضعيف', metWarning:'ذروة البرد والرياح الشمالية. الغزير شديد الحساسية هنا.', coastalTargets:['سبيطي','شعري'], deepTargets:['الهامور','النقرور'], coastalBias:34, deepBias:20},
  {name:'الشبط', season:'الشتاء', sm:2, sd:24, em:3, ed:17, fa:'متوسط', metWarning:'برد العيابر قد يأتي فجأة رغم هدوء أول اليوم.', coastalTargets:['السبيطي','الشعم','الشعري'], deepTargets:['الهامور','النقرور','البالول'], coastalBias:62, deepBias:54},
  {name:'العقارب', season:'الربيع', sm:3, sd:18, em:4, ed:1, fa:'متوسط', metWarning:'ضربة الأحيمر محتملة. البحر قد ينقلب بسرعة خلال ساعات.', coastalTargets:['الشعم','الصافي','الشعري'], deepTargets:['الهامور','النقرور','البالول'], coastalBias:64, deepBias:52},
  {name:'الحميم', season:'الربيع', sm:4, sd:2, em:4, ed:24, fa:'ممتاز', metWarning:'الحميم مستقر غالبًا، لكن راقب تحولات ما بعد الظهر الربيعية.', coastalTargets:['السبيطي','شعم أزرق','الفسكر','القين','الربيب'], deepTargets:['الشعري','الهامور','السكن','الجش','الصافي'], coastalBias:92, deepBias:90},
  {name:'الكنة', season:'الربيع', sm:4, sd:25, em:5, ed:25, fa:'جيد', metWarning:'بداية الكنة: تظهر قباب/صدة تدريجيًا مع تحول توزيع الأسماك.', coastalTargets:['ضلعة','حاقول','بدح','قباب'], deepTargets:['جش','هامور','شعري','صافي'], coastalBias:78, deepBias:74},
  {name:'السرايات', season:'الصيف', sm:5, sd:26, em:6, ed:11, fa:'جيد', metWarning:'السرايات ترفع الرطوبة وقد تفرض صيدًا باكرًا أو ليليًا.', coastalTargets:['الصافي','الشعم','السيجان'], deepTargets:['الكنعد','الهامور','الباراكودا'], coastalBias:66, deepBias:74},
  {name:'شدة القيظ', season:'الصيف', sm:6, sd:12, em:8, ed:22, fa:'ضعيف', metWarning:'القيظ الشديد والبحر الحار يرفعان الإجهاد ويخفضان أمان الغزير.', coastalTargets:['الصافي','السيجان'], deepTargets:['الكنعد','الباراكودا','الهامور'], coastalBias:38, deepBias:42},
  {name:'هبابس سهيل', season:'الخريف', sm:8, sd:23, em:9, ed:14, fa:'جيد', metWarning:'هبابس سهيل قد تشتد فجأة وتؤثر على القوارب المفتوحة.', coastalTargets:['الشعري','الصافي','السبيطي'], deepTargets:['الهامور','الشعري','الكنعد'], coastalBias:72, deepBias:64}
];

function normalizeArabicDigits(value) {
  return String(value || '').replace(/[٠-٩]/g, function(d) {
    return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  });
}

function getDateParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(date instanceof Date ? date : new Date(date || Date.now()));
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return {year: +map.year, month: +map.month, day: +map.day};
}

function wrapRingIndex(value, size) {
  const n = value % size;
  return n < 0 ? n + size : n;
}

function totalDays(year) {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

function dayOfYearFromParts(year, month, day) {
  const start = Date.UTC(year, 0, 1, 12, 0, 0);
  const current = Date.UTC(year, month - 1, day, 12, 0, 0);
  return Math.floor((current - start) / 86400000) + 1;
}

function matchesMonthDayRange(month, day, range) {
  const value = month * 100 + day;
  const start = range.sm * 100 + range.sd;
  const end = range.em * 100 + range.ed;
  if (start <= end) return value >= start && value <= end;
  return value >= start || value <= end;
}

function getMaritimeChartBlock(date) {
  const parts = getDateParts(date);
  for (let i = 0; i < MARITIME_CHART_BLOCKS.length; i++) {
    if (matchesMonthDayRange(parts.month, parts.day, MARITIME_CHART_BLOCKS[i])) {
      return MARITIME_CHART_BLOCKS[i];
    }
  }
  return MARITIME_CHART_BLOCKS[0];
}

function buildAnnualMaritimeLookup(year) {
  if (maritimeLookupCache.has(year)) return maritimeLookupCache.get(year);
  const total = totalDays(year);
  const anchorDoy = dayOfYearFromParts(year, MARITIME_DORAH_ANCHOR.month, MARITIME_DORAH_ANCHOR.day);
  let anchorIndex = DORAH_RING_CODES.indexOf(MARITIME_DORAH_ANCHOR.dorahNumber);
  if (anchorIndex < 0) anchorIndex = 0;
  const lookup = [];
  for (let doy = 1; doy <= total; doy++) {
    const utcDate = new Date(Date.UTC(year, 0, doy, 12, 0, 0));
    const parts = getDateParts(utcDate);
    const block = getMaritimeChartBlock(utcDate);
    const slotOffset = Math.floor((doy - anchorDoy) / 10);
    const dorahNumber = DORAH_RING_CODES[wrapRingIndex(anchorIndex + slotOffset, DORAH_RING_CODES.length)];
    lookup.push({
      key: String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0'),
      year: year,
      month: parts.month,
      day: parts.day,
      dayOfYear: doy,
      dorahNumber: dorahNumber,
      seasonName: block.name,
      season: block.season,
      fa: block.fa,
      metWarning: block.metWarning,
      coastalTargets: block.coastalTargets,
      deepTargets: block.deepTargets,
      coastalBias: block.coastalBias,
      deepBias: block.deepBias
    });
  }
  maritimeLookupCache.set(year, lookup);
  return lookup;
}

function getMaritimeLookupEntry(date) {
  const parts = getDateParts(date);
  const lookup = buildAnnualMaritimeLookup(parts.year);
  const dayIndex = dayOfYearFromParts(parts.year, parts.month, parts.day) - 1;
  return lookup[Math.max(0, Math.min(lookup.length - 1, dayIndex))];
}

function daysToNextBlock(date, activeEntry) {
  const parts = getDateParts(date);
  const activeIndex = MARITIME_CHART_BLOCKS.findIndex((block) => block.name === activeEntry.seasonName);
  const next = MARITIME_CHART_BLOCKS[(activeIndex + 1) % MARITIME_CHART_BLOCKS.length];
  const today = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let nextStart = Date.UTC(parts.year, next.sm - 1, next.sd, 0, 0, 0);
  if (nextStart <= today) nextStart = Date.UTC(parts.year + 1, next.sm - 1, next.sd, 0, 0, 0);
  return {
    days: Math.ceil((nextStart - today) / 86400000),
    nextName: next.name
  };
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getHijriInfo(date) {
  const adjustedDate = addDays(date, HIJRI_OFFSET);
  const parts = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: APP_TIMEZONE
  }).formatToParts(adjustedDate);

  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return {
    day: parseInt(normalizeArabicDigits(map.day), 10) || 1,
    monthName: (map.month || '').trim(),
    year: parseInt(normalizeArabicDigits(map.year), 10) || 1
  };
}

function getLunarByHijriDay(day) {
  const d = ((day - 1) % 30 + 30) % 30 + 1;
  if (d === 14 || d === 15) return {name:'بدر', icon:'🌕', phase:4};
  if (d >= 12 && d <= 13) return {name:'أحدب متزايد', icon:'🌔', phase:3};
  if (d >= 16 && d <= 18) return {name:'أحدب متناقص', icon:'🌖', phase:5};
  if (d >= 9 && d <= 11) return {name:'تربيع أول', icon:'🌓', phase:2};
  if (d >= 19 && d <= 22) return {name:'تربيع ثاني', icon:'🌗', phase:6};
  if (d >= 5 && d <= 8) return {name:'هلال أول', icon:'🌒', phase:1};
  if (d >= 23 && d <= 27) return {name:'هلال آخر', icon:'🌘', phase:7};
  return {name:'محاق', icon:'🌑', phase:0};
}

function getTideState(hijriDay) {
  const isHamal = (hijriDay >= 13 && hijriDay <= 16) || hijriDay >= 28 || hijriDay <= 2;
  if (isHamal) {
    return {
      state:'حمل', icon:'✅', css:'hamal', rec:'الغزير والأعماق',
      advice:'🌊 الماية قوية، الحداق في الغزير/الأعماق أفضل — السمك ينشط مع المد الكبير.'
    };
  }
  return {
    state:'فساد', icon:'⚠️', css:'fasad', rec:'الرق والأسياف',
    advice:'🏖️ الماية وقافة، الحداق في الرق/الأسياف أفضل — السمك يتجمع قرب الساحل.'
  };
}

function fishScoreBySeasonLabel(lbl) {
  return {'ممتاز':75,'جيد':58,'متوسط':44,'ضعيف':30}[lbl] || 40;
}

function canonicalFishName(name) {
  return String(name || '').replace(/\s+/g, '').replace(/^ال/, '').trim();
}

const FISH_NAME_ALIASES = {
  'شعمأزرق': ['شعم أزرق', 'الشعم', 'شعم'],
  'سكن': ['السكن', 'سكن', 'سكنة'],
  'قين': ['القين', 'قين'],
  'ربيب': ['الربيب', 'ربيب'],
  'جش': ['الجش', 'جش'],
  'صافي': ['الصافي', 'صافي'],
  'فاسكر': ['الفسكر', 'فسكر'],
  'بدح': ['البدح', 'بدح'],
  'عيفة': ['العيفة', 'عيفة'],
  'حاقول': ['الحاقول', 'حاقول'],
  'ضلعة': ['الضلعة', 'ضلعة'],
  'قباب': ['القباب', 'قباب'],
  'صدة': ['الصدة', 'صدة']
};

function getNameAliases(name) {
  const key = canonicalFishName(name);
  return FISH_NAME_ALIASES[key] || [name];
}

function isNameMatch(candidateName, targetName) {
  const c = canonicalFishName(candidateName);
  const aliases = getNameAliases(targetName).map(canonicalFishName);
  return aliases.includes(c);
}

function stationInNorthWestGulf(lat, lng) {
  if (lat == null || lng == null) return false;
  return lat >= 28.5 && lat <= 31.8 && lng >= 46.0 && lng <= 49.8;
}

function shouldExcludeFishByRegion(fish, lat, lng) {
  const name = canonicalFishName(fish.name);
  if (name === canonicalFishName('الزبيدي') || name === canonicalFishName('زبيدي')) {
    return !stationInNorthWestGulf(lat, lng);
  }
  return false;
}

function getGeoRegionalFocus(lat, lng, marineRegion) {
  if (marineRegion === 'red_sea') return ['ناجل','طرادي','حريد'];
  if (marineRegion === 'oman_sea' || marineRegion === 'arabian_sea') return ['جيذر','سهوة','عيفة'];
  if (stationInNorthWestGulf(lat, lng)) return ['زبيدي','صافي','شعري','هامور'];
  if (lat >= 23 && lat <= 26.8 && lng >= 51 && lng <= 56.8) return ['صافي','شعري','هامور','كنعد'];
  return [];
}

function createVirtualFish(name, strategy, season) {
  const deepLike = strategy === 'deep';
  return {
    name: name,
    icon: deepLike ? '🐟' : '🐠',
    type: deepLike ? 'bottom' : 'surface',
    locations: deepLike ? ['deep','reef'] : ['coast','reef'],
    methods: [deepLike ? 'حداق غزير' : 'حداق ساحلي'],
    method: deepLike ? 'حداق غزير' : 'حداق ساحلي',
    bait: deepLike ? 'ييم حي، خثاق' : 'ربيان، خثاق',
    act: season === 'الربيع' ? 'ممتاز' : 'جيد',
    regions: ['gulf']
  };
}

function seededJitter(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function getFishShuffleSeed(fishName, strategy, date) {
  const p = getDateParts(date);
  const s = String(fishName || '') + '|' + String(strategy || '') + '|' + p.year + '-' + p.month + '-' + p.day;
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash) + s.charCodeAt(i);
  return Math.abs(hash);
}

function isCoastalFish(fish) {
  const locs = fish.locations || [];
  return locs.includes('coast') || locs.includes('reef');
}

function isDeepSeaFish(fish) {
  const locs = fish.locations || [];
  return locs.includes('deep') || (fish.type || '') === 'surface';
}

function getCoastalTideScore(tideLevel, tideTrend) {
  if (tideLevel == null) return tideTrend === 'rising' ? 78 : 60;
  let base = tideLevel >= 0.6 ? 88 : (tideLevel >= 0.4 ? 72 : (tideLevel >= 0.25 ? 58 : 38));
  if (tideTrend === 'rising') base += 10;
  if (tideTrend === 'steady') base += 4;
  if (tideTrend === 'falling') base -= 8;
  return Math.max(10, Math.min(100, base));
}

function getCoastalWindScore(wind) {
  if (wind == null) return 72;
  if (wind <= 4) return 92;
  if (wind <= 7) return 82;
  if (wind <= 10) return 68;
  if (wind <= 13) return 52;
  return 28;
}

function getDeepSafetyScore(wind, waveHeight) {
  const wave = waveHeight == null ? 0.8 : waveHeight;
  if (wind == null) return wave <= 0.9 ? 78 : 62;
  if (wind <= 5 && wave <= 0.8) return 92;
  if (wind <= 8 && wave <= 1.1) return 82;
  if (wind <= 11 && wave <= 1.4) return 68;
  if (wind <= 14 && wave <= 1.8) return 46;
  return 20;
}

function getCurrentStrengthScore(tideState) {
  return tideState && tideState.css === 'hamal' ? 88 : 44;
}

function getStrategyBestTime(strategy, score) {
  if (strategy === 'deep') {
    return score >= 75 ? 'الفجر قبل اشتداد البحر' : (score >= 45 ? 'الصباح المبكر' : 'انتظر نافذة هدوء مؤكدة');
  }
  return score >= 75 ? 'المد الصاعد مع الفجر' : (score >= 45 ? 'الفجر والغروب' : 'فترة مد قصيرة قرب الساحل');
}

function normalizeFishCandidate(raw, season) {
  const activityMap = raw.seasonal_activity || raw.activity || {};
  const bait = Array.isArray(raw.bait) ? raw.bait.join('، ') : (raw.bait || 'ييم');
  const methods = raw.methods || (raw.method ? [raw.method] : ['حداق']);
  return {
    name: raw.name || '—',
    icon: raw.icon || '🐟',
    type: raw.type || 'bottom',
    act: activityMap[season] || raw.act || 'متوسط',
    methods: methods,
    method: raw.method || methods[0] || 'حداق',
    bait: bait,
    hook: raw.hook || (raw.gear && raw.gear.hook) || '—',
    leader: raw.leader || (raw.gear && raw.gear.leader) || '—',
    mainLine: raw.mainLine || (raw.gear && raw.gear.mainLine) || '—',
    locations: raw.locations || ['deep'],
    locationText: raw.locationText || raw.habitat || 'قوعي',
    floor: raw.floor || '—',
    seasons: raw.seasons || [],
    regions: raw.regions || [],
    subregions: raw.subregions || [],
    spawning: raw.spawning || 'حسب المنطقة',
    nokhadaTip: raw.nokhadaTip || 'غيّر الطعم مع تغيّر الماية.'
  };
}

function scoreFishCandidate(fish, context, strategy) {
  const targetNames = strategy === 'deep' ? (context.entry.deepTargets || []) : (context.entry.coastalTargets || []);
  const seasonal = fishScoreBySeasonLabel(fish.act || 'متوسط');
  const targetBonus = targetNames.some((name) => isNameMatch(fish.name, name)) ? 20 : 0;
  const regionBonus = (context.regionalFocus || []).some((name) => isNameMatch(fish.name, name)) ? 12 : 0;
  const nwZubaidiBonus = stationInNorthWestGulf(context.stationLat, context.stationLng) && isNameMatch(fish.name, 'زبيدي') ? 16 : 0;
  const strategyBonus = strategy === 'deep' ? (isDeepSeaFish(fish) ? 12 : -6) : (isCoastalFish(fish) ? 12 : -6);
  const envBonus = strategy === 'deep'
    ? (getDeepSafetyScore(context.weather.wind, context.weather.waveHeight) * 0.22) + (context.tide.css === 'hamal' ? 12 : 4)
    : (getCoastalTideScore(context.weather.tide, context.weather.tideTrend) * 0.2) + (context.weather.wind != null && context.weather.wind <= 10 ? 8 : 3);
  const baseTotal = Math.max(1, Math.min(100, Math.round((seasonal * 0.45) + targetBonus + regionBonus + nwZubaidiBonus + strategyBonus + envBonus)));
  const jitter = Math.round(seededJitter(getFishShuffleSeed(fish.name, strategy, context.date)) * 6) - 3;
  const total = Math.max(1, Math.min(100, baseTotal + jitter));
  return {
    ...fish,
    todayScore: total,
    todayLevel: total >= 75 ? 'عالي' : (total >= 45 ? 'متوسط' : 'منخفض'),
    bestTime: getStrategyBestTime(strategy, total)
  };
}

function buildResponse(payload) {
  APP_TIMEZONE = String((payload && payload.timeZone) || 'Asia/Riyadh');
  HIJRI_OFFSET = typeof (payload && payload.hijriOffset) === 'number'
    ? Math.round(Math.max(-5, Math.min(5, payload.hijriOffset)))
    : -1;

  const strategy = payload && payload.strategy === 'deep' ? 'deep' : 'coastal';
  const stationLat = payload && typeof payload.lat === 'number' ? payload.lat : null;
  const stationLng = payload && typeof payload.lng === 'number' ? payload.lng : null;
  const marineRegion = payload && payload.weather && payload.weather.region ? payload.weather.region : 'gulf';
  const date = payload && payload.date ? new Date(payload.date) : new Date();
  const entry = getMaritimeLookupEntry(date);
  const countdown = daysToNextBlock(date, entry);
  const hijri = getHijriInfo(date);
  const lunar = getLunarByHijriDay(hijri.day);
  const tide = getTideState(hijri.day);
  const weather = {
    wind: payload && payload.weather ? +payload.weather.wind : null,
    temp: payload && payload.weather ? +payload.weather.temp : null,
    tide: payload && payload.weather ? +payload.weather.tide : null,
    tideTrend: payload && payload.weather ? String(payload.weather.tideTrend || 'steady') : 'steady',
    waveHeight: payload && payload.weather && payload.weather.waveHeight != null ? +payload.weather.waveHeight : null
  };

  const incomingFish = Array.isArray(payload && payload.fishCandidates) ? payload.fishCandidates : [];
  const normalized = incomingFish.map((fish) => normalizeFishCandidate(fish, entry.season)).filter((fish) => !shouldExcludeFishByRegion(fish, stationLat, stationLng));
  const regionalFocus = getGeoRegionalFocus(stationLat, stationLng, marineRegion);
  const targetNames = strategy === 'deep' ? (entry.deepTargets || []) : (entry.coastalTargets || []);
  const augmented = normalized.slice();
  targetNames.concat(regionalFocus).forEach((target) => {
    const found = augmented.some((fish) => isNameMatch(fish.name, target));
    if (!found) augmented.push(createVirtualFish(target, strategy, entry.season));
  });
  const filtered = augmented.filter((fish) => strategy === 'deep' ? isDeepSeaFish(fish) : isCoastalFish(fish));
  const context = {entry, tide, weather, date, regionalFocus, stationLat, stationLng};
  const recommendations = filtered.map((fish) => scoreFishCandidate(fish, context, strategy)).sort((a, b) => {
    const diff = b.todayScore - a.todayScore;
    if (Math.abs(diff) > 5) return diff;
    return seededJitter(getFishShuffleSeed(a.name, strategy, date)) - seededJitter(getFishShuffleSeed(b.name, strategy, date));
  }).slice(0, 8);

  const seasonScore = strategy === 'deep' ? entry.deepBias : entry.coastalBias;
  let total = strategy === 'deep'
    ? Math.round((getDeepSafetyScore(weather.wind, weather.waveHeight) * 0.5) + (getCurrentStrengthScore(tide) * 0.3) + (seasonScore * 0.2))
    : Math.round((getCoastalTideScore(weather.tide, weather.tideTrend) * 0.5) + (seasonScore * 0.3) + (getCoastalWindScore(weather.wind) * 0.2));
  if (recommendations.length) {
    total = Math.round((total * 0.72) + (recommendations.reduce((sum, fish) => sum + fish.todayScore, 0) / recommendations.length * 0.28));
  }
  total = Math.max(1, Math.min(100, total));

  return {
    hijri,
    lunar,
    tide,
    maritime: entry,
    dorah: {
      name: entry.seasonName,
      season: entry.season,
      fa: entry.fa,
      dorahIndex: entry.dorahNumber,
      countdown,
      metWarning: entry.metWarning
    },
    decision: {
      score: total,
      status: total >= 75 ? 'ممتاز' : (total >= 45 ? 'جيد' : 'ضعيف'),
      recommendation: strategy === 'deep'
        ? (total >= 75 ? 'الغزير مناسب اليوم مع فحص السلامة قبل الخروج.' : (total >= 45 ? 'الغزير ممكن لكن ضمن نافذة بحر أهدأ.' : 'الغزير اليوم ليس آمنًا بما يكفي، فضّل الساحل أو التأجيل.'))
        : (total >= 75 ? 'السيف ممتاز اليوم مع التركيز على المد الصاعد.' : (total >= 45 ? 'الساحل ممكن مع اختيار رق أو صخور نشطة.' : 'الساحل ضعيف اليوم، جرّب نافذة مد قصيرة فقط.')),
      smart: recommendations[0]
        ? ('في ' + entry.seasonName + ' ركّز ' + (strategy === 'deep' ? 'في الغزير' : 'على السيف') + ' على ' + recommendations[0].name + ' باستخدام ' + recommendations[0].method + ' وطعم ' + String(recommendations[0].bait).split('،')[0])
        : (strategy === 'deep' ? 'الغزير اليوم يحتاج نافذة سلامة أوضح قبل التحرك.' : 'الساحل اليوم أفضل للمراقبة وتجربة مد قصير.'),
      bestTime: getStrategyBestTime(strategy, total),
      warning: entry.metWarning,
      strategy,
      strategyLabel: strategy === 'deep' ? 'داخل البحر - غزير' : 'صيد السيف - ساحلي',
      dorahCode: entry.dorahNumber,
      seasonName: entry.seasonName
    },
    bestFish: recommendations[0] ? recommendations[0].name : '—',
    recommendations
  };
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  const allowed = ['https://navidur.app', 'https://www.navidur.app'];
  const okOrigin = allowed.some((d) => origin.startsWith(d));
  const okReferer = allowed.some((d) => referer.startsWith(d));
  return okOrigin || okReferer;
}

module.exports = async function handler(req, res) {
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({error: 'Forbidden domain'});
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const result = buildResponse(payload);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({error: 'Engine failure'});
  }
};
