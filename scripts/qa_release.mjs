import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4323';
const reportPath = join(root, 'docs', 'release-qa-report.md');
const viewports = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'mobile', width: 390, height: 844 }
];
const routes = [
  '/',
  '/cv/',
  '/photography/',
  '/photography/category/still-life/',
  '/photography/category/landscape/',
  '/photography/category/street/',
  '/photography/category/abstract/',
  '/photography/category/black-and-white/',
  '/photography/category/architecture/',
  '/photography/category/landscape/dsc-8404/',
  '/photography/category/street/dsc-2862/',
  '/photography/projects/moments-in-the-room/',
  '/photography/projects/moments-in-the-room/dsc-2583/',
  '/photography/projects/urban-isolation/',
  '/photography/projects/urban-isolation/dsc-0046/',
  '/photography/selected/dsc-0046/',
  '/photography/selected/dsc-9283/',
  '/photography/tags/',
  '/photography/tags/location/zurich/',
  '/photography/tags/camera/iphone/',
  '/photography/tags/condition/rain/',
  '/photography/dsc-0046/',
  '/photography/nursing-home-chair/',
  '/photography/dsc-9266/'
];
const imageRoutes = new Set([
  '/photography/',
  '/photography/category/still-life/',
  '/photography/category/landscape/',
  '/photography/category/street/',
  '/photography/category/abstract/',
  '/photography/category/black-and-white/',
  '/photography/category/architecture/',
  '/photography/category/landscape/dsc-8404/',
  '/photography/category/street/dsc-2862/',
  '/photography/projects/moments-in-the-room/',
  '/photography/projects/moments-in-the-room/dsc-2583/',
  '/photography/projects/urban-isolation/',
  '/photography/projects/urban-isolation/dsc-0046/',
  '/photography/selected/dsc-0046/',
  '/photography/selected/dsc-9283/',
  '/photography/tags/camera/iphone/',
  '/photography/tags/condition/rain/',
  '/photography/dsc-0046/',
  '/photography/nursing-home-chair/',
  '/photography/dsc-9266/'
]);
const staleSlugs = [
  'zurich-rain-window',
  'paris-street-rest',
  'paris-newsstand',
  'rainy-night-storefront'
];
const importManifestPath = join(root, 'scripts', 'photo-import-drafts.json');

const importManifest = () => JSON.parse(readFileSync(importManifestPath, 'utf8'));

const expectedPhotoCount = () => importManifest().length;

const expectedFilterCount = (filters) =>
  importManifest().filter((photo) =>
    Object.entries(filters).every(([group, value]) => {
      if (group === 'condition') {
        return [photo.condition, ...(photo.conditions ?? [])].includes(value);
      }

      return photo[group] === value;
    })
  ).length;

const expectedSelectedCount = () => {
  const source = readFileSync(join(root, 'src', 'data', 'photography.ts'), 'utf8');
  const match = source.match(/photographySelectedWorkSlugs\s*=\s*\[([\s\S]*?)\]\s*as const/);

  return match ? [...match[1].matchAll(/'([^']+)'/g)].length : 0;
};

const checks = [];

const record = (name, detail = '') => {
  checks.push({ status: 'PASS', name, detail });
};

const fail = (name, detail) => {
  checks.push({ status: 'FAIL', name, detail });
  throw new Error(`${name}: ${detail}`);
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });

const waitForPreview = async () => {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Astro preview is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Astro preview did not become ready on port 4323');
};

const startPreview = async () => {
  const child = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4323'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await waitForPreview();
  return child;
};

const stopPreview = async (child) => {
  if (!child || child.killed) return;

  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolve();
    }, 1500).unref();
  });
};

const walkFiles = (dir, matcher, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, matcher, acc);
    } else if (matcher(path)) {
      acc.push(path);
    }
  }

  return acc;
};

const assertStaticAssets = () => {
  const worksDir = join(root, 'public', 'assets', 'photography', 'works');
  const photosDir = join(root, 'src', 'content', 'photos');
  const workAssets = readdirSync(worksDir).filter((name) => name.endsWith('.webp'));
  const photoRecords = readdirSync(photosDir).filter((name) => name.endsWith('.md'));
  const expectedCount = expectedPhotoCount();

  if (workAssets.length !== expectedCount) fail(`${expectedCount} WebP photography assets`, `${workAssets.length} found`);
  record(`${expectedCount} WebP photography assets`);

  if (photoRecords.length !== expectedCount) fail(`${expectedCount} photo metadata records`, `${photoRecords.length} found`);
  record(`${expectedCount} photo metadata records`);

  if (!existsSync(join(root, 'public', 'assets', 'photography', 'rednote-card.jpg'))) {
    fail('Rednote card asset exists', 'public/assets/photography/rednote-card.jpg missing');
  }
  record('Rednote card asset exists');

  if (!existsSync(join(root, 'public', 'assets', 'photography', 'profile-shadow-2649.webp'))) {
    fail('Photography intro asset exists', 'public/assets/photography/profile-shadow-2649.webp missing');
  }
  record('Photography intro asset exists');

  if (!existsSync(join(root, 'public', 'assets', 'cv', 'jiaxin-li-cv.pdf'))) {
    fail('CV PDF asset exists', 'public/assets/cv/jiaxin-li-cv.pdf missing');
  }
  record('CV PDF asset exists');
};

const assertGeneratedOutput = () => {
  const htmlFiles = walkFiles(join(root, 'dist'), (path) => extname(path) === '.html');
  const generatedHtml = htmlFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

  if (generatedHtml.includes('>Untitled<')) {
    fail('No visible Untitled in generated HTML', '`>Untitled<` found');
  }
  record('No visible Untitled in generated HTML');

  const textFiles = [
    ...walkFiles(join(root, 'dist'), (path) => ['.html', '.js', '.css'].includes(extname(path))),
    ...walkFiles(join(root, 'src'), (path) => ['.astro', '.ts', '.md', '.mjs'].includes(extname(path))),
    ...walkFiles(join(root, 'public'), (path) => ['.html', '.js', '.css', '.md', '.json'].includes(extname(path)))
  ];
  const joined = textFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
  const stale = staleSlugs.filter((slug) => joined.includes(slug));

  if (stale.length > 0) {
    fail('No stale sample slugs', stale.join(', '));
  }
  record('No stale sample slugs');

  for (const route of routes) {
    const htmlPath = route === '/'
      ? join(root, 'dist', 'index.html')
      : join(root, 'dist', route.slice(1), 'index.html');
    if (!existsSync(htmlPath)) fail(`Static route exists ${route}`, htmlPath);
  }
  record('Required static routes exist');
};

const checkRoute = async (page, route, viewportName) => {
  const response = await page.goto(`${baseUrl}${route}`, {
    waitUntil: 'networkidle'
  });

  if (!response || !response.ok()) {
    fail(`${viewportName} ${route} returns HTTP 200`, response ? String(response.status()) : 'no response');
  }

  const h1Count = await page.locator('h1').count();
  if (h1Count < 1) fail(`${viewportName} ${route} has an h1`, 'no h1 found');

  const bodyText = await page.locator('body').innerText();
  if (/\bUntitled\b/.test(bodyText)) {
    fail(`${viewportName} ${route} hides Untitled titles`, 'visible body text contains Untitled');
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) fail(`${viewportName} ${route} has no horizontal overflow`, `${overflow}px overflow`);

  await page.evaluate(async () => {
    const step = Math.max(240, Math.floor(window.innerHeight / 2));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });

  const brokenImages = await page.locator('img').evaluateAll((images) =>
    images
      .filter((image) => !image.closest('dialog:not([open])'))
      .filter((image) => image.naturalWidth <= 0 || image.naturalHeight <= 0)
      .map((image) => image.getAttribute('src') || '')
  );
  if (brokenImages.length > 0) fail(`${viewportName} ${route} images load`, brokenImages.join(', '));

  const imageCount = await page.locator('img').count();
  if (imageRoutes.has(route) && imageCount < 1) {
    fail(`${viewportName} ${route} contains photography images`, 'no images found');
  }

  record(`${viewportName} ${route} route check`);
};

const checkCvPage = async (page) => {
  await page.goto(`${baseUrl}/cv/`, { waitUntil: 'networkidle' });

  const openHref = await page.locator('a', { hasText: 'Open PDF' }).getAttribute('href');
  const downloadHref = await page.locator('a', { hasText: 'Download PDF' }).getAttribute('href');
  if (openHref !== '/assets/cv/jiaxin-li-cv.pdf') fail('CV open link', String(openHref));
  if (downloadHref !== '/assets/cv/jiaxin-li-cv.pdf') fail('CV download link', String(downloadHref));
  if ((await page.locator('object[type="application/pdf"]').count()) !== 1) {
    fail('CV PDF preview object', 'missing PDF object');
  }

  record('CV PDF links and preview');
};

const checkPhotographyInteractions = async (page) => {
  await page.goto(`${baseUrl}/photography/`, { waitUntil: 'networkidle' });

  const selectedCount = await page.locator('section', { has: page.locator('#selected-works-title') }).locator('.photo-grid-item').count();
  const selectedExpected = expectedSelectedCount();
  if (selectedCount !== selectedExpected) fail(`Selected Works contains ${selectedExpected} photographs`, `${selectedCount} found`);

  await page.locator('[data-photography-theme-option="dark"]').click();
  const darkTheme = await page.locator('body').getAttribute('data-photography-theme');
  const bodyTheme = await page.locator('body').getAttribute('data-photography-theme');
  if (darkTheme !== 'dark' || bodyTheme !== 'dark') {
    fail('Photography dark theme toggle', `page=${darkTheme}, body=${bodyTheme}`);
  }
  const darkPressed = await page.locator('[data-photography-theme-option="dark"]').getAttribute('aria-pressed');
  if (darkPressed !== 'true') fail('Photography dark theme active state', String(darkPressed));

  await page.locator('[data-photography-lang-option="zh"]').click();
  const pageLanguage = await page.locator('body').getAttribute('data-photography-lang');
  const htmlLanguage = await page.locator('html').getAttribute('lang');
  const visibleTitle = await page.locator('#page-title').innerText();
  const visibleChinesePanelLanguage = await page.locator('[data-lang-panel="zh"]').getAttribute('lang');
  if (pageLanguage !== 'zh' || htmlLanguage !== 'en' || visibleChinesePanelLanguage !== 'zh-CN' || !visibleTitle.includes('摄影')) {
    fail('Photography Chinese language toggle', `page=${pageLanguage}, html=${htmlLanguage}, title=${visibleTitle}`);
  }
  const zhPressed = await page.locator('[data-photography-lang-option="zh"]').getAttribute('aria-pressed');
  if (zhPressed !== 'true') fail('Photography Chinese language active state', String(zhPressed));

  await page.goto(`${baseUrl}/photography/tags/`, { waitUntil: 'networkidle' });
  const tagsTheme = await page.locator('body').getAttribute('data-photography-theme');
  const tagsLanguage = await page.locator('body').getAttribute('data-photography-lang');
  const tagsTitle = await page.locator('#tags-title').innerText();
  const tagsResultCount = await page.locator('[data-tag-result-count]').innerText();
  if (tagsTheme !== 'dark' || tagsLanguage !== 'zh' || !tagsTitle.includes('摄影标签') || !tagsResultCount.includes('张照片')) {
    fail('Photography preferences persist to tag browser', `theme=${tagsTheme}, lang=${tagsLanguage}, title=${tagsTitle}, count=${tagsResultCount}`);
  }

  await page.goto(`${baseUrl}/photography/tags/location/zurich/`, { waitUntil: 'networkidle' });
  const tagDetailLanguage = await page.locator('body').getAttribute('data-photography-lang');
  const tagDetailCopy = await page.locator('.gallery-heading .section-copy').innerText();
  if (tagDetailLanguage !== 'zh' || !tagDetailCopy.includes('张照片')) {
    fail('Photography preferences persist to tag detail pages', `lang=${tagDetailLanguage}, copy=${tagDetailCopy}`);
  }

  await page.goto(`${baseUrl}/photography/`, { waitUntil: 'networkidle' });

  await page.locator('[data-photography-theme-option="light"]').click();
  await page.locator('[data-photography-lang-option="en"]').click();

  const instagramHref = await page.locator('a[href*="instagram.com"]').getAttribute('href');
  if (!instagramHref || !instagramHref.includes('egoista_li2003')) {
    fail('Instagram link', String(instagramHref));
  }

  const openButton = page.locator('[data-rednote-open]');
  await openButton.focus();
  await page.keyboard.press('Enter');
  const dialogOpen = await page.locator('[data-rednote-dialog]').evaluate((dialog) => dialog.hasAttribute('open'));
  if (!dialogOpen) fail('Rednote modal opens from keyboard', 'dialog is not open');

  await page.waitForFunction(() => {
    const image = document.querySelector('.rednote-card');

    return image instanceof HTMLImageElement && image.naturalWidth > 0;
  });

  await page.locator('[data-rednote-close]').focus();
  await page.keyboard.press('Enter');
  const dialogClosed = await page.locator('[data-rednote-dialog]').evaluate((dialog) => !dialog.hasAttribute('open'));
  if (!dialogClosed) fail('Rednote modal closes from keyboard', 'dialog is still open');

  const activeLabel = await page.evaluate(() => document.activeElement?.getAttribute('data-rednote-open'));
  if (activeLabel === null) fail('Rednote close returns focus', 'focus did not return to trigger');

  await page.keyboard.press('Tab');
  const focusTag = await page.evaluate(() => document.activeElement?.tagName);
  if (!['A', 'BUTTON'].includes(focusTag || '')) fail('Keyboard focus reaches controls', String(focusTag));

  record('Photography controls, social links, and Rednote modal');
};

const checkTagFilterSearch = async (page) => {
  await page.goto(`${baseUrl}/photography/tags/`, { waitUntil: 'networkidle' });
  const expectedCount = expectedPhotoCount();

  const visibleResults = page.locator('[data-tag-search-results] .photo-grid-item:not([hidden])');
  const visibleColumnCount = () =>
    visibleResults.evaluateAll(
      (items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().left))).size
    );
  if ((await visibleResults.count()) !== expectedCount) {
    fail('Tag search initially shows all photographs', `${await visibleResults.count()} found`);
  }

  await page.locator('input[name="location"][value="zurich"]').check();
  const zurichCount = await visibleResults.count();
  if (zurichCount <= 0 || zurichCount >= expectedCount) {
    fail('Tag search filters by Zurich', `${zurichCount} visible results`);
  }
  if ((await visibleColumnCount()) < 2) {
    fail('Tag search keeps masonry columns for Zurich', 'visible results collapsed to one column');
  }

  await page.locator('input[name="condition"][value="rain"]').check();
  const zurichRainCount = await visibleResults.count();
  const expectedZurichRainCount = expectedFilterCount({ location: 'zurich', condition: 'rain' });
  if (zurichRainCount !== expectedZurichRainCount) {
    fail('Tag search combines Zurich and Rain filters', `${zurichRainCount} visible results`);
  }

  await page.locator('[data-tag-filter-clear]').click();
  if ((await visibleResults.count()) !== expectedCount) {
    fail('Tag search clear resets results', `${await visibleResults.count()} visible results`);
  }

  await page.locator('input[name="condition"][value="night"]').check();
  if ((await visibleColumnCount()) < 2) {
    fail('Tag search keeps masonry columns for Night', 'visible results collapsed to one column');
  }

  await page.locator('[data-tag-filter-clear]').click();
  await page.locator('input[name="lens"][value="40mm-prime"]').check();
  if ((await visibleColumnCount()) < 2) {
    fail('Tag search keeps masonry columns for 40mm Prime', 'visible results collapsed to one column');
  }

  record('Photography tag filter search');
};

const writeReport = () => {
  const lines = [
    '# Release QA Report',
    '',
    `Generated: 2026-05-17`,
    '',
    '| Status | Check | Detail |',
    '| --- | --- | --- |',
    ...checks.map((check) => `| ${check.status} | ${check.name} | ${check.detail || ''} |`)
  ];

  writeFileSync(reportPath, `${lines.join('\n')}\n`);
};

let preview;
let browser;

try {
  assertStaticAssets();
  await run('npm', ['run', 'build']);
  assertGeneratedOutput();

  preview = await startPreview();
  browser = await chromium.launch();

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    for (const route of routes) {
      await checkRoute(page, route, viewport.name);
    }
    await page.close();
  }

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await checkCvPage(desktop);
  await checkPhotographyInteractions(desktop);
  await checkTagFilterSearch(desktop);
  await desktop.close();

  writeReport();
  console.log(`Release QA PASS: ${checks.length} checks. Report: ${reportPath}`);
} catch (error) {
  checks.push({
    status: 'FAIL',
    name: 'Release QA',
    detail: error instanceof Error ? error.message : String(error)
  });
  writeReport();
  throw error;
} finally {
  if (browser) await browser.close();
  if (preview) await stopPreview(preview);
}
