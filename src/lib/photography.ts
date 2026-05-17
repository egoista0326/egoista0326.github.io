import type { CollectionEntry } from 'astro:content';
import {
  getVocabularyLabel,
  photographyCameras,
  photographyCategories,
  photographyConditions,
  photographyLenses,
  photographyLocations,
  type CameraSlug,
  type CategorySlug,
  type ConditionSlug,
  type LensSlug,
  type LocationSlug
} from '../data/photographyVocab';

export type PhotoEntry = CollectionEntry<'photos'>;
export type TagGroupSlug = 'location' | 'camera' | 'lens' | 'condition';

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

export const getSelectedPhotoHref = (photo: PhotoEntry) => `/photography/selected/${getPhotoSlug(photo)}/`;

export const getCategoryHref = (category: CategorySlug) => `/photography/category/${category}/`;

export const getCategoryPhotoHref = (category: CategorySlug, photo: PhotoEntry) =>
  `${getCategoryHref(category)}${getPhotoSlug(photo)}/`;

export const getTagHref = (group: TagGroupSlug, slug: string) => `/photography/tags/${group}/${slug}/`;

const uniqueValues = <T extends string>(values: readonly (T | '')[]) =>
  Array.from(new Set(values.filter((value): value is T => value !== '')));

const getVocabularyLabels = <T extends string>(
  entries: readonly { slug: T; label: string }[],
  slugs: readonly T[]
) => slugs.map((slug) => getVocabularyLabel(entries, slug)).filter(Boolean).join(', ');

export const getPhotoCategories = (photo: PhotoEntry) =>
  uniqueValues<CategorySlug>([photo.data.category, ...photo.data.categories]);

export const getPhotoConditions = (photo: PhotoEntry) =>
  uniqueValues<ConditionSlug>([photo.data.condition, ...photo.data.conditions]);

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
  category: getVocabularyLabels(photographyCategories, getPhotoCategories(photo)),
  location: getVocabularyLabel(photographyLocations, photo.data.location),
  camera: getVocabularyLabel(photographyCameras, photo.data.camera),
  lens: getVocabularyLabel(photographyLenses, photo.data.lens),
  condition: getVocabularyLabels(photographyConditions, getPhotoConditions(photo))
});

export const getPhotosByCategory = (photos: PhotoEntry[], category: CategorySlug) =>
  sortPhotosForDisplay(photos.filter((photo) => getPhotoCategories(photo).includes(category)));

const getPhotoTagValues = (photo: PhotoEntry, group: TagGroupSlug): string[] => {
  if (group === 'condition') {
    return getPhotoConditions(photo);
  }

  const value = photo.data[group];
  return value === '' ? [] : [value];
};

export const getPhotosByTag = (photos: PhotoEntry[], group: TagGroupSlug, slug: string) =>
  sortPhotosForDisplay(photos.filter((photo) => getPhotoTagValues(photo, group).includes(slug)));

export const getPhotosBySlugs = (photos: PhotoEntry[], photoSlugs: readonly string[]) => {
  const photosBySlug = new Map(photos.map((photo) => [getPhotoSlug(photo), photo]));

  return photoSlugs
    .map((slug) => photosBySlug.get(slug))
    .filter((photo): photo is PhotoEntry => Boolean(photo));
};

export const getPhotoSearchTags = (photo: PhotoEntry) => ({
  location: photo.data.location === '' ? [] : [photo.data.location],
  camera: photo.data.camera === '' ? [] : [photo.data.camera],
  lens: photo.data.lens === '' ? [] : [photo.data.lens],
  condition: getPhotoConditions(photo)
});

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
    slug: 'condition',
    label: 'Conditions',
    entries: photographyConditions
  }
] as const satisfies readonly {
  slug: TagGroupSlug;
  label: string;
  entries: readonly {
    slug: LocationSlug | CameraSlug | LensSlug | ConditionSlug;
    label: string;
  }[];
}[];

export const getUsedTagGroups = (photos: PhotoEntry[]) =>
  tagGroupDefinitions
    .map((group) => {
      const tags = group.entries
        .map((entry) => {
          const count = photos.filter((photo) => getPhotoTagValues(photo, group.slug).includes(entry.slug)).length;

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

export const getAdjacentPhotosInOrder = (orderedPhotos: PhotoEntry[], currentSlug: string) => {
  const currentIndex = orderedPhotos.findIndex((photo) => getPhotoSlug(photo) === currentSlug);

  return {
    previous: currentIndex > 0 ? orderedPhotos[currentIndex - 1] : undefined,
    next:
      currentIndex >= 0 && currentIndex < orderedPhotos.length - 1
        ? orderedPhotos[currentIndex + 1]
        : undefined
  };
};

export const getAdjacentPhotos = (photos: PhotoEntry[], currentSlug: string) =>
  getAdjacentPhotosInOrder(sortPhotosForDisplay(photos), currentSlug);
