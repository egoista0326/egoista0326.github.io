# Photography Metadata Guide

The photography section stores photo records as one Markdown file per image. Keep image files in the public photography asset folder, then add or update metadata in `src/content/photos/`.

## Add a Photo

1. Add the image file under `public/assets/photography/`.
2. Create a Markdown file in `src/content/photos/`, for example `zurich-rain-window.md`.
3. Fill in the frontmatter using the controlled values from `src/data/photographyVocab.ts`.
4. Run `npm run build` from the site root before publishing.

```md
---
title: Untitled
slug: zurich-rain-window
category: street
image: /assets/photography/zurich-rain-window.jpg
date: 2026-05-17
year: "2026"
location: zurich
camera: nikon-zf
lens: 40mm-prime
weather: rainy-night
featured: true
note: A short personal sentence about the photograph.
language: en
---
```

Use `title: Untitled` when a photo has no title. The public photography pages should hide the literal title `Untitled` instead of displaying it.

## Edit a Photo

Edit the matching Markdown file in `src/content/photos/`. The filename can stay stable even if the public title changes; the `slug` controls the future public photo URL.

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
