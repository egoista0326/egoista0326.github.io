/**
 * Click handling of the theme and language switches (PhotographyPreferences). The visible state is
 * already right before this runs (earlyPreferenceScript + CSS); this keeps `aria-pressed` in sync,
 * saves clicks, and re-applies the stored values when a page comes back from the back-forward cache
 * or another tab changes them.
 */
import {
  applyStoredPreferences,
  getPhotographyLanguage,
  getPhotographyTheme,
  languageStorageKey,
  photographyLanguages,
  photographyThemes,
  setLanguage,
  setTheme,
  themeStorageKey,
  type PhotographyLanguage,
  type PhotographyTheme
} from '../../lib/photographyPrefs';

const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-photography-theme-option]'));
const languageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-photography-lang-option]'));

const syncPressed = () => {
  const theme = getPhotographyTheme();
  const language = getPhotographyLanguage();
  themeButtons.forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.photographyThemeOption === theme))
  );
  languageButtons.forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.photographyLangOption === language))
  );
};

themeButtons.forEach((button) => {
  const theme = button.dataset.photographyThemeOption as PhotographyTheme;
  if (!photographyThemes.includes(theme)) return;
  button.addEventListener('click', () => {
    setTheme(theme);
    syncPressed();
  });
});

languageButtons.forEach((button) => {
  const language = button.dataset.photographyLangOption as PhotographyLanguage;
  if (!photographyLanguages.includes(language)) return;
  button.addEventListener('click', () => {
    setLanguage(language);
    syncPressed();
  });
});

const reapply = () => {
  applyStoredPreferences();
  syncPressed();
};

window.addEventListener('pageshow', (event) => {
  if (event.persisted) reapply();
});
window.addEventListener('storage', (event) => {
  if (event.key === themeStorageKey || event.key === languageStorageKey) reapply();
});

syncPressed();
