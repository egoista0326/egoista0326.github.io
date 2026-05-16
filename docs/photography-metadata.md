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

Use `title: Untitled` when a photo has no title. The public photography pages should hide the literal title `Untitled` instead of displaying it.

## Edit a Photo

Edit the matching Markdown file in `src/content/photos/`. The filename can stay stable even if the public title changes; the `slug` controls the future public photo URL.

Update `width`, `height`, and `orientation` whenever the image file changes. The browsing pages use these fields to preserve natural proportions and avoid layout shifts. Use `order` to control the display order; lower numbers appear earlier, with date and slug used as tie-breakers.

## Development Samples

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

`title: Untitled` is allowed in metadata, but public pages should omit that title instead of showing it.
