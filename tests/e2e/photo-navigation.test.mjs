// Photo page navigation in a real browser, against the running preview of dist/.
// Run: npm run test:e2e   (BASE_URL defaults to http://127.0.0.1:4321, CHROME_PATH to /usr/bin/google-chrome)
// Each case opens its own browser context, so storage and history never leak between cases.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const desktop = { viewport: { width: 1440, height: 1000 } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
});
after(() => browser?.close());

/** Runs `run(page, context)` in a new browser context that records `is-returned` marks on tiles. */
const inContext = async (options, run) => {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__returnedIds = [];
    new MutationObserver((records) => {
      for (const { target } of records) {
        if (target.classList?.contains('is-returned')) window.__returnedIds.push(target.id);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  try {
    await run(await context.newPage(), context);
  } finally {
    await context.close();
  }
};

const slugOf = (url) => new URL(url).pathname.split('/').filter(Boolean).pop();
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const historyLength = (page) => page.evaluate(() => history.length);

/** Runs `action` and waits until the page has loaded a URL other than the current one. */
const navigate = async (page, action) => {
  const from = page.url();
  await Promise.all([page.waitForURL((url) => url.href !== from, { waitUntil: 'load' }), action()]);
};

/** Waits (up to `timeout`) for `predicate(arg)` in the page; the assertion that follows reports a miss. */
const settle = (page, predicate, arg, timeout = 3000) =>
  page.waitForFunction(predicate, arg, { timeout }).catch(() => undefined);

/** Where grid tile `#photo-<slug>` is: in the viewport, marked on return, its link focused. */
const tileState = (page, slug) =>
  page.evaluate((id) => {
    const item = document.getElementById(id);
    const box = item?.getBoundingClientRect();
    const fits = box ? box.height <= window.innerHeight : false;
    const inViewport = Boolean(
      box && (fits ? box.top >= -1 && box.bottom <= window.innerHeight + 1 : box.top < window.innerHeight && box.bottom > 0)
    );
    return {
      exists: Boolean(item),
      inViewport,
      marked: Boolean(item?.classList.contains('is-returned') || window.__returnedIds.includes(id)),
      focused: Boolean(item && document.activeElement === item.querySelector('a')),
      top: Math.round(box?.top ?? Number.NaN),
      bottom: Math.round(box?.bottom ?? Number.NaN)
    };
  }, `photo-${slug}`);

const tileIsBack = (id) => {
  const box = document.getElementById(id)?.getBoundingClientRect();
  return Boolean(box && box.bottom > 0 && box.top < window.innerHeight && window.__returnedIds.includes(id));
};

test('single-tag gallery: Next/arrows replace the entry, the back link goes back to the tile', async () => {
  await inContext(desktop, async (page) => {
    const gallery = `${base}/photography/tags/location/zurich/`;
    await page.goto(gallery);
    const tiles = page.locator('.photo-grid-link');
    const secondHref = await tiles.nth(1).getAttribute('href');
    assert.match(secondHref ?? '', /^\/photography\/tags\/location\/zurich\/[^/]+\/$/, 'tiles link to tag-context photo pages');

    await navigate(page, () => tiles.nth(1).click());
    assert.equal(new URL(page.url()).pathname, secondHref);
    assert.equal(await text(page.locator('[data-photo-position-short]')), '2 / 11');
    assert.equal(await text(page.locator('[data-photo-back]')), '← Back to Zurich');
    const length = await historyLength(page);

    await navigate(page, () => page.locator('[data-photo-pager="next"]').click());
    const third = slugOf(page.url());
    assert.ok(page.url().startsWith(gallery), `Next stays in the gallery (${page.url()})`);
    assert.equal(await text(page.locator('[data-photo-position-short]')), '3 / 11');
    assert.equal(await historyLength(page), length, 'Next replaces the history entry');

    await navigate(page, () => page.keyboard.press('ArrowRight'));
    assert.equal(await text(page.locator('[data-photo-position-short]')), '4 / 11', 'ArrowRight goes forward');
    assert.equal(await historyLength(page), length, 'ArrowRight replaces the history entry');

    await navigate(page, () => page.keyboard.press('ArrowLeft'));
    assert.equal(slugOf(page.url()), third, 'ArrowLeft goes back');
    assert.equal(await text(page.locator('[data-photo-position-short]')), '3 / 11');
    assert.equal(await historyLength(page), length, 'ArrowLeft replaces the history entry');

    await navigate(page, () => page.locator('[data-photo-back]').click());
    assert.equal(page.url(), gallery, 'the back link returns to the gallery URL itself (history.back, no hash)');
    assert.equal(await historyLength(page), length, 'history.back keeps the history length');
    await settle(page, tileIsBack, `photo-${third}`);
    const state = await tileState(page, third);
    assert.ok(state.inViewport, `tile #photo-${third} is in the viewport (top ${state.top}, bottom ${state.bottom})`);
    assert.ok(state.marked, `tile #photo-${third} has (or just had) class is-returned`);
    assert.ok(state.focused, 'keys were used on the photo page, so the tile link has focus');

    // One Back leaves the photo sequence.
    await navigate(page, () => page.locator('.photo-grid-link').first().click());
    await navigate(page, () => page.locator('[data-photo-pager="next"]').click());
    await page.goBack();
    assert.equal(page.url(), gallery, 'browser Back from a photo reached with Next returns to the gallery');
  });
});

test('filter page: results carry ?from=tags, the photo page follows them, the back link restores the filter', async () => {
  await inContext(desktop, async (page) => {
    const filterUrl = `${base}/photography/tags/?location=zurich`;
    await page.goto(filterUrl);
    const zurich = page.locator('input[name="location"][value="zurich"]');
    const rain = page.locator('input[name="condition"][value="rain"]');
    const visible = page.locator('[data-tag-search-results] .photo-grid-item:not([hidden])');
    const resultCount = page.locator('[data-tag-result-count]');

    assert.ok(await zurich.isChecked(), 'the Zurich box is restored from the query');
    assert.equal(await resultCount.getAttribute('role'), 'status', 'the result count is a status region');
    const count = await visible.count();
    assert.ok(count >= 2, `several Zurich results (${count})`);
    const firstHref = await visible.first().locator('a').getAttribute('href');
    assert.match(firstHref ?? '', /^\/photography\/[^/]+\/\?from=tags&location=zurich$/, 'results link to the standalone page with the filter');

    await navigate(page, () => visible.first().locator('a').click());
    assert.equal(await text(page.locator('[data-photo-position-short]')), `1 / ${count}`, 'the position counts the filtered results');
    assert.equal(await text(page.locator('[data-photo-back]')), '← Back to Photography Tags');

    await navigate(page, () => page.locator('[data-photo-pager="next"]').click());
    const second = slugOf(page.url());
    assert.equal(new URL(page.url()).search, '?from=tags&location=zurich', 'Next keeps the filter query');
    assert.equal(await text(page.locator('[data-photo-position-short]')), `2 / ${count}`);

    await navigate(page, () => page.locator('[data-photo-back]').click());
    assert.equal(page.url(), filterUrl, 'the back link returns to the filtered page (history.back, no hash)');
    assert.ok(await zurich.isChecked(), 'Zurich is still checked');
    assert.equal(await visible.count(), count, 'the same results are visible');
    assert.ok((await text(resultCount)).startsWith(`${count} `), 'the count line shows the filtered count');
    await settle(page, tileIsBack, `photo-${second}`);
    const state = await tileState(page, second);
    assert.ok(state.inViewport, `tile #photo-${second} is in the viewport (top ${state.top}, bottom ${state.bottom})`);
    assert.ok(state.marked, `tile #photo-${second} has (or just had) class is-returned`);

    // No Zurich photo was taken in the rain: that option gives no result, so it is disabled.
    assert.ok(await rain.isDisabled(), 'Rain is disabled while Zurich is ticked (zero results)');
    assert.equal(await text(rain.locator('xpath=..').locator('[data-tag-option-count]')), '0');
  });
});

test('deep link: the back link opens the filter page at the photo', async () => {
  await inContext(desktop, async (page) => {
    await page.goto(`${base}/photography/dsc-0534/`);
    const back = page.locator('[data-photo-back]');
    assert.equal(await back.getAttribute('href'), '/photography/tags/#photo-dsc-0534');
    const length = await historyLength(page);

    await navigate(page, () => back.click());
    assert.equal(page.url(), `${base}/photography/tags/#photo-dsc-0534`);
    assert.equal(await historyLength(page), length + 1, 'a normal navigation (new history entry)');
    await settle(page, (id) => {
      const box = document.getElementById(id)?.getBoundingClientRect();
      return Boolean(box && box.bottom > 0 && box.top < window.innerHeight);
    }, 'photo-dsc-0534');
    const state = await tileState(page, 'dsc-0534');
    assert.ok(state.exists, '#photo-dsc-0534 exists');
    assert.ok(state.inViewport, `#photo-dsc-0534 is in the viewport (top ${state.top}, bottom ${state.bottom})`);
  });
});

test('quiet view: F turns it on, it survives Next, Escape and a tap on the photo toggle it', async () => {
  await inContext(desktop, async (page) => {
    const isQuiet = () => page.evaluate(() => document.documentElement.classList.contains('is-photo-quiet'));
    await page.goto(`${base}/photography/selected/dsc-0046/`);
    assert.equal(await isQuiet(), false);

    await page.keyboard.press('f');
    assert.equal(await isQuiet(), true, 'F adds is-photo-quiet on <html>');

    await navigate(page, () => page.keyboard.press('ArrowRight'));
    assert.notEqual(slugOf(page.url()), 'dsc-0046', 'ArrowRight opens the next photo');
    assert.equal(await isQuiet(), true, 'the quiet view stays on for the next photo');

    await page.keyboard.press('Escape');
    assert.equal(await isQuiet(), false, 'Escape ends the quiet view');
    const url = page.url();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(page.url(), url, 'Escape without the quiet view stays on the photo');

    await page.locator('[data-photo-quiet-toggle] img').click();
    assert.equal(await isQuiet(), true, 'a click on the photo turns it on');
    await page.locator('[data-photo-quiet-toggle] img').click();
    assert.equal(await isQuiet(), false, 'a second click turns it off');
  });
});

/** A one-finger horizontal swipe of `dx` px on the photo (synthetic touch events, as swipe.ts reads them). */
const swipe = (page, dx) =>
  page.evaluate((dx) => {
    const target = document.querySelector('[data-photo-swipe]');
    const box = target.getBoundingClientRect();
    const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: box.top + box.height / 2 });
    const x0 = box.left + box.width / 2 - dx / 2;
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(x0)], changedTouches: [touch(x0)], bubbles: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(x0 + dx)], bubbles: true }));
  }, dx);

test('gallery ends: a project stops at its first and last photo (pager, arrow keys, swipe)', async () => {
  await inContext(phone, async (page) => {
    const gallery = '/photography/projects/moments-in-the-room/';
    await page.goto(`${base}${gallery}`);
    const hrefs = await page.locator('.photo-grid-link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const count = hrefs.length;
    assert.ok(count >= 3, `the project has several photos (${count})`);
    const pager = (side) => page.locator(`[data-photo-pager="${side}"]`);
    /** Presses/swipes that must not leave the page: same URL and history length after a moment. */
    const staysPut = async (actions, message) => {
      const url = page.url();
      const length = await historyLength(page);
      for (const action of actions) await action();
      await page.waitForTimeout(400);
      assert.equal(page.url(), url, message);
      assert.equal(await historyLength(page), length, message);
    };

    await page.goto(`${base}${hrefs.at(-1)}`);
    assert.equal(await text(page.locator('[data-photo-position-short]')), `${count} / ${count}`);
    assert.equal(await pager('next').getAttribute('href'), null, 'Next has no href on the last photo');
    assert.equal(await pager('next').getAttribute('aria-disabled'), 'true');
    assert.equal(await pager('previous').getAttribute('href'), hrefs.at(-2));
    await staysPut([() => page.keyboard.press('ArrowRight'), () => swipe(page, -200)], 'ArrowRight and a left swipe stay on the last photo');
    await navigate(page, () => swipe(page, 200));
    assert.equal(new URL(page.url()).pathname, hrefs.at(-2), 'a right swipe still goes to the previous photo');

    await page.goto(`${base}${hrefs[0]}`);
    assert.equal(await text(page.locator('[data-photo-position-short]')), `1 / ${count}`);
    assert.equal(await pager('previous').getAttribute('href'), null, 'Previous has no href on the first photo');
    assert.equal(await pager('previous').getAttribute('aria-disabled'), 'true');
    await staysPut([() => page.keyboard.press('ArrowLeft'), () => swipe(page, 200)], 'ArrowLeft and a right swipe stay on the first photo');
    await navigate(page, () => page.keyboard.press('ArrowRight'));
    assert.equal(new URL(page.url()).pathname, hrefs[1], 'ArrowRight still goes to the next photo');
  });
});

/**
 * Photo layout at the current viewport: photo box, whether the metadata is right of or below the photo,
 * and the geometry of the rule measured from the page's CSS (frame, height cap, side column + gap).
 */
const photoLayout = (page) =>
  page.evaluate(() => {
    const view = document.querySelector('.photo-view');
    const image = document.querySelector('.photo-detail-image').getBoundingClientRect();
    const meta = document.querySelector('.photo-view-meta').getBoundingClientRect();
    const probe = document.createElement('div');
    probe.style.cssText = 'height: var(--photo-max-height); width: var(--photo-meta-width)';
    view.append(probe);
    const { width: metaColumn, height: maxHeight } = probe.getBoundingClientRect();
    probe.remove();
    return {
      side: meta.left >= image.right ? 'right' : meta.top >= image.bottom ? 'below' : 'overlap',
      photoWidth: image.width,
      frame: document.querySelector('.photo-detail-shell').getBoundingClientRect().width,
      maxHeight,
      sideColumn: metaColumn + parseFloat(getComputedStyle(view).columnGap),
      ratio: Number(getComputedStyle(view).getPropertyValue('--photo-ratio')),
      compact: getComputedStyle(document.querySelector('.metadata-list')).display === 'flex'
    };
  });

/** The agreed rule for landscape photos: right while the photo keeps at least 90% of its width below. */
const landscapeSide = ({ frame, maxHeight, sideColumn, ratio }) =>
  frame - sideColumn >= 0.9 * Math.min(ratio * maxHeight, frame) ? 'right' : 'below';

test('photo layout: landscape metadata goes below when the side column costs over 10% of the photo width', async () => {
  const photos = { 'dsc-0155': 'landscape', 'riga-seagulls': 'landscape', 'dsc-0855': 'square', 'dsc-0046': 'portrait' };
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    await inContext({ viewport }, async (page) => {
      for (const [slug, orientation] of Object.entries(photos)) {
        await page.goto(`${base}/photography/${slug}/`);
        const layout = await photoLayout(page);
        const where = `${slug} at ${viewport.width}x${viewport.height}`;
        const expected = orientation === 'landscape' ? landscapeSide(layout) : 'right';
        assert.equal(layout.side, expected, `${where}: metadata ${expected}`);
        assert.equal(layout.compact, expected === 'below', `${where}: compact metadata block only below the photo`);
        if (orientation === 'landscape' && viewport.width === 1024) assert.equal(layout.side, 'below', `${where}: metadata below`);
      }
    });
  }

  // The switch sits where the rule puts it: a few px either side of frame = column + 0.9 * ratio * cap.
  await inContext({ viewport: { width: 1100, height: 768 } }, async (page) => {
    await page.goto(`${base}/photography/dsc-0155/`);
    const at1100 = await photoLayout(page);
    const switchWidth = 1100 + (at1100.sideColumn + 0.9 * at1100.ratio * at1100.maxHeight - at1100.frame);
    for (const [offset, side] of [[-3, 'below'], [3, 'right']]) {
      await page.setViewportSize({ width: Math.round(switchWidth + offset), height: 768 });
      const layout = await photoLayout(page);
      assert.equal(layout.side, side, `${Math.round(switchWidth + offset)}x768: metadata ${side}`);
      assert.equal(landscapeSide(layout), side);
    }

    // Quiet view and keys work with the metadata below.
    await page.setViewportSize({ width: 1024, height: 768 });
    assert.equal((await photoLayout(page)).side, 'below');
    const isQuiet = () => page.evaluate(() => document.documentElement.classList.contains('is-photo-quiet'));
    await page.keyboard.press('f');
    assert.equal(await isQuiet(), true, 'F opens the quiet view');
    const overlay = await page.locator('.photo-view-media').boundingBox();
    assert.deepEqual(overlay, { x: 0, y: 0, width: 1024, height: 768 }, 'the photo view covers the screen');
    await page.keyboard.press('Escape');
    assert.equal(await isQuiet(), false, 'Escape closes it');
    await navigate(page, () => page.keyboard.press('ArrowRight'));
    assert.equal(await text(page.locator('[data-photo-position-short]')), '2 / 29', 'ArrowRight opens the next photo');
  });
});

test('phone: one-row bar, photo near the top, no horizontal overflow, labelled pager', async () => {
  await inContext(phone, async (page) => {
    await page.goto(`${base}/photography/selected/dsc-0046/`);
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const bar = rect('.photo-view-bar');
      const back = rect('[data-photo-back]');
      const pager = rect('.photo-pager');
      const switches = [...document.querySelectorAll('[data-photography-theme-option], [data-photography-lang-option]')];
      return {
        barHeight: bar?.height ?? Number.NaN,
        sameRow: Boolean(back && pager && back.top < pager.bottom && pager.top < back.bottom),
        imageTop: rect('.photo-detail-image')?.top ?? Number.NaN,
        scrollWidth: document.documentElement.scrollWidth,
        width: window.innerWidth,
        switches: switches.length,
        switchesInHeader: switches.every((element) => element.closest('.site-header') !== null)
      };
    });
    assert.ok(layout.barHeight <= 52, `.photo-view-bar is one row (height ${layout.barHeight}px <= 52px)`);
    assert.ok(layout.sameRow, 'back link and pager share the row');
    assert.ok(layout.imageTop < 200, `.photo-detail-image starts near the top (top ${layout.imageTop}px < 200px)`);
    assert.ok(layout.scrollWidth <= layout.width, `no horizontal overflow (${layout.scrollWidth}px in ${layout.width}px)`);
    assert.equal(layout.switches, 4, 'two theme and two language buttons');
    assert.ok(layout.switchesInHeader, 'the theme/language switches are inside .site-header');

    for (const [side, word] of [['previous', 'Previous'], ['next', 'Next']]) {
      const link = page.locator(`[data-photo-pager="${side}"]`);
      const label = (await link.getAttribute('aria-label')) ?? '';
      const name = new RegExp(`^${word}: (.+)$`).exec(label)?.[1];
      assert.ok(name, `${side} link has an aria-label "${word}: <photo>" (got "${label}")`);
      // The name is the target photo's label, which heads that page's <title>.
      const target = await page.request.get(new URL((await link.getAttribute('href')) ?? '', base).href);
      const title = /<title>([^<]*)<\/title>/.exec(await target.text())?.[1] ?? '';
      assert.ok(title.startsWith(`${name} | `), `"${name}" names the target photo (its title: "${title}")`);
    }
  });
});

test('stored theme and language apply before the first frame, on photography pages only', async () => {
  await inContext(desktop, async (page, context) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('photography-theme', 'dark');
        localStorage.setItem('photography-language', 'zh');
      } catch {
        // about:blank has no storage.
      }
      requestAnimationFrame(() => {
        const root = document.documentElement;
        window.__firstFrame = {
          theme: root.getAttribute('data-photography-theme'),
          language: root.getAttribute('data-photography-lang'),
          lang: root.getAttribute('lang')
        };
      });
    });
    const firstFrame = async (path) => {
      await page.goto(`${base}${path}`);
      await page.waitForFunction(() => window.__firstFrame !== undefined);
      return page.evaluate(() => window.__firstFrame);
    };

    // The 404 page serves every unknown path: photography paths get the stored preferences too.
    for (const path of ['/photography/', '/photography/selected/dsc-0046/', '/photography/category/street/no-such-photo/']) {
      assert.deepEqual(await firstFrame(path), { theme: 'dark', language: 'zh', lang: 'zh-CN' }, `${path} in its first frame`);
    }
    for (const path of ['/', '/dexgo/', '/no-such-page']) {
      assert.deepEqual(await firstFrame(path), { theme: null, language: null, lang: 'en' }, `${path} keeps the default presentation`);
    }
  });
});

test('a photo page prefetches its Next neighbour once loaded', async () => {
  await inContext(desktop, async (page) => {
    await page.goto(`${base}/photography/selected/dsc-0046/`);
    const nextHref = await page.locator('[data-photo-pager="next"]').evaluate((link) => link.href);
    const hasPrefetch = (href) =>
      [...document.querySelectorAll('link[rel="prefetch"]')].some((link) => link.getAttribute('href') === href);
    await settle(page, hasPrefetch, nextHref);
    assert.ok(await page.evaluate(hasPrefetch, nextHref), `link[rel="prefetch"][href="${nextHref}"] is in <head>`);
  });
});

test('a missing URL answers 404 with the site header and links home', async () => {
  await inContext(desktop, async (page) => {
    const response = await page.goto(`${base}/photography/no-such-page/`);
    assert.equal(response?.status(), 404);
    assert.ok(await page.locator('.site-header').isVisible(), 'the site header is shown');
    for (const href of ['/', '/photography/']) {
      assert.ok((await page.locator(`main a[href="${href}"]`).count()) > 0, `the page links to ${href}`);
    }
  });
});

test('Chinese: no English-only text shows on the landing page, a project page or a photography 404', async () => {
  await inContext(desktop, async (page) => {
    await page.goto(`${base}/photography/`);
    await page.evaluate(() => localStorage.setItem('photography-language', 'zh'));
    for (const path of ['/photography/', '/photography/projects/moments-in-the-room/', '/photography/no-such-page/']) {
      await page.goto(`${base}${path}`);
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll('main [data-lang-inline="en"], main [data-lang-panel="en"]')]
          .filter((element) => element.getClientRects().length > 0 && !element.closest('.visually-hidden'))
          .map((element) => element.textContent.trim().slice(0, 40))
      );
      assert.deepEqual(shown, [], `${path}: no English counterpart is visible in 中文`);
      const zh = await page.locator('main [data-lang-inline="zh"]:visible').count();
      assert.ok(zh > 0, `${path}: Chinese text is shown`);
    }
    // Landmark and group names follow the language too.
    await page.goto(`${base}/photography/`);
    assert.equal(await page.getByRole('group', { name: '摄影联系方式', exact: true }).count(), 1, 'contact group named in Chinese');
    await page.goto(`${base}/photography/category/street/`);
    assert.equal(await page.getByRole('region', { name: '街头 照片', exact: true }).count(), 1, 'gallery region named in Chinese');
  });
});

test('quiet view: the photo fills the screen with a sharp candidate, and focus stays inside the view', async () => {
  await inContext(desktop, async (page) => {
    await page.goto(`${base}/photography/selected/dsc-0046/`);
    const next = page.locator('[data-photo-pager="next"]');
    await next.focus();
    await page.keyboard.press('f');
    const photo = page.locator('.photo-detail-image');
    await page.waitForFunction(() => {
      const image = document.querySelector('.photo-detail-image');
      return image.complete && image.currentSrc.includes('-1200.');
    }, undefined, { timeout: 5000 }).catch(() => undefined);
    const fit = await photo.evaluate((image) => {
      const box = image.getBoundingClientRect();
      const candidate = image.srcset.split(',').map((entry) => entry.trim().split(/\s+/))
        .find(([url]) => new URL(url, location.href).href === image.currentSrc);
      return { width: box.width, height: box.height, candidate: Number.parseInt(candidate?.[1] ?? '0', 10), viewport: [innerWidth, innerHeight] };
    });
    // Portrait 3:4 at 1440x1000: as tall as the screen less the 2 x 12px margin.
    assert.ok(Math.abs(fit.height - (fit.viewport[1] - 24)) <= 1, `the photo is ${fit.height}px tall, the screen less its margin is ${fit.viewport[1] - 24}px`);
    assert.ok(fit.candidate >= fit.width, `the loaded candidate (${fit.candidate}w) covers the ${Math.round(fit.width)}px it is shown at`);

    await page.keyboard.press('Tab');
    assert.ok(await page.locator('[data-photo-quiet-close]').evaluate((button) => button === document.activeElement), 'Tab reaches the close button');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.closest('.photo-view-media') !== null || document.activeElement === document.body);
    assert.ok(active, 'Tab never reaches the hidden page behind the view');

    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('is-photo-quiet')), false);
    assert.ok(await next.evaluate((link) => link === document.activeElement), 'closing returns focus to the Next link focused before');
    assert.ok(await page.locator('.site-header a').first().evaluate((link) => !link.closest('[inert]')), 'the page is no longer inert');
  });
});

test('keyboard: Enter on Next or Previous focuses the pager on the next photo page', async () => {
  await inContext(desktop, async (page) => {
    const gallery = '/photography/projects/moments-in-the-room/';
    await page.goto(`${base}${gallery}`);
    const hrefs = await page.locator('.photo-grid-link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    await page.goto(`${base}${hrefs.at(-2)}`);
    const focusedPager = () =>
      page.evaluate(() => ({
        side: document.activeElement?.getAttribute('data-photo-pager') ?? null,
        ring: document.activeElement?.matches(':focus-visible') ?? false
      }));

    await page.locator('[data-photo-pager="next"]').focus();
    await navigate(page, () => page.keyboard.press('Enter'));
    assert.equal(new URL(page.url()).pathname, hrefs.at(-1));
    // The last photo has no Next, so focus goes to Previous.
    assert.deepEqual(await focusedPager(), { side: 'previous', ring: true }, 'Previous is focused with a visible ring');

    await navigate(page, () => page.keyboard.press('Enter'));
    assert.equal(new URL(page.url()).pathname, hrefs.at(-2));
    assert.deepEqual(await focusedPager(), { side: 'previous', ring: true }, 'Enter on Previous lands on Previous again');

    // A pointer click does not move focus on the next page.
    await navigate(page, () => page.locator('[data-photo-pager="next"]').click());
    assert.equal((await focusedPager()).side, null, 'after a click the page starts without a focused pager');
  });
});

test('phone held sideways: the photo candidate covers its device pixels despite the 320px height floor', async () => {
  const sideways = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
  await inContext(sideways, async (page) => {
    for (const slug of ['dsc-8652', 'dsc-0046']) {
      await page.goto(`${base}/photography/${slug}/`);
      const image = await page.locator('.photo-detail-image').evaluate((element) => {
        const candidates = element.srcset.split(',').map((entry) => entry.trim().split(/\s+/));
        const picked = candidates.find(([url]) => new URL(url, location.href).href === element.currentSrc);
        return {
          need: element.getBoundingClientRect().width * devicePixelRatio,
          picked: Number.parseInt(picked?.[1] ?? '0', 10),
          largest: Math.max(...candidates.map(([, width]) => Number.parseInt(width, 10)))
        };
      });
      assert.ok(image.picked >= Math.min(image.need, image.largest), `${slug}: ${image.picked}w for ${Math.round(image.need)} device px`);
    }
  });
});

test('gallery back link: goes back in history when the gallery was opened from its target, else adds an entry', async () => {
  await inContext(desktop, async (page) => {
    await page.goto(`${base}/`);
    await page.goto(`${base}/photography/`);
    const card = page.locator('.category-entry').first();
    await card.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => Math.round(window.scrollY));
    const length = await historyLength(page);
    await navigate(page, () => card.click());

    await navigate(page, () => page.locator('[data-gallery-back]').click());
    assert.equal(page.url(), `${base}/photography/`, 'back at the landing page itself (history.back, no hash)');
    assert.equal(await historyLength(page), length + 1, 'no entry added');
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), scroll, 'the landing page keeps its scroll position');
    await page.goBack();
    assert.equal(page.url(), `${base}/`, 'one browser Back then leaves the section');

    // Opened directly (no referrer): a plain link.
    await page.goto(`${base}/photography/category/street/`);
    const direct = await historyLength(page);
    await navigate(page, () => page.locator('[data-gallery-back]').click());
    assert.equal(page.url(), `${base}/photography/#categories-title`);
    assert.equal(await historyLength(page), direct + 1);
  });
});
