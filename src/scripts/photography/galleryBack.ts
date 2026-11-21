/**
 * The back link at the top of a gallery page ("Back to Photography"; on a tag gallery "Back to
 * Photography Tags"), marked `data-gallery-back`. When this page was opened from the page the link
 * points to, the link goes back in history instead of adding an entry, as on photo pages
 * (photoPage.ts): the earlier page returns at its scroll position, and one browser Back then leaves it.
 * Whether the entry before is that page is decided once per history entry, when it first loads, and
 * kept in `history.state`: a same-origin referrer with the link's path and query, and an earlier entry
 * in this tab (a page opened in a new tab has none). Otherwise the link is a plain link.
 */
import { pageKey } from '../../lib/photographySession';

const stateKey = 'photographyGalleryBack';
const link = document.querySelector<HTMLAnchorElement>('a[data-gallery-back]');

const openedFromLinkTarget = (target: string) => {
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin && pageKey(referrer) === pageKey(target) && history.length > 1;
  } catch {
    return false;
  }
};

if (link) {
  const state: Record<string, unknown> = history.state && typeof history.state === 'object' ? history.state : {};
  if (!(stateKey in state)) history.replaceState({ ...state, [stateKey]: openedFromLinkTarget(link.href) }, '');

  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (history.state?.[stateKey] !== true) return;
    event.preventDefault();
    history.back();
  });
}
