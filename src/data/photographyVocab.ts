export const categorySlugs = [
  'still-life',
  'landscape',
  'street',
  'abstract',
  'black-and-white',
  'architecture'
] as const;
export const locationSlugs = ['zurich', 'paris', 'iceland', 'st-moritz', 'shanxi'] as const;
export const cameraSlugs = ['nikon-zf'] as const;
export const lensSlugs = ['nikkor-z-24mm', 'nikkor-z-24-200mm', '24-120mm-zoom', '40mm-prime'] as const;
export const conditionSlugs = ['clear', 'rain', 'night', 'blue-hour', 'overcast', 'snow', 'fog'] as const;

export type CategorySlug = (typeof categorySlugs)[number];
export type LocationSlug = (typeof locationSlugs)[number];
export type CameraSlug = (typeof cameraSlugs)[number];
export type LensSlug = (typeof lensSlugs)[number];
export type ConditionSlug = (typeof conditionSlugs)[number];

type VocabularyEntry<T extends string> = {
  slug: T;
  label: string;
};

export const photographyCategories = [
  { slug: 'still-life', label: 'Still Life' },
  { slug: 'landscape', label: 'Landscape' },
  { slug: 'street', label: 'Street' },
  { slug: 'abstract', label: 'Abstract' },
  { slug: 'black-and-white', label: 'Black & White' },
  { slug: 'architecture', label: 'Architecture' }
] as const satisfies readonly VocabularyEntry<CategorySlug>[];

export const photographyLocations = [
  { slug: 'zurich', label: 'Zurich' },
  { slug: 'paris', label: 'Paris' },
  { slug: 'iceland', label: 'Iceland' },
  { slug: 'st-moritz', label: 'St. Moritz' },
  { slug: 'shanxi', label: 'Shanxi' }
] as const satisfies readonly VocabularyEntry<LocationSlug>[];

export const photographyCameras = [
  { slug: 'nikon-zf', label: 'Nikon Zf' }
] as const satisfies readonly VocabularyEntry<CameraSlug>[];

export const photographyLenses = [
  { slug: 'nikkor-z-24mm', label: 'NIKKOR Z 24mm' },
  { slug: 'nikkor-z-24-200mm', label: 'NIKKOR Z 24-200mm' },
  { slug: '24-120mm-zoom', label: 'NIKKOR Z 24-120mm' },
  { slug: '40mm-prime', label: '40mm Prime' }
] as const satisfies readonly VocabularyEntry<LensSlug>[];

export const photographyConditions = [
  { slug: 'clear', label: 'Clear' },
  { slug: 'rain', label: 'Rain' },
  { slug: 'night', label: 'Night' },
  { slug: 'blue-hour', label: 'Blue Hour' },
  { slug: 'overcast', label: 'Overcast' },
  { slug: 'snow', label: 'Snow' },
  { slug: 'fog', label: 'Fog' }
] as const satisfies readonly VocabularyEntry<ConditionSlug>[];

export const photographyVocabulary = {
  categories: photographyCategories,
  locations: photographyLocations,
  cameras: photographyCameras,
  lenses: photographyLenses,
  conditions: photographyConditions
};

export const getVocabularyLabel = <T extends string>(
  entries: readonly VocabularyEntry<T>[],
  slug: T | ''
) => (slug === '' ? '' : entries.find((entry) => entry.slug === slug)?.label ?? slug);
