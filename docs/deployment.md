# Deployment and Maintenance

This repository publishes Jiaxin Li's public personal website at `https://egoista0326.github.io/`. The parent GSD planning workspace is local-only and is not part of this repository.

## GitHub Pages Deployment

Deployment uses GitHub Actions. The workflow is `.github/workflows/deploy.yml` and runs on pushes to `main` or manual `workflow_dispatch`.

The workflow builds from source with Astro and publishes the generated artifact to GitHub Pages. Do not commit `dist/` as the deployment artifact.

Useful status command:

```bash
gh api repos/egoista0326/egoista0326.github.io/pages
```

The expected Pages build type is `workflow`. If GitHub Pages is still set to legacy branch publishing, switch it to Actions publishing from repository settings or with:

```bash
gh api --method PUT repos/egoista0326/egoista0326.github.io/pages -f build_type=workflow
```

## Release Checklist

Run these commands from the repository root before pushing:

```bash
node scripts/verify_photo_import.mjs
npm run build
npm run qa:release
```

After pushing, check the latest deploy run:

```bash
gh run list --workflow deploy.yml --limit 1
gh run watch
```

Then verify the live site:

```bash
curl -I --max-time 20 https://egoista0326.github.io/
curl -I --max-time 20 https://egoista0326.github.io/cv/
curl -I --max-time 20 https://egoista0326.github.io/photography/
```

## Updating the CV

The public CV asset is:

```text
public/assets/cv/jiaxin-li-cv.pdf
```

Replace that file with the current PDF and run:

```bash
npm run build
npm run qa:release
```

The `/cv/` route links directly to that asset for open and download actions.

## Photo Maintenance

Photo records live in `src/content/photos/`. Public optimized images live in `public/assets/photography/works/`.

For a single photo update, edit the matching Markdown file and use controlled vocabulary values from `src/data/photographyVocab.ts`.

For batch import from the local export folder, use:

```bash
/Users/lijiaxin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/import_photos.py --replace --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json
node scripts/verify_photo_import.mjs
npm run build
```

The detailed photography guide is `docs/photography-metadata.md`.

Photography profile text, news, and project definitions live in `src/data/photography.ts`.

## Custom Domain

A custom domain is optional future work. The high-level flow is:

1. Buy a domain from a registrar.
2. Add the domain in GitHub repository settings under Pages.
3. Configure DNS at the registrar. For an apex domain, use GitHub Pages `A` and `AAAA` records. For a subdomain such as `www`, use a `CNAME` record pointing to `egoista0326.github.io`.
4. Add a repository `public/CNAME` file containing the custom domain if the site should keep using that domain in future builds.
5. Wait for DNS propagation, then enable HTTPS in GitHub Pages settings.

Keep `astro.config.mjs` `site` aligned with the final public URL if a custom domain is adopted.

## Troubleshooting

If the live page shows source files or an old placeholder, verify that Pages is using Actions rather than branch source publishing:

```bash
gh api repos/egoista0326/egoista0326.github.io/pages
```

If a workflow fails, inspect the latest run:

```bash
gh run list --workflow deploy.yml --limit 1
gh run view --log-failed
```

If photography routes fail, rerun:

```bash
node scripts/verify_photo_import.mjs
npm run build
```

If the CV preview does not render in a browser, the direct `Open PDF` and `Download PDF` links should still work.

## Last verified

2026-05-17: `https://egoista0326.github.io/` was deployed with GitHub Actions Pages publishing. Local verification used:

```bash
node scripts/verify_photo_import.mjs
npm run build
npm run qa:release
```

Remote verification checked the successful `deploy.yml` workflow run and HTTP 200 responses for `/`, `/cv/`, `/photography/`, `/photography/dsc-0046/`, and `/assets/cv/jiaxin-li-cv.pdf`.
