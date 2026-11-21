/**
 * Behaviour of a photo page (PhotoDetailView):
 * - the `?from=tags&<filters>` context of the filter page (standalone pages only);
 * - history: Previous/Next (click, arrow keys, swipe) replace the history entry, and the back link
 *   uses history.back() when the entry before is its gallery, so one Back leaves the photo sequence;
 * - pager aria-labels in the page language;
 * - preloading of the neighbouring pages and photos once this page has loaded;
 * - the quiet full view (F or a tap on the photo; Escape, F, another tap or the close button closes
 *   it): the photo fitted to the screen, the rest of the page inert;
 * - after Previous/Next was followed from the keyboard, the next page focuses its pager link.
 * Without JavaScript the links work as plain links with the static context of the page.
 */
import { getPhotographyLanguage, languageChangeEvent } from '../../lib/photographyPrefs';
import {
  pageKey,
  pagerFocusKey,
  quietViewClass,
  quietViewKey,
  readPhotoReturn,
  readSession,
  writePhotoReturn,
  writeSession
} from '../../lib/photographySession';
import {
  photoAnchorId,
  photoMatchesTagFilters,
  readTagFilters,
  tagContextParam,
  tagContextQuery,
  tagContextValue,
  writeTagFilters,
  type TagContextData,
  type TagContextPhoto
} from '../../lib/photographyTagFilter';
import { bindHorizontalSwipe } from './swipe';

type PagerSide = 'previous' | 'next';
type PagerTarget = { href: string; label: string };

const view = document.querySelector<HTMLElement>('[data-photo-view]');
const slug = view?.dataset.photoSlug ?? '';
const backLink = document.querySelector<HTMLAnchorElement>('a[data-photo-back]');
const media = document.querySelector<HTMLElement>('[data-photo-quiet-toggle]');
const photo = media?.querySelector<HTMLImageElement>('img');
const quietClose = document.querySelector<HTMLButtonElement>('[data-photo-quiet-close]');
const pagerLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-photo-pager]'));
const pagerLink = (side: PagerSide) => pagerLinks.find((link) => link.dataset.photoPager === side);

// ---------------------------------------------------------------------------------------------
// Pager labels and targets
// ---------------------------------------------------------------------------------------------

/** aria-label "Previous: <photo>" / "上一张：<photo>", built from the link's word in the page language. */
const labelPagerLinks = () => {
  const language = getPhotographyLanguage();

  pagerLinks.forEach((link) => {
    const word = link.querySelector(`[data-lang-inline="${language}"]`)?.textContent?.trim();
    const label = link.dataset.photoLabel;

    if (link.hasAttribute('href') && word && label) {
      link.setAttribute('aria-label', language === 'zh' ? `${word}：${label}` : `${word}: ${label}`);
    } else {
      link.removeAttribute('aria-label');
    }
  });
};

/** Points a pager link at `target`, or shows it disabled (in place, without href) when there is none. */
const setPagerTarget = (side: PagerSide, target: PagerTarget | undefined) => {
  const link = pagerLink(side);
  if (!link) return;

  // The preload hints describe the static neighbour; a retargeted link no longer points at it.
  delete link.dataset.photoImageSrcset;
  delete link.dataset.photoImageSizes;
  delete link.dataset.photoImageQuietSizes;

  if (target) {
    link.href = target.href;
    link.rel = side === 'previous' ? 'prev' : 'next';
    link.dataset.photoLabel = target.label;
    link.removeAttribute('role');
    link.removeAttribute('aria-disabled');
  } else {
    link.removeAttribute('href');
    link.removeAttribute('rel');
    delete link.dataset.photoLabel;
    link.setAttribute('role', 'link');
    link.setAttribute('aria-disabled', 'true');
  }
};

/** "i / n" and its spoken form "Photo i of n" / "第 i 张，共 n 张". */
const setPosition = (index: number, count: number) => {
  const short = document.querySelector('[data-photo-position-short]');
  if (short) short.textContent = `${index} / ${count}`;
  document.querySelectorAll<HTMLElement>('[data-photo-position-long]').forEach((element) => {
    element.textContent =
      element.dataset.photoPositionLong === 'zh' ? `第 ${index} 张，共 ${count} 张` : `Photo ${index} of ${count}`;
  });
};

/**
 * Opened from /photography/tags/ (`?from=tags&<filters>`): Previous/Next, position and the back link
 * follow the filtered results, matched exactly as the filter page matches them.
 */
const applyTagContext = () => {
  const params = new URLSearchParams(window.location.search);
  const dataElement = document.querySelector('[data-photo-tag-context]');

  if (params.get(tagContextParam) !== tagContextValue || !dataElement || !slug) return;

  let data: TagContextData;
  try {
    data = JSON.parse(dataElement.textContent ?? '');
  } catch {
    return;
  }

  const filters = readTagFilters(params, data.groups);
  const photos = data.photos.filter((photo) => photoMatchesTagFilters(photo.tags, filters));
  const index = photos.findIndex((photo) => photo.slug === slug);

  // A hand-edited query that excludes this photo keeps the static context.
  if (index < 0) return;

  const query = tagContextQuery(filters);
  const filterQuery = writeTagFilters(filters);
  const targetOf = (photo: TagContextPhoto | undefined) =>
    photo ? { href: `${photo.href}?${query}`, label: photo.label } : undefined;

  if (backLink) {
    backLink.href = `${data.galleryHref}${filterQuery ? `?${filterQuery}` : ''}#${photoAnchorId(slug)}`;
    backLink.querySelectorAll<HTMLElement>('[data-photo-back-name]').forEach((name) => {
      name.textContent = name.dataset.photoBackName === 'zh' ? data.name.zh : data.name.en;
    });
  }

  setPagerTarget('previous', targetOf(photos[index - 1]));
  setPagerTarget('next', targetOf(photos[index + 1]));
  setPosition(index + 1, photos.length);
};

// ---------------------------------------------------------------------------------------------
// History: Previous/Next replace the entry; the back link goes back when the entry before is the gallery
// ---------------------------------------------------------------------------------------------

let usedKeyboard = false;
/** Set when this page leaves through Previous/Next, so the quiet view stays on for the next photo. */
let leavingWithinSequence = false;
/** `history.length` while the entry before this one is the gallery of the back link, else undefined. */
let galleryHistoryLength: number | undefined;

/**
 * Records this photo for its gallery (the tile to mark on return) and whether the entry before is that
 * gallery: either the gallery opened this page (referrer), or this page replaced a photo page that the
 * gallery opened (same gallery, unchanged history length).
 */
const recordReturn = () => {
  if (!backLink || !slug) return;

  const gallery = pageKey(backLink.href);
  const previous = readPhotoReturn();
  let referrer: URL | null = null;
  try {
    referrer = document.referrer ? new URL(document.referrer) : null;
  } catch {
    referrer = null;
  }
  const openedFromGallery = referrer?.origin === window.location.origin && pageKey(referrer) === gallery;
  const continuesSequence = previous?.gallery === gallery && previous.historyLength === history.length;

  galleryHistoryLength = openedFromGallery || continuesSequence ? history.length : undefined;
  usedKeyboard ||= Boolean(continuesSequence && previous?.viaKeyboard);
  writePhotoReturn({ gallery, slug, historyLength: galleryHistoryLength, viaKeyboard: usedKeyboard });
};

const go = (href: string) => {
  leavingWithinSequence = true;
  window.location.replace(href);
};

/** Follows a pager link, reading its href at event time; false when that side is disabled. */
const goTo = (side: PagerSide) => {
  const link = pagerLink(side);
  if (!link?.hasAttribute('href')) return false;

  go(link.href);
  return true;
};

const isPlainClick = (event: MouseEvent) =>
  !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

pagerLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    if (!isPlainClick(event) || !link.hasAttribute('href')) return;
    event.preventDefault();
    if (event.detail === 0) {
      usedKeyboard = true;
      writeSession(pagerFocusKey, `${link.dataset.photoPager}|${pageKey(link.href)}`);
    }
    recordReturn();
    go(link.href);
  });
});

/** Reached with Enter on Previous/Next: focus that side again (the other one at a gallery end). */
const restorePagerFocus = () => {
  const [side, target] = (readSession(pagerFocusKey) ?? '').split('|');
  writeSession(pagerFocusKey, null);
  if ((side !== 'previous' && side !== 'next') || target !== pageKey(window.location.href) || isQuiet()) return;

  const other: PagerSide = side === 'previous' ? 'next' : 'previous';
  const link = [pagerLink(side), pagerLink(other)].find((candidate) => candidate?.hasAttribute('href'));
  link?.focus({ preventScroll: true });
};

backLink?.addEventListener('click', (event) => {
  // A click with detail 0 comes from the keyboard (Enter): the gallery then also focuses the tile.
  if (event.detail === 0) usedKeyboard = true;
  recordReturn();

  if (isPlainClick(event) && galleryHistoryLength !== undefined && galleryHistoryLength === history.length) {
    event.preventDefault();
    history.back();
  }
});

// ---------------------------------------------------------------------------------------------
// Quiet full view
// ---------------------------------------------------------------------------------------------

const isQuiet = () => document.documentElement.classList.contains(quietViewClass);

/** Everything but the photo (site header, bar, metadata, footer): hidden behind the quiet view. */
const outsideQuietView = (() => {
  const elements: HTMLElement[] = [];
  for (let node: Element | null = media ?? null; node?.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling !== node && sibling instanceof HTMLElement && !(sibling instanceof HTMLScriptElement)) elements.push(sibling);
    }
  }
  return elements;
})();
const pageSizes = photo?.getAttribute('sizes') ?? '';
let focusBeforeQuiet: HTMLElement | null = null;

/**
 * Applies the quiet view state of <html> (set by setQuiet, or before the first paint by the early
 * script on the next photo): the rest of the page inert, so Tab reaches only the close button and
 * screen readers only the photo; the photo's `sizes` for its fitted size, so a sharp candidate loads.
 */
const syncQuiet = () => {
  const on = isQuiet();
  outsideQuietView.forEach((element) => {
    element.inert = on;
  });
  const sizes = on ? photo?.dataset.quietSizes : pageSizes;
  if (photo && sizes && photo.getAttribute('sizes') !== sizes) photo.sizes = sizes;
};

const setQuiet = (on: boolean) => {
  if (on === isQuiet()) return;
  const focused = document.activeElement;
  if (on) focusBeforeQuiet = focused instanceof HTMLElement && focused !== document.body ? focused : null;

  document.documentElement.classList.toggle(quietViewClass, on);
  writeSession(quietViewKey, on ? '1' : null);
  syncQuiet();
  if (on) return;

  // Back where the reader was before the view opened (the close button is gone now).
  const restore = focusBeforeQuiet;
  focusBeforeQuiet = null;
  if (restore?.isConnected && (document.activeElement === document.body || media?.contains(document.activeElement))) {
    restore.focus({ preventScroll: true });
  }
};

media?.addEventListener('click', (event) => {
  if (quietClose && event.target instanceof Node && quietClose.contains(event.target)) return;
  setQuiet(!isQuiet());
});

quietClose?.addEventListener('click', () => setQuiet(false));

// Leaving any other way than Previous/Next (back link, browser Back, a metadata link) ends the view.
window.addEventListener('pagehide', () => {
  if (!leavingWithinSequence) writeSession(quietViewKey, null);
});

// ---------------------------------------------------------------------------------------------
// Keys and swipe
// ---------------------------------------------------------------------------------------------

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]') !== null);

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (isTypingTarget(event.target) || document.querySelector('dialog[open]')) return;

  if (event.key === 'Escape') {
    if (isQuiet()) {
      setQuiet(false);
      event.preventDefault();
    }
    return;
  }

  if (event.shiftKey || event.repeat) return;

  if (event.key === 'f' || event.key === 'F') {
    setQuiet(!isQuiet());
    event.preventDefault();
    return;
  }

  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

  usedKeyboard = true;
  recordReturn();
  if (goTo(event.key === 'ArrowLeft' ? 'previous' : 'next')) event.preventDefault();
});

if (media) {
  bindHorizontalSwipe(media, { onLeft: () => goTo('next'), onRight: () => goTo('previous') });
}

// ---------------------------------------------------------------------------------------------
// Preload the neighbours: their pages, and their photos at the size this viewport will use
// ---------------------------------------------------------------------------------------------

const preloadNeighbours = () => {
  pagerLinks.forEach((link) => {
    if (!link.hasAttribute('href')) return;

    const prefetch = document.createElement('link');
    prefetch.rel = 'prefetch';
    prefetch.href = link.href;
    document.head.append(prefetch);

    // In the quiet view the next photo opens in it too, so preload the size it will have there.
    const { photoImageSrcset: srcset } = link.dataset;
    const sizes = isQuiet() ? link.dataset.photoImageQuietSizes : link.dataset.photoImageSizes;
    if (srcset && sizes) {
      const image = new Image();
      image.decoding = 'async';
      image.sizes = sizes;
      image.srcset = srcset;
    }
  });
};

// ---------------------------------------------------------------------------------------------

applyTagContext();
labelPagerLinks();
recordReturn();
syncQuiet();
restorePagerFocus();
document.addEventListener(languageChangeEvent, labelPagerLinks);

window.addEventListener(
  'load',
  () => {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    idle(preloadNeighbours);
  },
  { once: true }
);
