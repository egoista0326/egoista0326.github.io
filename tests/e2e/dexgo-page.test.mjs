// The /dexgo/ page structure in a real browser (R10 redesign), against the running preview of dist/.
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome, which
// plays H.264). Chrome runs with its desktop autoplay policy, so only muted playback may start on its own.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const desktop = { viewport: { width: 1440, height: 900 } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    args: ['--autoplay-policy=document-user-activation-required']
  });
});
after(() => browser?.close());

/** Opens /dexgo/ in a new context and runs `run(page, errors)`; `errors` collects console errors and page errors. */
const onPage = async (options, run) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${base}/dexgo/`, { waitUntil: 'load' });
    await run(page, errors);
  } finally {
    await context.close();
  }
};

const box = (page, selector) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  }, selector);

test('desktop: the nav and the whole teaser are on the first screen, and the teaser plays muted', async () => {
  await onPage(desktop, async (page, errors) => {
    const nav = await box(page, '.dx-localnav');
    assert.equal(nav.top, 0);
    const hero = await box(page, '.dx-hero-wide video');
    assert.ok(hero.top >= nav.bottom && hero.bottom <= 900, `teaser ${hero.top}-${hero.bottom}`);
    assert.ok(Math.abs(hero.width / hero.height - 2) < 0.01, '2:1');
    await page.waitForFunction(() => document.querySelector('.dx-hero-wide video').currentTime > 0.3, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.querySelector('.dx-hero-wide video').muted), true);
    assert.deepEqual(errors, []);
  });
});

test('the nav pause button pauses every clip and names what it will do; the nav stays on top while scrolling', async () => {
  await onPage(desktop, async (page) => {
    const toggle = '.dx-navpause';
    await page.waitForFunction(() => !document.querySelector('.dx-hero-wide video').paused, null, { timeout: 15000 });
    assert.equal(await page.getAttribute(toggle, 'aria-label'), 'Pause all motion');
    await page.click(toggle);
    assert.equal(await page.getAttribute(toggle, 'aria-label'), 'Play all motion');
    assert.equal(await page.evaluate(() => document.querySelector('.dx-hero-wide video').paused), true);
    await page.click(toggle);
    assert.equal(await page.getAttribute(toggle, 'aria-label'), 'Pause all motion');
    await page.evaluate(() => window.scrollTo(0, 4000));
    assert.equal((await box(page, '.dx-localnav')).top, 0, 'sticky');
  });
});

test('"Interactive demo" lands on the Live demo part under the nav with focus on Start; the nav marks the part', async () => {
  await onPage(desktop, async (page) => {
    await page.click('[data-demo-jump]');
    await page.waitForFunction(() => Math.abs(document.querySelector('#live-demo').getBoundingClientRect().top - 52) < 40, null, { timeout: 5000 });
    await page.waitForTimeout(400);
    const navBottom = (await box(page, '.dx-localnav')).bottom;
    // The grey band meets the nav (no white strip between them).
    assert.ok(Math.abs((await box(page, '#live-demo')).top - navBottom) <= 1, 'band top at the nav');
    const head = await box(page, '#live-demo .dx-eyebrow');
    assert.ok(head.top >= navBottom && head.top < 260, `eyebrow at ${head.top}`);
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-demo-start')), true);
    assert.equal(await page.evaluate(() => document.querySelector('[data-nav="live-demo"]').getAttribute('aria-current')), 'true');
    // The recorded chain plays in the stage before Start.
    await page.waitForFunction(() => document.querySelector('.dx-demo-preview-wide video').currentTime > 0.3, null, { timeout: 15000 });
  });
});

test('short laptop window: "Interactive demo" shows the whole stage and its focused Start button', async () => {
  await onPage({ viewport: { width: 1280, height: 720 } }, async (page) => {
    await page.click('[data-demo-jump]');
    await page.waitForTimeout(1500);
    const navBottom = (await box(page, '.dx-localnav')).bottom;
    const stage = await box(page, '.dx-demo-stage');
    assert.ok(stage.top >= navBottom && stage.bottom <= 720, `stage ${stage.top}-${stage.bottom}`);
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-demo-start')), true);
  });
});

test('desktop: the title block sits 56 px under the nav, and the Live demo band reaches both window edges', async () => {
  await onPage(desktop, async (page) => {
    assert.equal(Math.round((await box(page, '.dx-title h1')).top - (await box(page, '.dx-localnav')).bottom), 56);
    // One screen row through the band: the band's grey at x = 2 and at the right edge.
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#live-demo').getBoundingClientRect().top + window.scrollY - 100));
    await page.waitForTimeout(300);
    const png = await page.screenshot({ clip: { x: 0, y: 160, width: 1440, height: 1 } });
    const edges = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = new OffscreenCanvas(img.width, 1);
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = (x) => [...g.getImageData(x, 0, 1, 1).data.slice(0, 3)];
      return [px(2), px(img.width - 3)];
    }, png.toString('base64'));
    assert.deepEqual(edges, [[245, 245, 247], [245, 245, 247]]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440);
  });
});

test('graph: every node shows its play glyph from the first frame; a click during the unlocking plays that task at full opacity', async () => {
  await onPage(desktop, async (page) => {
    await page.evaluate(() => document.querySelector('#prerequisite-graph').scrollIntoView({ block: 'start' }));
    assert.equal(await page.evaluate(() => document.querySelector('[data-unlock]').dataset.state), 'anim');
    const glyphs = await page.evaluate(() =>
      [...document.querySelectorAll('.dx-node')].map((node) => node.querySelector('.dx-node-play')?.getBoundingClientRect().width ?? 0)
    );
    assert.equal(glyphs.length, 15);
    assert.ok(glyphs.every((w) => w >= 9), `glyph widths ${glyphs}`);
    await page.waitForFunction(() => document.querySelector('.dx-unlock-anim video').currentTime > 1.5, null, { timeout: 15000 });
    await page.click('.dx-node[data-task="TL"]');
    assert.equal(await page.evaluate(() => document.querySelector('[data-unlock]').dataset.state), 'explore');
    await page.waitForFunction(() => {
      const v = document.querySelector('.dx-unlock-clip video');
      return v.currentSrc.endsWith('/node_TL_common.mp4') && !v.paused && v.currentTime > 0.2;
    }, null, { timeout: 15000 });
    const look = await page.evaluate(() => ({
      clip: getComputedStyle(document.querySelector('.dx-unlock-clip')).opacity,
      end: getComputedStyle(document.querySelector('.dx-unlock-endframe')).opacity
    }));
    assert.deepEqual(look, { clip: '1', end: '1' });
  });
});

test('phone: no horizontal scroll, the title links take at most two rows, the formula scrolls in its own box', async () => {
  await onPage(phone, async (page, errors) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    const tops = await page.evaluate(() => [...new Set([...document.querySelectorAll('.dx-title .dx-links > li')].map((li) => Math.round(li.getBoundingClientRect().top)))]);
    assert.ok(tops.length <= 2, `rows ${tops}`);
    const formula = await page.evaluate(() => {
      const el = document.querySelector('.dx-formula');
      return { width: el.getBoundingClientRect().width, overflow: getComputedStyle(el).overflowX };
    });
    assert.ok(formula.width <= 390 && formula.overflow === 'auto', JSON.stringify(formula));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dx-hero-phone')).display), 'block');
    // The encoding figure's labels stay readable (at least 12 px on screen).
    const label = await page.evaluate(() => {
      const svg = document.querySelector('.dx-encoding-plot');
      return parseFloat(getComputedStyle(svg.querySelector('text')).fontSize) * svg.getScreenCTM().a;
    });
    assert.ok(label >= 12, `encoding label ${label} px`);
    // A control focused from below (as with Shift+Tab) scrolls into view under the sticky nav, not behind it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.focus('.dx-segmented button');
    const focused = await page.evaluate(() => document.activeElement.getBoundingClientRect().top);
    assert.ok(focused >= (await box(page, '.dx-localnav')).bottom, `focused control at ${focused}`);
    assert.deepEqual(errors, []);
  });
});
