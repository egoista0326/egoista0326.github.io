/**
 * Controlled photography vocabulary: the only place where work types (categories) and tag values
 * (locations, cameras, lenses, shooting conditions) are defined.
 *
 * Each list holds the URL slug and the visible label. The content schema in `src/content.config.ts`
 * accepts exactly these slugs, so a photo that uses a value missing here fails the build. List order
 * is display order (category cards, tag filters, tag pages).
 */

type VocabularyEntry<T extends string = string> = {
  readonly slug: T;
  readonly label: string;
};

export const photographyCategories = [
  { slug: 'still-life', label: 'Still Life', labelZh: '静物' },
  { slug: 'landscape', label: 'Landscape', labelZh: '风光' },
  { slug: 'street', label: 'Street', labelZh: '街头' },
  { slug: 'abstract', label: 'Abstract', labelZh: '抽象' },
  { slug: 'black-and-white', label: 'Black & White', labelZh: '黑白' },
  { slug: 'architecture', label: 'Architecture', labelZh: '建筑' }
] as const satisfies readonly (VocabularyEntry & { readonly labelZh: string })[];

export const photographyLocations = [
  { slug: 'zurich', label: 'Zurich' },
  { slug: 'paris', label: 'Paris' },
  { slug: 'iceland', label: 'Iceland' },
  { slug: 'st-moritz', label: 'St. Moritz' },
  { slug: 'shanxi', label: 'Shanxi' },
  { slug: 'bern', label: 'Bern' },
  { slug: 'tallinn', label: 'Tallinn' },
  { slug: 'riga', label: 'Riga' }
] as const satisfies readonly VocabularyEntry[];

export const photographyCameras = [
  { slug: 'nikon-zf', label: 'Nikon Zf' },
  { slug: 'iphone', label: 'iPhone' },
  { slug: 'ricoh-gr-iv-hdf', label: 'Ricoh GR IV HDF' },
  { slug: 'leica-q3-28', label: 'Leica Q3 28' }
] as const satisfies readonly VocabularyEntry[];

export const photographyLenses = [
  { slug: 'nikkor-z-24mm', label: 'NIKKOR Z 24mm' },
  { slug: 'nikkor-z-24-200mm', label: 'NIKKOR Z 24-200mm' },
  { slug: '24-120mm-zoom', label: 'NIKKOR Z 24-120mm' },
  { slug: '40mm-prime', label: '40mm Prime' },
  { slug: '28mm-prime', label: '28mm Prime' }
] as const satisfies readonly VocabularyEntry[];

export const photographyConditions = [
  { slug: 'clear', label: 'Clear' },
  { slug: 'rain', label: 'Rain' },
  { slug: 'night', label: 'Night' },
  { slug: 'blue-hour', label: 'Blue Hour' },
  { slug: 'overcast', label: 'Overcast' },
  { slug: 'snow', label: 'Snow' },
  { slug: 'fog', label: 'Fog' }
] as const satisfies readonly VocabularyEntry[];

export type CategoryEntry = (typeof photographyCategories)[number];
export type CategorySlug = CategoryEntry['slug'];
export type LocationSlug = (typeof photographyLocations)[number]['slug'];
export type CameraSlug = (typeof photographyCameras)[number]['slug'];
export type LensSlug = (typeof photographyLenses)[number]['slug'];
export type ConditionSlug = (typeof photographyConditions)[number]['slug'];

/** Slug tuples for `z.enum` in the content schema, derived from the lists above. */
const slugsOf = <const T extends readonly VocabularyEntry[]>(entries: T) =>
  entries.map((entry) => entry.slug) as unknown as readonly [T[number]['slug'], ...T[number]['slug'][]];

export const categorySlugs = slugsOf(photographyCategories);
export const locationSlugs = slugsOf(photographyLocations);
export const cameraSlugs = slugsOf(photographyCameras);
export const lensSlugs = slugsOf(photographyLenses);
export const conditionSlugs = slugsOf(photographyConditions);

/** Visible label for a slug; `''` (an unset optional field) stays `''`. */
export const getVocabularyLabel = <T extends string>(entries: readonly VocabularyEntry<T>[], slug: T | '') => {
  if (slug === '') return '';

  const entry = entries.find((candidate) => candidate.slug === slug);

  if (!entry) {
    throw new Error(`Unknown photography vocabulary slug "${slug}"; add it to src/data/photographyVocab.ts.`);
  }

  return entry.label;
};
