// The /dexgo/ clips on a phone, in a real browser against the running preview of dist/ (clipPlayback.ts).
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome).
// A reader who stops on a clip sees its poster and then the clip playing, without scrolling away and back: on a slow
// connection, after a dropped request, and (with a tap) when the browser refuses autoplay (iOS Low Power Mode).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const phone = {
  viewport: { width: 412, height: 839 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
};
// Chrome DevTools "Slow 4G": 1.6 Mbps x 0.9 down, 750 kbps x 0.9 up, 150 ms x 3.75 latency.
const slow4g = { offline: false, latency: 562.5, downloadThroughput: (1.6e6 * 0.9) / 8, uploadThroughput: (750e3 * 0.9) / 8 };

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
});
after(() => browser?.close());

/** Opens /dexgo/ on a phone and runs `run(page, errors)`; `setup(context, page)` runs before the page loads. */
const onPhone = async (setup, run) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await setup?.(context, page);
    await page.goto(`${base}/dexgo/`, { waitUntil: 'domcontentloaded' });
    await run(page, errors);
  } finally {
    await context.close();
  }
};

/** Brings the first element matching `selector` to the middle of the screen (and leaves it there). */
const stopAt = (page, selector) => page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), selector);

/** Resolves once every video inside `selector` shows moving frames. */
const playing = (page, selector, timeout) =>
  page.waitForFunction(
    (s) => [...document.querySelector(s).querySelectorAll('video')].every((v) => !v.paused && v.readyState >= 3 && v.currentTime > 0.1),
    selector,
    { timeout }
  );

/** Whether every video inside `selector` has its poster set. */
const postersSet = (page, selector) =>
  page.evaluate((s) => [...document.querySelector(s).querySelectorAll('video')].every((v) => v.getAttribute('poster')), selector);

const stops = ['.dx-pair:nth-of-type(1) .dx-clip', '.dx-pair:nth-of-type(2) .dx-clip', '.dx-hand-panel:not([hidden]) .dx-carousel-item .dx-clip', '.dx-sizes'];

test('on a slow phone connection every clip a reader stops on shows its poster and starts playing', async () => {
  await onPhone(
    async (context, page) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', slow4g);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    },
    async (page, errors) => {
      await page.waitForTimeout(3000); // the reader starts at the top, with the teaser
      for (const stop of stops) {
        await stopAt(page, stop);
        await page.waitForTimeout(300);
        assert.ok(await postersSet(page, stop), `${stop}: posters set on arrival`);
        const t = Date.now();
        await playing(page, stop, 20000);
        // The bound is generous for the throttled emulation; the measured p90 is a few seconds (see the notes).
        assert.ok(Date.now() - t < 20000, `${stop} plays without scrolling`);
      }
      assert.deepEqual(errors, []);
    }
  );
});

test('a clip whose request is dropped is loaded again and plays, without scrolling away and back', async () => {
  let dropped = 0;
  await onPhone(
    async (context) => {
      await context.route('**/control_screwdriver_pair_crop.mp4', (route) => {
        if (dropped === 0) {
          dropped += 1;
          return route.abort('connectionreset');
        }
        return route.continue();
      });
    },
    async (page, errors) => {
      const stop = '.dx-pair:nth-of-type(1) .dx-clip';
      await stopAt(page, stop);
      await playing(page, stop, 15000);
      assert.equal(dropped, 1, 'the first request was dropped');
      assert.deepEqual(errors, []);
    }
  );
});

test('a clip paused by the browser while in view plays again without scrolling away and back', async () => {
  await onPhone(null, async (page, errors) => {
    const stop = '.dx-pair:nth-of-type(1) .dx-clip';
    await stopAt(page, stop);
    await playing(page, stop, 15000);
    // As the browser or the system pausing it (an interruption), not the page.
    await page.evaluate((s) => document.querySelector(`${s} video`).pause(), stop);
    await page.waitForFunction((s) => !document.querySelector(`${s} video`).paused, stop, { timeout: 3000 });
    assert.deepEqual(errors, []);
  });
});

test('when autoplay is refused the clip keeps its poster with a play mark, and a tap plays it', async () => {
  await onPhone(
    async (context) => {
      // As iOS Low Power Mode: play() rejects with NotAllowedError unless it runs while a real tap or click is being
      // dispatched (not navigator.userActivation: Playwright's evaluate() counts as a user gesture).
      await context.addInitScript(() => {
        let gesture = false;
        for (const type of ['click', 'touchend']) {
          window.addEventListener(
            type,
            (event) => {
              if (!event.isTrusted) return;
              gesture = true;
              setTimeout(() => (gesture = false));
            },
            true
          );
        }
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (!gesture) return Promise.reject(new DOMException('refused', 'NotAllowedError'));
          return play.call(this);
        };
      });
    },
    async (page, errors) => {
      const stop = '.dx-pair:nth-of-type(1) .dx-clip';
      await stopAt(page, stop);
      await page.waitForSelector(`${stop}[data-play-refused]`, { timeout: 10000 });
      assert.ok(await postersSet(page, stop), 'the poster is shown');
      const mark = await page.evaluate((s) => getComputedStyle(document.querySelector(s), '::after').width, stop);
      assert.equal(mark, '48px', 'the play mark is drawn');
      await page.tap(stop);
      await playing(page, stop, 15000);
      await page.waitForFunction((s) => !document.querySelector(s).hasAttribute('data-play-refused'), stop, { timeout: 5000 });
      assert.deepEqual(errors, []);
    }
  );
});
