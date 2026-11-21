/**
 * Photography display preferences (theme and language): the only owner of their storage keys, the
 * attributes they set on `<html>` and the change event. Client-safe (no Node imports).
 *
 * - `earlyPreferenceScript` is inlined into `<head>` of every photography page (SiteLayout) and runs
 *   before the stylesheet and the first paint: it sets `<html data-photography-theme
 *   data-photography-lang lang>` from localStorage, so a stored dark theme or Chinese never flashes.
 * - The CSS reads only those `<html>` attributes (photography.css), including the pressed state of
 *   the switches; the switch script (PhotographyPreferences) persists clicks with `setTheme` /
 *   `setLanguage` and keeps `aria-pressed` in sync.
 * Pages outside /photography/ never get the attributes and stay in the default light theme.
 */

export type PhotographyTheme = 'light' | 'dark';
export type PhotographyLanguage = 'en' | 'zh';

export const themeStorageKey = 'photography-theme';
export const languageStorageKey = 'photography-language';

/** Allowed values; the first one is the default. */
export const photographyThemes: readonly PhotographyTheme[] = ['light', 'dark'];
export const photographyLanguages: readonly PhotographyLanguage[] = ['en', 'zh'];

/** `<html lang>` (and the `lang` of the language spans) per page language. */
export const htmlLangOf: Readonly<Record<PhotographyLanguage, string>> = { en: 'en', zh: 'zh-CN' };

/** Fired on `document` after the language changed; `detail.language` is the new language. */
export const languageChangeEvent = 'photography-language-change';

/**
 * Inline `<head>` script (a string, emitted with `set:html`). Plain ES5 so it never fails to parse;
 * storage errors (private mode, blocked site data) fall back to the defaults.
 */
export const earlyPreferenceScript = `(function(){var d=document.documentElement;function read(k,v){try{var x=window.localStorage.getItem(k);return v.indexOf(x)>=0?x:v[0]}catch(e){return v[0]}}d.setAttribute('data-photography-theme',read(${JSON.stringify(themeStorageKey)},${JSON.stringify(photographyThemes)}));var l=read(${JSON.stringify(languageStorageKey)},${JSON.stringify(photographyLanguages)});d.setAttribute('data-photography-lang',l);d.lang=${JSON.stringify(htmlLangOf)}[l]})();`;

const root = () => document.documentElement;

const readStored = <T extends string>(key: string, allowed: readonly T[]): T => {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : allowed[0];
  } catch {
    return allowed[0];
  }
};

const writeStored = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference storage is optional.
  }
};

export const getPhotographyLanguage = (): PhotographyLanguage =>
  root().dataset.photographyLang === 'zh' ? 'zh' : 'en';

export const getPhotographyTheme = (): PhotographyTheme =>
  root().dataset.photographyTheme === 'dark' ? 'dark' : 'light';

/** Shows `theme`; `persist` also stores it for the next page. */
export const setTheme = (theme: PhotographyTheme, persist = true) => {
  root().dataset.photographyTheme = theme;
  if (persist) writeStored(themeStorageKey, theme);
};

/** Shows `language`, updates `<html lang>` and fires `languageChangeEvent` when it changed. */
export const setLanguage = (language: PhotographyLanguage, persist = true) => {
  const changed = getPhotographyLanguage() !== language || root().lang !== htmlLangOf[language];
  root().dataset.photographyLang = language;
  root().lang = htmlLangOf[language];
  if (persist) writeStored(languageStorageKey, language);
  if (changed) document.dispatchEvent(new CustomEvent(languageChangeEvent, { detail: { language } }));
};

/** Re-reads the stored preferences (a page restored from the back-forward cache, another tab). */
export const applyStoredPreferences = () => {
  setTheme(readStored(themeStorageKey, photographyThemes), false);
  setLanguage(readStored(languageStorageKey, photographyLanguages), false);
};
