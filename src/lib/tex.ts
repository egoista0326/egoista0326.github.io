// Build-time TeX rendering with KaTeX (the page ships HTML + katex.min.css, no math script).
import katex from 'katex';

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Hyphenated compounds (in-hand, single-capability) wrapped so a line never breaks at their hyphen; a plain
 * hyphen-minus is kept, since the page fonts have no non-breaking hyphen (U+2011) glyph. Input is escaped HTML.
 */
export const keepCompounds = (html: string): string =>
  html.replace(/[A-Za-z]+(?:-[A-Za-z]+)+/g, (word) => `<span class="dx-nobr">${word}</span>`);

/** Text with inline math between `$...$`, returned as HTML; hyphenated compounds stay on one line. */
export const texInline = (text: string): string =>
  text
    .split('$')
    .map((part, index) =>
      index % 2 === 1 ? katex.renderToString(part, { throwOnError: true }) : keepCompounds(escapeHtml(part))
    )
    .join('');

/** One display formula, returned as HTML. */
export const texDisplay = (tex: string): string =>
  katex.renderToString(tex, { displayMode: true, throwOnError: true });
