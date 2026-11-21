import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getCollection, type CollectionEntry } from 'astro:content';
import {
  photographyProfile,
  photographyProjects,
  photographySelectedWorkSlugs,
  type PhotographyProject
} from '../data/photography';
import { photographyCategoryCovers } from '../data/photographyCategoryCovers';
import {
  getVocabularyLabel,
  photographyCameras,
  photographyCategories,
  photographyConditions,
  photographyLenses,
  photographyLocations,
  type CategoryEntry,
  type CategorySlug,
  type ConditionSlug
} from '../data/photographyVocab';
import { photoAnchorId, type PhotoTagValues, type TagContextData } from './photographyTagFilter';

export type PhotoEntry = CollectionEntry<'photos'>;

/** Maps a photo to its URL inside the gallery being browsed (category, project, selected, ...). */
export type PhotoHref = (photo: PhotoEntry) => string;

/** Visible text in both page languages (`data-lang-inline="en"` / `"zh"`). */
export type BilingualText = { en: string; zh: string };

// ---------------------------------------------------------------------------------------------
// URLs. The route files under src/pages/photography/ must match these shapes.
// ---------------------------------------------------------------------------------------------

export const getPhotoSlug = (photo: PhotoEntry) => photo.data.slug;

export const getPhotoHref: PhotoHref = (photo) => `/photography/${getPhotoSlug(photo)}/`;

export const getSelectedPhotoHref: PhotoHref = (photo) => `/photography/selected/${getPhotoSlug(photo)}/`;

export const getCategoryHref = (category: CategorySlug) => `/photography/category/${category}/`;

export const getCategoryPhotoHref = (category: CategorySlug, photo: PhotoEntry) =>
  `${getCategoryHref(category)}${getPhotoSlug(photo)}/`;

export const getProjectHref = (projectSlug: string) => `/photography/projects/${projectSlug}/`;

export const getProjectPhotoHref = (projectSlug: string, photo: PhotoEntry) =>
  `${getProjectHref(projectSlug)}${getPhotoSlug(photo)}/`;

export const getTagHref = (group: TagGroupSlug, slug: string) => `/photography/tags/${group}/${slug}/`;

export const getTagPhotoHref = (group: TagGroupSlug, slug: string, photo: PhotoEntry) =>
  `${getTagHref(group, slug)}${getPhotoSlug(photo)}/`;

/** The combined filter page; photo pages opened from it carry `?from=tags&<filters>`. */
export const tagFilterHref = '/photography/tags/';

/** `id` of the photo's grid item, so `<gallery URL>#photo-<slug>` returns to it. */
export const getPhotoAnchorId = (photo: PhotoEntry) => photoAnchorId(getPhotoSlug(photo));

// ---------------------------------------------------------------------------------------------
// Per-photo display values.
// ---------------------------------------------------------------------------------------------

/** `"Untitled"` (any case) or an empty title marks a photo without a public title. */
const isVisibleTitle = (title?: string) => {
  const normalizedTitle = title?.trim() ?? '';

  return normalizedTitle !== '' && normalizedTitle.toLowerCase() !== 'untitled';
};

/** The public title, or `''` when the photo has none. */
export const getPhotoTitle = (photo: PhotoEntry) => (isVisibleTitle(photo.data.title) ? photo.data.title : '');

const uniqueValues = <T extends string>(values: readonly (T | '')[]) =>
  Array.from(new Set(values.filter((value): value is T => value !== '')));

const joinVocabularyLabels = <T extends string>(
  entries: readonly { slug: T; label: string }[],
  slugs: readonly T[]
) => slugs.map((slug) => getVocabularyLabel(entries, slug)).join(', ');

/** Primary category first, then the additional ones, without duplicates. */
export const getPhotoCategories = (photo: PhotoEntry) =>
  uniqueValues<CategorySlug>([photo.data.category, ...photo.data.categories]);

/** Primary condition first, then the additional ones, without duplicates or `''`. */
export const getPhotoConditions = (photo: PhotoEntry) =>
  uniqueValues<ConditionSlug>([photo.data.condition, ...photo.data.conditions]);

export const getPhotoAlt = (photo: PhotoEntry) => {
  if (photo.data.alt.trim() !== '') {
    return photo.data.alt;
  }

  const title = getPhotoTitle(photo);

  if (title) {
    return title;
  }

  const category = getVocabularyLabel(photographyCategories, photo.data.category);
  const location = getVocabularyLabel(photographyLocations, photo.data.location);

  return [category, location].filter(Boolean).join(' photograph in ') || 'Photograph';
};

const getCategoryEntry = (slug: CategorySlug) =>
  photographyCategories.find((entry) => entry.slug === slug) as CategoryEntry;

/** Labels shown in grid captions and navigation labels; `''` for an unset field. */
export const getPhotoDisplayMeta = (photo: PhotoEntry) => ({
  title: getPhotoTitle(photo),
  category: joinVocabularyLabels(photographyCategories, getPhotoCategories(photo)),
  categoryZh: getPhotoCategories(photo)
    .map((slug) => getCategoryEntry(slug).labelZh)
    .join('、'),
  location: getVocabularyLabel(photographyLocations, photo.data.location),
  camera: getVocabularyLabel(photographyCameras, photo.data.camera),
  lens: getVocabularyLabel(photographyLenses, photo.data.lens),
  condition: joinVocabularyLabels(photographyConditions, getPhotoConditions(photo))
});

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `"2026-08-25"` -> `"25 Aug 2026"` (fixed English form, independent of the build machine's locale). */
export const formatPhotoDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);

  return `${day} ${monthNames[month - 1]} ${year}`;
};

/**
 * Label built only from a photo's own metadata: its title; else "Location, 25 Aug 2026" when dated;
 * else "Category, Location" (primary category). Not unique; `PhotoLibrary.labelOf` makes it unique.
 */
const getPhotoBaseLabel = (photo: PhotoEntry) => {
  const title = getPhotoTitle(photo);
  if (title) return title;

  const category = getVocabularyLabel(photographyCategories, photo.data.category);
  const location = getVocabularyLabel(photographyLocations, photo.data.location);

  if (photo.data.date) {
    return [location || category, formatPhotoDate(photo.data.date)].join(', ');
  }

  return [category, location].filter(Boolean).join(', ');
};

/** Stable id from the slug for telling apart photos with the same base label: `dsc-0155` -> `DSC-0155`. */
const getPhotoFileLabel = (photo: PhotoEntry) => {
  const slug = getPhotoSlug(photo);

  return /^dsc-\d+$/.test(slug) ? slug.toUpperCase() : slug;
};

/**
 * One label per photo, unique within the library, for tab titles, history entries, the photo page's
 * heading of an untitled photo and Previous/Next names: the base label, plus " · DSC-0155" (from the
 * slug) when several photos share it. No text is invented beyond the metadata.
 */
const buildPhotoLabels = (photos: readonly PhotoEntry[]) => {
  const baseLabels = new Map(photos.map((photo) => [getPhotoSlug(photo), getPhotoBaseLabel(photo)]));
  const uses = new Map<string, number>();

  for (const label of baseLabels.values()) uses.set(label, (uses.get(label) ?? 0) + 1);

  return new Map(
    photos.map((photo) => {
      const base = baseLabels.get(getPhotoSlug(photo)) as string;

      return [getPhotoSlug(photo), (uses.get(base) ?? 0) > 1 ? `${base} · ${getPhotoFileLabel(photo)}` : base];
    })
  );
};

// ---------------------------------------------------------------------------------------------
// Responsive images. `scripts/import_photos.py` writes width variants next to each published image:
// `public/assets/photography/variants/<stem>-<width>.webp` (and `verify_photo_import.mjs` checks them).
// The build reads which variants exist, so `srcset` always lists real files.
// ---------------------------------------------------------------------------------------------

const variantsDir = 'assets/photography/variants';
let variantWidthsByStem: Map<string, number[]> | undefined;

const getVariantWidths = (stem: string) => {
  if (!variantWidthsByStem) {
    variantWidthsByStem = new Map();
    const dir = join(process.cwd(), 'public', variantsDir);

    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      const match = /^(.+)-(\d+)\.webp$/.exec(file);
      if (!match) continue;
      const widths = variantWidthsByStem.get(match[1]) ?? [];
      widths.push(Number(match[2]));
      variantWidthsByStem.set(match[1], widths);
    }

    for (const widths of variantWidthsByStem.values()) widths.sort((a, b) => a - b);
  }

  return variantWidthsByStem.get(stem) ?? [];
};

/**
 * `srcset` of a published image (`/assets/photography/...`, `width` px wide): its smaller width
 * variants plus the file itself as the largest candidate.
 */
export const getImageSrcset = (src: string, width: number) => {
  const stem = basename(src).replace(/\.[^.]+$/, '');
  const variants = getVariantWidths(stem)
    .filter((variantWidth) => variantWidth < width)
    .map((variantWidth) => `/${variantsDir}/${stem}-${variantWidth}.webp ${variantWidth}w`);

  return [...variants, `${src} ${width}w`].join(', ');
};

/** Display order: `order` ascending, then newer `date` first (undated last), then slug. */
export const sortPhotosForDisplay = (photos: readonly PhotoEntry[]) =>
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

// Photo page geometry, the same values as in photography.css ("Photo pages"): the viewport height
// around the photo (site header, bar, gaps), the photo's height cap (`--photo-max-height`; `sizes`
// uses vh, the layout svh), the metadata column beside the photo with its gap (`--photo-meta-width` +
// `--space-xl`) and the margin around the photo in the quiet full view (twice its 12px padding).
const photoPageChrome = '176px';
const photoMaxHeightIn = (vh: 'vh' | 'svh') => `max(320px, min(85${vh}, 100${vh} - ${photoPageChrome}))`;
const photoMaxHeight = photoMaxHeightIn('svh');
const photoMetaColumn = '292px';
const quietViewMargin = '24px';

/**
 * A landscape photo keeps its metadata on the right only while the photo there is at least this share
 * of the width it gets with the metadata below; otherwise the metadata goes below.
 */
const landscapeSideMinShare = 0.9;

/**
 * Per-page CSS of a photo page: for a landscape photo (width / height = r), the frame width from which
 * the metadata sits on the right. With frame width F and photo height cap H, the photo is
 * min(r * H, F - 292px) wide beside the metadata and min(r * H, F) below it; the metadata goes right
 * when F - 292px >= 0.9 * min(r * H, F), which for any frame up to 2920px is F >= 292px + 0.9 * r * H.
 * A container query cannot read custom properties, so the threshold is written per photo; it is plain
 * CSS, so the layout is right at first paint. Square and portrait photos use the fixed rule of photography.css
 * (right from a 640px frame) and get no per-page CSS.
 */
export const getPhotoPageLayoutCss = (photo: PhotoEntry): string | undefined => {
  if (photo.data.orientation !== 'landscape') return undefined;

  const ratio = (photo.data.width / photo.data.height).toFixed(4);
  const sideFrom = `calc(${photoMetaColumn} + ${landscapeSideMinShare} * ${ratio} * ${photoMaxHeight})`;

  return `@container photo-view (min-width: ${sideFrom}) { .photo-view.is-landscape { grid-template-columns: minmax(0, var(--photo-fit-width)) var(--photo-meta-width); } }`;
};

/**
 * `src`, `srcset`, `sizes` and pixel size of a photo's main image on its photo page. `sizes` follows
 * the photo page layout of photography.css: full width on phones, otherwise the height-limited width
 * (the same height cap, including its 320px floor), at most the frame (landscape: metadata below) or
 * the width left beside the metadata column (square, portrait). A landscape photo with the metadata on
 * the right is at least 90% of that width. `quietSizes` is the photo's width in the quiet full view
 * (fitted to the viewport less its margin); the page script swaps it in while that view is on.
 */
export const getPhotoPageImage = (photo: PhotoEntry) => {
  const ratio = (photo.data.width / photo.data.height).toFixed(4);
  const heightLimited = `calc(${photoMaxHeightIn('vh')} * ${ratio})`;
  const sizes =
    photo.data.orientation === 'landscape'
      ? `(max-width: 767px) calc(100vw - 40px), (max-width: 1023px) min(${heightLimited}, calc(100vw - 64px)), min(${heightLimited}, calc(100vw - 80px), 1680px)`
      : `(max-width: 767px) calc(100vw - 40px), min(${heightLimited}, calc(100vw - 372px))`;

  return {
    src: photo.data.image,
    srcset: getImageSrcset(photo.data.image, photo.data.width),
    sizes,
    quietSizes: `min(calc(100vw - ${quietViewMargin}), calc((100vh - ${quietViewMargin}) * ${ratio}))`,
    width: photo.data.width,
    height: photo.data.height
  };
};

// ---------------------------------------------------------------------------------------------
// Tags: location, camera, lens and condition, each a group of controlled values.
// ---------------------------------------------------------------------------------------------

/** `label` heads a filter group; `rowLabel` heads the metadata row of a photo page. */
const tagGroupDefinitions = [
  { slug: 'location', label: 'Locations', rowLabel: 'Location', labelZh: '地点', entries: photographyLocations },
  { slug: 'camera', label: 'Camera', rowLabel: 'Camera', labelZh: '相机', entries: photographyCameras },
  { slug: 'lens', label: 'Lens', rowLabel: 'Lens', labelZh: '镜头', entries: photographyLenses },
  { slug: 'condition', label: 'Conditions', rowLabel: 'Conditions', labelZh: '拍摄条件', entries: photographyConditions }
] as const;

export type TagGroupSlug = (typeof tagGroupDefinitions)[number]['slug'];

export type UsedTag = {
  slug: string;
  label: string;
  href: string;
  /** Number of photos with this tag. */
  count: number;
};

export type UsedTagGroup = {
  slug: TagGroupSlug;
  label: string;
  labelZh: string;
  tags: UsedTag[];
};

const getPhotoTagValues = (photo: PhotoEntry, group: TagGroupSlug): string[] => {
  if (group === 'condition') {
    return getPhotoConditions(photo);
  }

  const value = photo.data[group];
  return value === '' ? [] : [value];
};

/** Tag values per group, written as `data-<group>` attributes for the client-side tag filter. */
export const getPhotoSearchTags = (photo: PhotoEntry): PhotoTagValues =>
  Object.fromEntries(tagGroupDefinitions.map((group) => [group.slug, getPhotoTagValues(photo, group.slug)]));

export type PhotoMetadataValue = { label: BilingualText; href: string };

/** One row of the metadata panel; each value links to its category or tag gallery. */
export type PhotoMetadataRow = { key: string; label: BilingualText; values: PhotoMetadataValue[] };

/** Type (categories), then location, camera, lens and conditions; rows without a value are left out. */
export const getPhotoMetadataRows = (photo: PhotoEntry): PhotoMetadataRow[] =>
  [
    {
      key: 'type',
      label: { en: 'Type', zh: '类型' },
      values: getPhotoCategories(photo).map((slug) => {
        const entry = getCategoryEntry(slug);

        return { label: { en: entry.label, zh: entry.labelZh }, href: getCategoryHref(slug) };
      })
    },
    ...tagGroupDefinitions.map((group) => ({
      key: group.slug,
      label: { en: group.rowLabel, zh: group.labelZh },
      values: getPhotoTagValues(photo, group.slug).map((slug) => {
        const label = getVocabularyLabel<string>(group.entries, slug);

        // Every tag a photo uses has a tag gallery (getUsedTagGroups keeps tags used at least once).
        return { label: { en: label, zh: label }, href: getTagHref(group.slug, slug) };
      })
    }))
  ].filter((row) => row.values.length > 0);

export const getPhotosByTag = (photos: readonly PhotoEntry[], group: TagGroupSlug, slug: string) =>
  photos.filter((photo) => getPhotoTagValues(photo, group).includes(slug));

/** Tag groups in vocabulary order, keeping only tags that at least one photo uses. */
const getUsedTagGroups = (photos: readonly PhotoEntry[]): UsedTagGroup[] =>
  tagGroupDefinitions
    .map((group) => ({
      slug: group.slug,
      label: group.label,
      labelZh: group.labelZh,
      tags: group.entries
        .map((entry) => ({
          slug: entry.slug,
          label: entry.label,
          href: getTagHref(group.slug, entry.slug),
          count: getPhotosByTag(photos, group.slug, entry.slug).length
        }))
        .filter((tag) => tag.count > 0)
    }))
    .filter((group) => group.tags.length > 0);

// ---------------------------------------------------------------------------------------------
// Previous / Next inside an ordered gallery.
// ---------------------------------------------------------------------------------------------

/**
 * Neighbours of `photo` in `orderedPhotos`. Every gallery stops at its ends: the first photo has no
 * Previous and the last no Next.
 */
export const getPhotoNeighbors = (
  orderedPhotos: readonly PhotoEntry[],
  photo: PhotoEntry
): { previous?: PhotoEntry; next?: PhotoEntry } => {
  const index = orderedPhotos.findIndex((candidate) => getPhotoSlug(candidate) === getPhotoSlug(photo));

  if (index < 0) {
    return {};
  }

  return { previous: orderedPhotos[index - 1], next: orderedPhotos[index + 1] };
};

// ---------------------------------------------------------------------------------------------
// The library: every gallery the photography pages render, built and validated in one place.
// ---------------------------------------------------------------------------------------------

export type CategoryCover = {
  image: string;
  alt: string;
  width: number;
  height: number;
  objectPosition?: string;
};

export type CategoryGallery = {
  category: CategoryEntry;
  cover: CategoryCover;
  /** Photos whose `category` or `categories` include this category, in display order. */
  photos: PhotoEntry[];
};

export type ProjectGallery = {
  project: PhotographyProject;
  /** Photos in the order of `project.photoSlugs`. */
  photos: PhotoEntry[];
};

export type TagGallery = {
  group: UsedTagGroup;
  tag: UsedTag;
  /** Photos with this tag, in display order. */
  photos: PhotoEntry[];
};

export type PhotoLibrary = {
  /** Every photo, in display order. */
  photos: PhotoEntry[];
  /** Selected Works, in the order of `photographySelectedWorkSlugs`. */
  selectedPhotos: PhotoEntry[];
  categories: CategoryGallery[];
  projects: ProjectGallery[];
  tagGroups: UsedTagGroup[];
  /** One gallery per used tag, in tag-group then vocabulary order. */
  tagGalleries: TagGallery[];
  /** The photo's unique label (title, else built from its metadata); see buildPhotoLabels. */
  labelOf: (photo: PhotoEntry) => string;
};

/** Photos directory and public folder, relative to the project root (where `npm run build` runs). */
const photosContentDir = join(process.cwd(), 'src/content/photos');
const publicDir = join(process.cwd(), 'public');

const duplicatesOf = (values: readonly string[]) =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

/**
 * Cross-file consistency checks that the per-file schema in src/content.config.ts cannot see.
 * Returns one readable line per problem; an empty list means the data is consistent.
 */
const findPhotographyDataProblems = (photos: readonly PhotoEntry[]) => {
  const problems: string[] = [];
  const photosBySlug = new Map(photos.map((photo) => [getPhotoSlug(photo), photo]));
  const knownPhoto = (slug: string) => photosBySlug.has(slug);
  const missingPhoto = (owner: string, slug: string) =>
    `${owner} refers to photo "${slug}", but there is no src/content/photos/${slug}.md.`;

  // Photos: the slug is the entry id, so two files with one slug would silently collapse into one.
  const markdownFiles = readdirSync(photosContentDir, { recursive: true }).filter((file) =>
    String(file).endsWith('.md')
  );

  if (markdownFiles.length !== photos.length) {
    problems.push(
      `src/content/photos/ has ${markdownFiles.length} Markdown files but ${photos.length} photos were loaded; two files share a slug (node scripts/verify_photo_import.mjs names them).`
    );
  }

  for (const photo of photos) {
    const slug = getPhotoSlug(photo);
    const fileName = photo.filePath ? basename(photo.filePath, '.md') : slug;

    if (fileName !== slug) {
      problems.push(`${photo.filePath}: slug "${slug}" must equal the file name "${fileName}".`);
    }

    if (!existsSync(join(publicDir, photo.data.image))) {
      problems.push(`${photo.filePath ?? slug}: image file public${photo.data.image} does not exist.`);
    }
  }

  // Selected Works.
  const selectedOwner = 'photographySelectedWorkSlugs (src/data/photography.ts)';

  for (const slug of photographySelectedWorkSlugs) {
    if (!knownPhoto(slug)) problems.push(missingPhoto(selectedOwner, slug));
  }

  for (const slug of duplicatesOf(photographySelectedWorkSlugs)) {
    problems.push(`${selectedOwner} lists "${slug}" more than once.`);
  }

  // Projects.
  for (const slug of duplicatesOf(photographyProjects.map((project) => project.slug))) {
    problems.push(`photographyProjects (src/data/photography.ts) has two projects with slug "${slug}".`);
  }

  for (const project of photographyProjects) {
    const owner = `Project "${project.slug}" (src/data/photography.ts)`;
    const photoSlugs: readonly string[] = project.photoSlugs;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug)) {
      problems.push(`${owner}: slug must be lowercase words joined by "-".`);
    }

    if (!/^\d{4}\.(?:[1-9]|1[0-2])$/.test(project.startDate)) {
      problems.push(`${owner}: startDate "${project.startDate}" must be "YYYY.M", e.g. "2026.1".`);
    }

    if (photoSlugs.length === 0) {
      problems.push(`${owner} has no photos in photoSlugs.`);
    }

    for (const slug of photoSlugs) {
      if (!knownPhoto(slug)) problems.push(missingPhoto(owner, slug));
    }

    for (const slug of duplicatesOf(photoSlugs)) {
      problems.push(`${owner} lists "${slug}" more than once.`);
    }
  }

  // Vocabulary: a duplicated slug would generate the same page twice.
  for (const entries of [photographyCategories, ...tagGroupDefinitions.map((group) => group.entries)]) {
    for (const slug of duplicatesOf(entries.map((entry: { slug: string }) => entry.slug))) {
      problems.push(`src/data/photographyVocab.ts defines the slug "${slug}" more than once in one list.`);
    }
  }

  // Category covers.
  const coversFile = 'src/data/photographyCategoryCovers.ts';
  const categorySlugs = new Set<string>(photographyCategories.map((category) => category.slug));

  for (const coverCategory of Object.keys(photographyCategoryCovers)) {
    if (!categorySlugs.has(coverCategory)) {
      problems.push(`${coversFile} has a cover for unknown category "${coverCategory}".`);
    }
  }

  for (const category of photographyCategories) {
    const cover = photographyCategoryCovers[category.slug];
    const owner = `Cover of category "${category.slug}" (${coversFile})`;

    if (!cover) {
      problems.push(`Category "${category.slug}" has no cover in ${coversFile}.`);
      continue;
    }

    const coverPhoto = photosBySlug.get(cover.photo);

    if (!coverPhoto) {
      problems.push(missingPhoto(owner, cover.photo));
    } else if (!getPhotoCategories(coverPhoto).includes(category.slug)) {
      problems.push(`${owner} is photo "${cover.photo}", which is not in that category; pick a photo of the category.`);
    }
  }

  return problems;
};

/**
 * Loads every photo, checks all cross-references and returns the galleries the pages render.
 * Each photography route calls it, so `npm run build` stops with one message listing every
 * broken reference (a missing photo in Selected Works, a project or a cover, a slug that does not
 * match its file name, a missing image file). Built once per build and shared by every route.
 */
let photoLibrary: Promise<PhotoLibrary> | undefined;

export const getPhotoLibrary = (): Promise<PhotoLibrary> => (photoLibrary ??= buildPhotoLibrary());

const buildPhotoLibrary = async (): Promise<PhotoLibrary> => {
  const photos = sortPhotosForDisplay(await getCollection('photos'));
  const problems = findPhotographyDataProblems(photos);

  if (problems.length > 0) {
    throw new Error(
      `Photography data is inconsistent; fix the following and rebuild:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`
    );
  }

  const drafts = photos.filter((photo) => photo.data.draftMetadata).map(getPhotoSlug);

  if (drafts.length > 0) {
    console.warn(
      `[photography] ${drafts.length} of ${photos.length} photos still have draftMetadata: true (unreviewed importer values): ${drafts.join(', ')}`
    );
  }

  const labels = buildPhotoLabels(photos);

  const photosBySlug = new Map(photos.map((photo) => [getPhotoSlug(photo), photo]));
  // Every slug was checked above, so the lookups below always succeed.
  const photosFor = (slugs: readonly string[]) => slugs.map((slug) => photosBySlug.get(slug) as PhotoEntry);
  const tagGroups = getUsedTagGroups(photos);

  return {
    photos,
    selectedPhotos: photosFor(photographySelectedWorkSlugs),
    categories: photographyCategories.map((category) => {
      const coverSpec = photographyCategoryCovers[category.slug];
      const coverPhoto = photosBySlug.get(coverSpec.photo) as PhotoEntry;

      return {
        category,
        cover: {
          image: coverPhoto.data.image,
          alt: coverSpec.alt,
          width: coverPhoto.data.width,
          height: coverPhoto.data.height,
          objectPosition: coverSpec.objectPosition
        },
        photos: photos.filter((photo) => getPhotoCategories(photo).includes(category.slug))
      };
    }),
    projects: photographyProjects.map((project) => ({ project, photos: photosFor(project.photoSlugs) })),
    tagGroups,
    tagGalleries: tagGroups.flatMap((group) =>
      group.tags.map((tag) => ({ group, tag, photos: getPhotosByTag(photos, group.slug, tag.slug) }))
    ),
    labelOf: (photo) => labels.get(getPhotoSlug(photo)) as string
  };
};

// ---------------------------------------------------------------------------------------------
// Photo page contexts: the gallery a photo page was opened from. The page's back link, its label,
// Previous/Next and the "i / n" position follow it (see PhotoDetailView).
// ---------------------------------------------------------------------------------------------

export type PhotoContext = {
  /** The gallery's photos in its order. */
  photos: readonly PhotoEntry[];
  /** URL of a photo inside this gallery (Previous/Next). */
  hrefFor: PhotoHref;
  /** URL of the gallery page; the back link adds `#photo-<slug>` to return to the photo. */
  galleryHref: string;
  /** Gallery name in "Back to <name>" / "返回<name>". */
  name: BilingualText;
  /** Unique label of any photo (PhotoLibrary.labelOf): Previous/Next names, titles. */
  labelOf: (photo: PhotoEntry) => string;
};

const landingSections = photographyProfile.landingCopy;

/** Name of the combined filter page, the gallery that shows every photo. */
const tagFilterName: BilingualText = { en: 'Photography Tags', zh: '摄影标签' };

/**
 * `/photography/<slug>/`: every photo in display order. Its gallery is the filter page, the only
 * page that renders every photo (so `#photo-<slug>` always exists there).
 */
export const getAllPhotosContext = ({ photos, labelOf }: PhotoLibrary): PhotoContext => ({
  photos,
  hrefFor: getPhotoHref,
  galleryHref: tagFilterHref,
  name: tagFilterName,
  labelOf
});

/** `/photography/selected/<slug>/`: Selected Works order, back to the landing page grid. */
export const getSelectedContext = ({ selectedPhotos, labelOf }: PhotoLibrary): PhotoContext => ({
  photos: selectedPhotos,
  hrefFor: getSelectedPhotoHref,
  galleryHref: '/photography/',
  name: { en: landingSections.en.sections.selectedWorks, zh: landingSections.zh.sections.selectedWorks },
  labelOf
});

export const getCategoryContext = ({ labelOf }: PhotoLibrary, { category, photos }: CategoryGallery): PhotoContext => ({
  photos,
  hrefFor: (photo) => getCategoryPhotoHref(category.slug, photo),
  galleryHref: getCategoryHref(category.slug),
  name: { en: category.label, zh: category.labelZh },
  labelOf
});

export const getProjectContext = ({ labelOf }: PhotoLibrary, { project, photos }: ProjectGallery): PhotoContext => ({
  photos,
  hrefFor: (photo) => getProjectPhotoHref(project.slug, photo),
  galleryHref: getProjectHref(project.slug),
  name: { en: project.title, zh: project.titleZh },
  labelOf
});

/** `/photography/tags/<group>/<tag>/<slug>/`: tag order; tag values have one label in both languages. */
export const getTagContext = ({ labelOf }: PhotoLibrary, { group, tag, photos }: TagGallery): PhotoContext => ({
  photos,
  hrefFor: (photo) => getTagPhotoHref(group.slug, tag.slug, photo),
  galleryHref: tag.href,
  name: { en: tag.label, zh: tag.label },
  labelOf
});

/**
 * Data embedded in each standalone photo page so that a client script can rebuild the context of the
 * combined filter page from `?from=tags&<filters>` (see PhotoDetailView and photographyTagFilter.ts).
 */
export const getTagFilterContextData = ({ photos, tagGroups, labelOf }: PhotoLibrary): TagContextData => ({
  groups: tagGroups.map((group) => group.slug),
  galleryHref: tagFilterHref,
  name: tagFilterName,
  photos: photos.map((photo) => ({
    slug: getPhotoSlug(photo),
    label: labelOf(photo),
    href: getPhotoHref(photo),
    tags: getPhotoSearchTags(photo)
  }))
});
