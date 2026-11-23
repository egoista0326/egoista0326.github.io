// Demo routing of the graph's nodes (owner 2026-11-22): a node is offered (clickable, drawn like any available node)
// when the node itself or one of its capability subsets is buildable from the current design; a click runs the node
// itself if buildable, else its first buildable subset in rankedSubsets order. The page always shows the clicked node
// (sim.worker.js maps the runner's state and events back to it); the runner logs the executed node and the clicked
// one as routed_from. Reason (owner): the translation an RTGL goal needs is a restriction of how the demo builds
// goals, not a limit of the policy (after GL into an enclosure MANO builds RGL but no RTGL / TGL).
//   capability subset   a node whose letters (R roll, T slide, G grasp switch, L relocation) are all letters of the
//                       clicked node; all 15 nodes are the non-empty letter sets of RTGL, so every subset is a node
//   rankedSubsets order the node itself, then the proper subsets: those keeping G first, then those keeping L, then
//                       more letters, then NODES order (fixed, no draw). RTGL: RGL TGL GL RTG RG TG G RTL RL TL L RT R T
// Pure functions; no random draw, so Random chain (which draws from the buildable nodes) and its Python parity are
// unchanged.

import { NODES } from '../engine/chain.js';

const hasAll = (node, letters) => [...letters].every((c) => node.includes(c));

/** The node and its proper capability subsets, in the order a click tries them (header). */
export function rankedSubsets(node) {
  if (!NODES.includes(node)) throw new Error(`unknown node ${node}`);
  // a subset that drops G or L only after every subset keeping them (lead 2026-11-22: a relocation click keeps L)
  const lost = (c, n) => (node.includes(c) && !n.includes(c) ? 1 : 0);
  const key = (n) => [lost('G', n), lost('L', n), -n.length, NODES.indexOf(n)];
  const lexical = (a, b) => {
    const ka = key(a), kb = key(b);
    for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k];
    return 0;
  };
  const proper = NODES.filter((n) => n !== node && hasAll(node, n)).sort(lexical);
  return [node, ...proper];
}

const RANKED = new Map(NODES.map((n) => [n, rankedSubsets(n)]));

/** The node a click on `node` runs: itself or its first buildable subset; null if none is buildable. */
export function route(node, buildable) {
  const open = new Set(buildable);
  return RANKED.get(node)?.find((n) => open.has(n)) ?? null;
}

/** The offered nodes (NODES order): every node that routes to a buildable one. */
export const offered = (buildable) => NODES.filter((n) => route(n, buildable) !== null);

/**
 * The page's view of a control step's runner events ({type, node, reason, routedFrom?}, chain.js): {type, node,
 * reason} where an event of a routed goal names its clicked node. running = {node, from}: the runner's node and
 * routedFrom when the step began; a 'goal' event installs the next goal, a 'restart' clears it.
 */
export function shownEvents(events, running) {
  return events.map(({ type, node, reason, routedFrom }) => {
    if (type === 'goal') running = { node, from: routedFrom ?? null };
    else if (type === 'restart') running = { node: null, from: null };
    return { type, node: running.from && node === running.node ? running.from : node, reason };
  });
}
