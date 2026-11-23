// The 15-node prerequisite graph of the DexGO tasks as an inline SVG, drawn as in the project video and page
// (uniassemble-talk/web/ref/README.md section 3, still v26_graph_t72s.png): rows RTGL / RTG RTL RGL TGL /
// RT RG RL TG TL GL / R T G L, each task linked to its prerequisites (the tasks with one capability fewer), the four
// capability names under the bottom row, thin lines, rounded rectangles.
// Node looks (fill / outline / letters), the project video's palette (uniassemble-talk/video/c/make_showcase.py), as
// on the project page's graph:
//   current task   #438F87 / #438F87 / #FFFFFF   (ticker "current" chip)
//   available next #E3EEEA / #438F87 / #438F87   (graph "learned")
//   not available  #FFFFFF / #B5B9BF dashed / #9AA0A6   (graph "locked")
//   queued         available look + a dashed teal ring (the page's prerequisite ring)
// Letter contrast (13.2 px bold): white on teal 3.8:1, teal on the light teal 3.2:1 (the video's own chips); the task
// being reached is also written out in full in the status line above the graph.
// Edges take the colour of their lower node: #8FBDB6 when it is available or current, #C2C6CB otherwise.
// Changes between available and not available fade over 0.3 s, the outline's dashes too (no white box with a solid
// outline): during the fade the solid outline is the dash pattern "5 0" (class is-dash), so the gaps open and close
// with the colours; settled, it has no dash pattern ("5 0" draws the line as dashes, with a slightly different edge
// anti-aliasing). A node becomes or stops being the current task at once (no in-between teal that the legend does not
// show; the reached task is named by the page's status line).
// Text in the page's Source Sans 3 (bold letters). Sizes (viewBox units, 420 wide) are set for the narrowest graph of
// each geometry: the regular one at 300 px (the page's 800 px frame) draws node letters at 13.2 px and the capability
// names at 12.1 px; the compact one at 326 px (the 350 px phone frame) 13.2 and 12.4 px.
// Keyboard and pointer: all 15 nodes are buttons with one roving tab stop (the graph is one Tab stop: the last focused
// node, else the first available one); arrow keys move along a row (Left / Right) and between rows (Up / Down, to the
// nearest node). Available nodes call onSelect(node) on a click, Enter or Space, in both modes (the page switches a
// Random chain to Manual on a click); the others are aria-disabled: a click, Enter or Space on them chooses nothing
// and shows a short fading brown outline. A state change never touches the focused node's tab stop. Each node has a
// transparent hit area 7 units taller above and below (about 34 px tall on the phone graph; rows stay apart). Hover
// rings only on devices that hover; the focus ring is solid, 2 px in the page's ink.
// Two geometries: regular (the video's proportions) and compact (rows closer, for stacked phone-frame layouts).

const SVG = 'http://www.w3.org/2000/svg';

/** The 15 tasks, rows top to bottom. */
export const ROWS = [['RTGL'], ['RTG', 'RTL', 'RGL', 'TGL'], ['RT', 'RG', 'RL', 'TG', 'TL', 'GL'], ['R', 'T', 'G', 'L']];

/** Capability words of each letter in a task of two or more (the project page's ticker words) and the names under
 *  the bottom row (also the words of a single task: T -> "in-hand translation"). */
export const CAPABILITY = { R: 'reorientation', T: 'translation', G: 'grasp type change', L: 'relocation' };
export const CAPABILITY_NAME = {
  R: ['In-hand', 'reorientation'], T: ['In-hand', 'translation'], G: ['Grasp type', 'change'], L: ['Object', 'relocation'],
};

/** Words of one task, lowercase as on the project page: T -> "in-hand translation" (the full capability name, as
 *  under the graph), RL -> "reorientation and relocation", RTGL -> "all four capabilities". */
export function taskWords(node) {
  if (node.length === 4) return 'all four capabilities';
  if (node.length === 1) return CAPABILITY_NAME[node].join(' ').toLowerCase();
  const words = [...node].map((l) => CAPABILITY[l]); // page style: "a and b", "a, b and c"
  return words.length < 2 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Prerequisites of a task: the tasks with one capability fewer. */
export const prerequisites = (node) => (node.length < 2 ? []
  : [...node].map((_, i) => node.slice(0, i) + node.slice(i + 1)));

// layout in viewBox units (1 unit = 1 CSS px at 420 px width)
const W = 420, TOP = 5;
const ROW_W = [112, 88, 58, 88]; // node width per row
const GEOMETRY = {
  regular: { nodeH: 34, pitch: 74, letters: 18.5, label: 17, labelLine: 19 }, // 13.2 / 12.1 px at 300 px
  compact: { nodeH: 30, pitch: 50, letters: 17, label: 16, labelLine: 17 }, // 13.2 / 12.4 px at 326 px
};

const COLORS = {
  accent: '#438F87', learnedFill: '#E3EEEA', edge: '#8FBDB6', lockedOutline: '#B5B9BF', lockedText: '#9AA0A6',
  lockedEdge: '#C2C6CB', label: '#5F6368',
  focus: '#367A73', // the page's ink (its 2 px focus rings)
  refused: '#A0523B', // the page's "in training" brown (a failed goal's note)
};
const REFUSED_MS = 600; // the outline of a click, Enter or Space on a node that cannot be chosen
const DASH_FADE_MS = 400; // a node's dash fade (0.3 s transition) ends: its solid outline drops the "5 0" pattern

const CSS = `
.tg-svg { display: block; width: 100%; height: auto; overflow: visible; user-select: none; -webkit-user-select: none; }
.tg-svg text { font-family: "Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif; }
.tg-node rect.tg-box { fill: #fff; stroke: ${COLORS.lockedOutline}; stroke-width: 1.3;
  transition: fill 0.3s ease, stroke 0.3s ease, stroke-dasharray 0.3s ease; }
.tg-node text { font-weight: 700; fill: ${COLORS.lockedText}; text-anchor: middle;
  dominant-baseline: central; transition: fill 0.3s ease; pointer-events: none; }
.tg-node[data-state="unavailable"] rect.tg-box { stroke-dasharray: 5 3.5; }
.tg-node.is-dash:not([data-state="unavailable"]) rect.tg-box { stroke-dasharray: 5 0; }
.tg-node[data-state="available"] rect.tg-box { fill: ${COLORS.learnedFill}; stroke: ${COLORS.accent}; }
.tg-node[data-state="available"] text { fill: ${COLORS.accent}; }
.tg-node[data-state="current"] rect.tg-box { fill: ${COLORS.accent}; stroke: ${COLORS.accent}; }
.tg-node[data-state="current"] text { fill: #fff; }
.tg-node.is-instant rect.tg-box, .tg-node.is-instant text { transition: none; }
.tg-node rect.tg-hit { fill: transparent; stroke: none; pointer-events: all; }
.tg-node rect.tg-ring { fill: none; stroke: ${COLORS.accent}; stroke-width: 1.6; opacity: 0;
  transition: opacity 0.15s ease; pointer-events: none; }
.tg-node.is-queued rect.tg-ring { opacity: 1; stroke-dasharray: 4 3; }
.tg-node.is-selectable { cursor: pointer; }
@media (hover: hover) {
  .tg-node.is-selectable:hover rect.tg-ring { opacity: 1; stroke-dasharray: none; }
}
.tg-node:focus { outline: none; }
.tg-node:focus-visible rect.tg-ring { stroke: ${COLORS.focus}; stroke-width: 2.8; opacity: 1; stroke-dasharray: none; }
.tg-node.is-refused rect.tg-ring { stroke: ${COLORS.refused}; stroke-width: 2.8; stroke-dasharray: none;
  animation: tg-refused ${REFUSED_MS}ms ease-out var(--tg-refuse-hold, 0ms) both; }
@keyframes tg-refused { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .tg-node.is-refused rect.tg-ring { animation: none; opacity: 1; } }
.tg-edge { stroke: ${COLORS.lockedEdge}; stroke-width: 1; fill: none; transition: stroke 0.3s ease; }
.tg-edge.is-active { stroke: ${COLORS.edge}; }
.tg-label { fill: ${COLORS.label}; text-anchor: middle; }
@media (prefers-reduced-motion: reduce) { .tg-node rect, .tg-node text, .tg-edge { transition: none; } }
`;

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

/** Node rectangles {x, y, w, h} in viewBox units. */
function layout(g) {
  const rects = {};
  ROWS.forEach((row, r) => {
    const pitch = W / row.length, w = ROW_W[r];
    row.forEach((node, i) => { rects[node] = { x: pitch * (i + 0.5) - w / 2, y: TOP + r * g.pitch, w, h: g.nodeH }; });
  });
  return rects;
}

export class TaskGraph {
  /**
   * @param {HTMLElement} container the graph is appended to it
   * @param {{onSelect?: (node: string) => void, compact?: boolean}} [options] onSelect: called when a selectable node
   *   is chosen; compact: the compact geometry
   */
  constructor(container, { onSelect = () => {}, compact = false } = {}) {
    this.onSelect = onSelect;
    this.container = container;
    this.state = { current: null, available: [], queued: null, selectable: false };
    this.rover = ROWS[0][0]; // the node holding the graph's tab stop (tabindex 0)
    this.dashTimers = new Map(); // node element -> the timer that ends its dash fade (is-dash; set)
    this.focused = null; // the node the viewer focused last (keeps the tab stop), or null
    // the arrow keys, named to screen readers only (each node's description; no visible text in the demo)
    this.keys = document.createElement('span');
    this.keys.id = 'tg-keys';
    this.keys.className = 'visually-hidden';
    this.keys.textContent = 'Arrow keys move between tasks.';
    container.append(this.keys);
    this.build(compact);
  }

  /** Switch between the regular and the compact geometry (rebuilds the SVG, keeps the state and the focus). */
  setCompact(compact) {
    if (compact === this.compact) return;
    const hadFocus = this.svg.contains(document.activeElement);
    this.svg.remove();
    this.build(compact);
    this.set(this.state);
    if (hadFocus) this.nodes[this.rover].focus();
  }

  build(compact) {
    this.compact = compact;
    const g = GEOMETRY[compact ? 'compact' : 'regular'];
    const labelY = TOP + 3 * g.pitch + g.nodeH + g.label + 3;
    this.rects = layout(g);
    this.svg = el('svg', { class: 'tg-svg', viewBox: `0 0 ${W} ${labelY + g.labelLine + 4}`, role: 'group',
      'aria-label': 'Prerequisite graph of the 15 tasks' });
    el('style', {}, this.svg).textContent = CSS;
    const edges = el('g', {}, this.svg), nodes = el('g', {}, this.svg);
    this.edges = [];
    for (const upper of ROWS.flat()) {
      for (const lower of prerequisites(upper)) {
        const a = this.rects[upper], b = this.rects[lower];
        const line = el('line', { class: 'tg-edge', x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y }, edges);
        this.edges.push({ upper, lower, line });
      }
    }
    this.nodes = {};
    for (const [node, r] of Object.entries(this.rects)) {
      const n = el('g', { class: 'tg-node', 'data-node': node, 'data-state': 'unavailable', role: 'button',
        tabindex: node === this.rover ? 0 : -1, 'aria-disabled': 'true', 'aria-describedby': this.keys.id }, nodes);
      el('rect', { class: 'tg-hit', x: r.x - 3, y: r.y - 7, width: r.w + 6, height: r.h + 14 }, n);
      el('rect', { class: 'tg-ring', x: r.x - 3.5, y: r.y - 3.5, width: r.w + 7, height: r.h + 7, rx: 6 }, n);
      el('rect', { class: 'tg-box', x: r.x, y: r.y, width: r.w, height: r.h, rx: 4 }, n);
      el('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 + 0.5, 'font-size': g.letters }, n).textContent = node;
      el('title', {}, n).textContent = `${node}: ${taskWords(node)}`;
      n.addEventListener('click', () => this.choose(node));
      n.addEventListener('focus', () => {
        this.focused = node;
        this.setRover(node);
      });
      n.addEventListener('keydown', (e) => this.onKey(e, node));
      this.nodes[node] = n;
    }
    for (const node of ROWS[3]) {
      const r = this.rects[node];
      const t = el('text', { class: 'tg-label', x: r.x + r.w / 2, y: labelY, 'font-size': g.label }, this.svg);
      CAPABILITY_NAME[node].forEach((line, i) => {
        el('tspan', { x: r.x + r.w / 2, dy: i ? g.labelLine : 0 }, t).textContent = line;
      });
    }
    this.container.prepend(this.svg);
    this.key = '';
  }

  /** A click or Enter / Space on a node: select it if it can be chosen; else nothing is chosen and a short brown
   *  outline answers (pointer and keyboard alike; the node is aria-disabled). */
  choose(node) {
    if (this.nodes[node].classList.contains('is-selectable')) this.onSelect(node);
    else this.refuse(node);
  }

  /** The short brown outline of a node that cannot be chosen (also when a queued task is no longer available): it
   *  appears after `delay` ms, stays at full opacity for `hold` ms, then fades in REFUSED_MS (under reduced motion it
   *  stays at full opacity for hold + REFUSED_MS, no fade). A new call replaces a pending or running outline. */
  refuse(node, { delay = 0, hold = 0 } = {}) {
    const n = this.nodes[node];
    clearTimeout(n.refusedStart);
    clearTimeout(n.refusedTimer);
    const show = () => {
      n.classList.remove('is-refused');
      n.getBBox(); // restart the outline's animation on a repeated click
      n.style.setProperty('--tg-refuse-hold', `${hold}ms`);
      n.classList.add('is-refused');
      n.refusedTimer = setTimeout(() => n.classList.remove('is-refused'), hold + REFUSED_MS);
    };
    if (delay > 0) n.refusedStart = setTimeout(show, delay);
    else show();
  }

  /** Keys on a focused node: Enter / Space choose it; arrows move the focus (and the tab stop) through the graph. */
  onKey(e, node) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space would scroll the page
      this.choose(node);
      return;
    }
    const r = ROWS.findIndex((row) => row.includes(node)), i = ROWS[r].indexOf(node);
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      next = ROWS[r][i + (e.key === 'ArrowLeft' ? -1 : 1)] ?? null;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const row = ROWS[r + (e.key === 'ArrowUp' ? -1 : 1)];
      if (row) { // the nearest node of the next row by its centre
        const x = this.rects[node].x + this.rects[node].w / 2;
        const dist = (m) => Math.abs(this.rects[m].x + this.rects[m].w / 2 - x);
        next = row.reduce((best, m) => (dist(m) < dist(best) ? m : best));
      }
    } else {
      return;
    }
    e.preventDefault(); // arrows never scroll the page from the graph
    if (next) this.nodes[next].focus(); // its focus handler moves the tab stop
  }

  /** Give the graph's single tab stop to one node. */
  setRover(node) {
    if (node === this.rover && this.nodes[node].getAttribute('tabindex') === '0') return;
    this.nodes[this.rover]?.setAttribute('tabindex', '-1');
    this.rover = node;
    this.nodes[node].setAttribute('tabindex', '0');
  }

  /**
   * Show one state.
   * @param {object} s
   * @param {string|null} s.current the task being reached (filled teal), or null
   * @param {string[]} s.available tasks available as the next goal
   * @param {string|null} [s.queued] the task queued as the next goal (dashed ring)
   * @param {boolean} [s.selectable] available nodes are buttons
   */
  set({ current = null, available = [], queued = null, selectable = false }) {
    this.state = { current, available, queued, selectable };
    const key = JSON.stringify([current, available, queued, selectable]);
    if (key === this.key) return; // unchanged: no DOM writes at 20 Hz
    this.key = key;
    const open = new Set(available);
    const state = (node) => (node === current ? 'current' : open.has(node) ? 'available' : 'unavailable');
    // between available and not available the outline's dashes fade with the colours: the node takes the dash
    // pattern "5 0" for the fade (is-dash, CSS); a node leaving available takes it before its state changes (one
    // style flush), so the transition starts from "5 0", not from no pattern (which does not interpolate)
    const fades = Object.entries(this.nodes).filter(([node, g]) => g.dataset.state !== state(node)
      && g.dataset.state !== 'current' && state(node) !== 'current').map(([, g]) => g);
    for (const g of fades) {
      clearTimeout(this.dashTimers.get(g));
      g.classList.add('is-dash');
      this.dashTimers.set(g, setTimeout(() => g.classList.remove('is-dash'), DASH_FADE_MS));
    }
    const leaving = fades.find((g) => g.dataset.state === 'available');
    if (leaving) void getComputedStyle(leaving.querySelector('rect.tg-box')).strokeDasharray; // the style flush
    for (const [node, g] of Object.entries(this.nodes)) {
      const st = state(node), pick = selectable && open.has(node), was = g.dataset.state;
      // into or out of the current task: at once (the fade would show a teal the legend does not have)
      g.classList.toggle('is-instant', (was === 'current') !== (st === 'current'));
      g.dataset.state = st;
      g.classList.toggle('is-queued', node === queued);
      g.classList.toggle('is-selectable', pick);
      g.setAttribute('aria-disabled', String(!pick));
      // the running task is named as such, also where it can be picked again (clicks work at any time)
      const words = `${node}: ${taskWords(node)}`;
      g.setAttribute('aria-label', st === 'current' ? `Current task ${words}`
        : pick ? `Next task ${words}${node === queued ? ' (queued)' : ''}` : words);
    }
    for (const { lower, line } of this.edges) line.classList.toggle('is-active', state(lower) !== 'unavailable');
    // the tab stop: the node the viewer focused last; before any focus, the first available node (reading order)
    if (!this.focused) {
      const first = ROWS.flat().find((node) => open.has(node));
      if (first) this.setRover(first);
    }
  }
}
