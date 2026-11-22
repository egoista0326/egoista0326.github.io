// English year-month dates of the photography pages (src/lib/dates.ts).
// Run: node --test tests/unit/   (Node 22 strips the TypeScript types on import.)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatYearMonthEn } from '../../src/lib/dates.ts';

test('"YYYY.M" reads as an English month and year', () => {
  assert.equal(formatYearMonthEn('2025.6'), 'Jun 2025');
  assert.equal(formatYearMonthEn('2026.1'), 'Jan 2026');
  assert.equal(formatYearMonthEn('2026.12'), 'Dec 2026');
});

test('anything else is left as written', () => {
  for (const text of ['2026', '2026.13', '2026.0', 'June 2025', '']) assert.equal(formatYearMonthEn(text), text);
});
