// Tag filter matching, query state and faceted option counts (src/lib/photographyTagFilter.ts).
// Run: node --test tests/unit/   (Node 22 strips the TypeScript types on import.)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countTagOptions,
  photoMatchesTagFilters,
  readTagFilters,
  tagContextQuery,
  writeTagFilters
} from '../../src/lib/photographyTagFilter.ts';

const groups = ['location', 'camera', 'lens', 'condition'];

const photo = (location, camera, conditions) => ({ location: [location], camera: [camera], lens: [], condition: conditions });

const photos = [
  photo('zurich', 'nikon', ['clear', 'night']),
  photo('zurich', 'nikon', ['clear']),
  photo('zurich', 'ricoh', ['snow']),
  photo('bern', 'nikon', ['rain', 'night']),
  photo('paris', 'iphone', ['rain'])
];

const filters = (entries) => new Map(entries);
const matching = (selected) => photos.filter((tags) => photoMatchesTagFilters(tags, selected));

test('no filters match every photo', () => {
  assert.equal(matching(filters([])).length, photos.length);
});

test('values of one ordinary group match any (OR)', () => {
  assert.equal(matching(filters([['location', ['zurich', 'bern']]])).length, 4);
  assert.equal(matching(filters([['camera', ['ricoh', 'iphone']]])).length, 2);
});

test('condition values must all match (AND)', () => {
  assert.equal(matching(filters([['condition', ['clear']]])).length, 2);
  assert.deepEqual(matching(filters([['condition', ['clear', 'night']]])), [photos[0]]);
  assert.equal(matching(filters([['condition', ['rain', 'snow']]])).length, 0);
});

test('different groups combine with AND', () => {
  assert.equal(matching(filters([['location', ['zurich']], ['condition', ['rain']]])).length, 0);
  assert.equal(matching(filters([['location', ['zurich', 'bern']], ['condition', ['night']]])).length, 2);
});

test('query read/write round trip', () => {
  const query = 'location=zurich&location=bern&condition=rain';
  const read = readTagFilters(new URLSearchParams(query), groups);

  assert.deepEqual([...read], [
    ['location', ['zurich', 'bern']],
    ['condition', ['rain']]
  ]);
  assert.equal(writeTagFilters(read), query);
  assert.deepEqual([...readTagFilters(new URLSearchParams(writeTagFilters(read)), groups)], [...read]);
  assert.equal(tagContextQuery(read), `from=tags&${query}`);
  assert.equal(tagContextQuery(new Map()), 'from=tags');
});

test('unknown params, empty and repeated values are ignored', () => {
  const read = readTagFilters(
    new URLSearchParams('from=tags&utm_source=x&colour=red&location=&location=zurich&location=zurich'),
    groups
  );

  assert.deepEqual([...read], [['location', ['zurich']]]);
});

test('option counts without filters are the plain tag counts', () => {
  const counts = countTagOptions(photos, new Map());

  assert.equal(counts.get('location').get('zurich'), 3);
  assert.equal(counts.get('camera').get('nikon'), 3);
  assert.equal(counts.get('condition').get('rain'), 2);
  assert.equal(counts.get('lens')?.size ?? 0, 0);
});

test('option counts of an any-value group ignore that group\'s own selection', () => {
  const counts = countTagOptions(photos, filters([['location', ['zurich']]]));

  // Other locations keep their own count: ticking one adds those photos.
  assert.equal(counts.get('location').get('zurich'), 3);
  assert.equal(counts.get('location').get('bern'), 1);
  assert.equal(counts.get('location').get('paris'), 1);
  // Other groups count within Zurich.
  assert.equal(counts.get('camera').get('nikon'), 2);
  assert.equal(counts.get('camera').get('iphone'), undefined);
  assert.equal(counts.get('condition').get('clear'), 2);
  assert.equal(counts.get('condition').get('rain'), undefined);
});

test('option counts of the all-values group (condition) narrow with the selection', () => {
  const counts = countTagOptions(photos, filters([['condition', ['clear']]]));

  assert.equal(counts.get('condition').get('clear'), 2);
  assert.equal(counts.get('condition').get('night'), 1);
  assert.equal(counts.get('condition').get('rain'), undefined);
  assert.equal(counts.get('location').get('zurich'), 2);
  assert.equal(counts.get('location').get('bern'), undefined);
});

test('each option count equals the result size after ticking it', () => {
  const selections = [
    filters([]),
    filters([['location', ['zurich']]]),
    filters([['location', ['zurich', 'bern']], ['condition', ['night']]]),
    filters([['camera', ['nikon']], ['condition', ['clear']]])
  ];

  for (const selected of selections) {
    const counts = countTagOptions(photos, selected);

    for (const group of groups) {
      for (const value of new Set(photos.flatMap((tags) => tags[group]))) {
        const isAllValues = group === 'condition';
        const own = selected.get(group) ?? [];
        // Ticking only this value in an any-value group; adding it in the all-values group.
        const next = new Map(selected);
        next.set(group, isAllValues ? [...new Set([...own, value])] : [value]);

        assert.equal(
          counts.get(group)?.get(value) ?? 0,
          matching(next).length,
          `${group}=${value} with ${writeTagFilters(selected) || 'no filters'}`
        );
      }
    }
  }
});
