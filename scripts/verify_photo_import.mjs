#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const worksDir = join(repoRoot, 'public/assets/photography/works');
const photosDir = join(repoRoot, 'src/content/photos');
const reportPath = join(repoRoot, 'docs/photo-import-report.json');
const excludedMarkers = ['contact_sheet', 'bw_conversion_review', 'forphotographeronly', 'docs/'];
const requiredFields = [
  'draftMetadata',
  'width',
  'height',
  'orientation',
  'image',
  'featured',
  'order',
  'language'
];

const errors = [];

function fail(message) {
  errors.push(message);
}

function listFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()) : [];
}

function stripYamlQuotes(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map((matchLine) => [matchLine[1], stripYamlQuotes(matchLine[2])])
  );
}

const workFiles = listFiles(worksDir);
const photoFiles = listFiles(photosDir).filter((name) => name.endsWith('.md'));

if (workFiles.length < 37) fail(`Expected at least 37 work assets, found ${workFiles.length}`);
if (photoFiles.length < 37) fail(`Expected at least 37 photo metadata files, found ${photoFiles.length}`);

for (const fileName of workFiles) {
  if (!fileName.endsWith('.webp')) fail(`Non-WebP file in works directory: ${fileName}`);
  for (const marker of excludedMarkers) {
    if (fileName.includes(marker)) fail(`Excluded marker in work asset: ${fileName}`);
  }
}

for (const fileName of photoFiles) {
  const filePath = join(photosDir, fileName);
  const source = readFileSync(filePath, 'utf8');
  const frontmatter = parseFrontmatter(source);

  for (const field of requiredFields) {
    if (!(field in frontmatter)) fail(`${fileName} missing ${field}`);
  }

  const image = frontmatter.image ?? '';
  for (const marker of excludedMarkers) {
    if (source.includes(marker) || image.includes(marker)) {
      fail(`${fileName} contains excluded marker ${marker}`);
    }
  }
  if (!image.endsWith('.webp')) fail(`${fileName} image is not WebP: ${image}`);

  const publicRelativePath = image.replace(/^\//, '');
  if (!existsSync(join(repoRoot, 'public', publicRelativePath.replace(/^assets\//, 'assets/')))) {
    fail(`${fileName} references missing image ${image}`);
  }
}

if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.included_count !== 37) fail(`Report included_count is ${report.included_count}, expected 37`);
  const reportText = JSON.stringify(report);
  for (const marker of excludedMarkers) {
    const importedMarker = report.included?.some((entry) =>
      JSON.stringify(entry).includes(marker)
    );
    if (importedMarker) fail(`Report imported excluded marker ${marker}`);
    if (marker !== 'docs/' && reportText.includes(`works/${marker}`)) {
      fail(`Report asset path contains excluded marker ${marker}`);
    }
  }
}

if (errors.length) {
  console.error('Photo import verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Photo import verification passed: ${workFiles.length} assets, ${photoFiles.length} metadata files.`);
