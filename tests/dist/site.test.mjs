// Checks of the built site in dist/ against the photo records (no browser).
// Run after `npm run build`: npm run test:dist   (node --test tests/dist/*.test.mjs)
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

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

test('homepage project card: a looping clip, the author line of dexgo.ts, links without a target marked "soon"', () => {
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
    read('src/data/dexgo.ts').matchAll(/\{\s*name:\s*'([^']+)',\s*href:\s*'[^']*',\s*equal:\s*(true|false)\s*\}/g),
    ([, name, equal]) => `${name}${equal === 'true' ? '*' : ''}`
  );
  const owner = /name:\s*'([^']+)'/.exec(read('src/data/site.ts'))?.[1];
  const line = /<p class="project-card-authors">([\s\S]*?)<\/p>/.exec(card)?.[1] ?? '';
  const visible = decodeEntities(line.replace(/<span class="visually-hidden">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  assert.ok(authors.length > 0 && owner, 'authors in src/data/dexgo.ts and the owner in src/data/site.ts');
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

test('/dexgo/ title block: the link chips of dexgo.ts, a link without a target marked soon or left out', () => {
  const markup = markupOf(join(dist, 'dexgo', 'index.html'));
  const title = /<header class="dx-title">([\s\S]*?)<\/header>/.exec(markup)?.[1];
  assert.ok(title, 'dist/dexgo/index.html has a title block');
  const shown = chipsOf(title).map(({ element, body }) => `${element}:${decodeEntities(body.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()}`);
  const links = Array.from(
    read('src/data/dexgo.ts').matchAll(/\{\s*label:\s*'([^']+)',\s*icon:\s*'[^']+',\s*href:\s*'([^']*)',\s*soon:\s*(true|false)\s*\}/g),
    ([, label, href, soon]) => ({ label, href, soon: soon === 'true' })
  );
  assert.ok(links.length > 0, 'links found in src/data/dexgo.ts');
  const expected = links.flatMap(({ label, href, soon }) => (href ? [`a:${label}`] : soon ? [`span:${label} · soon`] : []));
  assert.deepEqual(shown, expected);
});

/** Seconds of a WebVTT timestamp (hh:mm:ss.mmm or mm:ss.mmm). */
const vttSeconds = (stamp) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);

/** Top-level MP4 boxes of `buf`: [type, offset, size]. */
const mp4Boxes = (buf) => {
  const boxes = [];
  for (let offset = 0; offset + 8 <= buf.length; ) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(offset + 8));
    else if (size === 0) size = buf.length - offset;
    if (size < 8) break;
    boxes.push([type, offset, size]);
    offset += size;
  }
  return boxes;
};

test('/dexgo/ hero: the teaser (2:1, and 4:3 on phones) as muted looping clips with posters; no project video', () => {
  const markup = markupOf(join(dist, 'dexgo', 'index.html'));
  const hero = /<div class="dx-media dx-hero">([\s\S]*?)<\/div>\s*<section/.exec(markup)?.[1] ?? '';
  const videos = tagsNamed(hero, 'video');
  assert.equal(videos.length, 2, 'the wide and the phone cut');
  const sources = tagsNamed(hero, 'source').map((tag) => attributeOf(tag, 'src'));
  assert.deepEqual(sources, ['/assets/dexgo/clips/teaser_1080p_crop.mp4', '/assets/dexgo/clips/teaser_phone.mp4']);
  for (const video of videos) {
    assert.notEqual(attributeOf(video, 'muted'), undefined);
    assert.notEqual(attributeOf(video, 'loop'), undefined);
    assert.notEqual(attributeOf(video, 'playsinline'), undefined);
    assert.equal(attributeOf(video, 'controls'), undefined);
    assert.ok(existsSync(join(dist, attributeOf(video, 'data-poster'))), attributeOf(video, 'data-poster'));
  }
  assert.doesNotMatch(markup, /data-player|data-sound-on|dexgo_video|assets\/dexgo\/video/);
  for (const file of ['dexgo_video.mp4', 'dexgo_video_poster.webp', 'dexgo_video.en.vtt']) {
    assert.equal(existsSync(join(dist, 'assets', 'dexgo', 'video', file)), false, `${file} is gone`);
  }
});

test('/dexgo/ structure: sticky nav with the three parts and one pause button; Method, Live demo, Results as parts with an eyebrow and an h2', () => {
  const markup = markupOf(join(dist, 'dexgo', 'index.html'));
  const nav = /<nav class="dx-localnav"[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? '';
  assert.deepEqual(tagsNamed(nav, 'a').map((tag) => attributeOf(tag, 'href')), ['#main', '#method', '#live-demo', '#results']);
  assert.equal(tagsNamed(markup, 'button').filter((tag) => attributeOf(tag, 'data-video-toggle') !== undefined).length, 1);
  const parts = [...markup.matchAll(/<section id="(method|live-demo|results)" class="dx-part[^"]*"[^>]*>\s*<header class="dx-part-head"[^>]*>\s*<p class="dx-eyebrow">([^<]+)<\/p>\s*<h2\b/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(parts, [['method', 'Method'], ['live-demo', 'Live demo'], ['results', 'Results']]);
  const demo = /<section id="live-demo"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
  assert.deepEqual(tagsNamed(demo, 'source').map((tag) => attributeOf(tag, 'src')), ['/assets/dexgo/clips/chain_ticker.mp4', '/assets/dexgo/clips/chain_ticker_phone.mp4']);
  assert.match(demo, /data-demo-start[^>]*>[\s\S]*?Start the live demo/);
  assert.match(markup, /<a slot="lead"|class="dx-pill dx-pill-primary" href="#live-demo" data-demo-jump/);
});

test('/dexgo/figure/: the overview figure at 1000 px on a standalone page, linked from the /dexgo/ figure on phones', () => {
  const dexgo = markupOf(join(dist, 'dexgo', 'index.html'));
  const opens = [...tagsNamed(dexgo, 'a').filter((tag) => /class="[^"]*\bdx-method-(open|zoom)\b/.test(tag))];
  assert.equal(opens.length, 2, 'the phone link and the image link of the method figure');
  for (const tag of opens) assert.equal(attributeOf(tag, 'href'), '/dexgo/figure/');

  const file = join(dist, 'dexgo', 'figure', 'index.html');
  assert.ok(existsSync(file), 'dist/dexgo/figure/index.html exists');
  const markup = markupOf(file);
  assert.ok(tagsNamed(markup, 'meta').some((tag) => attributeOf(tag, 'name') === 'viewport' && /width=device-width/.test(attributeOf(tag, 'content') ?? '')));
  assert.ok(tagsNamed(markup, 'meta').some((tag) => attributeOf(tag, 'name') === 'robots' && attributeOf(tag, 'content') === 'noindex'));
  // Standalone like /dexgo/: no personal header, nav or footer; only the project's own icon.
  assert.deepEqual([/<header\b/i, /<nav\b/i, /<footer\b/i].filter((pattern) => pattern.test(markup)).map(String), []);
  const icons = tagsNamed(markup, 'link').filter((tag) => /\bicon\b/.test(attributeOf(tag, 'rel') ?? ''));
  assert.ok(icons.length > 0 && icons.every((tag) => (attributeOf(tag, 'href') ?? '').startsWith('/dexgo/')), 'DexGO icons only');
  const image = tagsNamed(markup, 'img').find((tag) => attributeOf(tag, 'src') === '/assets/dexgo/method_overview_web.svg');
  assert.ok(image, 'the figure image');
  assert.equal(attributeOf(image, 'width'), '1000');
  assert.ok(tagsNamed(markup, 'a').some((tag) => attributeOf(tag, 'href') === '/dexgo/#method'), 'a link back to the Method part (with the figure) on /dexgo/');
  // One name for the figure: the tab title is the figure's accessible name. The scroll buttons start hidden (the page
  // script shows the one on a side with more figure) and are labelled.
  const label = /<figure class="dx-method-figure" aria-label="([^"]+)"/.exec(dexgo)?.[1];
  assert.equal(/<title>([^<]*)<\/title>/.exec(markup)?.[1], label);
  const buttons = tagsNamed(markup, 'button').filter((tag) => attributeOf(tag, 'data-figure-more') !== undefined);
  assert.deepEqual(buttons.map((tag) => [attributeOf(tag, 'aria-label'), attributeOf(tag, 'hidden') !== undefined]), [
    ['Scroll the figure left', true],
    ['Scroll the figure right', true]
  ]);
});

test('/dexgo/ prerequisite graph: one Tab stop, on the selected task', () => {
  const nodes = tagsNamed(markupOf(join(dist, 'dexgo', 'index.html')), 'button').filter((tag) => /class="dx-node"/.test(tag));
  assert.equal(nodes.length, 15);
  const stops = nodes.filter((tag) => attributeOf(tag, 'tabindex') === '0');
  assert.equal(stops.length, 1);
  assert.equal(attributeOf(stops[0], 'aria-pressed'), 'true');
  assert.ok(nodes.every((tag) => tag === stops[0] || attributeOf(tag, 'tabindex') === '-1'));
});

test('/dexgo/ prerequisite graph: every node is described by the arrow-key sentence', () => {
  const markup = markupOf(join(dist, 'dexgo', 'index.html'));
  const nodes = tagsNamed(markup, 'button').filter((tag) => /class="dx-node"/.test(tag));
  const ids = new Set(nodes.map((tag) => attributeOf(tag, 'aria-describedby')));
  assert.equal(ids.size, 1);
  const [id] = ids;
  assert.match(markup, new RegExp(`<span id="${id}" class="visually-hidden">Arrow keys move between tasks\\.</span>`));
});

test('/dexgo/ fonts: self-hosted, no third-party font host, preloaded files that exist', () => {
  for (const page of [['dexgo', 'index.html'], ['dexgo', 'figure', 'index.html']]) {
    assert.doesNotMatch(html.get(join(dist, ...page)), /fonts\.(googleapis|gstatic)\.com/, page.join('/'));
  }
  const markup = markupOf(join(dist, 'dexgo', 'index.html'));
  const preloads = tagsNamed(markup, 'link').filter((tag) => attributeOf(tag, 'rel') === 'preload' && attributeOf(tag, 'as') === 'font');
  // One family for all text (owner 2026-11-23): Source Sans 3 only.
  assert.deepEqual(preloads.map((tag) => attributeOf(tag, 'href')).sort(), ['/fonts/source-sans-3/source-sans-3-latin-var.woff2']);
  for (const tag of preloads) {
    assert.equal(attributeOf(tag, 'type'), 'font/woff2');
    assert.notEqual(attributeOf(tag, 'crossorigin'), undefined, 'a font preload needs crossorigin to be used');
    assert.ok(existsSync(join(dist, attributeOf(tag, 'href'))), attributeOf(tag, 'href'));
  }
  const css = readdirSync(join(dist, '_astro')).filter((file) => file.endsWith('.css')).map((file) => readFileSync(join(dist, '_astro', file), 'utf8')).join('');
  const declared = css + html.get(join(dist, 'dexgo', 'index.html'));
  for (const tag of preloads) assert.ok(declared.includes(`url("${attributeOf(tag, 'href')}")`) || declared.includes(`url(${attributeOf(tag, 'href')})`), `a @font-face uses ${attributeOf(tag, 'href')}`);
});

test('/dexgo/ fonts: one family, no serif face declared or loaded, the <em> phrase set in it', () => {
  const page = html.get(join(dist, 'dexgo', 'index.html'));
  const css = readdirSync(join(dist, '_astro')).filter((file) => file.endsWith('.css')).map((file) => readFileSync(join(dist, '_astro', file), 'utf8')).join('');
  assert.doesNotMatch(page + css, /Source Serif|source-serif/);
  assert.ok(/<em>[^<]+<\/em>/.test(markupOf(join(dist, 'dexgo', 'index.html'))), 'the abstract keeps its emphasis');
});

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

test('/dexgo/ problem definition: between the abstract and Method, three goal parts as buttons, no capability letters', () => {
  const markup = markupOf(join(dist, 'dexgo', 'index.html'));
  const at = (re) => markup.search(re);
  assert.ok(at(/class="dx-section dx-abstract"/) < at(/<section id="problem"/), 'after the abstract');
  assert.ok(at(/<section id="problem"/) < at(/<section id="method"/), 'before the Method part');
  const section = /<section id="problem"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
  assert.match(section, /<p class="dx-eyebrow">Problem definition<\/p>\s*<h2\b/);
  const buttons = tagsNamed(section, 'button').filter((tag) => attributeOf(tag, 'data-part-key') !== undefined);
  assert.deepEqual(buttons.map((tag) => attributeOf(tag, 'data-part-key')), ['rel', 'fingers', 'world']);
  for (const tag of buttons) {
    assert.equal(attributeOf(tag, 'aria-pressed'), 'false');
    assert.match(section, new RegExp(`id="${attributeOf(tag, 'aria-describedby')}"`));
  }
  const text = section.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /\b(R|T|G|L|RT|RG|RL|TG|TL|GL|RTG|RTL|RGL|TGL|RTGL)\b/, 'no capability letters');
  for (const name of ['pd_start', 'pd_all', 'pd_rel', 'pd_fingers', 'pd_world', 'ov_rel', 'ov_fingers', 'ov_world']) {
    assert.ok(existsSync(join(dist, 'assets', 'dexgo', 'problem', `${name}.webp`)), `${name}.webp`);
  }
  assert.ok(existsSync(join(dist, 'assets', 'dexgo', 'problem', 'pd_motion.mp4')));
});

test('/dexgo/ abstract: the problem name emphasised as in the paper', () => {
  const abstract = /<section class="dx-section dx-abstract"[\s\S]*?<\/section>/.exec(markupOf(join(dist, 'dexgo', 'index.html')))?.[0] ?? '';
  assert.match(abstract, /<em>grasp transition with object relocation<\/em>/);
  assert.doesNotMatch(abstract, /\\emph/);
});

/** Code points that have a glyph in a WOFF2 font file (its cmap, formats 4 and 12; Unicode subtables). */
function woff2CodePoints(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', `${file} is WOFF2`);
  let pos = 48; // after the header; the table directory follows
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = buf[pos++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };
  // Tables follow each other in the decompressed stream in directory order; glyf (10) and loca (11) are stored
  // transformed with version 0, hmtx (3) with version 1. Known tag 0 is cmap.
  const tables = Array.from({ length: buf.readUInt16BE(12) }, () => {
    const flags = buf[pos++];
    const known = flags & 0x3f;
    if (known === 0x3f) pos += 4;
    const version = flags >> 6;
    const length = base128();
    const transformed = known === 10 || known === 11 ? version === 0 : version !== 0;
    return { known, length: transformed ? base128() : length };
  });
  const data = brotliDecompressSync(buf.subarray(pos, pos + buf.readUInt32BE(20)));
  const index = tables.findIndex((table) => table.known === 0);
  const offset = tables.slice(0, index).reduce((sum, table) => sum + table.length, 0);
  const cmap = data.subarray(offset, offset + tables[index].length);
  const points = new Set();
  for (let r = 0; r < cmap.readUInt16BE(2); r += 1) {
    const platform = cmap.readUInt16BE(4 + 8 * r);
    const encoding = cmap.readUInt16BE(6 + 8 * r);
    const at = cmap.readUInt32BE(8 + 8 * r);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = cmap.readUInt16BE(at);
    if (format === 4) {
      const segments = cmap.readUInt16BE(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + 2 * segments + 2;
      const deltas = starts + 2 * segments;
      const ranges = deltas + 2 * segments;
      for (let s = 0; s < segments; s += 1) {
        const start = cmap.readUInt16BE(starts + 2 * s);
        const delta = cmap.readInt16BE(deltas + 2 * s);
        const range = cmap.readUInt16BE(ranges + 2 * s);
        for (let c = start; c <= cmap.readUInt16BE(ends + 2 * s) && c !== 0xffff; c += 1) {
          let glyph = range === 0 ? c : cmap.readUInt16BE(ranges + 2 * s + range + 2 * (c - start));
          if (range === 0 || glyph !== 0) glyph = (glyph + delta) & 0xffff;
          if (glyph !== 0) points.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < cmap.readUInt32BE(at + 12); g += 1) {
        for (let c = cmap.readUInt32BE(at + 16 + 12 * g); c <= cmap.readUInt32BE(at + 20 + 12 * g); c += 1) points.add(c);
      }
    }
  }
  return points;
}

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
