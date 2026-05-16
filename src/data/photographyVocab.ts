export const categorySlugs = ['still-life', 'landscape', 'street'] as const;
export const locationSlugs = ['zurich', 'paris', 'iceland'] as const;
export const cameraSlugs = ['nikon-zf'] as const;
export const lensSlugs = ['24-120mm-zoom', '40mm-prime'] as const;
export const weatherSlugs = ['sunny-day', 'rainy-night'] as const;

export type CategorySlug = (typeof categorySlugs)[number];
export type LocationSlug = (typeof locationSlugs)[number];
export type CameraSlug = (typeof cameraSlugs)[number];
export type LensSlug = (typeof lensSlugs)[number];
export type WeatherSlug = (typeof weatherSlugs)[number];

type VocabularyEntry<T extends string> = {
  slug: T;
  label: string;
};

export const photographyCategories = [
  { slug: 'still-life', label: 'Still Life' },
  { slug: 'landscape', label: 'Landscape' },
  { slug: 'street', label: 'Street' }
] as const satisfies readonly VocabularyEntry<CategorySlug>[];

export const photographyLocations = [
  { slug: 'zurich', label: 'Zurich' },
  { slug: 'paris', label: 'Paris' },
  { slug: 'iceland', label: 'Iceland' }
] as const satisfies readonly VocabularyEntry<LocationSlug>[];

export const photographyCameras = [
  { slug: 'nikon-zf', label: 'Nikon Zf' }
] as const satisfies readonly VocabularyEntry<CameraSlug>[];

export const photographyLenses = [
  { slug: '24-120mm-zoom', label: '24-120mm Zoom' },
  { slug: '40mm-prime', label: '40mm Prime' }
] as const satisfies readonly VocabularyEntry<LensSlug>[];

export const photographyWeather = [
  { slug: 'sunny-day', label: 'Sunny Day' },
  { slug: 'rainy-night', label: 'Rainy Night' }
] as const satisfies readonly VocabularyEntry<WeatherSlug>[];

export const photographyVocabulary = {
  categories: photographyCategories,
  locations: photographyLocations,
  cameras: photographyCameras,
  lenses: photographyLenses,
  weather: photographyWeather
};

export const getVocabularyLabel = <T extends string>(
  entries: readonly VocabularyEntry<T>[],
  slug: T | ''
) => (slug === '' ? '' : entries.find((entry) => entry.slug === slug)?.label ?? slug);
