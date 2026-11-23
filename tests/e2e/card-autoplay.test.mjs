// Autoplay of the homepage project card on load, in a real browser against the running preview of dist/
// (clipPlayback.ts, ProjectCard.astro). The DexGO project page's own autoplay tests live in its repository
// (egoista0326/dexgo, tests/e2e/dexgo-autoplay.test.mjs).
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome).
// A reader who never scrolls sees the card's clip move, also where the bottom of a short screen cuts it; when the
// browser refuses autoplay, the clip keeps its poster with a play mark and the first key press starts it.
// prefers-reduced-motion stops none of this.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const desktop = (width, height) => ({ viewport: { width, height } });

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
test('load without scrolling starts the homepage card on the first screen: desktop 1280 x 585 (card 42 % on screen)', async () => {
  await open(desktop(1280, 585), '/', async (page, errors) => {
    await firstScreenPlays(page);
    assert.deepEqual(errors, []);
  });
});

// prefers-reduced-motion: reduce: the card's clip is page content and autoplays as without it (owner 2026-11-23).
test('reduced motion: load without scrolling still starts the homepage card: desktop 1440 x 900', async () => {
  await open({ ...desktop(1440, 900), reducedMotion: 'reduce' }, '/', async (page, errors) => {
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    await firstScreenPlays(page);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.controls)), false, 'no native controls');
    assert.deepEqual(errors, []);
  });
});

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
const clipMoving = (page, selector) =>
  page.waitForFunction((s) => {
    const v = document.querySelector(`${s} video`);
    return !v.paused && v.currentTime > 0.1;
  }, selector, { timeout: 10000 });
const notRefused = (page, selector) =>
  page.waitForFunction((s) => !document.querySelector(s).hasAttribute('data-play-refused'), selector, { timeout: 5000 });


test('play() refused on the homepage card: it shows a play mark, and a key press starts it', async () => {
  await open(desktop(1440, 900), '/', async (page, errors) => {
    const selector = '.project-card-media';
    await page.waitForSelector(`${selector}[data-play-refused]`, { timeout: 10000 });
    assert.equal(await page.evaluate((s) => getComputedStyle(document.querySelector(s), '::after').width, selector), '48px');
    await page.keyboard.press('Shift');
    await clipMoving(page, selector);
    await notRefused(page, selector);
    assert.deepEqual(errors, []);
  }, refuseAutoplay);
});
