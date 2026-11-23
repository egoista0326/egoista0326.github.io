// Checks of the built site in dist/ against the photo records (no browser).
// Run after `npm run build`: npm run test:dist   (node --test tests/dist/*.test.mjs)
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dist = join(root, 'dist');
const read = (path) => readFileSync(join(root, path), 'utf8');

// ---------------------------------------------------------------------------------------------
// Source data: photo records, Selected Works, projects, categories, site URL
// ---------------------------------------------------------------------------------------------

/** Frontmatter of an importer-written record: one JSON scalar or array per line; `|-` blocks skipped. */
const parseFrontmatter = (text) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(block, 'record has a frontmatter block');
  const data = {};
  for (const line of block[1].split(/\r?\n/)) {
    const match = /^([A-Za-z][\w]*):\s*(.*)$/.exec(line);
    if (!match) continue; // continuation line of a block scalar
    const [, key, value] = match;
    if (/^[|>][+-]?$/.test(value.trim())) continue; // block scalar (note: |-)
    try {
      data[key] = JSON.parse(value);
    } catch {
      data[key] = value.trim();
    }
  }
  return data;
};

const photosDir = join(root, 'src/content/photos');
const photos = readdirSync(photosDir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => parseFrontmatter(readFileSync(join(photosDir, file), 'utf8')));

const photographyData = read('src/data/photography.ts');
const quotedStrings = (text) => Array.from(text.matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);

const selectedBlock = /photographySelectedWorkSlugs\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(photographyData);
assert.ok(selectedBlock, 'photographySelectedWorkSlugs found in src/data/photography.ts');
const selectedSlugs = quotedStrings(selectedBlock[1]);

const projectsBlock = /photographyProjects\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(photographyData);
assert.ok(projectsBlock, 'photographyProjects found in src/data/photography.ts');
const projects = Array.from(projectsBlock[1].matchAll(/slug:\s*'([^']+)'[\s\S]*?photoSlugs:\s*\[([^\]]*)\]/g), (match) => ({
  slug: match[1],
  photoSlugs: quotedStrings(match[2])
}));

const vocab = read('src/data/photographyVocab.ts');
const categoriesBlock = /photographyCategories\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(vocab);
assert.ok(categoriesBlock, 'photographyCategories found in src/data/photographyVocab.ts');
const vocabularyCategories = Array.from(categoriesBlock[1].matchAll(/slug:\s*'([^']+)'/g), (match) => match[1]);

const siteUrl = (/site:\s*['"]([^'"]+)['"]/.exec(read('astro.config.mjs'))?.[1] ?? '').replace(/\/$/, '');

const unique = (values) => [...new Set(values.filter((value) => value !== '' && value !== undefined))];
const categoriesOf = (photo) => unique([photo.category, ...(photo.categories ?? [])]);
/** Tag values per group; location, camera and lens hold 0 or 1 value, condition the union. */
const tagsOf = (photo) => ({
  location: unique([photo.location]),
  camera: unique([photo.camera]),
  lens: unique([photo.lens]),
  condition: unique([photo.condition, ...(photo.conditions ?? [])])
});

// ---------------------------------------------------------------------------------------------
// dist/
// ---------------------------------------------------------------------------------------------

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );

const htmlFiles = walk(dist).filter((file) => file.endsWith('.html'));
const html = new Map(htmlFiles.map((file) => [file, readFileSync(file, 'utf8')]));
/** `dist/a/b/index.html` -> `/a/b/`, `dist/404.html` -> `/404.html`. */
const urlPathOf = (file) => `/${relative(dist, file).split(sep).join('/')}`.replace(/(^|\/)index\.html$/, '$1');
const isPhotographyPage = (file) => urlPathOf(file).startsWith('/photography/');
const photoPages = htmlFiles.filter((file) => isPhotographyPage(file) && /\sdata-photo-view[\s>]/.test(html.get(file)));

/** Markup without the bodies of <script> and <style> (JSON data, CSS), so only real attributes are scanned. */
const markupOf = (file) =>
  html.get(file).replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, '$1$3');

const decodeEntities = (value) =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Values of attribute `name` on every tag of `markup`. */
const attributeValues = (markup, name) =>
  Array.from(markup.matchAll(new RegExp(`<[a-z][^>]*?\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'gi')), (match) =>
    decodeEntities(match[1] ?? match[2])
  );

/** Every tag `<tagName ...>` of `markup`, as its opening-tag text. */
const tagsNamed = (markup, tagName) => Array.from(markup.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')), (m) => m[0]);
const attributeOf = (tag, name) => {
  const match = new RegExp(`\\s${name}(?:=(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=[\\s>/])`, 'i').exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : undefined;
};
const srcsetUrls = (srcset) =>
  srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);

/** Paths on this domain that other repositories' GitHub Pages serve (project sites), not this build: the DexGO
    project page (egoista0326/dexgo). Links to them are checked there. */
const otherSites = ['/dexgo/'];

/**
 * The dist file an internal URL reaches (query and hash stripped), or null for external and
 * non-file URLs. URLs on the site's own origin count as internal.
 */
const resolveInternal = (url, fromFile) => {
  if (url === '' || url.startsWith('#') || /^(mailto|tel|javascript|data|blob):/i.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url, `${siteUrl}${urlPathOf(fromFile)}`);
  } catch {
    return { path: url, file: null };
  }
  if (parsed.origin !== new URL(siteUrl).origin) return null;
  if (otherSites.some((prefix) => `${parsed.pathname}/`.startsWith(prefix))) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:|^\/\//i.test(url);
  let path;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return { path: parsed.pathname, file: null };
  }
  const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}/index.html`, `${path}.html`];
  const file = candidates.map((candidate) => join(dist, candidate)).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return { path: parsed.pathname, hash: parsed.hash, file: file ?? null, absolute };
};

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test('dist/ is built and dist/404.html exists', () => {
  assert.ok(htmlFiles.length > 0, 'dist/ holds HTML pages (run npm run build first)');
  assert.ok(existsSync(join(dist, '404.html')), 'dist/404.html exists');
});

test('photo page count equals N + S + Σcategories + P + Σtags', () => {
  const N = photos.length;
  const S = selectedSlugs.length;
  const categoryPages = photos.reduce((sum, photo) => sum + categoriesOf(photo).length, 0);
  const P = projects.reduce((sum, project) => sum + project.photoSlugs.length, 0);
  const tagPages = photos.reduce((sum, photo) => sum + Object.values(tagsOf(photo)).flat().length, 0);
  const expectedCount = N + S + categoryPages + P + tagPages;

  // The same formula, path by path, so a mismatch names the pages.
  const expected = new Set([
    ...photos.map((photo) => `/photography/${photo.slug}/`),
    ...selectedSlugs.map((slug) => `/photography/selected/${slug}/`),
    ...photos.flatMap((photo) => categoriesOf(photo).map((category) => `/photography/category/${category}/${photo.slug}/`)),
    ...projects.flatMap((project) => project.photoSlugs.map((slug) => `/photography/projects/${project.slug}/${slug}/`)),
    ...photos.flatMap((photo) =>
      Object.entries(tagsOf(photo)).flatMap(([group, values]) => values.map((value) => `/photography/tags/${group}/${value}/${photo.slug}/`))
    )
  ]);
  const actual = new Set(photoPages.map(urlPathOf));

  assert.ok(N > 0 && S > 0 && P > 0, `records found (N=${N}, S=${S}, P=${P})`);
  assert.deepEqual([...actual].filter((path) => !expected.has(path)), [], 'no photo page outside the formula');
  assert.deepEqual([...expected].filter((path) => !actual.has(path)), [], 'every photo page of the formula is built');
  assert.equal(
    photoPages.length,
    expectedCount,
    `N=${N} + S=${S} + Σcategories=${categoryPages} + P=${P} + Σtags=${tagPages}`
  );
});

test('a gallery page exists for every category, project and used tag', () => {
  const galleries = [
    ...vocabularyCategories.map((category) => `photography/category/${category}/index.html`),
    ...projects.map((project) => `photography/projects/${project.slug}/index.html`),
    ...unique(photos.flatMap((photo) => Object.entries(tagsOf(photo)).flatMap(([group, values]) => values.map((value) => `${group}/${value}`)))).map(
      (tag) => `photography/tags/${tag}/index.html`
    )
  ];
  assert.ok(vocabularyCategories.length > 0, 'categories found in the vocabulary');
  assert.deepEqual(galleries.filter((gallery) => !existsSync(join(dist, gallery))), []);
});

/** Unresolved URLs of every page: root-relative/relative ones, or absolute ones on the site's origin. */
const brokenUrls = ({ absolute }) => {
  const broken = [];
  for (const file of htmlFiles) {
    const markup = markupOf(file);
    const urls = absolute
      ? [...attributeValues(markup, 'href'), ...attributeValues(markup, 'content')]
      : [
          ...attributeValues(markup, 'href'),
          ...attributeValues(markup, 'src'),
          ...attributeValues(markup, 'poster'),
          ...['srcset', 'data-photo-image-srcset'].flatMap((name) => attributeValues(markup, name).flatMap(srcsetUrls))
        ];
    for (const url of new Set(urls)) {
      if (absolute && !url.startsWith(`${siteUrl}/`)) continue;
      const target = resolveInternal(url, file);
      if (target && target.absolute === absolute && !target.file) broken.push(`${urlPathOf(file)}: ${url}`);
    }
  }
  return broken;
};

test('every internal href, src and srcset URL resolves to a file in dist/', () => {
  assert.deepEqual(brokenUrls({ absolute: false }), []);
});

test('absolute URLs on the site origin (canonical, og:url, og:image) resolve to a file in dist/', () => {
  assert.deepEqual(brokenUrls({ absolute: true }), []);
});

test('every <path>#photo-<slug> link points at a page containing id="photo-<slug>"', () => {
  const broken = [];
  let checked = 0;
  for (const file of htmlFiles) {
    for (const url of new Set(attributeValues(markupOf(file), 'href'))) {
      if (!/#photo-/.test(url)) continue;
      const target = url.startsWith('#') ? { file, hash: url } : resolveInternal(url, file);
      if (!target) continue;
      const id = decodeURIComponent(target.hash.slice(1));
      checked += 1;
      if (!target.file || !html.get(target.file)?.includes(`id="${id}"`)) broken.push(`${urlPathOf(file)}: ${url}`);
    }
  }
  assert.ok(checked > 0, 'some #photo-<slug> links exist');
  assert.deepEqual(broken, []);
});

test('exactly one <h1> on every photography page and on 404.html', () => {
  const pages = htmlFiles.filter((file) => isPhotographyPage(file) || urlPathOf(file) === '/404.html');
  const wrong = pages
    .map((file) => [urlPathOf(file), (markupOf(file).match(/<h1[\s>]/gi) ?? []).length])
    .filter(([, count]) => count !== 1);
  assert.deepEqual(wrong, []);
});

test('every photo page declares /photography/<slug>/ as its canonical URL', () => {
  const wrong = [];
  for (const file of photoPages) {
    const markup = html.get(file);
    const slug = /data-photo-slug="([^"]+)"/.exec(markup)?.[1];
    const canonical = tagsNamed(markup, 'link')
      .filter((tag) => attributeOf(tag, 'rel') === 'canonical')
      .map((tag) => attributeOf(tag, 'href'));
    const expected = `${siteUrl}/photography/${slug}/`;
    if (!slug || canonical.length !== 1 || canonical[0] !== expected) {
      wrong.push(`${urlPathOf(file)}: ${canonical.join(' ') || '(none)'} (expected ${expected})`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('standalone photo pages have distinct titles and no page shows "Untitled"', () => {
  const standalone = photoPages.filter((file) => /^\/photography\/[^/]+\/$/.test(urlPathOf(file)));
  assert.equal(standalone.length, photos.length, 'one standalone page per photo');
  const titles = standalone.map((file) => decodeEntities(/<title>([^<]*)<\/title>/.exec(html.get(file))?.[1] ?? ''));
  const repeated = titles.filter((title, index) => title === '' || titles.indexOf(title) !== index);
  assert.deepEqual(repeated, [], 'titles are non-empty and pairwise distinct');
  assert.deepEqual(
    htmlFiles.filter((file) => html.get(file).includes('>Untitled<')).map(urlPathOf),
    [],
    'no page contains >Untitled<'
  );
});

test('photo page titles tell same-label photos apart without a raw URL slug', () => {
  const raw = photoPages
    .map((file) => [urlPathOf(file), decodeEntities(/<title>([^<]*)<\/title>/.exec(html.get(file))?.[1] ?? '')])
    .filter(([, title]) => /·\s+[a-z0-9]+(?:-[a-z0-9]+)+(?:\s|$)/.test(title));
  assert.deepEqual(raw, []);
});

test('photography images have a size, photos a variant srcset, pages at most one high-priority image', () => {
  const widthByImage = new Map(photos.map((photo) => [photo.image, Number(photo.width)]));
  // The importer's widths (scripts/import_photos.py VARIANT_WIDTHS, recorded in the report): a photo's srcset lists
  // each one below its own width, then the file itself.
  const variantWidths = JSON.parse(read('docs/photo-import-report.json')).settings.variant_widths;
  const problems = [];
  for (const file of htmlFiles) {
    const images = tagsNamed(markupOf(file), 'img');
    const page = urlPathOf(file);
    const highPriority = images.filter((tag) => attributeOf(tag, 'fetchpriority') === 'high').length;
    if (highPriority > 1) problems.push(`${page}: ${highPriority} images with fetchpriority="high"`);
    if (!isPhotographyPage(file)) continue;

    for (const tag of images) {
      const src = attributeOf(tag, 'src') ?? '';
      if (!attributeOf(tag, 'width') || !attributeOf(tag, 'height')) problems.push(`${page}: <img src="${src}"> without width/height`);
      if (!src.startsWith('/assets/photography/works/')) continue;
      const width = widthByImage.get(src) ?? Number(attributeOf(tag, 'width'));
      const hasVariant = srcsetUrls(attributeOf(tag, 'srcset') ?? '').some((url) => url.startsWith('/assets/photography/variants/'));
      if (width >= 640 && !hasVariant) problems.push(`${page}: ${src} (${width}px) has no /assets/photography/variants/ candidate`);
      const stem = src.slice(src.lastIndexOf('/') + 1).replace(/\.webp$/, '');
      const expected = [
        ...variantWidths.filter((variantWidth) => variantWidth < width).map((variantWidth) => `/assets/photography/variants/${stem}-${variantWidth}.webp ${variantWidth}w`),
        `${src} ${width}w`
      ];
      const candidates = (attributeOf(tag, 'srcset') ?? '').split(',').map((candidate) => candidate.trim().split(/\s+/).join(' '));
      if (candidates.join(', ') !== expected.join(', ')) problems.push(`${page}: ${src} srcset is "${candidates.join(', ')}", expected "${expected.join(', ')}"`);
      for (const url of srcsetUrls(attributeOf(tag, 'srcset') ?? '')) {
        if (!existsSync(join(dist, url))) problems.push(`${page}: srcset candidate ${url} is not in dist/`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('no gallery loops: Previous is disabled on its first photo, Next on its last, Next walks every photo once', () => {
  // The copies of a photo page in one gallery share their URL up to the photo slug.
  const galleries = new Map();
  for (const file of photoPages) {
    const path = urlPathOf(file);
    const pager = Object.fromEntries(
      tagsNamed(markupOf(file), 'a')
        .filter((tag) => attributeOf(tag, 'data-photo-pager'))
        .map((tag) => [attributeOf(tag, 'data-photo-pager'), tag])
    );
    const gallery = path.replace(/[^/]+\/$/, '');
    if (!galleries.has(gallery)) galleries.set(gallery, new Map());
    galleries.get(gallery).set(path, {
      previous: attributeOf(pager.previous ?? '', 'href') ?? null,
      next: attributeOf(pager.next ?? '', 'href') ?? null,
      disabledMarked: ['previous', 'next'].every(
        (side) => pager[side] && (attributeOf(pager[side], 'href') !== undefined || attributeOf(pager[side], 'aria-disabled') === 'true')
      )
    });
  }

  const problems = [];
  const ends = new Map();
  for (const [gallery, pages] of galleries) {
    const firsts = [...pages].filter(([, links]) => links.previous === null).map(([path]) => path);
    const lasts = [...pages].filter(([, links]) => links.next === null).map(([path]) => path);
    if (firsts.length !== 1 || lasts.length !== 1) {
      problems.push(`${gallery}: ${firsts.length} pages without Previous, ${lasts.length} without Next (expected 1 and 1)`);
      continue;
    }
    ends.set(gallery, { first: firsts[0], last: lasts[0] });
    for (const [path, links] of pages) {
      if (!links.disabledMarked) problems.push(`${path}: a pager link without href lacks aria-disabled="true"`);
    }
    const seen = [firsts[0]];
    for (let path = firsts[0]; pages.get(path)?.next; ) {
      const next = pages.get(path).next;
      if (pages.get(next)?.previous !== path) problems.push(`${gallery}: Previous of ${next} is not ${path}`);
      if (seen.includes(next)) {
        problems.push(`${gallery}: Next returns to ${next}`);
        break;
      }
      seen.push(next);
      path = next;
    }
    if (seen.length !== pages.size || seen.at(-1) !== lasts[0]) {
      problems.push(`${gallery}: Next from the first photo reaches ${seen.length} of ${pages.size} photos, ending at ${seen.at(-1)}`);
    }
  }
  assert.deepEqual(problems, []);

  // Projects and Selected Works: the ends are the first and last photo of their source order.
  const ordered = [
    ['/photography/selected/', selectedSlugs],
    ...projects.map((project) => [`/photography/projects/${project.slug}/`, project.photoSlugs])
  ];
  for (const [gallery, slugs] of ordered) {
    assert.deepEqual(
      ends.get(gallery),
      { first: `${gallery}${slugs[0]}/`, last: `${gallery}${slugs.at(-1)}/` },
      `${gallery}: Previous disabled on the first photo, Next on the last`
    );
  }
});

test('homepage intro: the bio follows the name (no role line) and reads as site.ts bio, soft hyphens aside', () => {
  const markup = markupOf(join(dist, 'index.html'));
  const copy = /<div class="academic-intro-copy"[^>]*>([\s\S]*?)<\/div>/.exec(markup)?.[1];
  assert.ok(copy, 'dist/index.html has the intro copy');
  // The name's heading is followed directly by the bio paragraph.
  assert.match(copy, /<\/h1>\s*<p class="academic-bio">/, 'the bio follows the name');
  assert.equal(tagsNamed(copy, 'p').length, 1, 'the bio is the only paragraph of the intro');

  const bio = /bio:\s*'([^']+)'/.exec(read('src/data/site.ts'))?.[1];
  const rendered = decodeEntities(/<p class="academic-bio">([\s\S]*?)<\/p>/.exec(copy)?.[1] ?? '');
  assert.ok(bio, 'site.ts has a bio');
  assert.equal(rendered.replaceAll('­', ''), bio);
  // Soft hyphens sit only inside words (never next to a space or punctuation).
  assert.doesNotMatch(rendered, /­(?![a-z])|(?<![A-Za-z])­/, 'soft hyphens only between letters');

  const description = /description:\s*'([^']+)'/.exec(read('src/data/site.ts'))?.[1];
  assert.equal(attributeOf(tagsNamed(markup, 'meta').find((tag) => attributeOf(tag, 'name') === 'description'), 'content'), description);
});

test('homepage project card: a looping clip, the author line of dexgoCard.ts, links without a target marked "soon"', () => {
  const card = /<article class="project-card"[^>]*>([\s\S]*?)<\/article>/.exec(markupOf(join(dist, 'index.html')))?.[1];
  assert.ok(card, 'dist/index.html has a project card');

  // The clip plays through clipPlayback.ts (a play unit) and shows its poster until then.
  const [video] = tagsNamed(card, 'video');
  assert.ok(video, 'the card has a video');
  for (const name of ['src', 'poster', 'muted', 'loop', 'playsinline']) {
    assert.notEqual(attributeOf(video, name), undefined, `the clip has ${name}`);
  }
  assert.ok(tagsNamed(card, 'a').some((tag) => attributeOf(tag, 'data-play-unit') !== undefined), 'the clip is in a play unit');

  // Authors as on the DexGO page, in order, `*` after the co-first authors; the site owner bold and not a link.
  const authors = Array.from(
    read('src/data/dexgoCard.ts').matchAll(/\{\s*name:\s*'([^']+)',\s*href:\s*'[^']*',\s*equal:\s*(true|false)\s*\}/g),
    ([, name, equal]) => `${name}${equal === 'true' ? '*' : ''}`
  );
  const owner = /name:\s*'([^']+)'/.exec(read('src/data/site.ts'))?.[1];
  const line = /<p class="project-card-authors">([\s\S]*?)<\/p>/.exec(card)?.[1] ?? '';
  const visible = decodeEntities(line.replace(/<span class="visually-hidden">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  assert.ok(authors.length > 0 && owner, 'authors in src/data/dexgoCard.ts and the owner in src/data/site.ts');
  assert.equal(visible, authors.join(', '));
  assert.ok(line.includes(`<strong>${owner}</strong>`), `${owner} is bold`);
  assert.ok(!tagsNamed(line, 'a').some((tag) => line.includes(`${tag}${owner}</a>`)), `${owner} is not a link`);

  // A chip without a target is not a link: a <span> (not focusable) marked "soon"; the project page chip links.
  const chips = chipsOf(card);
  assert.ok(chips.length > 0, 'the card has link chips');
  for (const { element, tag, body } of chips) {
    if (element === 'a') {
      assert.ok(attributeOf(tag, 'href'), `${tag} has a target`);
      assert.doesNotMatch(body, /soon/, `${tag} is not marked soon`);
    } else {
      assert.equal(attributeOf(tag, 'href'), undefined, `${tag} is not a link`);
      assert.match(body, /soon/, `${tag} says soon`);
    }
  }
  assert.ok(chips.some(({ tag }) => attributeOf(tag, 'href') === '/dexgo/'), 'one chip links to /dexgo/');
});

/** Link chips (LinkChips.astro) in `markup`: element name, opening tag and inner markup. */
function chipsOf(markup) {
  return Array.from(markup.matchAll(/<(a|span) (class="project-chip[^"]*"[^>]*)>([\s\S]*?)<\/\1>(?=\s*<\/li>)/g), ([, element, attrs, body]) => ({
    element,
    tag: `<${element} ${attrs}>`,
    body
  }));
}

test('photography conditions and lenses: the Chinese label is set beside the English one on their tag pages and filters', () => {
  for (const group of ['condition', 'lens']) {
    const tagPages = htmlFiles.filter((file) => new RegExp(`^/photography/tags/${group}/[^/]+/$`).test(urlPathOf(file)));
    assert.ok(tagPages.length > 0, `at least one ${group} is used`);
    for (const file of tagPages) {
      const h1 = /<h1 id="tag-title">([\s\S]*?)<\/h1>/.exec(markupOf(file))?.[1] ?? '';
      assert.match(h1, /<span data-lang-inline="en">[^<]+<\/span>\s*<span data-lang-inline="zh">[^<]*[\u4e00-\u9fff][^<]*<\/span>/, urlPathOf(file));
    }
    const filters = new RegExp(`<fieldset class="tag-filter-group" data-filter-group="${group}">[\\s\\S]*?</fieldset>`).exec(markupOf(join(dist, 'photography', 'tags', 'index.html')))?.[0] ?? '';
    const options = filters.match(/<span class="tag-filter-option-label">[\s\S]*?<\/span>\s*<\/span>/g) ?? [];
    assert.ok(options.length > 0, group);
    assert.ok(options.every((option) => /data-lang-inline="zh">[^<]*[\u4e00-\u9fff]/.test(option)), group);
  }
});

test('photography grids: the landing page loads every tile lazily (its hero is the main image); galleries keep their first row eager', () => {
  const gridImages = (file) => tagsNamed(markupOf(file), 'img').filter((tag) => /class="photo-grid-image"/.test(tag));
  const landing = gridImages(join(dist, 'photography', 'index.html'));
  assert.ok(landing.length > 0);
  assert.deepEqual(landing.filter((tag) => attributeOf(tag, 'loading') !== 'lazy').length, 0, '/photography/: no eager grid tile');
  for (const page of [['category', 'landscape'], ['projects', 'moments-in-the-room'], ['tags', 'condition', 'clear'], ['tags']]) {
    const loading = gridImages(join(dist, 'photography', ...page, 'index.html')).map((tag) => attributeOf(tag, 'loading'));
    assert.deepEqual(loading.slice(0, 4), ['eager', 'eager', 'eager', 'lazy'], `/photography/${page.join('/')}/: first row eager`);
  }
});

test('photography tag pages: the title names the tag group first, and og:title is the title', () => {
  const groups = { location: 'Locations', camera: 'Cameras', lens: 'Lenses', condition: 'Conditions' };
  const tagPages = htmlFiles.filter((file) => /^\/photography\/tags\/[^/]+\/[^/]+\/$/.test(urlPathOf(file)));
  assert.ok(tagPages.length > 0);
  for (const file of tagPages) {
    const markup = html.get(file);
    const group = urlPathOf(file).split('/')[3];
    const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(markup)?.[1] ?? '');
    assert.match(title, new RegExp(`^${groups[group]}: [^|]+ \\| Photography \\| `), urlPathOf(file));
    const og = tagsNamed(markup, 'meta').find((tag) => attributeOf(tag, 'property') === 'og:title');
    assert.equal(og && attributeOf(og, 'content'), title, urlPathOf(file));
  }
});

test('photo pages: the first metadata row is named as the landing section ("Categories" / 分类) and links categories', () => {
  const photoPages = htmlFiles.filter((file) => html.get(file).includes('data-metadata="type"'));
  assert.ok(photoPages.length > 0);
  for (const file of photoPages) {
    const row = /data-metadata="type"[^>]*>([\s\S]*?)<\/div>/.exec(html.get(file))?.[1] ?? '';
    assert.match(row, /<dt>\s*<span data-lang-inline="en">Categories<\/span>\s*<span data-lang-inline="zh">分类<\/span>\s*<\/dt>/, urlPathOf(file));
    assert.match(row, /href="\/photography\/category\/[^"/]+\/"/, urlPathOf(file));
  }
});

/** Pixel size [w, h] of a WebP or JPEG file (header only). */
function imageSize(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length; ) {
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  throw new Error(`unknown image format: ${file}`);
}

test('photography share images: every photography page (landing, galleries, tags, photos), with the file\'s size and alt; wide ones large', () => {
  const problems = [];
  const pages = htmlFiles.filter(isPhotographyPage);
  assert.ok(pages.length > photoPages.length, 'gallery and tag pages are included');
  for (const file of pages) {
    const metas = tagsNamed(markupOf(file), 'meta');
    const meta = (key) => attributeOf(metas.find((tag) => (attributeOf(tag, 'property') ?? attributeOf(tag, 'name')) === key) ?? '', 'content');
    const page = urlPathOf(file);
    const image = meta('og:image');
    if (!image) {
      problems.push(`${page}: no og:image`);
      continue;
    }
    const target = resolveInternal(image, file);
    if (!target?.file) {
      problems.push(`${page}: og:image ${image} not in dist/`);
      continue;
    }
    const [width, height] = imageSize(target.file);
    if (meta('og:image:width') !== String(width) || meta('og:image:height') !== String(height)) {
      problems.push(`${page}: og:image ${meta('og:image:width')}x${meta('og:image:height')}, file ${width}x${height}`);
    }
    if (!meta('og:image:alt')) problems.push(`${page}: no og:image:alt`);
    const card = width >= 600 && width !== height ? 'summary_large_image' : 'summary';
    if (meta('twitter:card') !== card) problems.push(`${page}: twitter:card ${meta('twitter:card')}, expected ${card}`);
  }
  assert.deepEqual(problems, []);
});

test('no page of a production build shows placeholder text (TODO, lorem, TBD)', () => {
  const found = [];
  for (const file of htmlFiles) {
    const visible = decodeEntities(markupOf(file).replace(/<[^>]+>/g, ' '));
    const match = /\bTODO\b|lorem ipsum|\bTBD\b/i.exec(visible);
    if (match) found.push(`${urlPathOf(file)}: ${visible.slice(Math.max(0, match.index - 30), match.index + 40).replace(/\s+/g, ' ')}`);
  }
  assert.deepEqual(found, []);
});
