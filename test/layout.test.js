// Real-browser layout test for the Once Upon a Call landing overlay.
// Loads the page at several viewport sizes and asserts that no two top-level
// blocks overlap, that nothing overflows horizontally, and that the compact
// top bar stays a single tidy strip.
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:3120/';

const VIEWPORTS = [
  { name: 'phone   390x844', width: 390, height: 844 },
  { name: 'laptop 1280x720', width: 1280, height: 720 },
  { name: 'fhd    1920x1080', width: 1920, height: 1080 },
  { name: '4k     3840x2160', width: 3840, height: 2160 },
];

const BLOCKS = ['.hero', '.call-card', '.keys-card', '.steps', '.links', '.foot'];
const HERO_ITEMS = ['.brand', '.mini', '#status', '#toggle-landing'];
const TRY_ITEMS = ['#preview-btn', '.try-hint'];

function overlaps(a, b) {
  const eps = 1; // allow a 1px rounding kiss
  return a.x < b.x + b.width - eps && b.x < a.x + a.width - eps &&
         a.y < b.y + b.height - eps && b.y < a.y + a.height - eps;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
    protocolTimeout: 60000,
  });
  let failures = 0;
  const page = await browser.newPage();
  page.on('pageerror', () => {});
  // The 3D engine (XR Blocks + rapier WASM) locks the JS thread under software GL and is
  // irrelevant to this overlay test, so keep it out of the page entirely.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('cdn.jsdelivr.net') || u.includes('esm.sh') || u.includes('esm.run') || u.endsWith('main.js')) return req.abort();
    req.continue();
  });

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 900));

    for (const mode of ['expanded', 'compact']) {
      await page.evaluate((m) => {
        const l = document.getElementById('landing');
        l.classList.toggle('compact', m === 'compact');
      }, mode);
      await new Promise((r) => setTimeout(r, 250));

      const boxes = await page.evaluate((sels) => {
        const out = {};
        for (const s of sels) {
          const el = document.querySelector(s);
          if (!el) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          out[s] = { x: r.x, y: r.y, width: r.width, height: r.height, position: cs.position };
        }
        return out;
      }, [...BLOCKS, ...HERO_ITEMS, ...TRY_ITEMS]);

      const overflow = await page.evaluate(() => {
        const l = document.getElementById('landing');
        const items = [...l.querySelectorAll('*')];
        const vw = window.innerWidth;
        const bad = items
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > vw + 1 || r.left < -1);
          })
          .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`);
        return [...new Set(bad)];
      });

      const problems = [];
      // 1. no top-level block may overlap another
      const present = BLOCKS.filter((s) => boxes[s]);
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          if (overlaps(boxes[present[i]], boxes[present[j]])) {
            problems.push(`${present[i]} overlaps ${present[j]}`);
          }
        }
      }
      // 2. no items inside the hero row may overlap
      const heroPresent = HERO_ITEMS.filter((s) => boxes[s]);
      for (let i = 0; i < heroPresent.length; i++) {
        for (let j = i + 1; j < heroPresent.length; j++) {
          if (overlaps(boxes[heroPresent[i]], boxes[heroPresent[j]])) {
            problems.push(`${heroPresent[i]} overlaps ${heroPresent[j]}`);
          }
        }
      }
      // 3. the "Watch the story" call-to-action must be a real, non-overlapping hit target
      if (mode === 'expanded') {
        const cta = boxes['#preview-btn'];
        if (!cta) problems.push('#preview-btn missing (the no-phone way in)');
        else {
          if (cta.height < 30) problems.push(`#preview-btn only ${Math.round(cta.height)}px tall`);
          const hint = boxes['.try-hint'];
          if (hint && overlaps(cta, hint)) problems.push('#preview-btn overlaps .try-hint');
        }
      }
      // 4. nothing may be position:fixed (that was the demo.css <header> bug)
      for (const [sel, b] of Object.entries(boxes)) {
        if (b.position === 'fixed') problems.push(`${sel} is position:fixed`);
      }
      // 5. nothing may run off the side of the window
      if (overflow.length) problems.push(`overflows viewport: ${overflow.join(', ')}`);
      // 6. compact bar must stay a thin strip
      if (mode === 'compact') {
        const h = await page.evaluate(() => document.getElementById('landing').getBoundingClientRect().height);
        if (h > Math.max(120, vp.height * 0.18)) problems.push(`compact bar too tall: ${Math.round(h)}px`);
      }

      const tag = `${vp.name} ${mode.padEnd(8)}`;
      if (problems.length) {
        failures += problems.length;
        console.log(`FAIL  ${tag}\n        - ${problems.join('\n        - ')}`);
      } else {
        console.log(`ok    ${tag}`);
      }
    }
  }

  // Sanity: the number and status text actually render
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  const content = await page.evaluate(() => ({
    phone: document.getElementById('phone').textContent.trim(),
    mini: document.getElementById('phone-mini').textContent.trim(),
    status: document.getElementById('status-text').textContent.trim(),
    title: document.title,
  }));
  console.log('\ncontent:', JSON.stringify(content));
  if (!/\d/.test(content.phone)) { console.log('FAIL  phone number did not render'); failures++; }
  const extras = await page.evaluate(() => ({
    favicon: !!document.querySelector('link[rel="icon"]'),
    cta: (document.getElementById('preview-btn') || {}).textContent,
    liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
  }));
  console.log('extras:', JSON.stringify(extras));
  if (!extras.favicon) { console.log('FAIL  no favicon'); failures++; }
  if (!extras.cta) { console.log('FAIL  no preview CTA'); failures++; }
  if (extras.liveRegions !== 1) { console.log(`FAIL  expected exactly 1 live region, found ${extras.liveRegions}`); failures++; }

  await page.screenshot({ path: 'expanded.png' });
  await page.evaluate(() => document.getElementById('landing').classList.add('compact'));
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: 'compact.png' });

  await browser.close();
  console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL LAYOUT CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
