# Photography Metadata Guide

The photography section stores photo records as one Markdown file per image. Keep image files in the public photography asset folder, then add or update metadata in `src/content/photos/`.

## Add a Photo

1. Add the image file under `public/assets/photography/works/`.
2. Create a Markdown file in `src/content/photos/`, for example `zurich-rain-window.md`.
3. Fill in the frontmatter using the controlled values from `src/data/photographyVocab.ts`.
4. Run `npm run build` from the site root before publishing.

```md
---
title: Untitled
slug: zurich-rain-window
category: street
image: /assets/photography/works/zurich-rain-window.jpg
alt: Rain-specked window glass with warm lights beyond it.
width: 1600
height: 1067
orientation: landscape
date: "2026-05-17"
year: "2026"
location: zurich
camera: nikon-zf
lens: 40mm-prime
weather: rainy-night
featured: true
order: 10
note: A short personal sentence about the photograph.
language: en
---
```

Use `title: Untitled` when a photo has no title.

## Edit a Photo

Edit the matching Markdown file in `src/content/photos/`. The filename can stay stable even if the public title changes; the `slug` controls the future public photo URL.

Update `width`, `height`, and `orientation` whenever the image file changes. The browsing pages use these fields to preserve natural proportions and avoid layout shifts. Use `order` to control the display order; lower numbers appear earlier, with date and slug used as tie-breakers.

## Browsing Routes

- `/photography/` is the standalone photography landing page with category entries, selected works, and a tag entry.
- `/photography/projects/[project]/` shows one photography project with its description, start date, and selected project photographs.
- `/photography/category/[category]/` shows a gallery for one work type such as `still-life`, `landscape`, or `street`.
- `/photography/tags/` lists the controlled browsing tags, with locations first.
- `/photography/tags/[group]/[slug]/` shows a gallery for one controlled tag value.
- `/photography/[slug]/` is the independent URL for a single photograph.

## Photography Intro, News, and Projects

Photography-side profile text, news items, and project definitions live in `src/data/photography.ts`. Keep this data separate from the academic homepage so photography visitors can understand the photo section without switching sections.

To add or edit a photography project:

1. Open `src/data/photography.ts`.
2. Update the `photographyProjects` list with `slug`, `title`, `startDate`, `summary`, `description`, and `photoSlugs`.
3. Make sure each value in `photoSlugs` matches a photo `slug` from `src/content/photos/`.
4. Run `npm run build`.

The project URL is generated from `slug`, for example `slug: urban-isolation` becomes `/photography/projects/urban-isolation/`.

## Gallery Layout

Photo grids use a CSS multi-column masonry pattern. This keeps mixed portrait and landscape photographs flowing naturally without forcing every row to share the same top edge. The item wrapper uses `break-inside: avoid` so the image and caption stay together.

## Category Covers

The category cards on `/photography/` use fixed-ratio cover windows defined in `src/data/photographyCategoryCovers.ts`. These images are independent from photo metadata and can be replaced later with dedicated category-cover files.

To update a category cover:

1. Add the cover image under `public/assets/photography/works/` or a future dedicated cover folder.
2. Open `src/data/photographyCategoryCovers.ts`.
3. Update the matching category entry with `image`, `alt`, `width`, `height`, and optional `objectPosition`.
4. Run `npm run build`.

## Title Display Rule

`title: Untitled` is allowed in metadata so unfinished records remain explicit, but the public photography pages must not render the literal title. If a photo has no real title, the title line is omitted and the page continues with category, location, camera, lens, weather, and optional note.

## Phase 4 Development Samples

The current Phase 4 files under `public/assets/photography/works/` are a small development sample set used to shape category, tag, grid, and detail-page layouts. They are not the full selected archive.

The full import, final image optimization, EXIF/privacy cleanup, and broader metadata pass remain Phase 5 work. When the final selected set is ready, replace or expand these samples through the same image-plus-Markdown workflow and rerun `npm run build`.

## Add a New Controlled Value

Tag values are intentionally centralized. To add a new location, camera, lens, weather, or work type:

1. Open `src/data/photographyVocab.ts`.
2. Add the new slug to the relevant slug list.
3. Add the matching label to the corresponding exported vocabulary list.
4. Use that slug in photo metadata.

Do not invent new values inside individual Markdown files without first updating `src/data/photographyVocab.ts`.

## Field Notes

`category` is required and should be one of the controlled work types. The other controlled fields may be left blank with `""` when unknown or not ready.

`note is optional and is not a tag`. Use it for one short caption-like sentence, not for filtering.

Route behavior is generated from metadata. Changing `slug`, `category`, or a controlled tag changes the generated browsing paths after the next build.
