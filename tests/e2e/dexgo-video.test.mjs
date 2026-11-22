// The /dexgo/ project video in a real browser, against the running preview of dist/.
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome, which
// plays H.264 and AAC). Chrome runs with its desktop autoplay policy, so only muted playback may start on its own.
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

/** State of the project video and its Sound on button. */
const player = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('video[data-player]');
    const sound = document.querySelector('[data-sound-on]');
    const box = video.getBoundingClientRect();
    return {
      time: video.currentTime,
      paused: video.paused,
      muted: video.muted,
      soundShown: !sound.hidden,
      width: box.width,
      height: box.height
    };
  });

/** Start time in seconds of the source's media fragment (#t=), where the page's playback begins. */
const fragmentStart = (page) =>
  page.evaluate(() => Number(/#t=([\d.]+)/.exec(document.querySelector('video[data-player]').currentSrc)?.[1]));

/** Boxes (CSS px, page coordinates) of the Sound on button, the Pause videos button and the player. */
const boxes = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, height: r.height };
    };
    return { sound: box('[data-sound-on]'), toggle: box('[data-video-toggle]'), video: box('video[data-player]') };
  });

const wait = (page, ms) => page.waitForTimeout(ms);
const playing = (page) => page.waitForFunction(() => !document.querySelector('video[data-player]').paused, null, { timeout: 10000 });
const advanced = (page, from) =>
  page.waitForFunction((t) => document.querySelector('video[data-player]').currentTime > t + 0.5, from, { timeout: 10000 });
const scrollAway = (page) => page.evaluate(() => document.querySelector('#method-overview').scrollIntoView());
const scrollTop = (page) => page.evaluate(() => window.scrollTo(0, 0));

test('the project video starts muted, pauses out of view and resumes in view until the reader turns the sound on', async () => {
  await onPage(desktop, async (page, errors) => {
    await playing(page);
    const start = await player(page);
    assert.equal(start.muted, true, 'starts muted');
    assert.equal(start.soundShown, true, 'Sound on is shown while muted');
    assert.deepEqual([Math.round(start.width), Math.round(start.height)], [800, 450], 'fills the 800 px column at 16:9');
    // Playback began at the fragment's start (past the fade from white), not at 0.
    const begin = await fragmentStart(page);
    assert.ok(begin > 0, `a #t= start (${begin})`);
    const firstPlayed = await page.evaluate(() => document.querySelector('video[data-player]').played.start(0));
    assert.ok(Math.abs(firstPlayed - begin) < 0.05, `first played at ${firstPlayed} s`);
    // Sound on sits beside Pause videos in the title block, above the player, on the first screen.
    const box = await boxes(page);
    assert.ok(Math.abs(box.sound.top + box.sound.height / 2 - (box.toggle.top + box.toggle.height / 2)) < 2, 'one row');
    assert.ok(box.sound.bottom <= box.video.top, 'above the player, not over it');
    await advanced(page, start.time);

    await scrollAway(page);
    await page.waitForFunction(() => document.querySelector('video[data-player]').paused, null, { timeout: 5000 });
    const away = (await player(page)).time;
    await wait(page, 600);
    assert.equal((await player(page)).time, away, 'rests out of view');
    await scrollTop(page);
    await playing(page);
    await advanced(page, away);

    // The page-level button pauses and resumes it; so does the demo's suspend, while it is still the page's.
    await page.click('[data-video-toggle]');
    assert.equal((await player(page)).paused, true, 'Pause videos pauses it');
    await page.click('[data-video-toggle]');
    await playing(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('clips:suspend')));
    assert.equal((await player(page)).paused, true, 'the running demo rests it');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('clips:resume')));
    await playing(page);

    await page.click('[data-sound-on]');
    const heard = await player(page);
    assert.equal(heard.muted, false, 'Sound on unmutes');
    assert.equal(heard.soundShown, false, 'and goes');
    assert.equal(heard.paused, false, 'the video keeps playing');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'VIDEO', 'focus moves to the player');

    // The reader's now: out of view and under the demo's suspend it plays on.
    await scrollAway(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('clips:suspend')));
    await wait(page, 800);
    assert.equal((await player(page)).paused, false, 'plays on out of view and under suspend');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('clips:resume')));
    await scrollTop(page);

    // "Pause videos" still pauses it, and "Play videos" resumes what it paused.
    await page.click('[data-video-toggle]');
    assert.equal((await player(page)).paused, true);
    await page.click('[data-video-toggle]');
    await playing(page);

    // Scrubbing.
    await page.evaluate(() => (document.querySelector('video[data-player]').currentTime = 120));
    await page.waitForFunction(() => !document.querySelector('video[data-player]').seeking, null, { timeout: 10000 });
    await advanced(page, 120);
    assert.deepEqual(errors, []);
  });
});

test('the reader who pauses the muted video keeps it paused when it comes back into view', async () => {
  await onPage(desktop, async (page) => {
    await playing(page);
    await page.evaluate(() => document.querySelector('video[data-player]').pause()); // as the player's own button
    await scrollAway(page);
    await wait(page, 400);
    await scrollTop(page);
    await wait(page, 800);
    assert.equal((await player(page)).paused, true, 'no auto-resume after the reader paused it');
  });
});

test('under reduced motion the video shows its poster and plays only when asked', async () => {
  await onPage({ ...desktop, reducedMotion: 'reduce' }, async (page, errors) => {
    await wait(page, 1500);
    const still = await player(page);
    assert.equal(still.paused, true, 'no autoplay');
    assert.ok(Math.abs(still.time - (await fragmentStart(page))) < 0.05, `rests at the fragment's start (${still.time})`);
    assert.equal(await page.evaluate(() => document.querySelector('video[data-player]').played.length), 0, 'nothing played');
    await page.click('[data-sound-on]');
    await playing(page);
    assert.equal((await player(page)).muted, false, 'Sound on plays it with sound');
    assert.deepEqual(errors, []);
  });
});

test('on a phone the video fills the column at 16:9 and Sound on sits beside Pause videos on the first screen', async () => {
  await onPage(phone, async (page, errors) => {
    await playing(page);
    const state = await player(page);
    const column = await page.evaluate(() => document.querySelector('.dx-hero').getBoundingClientRect().width);
    assert.equal(Math.round(state.width), Math.round(column));
    assert.ok(Math.abs(state.height - (state.width * 9) / 16) < 1, `${state.width} x ${state.height} is 16:9`);
    const box = await boxes(page);
    assert.ok(Math.abs(box.sound.top - box.toggle.top) < 2, 'one row with Pause videos');
    assert.ok(box.sound.bottom <= Math.min(box.video.top, phone.viewport.height), 'above the player, on the first screen');
    assert.ok(box.sound.height >= 32, `${box.sound.height} px tall`);
    assert.deepEqual(errors, []);
  });
});

test('a muted video the reader took over rests out of view and resumes in view, unless the page videos were paused', async () => {
  await onPage(desktop, async (page, errors) => {
    await playing(page);
    // The reader pauses and plays it again with the player's own button (muted): it is the reader's now.
    await page.evaluate(() => document.querySelector('video[data-player]').pause());
    await page.evaluate(() => document.querySelector('video[data-player]').play());
    await playing(page);
    await scrollAway(page);
    await page.waitForFunction(() => document.querySelector('video[data-player]').paused, null, { timeout: 5000 });
    const away = (await player(page)).time;
    await scrollTop(page);
    await playing(page);
    await advanced(page, away);

    // Pause videos while it rests out of view: back in view it stays paused until Play videos.
    await scrollAway(page);
    await page.waitForFunction(() => document.querySelector('video[data-player]').paused, null, { timeout: 5000 });
    await page.evaluate(() => document.querySelector('[data-video-toggle]').click());
    await scrollTop(page);
    await wait(page, 800);
    assert.equal((await player(page)).paused, true, 'Pause videos holds it');
    await page.click('[data-video-toggle]');
    await playing(page);
    assert.deepEqual(errors, []);
  });
});

test('picture-in-picture started while muted is the reader\'s: it plays on when the page scrolls on', async (t) => {
  await onPage(desktop, async (page, errors) => {
    if (!(await page.evaluate(() => document.pictureInPictureEnabled))) return t.skip('no picture-in-picture here');
    await playing(page);
    // A page button stands in for the player's own picture-in-picture control (it needs a real click).
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'pip';
      button.textContent = 'PiP';
      button.style.cssText = 'position:fixed;top:0;left:0;z-index:9';
      button.onclick = () => document.querySelector('video[data-player]').requestPictureInPicture();
      document.body.append(button);
    });
    await page.click('#pip');
    await page.waitForFunction(() => document.pictureInPictureElement !== null, null, { timeout: 5000 });
    await scrollAway(page);
    await wait(page, 800);
    const state = await player(page);
    assert.equal(state.paused, false, 'plays on in picture-in-picture out of view');
    assert.equal(state.muted, true);
    await page.evaluate(() => document.exitPictureInPicture());
    // Back on the page, still muted and out of view: it rests again.
    await page.waitForFunction(() => document.querySelector('video[data-player]').paused, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  });
});
