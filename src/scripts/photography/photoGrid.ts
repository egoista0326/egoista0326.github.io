/**
 * Photo grids (PhotoGrid): Masonry layout, and the return from a photo page. The photo page records
 * the photo seen last for its gallery (src/lib/photographySession.ts); when this gallery is shown
 * again (back link, browser Back, back-forward cache), that tile is brought into view if needed and
 * marked briefly; it is also focused when the reader used the keyboard on the photo page.
 */
import Masonry from 'masonry-layout';
import { pageKey, readPhotoReturn, writePhotoReturn } from '../../lib/photographySession';
import { photoAnchorId } from '../../lib/photographyTagFilter';

const getGridGutter = (grid: Element) => {
  const value = Number.parseFloat(getComputedStyle(grid).getPropertyValue('--photo-grid-gutter'));

  return Number.isFinite(value) ? value : 24;
};

const initPhotoGrid = (grid: HTMLElement) => {
  grid.classList.add('is-masonry-ready');

  const masonry = new Masonry(grid, {
    itemSelector: '.photo-grid-item:not([hidden])',
    gutter: getGridGutter(grid),
    percentPosition: true,
    transitionDuration: 0,
    // Width changes are handled by the ResizeObserver below (Masonry's own handler would lay out twice).
    resize: false
  });

  const relayout = () => {
    masonry.reloadItems();
    masonry.layout();
  };

  grid.querySelectorAll('img').forEach((image) => {
    if (!image.complete) image.addEventListener('load', relayout, { once: true });
  });

  window.addEventListener('load', relayout, { once: true });
  grid.addEventListener('photo-grid:relayout', relayout);

  if ('ResizeObserver' in window) {
    // Only width changes need a new layout; Masonry's own height changes are ignored.
    let width = grid.clientWidth;
    new ResizeObserver(() => {
      if (grid.clientWidth === width) return;
      width = grid.clientWidth;
      relayout();
    }).observe(grid);
  }
};

document.querySelectorAll<HTMLElement>('[data-photo-grid]').forEach(initPhotoGrid);

// ---------------------------------------------------------------------------------------------
// Return from a photo page
// ---------------------------------------------------------------------------------------------

let readerMoved = false;
const markReaderMoved = () => {
  readerMoved = true;
};
const readerEvents = ['wheel', 'touchmove', 'keydown'];
readerEvents.forEach((type) => window.addEventListener(type, markReaderMoved, { once: true, passive: true }));

const hashId = () => {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return '';
  }
};

const returnToPhoto = () => {
  readerEvents.forEach((type) => window.removeEventListener(type, markReaderMoved));

  const record = readPhotoReturn();
  const fromRecord = record?.gallery === pageKey(window.location.href);
  const id = fromRecord ? photoAnchorId(record.slug) : hashId();

  if (fromRecord) writePhotoReturn(null);
  if (!id.startsWith('photo-')) return;

  const item = document.getElementById(id);
  if (!(item instanceof HTMLElement) || item.hidden || !item.closest('[data-photo-grid]')) return;

  // At least half of the tile (or of the screen, for a tall tile) visible counts as in view.
  const box = item.getBoundingClientRect();
  const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
  const inView = visible >= 0.5 * Math.min(box.height, window.innerHeight);

  if (!readerMoved && !inView) item.scrollIntoView({ block: 'center' });

  item.classList.remove('is-returned');
  // Restart the mark's animation on a repeated return (back-forward cache).
  void item.offsetWidth;
  item.classList.add('is-returned');
  item.addEventListener('animationend', () => item.classList.remove('is-returned'), { once: true });

  const link = item.querySelector('a');
  if (fromRecord && record.viaKeyboard && link instanceof HTMLElement) link.focus({ preventScroll: true });
};

// After window load Masonry has its final layout (its load listener was registered first); one more
// frame lets the browser restore the scroll position of a page reloaded from history first.
const returnAfterLayout = () => window.requestAnimationFrame(() => returnToPhoto());

if (document.readyState === 'complete') {
  returnAfterLayout();
} else {
  window.addEventListener('load', returnAfterLayout, { once: true });
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    readerMoved = false;
    returnToPhoto();
  }
});
