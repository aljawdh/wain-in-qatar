# NAVIDUR v32.0 — التوثيق الفني الشامل

> **المرجع الأكبر للمشروع** — موثّق بالأكواد الفعلية والشرح البرمجي والبحري.  
> آخر تحديث: أبريل 2026

---

## 1. مقدمة المشروع

**NAVIDUR** (ناڤيدر) هو منصة ذكية مفتوحة لتحليل البيانات البحرية، مُصمَّمة خصيصًا للصيادين في **الخليج العربي والبحر الأحمر وبحر عُمان**. يُعالج التطبيق البيانات الخام (مستويات المد، سرعات الرياح، معاملات التيار) ويُحوّلها إلى **نصائح بشرية مفهومة** بلا رموز تقنية مزعجة.

**الفلسفة البرمجية:**
- البيانات تُحسب في الخلفية وتُعرض للمستخدم كنص وصفي فقط.
- لا تظهر قيم `Ds` أو `Es` أو معاملات المد الرقمية في الواجهة مباشرةً.
- كل رقم له ترادف بشري: `≥70 → قوي جداً`، `55-69 → قوي`، `35-54 → معتدل`، `<35 → خفيف`.

---

## 2. الهيكلية العامة للمشروع

المشروع ملف واحد `web/index.html` (~2700 سطر) يجمع ثلاث طبقات:

```
web/index.html
│
├── <style>  ───── طبقة التصميم البحري (CSS)
│                  متغيرات الألوان، تصميم الكاردات، شريط المد، البوصلة
│
├── <body>   ───── طبقة الواجهة (HTML)
│                  Grid الكاردات، البوصلة، شريط التوقعات، قائمة الأسماك
│
└── <script> ───── طبقة المنطق (JavaScript ES6)
                   محرك الدرور، محرك النصائح، محرك الحسابات، APIs الطقس
```

### 2.1 متغيرات CSS البحرية (Design Tokens)

```css
:root {
  --bg:   #071722;  /* خلفية عميقة — لون قاع البحر الليلي */
  --card: #0f2b3d;  /* خلفية الكاردات — أزرق بحري داكن */
  --muted:#86a9bf;  /* النصوص الثانوية — لون الأفق البحري */
  --txt:  #e7f7ff;  /* النص الأساسي — أبيض ثلجي */
  --warn: #ffd57f;  /* التنبيهات — ذهبي شمسي */
  --bad:  #ff8d8d;  /* الخطر — أحمر مرجاني */
}

body {
  background:
    /* تأثير الأفق البحري المضيء في الأعلى */
    radial-gradient(circle at 80% -20%, #174766 0%, transparent 45%),
    /* تدرج عمق البحر */
    linear-gradient(160deg, #071722, #091f30 45%, #0d3045);
}
```

### 2.2 الخطوط المدعومة

```css
font-family: "Tajawal", "Noto Sans Arabic", sans-serif;
/* Tajawal: خط عربي حديث مريح للقراءة في ظروف البحر */
```

---

## 3. محرك الدرور والتقويم البحري التقليدي

### 3.1 مصفوفة الـ 28 دُرَّة

```javascript
const DORAH_28_ORDER = [
  'المقدم',    'المؤخر',   'الرشاء',   'الشرطين',
  'البطين',    'الثريا',   'الدبران',  'الهقعة',
  'الهنعة',    'الذراع',   'النثرة',   'الطرف',
  'الجبهة',    'الزبرة',   'الصرفة',   'العواء',
  'السماك',    'الغفر',    'الزبانا',  'الإكليل',
  'القلب',     'الشولة',   'النعائم',  'البلدة',
  'سعد الذابح','سعد بلع', 'سعد السعود','الأخبية'
];
// 28 دُرَّة × 13 يوم = 364 يوم (دورة قمرية تقريبية)
// كل دُرَّة تمثل 10 أيام في نظام DUROOR_10 المستخدم في التطبيق
```

### 3.2 خوارزمية حساب الدر الحالي

```javascript
function getCurrentDar(date, stationOverride) {
  const now = new Date(date || new Date());

  // 1. احسب تاريخ طلوع سُهيل للمحطة (يتغير حسب خط العرض)
  const sohailSeasonDate = getSohailSeasonDate(now, station);

  // 2. احسب عدد الأيام منذ طلوع سُهيل
  const diffDaysSinceSohail =
    Math.floor((now.getTime() - sohailSeasonDate.getTime()) / 86400000);

  // 3. حوّل إلى يوم في الدورة السنوية 360 يوم
  const alignedDayInCycle = normalizeCycleDay(
    diffDaysSinceSohail - PERPETUAL_PHASE_SHIFT_DAYS + 1
  );

  // 4. استخرج اليوم داخل الدر (1-10) ورقم الدر
  const dayInDar = (alignedDayInCycle - 1) % 10 + 1;
  const darValue = (Math.floor((alignedDayInCycle - 1) / 10) + 1) * 10;
  const daysLeft = 10 - (dayInDar - 1); // الأيام المتبقية في هذا الدر

  // 5. ربط رقم الدر بالاسم التقليدي من DORAH_28_ORDER
  const darTraditionalName = getDarahNameByCanonicalDay(canonicalDarDay);

  return {
    dar: darValue,                          // رقم الدر (10, 20, 30 ... 360)
    darName: 'در الـ ' + darValue + ' - ' + darTraditionalName,
    dayInDar,                               // اليوم داخل الدر (1-10)
    daysLeft,                               // أيام حتى الدر التالي
    seasonName: getSeasonNameByDate(now)    // الموسم الشعبي (العيايز، الكوس...)
  };
}
```

### 3.3 حساب تاريخ طلوع سُهيل بحسب خط العرض

```javascript
// سُهيل هو النجم الذي يُعلن بداية الدورة السنوية للصيادين الخليجيين
// تاريخ طلوعه يتأخر كلما ابتعدنا شمالاً:
// خط عرض 17°–20°  →  3 أغسطس
// خط عرض 21°–24°  →  24 أغسطس
// خط عرض 25°–30°  →  9 سبتمبر
```

---

## 4. محرك الحسابات الخلفي

### 4.1 خوارزمية معامل المد (Tidal Coefficient)

يُحسب في الخلفية ولا يظهر للمستخدم كرقم خام — يُترجَم إلى وصف بشري.

```javascript
function getTidalCoefficient(tideState, prev, cur, next) {
  // prev/cur/next: ارتفاعات المد للساعات المتتالية بالأمتار

  // السعة = الفرق بين الساعة السابقة والتالية × 100 (تحويل لـ cm)
  const amplitudeCm = Math.abs(next - prev) * 100;

  // التسارع = مجموع التغيرات المحلية (يقيس حدة الحركة)
  const acceleration = (Math.abs(cur - prev) + Math.abs(next - cur)) * 100;

  // تعزيز إضافي لموجات السقي (صاعدة) والثبر (هابطة)
  const trendBoost = tideState.key === 'sagi' ? 16
                   : tideState.key === 'thabr' ? 10
                   : 0;

  // المعادلة الأساسية — النتيجة بين 0 و 100
  const coefficient = Math.round(
    (amplitudeCm * 1.25) + (acceleration * 0.8) + trendBoost
  );

  return Math.max(0, Math.min(100, coefficient));
  // ≥70 → قوي جداً (شوربية) | 55-69 → قوي (حمل) | 35-54 → معتدل | <35 → خفيف
}
```

### 4.2 تحديد حالة الماية (حمل / فساد)

```javascript
function getWaterStateFromCoefficient(coef) {
  // العتبة 55: وُجدت بالتجربة على بيانات الخليج العربي
  return coef >= 55 ? 'حمل' : 'فساد';
}

// إذا لم تتوفر بيانات مد حية → الاحتياط بدورة القمر الهجري:
function getHamalFasadStatus(date) {
  const lunarDay = getLunarDay(date); // اليوم الهجري (1-30)
  // حمل: أيام 1-7 و 15-22 (مرتبط بالبدر والهلال — أقوى جاذبية قمرية)
  const hamal = (lunarDay >= 1 && lunarDay <= 7) ||
                (lunarDay >= 15 && lunarDay <= 22);
  return { name: hamal ? 'حمل' : 'فساد', lunarDay };
}
```

### 4.3 مؤشر جودة الصيد FDI (Fishing Decision Index)

يُحسب بهدوء في الخلفية ويُعرض ك `FDI: 74/100` فقط.

```javascript
function computeFDI(date) {
  const hr    = getActiveHours()[selectedHourIndex] || {};
  const ws    = mpsToKmh(hr.windSpeed?.sg ?? 0);   // سرعة الريح بكم/س
  const tide  = getCurrentTideMetrics();             // بيانات المد الحية
  const mode  = getAutomaticModeFromLiveData(date, selectedStation);

  let score = 42;  // قاعدة التسجيل (Baseline)

  // تأثير الرياح على جودة الصيد:
  score += ws > 26 ? 22   // رياح قوية جداً → درجة صعوبة عالية
         : ws > 18 ? 12   // رياح متوسطة → متحكم بها
         : 4;             // رياح خفيفة → مثالي

  // تأثير سعة المد:
  score += tide.amplitude > 0.2  ? 18  // مد قوي → نشاط سمكي عالٍ
         : tide.amplitude > 0.12 ? 10  // مد معتدل
         : 4;                          // مد خفيف

  // تميز الأماكن العميقة (الغزير):
  if (selectedStation.bathymetry === 'deep')    score += 6;
  if (selectedStation.bathymetry === 'shallow') score -= 4;

  // خصم عند سقي قوي في الغزير (يصعّب الوقفة):
  const isSagiStrong = tide.tideState.key === 'sagi' && tide.amplitude >= 0.12;
  if (mode === 'deep' && isSagiStrong) score -= 14;

  return Math.max(0, Math.min(100, Math.round(score)));
}
```

---

## 5. محرك النصائح الذكي الشامل (Holistic Advice Engine)

يُبنى النص من **أربعة أقسام** تُجمّع في دالة `renderNawkhadaBox()`:

### 5.1 مصفوفة مدخلات النصيحة

| المتغير | المصدر البرمجي | الغرض |
|---|---|---|
| `waterState` (حمل/فساد) | `getWaterStateFromCoefficient()` | تحديد النوع العام |
| `tideState.key` (sagi/thabr/steady) | `getTideState(prev, cur, next)` | اتجاه الماية |
| `windSpeedKmh` | `getDisplayedWindKmh(hr)` | قوة الريح |
| `windDirDeg` | `hr.windDirection.sg` | اتجاه الريح |
| `waveH` | `hr.waveHeight` | ارتفاع الموج |
| `tidalCoef` | `getTidalCoefficient()` | وصف قوة التيار |

### 5.2 دالة `getTideState` — كيف تُصنَّف الماية

```javascript
function getTideState(prev, cur, next) {
  // prev: ارتفاع المد قبل ساعة | cur: الآن | next: بعد ساعة
  const trend    = next - prev;  // اتجاه الحركة الكلية
  const threshold = 0.04;        // عتبة التمييز بالأمتار (~4 سم)

  if (trend > threshold)  return { key:'sagi',  label:'سقي',   arrow:'↑', cls:'tide-up'   };
  if (trend < -threshold) return { key:'thabr', label:'ثبر',   arrow:'↓', cls:'tide-down' };
  return                         { key:'steady', label:'ثابت', arrow:'●', cls:'tide-turn'  };
  // ثابت = وقفة الماية → أفضل توقيت للصيد في الغزير
}
```

### 5.3 منطق الربط الذكي (Smart Conflict Detection)

```javascript
// الكوس: رياح شمالية أو شمالية غربية (270°–360° أو 0°–45°)
const isKaosWind = hasLiveWind && (windDirDeg >= 270 || windDirDeg <= 45);

// تضارب = حمل + سقي + كوس فوق 8 عقدة → خطر ضرب الموج
const isConflict = waterState === 'حمل'
                && tideState.key === 'sagi'
                && isKaosWind
                && windKnots > 8;

// عتبات الرياح بالعقد (1 عقدة = 1.852 كم/س):
// > 25 عقدة → أولوية السلامة المطلقة
// > 15 عقدة → تنبيه وتوصية بالأماكن المحمية
// ≤ 15 عقدة → صيد عادي
const isVeryStrongWind = windKnots > 25;
const isStrongWind     = windKnots > 15;
```

### 5.4 شجرة قرار التوصية الفنية

```javascript
// نظام الأولويات (الأعلى يلغي ما تحته):
if (isVeryStrongWind) {
  // السلامة أولاً — لا صيد في العرض المفتوح
  techTip = '⚠️ رياح شديدة تجاوزت 25 عقدة — أولوية السلامة...';

} else if (isStrongWind && isConflict) {
  // رياح قوية + تضارب التيار مع الرياح
  techTip = 'رياح نشطة مع تضارب تيار — الأفضل الصيد من الساحل...';

} else if (isStrongWind) {
  // رياح قوية بدون تضارب
  techTip = 'الرياح فوق 15 عقدة — العدة الخفيفة في الأماكن المحمية...';

} else if (waterState === 'حمل') {
  if (isWaqfa)              { /* وقفة الماية في الحمل = ذروة الغزير */ }
  else if (tideState.key === 'sagi') { /* سقي = نشاط الممرات */ }
  else                      { /* ثبر = انتظر الوقفة */ }

} else { /* فساد */
  if (isWaqfa) { /* وقفة الماية في الفساد = أفضل للقاع والهامور */ }
  else         { /* فساد عادي = ساحلي خفيف */ }
}
```

---

## 6. قاعدة بيانات المحطات والأسماك

### 6.1 مصفوفة المحطات الجغرافية

```javascript
const STATIONS = [
  // قطر
  {name:'الدوحة',  country:'قطر',    lat:25.2854, lng:51.5310, flag:'🇶🇦'},
  {name:'الخور',   country:'قطر',    lat:25.6804, lng:51.4968, flag:'🇶🇦'},
  {name:'الوكرة',  country:'قطر',    lat:25.1659, lng:51.6030, flag:'🇶🇦'},
  {name:'الرويس',  country:'قطر',    lat:26.1331, lng:51.2147, flag:'🇶🇦'},
  // الكويت
  {name:'الكويت',  country:'الكويت', lat:29.3759, lng:47.9774, flag:'🇰🇼'},
  // السعودية — الخليج
  {name:'الخبر',   country:'السعودية',lat:26.2825, lng:50.2085, flag:'🇸🇦'},
  {name:'العقير',  country:'السعودية',lat:25.6457, lng:50.2118, flag:'🇸🇦'},
  // السعودية — البحر الأحمر
  {name:'جدة',     country:'السعودية',lat:21.5433, lng:39.1728, flag:'🇸🇦'},
  {name:'جازان',   country:'السعودية',lat:16.8892, lng:42.5511, flag:'🇸🇦'},
  // ... 31 محطة إجمالاً
];

// تصنيف عمق كل محطة (يؤثر على نوع الصيد الموصى به):
const STATION_BATHYMETRY = {
  'الدوحة': 'shallow', // ضحل — مناسب للساحلي
  'الخبر':  'mid',     // متوسط — متعدد الأساليب
  'جدة':    'deep',    // عميق — مناسب للغزير
  // ...
};
```

### 6.2 أولويات الأسماك لكل محطة

```javascript
const STATION_SPECIES_PRIORITY = {
  // العقير: تُعرف بالسبيطي والبدح الساحليين
  'العقير': ['safi', 'kanaad', 'sobaity', 'shaam', 'badah', 'shaari_bagha'],

  // الجبيل: مياه أعمق → الهامور والشعري الكبار
  'الجبيل': ['hamour', 'shaari_kibar', 'kanaad', 'sooli', 'andaq'],

  // الدوحة: توازن بين الساحلي والغزير
  'الدوحة': ['sobaity', 'shaam', 'safi', 'hamour', 'kanaad', 'badah'],

  // مسندم: بحر عُمان العميق → العندق والفسكر
  'مسندم (خصب)': ['andaq', 'sooli', 'faskar', 'kanaad', 'niser'],

  // جدة: البحر الأحمر → النجل والطرادي
  'جدة': ['najel', 'tarradi', 'hareed', 'shaam', 'sobaity_rs'],
};
```

### 6.3 نموذج سجل السمكة في قاعدة البيانات

```javascript
{
  id:          'sobaity',            // معرّف فريد
  name_ar:     'سبيطي',             // الاسم العربي
  name_en:     'Sobaity Bream',      // الاسم الإنجليزي
  type:        'ساحلي',             // ساحلي / قاعي / سطحي
  prefer_fasad: false,               // يُفضّل الحمل (false) أو الفساد (true)
  peak_min:    10,                   // أقل عمق مثالي (متر)
  peak_max:    30,                   // أعمق نقطة مثالية (متر)
  regions:     ['gulf'],             // مناطق التواجد
  best_time:   'الحمل — مد الليل والفجر',
  rig:         'خفيف متوسط 10-25 رطل / بكرة 3000-4000',
  bait:        ['روبيان', 'دود'],
  methods:     ['رمي ساحلي', 'حداق'],
  durur:       ['المقدم', 'المربعانية', 'العقارب', 'الوسم'],
  tag:         'وفير حالياً'
}
```

---

## 7. واجهة المستخدم

### 7.1 منطق البوصلة (Compass & Needle Logic)

```javascript
function renderCompass(date) {
  const hr = getSelectedHourEntry().hour || {};

  // التحقق من وجود بيانات ريح حية (من API)
  const hasLiveWind = !!(hr.windGust?.sg != null && hr.windDirection?.sg != null);

  const wd = hasLiveWind ? hr.windDirection.sg : 0; // الاتجاه بالدرجات (0-360)
  const ws = hasLiveWind ? getDisplayedWindKmh(hr) : null;

  // تدوير الإبرة: CSS transform rotate(Xdeg)
  // wd=0   → شمال  (↑)
  // wd=90  → شرق   (→)
  // wd=180 → جنوب  (↓)
  // wd=270 → غرب   (←)
  document.getElementById('windNeedle').style.transform =
    'translate(-50%, -115px) rotate(' + wd + 'deg)';

  // الرقم في وسط البوصلة = سرعة الريح بكم/س
  document.getElementById('compassCenter').textContent =
    ws != null ? Math.round(ws) : '--';
}

// تحويل الدرجات إلى نص عربي (8 اتجاهات):
function windDirText8(deg) {
  const dirs = ['شمال','شمال شرقي','شرق','جنوب شرقي',
                'جنوب','جنوب غربي','غرب','شمال غربي'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
```

### 7.2 شريط المد والجزر (Tide Strip)

```javascript
function renderSeaStatusStrip() {
  const slice = getTimelineEntries(12); // 12 ساعة قادمة

  slice.forEach((entry, i) => {
    const h = entry.hour || {};
    const cur  = h.seaLevel?.sg;
    const prev = slice[i-1]?.hour?.seaLevel?.sg ?? cur;
    const next = slice[i+1]?.hour?.seaLevel?.sg ?? cur;

    // تصنيف الاتجاه (يُلوَّن بـ CSS):
    // tide-up   (سقي  ↑) → أزرق فاتح — ماء صاعد
    // tide-down (ثبر  ↓) → رمادي     — ماء هابط
    // tide-turn (ثابت ●) → ذهبي      — وقفة الماية
    const tideState = getTideState(prev, cur, next);

    box.innerHTML =
      '<div class="sea-time">'   + formatHourArabic(h.time)         + '</div>' +
      '<div class="sea-height">' + cur.toFixed(2) + 'م'             + '</div>' +
      '<div class="sea-trend">' +
        '<span class="tide-dir-badge ' + tideState.cls + '">'        +
          tideState.arrow + ' ' + tideState.label                    +
        '</span>'                                                     +
      '</div>';
  });
}
```

---

## 8. بروتوكول التحديث التلقائي

### 8.1 ثابت التحديث

```javascript
const UPDATE_FREQUENCY_MINUTES = 10;
// 10 دقيقة = التوازن بين دقة البيانات وحصة API المجانية
```

### 8.2 المؤقتات النشطة

```javascript
async function initApp() {
  // 1. التحديث الدوري كل 10 دقائق (بيانات الطقس البحري)
  windRefreshTimer = setInterval(function () {
    refreshSelectedStationLiveWind();
  }, UPDATE_FREQUENCY_MINUTES * 60 * 1000); // 600,000 مللي-ثانية

  // 2. مزامنة تغيير اليوم كل دقيقة (للتقويم التلقائي)
  dayChangeSyncTimer = setInterval(function () {
    refreshIfDayChanged(false);
  }, 60 * 1000);

  // 3. ساعة حية تتحدث كل ثانية
  setInterval(tick, 1000);

  // 4. إعادة تحديث عند استعادة نافذة المتصفح
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshIfDayChanged(false);
  });
}
```

### 8.3 آلية Fallback — عند انقطاع الاتصال

```javascript
async function loadLiveOrFallbackWeather(station, targetWeekDates) {
  try {
    // محاولة جلب البيانات الحية من Open-Meteo
    return await fetchProviderHours(provider, station, targetWeekDates);
  } catch (liveErr) {
    // الاحتياط: توليد بيانات مد رياضية محلية تعتمد على:
    // - الإحداثيات الجغرافية
    // - عمق نظام المحطة (bathymetry)
    // - اليوم في الدورة الهجرية
    return { hoursByDay: makeNoWindDays(station, targetWeekDates),
             meta: { source: 'official-wind-pending', isLive: false } };
  }
}
```

---

## 9. بروتوكول النشر (Vercel Deployment)

```json
// vercel.json — توجيه جميع المسارات لصفحة التطبيق
{
  "rewrites": [{ "source": "/(.*)", "destination": "/web/index.html" }]
}
```

البيانات الثابتة (قواعد البيانات) موجودة في:
```
web/data/
├── fish_species.json       — قاعدة أسماك الخليج
├── fishing_calendar.json   — التقويم الشهري للأسماك
├── durur_mapping.json      — ربط الدرور بالمواسم
└── rigs_and_baits.json     — دليل العدة والطعوم
```

---

## 10. التقنيات المستخدمة

| التقنية | الإصدار | الغرض |
|---|---|---|
| HTML5 | معيار 2024 | هيكل الصفحة والواجهة |
| CSS3 + Custom Properties | — | التصميم البحري والمتغيرات |
| JavaScript ES6+ | — | المنطق الكامل (No Framework) |
| Open-Meteo API | v1 | بيانات الريح والأمواج والمد |
| Intl (Islamic Calendar) | مدمج | التقويم الهجري الدقيق |
| Vercel | — | النشر والاستضافة |

---

> **ملاحظة للمطورين:** التطبيق خالٍ من أي مكتبات خارجية (`npm-free`). كل المنطق مكتوب بـ Vanilla JavaScript ES6 لضمان أقصى سرعة تحميل في المناطق الساحلية ذات الاتصال المتقطع.
