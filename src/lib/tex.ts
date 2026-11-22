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

/** `\emph{...}` (as in the paper's source, no nested braces) set as <em>. Input is escaped HTML. */
const emphasis = (html: string): string => html.replace(/\\emph\{([^{}]*)\}/g, '<em>$1</em>');

/** The text inside every `\emph{...}` of `text`, concatenated: the characters an italic face must cover. */
export const emphasisText = (text: string): string =>
  [...text.matchAll(/\\emph\{([^{}]*)\}/g)].map((match) => match[1]).join('');

/**
 * Text with inline math between `$...$` and `\emph{...}` outside it, returned as HTML; hyphenated compounds stay on
 * one line.
 */
export const texInline = (text: string): string =>
  text
    .split('$')
    .map((part, index) =>
      index % 2 === 1 ? katex.renderToString(part, { throwOnError: true }) : keepCompounds(emphasis(escapeHtml(part)))
    )
    .join('');

/** One display formula, returned as HTML. */
export const texDisplay = (tex: string): string =>
  katex.renderToString(tex, { displayMode: true, throwOnError: true });
