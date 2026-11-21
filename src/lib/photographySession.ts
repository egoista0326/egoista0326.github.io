/**
 * Per-tab browsing state of the photography pages, kept in sessionStorage (client-safe module).
 *
 * - `photoReturnKey`: written by every photo page, read by the gallery it returns to.
 *   `gallery` is the gallery URL (path + query, no hash) of the photo page's back link and `slug` the
 *   photo seen last, so the gallery can briefly mark that tile. `historyLength` is set only when the
 *   photo sequence was opened from that gallery (the referrer was the gallery): Previous/Next replace
 *   the history entry, so as long as `history.length` is unchanged the entry before is still the
 *   gallery and the back link can use history.back(). `viaKeyboard` records whether the reader used
 *   the keyboard on the photo page (the gallery then also focuses the tile).
 * - `quietViewKey`: "1" while the quiet full view is on, so it stays on across Previous/Next.
 * - `pagerFocusKey`: "<side>|<target>" when the pager link of that side ("previous" / "next") was
 *   followed from the keyboard; the target page (`pageKey`) then focuses its own pager link instead
 *   of starting at the top of the page.
 * Storage errors (private mode, blocked site data) make every read return nothing.
 */

export const photoReturnKey = 'photography-photo-return';
export const quietViewKey = 'photography-quiet-view';
export const pagerFocusKey = 'photography-pager-focus';

/** Class on <html> while the quiet full view is on (photography.css). */
export const quietViewClass = 'is-photo-quiet';

export type PhotoReturn = {
  gallery: string;
  slug: string;
  historyLength?: number;
  viaKeyboard?: boolean;
};

export const readSession = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeSession = (key: string, value: string | null) => {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage is optional.
  }
};

export const readPhotoReturn = (): PhotoReturn | null => {
  try {
    const value = JSON.parse(readSession(photoReturnKey) ?? 'null');
    return value && typeof value.gallery === 'string' && typeof value.slug === 'string' ? value : null;
  } catch {
    return null;
  }
};

export const writePhotoReturn = (value: PhotoReturn | null) =>
  writeSession(photoReturnKey, value === null ? null : JSON.stringify(value));

/** Path and query of a URL, the key that identifies a gallery page (the hash is ignored). */
export const pageKey = (url: string | URL) => {
  const parsed = new URL(url, window.location.href);
  return `${parsed.pathname}${parsed.search}`;
};

/**
 * Inline script placed before the photo (PhotoDetailView): restores the quiet view before the
 * first paint when it was on for the previous photo.
 */
export const quietViewEarlyScript = `(function(){try{if(window.sessionStorage.getItem(${JSON.stringify(quietViewKey)})==='1')document.documentElement.classList.add(${JSON.stringify(quietViewClass)})}catch(e){}})();`;
