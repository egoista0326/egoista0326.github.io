# Photography Metadata Guide

The photography section stores one Markdown record per photograph in `src/content/photos/<slug>.md` and one web image per photograph in `public/assets/photography/works/<slug>.webp`. Everything else refers to photos by their `slug`.

## Where Each Thing Lives

| What | File | Notes |
| --- | --- | --- |
| Photo metadata | `src/content/photos/<slug>.md` | One file per photo; the file name must equal `slug`. |
| Photo image | `public/assets/photography/works/<slug>.webp` | Long edge at most 2400 px; `width`/`height` in the record must match it. |
| Work types and tag values | `src/data/photographyVocab.ts` | The only list of categories, locations, cameras, lenses and conditions, with their labels. |
| Selected Works | `photographySelectedWorkSlugs` in `src/data/photography.ts` | Order on the page is the order of this list. |
| Projects | `photographyProjects` in `src/data/photography.ts` | `photoSlugs` sets the project's photos and their order. |
| Category covers | `src/data/photographyCategoryCovers.ts` | One cover photo slug per category. |
| Import manifest | `scripts/photo-import-drafts.json` | Input of the importer: one entry per published photo. |
| Import report | `docs/photo-import-report.json` | Written by the importer: one entry per published photo, repo-relative paths only. |
| Width variants | `public/assets/photography/variants/<stem>-<width>.webp` | Written by the importer (see "Image Sizes"); the pages list them in `srcset`. |
| Photography code | `src/lib/photography.ts` (library, validation, labels, contexts, `srcset`), `src/lib/photographyPages.ts` (photo page paths), `src/lib/photographyTagFilter.ts` (tag matching), `src/lib/photographyPrefs.ts` (theme/language), `src/lib/photographySession.ts` (per-tab return state) | Client behaviour lives in `src/scripts/photography/`; styles in `src/components/photography/photography.css` and `tag-filter.css`. |

## Checks

- **Content schema** (`src/content.config.ts`, runs in `npm run build`): every controlled field must use a slug from `photographyVocab.ts`; `slug` is lowercase words joined by `-`; `image` must be `/assets/photography/works/<slug>.webp`; `orientation` must agree with `width`/`height`; `date` is a real calendar date `YYYY-MM-DD` or `""`; `year` is `YYYY` or `""` and, when both are set, equals the year of `date`; `alt` is required and may not be empty.
- **Cross-references** (`getPhotoLibrary` in `src/lib/photography.ts`, runs in `npm run build`): the build stops with a list of problems when Selected Works, a project or a category cover names a photo that does not exist, a cover photo is not in its category, a category has no cover, a slug differs from its file name, two files share a slug, a record's WebP file is missing, or a project's `startDate` is not `YYYY.M`. It also prints one warning listing the photos that still have `draftMetadata: true`.
- **Tests** (`package.json`): `npm test` (tag matching), `npm run test:dist` after a build (page count, links, anchors, headings, canonicals, image attributes, gallery ends), `npm run test:e2e` against a running preview (navigation, history, gallery ends and gallery back links, quiet view, keyboard focus, photo layout and image candidates, preferences and Chinese text, 404), and `PYTHON=<python with Pillow> npm run test:py` (importer).
- **Files** (`node scripts/verify_photo_import.mjs`):
  - every record has exactly one WebP file and every WebP file has a record; `width`/`height`/`orientation` match the real WebP size;
  - no works or variant WebP carries EXIF or XMP (VP8X flags), and no works file has a long edge over 2400 px;
  - every photo, and every image directly in `public/assets/photography/`, has exactly the width variants of "Image Sizes" with the right size, and every variant file belongs to such an image;
  - the manifest and report list exactly the photos in `src/content/photos/`, and every manifest value equals the record's value (`title`, `slug`, `category`, `categories`, `alt`, `location`, `camera`, `lens`, `condition`, `conditions`, `order`, `note`, `date`, `year`; a field the entry leaves out counts as empty, `title` as `"Untitled"`);
  - the report holds no absolute paths.

Run both before publishing:

```bash
node scripts/verify_photo_import.mjs && npm run build
```

## Add a Photo

1. Pick a slug: lowercase words joined by `-`, e.g. `tallinn-wires`. It becomes the URL `/photography/<slug>/`.
2. If the photo needs a new location, camera, lens, condition or work type, add it to `src/data/photographyVocab.ts` first (see "Add a Controlled Value").
3. Append an entry to `scripts/photo-import-drafts.json` whose `source` is the image's file name. `slug`, `category`, `order` and `alt` are required; also set `title` (`"Untitled"` if none), `categories`, `location`, `camera`, `lens`, `condition`, `conditions`, `date`, `year` and `note`. `draftMetadata` is optional and defaults to `true`; set it to `false` here once the values are reviewed.
4. Preview, then import (Pillow 9.1 or newer is required):

   ```bash
   python3 scripts/import_photos.py --add path/to/photo.jpg --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json --dry-run
   python3 scripts/import_photos.py --add path/to/photo.jpg --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json
   ```

   This writes the WebP file, its width variants (see "Image Sizes") and the Markdown record, and adds the photo to the report. Every file is first written into a temporary `.photo-import-staging-*` folder at the repository root and moved into place only after all named photos succeeded, so an error leaves the library unchanged. It never deletes anything, and it refuses a slug that already exists, a slug that is not lowercase letters and digits joined by `-`, and an excluded file name (see "Batch Import").
5. To feature the photo, add its slug to `photographySelectedWorkSlugs` and/or a project's `photoSlugs` in `src/data/photography.ts`.
6. Run `node scripts/verify_photo_import.mjs && npm run build`.

Without the importer: save the WebP yourself as `public/assets/photography/works/<slug>.webp` (no EXIF or XMP, long edge at most 2400 px), copy an existing record to `src/content/photos/<slug>.md`, change every field (at least `slug`, `image`, `width`, `height`, `orientation`, `alt`), add a manifest entry, write the variants with `python3 scripts/import_photos.py --backfill-variants --report docs/photo-import-report.json`, then run the checks. The build fails if the copied record still carries the old slug or image.

## Remove a Photo

1. Delete `src/content/photos/<slug>.md`, `public/assets/photography/works/<slug>.webp` and its variants `public/assets/photography/variants/<slug>-<width>.webp` (verify reports a variant left behind as an orphan).
2. Remove the photo's entry from `scripts/photo-import-drafts.json` and from `included` in `docs/photo-import-report.json`, and set the report's `included_count` to the new length.
3. Remove the slug from `photographySelectedWorkSlugs` and from every project's `photoSlugs` in `src/data/photography.ts`.
4. If the photo was a category cover in `src/data/photographyCategoryCovers.ts`, choose another photo of that category and update `photo` and `alt`.
5. Run `node scripts/verify_photo_import.mjs && npm run build`. Both list any reference you missed.

## Edit a Photo

Edit the record in `src/content/photos/`. Changing `slug` changes the photo's URLs, so rename the file and the WebP to the new slug and update every reference listed under "Remove a Photo". If the image changes, update `width`, `height` and `orientation` (the verify script reports a mismatch).

Copy edits that matter for a re-import into the manifest too: `--replace` rewrites records from the manifest and refuses to run while a record differs from it.

Use `order` to control display order: lower numbers come first, then newer `date`, then slug.

## Example Record

```md
---
title: "Rain on Glass"
slug: "dsc-0046"
category: "street"
categories: []
image: "/assets/photography/works/dsc-0046.webp"
alt: "Raindrops on a window blur warm city lights at night."
width: 1800
height: 2400
orientation: "portrait"
date: ""
year: ""
location: "paris"
camera: "nikon-zf"
lens: "24-120mm-zoom"
condition: "rain"
conditions: ["blue-hour"]
order: 510
note: ""
draftMetadata: true
language: "en"
---
```

## Field Notes

- `title`: `"Untitled"` (or empty) means no public title; the pages then omit the title line and never print "Untitled". Tab titles, history entries and the hidden heading of such a photo use a label built from its metadata: "Location, 25 Aug 2026" when `date` is set, otherwise "Category, Location"; when several photos share a label, " · DSC-0155" (from the slug) is added (`buildPhotoLabels` in `src/lib/photography.ts`).
- `alt` describes the photo for screen readers and is required.
- `category` is the primary work type; `categories` adds further work types. A photo appears in every category it lists.
- `condition` is the primary shooting condition; `conditions` adds further ones such as `night` or `blue-hour`. Leave an unknown controlled field as `""`.
- `note` is optional caption text, not a tag. A multi-line note can use a YAML block (`note: |-`).
- Selection is not a photo field: Selected Works is only `photographySelectedWorkSlugs` in `src/data/photography.ts`.
- `draftMetadata: true` marks importer-generated values that the owner has not reviewed yet; it is not shown on the site.
- `date` is shown only through the label of an untitled photo; `year` and `language` are stored but not shown.

## Selected Works, Projects and Covers

- Selected Works: edit `photographySelectedWorkSlugs` in `src/data/photography.ts`. Keep the `[ ... ] as const` list of single-quoted slugs; `scripts/qa_release.mjs` counts it with a regular expression.
- Projects: add or edit an entry of `photographyProjects` with `slug`, `title`, `titleZh`, `startDate`, `summary`, `summaryZh`, `description`, `descriptionZh` and `photoSlugs`. The project page is `/photography/projects/<slug>/`; Previous/Next on its photo pages follows `photoSlugs` and stops at the first and last photo.
- Category covers: each category in `src/data/photographyCategoryCovers.ts` names a cover `photo` (a photo of that category) with its card `alt` text (describing the image only; the card title already names the category) and optional `objectPosition`. The image file and size come from the photo's record; the card title is the category's label from `photographyVocab.ts`.

## Add a Controlled Value

All controlled values are in `src/data/photographyVocab.ts`, one list per kind, each entry `{ slug, label }` (categories also have `labelZh`). Add the entry to the right list; the schema accepts it at once. A new category also needs a cover in `src/data/photographyCategoryCovers.ts`, which must be a photo of that category, or the build fails. Tag pages exist only for values that at least one photo uses.

## Browsing Routes

- `/photography/`: landing page: intro, Selected Works, news, projects, the tag entry and category cards.
- `/photography/[photo]/`: the standalone page of every photo; Previous/Next through all photos in display order, back to the filter page `/photography/tags/` (the only page that shows every photo).
- `/photography/selected/[photo]/`: a Selected Work with Previous/Next in Selected Works order, back to the Selected Works grid of `/photography/`.
- `/photography/category/[category]/` and `/photography/category/[category]/[photo]/`: a category gallery and its photos, Previous/Next in display order.
- `/photography/projects/[project]/` and `/photography/projects/[project]/[photo]/`: a project and its photos, Previous/Next in `photoSlugs` order.
- `/photography/tags/`: combined filter by location, camera, lens and conditions (several locations/cameras/lenses match any; several conditions must all match). The checked filters live in the query (`?location=zurich&condition=rain`), so a link or reload restores them; each result opens `/photography/<slug>/?from=tags&<filters>`. Each option shows how many photos it would give with the current selection, options that would give none are disabled, and a sticky bar holds the live result count and "Clear filters". Without JavaScript the form submits as a GET form, but static hosting cannot filter, so the page says so and shows every photo.
- `/photography/tags/[group]/[tag]/`: a single-tag gallery for each used tag (its back link opens the filter page with that tag ticked); its photos open `/photography/tags/[group]/[tag]/[photo]/`, with Previous/Next in that tag's order.
- Any unknown path shows `src/pages/404.astro` (site header, links back; for `/photography/.../<photo>/` it offers the photo's standalone page). Under `/photography/` it also applies the stored theme and language before the first paint and shows its text in Chinese when 中文 is chosen; elsewhere it stays light and English.
- The back link at the top of a gallery page ("Back to Photography"; on a tag gallery "Back to Photography Tags") uses `history.back()` when the gallery was opened from the page it points to, so that page returns at its scroll position and one browser Back then leaves it; otherwise it is a plain link (`src/scripts/photography/galleryBack.ts`).

The photo routes are thin: each calls `photoPagePaths(<kind>)` (`src/lib/photographyPages.ts`) and renders `PhotoPage.astro`. Every copy of a photo page declares `/photography/<slug>/` as its canonical URL.

Every photo page belongs to the gallery it was opened from (`PhotoContext` in `src/lib/photography.ts`): the bar above the photo holds "Back to <gallery>", Previous/Next and the position "i / n" in that gallery (on phones: "← <gallery>" and arrow-only pager in one row). No gallery loops: Previous is disabled on the first photo and Next on the last (shown in place, without `href`), and the arrow keys and swipe do nothing there. A standalone page opened with `?from=tags&<filters>` follows the filtered results instead (`src/scripts/photography/photoPage.ts`, matching shared with the filter page in `src/lib/photographyTagFilter.ts`); without JavaScript or `from` it keeps its static context. Metadata values link to their category or tag gallery.

Photo page behaviour (with JavaScript; `src/scripts/photography/photoPage.ts`):

- Previous/Next, ArrowLeft/ArrowRight and a horizontal swipe on the photo replace the current history entry, so one browser Back leaves the photo for its gallery. The back link uses `history.back()` when the entry before is that gallery, otherwise it opens `<gallery>#photo-<slug>`.
- Previous/Next followed with Enter: the next photo page focuses its own Previous/Next link (the other one at a gallery end), so a keyboard reader can keep stepping without tabbing through the header.
- The gallery marks the tile of the photo seen last for a moment (and focuses it when the reader used the keyboard), scrolling it into view only when needed (`src/scripts/photography/photoGrid.ts`).
- After load, the neighbouring pages and photos are preloaded.
- F or a tap on the photo opens a quiet full view of the photo alone, fitted to the screen (less a 12 px margin; the photo's `sizes` is swapped for that size, `quietSizes` in `getPhotoPageImage`); Escape, F, another tap or the close button ends it and focus returns where it was. Meanwhile the rest of the page is inert, so Tab reaches only the close button. It stays on across Previous/Next.

Layout: photo pages use a wider frame; the photo is at most about 80-85% of the viewport height (H = max(320px, min(85svh, 100svh - 176px))). Square and portrait photos keep the metadata on the right from a 640 px wide frame. A landscape photo (ratio r = width / height) keeps it on the right only while the photo there is at least 90% as wide as with the metadata below, that is from a frame of 292px + 0.9 * r * H (292 px = the 260 px metadata column and its 32 px gap); PhotoPage writes this container query for each landscape photo (`getPhotoPageLayoutCss` in `src/lib/photography.ts`), so the layout is plain CSS at first paint; the photo's `sizes` uses the same H, including its 320 px floor. Metadata below the photo shows as a compact block (`photography.css`, "Photo pages"). For example, a 4:3 or 3:2 photo has its metadata below at 1024x768 and on the right at 1280x800, and a 3:2 photo has it below again at 1440x1000 (taller cap, wider photo); the nearly square `dsc-2723` (2400x2326) keeps it on the right at 1024x768, where the side column does not narrow it.

Theme and language: one inline script in `<head>` of every photography page (`earlyPreferenceScript` in `src/lib/photographyPrefs.ts`) sets `<html data-photography-theme data-photography-lang lang>` from localStorage before the first paint; the switches sit in the site header. Other pages of the site never get these attributes.

## Batch Import

Batch mode imports every top-level image of a source folder. It needs the folder that holds every published photo's original, named as in the manifest's `source` fields. The library was imported from the git-ignored `source_photos/average` on the owner's Mac, and the report lists every source there; the originals of `tallinn-wires`, `riga-seagulls` and `zurich-car-roof` (added on 2026-11-21) live elsewhere, so copy them into the folder first.

```bash
python3 scripts/import_photos.py --source source_photos/average --replace --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json --dry-run
python3 scripts/import_photos.py --source source_photos/average --replace --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json
```

- `--source` has no default, and `--replace` requires `--manifest`.
- The manifest must list exactly the images in the folder, or nothing is written.
- Each slug is the manifest's `slug` (else derived from the file name, `_DSC0152.jpg` -> `dsc-0152`) and must be lowercase letters and digits joined by `-`; a bad slug or two images with the same slug stop the run before anything is written.
- `--replace` refuses to run when a record differs from its manifest entry (a hand edit would be lost) and lists the differences; `--overwrite-edits` discards them.
- It writes every photo (WebP, variants, record) into a temporary `.photo-import-staging-*` folder at the repository root, moves them into place only after all of them succeeded, then deletes the records, WebP files and variants whose slug is no longer in the folder (and variants at widths no longer produced). A failure part-way, such as an unreadable image, leaves the library and the report as they were. Stale names are compared case-insensitively.
- `--dry-run` prints what would be written and deleted and writes nothing, not even the report.
- Excluded from import (in batch and add mode): dotfiles, subfolders, non-image files and file names containing `contact_sheet`, `bw_conversion_review` or `forphotographeronly` (case-insensitive; only the file name is checked, never the folder path).
- WebP derivatives keep an RGB ICC profile and drop EXIF (including GPS) and XMP; a CMYK image is converted to sRGB and does not carry its CMYK profile. `--max-long-edge` (default 2400) and `--quality` (default 88) set the derivative; `--verify-derivative-policy` first test-encodes the first photo and stops if the result breaks these rules.
- `draftMetadata` in each record comes from the manifest entry (`true` when the entry leaves it out).
- The report stores repository-relative paths (`source_photos/average/_DSC0155.jpg`, `public/assets/photography/works/dsc-0155.webp`); a source outside the repository is stored by its file name only.
- The importer's tests run on temporary folders only: `python3 -m unittest discover -s tests/py`.
- Exit codes: `0` done, `1` refused with nothing written (listed problems, hand edits), `2` error with a one-line message and nothing written (bad slug, slug collision, manifest/source mismatch, unreadable image).

## Image Sizes

- `works/<slug>.webp` is the largest image of each photo: long edge at most 2400 px, WebP quality 88.
- `public/assets/photography/variants/<stem>-<width>.webp` holds smaller copies for `srcset`: one per width of `VARIANT_WIDTHS` in `scripts/import_photos.py` (now 640 and 1200) that is smaller than the image's own width. The height is proportional (rounded); WebP quality 82, the same ICC profile, no EXIF or XMP. A width at or above the image's width is skipped: `nursing-home-chair` (1156 px wide) and `rednote-card.jpg` (879 px) have only a 640 variant.
- The importer writes the variants with every photo and records the widths in the report (`settings.variant_widths`, `variant_dir`, `variant_quality`); `verify_photo_import.mjs` checks the files against those widths.
- The two non-photo images directly in `public/assets/photography/` (the hero `profile-shadow-2649.webp` and `rednote-card.jpg`) get variants the same way; verify expects variants for every image in that folder.
- Backfill writes missing or wrongly sized variants from the existing files and never rewrites them:

  ```bash
  python3 scripts/import_photos.py --backfill-variants --report docs/photo-import-report.json
  python3 scripts/import_photos.py --backfill-variants public/assets/photography/profile-shadow-2649.webp public/assets/photography/rednote-card.jpg --report docs/photo-import-report.json
  ```

  Without paths it covers every `works/*.webp`; with paths, only those images (which must be in `public/assets/photography/` or `works/`). `--dry-run` prints the plan. A variant of the right size is kept, so after replacing an image by hand with one of the same size, delete its variants first. To change the widths, edit `VARIANT_WIDTHS`, delete the variant folder and run both backfill commands; the pages read the variants from disk at build time (`getImageSrcset` in `src/lib/photography.ts`).

## Gallery Layout

Photo grids use Masonry.js with a CSS grid fallback, so mixed portrait and landscape photographs flow naturally in 1/2/3 columns. Every image has `width`/`height` and a `srcset` of its variants with `sizes` matching its layout; the first row of a gallery loads eagerly, and the page's main image (the landing hero, the first gallery tile, the photo of a photo page) gets `fetchpriority="high"`.
