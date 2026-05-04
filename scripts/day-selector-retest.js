const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:4174/web/index.html';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const DAY_DATA = {};
DAY_DATA[localDateKey(0)] = {
  wind: 14,
  wave: 0.7,
  current: 0.35,
  temp: 28,
  tide: 'FASAD',
  decision: { label: 'حذر', is_recommended: false, confidence_score: 52 },
  heat: 'heat-today'
};
DAY_DATA[localDateKey(1)] = {
  wind: 22,
  wave: 1.3,
  current: 0.72,
  temp: 29,
  tide: 'LOAD',
  decision: { label: 'مناسب', is_recommended: true, confidence_score: 76 },
  heat: 'heat-tomorrow'
};
DAY_DATA[localDateKey(2)] = {
  wind: 30,
  wave: 1.9,
  current: 0.92,
  temp: 30,
  tide: 'LOAD',
  decision: { label: 'غير مناسب', is_recommended: false, confidence_score: 31 },
  heat: 'heat-plus2'
};

function buildAnalysis(date, stationId) {
  const v = DAY_DATA[date] || null;
  if (!v) return { ok: false, error: 'no_data_for_date' };
  return {
    ok: true,
    station_id: stationId,
    analysis_date: date,
    dur: {
      period_name: 'الدبران',
      day_in_period: date === localDateKey(0) ? 1 : date === localDateKey(1) ? 2 : 3,
      next_period_name: 'الهقعة'
    },
    environment: {
      wind_speed_kmh: v.wind,
      wave_height_m: v.wave,
      water_temp_c: v.temp,
      humidity_percent: 63,
      current_speed: v.current
    },
    tide: {
      state: v.tide,
      current_speed_ms: v.current
    },
    fishing: {
      is_recommended: v.decision.is_recommended,
      confidence_score: v.decision.confidence_score,
      advice_text: v.decision.label,
      species_activity: ['الهامور', 'الشعري', 'الصافي']
    },
    decision: {
      label: v.decision.label
    },
    hotspot: {
      reason_if_unknown: v.heat
    }
  };
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const requestDates = [];
  const debugDayChange = [];
  const debugDayData = [];
  const consoleErrors = [];

  await page.addInitScript(() => {
    window.__dayDebugLogs = { dayChange: [], dayDataCheck: [] };
    const orig = console.debug;
    console.debug = function () {
      try {
        const args = Array.prototype.slice.call(arguments);
        if (args[0] === 'NAVIDUR_DAY_CHANGE' && args[1]) {
          window.__dayDebugLogs.dayChange.push(args[1]);
        }
        if (args[0] === 'NAVIDUR_DAY_DATA_CHECK' && args[1]) {
          window.__dayDebugLogs.dayDataCheck.push(args[1]);
        }
      } catch (_e) {}
      return orig.apply(console, arguments);
    };
  });

  page.on('console', async (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'debug') {
      const text = msg.text();
      if (text.includes('NAVIDUR_DAY_CHANGE')) debugDayChange.push(text);
      if (text.includes('NAVIDUR_DAY_DATA_CHECK')) debugDayData.push(text);
    }
  });

  await page.route('**/api**', async (route) => {
    const u = new URL(route.request().url());
    const r = u.searchParams.get('route');
    if (r === 'stations') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stations: [{ id: 'st1', name_ar: 'محطة الدوحة', lat: 25.28, lon: 51.53, country: 'Qatar' }]
        })
      });
      return;
    }
    if (r === 'analysis') {
      const date = u.searchParams.get('analysis_date');
      const stationId = u.searchParams.get('station_id') || 'st1';
      requestDates.push(`${stationId}::${date}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildAnalysis(date, stationId))
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('#locationSkipBtn');
  await page.waitForTimeout(250);

  async function clickDay(index) {
    await page.locator('#daySelector .day-pill').nth(index).click();
    await page.waitForTimeout(250);
    const apiDate = await page.evaluate(() => window.NavidurState.getState().selectedDate);
    const cacheKeys = await page.evaluate(() => Object.keys(window.NavidurState.getState().cache || {}));
    const dayBucketKeys = await page.evaluate(() => Object.keys(window.NavidurState.getState().analysisDtoByDay || {}));
    const dto = await page.evaluate(() => window.NavidurState.getState().currentSharedAnalysisDto);
    const heatText = await page.locator('#appContent').textContent();
    return {
      date: apiDate,
      values: {
        wind_speed: dto && dto.environment ? dto.environment.wind_speed_kmh : null,
        wave_height: dto && dto.environment ? dto.environment.wave_height_m : null,
        current_speed: dto && dto.tide ? dto.tide.current_speed_ms : null,
        water_temp: dto && dto.environment ? dto.environment.water_temp_c : null,
        tide_state: dto && dto.tide ? dto.tide.state : null,
        decision: dto && dto.decision ? dto.decision.label : null
      },
      heatText: String(heatText || ''),
      cacheKeys,
      dayBucketKeys,
      dtoRef: dto
    };
  }

  const d0 = await clickDay(0);
  const d1 = await clickDay(1);
  const d2 = await clickDay(2);

  // Rapid click test: 0 -> 1 -> 2 quickly
  await page.locator('#daySelector .day-pill').nth(0).click();
  await page.locator('#daySelector .day-pill').nth(1).click();
  await page.locator('#daySelector .day-pill').nth(2).click();
  await page.waitForTimeout(500);
  const rapidState = await page.evaluate(() => {
    const st = window.NavidurState.getState();
    return {
      selectedDate: st.selectedDate,
      dto: st.currentSharedAnalysisDto
    };
  });

  const variationPassed =
    d0.values.wind_speed !== d1.values.wind_speed &&
    d1.values.wind_speed !== d2.values.wind_speed &&
    d0.values.wave_height !== d1.values.wave_height &&
    d1.values.current_speed !== d2.values.current_speed &&
    d0.values.decision !== d1.values.decision;

  const cacheSeparationPassed =
    d2.cacheKeys.includes(`st1::${d0.date}`) &&
    d2.cacheKeys.includes(`st1::${d1.date}`) &&
    d2.cacheKeys.includes(`st1::${d2.date}`);

  const finalBuckets = await page.evaluate(() => {
    const st = window.NavidurState.getState();
    return {
      cacheKeys: Object.keys(st.cache || {}),
      dayKeys: Object.keys(st.analysisDtoByDay || {})
    };
  });

  const uniqueRequests = Array.from(new Set(requestDates));

  const dtoIsolationPassed =
    d0.date !== d1.date &&
    d1.date !== d2.date &&
    d0.values.wind_speed !== d2.values.wind_speed &&
    finalBuckets.dayKeys.length >= 3 &&
    uniqueRequests.length >= 3;

  const uiUpdatePassed =
    d0.heatText.includes('heat-today') &&
    d1.heatText.includes('heat-tomorrow') &&
    d2.heatText.includes('heat-plus2');

  const raceConditionPassed =
    rapidState.selectedDate === d2.date &&
    rapidState.dto &&
    rapidState.dto.environment &&
    rapidState.dto.environment.wind_speed_kmh === d2.values.wind_speed &&
    rapidState.dto.hotspot &&
    rapidState.dto.hotspot.reason_if_unknown === 'heat-plus2';

  const structuredDebug = await page.evaluate(() => window.__dayDebugLogs || { dayChange: [], dayDataCheck: [] });

  const report = {
    changeDay: {
      dataVariation: variationPassed ? 'Passed' : 'Failed',
      cacheSeparation: cacheSeparationPassed ? 'Passed' : 'Failed',
      dtoIsolation: dtoIsolationPassed ? 'Passed' : 'Failed',
      uiUpdate: uiUpdatePassed ? 'Passed' : 'Failed',
      raceCondition: raceConditionPassed ? 'Passed' : 'Failed'
    },
    threeDayValues: [d0, d1, d2].map((x) => ({ date: x.date, ...x.values })),
    cacheKeys: d2.cacheKeys,
    analysisRequests: requestDates,
    debug: {
      dayChangeConsole: debugDayChange.slice(-6),
      dayDataCheckConsole: debugDayData.slice(-6),
      dayChangeStructured: structuredDebug.dayChange.slice(0, 6),
      dayDataCheckStructured: structuredDebug.dayDataCheck.slice(0, 6)
    },
    consoleErrors
  };

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message || e) }, null, 2));
  process.exit(1);
});
