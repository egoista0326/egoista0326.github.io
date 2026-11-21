/**
 * Client script of the tag filter page `/photography/tags/` (src/pages/photography/tags/index.astro).
 *
 * Every photo is rendered once; this script hides the tiles that do not match the checked options,
 * updates the result count (a polite live region, both language spans, so the announcement follows
 * the page language) and the faceted count on each option, and disables unchecked options that would
 * give no result. The query string is the filter state (`?location=zurich&condition=rain`): it is
 * restored on load and rewritten with `history.replaceState` on each change.
 */
import {
  countTagOptions,
  photoMatchesTagFilters,
  readTagFilters,
  tagContextQuery,
  writeTagFilters,
  type PhotoTagValues,
  type TagFilters
} from '../../lib/photographyTagFilter';

type FilterOption = {
  input: HTMLInputElement;
  /** Visible number of the option. */
  count: HTMLElement | null;
  /** Visually hidden English unit after the number ("photograph" / "photographs"). */
  unit: HTMLElement | null;
};

const photographsEn = (count: number) => (count === 1 ? 'photograph' : 'photographs');

const initTagFilterPage = (form: HTMLFormElement) => {
  const resultCountEn = document.querySelector<HTMLElement>('[data-tag-result-count] [data-lang-inline="en"]');
  const resultCountZh = document.querySelector<HTMLElement>('[data-tag-result-count] [data-lang-inline="zh"]');
  const emptyMessage = document.querySelector<HTMLElement>('[data-tag-empty]');
  const clearButton = document.querySelector<HTMLButtonElement>('[data-tag-filter-clear]');
  const showResultsLink = document.querySelector<HTMLElement>('[data-tag-show-results]');
  const resultsSection = document.querySelector<HTMLElement>('[data-tag-results-section]');
  const resultGrid = document.querySelector('[data-tag-search-results] .photo-grid');
  const resultItems = Array.from(document.querySelectorAll<HTMLElement>('[data-tag-search-results] .photo-grid-item'));
  const groups = Array.from(form.querySelectorAll<HTMLElement>('[data-filter-group]')).map(
    (fieldset) => fieldset.dataset.filterGroup ?? ''
  );
  const options: FilterOption[] = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(
    (input) => {
      const label = input.closest('label');
      return {
        input,
        count: label?.querySelector<HTMLElement>('[data-tag-option-count]') ?? null,
        unit: label?.querySelector<HTMLElement>('[data-tag-option-unit]') ?? null
      };
    }
  );

  // Tag values of each tile, from its `data-<group>` attributes (PhotoGridItem); fixed for the page.
  const itemTags: PhotoTagValues[] = resultItems.map((item) =>
    Object.fromEntries(groups.map((group) => [group, (item.dataset[group] ?? '').split(' ').filter(Boolean)]))
  );

  /** Checked values per group, in form order. */
  const getSelectedFilters = (): TagFilters => {
    const selected = new Map<string, string[]>();

    options.forEach(({ input }) => {
      if (!input.checked) return;
      selected.set(input.name, [...(selected.get(input.name) ?? []), input.value]);
    });

    return selected;
  };

  const setText = (element: HTMLElement | null, text: string) => {
    // Rewriting identical text would make some screen readers repeat the live region.
    if (element && element.textContent !== text) element.textContent = text;
  };

  /**
   * Shows the matching photos and points each result at its standalone page with
   * `?from=tags&<filters>`, so that page's Previous/Next and back link follow these results.
   * `syncUrl` writes the filters into this page's query, so they survive navigation and reload.
   */
  const updateResults = ({ syncUrl = false } = {}) => {
    const selectedFilters = getSelectedFilters();
    const contextQuery = tagContextQuery(selectedFilters);
    let visibleCount = 0;

    resultItems.forEach((item, index) => {
      const isMatch = photoMatchesTagFilters(itemTags[index], selectedFilters);
      item.hidden = !isMatch;
      if (isMatch) visibleCount += 1;

      const link = item.querySelector<HTMLAnchorElement>('.photo-grid-link');
      if (link) {
        link.dataset.baseHref ??= link.getAttribute('href') ?? '';
        link.setAttribute('href', `${link.dataset.baseHref}?${contextQuery}`);
      }
    });

    setText(resultCountEn, `${visibleCount} ${photographsEn(visibleCount)}`);
    setText(resultCountZh, `${visibleCount} 张照片`);

    const optionCounts = countTagOptions(itemTags, selectedFilters);
    options.forEach(({ input, count, unit }) => {
      const value = optionCounts.get(input.name)?.get(input.value) ?? 0;
      setText(count, String(value));
      setText(unit, photographsEn(value));
      // A checked option stays usable (it is how the reader gets out), and so does the focused one.
      input.disabled = value === 0 && !input.checked && input !== document.activeElement;
    });

    if (emptyMessage) emptyMessage.hidden = visibleCount > 0;
    // aria-disabled instead of disabled keeps keyboard focus on the button after it cleared.
    clearButton?.setAttribute('aria-disabled', String(selectedFilters.size === 0));

    if (syncUrl) {
      const filterQuery = writeTagFilters(selectedFilters);
      // A changed filter drops a stale hash (#photo-<slug>, #tag-results).
      history.replaceState(history.state, '', `${window.location.pathname}${filterQuery ? `?${filterQuery}` : ''}`);
    }

    resultGrid?.dispatchEvent(new CustomEvent('photo-grid:relayout'));
  };

  // The query is the filter state: restore it (also over checkboxes the browser restored itself).
  const restoredFilters = readTagFilters(new URLSearchParams(window.location.search), groups);
  options.forEach(({ input }) => {
    input.checked = restoredFilters.get(input.name)?.includes(input.value) ?? false;
  });

  form.addEventListener('change', () => updateResults({ syncUrl: true }));
  // Filtering is live; the submit button exists only without JavaScript (<noscript>).
  form.addEventListener('submit', (event) => event.preventDefault());

  if (clearButton) {
    clearButton.addEventListener('click', (event) => {
      // The button is `type="reset"` so that it also works without JavaScript; here the reset is ours.
      event.preventDefault();
      if (clearButton.getAttribute('aria-disabled') === 'true') return;
      form.reset();
      updateResults({ syncUrl: true });
    });
  }

  // "Show ↓" is useful only while the results start below the screen (the bar then rests at the
  // bottom edge); it is hidden once they are in view or scrolled past.
  if (showResultsLink && resultsSection && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => {
        showResultsLink.hidden = entry.isIntersecting || entry.boundingClientRect.top < 0;
      },
      { rootMargin: '0px 0px -120px 0px' }
    ).observe(resultsSection);
  }

  updateResults();
};

const form = document.querySelector('[data-tag-filter-form]');
if (form instanceof HTMLFormElement) initTagFilterPage(form);
