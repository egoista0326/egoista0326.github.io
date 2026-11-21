/**
 * Horizontal swipe on `element`: one finger, mostly horizontal (|dx| > 2 |dy|), longer than
 * `minDistance` px and shorter than `maxDuration` ms. Ignored for pinch gestures and while the page
 * is zoomed in (the reader is panning then). Listeners are passive, so scrolling is never blocked.
 */
export const bindHorizontalSwipe = (
  element: Element,
  { onLeft, onRight }: { onLeft: () => void; onRight: () => void },
  { minDistance = 60, maxDuration = 800 }: { minDistance?: number; maxDuration?: number } = {}
) => {
  let start: { x: number; y: number; time: number } | null = null;

  element.addEventListener(
    'touchstart',
    (event) => {
      const { touches } = event as TouchEvent;
      start = touches.length === 1 ? { x: touches[0].clientX, y: touches[0].clientY, time: event.timeStamp } : null;
    },
    { passive: true }
  );
  element.addEventListener(
    'touchmove',
    (event) => {
      if ((event as TouchEvent).touches.length > 1) start = null;
    },
    { passive: true }
  );
  element.addEventListener(
    'touchcancel',
    () => {
      start = null;
    },
    { passive: true }
  );
  element.addEventListener(
    'touchend',
    (event) => {
      const from = start;
      const touch = (event as TouchEvent).changedTouches[0];
      start = null;

      if (!from || !touch || (window.visualViewport?.scale ?? 1) > 1.01) return;

      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;

      if (Math.abs(dx) > minDistance && Math.abs(dx) > 2 * Math.abs(dy) && event.timeStamp - from.time < maxDuration) {
        if (dx < 0) onLeft();
        else onRight();
      }
    },
    { passive: true }
  );
};
