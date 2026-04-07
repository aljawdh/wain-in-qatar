import { chromium } from 'playwright';

const results = [];

function push(name, pass, details) {
  results.push({ name, pass, details });
}

async function exists(page, selector) {
  return (await page.locator(selector).count()) > 0;
}

async function textContains(page, needle) {
  const body = await page.textContent('body');
  return String(body || '').includes(needle);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1) Public custom domain root
  {
    const resp = await page.goto('https://navidur.app/', { waitUntil: 'domcontentloaded' });
    const status = resp ? resp.status() : -1;
    const hasYes = await exists(page, '#feedbackYes');
    const hasNo = await exists(page, '#feedbackNo');
    const isComingSoon = await textContains(page, 'قريباً');

    push('public_root_loads', status === 200, `status=${status}`);
    push('public_no_yesno_controls', !hasYes && !hasNo, `hasYes=${hasYes}, hasNo=${hasNo}`);
    push('public_root_is_actual_app', !isComingSoon, `isComingSoon=${isComingSoon}`);
  }

  // 2) Public direct app path on custom domain
  {
    const resp = await page.goto('https://navidur.app/navidur_lab_v2', { waitUntil: 'domcontentloaded' });
    const status = resp ? resp.status() : -1;
    const notFound = await textContains(page, 'NOT_FOUND');
    push('direct_app_route_available', status === 200 && !notFound, `status=${status}, notFound=${notFound}`);
  }

  // 3) Admin page on custom domain
  {
    const resp = await page.goto('https://navidur.app/admin.html', { waitUntil: 'domcontentloaded' });
    const status = resp ? resp.status() : -1;
    const hasUser = await exists(page, '#adminUser');
    const hasPass = await exists(page, '#adminPassword');
    push('admin_page_accessible_publicly', status === 200, `status=${status}`);
    push('admin_login_form_present', hasUser && hasPass, `hasUser=${hasUser}, hasPass=${hasPass}`);
  }

  // 4) APIs on custom domain (browser fetch)
  {
    const stationsResp = await context.request.get('https://navidur.app/api/stations');
    const summaryResp = await context.request.get('https://navidur.app/api/admin/summary');
    push('custom_domain_stations_api_available', stationsResp.status() === 200, `status=${stationsResp.status()}`);
    push('custom_domain_admin_summary_unauth_blocked', summaryResp.status() === 401 || summaryResp.status() === 403, `status=${summaryResp.status()}`);
  }

  // 5) Vercel project access protection
  {
    const resp = await page.goto('https://wain-in-qatar-d00o26cxx-ehmoodi-7527s-projects.vercel.app/', { waitUntil: 'domcontentloaded' });
    const status = resp ? resp.status() : -1;
    const authRequired = await textContains(page, 'Authentication Required');
    push('vercel_project_accessible_without_protection', status === 200 && !authRequired, `status=${status}, authRequired=${authRequired}`);

    const apiResp = await context.request.get('https://wain-in-qatar-d00o26cxx-ehmoodi-7527s-projects.vercel.app/api/stations');
    push('vercel_stations_api_accessible_without_protection', apiResp.status() === 200, `status=${apiResp.status()}`);
  }

  await browser.close();

  const passed = results.filter((x) => x.pass);
  const failed = results.filter((x) => !x.pass);

  console.log(JSON.stringify({
    passed: passed.length,
    failed: failed.length,
    total: results.length,
    results
  }, null, 2));

  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
