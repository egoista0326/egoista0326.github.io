import type { CollectionEntry } from 'astro:content';
import {
  getVocabularyLabel,
  photographyCameras,
  photographyCategories,
  photographyLenses,
  photographyLocations,
  photographyWeather,
  type CameraSlug,
  type CategorySlug,
  type LensSlug,
  type LocationSlug,
  type WeatherSlug
} from '../data/photographyVocab';

export type PhotoEntry = CollectionEntry<'photos'>;
export type TagGroupSlug = 'location' | 'camera' | 'lens' | 'weather';

type VocabularyTag = {
  slug: string;
  label: string;
  href: string;
  count: number;
};

export type UsedTagGroup = {
  slug: TagGroupSlug;
  label: string;
  tags: VocabularyTag[];
};

export const isVisibleTitle = (title?: string) => {
  const normalizedTitle = title?.trim() ?? '';

  return normalizedTitle !== '' && title !== 'Untitled' && normalizedTitle.toLowerCase() !== 'untitled';
};

export const getPhotoSlug = (photo: PhotoEntry) => photo.data.slug;

export const getPhotoHref = (photo: PhotoEntry) => `/photography/${getPhotoSlug(photo)}/`;

export const getCategoryHref = (category: CategorySlug) => `/photography/category/${category}/`;

export const getTagHref = (group: TagGroupSlug, slug: string) => `/photography/tags/${group}/${slug}/`;

export const getPhotoAlt = (photo: PhotoEntry) => {
  if (photo.data.alt.trim() !== '') {
    return photo.data.alt;
  }

  if (isVisibleTitle(photo.data.title)) {
    return photo.data.title;
  }

  const category = getVocabularyLabel(photographyCategories, photo.data.category);
  const location = getVocabularyLabel(photographyLocations, photo.data.location);

  return [category, location].filter(Boolean).join(' photograph in ') || 'Photograph';
};

export const sortPhotosForDisplay = (photos: PhotoEntry[]) =>
  [...photos].sort((a, b) => {
    const orderDifference = a.data.order - b.data.order;

    if (orderDifference !== 0) {
      return orderDifference;
    }

    const aTime = a.data.date === '' ? 0 : Date.parse(a.data.date);
    const bTime = b.data.date === '' ? 0 : Date.parse(b.data.date);

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return getPhotoSlug(a).localeCompare(getPhotoSlug(b));
  });

export const getPhotoDisplayMeta = (photo: PhotoEntry) => ({
  title: isVisibleTitle(photo.data.title) ? photo.data.title : '',
  category: getVocabularyLabel(photographyCategories, photo.data.category),
  location: getVocabularyLabel(photographyLocations, photo.data.location),
  camera: getVocabularyLabel(photographyCameras, photo.data.camera),
  lens: getVocabularyLabel(photographyLenses, photo.data.lens),
  weather: getVocabularyLabel(photographyWeather, photo.data.weather)
});

export const getPhotosByCategory = (photos: PhotoEntry[], category: CategorySlug) =>
  sortPhotosForDisplay(photos.filter((photo) => photo.data.category === category));

const getPhotoTagValue = (photo: PhotoEntry, group: TagGroupSlug) => photo.data[group];

export const getPhotosByTag = (photos: PhotoEntry[], group: TagGroupSlug, slug: string) =>
  sortPhotosForDisplay(photos.filter((photo) => getPhotoTagValue(photo, group) === slug));

const tagGroupDefinitions = [
  {
    slug: 'location',
    label: 'Locations',
    entries: photographyLocations
  },
  {
    slug: 'camera',
    label: 'Camera',
    entries: photographyCameras
  },
  {
    slug: 'lens',
    label: 'Lens',
    entries: photographyLenses
  },
  {
    slug: 'weather',
    label: 'Weather',
    entries: photographyWeather
  }
] as const satisfies readonly {
  slug: TagGroupSlug;
  label: string;
  entries: readonly {
    slug: LocationSlug | CameraSlug | LensSlug | WeatherSlug;
    label: string;
  }[];
}[];

export const getUsedTagGroups = (photos: PhotoEntry[]) =>
  tagGroupDefinitions
    .map((group) => {
      const tags = group.entries
        .map((entry) => {
          const count = photos.filter((photo) => getPhotoTagValue(photo, group.slug) === entry.slug).length;

          return {
            slug: entry.slug,
            label: entry.label,
            href: getTagHref(group.slug, entry.slug),
            count
          };
        })
        .filter((tag) => tag.count > 0);

      return {
        slug: group.slug,
        label: group.label,
        tags
      };
    })
    .filter((group) => group.tags.length > 0);

export const getAdjacentPhotos = (photos: PhotoEntry[], currentSlug: string) => {
  const orderedPhotos = sortPhotosForDisplay(photos);
  const currentIndex = orderedPhotos.findIndex((photo) => getPhotoSlug(photo) === currentSlug);

  return {
    previous: currentIndex > 0 ? orderedPhotos[currentIndex - 1] : undefined,
    next:
      currentIndex >= 0 && currentIndex < orderedPhotos.length - 1
        ? orderedPhotos[currentIndex + 1]
        : undefined
  };
};
