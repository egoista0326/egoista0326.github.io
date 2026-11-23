// The /dexgo/ "Problem definition" figure in a real browser: the owner's two behaviours (2026-11-23).
// (a) No click: part 1, part 2, part 3 highlighted one after another, then the motion, and the whole sequence repeats.
// (b) After a click on a label: that part highlighted, then the motion, which loops with the part still highlighted and
//     never returns to (a). Plus: the nav's pause holds it, reduced motion changes nothing of (a) and (b), refused
//     autoplay (iOS Low Power Mode) keeps the sequence going and plays after a tap, and a stalled clip does not stop
//     the sequence.
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome).
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

const onFigure = async (options, run, { init } = {}) => {
  const context = await browser.newContext(options);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${base}/dexgo/`, { waitUntil: 'load' });
    await page.evaluate(() => document.querySelector('#problem .pd-stage').scrollIntoView({ block: 'center' }));
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
};

/** The figure's state: the view shown, the lit part, the pressed labels and the clip's time. */
const state = (page) =>
  page.evaluate(() => {
    const fig = document.querySelector('[data-problem]');
    const video = fig.querySelector('video');
    return {
      view: fig.dataset.view,
      part: fig.dataset.part,
      lit: [...fig.querySelectorAll('.pd-part.is-lit')].map((b) => b.dataset.partKey),
      pressed: [...fig.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.partKey),
      time: video.currentTime,
      playing: !video.paused
    };
  });

/** Polls the figure every 100 ms for `ms` and returns the distinct views in the order they appeared. */
const viewsDuring = async (page, ms) => {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { view } = await state(page);
    if (seen.at(-1) !== view) seen.push(view);
    await page.waitForTimeout(100);
  }
  return seen;
};

/** Clicks the nav's pause button where it is on screen (a locator click would first scroll the sticky nav). */
const clickNavPause = async (page) => {
  const box = await page.locator('[data-video-toggle]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

const waitView = (page, view, timeout = 30000) =>
  page.waitForFunction((v) => document.querySelector('[data-problem]').dataset.view === v, view, { timeout });

test('problem definition (a): without a click, the three parts one after another, then the motion, repeated', async () => {
  await onFigure(desktop, async (page) => {
    await waitView(page, 'rel');
    // rel -> fingers -> world -> motion -> rel: one whole cycle (3 x 2.4 s + the 10.4 s clip) and the next start
    const seen = await viewsDuring(page, 19500);
    const cycle = seen.slice(seen.indexOf('rel'));
    assert.deepEqual(cycle.slice(0, 5), ['rel', 'fingers', 'world', 'motion', 'rel']);
    const now = await state(page);
    assert.deepEqual(now.pressed, [], 'no label pressed in the default sequence');
  });
});

test('problem definition (b): a click highlights that part, then the motion loops with it lit, never back to (a)', async () => {
  await onFigure(desktop, async (page) => {
    await waitView(page, 'rel');
    await page.getByRole('button', { name: 'Finger configuration' }).click();
    let now = await state(page);
    assert.equal(now.view, 'fingers');
    assert.deepEqual(now.pressed, ['fingers']);
    await waitView(page, 'motion', 5000);
    now = await state(page);
    assert.ok(now.playing, 'the motion plays');
    assert.deepEqual(now.lit, ['fingers'], 'the part stays highlighted during the motion');
    assert.equal(await page.locator('[data-overlay="fingers"].is-on').count(), 1, 'its overlay is drawn on the motion');
    // past the clip's end (10.4 s): still the motion, looped (time wrapped), the same part lit, no auto step shown
    const before = now.time;
    const seen = await viewsDuring(page, 12000);
    assert.deepEqual(seen, ['motion']);
    now = await state(page);
    assert.ok(now.playing && now.time < before + 12 - 1, `looped (time ${now.time.toFixed(2)})`);
    assert.deepEqual(now.lit, ['fingers']);
    assert.deepEqual(now.pressed, ['fingers']);
    // another label: that part, then its motion
    await page.getByRole('button', { name: 'Object world pose' }).click();
    now = await state(page);
    assert.equal(now.view, 'world');
    assert.deepEqual(now.pressed, ['world']);
    await waitView(page, 'motion', 5000);
    assert.deepEqual((await state(page)).lit, ['world']);
  });
});

test('problem definition: the nav pause holds the sequence; off screen it holds too', async () => {
  await onFigure(desktop, async (page) => {
    await waitView(page, 'motion', 15000);
    await clickNavPause(page);
    await page.waitForTimeout(300);
    const held = await state(page);
    assert.equal(held.playing, false);
    await page.waitForTimeout(3000);
    assert.equal((await state(page)).time, held.time);
    await clickNavPause(page);
    await page.waitForTimeout(500);
    assert.ok((await state(page)).playing, 'plays again after the nav resumes');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#results').offsetTop));
    await page.waitForTimeout(500);
    assert.equal((await state(page)).playing, false, 'off screen it rests');
  });
});

test('problem definition, reduced motion and phone: the same sequence as without it, the motion plays, no play button', async () => {
  // Owner 2026-11-23: the figure is page content; prefers-reduced-motion keeps only its fades off.
  await onFigure({ ...phone, reducedMotion: 'reduce' }, async (page) => {
    await waitView(page, 'rel', 5000);
    const seen = await viewsDuring(page, 8000);
    assert.deepEqual(seen.slice(0, 4), ['rel', 'fingers', 'world', 'motion']);
    await page.waitForFunction(() => document.querySelector('[data-problem] video').currentTime > 0.3, null, { timeout: 10000 });
    assert.ok((await state(page)).playing, 'the motion plays by itself');
    assert.equal(await page.getByRole('button', { name: 'Play the motion' }).isVisible(), false, 'no play button');
    // labels are reachable by keyboard and say what they highlight; (b) as without reduced motion
    const label = page.getByRole('button', { name: 'Relative object pose' });
    await label.focus();
    await page.keyboard.press('Enter');
    assert.equal((await state(page)).view, 'rel');
    assert.match((await label.getAttribute('aria-describedby')) ?? '', /^pd-desc-rel$/);
    await waitView(page, 'motion', 5000);
    assert.deepEqual((await state(page)).lit, ['rel']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  });
});

// Refused autoplay as on iOS in Low Power Mode, for the figure's clip only: play() is refused (NotAllowedError) unless
// it is called inside a tap or click, and a clip once played inside one may play later (the element is unlocked).
const refuseAutoplay = () => {
  let gesture = false;
  for (const type of ['click', 'touchend', 'keydown', 'keyup']) {
    window.addEventListener(
      type,
      () => {
        gesture = true;
        setTimeout(() => (gesture = false), 0);
      },
      true
    );
  }
  const unlocked = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.closest('[data-problem]')) {
      if (gesture) unlocked.add(this);
      else if (!unlocked.has(this)) return Promise.reject(new DOMException('play() refused', 'NotAllowedError'));
    }
    return play.call(this);
  };
};
const refusedMark = (page) => page.evaluate(() => document.querySelector('[data-problem]').hasAttribute('data-play-refused'));

test('problem definition, autoplay refused (a): the parts go on, the play button shows, a tap anywhere lets it play', async () => {
  await onFigure(
    phone,
    async (page) => {
      await page.waitForFunction(() => document.querySelector('[data-problem]').hasAttribute('data-play-refused'), null, { timeout: 15000 });
      const play = page.getByRole('button', { name: 'Play the motion' });
      assert.ok(await play.isVisible(), 'the play button offers the motion');
      // the sequence keeps cycling through the three parts and never rests on the motion
      const seen = await viewsDuring(page, 8000);
      assert.ok(!seen.includes('motion'), `no motion while refused (${seen.join(' ')})`);
      for (const part of ['rel', 'fingers', 'world']) assert.ok(seen.includes(part), `${part} shown (${seen.join(' ')})`);
      // a tap anywhere (here the section heading) unlocks the clip (the mark goes once its play() is no longer
      // refused); the motion then plays at its turn
      await page.locator('#problem .dx-prose').tap();
      await page.waitForFunction(() => !document.querySelector('[data-problem]').hasAttribute('data-play-refused'), null, { timeout: 3000 });
      assert.equal(await play.isVisible(), false);
      await waitView(page, 'motion', 12000);
      await page.waitForTimeout(600);
      const now = await state(page);
      assert.ok(now.playing && now.time > 0, `the motion plays (time ${now.time.toFixed(2)})`);
    },
    { init: refuseAutoplay }
  );
});

test('problem definition, autoplay refused (b): a tap on a label plays the motion after the part', async () => {
  await onFigure(
    phone,
    async (page) => {
      await waitView(page, 'rel');
      await page.getByRole('button', { name: 'Finger configuration' }).tap();
      assert.equal((await state(page)).view, 'fingers');
      await waitView(page, 'motion', 5000);
      await page.waitForTimeout(800);
      const now = await state(page);
      assert.ok(now.playing && now.time > 0, `the motion plays from the timer (time ${now.time.toFixed(2)})`);
      assert.deepEqual(now.lit, ['fingers']);
      assert.equal(await refusedMark(page), false);
    },
    { init: refuseAutoplay }
  );
});

test('problem definition, autoplay refused: the play button plays the motion at once', async () => {
  await onFigure(
    phone,
    async (page) => {
      await page.waitForFunction(() => document.querySelector('[data-problem]').hasAttribute('data-play-refused'), null, { timeout: 15000 });
      await page.getByRole('button', { name: 'Play the motion' }).tap();
      await page.waitForTimeout(600);
      const now = await state(page);
      assert.equal(now.view, 'motion');
      assert.ok(now.playing, 'plays');
      assert.equal(await refusedMark(page), false);
    },
    { init: refuseAutoplay }
  );
});

test('problem definition: a clip that never loads does not stop the sequence (stall watchdog)', async () => {
  const context = await browser.newContext(desktop);
  // the motion clip's requests never get an answer
  await context.route('**/pd_motion.mp4', () => {});
  const page = await context.newPage();
  try {
    await page.goto(`${base}/dexgo/`, { waitUntil: 'load' });
    await page.evaluate(() => document.querySelector('#problem .pd-stage').scrollIntoView({ block: 'center' }));
    await waitView(page, 'motion', 15000);
    // reloaded twice after 4 s without progress each, then on with the parts
    await waitView(page, 'rel', 20000);
  } finally {
    await context.close();
  }
});
