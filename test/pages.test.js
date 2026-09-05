// Smoke test for the companion pages a caregiver and a parent actually touch.
// They are plain HTML with a little fetch glue, which is exactly the kind of code that breaks
// silently: a typo throws once, the page renders empty, and nobody notices until demo night.
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3210';

const PAGES = [
  { path: '/caregiver.html', mustContain: ['Saved stories', 'No stories saved yet'] },
  { path: '/parent-card.html', mustContain: ['Once Upon a Call', '890-3507', 'Print card'] },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  let failures = 0;
  for (const spec of PAGES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(BASE + spec.path, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    // innerText reflects CSS text-transform (the card's title is uppercased), so compare loosely.
    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    const missing = spec.mustContain.filter((s) => !text.includes(s.toLowerCase()));
    const problems = [];
    if (missing.length) problems.push(`missing text: ${missing.join(', ')}`);
    if (errors.length) problems.push(`console errors: ${errors.join(' | ')}`);
    const favicon = await page.evaluate(() => !!document.querySelector('link[rel="icon"]'));
    if (!favicon) problems.push('no favicon');
    if (problems.length) { failures += problems.length; console.log(`FAIL  ${spec.path}\n        - ${problems.join('\n        - ')}`); }
    else console.log(`ok    ${spec.path}`);
    await page.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL PAGE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
