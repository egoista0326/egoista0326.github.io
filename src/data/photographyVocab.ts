/**
 * Controlled photography vocabulary: the only place where work types (categories) and tag values
 * (locations, cameras, lenses, shooting conditions) are defined.
 *
 * Each list holds the URL slug and the visible label (categories, lenses and conditions also a Chinese label). The content schema in `src/content.config.ts`
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

// Lens labels in one style, focal length then Prime or Zoom: "28mm Prime" is the fixed lens of two cameras (Leica
// Q3 28, Ricoh GR IV HDF), so a maker's name cannot head every label. The slugs (URLs) are unchanged. They are
// descriptions, not product names, so they carry a Chinese label (定焦 prime, 变焦 zoom) as the conditions do.
export const photographyLenses = [
  { slug: 'nikkor-z-24mm', label: '24mm Prime', labelZh: '24mm 定焦' },
  { slug: 'nikkor-z-24-200mm', label: '24-200mm Zoom', labelZh: '24-200mm 变焦' },
  { slug: '24-120mm-zoom', label: '24-120mm Zoom', labelZh: '24-120mm 变焦' },
  { slug: '40mm-prime', label: '40mm Prime', labelZh: '40mm 定焦' },
  { slug: '28mm-prime', label: '28mm Prime', labelZh: '28mm 定焦' }
] as const satisfies readonly (VocabularyEntry & { readonly labelZh: string })[];

/** Shooting conditions carry a Chinese label as the categories do; place and camera names stay as written. */
export const photographyConditions = [
  { slug: 'clear', label: 'Clear Sky', labelZh: '晴天' },
  { slug: 'rain', label: 'Rain', labelZh: '雨天' },
  { slug: 'night', label: 'Night', labelZh: '夜晚' },
  { slug: 'blue-hour', label: 'Blue Hour', labelZh: '蓝调时刻' },
  { slug: 'overcast', label: 'Overcast', labelZh: '阴天' },
  { slug: 'snow', label: 'Snow', labelZh: '雪天' },
  { slug: 'fog', label: 'Fog', labelZh: '雾天' }
] as const satisfies readonly (VocabularyEntry & { readonly labelZh: string })[];

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
