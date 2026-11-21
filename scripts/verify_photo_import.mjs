#!/usr/bin/env node
// File-level check of the photo library, run from the site root:
//   node scripts/verify_photo_import.mjs
//
// It checks what the build cannot see cheaply:
// - every Markdown record has exactly one WebP file and vice versa, width/height/orientation match
//   the real WebP size, and slugs equal file names;
// - derivative policy: no EXIF or XMP in any works or variant WebP, works long edge <= 2400 px;
// - width variants: every works photo and every image directly in public/assets/photography/ has
//   exactly the variants `variants/<stem>-<width>.webp` for each width of the report's
//   settings.variant_widths below its own width, each of that width and proportional height
//   (+-1 px); every variant file belongs to such an image;
// - the import manifest and report list the same photos as src/content/photos/, manifest values
//   agree with the records, and the report holds no absolute paths.
// References from Selected Works, projects and category covers are checked by the build
// (getPhotoLibrary in src/lib/photography.ts); vocabulary values by the content schema
// (src/content.config.ts).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const photographyDir = join(repoRoot, 'public/assets/photography');
const worksDir = join(photographyDir, 'works');
const variantsDir = join(photographyDir, 'variants');
const photosDir = join(repoRoot, 'src/content/photos');
const reportPath = join(repoRoot, 'docs/photo-import-report.json');
const manifestPath = join(repoRoot, 'scripts/photo-import-drafts.json');
const variantDirSetting = 'public/assets/photography/variants';
const maxLongEdge = 2400;
// Working files of the source export that must never be published (see scripts/import_photos.py;
// matched against file names).
const excludedMarkers = ['contact_sheet', 'bw_conversion_review', 'forphotographeronly'];
const requiredFields = ['slug', 'category', 'image', 'width', 'height', 'orientation', 'order'];
// Record fields whose value comes from the import manifest.
const manifestOwnedFields = [
  'title', 'category', 'categories', 'alt', 'location', 'camera', 'lens',
  'condition', 'conditions', 'order', 'note', 'date', 'year', 'slug'
];
// What the importer writes for these fields when a manifest entry leaves them out.
const manifestEmptyDefaults = {
  title: 'Untitled', categories: [], location: '', lens: '', condition: '', conditions: [], note: '', date: '', year: ''
};
const sourceImageExtensions = new Set(['.webp', '.jpg', '.jpeg', '.png']);
const variantNamePattern = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9]+)\.webp$/;

const errors = [];
const fail = (message) => errors.push(message);

const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [])
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();

const duplicatesOf = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

/** Top-level frontmatter values: JSON-style scalars and lists as the importer writes them, plus `|` / `|-` blocks. */
function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return {};
  const lines = match[1].split('\n');
  const values = {};
  for (let index = 0; index < lines.length;) {
    const field = lines[index++].match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!field) continue;
    const [, key, raw] = field;
    if (raw === '|' || raw === '|-') {
      const block = [];
      while (index < lines.length && (lines[index].startsWith('  ') || lines[index] === '')) block.push(lines[index++].slice(2));
      const text = block.join('\n').replace(/\n+$/, '');
      values[key] = raw === '|-' ? text : `${text}\n`;
      continue;
    }
    try {
      values[key] = JSON.parse(raw);
    } catch {
      values[key] = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return values;
}

/**
 * Size and metadata of a WebP file from its RIFF chunks (lossy VP8, lossless VP8L or extended VP8X):
 * `{ width, height, flags, chunks }`, where `flags` is the VP8X flags byte (file offset 20; 0 without VP8X).
 */
function webpInfo(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const info = { width: 0, height: 0, flags: 0, chunks: new Set() };
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    info.chunks.add(chunk);
    if (!info.width && chunk === 'VP8X' && offset + 18 <= bytes.length) {
      info.flags = bytes[offset + 8];
      info.width = 1 + bytes.readUIntLE(offset + 12, 3);
      info.height = 1 + bytes.readUIntLE(offset + 15, 3);
    } else if (!info.width && chunk === 'VP8 ' && offset + 18 <= bytes.length) {
      info.width = bytes.readUInt16LE(offset + 14) & 0x3fff;
      info.height = bytes.readUInt16LE(offset + 16) & 0x3fff;
    } else if (!info.width && chunk === 'VP8L' && offset + 13 <= bytes.length) {
      const bits = bytes.readUInt32LE(offset + 9);
      info.width = 1 + (bits & 0x3fff);
      info.height = 1 + ((bits >> 14) & 0x3fff);
    }
    offset += 8 + size + (size & 1);
  }
  return info.width ? info : null;
}

/** Pixel size of a JPEG (first SOF marker; EXIF rotation is not applied) or PNG (IHDR). */
function rasterSize(path) {
  const bytes = readFileSync(path);
  if (bytes.length > 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 <= bytes.length;) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

const imageSize = (path) => (extname(path).toLowerCase() === '.webp' ? webpInfo(path) : rasterSize(path));

/** Derivative policy shared by works files and variants: no EXIF (flag 0x08) and no XMP (flag 0x04). */
function checkNoMetadata(label, info) {
  if (info.flags & 0x08 || info.chunks.has('EXIF')) fail(`${label} carries EXIF metadata (derivatives must drop it)`);
  if (info.flags & 0x04 || info.chunks.has('XMP ')) fail(`${label} carries XMP metadata (derivatives must drop it)`);
}

const orientationFor = ({ width, height }) =>
  width === height ? 'square' : height > width ? 'portrait' : 'landscape';

// Photo records and their WebP files.
const workFiles = listFiles(worksDir);
const photoFiles = listFiles(photosDir).filter((name) => name.endsWith('.md'));
const records = photoFiles.map((fileName) => ({
  fileName,
  frontmatter: parseFrontmatter(readFileSync(join(photosDir, fileName), 'utf8'))
}));
const slugs = records.map((record) => record.frontmatter.slug ?? record.fileName.replace(/\.md$/, ''));
const slugSet = new Set(slugs);

for (const fileName of workFiles) {
  if (!fileName.endsWith('.webp')) fail(`Non-WebP file in public/assets/photography/works/: ${fileName}`);
  // Reachable: "forphotographeronly-…" is a valid slug, so a record could publish such a file.
  if (excludedMarkers.some((marker) => fileName.toLowerCase().includes(marker))) fail(`Excluded working file published: ${fileName}`);
  if (!slugSet.has(fileName.replace(/\.webp$/, ''))) {
    fail(`public/assets/photography/works/${fileName} has no Markdown record (src/content/photos/${fileName.replace(/\.webp$/, '.md')})`);
  }
}

for (const slug of duplicatesOf(slugs)) {
  const files = records.filter((record) => record.frontmatter.slug === slug).map((record) => record.fileName);
  fail(`Slug "${slug}" is used by several files: ${files.join(', ')}`);
}

for (const { fileName, frontmatter } of records) {
  for (const field of requiredFields) {
    if (!(field in frontmatter)) fail(`${fileName} is missing ${field}`);
  }

  const slug = frontmatter.slug;
  if (slug !== undefined && `${slug}.md` !== fileName) fail(`${fileName}: slug "${slug}" must equal the file name`);

  const expectedImage = `/assets/photography/works/${slug}.webp`;
  if (frontmatter.image !== expectedImage) fail(`${fileName}: image must be ${expectedImage}, found ${frontmatter.image}`);

  const imagePath = join(repoRoot, 'public', expectedImage);
  if (!existsSync(imagePath)) {
    fail(`${fileName}: image file public${expectedImage} is missing`);
    continue;
  }

  const size = webpInfo(imagePath);
  if (!size) {
    fail(`${fileName}: public${expectedImage} is not a readable WebP file`);
    continue;
  }
  if (Number(frontmatter.width) !== size.width || Number(frontmatter.height) !== size.height) {
    fail(`${fileName}: width/height ${frontmatter.width}x${frontmatter.height} but the WebP is ${size.width}x${size.height}`);
  }
  if (frontmatter.orientation !== orientationFor(size)) {
    fail(`${fileName}: orientation "${frontmatter.orientation}" but the WebP is ${orientationFor(size)}`);
  }
  checkNoMetadata(`public${expectedImage}`, size);
  if (Math.max(size.width, size.height) > maxLongEdge) {
    fail(`public${expectedImage} is ${size.width}x${size.height}; the long edge must be at most ${maxLongEdge} px`);
  }
}

// Import report: the photos the importer wrote, and the variant widths it uses.
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;

if (!report) {
  fail('docs/photo-import-report.json is missing');
} else {
  const reportSlugs = (report.included ?? []).map((entry) => entry.slug);
  if (report.included_count !== reportSlugs.length) {
    fail(`Report included_count is ${report.included_count} but it lists ${reportSlugs.length} photos`);
  }
  for (const slug of reportSlugs) {
    if (!slugSet.has(slug)) fail(`docs/photo-import-report.json lists "${slug}", which has no Markdown record`);
  }
  for (const slug of slugSet) {
    if (!reportSlugs.includes(slug)) fail(`docs/photo-import-report.json does not list "${slug}"`);
  }
  for (const entry of report.included ?? []) {
    const sourceName = String(entry.source ?? '').split('/').pop().toLowerCase();
    if (excludedMarkers.some((marker) => sourceName.includes(marker))) {
      fail(`Report imported an excluded working file: ${entry.source}`);
    }
  }

  // Paths in the report are repository-relative (or bare file names): no host paths.
  const visit = (value, where) => {
    if (typeof value === 'string') {
      if (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(value) || /\/(?:Users|home)\//.test(value)) {
        fail(`docs/photo-import-report.json ${where} holds an absolute path: ${value}`);
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, `${where}.${key}`);
    }
  };
  visit(report, 'report');
}

// Width variants: `variants/<stem>-<width>.webp`, widths from the report.
const variantWidths = report?.settings?.variant_widths;
const variantFiles = listFiles(variantsDir);
if (!Array.isArray(variantWidths) || !variantWidths.length || !variantWidths.every((width) => Number.isInteger(width) && width > 0)) {
  fail('docs/photo-import-report.json: settings.variant_widths must be a list of positive integers (run the importer with --report)');
} else {
  if (report.settings.variant_dir !== variantDirSetting) {
    fail(`docs/photo-import-report.json: settings.variant_dir must be "${variantDirSetting}", found ${JSON.stringify(report.settings.variant_dir)}`);
  }

  // Images that get variants: every works photo, and every image directly in public/assets/photography/.
  const variantSources = new Map();
  for (const fileName of workFiles.filter((name) => name.endsWith('.webp'))) {
    variantSources.set(fileName.replace(/\.webp$/, ''), { label: `public/assets/photography/works/${fileName}`, path: join(worksDir, fileName) });
  }
  for (const fileName of listFiles(photographyDir).filter((name) => sourceImageExtensions.has(extname(name).toLowerCase()))) {
    const stem = fileName.slice(0, -extname(fileName).length);
    const label = `public/assets/photography/${fileName}`;
    if (variantSources.has(stem)) {
      fail(`${label} and ${variantSources.get(stem).label} would share the variant names variants/${stem}-<width>.webp`);
      continue;
    }
    variantSources.set(stem, { label, path: join(photographyDir, fileName) });
  }

  const backfillHint = (source) =>
    `python3 scripts/import_photos.py --backfill-variants${source.label.includes('/works/') ? '' : ` ${source.label}`} --report docs/photo-import-report.json`;
  const expectedWidths = new Map();
  for (const [stem, source] of variantSources) {
    source.size = imageSize(source.path);
    if (!source.size) {
      fail(`${source.label} is not a readable image`);
      continue;
    }
    const widths = variantWidths.filter((width) => width < source.size.width);
    expectedWidths.set(stem, widths);
    for (const width of widths) {
      if (!variantFiles.includes(`${stem}-${width}.webp`)) {
        fail(`${source.label} has no ${variantDirSetting}/${stem}-${width}.webp (run \`${backfillHint(source)}\`)`);
      }
    }
  }

  for (const fileName of variantFiles) {
    const label = `${variantDirSetting}/${fileName}`;
    const match = fileName.match(variantNamePattern);
    if (!match) {
      fail(`${label} is not named <stem>-<width>.webp`);
      continue;
    }
    const [, stem, widthText] = match;
    const width = Number(widthText);
    const source = variantSources.get(stem);
    if (!source) {
      fail(`${label} belongs to no photo in works/ and no image in public/assets/photography/ (orphan)`);
      continue;
    }
    if (!source.size) continue;
    const widths = expectedWidths.get(stem);
    if (!widths.includes(width)) {
      fail(`${label} is not an expected variant of ${source.label} (${source.size.width} px wide; expected widths: ${widths.join(', ') || 'none'})`);
      continue;
    }
    const info = webpInfo(join(variantsDir, fileName));
    if (!info) {
      fail(`${label} is not a readable WebP file`);
      continue;
    }
    const expectedHeight = (width * source.size.height) / source.size.width;
    if (info.width !== width || Math.abs(info.height - expectedHeight) > 1) {
      fail(`${label} is ${info.width}x${info.height}; expected ${width}x${Math.round(expectedHeight)} (±1 px) from ${source.label}`);
    }
    checkNoMetadata(label, info);
  }
}

// Import manifest: one entry per published photo (it is the input of scripts/import_photos.py).
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

/** Record values the importer would write from a manifest entry, for the manifest-owned fields it sets. */
function valuesFromManifest(entry) {
  const values = {};
  for (const field of manifestOwnedFields) {
    if (field in entry) values[field] = entry[field];
    else if (field in manifestEmptyDefaults) values[field] = manifestEmptyDefaults[field];
  }
  values.title = values.title || 'Untitled';
  if ('order' in values) values.order = Number(values.order);
  if (Array.isArray(values.conditions)) {
    values.conditions = [...new Set(values.conditions.filter((value) => value && value !== values.condition))];
  }
  return values;
}

if (!Array.isArray(manifest)) {
  fail('scripts/photo-import-drafts.json is missing or not a JSON array');
} else {
  const manifestSlugs = manifest.map((entry) => entry.slug);
  for (const slug of duplicatesOf(manifestSlugs)) fail(`Manifest lists slug "${slug}" more than once`);
  for (const source of duplicatesOf(manifest.map((entry) => entry.source))) fail(`Manifest lists source "${source}" more than once`);
  for (const slug of manifestSlugs) {
    if (!slugSet.has(slug)) fail(`Manifest entry "${slug}" has no src/content/photos/${slug}.md (remove the entry or restore the photo)`);
  }
  for (const slug of slugSet) {
    if (!manifestSlugs.includes(slug)) fail(`src/content/photos/${slug}.md has no entry in scripts/photo-import-drafts.json`);
  }

  // A record value that differs from the manifest would be lost by the next `--replace`, which
  // refuses to run until the two agree: copy the edit into the manifest (or back into the record).
  for (const entry of manifest) {
    const record = records.find((candidate) => candidate.frontmatter.slug === entry.slug);
    if (!record) continue;
    const differences = Object.entries(valuesFromManifest(entry))
      .filter(([field, value]) => JSON.stringify(record.frontmatter[field]) !== JSON.stringify(value))
      .map(([field, value]) => `${field}: record ${JSON.stringify(record.frontmatter[field])}, manifest ${JSON.stringify(value)}`);
    if (differences.length) fail(`src/content/photos/${record.fileName} differs from its manifest entry: ${differences.join('; ')}`);
  }
}

if (errors.length) {
  console.error('Photo import verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Photo import verification passed: ${workFiles.length} assets, ${photoFiles.length} metadata files, ` +
  `${variantFiles.length} variants (widths ${variantWidths.join(', ')}).`
);
