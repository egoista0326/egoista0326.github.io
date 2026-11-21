import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import {
  cameraSlugs,
  categorySlugs,
  conditionSlugs,
  lensSlugs,
  locationSlugs
} from './data/photographyVocab';

/**
 * One Markdown file per photograph, `src/content/photos/<slug>.md`; the field guide is
 * `docs/photography-metadata.md`. Controlled fields accept only the slugs of
 * `src/data/photographyVocab.ts`; an optional controlled field may be `""` (unset).
 * Per-file checks here: vocabulary slugs, slug and image path, orientation vs size, a real calendar
 * `date` whose year matches `year`, a non-empty `alt`.
 * Cross-file checks (file name, image file, Selected Works, projects, covers) run in
 * `getPhotoLibrary` in `src/lib/photography.ts`.
 */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True for a real calendar date `YYYY-MM-DD` (rejects e.g. 2025-02-30). */
const isCalendarDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
// `""` first so an error lists it among the allowed values.
const optionalLocation = z.enum(['', ...locationSlugs]).default('');
const optionalCamera = z.enum(['', ...cameraSlugs]).default('');
const optionalLens = z.enum(['', ...lensSlugs]).default('');
const optionalCondition = z.enum(['', ...conditionSlugs]).default('');

const photos = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/photos' }),
  schema: z
    .object({
      /** `"Untitled"` (or empty) means the photo has no public title. */
      title: z.string().default('Untitled'),
      /** Public URL segment and entry id; must equal the file name. */
      slug: z.string().regex(slugPattern, 'slug must be lowercase words joined by "-", e.g. "dsc-0046"'),
      /** Primary work type; `categories` adds further work types. */
      category: z.enum(categorySlugs),
      categories: z.array(z.enum(categorySlugs)).default([]),
      /** Web derivative, always `/assets/photography/works/<slug>.webp` under `public/`. */
      image: z.string(),
      /** Describes the photo for screen readers; required and never empty. */
      alt: z.string().trim().min(1, 'alt must describe the photo (it may not be empty)'),
      /** Pixel size of the WebP file; `orientation` must agree with it. */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      orientation: z.enum(['landscape', 'portrait', 'square']),
      /** Capture date `YYYY-MM-DD` or `""`; newer dates sort first among equal `order`. */
      date: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/, 'date must be "YYYY-MM-DD" or ""').default(''),
      year: z.string().regex(/^(?:\d{4})?$/, 'year must be "YYYY" or ""').default(''),
      location: optionalLocation,
      camera: optionalCamera,
      lens: optionalLens,
      /** Primary shooting condition; `conditions` adds further ones. */
      condition: optionalCondition,
      conditions: z.array(z.enum(conditionSlugs)).default([]),
      /** Display order; lower numbers first. */
      order: z.number().int().default(0),
      note: z.string().default(''),
      /** `true` until the owner has reviewed importer-generated values. Not shown on the site. */
      draftMetadata: z.boolean().default(false),
      language: z.enum(['en', 'zh']).default('en')
    })
    .superRefine((photo, context) => {
      if (photo.date !== '' && !isCalendarDate(photo.date)) {
        context.addIssue({ code: 'custom', path: ['date'], message: `date "${photo.date}" is not a real calendar date` });
      }

      if (photo.date !== '' && photo.year !== '' && photo.year !== photo.date.slice(0, 4)) {
        context.addIssue({
          code: 'custom',
          path: ['year'],
          message: `year "${photo.year}" must match the year of date "${photo.date}"`
        });
      }

      const expectedImage = `/assets/photography/works/${photo.slug}.webp`;

      if (photo.image !== expectedImage) {
        context.addIssue({
          code: 'custom',
          path: ['image'],
          message: `image must be "${expectedImage}" (derived from slug), found "${photo.image}"`
        });
      }

      const expectedOrientation =
        photo.width === photo.height ? 'square' : photo.height > photo.width ? 'portrait' : 'landscape';

      if (photo.orientation !== expectedOrientation) {
        context.addIssue({
          code: 'custom',
          path: ['orientation'],
          message: `orientation must be "${expectedOrientation}" for ${photo.width}x${photo.height}, found "${photo.orientation}"`
        });
      }
    })
});

export const collections = { photos };
