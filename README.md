# egoista0326.github.io

Public personal website for Jiaxin Li, including an academic homepage and photography section.

The site is an Astro static site deployed to GitHub Pages from source. GSD planning artifacts live outside this public repository in `/Users/lijiaxin/Documents/PersonalWeb`.

## Local Development

```bash
npm install
npm run dev
```

Build the production site before release:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Verification

Run the photo import verifier after adding or changing photography assets:

```bash
node scripts/verify_photo_import.mjs
```

Run release QA before publishing:

```bash
npm run qa:release
```

## Deployment

GitHub Pages deployment is handled by `.github/workflows/deploy.yml`. Pushes to `main` build the Astro site with GitHub Actions and publish the generated static output to `https://egoista0326.github.io/`.

Detailed release, CV, photo, and custom domain notes are in `docs/deployment.md`.

## Maintenance Docs

- `docs/photography-metadata.md` explains photo metadata, controlled tags, project entries, category covers, and the batch import pipeline.
- `docs/deployment.md` explains release checks, GitHub Pages troubleshooting, CV updates, and optional future custom domain setup.
