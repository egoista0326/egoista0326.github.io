// The worker's draw stream (engine/chain.js makeRng interface) with a replaceable source, for the curated opening
// (lead default 2026-11-22): the project page starts the demo with ?seed=47 (the posters' scene), the worker keeps that
// seed for the first goals of the run and then re-seeds from crypto.getRandomValues, so the opening is the same on every
// visit and the chain after it differs. Generator and ChainRunner hold this object; reseed() swaps what it draws from.

import { makeRng } from '../engine/chain.js';

/** A fresh 32-bit seed from the platform's cryptographic generator (browsers, workers, Node >= 19). */
export function cryptoSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

/**
 * makeRng(seed) behind a stable object: the five draw methods of engine/chain.js (and random) go to the current
 * source; reseed(seed) replaces the source with makeRng(seed).
 * @param {number} seed
 */
export function reseedableRng(seed) {
  let source = makeRng(seed);
  return {
    get seed() { return source.seed; },
    random: () => source.random(),
    integers: (n) => source.integers(n),
    uniform: (lo, hi) => source.uniform(lo, hi),
    normal: (n) => source.normal(n),
    permutation: (array) => source.permutation(array),
    choice: (array) => source.choice(array),
    reseed(next) { source = makeRng(next); },
  };
}
