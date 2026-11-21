/**
 * Tag filter state and matching shared by the combined filter page `/photography/tags/` and the
 * standalone photo pages opened from it (`/photography/<slug>/?from=tags&location=zurich`).
 *
 * Client-safe: no Node imports, so browser scripts may import it. `src/lib/photography.ts` reads the
 * file system and must stay build-only; it imports the types and `photoAnchorId` from here.
 */

/** Tag values of one photo per tag group, e.g. `{ location: ['zurich'], condition: ['rain', 'night'] }`. */
export type PhotoTagValues = Readonly<Record<string, readonly string[]>>;

/** Checked values per tag group, in group order; a group without checked values is absent. */
export type TagFilters = ReadonlyMap<string, readonly string[]>;

/** One photo of the standalone display order, as embedded in each standalone photo page. */
export type TagContextPhoto = {
  slug: string;
  /** Short label for Previous/Next aria-labels (title, or "Category, Location"). */
  label: string;
  /** Standalone page URL, `/photography/<slug>/`. */
  href: string;
  tags: PhotoTagValues;
};

/** JSON embedded in each standalone photo page (`<script type="application/json" data-photo-tag-context>`). */
export type TagContextData = {
  /** Tag groups the filter page offers, in its order. */
  groups: string[];
  /** URL of the filter page, `/photography/tags/`. */
  galleryHref: string;
  /** Name in the back link: "Back to <en>" / "返回<zh>". */
  name: { en: string; zh: string };
  /** Every photo, in display order. */
  photos: TagContextPhoto[];
};

/** Query parameter and value that mark a photo page opened from the filter page. */
export const tagContextParam = 'from';
export const tagContextValue = 'tags';

/** Groups whose checked values must all match; in every other group one checked value is enough. */
const allValuesGroups: ReadonlySet<string> = new Set(['condition']);

/** `id` of a photo's grid item; a gallery URL with `#photo-<slug>` scrolls back to that photo. */
export const photoAnchorId = (slug: string) => `photo-${slug}`;

/**
 * True when a photo passes every checked group: any checked value within location, camera and lens
 * (OR), all checked values within condition (AND). No checked filters match every photo.
 */
export const photoMatchesTagFilters = (photoTags: PhotoTagValues, filters: TagFilters) => {
  for (const [group, selected] of filters) {
    const values = photoTags[group] ?? [];
    const matches = allValuesGroups.has(group)
      ? selected.every((value) => values.includes(value))
      : selected.some((value) => values.includes(value));

    if (!matches) return false;
  }

  return true;
};

/** Per tag group, the number of photos per value, e.g. `location → zurich → 11`. */
export type TagOptionCounts = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Faceted option counts for the current selection: how many photos each value would show.
 * - A value of an any-value group (location, camera, lens) counts the photos that pass every *other*
 *   checked group and carry that value; the group's own checked values are ignored.
 * - A value of an all-values group (condition) counts the photos that pass the whole selection and
 *   also carry that value.
 * A checked value therefore counts the shown photos that carry it. Values that no photo reaches are
 * absent; read them as 0.
 */
export const countTagOptions = (photos: readonly PhotoTagValues[], filters: TagFilters): TagOptionCounts => {
  const baseFilters = new Map<string, TagFilters>();
  const filtersFor = (group: string) => {
    let base = baseFilters.get(group);
    if (!base) {
      base = allValuesGroups.has(group) ? filters : new Map([...filters].filter(([name]) => name !== group));
      baseFilters.set(group, base);
    }
    return base;
  };

  const counts = new Map<string, Map<string, number>>();

  for (const photo of photos) {
    for (const [group, values] of Object.entries(photo)) {
      if (!photoMatchesTagFilters(photo, filtersFor(group))) continue;

      const groupCounts = counts.get(group) ?? new Map<string, number>();
      for (const value of new Set(values)) groupCounts.set(value, (groupCounts.get(value) ?? 0) + 1);
      counts.set(group, groupCounts);
    }
  }

  return counts;
};

/** Filters named in a query string (`?location=zurich&location=bern&condition=rain`), limited to `groups`. */
export const readTagFilters = (params: URLSearchParams, groups: readonly string[]): TagFilters =>
  new Map(
    groups
      .map((group) => [group, [...new Set(params.getAll(group).filter(Boolean))]] as const)
      .filter(([, values]) => values.length > 0)
  );

/** Query string (without `?`) that `readTagFilters` reads back to `filters`; `''` for no filters. */
export const writeTagFilters = (filters: TagFilters) => {
  const params = new URLSearchParams();

  for (const [group, values] of filters) {
    for (const value of values) params.append(group, value);
  }

  return params.toString();
};

/** Query string (without `?`) of a photo page opened from the filter page: `from=tags&<filters>`. */
export const tagContextQuery = (filters: TagFilters) => {
  const filterQuery = writeTagFilters(filters);

  return `${tagContextParam}=${tagContextValue}${filterQuery ? `&${filterQuery}` : ''}`;
};
