// Autoplay on load, in a real browser against the running preview of dist/ (clipPlayback.ts, ProjectCard.astro).
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome).
// A reader who never scrolls sees the clips on the first screen move, also where the bottom of a short screen cuts
// them (a 1366 x 625 laptop window, an iPhone SE). When the browser refuses autoplay, the clip keeps its poster with a
// play mark and the first press, tap or key anywhere starts it; a scroll retries without making the mark flicker.
// A pause chosen in one tab never reaches a new visitor. prefers-reduced-motion stops none of this.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const desktop = (width, height) => ({ viewport: { width, height } });
const phone = (width, height) => ({
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
});

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
});
after(() => browser?.close());

const open = async (options, path, run, init) => {
  const context = await browser.newContext(options);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await run(page, errors, context);
  } finally {
    await context.close();
  }
};

/** The looping units with a part on screen (their selector index), with whether a video of each moves. */
const onScreen = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-play-unit]')]
      .map((unit, index) => {
        const box = unit.getBoundingClientRect();
        const seen = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
        const videos = [...unit.querySelectorAll('video')];
        return {
          index,
          once: unit.dataset.playUnit === 'once',
          seen,
          share: box.height ? seen / box.height : 0,
          moving: videos.some((v) => !v.paused && v.currentTime > 0.1)
        };
      })
      .filter((unit) => unit.seen > 0 && !unit.once)
  );

const firstScreen = [
  ['desktop 1366 x 625 (hero 44 % on screen)', desktop(1366, 625), '/dexgo/'],
  ['desktop 1280 x 585 (1080p at 150 %)', desktop(1280, 585), '/dexgo/'],
  ['iPhone SE 375 x 548 (hero 18 % on screen)', phone(375, 548), '/dexgo/'],
  ['Pixel 7 412 x 839', phone(412, 839), '/dexgo/'],
  ['homepage card, desktop 1280 x 585 (card 42 % on screen)', desktop(1280, 585), '/']
];
/** Waits until every looping clip with a part on the first screen moves, with the page never scrolled. */
const firstScreenPlays = async (page) => {
  await page.waitForFunction(() => document.querySelector('[data-play-unit] video'), null, { timeout: 10000 });
  const units = await onScreen(page);
  assert.ok(units.length > 0, 'a clip is on the first screen');
  await page.waitForFunction(
    (indices) => {
      const all = document.querySelectorAll('[data-play-unit]');
      return indices.every((i) => [...all[i].querySelectorAll('video')].some((v) => !v.paused && v.currentTime > 0.1));
    },
    units.map((unit) => unit.index),
    { timeout: 10000 }
  );
  assert.equal(await page.evaluate(() => scrollY), 0, 'the page was not scrolled');
};
for (const [name, options, path] of firstScreen) {
  test(`load without scrolling starts every looping clip on the first screen: ${name}`, async () => {
    await open(options, path, async (page, errors) => {
      await firstScreenPlays(page);
      assert.deepEqual(errors, []);
    });
  });
}

// prefers-reduced-motion: reduce (Windows "Animation effects" off, macOS / iOS "Reduce motion", Android "Remove
// animations", many remote sessions): the clips are page content and autoplay as without it (owner 2026-11-23).
const reducedScreens = [
  ['desktop 1440 x 900', desktop(1440, 900), '/dexgo/'],
  ['iPhone SE 375 x 548', phone(375, 548), '/dexgo/'],
  ['Pixel 7 412 x 839', phone(412, 839), '/dexgo/'],
  ['homepage card, desktop 1440 x 900', desktop(1440, 900), '/']
];
for (const [name, options, path] of reducedScreens) {
  test(`reduced motion: load without scrolling still starts the teaser and every clip on the first screen: ${name}`, async () => {
    await open({ ...options, reducedMotion: 'reduce' }, path, async (page, errors) => {
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await firstScreenPlays(page);
      if (path === '/dexgo/') {
        await heroMoving(page, hero(options.viewport.width));
        assert.equal(await page.getAttribute('[data-video-toggle]', 'aria-label'), 'Pause all motion');
      }
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.controls)), false, 'no native controls');
      assert.deepEqual(errors, []);
    });
  });
}

// Refused autoplay (iOS Low Power Mode, Safari "Never Auto-Play"): play() rejects with NotAllowedError unless it runs
// inside a user activation (a trusted keydown, mouse press, touch release or click; not touchstart, scroll or wheel).
// `window.__allowAt` (performance.now() ms) lets every play() through from then on: a refusal that ends by itself.
const refuseAutoplay = () => {
  let gesture = false;
  window.__plays = 0;
  window.__allowAt = Infinity;
  const activating = (event) =>
    event.type === 'keydown' ||
    event.type === 'click' ||
    event.type === 'touchend' ||
    (event.type === 'pointerdown' && event.pointerType === 'mouse') ||
    (event.type === 'pointerup' && event.pointerType !== 'mouse');
  for (const type of ['keydown', 'click', 'touchend', 'pointerdown', 'pointerup']) {
    window.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted || !activating(event)) return;
        gesture = true;
        setTimeout(() => (gesture = false));
      },
      true
    );
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__plays += 1;
    if (!gesture && performance.now() < window.__allowAt) return Promise.reject(new DOMException('refused', 'NotAllowedError'));
    return play.call(this);
  };
};
const hero = (width) => (width < 640 ? '.dx-hero-phone' : '.dx-hero-wide');
const heroMoving = (page, selector) =>
  page.waitForFunction((s) => {
    const v = document.querySelector(`${s} video`);
    return !v.paused && v.currentTime > 0.1;
  }, selector, { timeout: 10000 });
const refusedShown = async (page, selector) => {
  await page.waitForSelector(`${selector}[data-play-refused]`, { timeout: 10000 });
  assert.ok(await page.evaluate((s) => document.querySelector(`${s} video`).getAttribute('poster'), selector), 'poster shown');
  assert.equal(await page.evaluate((s) => getComputedStyle(document.querySelector(s), '::after').width, selector), '48px', 'play mark');
};
const notRefused = (page, selector) =>
  page.waitForFunction((s) => !document.querySelector(s).hasAttribute('data-play-refused'), selector, { timeout: 5000 });

for (const [name, gesture] of [
  ['a key press', (page) => page.keyboard.press('Shift')],
  ['a mouse press (no click)', async (page) => {
    await page.mouse.move(40, 300);
    await page.mouse.down();
  }]
]) {
  test(`play() refused: the hero shows its poster with a play mark, and ${name} anywhere starts it`, async () => {
    await open(desktop(1366, 625), '/dexgo/', async (page, errors) => {
      const selector = hero(1366);
      await refusedShown(page, selector);
      await gesture(page);
      await heroMoving(page, selector);
      await notRefused(page, selector);
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.deepEqual(errors, []);
    }, refuseAutoplay);
  });
}

test('play() refused on a phone: a tap beside the clip starts the hero', async () => {
  await open(phone(390, 664), '/dexgo/', async (page, errors) => {
    const selector = hero(390);
    await refusedShown(page, selector);
    await page.touchscreen.tap(6, 300); // the left gutter: no link or button there
    await heroMoving(page, selector);
    await notRefused(page, selector);
    assert.deepEqual(errors, []);
  }, refuseAutoplay);
});

test('play() refused on the homepage card: it shows a play mark, and a key press starts it', async () => {
  await open(desktop(1440, 900), '/', async (page, errors) => {
    const selector = '.project-card-media';
    await page.waitForSelector(`${selector}[data-play-refused]`, { timeout: 10000 });
    assert.equal(await page.evaluate((s) => getComputedStyle(document.querySelector(s), '::after').width, selector), '48px');
    await page.keyboard.press('Shift');
    await heroMoving(page, selector);
    await notRefused(page, selector);
    assert.deepEqual(errors, []);
  }, refuseAutoplay);
});

test('play() refused: scrolling retries (at most every 250 ms) and keeps the play mark steady until it plays', async () => {
  await open(desktop(1366, 625), '/dexgo/', async (page, errors) => {
    const selector = hero(1366);
    await refusedShown(page, selector);
    // a mark that came and went during the scroll would be a flicker
    await page.evaluate((s) => {
      window.__markLost = 0;
      new MutationObserver(() => {
        if (!document.querySelector(s).hasAttribute('data-play-refused')) window.__markLost += 1;
      }).observe(document.querySelector(s), { attributes: true, attributeFilter: ['data-play-refused'] });
    }, selector);
    const plays0 = await page.evaluate(() => window.__plays);
    await page.mouse.move(600, 300);
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, i % 2 ? -12 : 12);
      await page.waitForTimeout(50);
    }
    const still = await page.evaluate((s) => ({ lost: window.__markLost, plays: window.__plays, mark: document.querySelector(s).hasAttribute('data-play-refused') }), selector);
    assert.equal(still.lost, 0, 'the mark stays while play() is still refused');
    assert.ok(still.mark, 'still refused after a scroll (a scroll is no user activation)');
    assert.ok(still.plays - plays0 <= 30, `play() retries are throttled (${still.plays - plays0})`);
    // the refusal ends (e.g. Low Power Mode turned off): the next scroll starts the clip, with no press or tap
    await page.evaluate(() => (window.__allowAt = performance.now()));
    await page.mouse.wheel(0, 12);
    await heroMoving(page, selector);
    await notRefused(page, selector);
    assert.deepEqual(errors, []);
  }, refuseAutoplay);
});

test('a pause chosen in one tab keeps that tab paused after a reload, and never reaches a new visitor', async () => {
  await open(desktop(1440, 900), '/dexgo/', async (page, errors, context) => {
    const selector = hero(1440);
    await heroMoving(page, selector);
    await page.locator('[data-video-toggle]').click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate((s) => document.querySelector(`${s} video`).paused, selector), true, 'same tab: paused');
    // a new tab of the same visitor (no opener) and a new visitor both start playing
    const other = await context.newPage();
    await other.goto(`${base}/dexgo/`, { waitUntil: 'domcontentloaded' });
    await heroMoving(other, selector);
    assert.deepEqual(errors, []);
  });
  await open(desktop(1440, 900), '/dexgo/', async (page) => heroMoving(page, hero(1440)));
});
