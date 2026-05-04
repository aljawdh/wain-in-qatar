const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:4174/web/index.html';

const stationsPayload = {
  stations: [
    { id: 'st1', name_ar: 'محطة الدوحة', lat: 25.2854, lon: 51.531, country: 'Qatar' },
    { id: 'st2', name_ar: 'محطة الخور', lat: 25.6839, lon: 51.505, country: 'Qatar' }
  ]
};

function analysisPayload(stationId, date) {
  const base = {
    ok: true,
    station_id: stationId,
    analysis_date: date,
    dur: {
      period_name: stationId === 'st2' ? 'الثريا' : 'الدبران',
      day_in_period: date.endsWith('05') ? 2 : 1,
      next_period_name: stationId === 'st2' ? 'الدبران' : 'الهقعة'
    },
    environment: {
      wave_height_m: date.endsWith('05') ? 1.2 : 0.8,
      wind_speed_kmh: stationId === 'st2' ? 24 : 17,
      wind_direction_deg: 40,
      water_temp_c: 29,
      humidity_percent: 65
    },
    tide: {
      state: stationId === 'st2' ? 'LOAD' : 'FASAD',
      current_speed_ms: stationId === 'st2' ? 0.7 : 0.4
    },
    fishing: {
      is_recommended: stationId === 'st2',
      confidence_score: stationId === 'st2' ? 78 : 52,
      advice_text: stationId === 'st2' ? 'الظروف جيدة نسبيًا.' : 'بحذر مع مراقبة الموج.',
      species_activity: stationId === 'st2' ? ['الهامور', 'الشعري', 'الكنعد'] : ['الصافي', 'القباب']
    },
    hotspot: {
      reason_if_unknown: ''
    }
  };
  return base;
}

async function wireApiMocks(page) {
  await page.route('**/api**', async (route) => {
    const req = new URL(route.request().url());
    const r = req.searchParams.get('route');
    if (r === 'stations') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stationsPayload) });
      return;
    }
    if (r === 'analysis') {
      const stationId = req.searchParams.get('station_id') || 'st1';
      const date = req.searchParams.get('analysis_date') || '2026-05-04';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(analysisPayload(stationId, date))
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
}

async function testViewport(viewport, geolocationMode) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', (err) => errors.push({ type: 'pageerror', text: String(err) }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ type: 'console', text: msg.text() });
  });

  await page.addInitScript((mode) => {
    const denied = {
      getCurrentPosition: (_ok, fail) => fail({ message: 'User denied geolocation' })
    };
    const granted = {
      getCurrentPosition: (ok) => ok({ coords: { latitude: 25.6838, longitude: 51.5051 } })
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: mode === 'granted' ? granted : denied
    });
  }, geolocationMode);

  await wireApiMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const out = {
    viewport: `${viewport.width}x${viewport.height}`,
    horizontalScroll: false,
    bottomNavNotCovering: false,
    locationModalOnce: false,
    locationAcceptNearest: false,
    locationRejectNoCrash: false,
    manualStationSelection: false,
    changeDayUpdatesData: false,
    dashboardWorks: false,
    marineWorks: false,
    fishingWorks: false,
    mapWorks: false,
    heatmapWorks: false,
    consoleClean: false,
    consoleErrors: errors
  };

  const modalVisibleFirst = await page.locator('#locationModal').isVisible();
  if (geolocationMode === 'denied') {
    await page.click('#locationEnableBtn');
    await page.waitForTimeout(250);
    const hintText = await page.locator('#locationHint').textContent();
    const cards = await page.locator('#appContent .card').count();
    out.locationRejectNoCrash = String(hintText || '').includes('يمكنك اختيار المحطة يدويًا') && cards > 0;
    out.locationModalOnce = modalVisibleFirst && !(await page.locator('#locationModal').isVisible());
  } else {
    await page.click('#locationEnableBtn');
    await page.waitForTimeout(250);
    const val = await page.locator('#stationSelector').inputValue();
    out.locationAcceptNearest = val === 'st2';
    out.locationModalOnce = modalVisibleFirst && !(await page.locator('#locationModal').isVisible());
  }

  out.horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  out.bottomNavNotCovering = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    const shell = document.querySelector('.app-shell');
    if (!nav || !shell) return false;
    const pb = parseFloat(getComputedStyle(shell).paddingBottom || '0');
    return pb >= (nav.getBoundingClientRect().height - 10);
  });

  out.dashboardWorks = await page.locator('#appContent .card').count().then((n) => n > 0);
  await page.click('[data-page="marine"]');
  out.marineWorks = await page.locator('#pageMarine .card').count().then((n) => n > 0);
  await page.click('[data-page="fishing"]');
  out.fishingWorks = await page.locator('#pageFishing .card').count().then((n) => n > 0);
  await page.click('[data-page="map"]');
  out.mapWorks = await page.locator('#pageMap .card').count().then((n) => n > 0);
  await page.click('[data-page="dashboard"]');
  out.heatmapWorks = await page.locator('text=Heatmap Preview').count().then((n) => n > 0);

  const hasSt1 = await page.evaluate(() => {
    const sel = document.querySelector('#stationSelector');
    if (!sel) return false;
    return Array.from(sel.options || []).some((o) => o.value === 'st1');
  });
  if (hasSt1) {
    await page.selectOption('#stationSelector', 'st1');
    await page.click('[data-page="map"]');
    out.manualStationSelection = await page.locator('#pageMap').textContent().then((t) => String(t || '').includes('st1'));
  } else {
    out.manualStationSelection = false;
  }

  out.changeDayUpdatesData = false; // no date control exists in rebuilt UI
  out.consoleClean = errors.length === 0;

  await browser.close();
  return out;
}

async function run() {
  const results = [];
  results.push(await testViewport({ width: 390, height: 844 }, 'denied'));
  results.push(await testViewport({ width: 412, height: 915 }, 'granted'));
  results.push(await testViewport({ width: 768, height: 1024 }, 'granted'));
  results.push(await testViewport({ width: 1280, height: 800 }, 'granted'));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message || e) }, null, 2));
  process.exit(1);
});
