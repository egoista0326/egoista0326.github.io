// The \emph helpers of src/lib/tex.ts: the italic subset of /dexgo/ is built from emphasisText.
// Run: node --test tests/unit/   (Node 22 strips the TypeScript types on import.)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emphasisText, texInline } from '../../src/lib/tex.ts';

test('emphasisText joins the text of every \\emph{...} and nothing else', () => {
  assert.equal(emphasisText('we study \\emph{grasp transition} and \\emph{relocation}.'), 'grasp transitionrelocation');
  assert.equal(emphasisText('no emphasis, $x$ only'), '');
});

test('texInline sets \\emph{...} as <em>, escaped, outside the math', () => {
  assert.equal(texInline('a \\emph{b & c} d'), 'a <em>b &amp; c</em> d');
});
