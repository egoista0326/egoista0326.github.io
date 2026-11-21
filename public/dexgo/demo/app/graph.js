// The 15-node prerequisite graph of the DexGO tasks as an inline SVG, drawn as in the project video and page
// (uniassemble-talk/web/ref/README.md section 3, still v26_graph_t72s.png): rows RTGL / RTG RTL RGL TGL /
// RT RG RL TG TL GL / R T G L, each task linked to its prerequisites (the tasks with one capability fewer), the four
// capability names under the bottom row, thin lines, rounded rectangles.
// Node looks (fill / outline / letters), taken from the video's graph and ticker:
//   current task   #438F87 / #438F87 / #FFFFFF   (ticker "current" chip)
//   available next #E3EEEA / #438F87 / #438F87   (graph "learned")
//   not available  #FFFFFF / #B5B9BF / #9AA0A6   (graph "locked", solid outline here)
//   queued         available look + a dashed teal ring (the page's prerequisite ring)
// Edges take the colour of their lower node: #8FBDB6 when it is available or current, #C2C6CB otherwise.
// Every change fades over 0.3 s. Text in the page's Source Sans 3 (bold letters); at the phone frame's 366 px the
// compact geometry keeps node letters and capability names at 12 px or more.
// In manual mode, available nodes are buttons (click, Enter or Space) that call onSelect(node).
// Two geometries: regular (the video's proportions) and compact (rows closer, for stacked phone-frame layouts).

const SVG = 'http://www.w3.org/2000/svg';

/** The 15 tasks, rows top to bottom. */
export const ROWS = [['RTGL'], ['RTG', 'RTL', 'RGL', 'TGL'], ['RT', 'RG', 'RL', 'TG', 'TL', 'GL'], ['R', 'T', 'G', 'L']];

/** Capability words of each letter (the project page's ticker words) and the names under the bottom row. */
export const CAPABILITY = { R: 'reorientation', T: 'translation', G: 'grasp type change', L: 'relocation' };
export const CAPABILITY_NAME = {
  R: ['In-hand', 'reorientation'], T: ['In-hand', 'translation'], G: ['Grasp type', 'change'], L: ['Object', 'relocation'],
};

/** Words of one task, lowercase as on the project page: RL -> "reorientation + relocation", RTGL -> "all four
 *  capabilities". */
export function taskWords(node) {
  if (node.length === 4) return 'all four capabilities';
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
  regular: { nodeH: 32, pitch: 74, letters: 15, label: 12, labelLine: 14 },
  compact: { nodeH: 28, pitch: 50, letters: 15, label: 14, labelLine: 14.5 }, // 13.1 / 12.2 px at 366 px
};

const COLORS = {
  accent: '#438F87', learnedFill: '#E3EEEA', edge: '#8FBDB6', lockedOutline: '#B5B9BF', lockedText: '#9AA0A6',
  lockedEdge: '#C2C6CB', label: '#5F6368',
};

const CSS = `
.tg-svg { display: block; width: 100%; height: auto; overflow: visible; user-select: none; -webkit-user-select: none; }
.tg-svg text { font-family: "Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif; }
.tg-node rect.tg-box { fill: #fff; stroke: ${COLORS.lockedOutline}; stroke-width: 1.3;
  transition: fill 0.3s ease, stroke 0.3s ease; }
.tg-node text { font-weight: 700; fill: ${COLORS.lockedText}; text-anchor: middle;
  dominant-baseline: central; transition: fill 0.3s ease; pointer-events: none; }
.tg-node[data-state="available"] rect.tg-box { fill: ${COLORS.learnedFill}; stroke: ${COLORS.accent}; }
.tg-node[data-state="available"] text { fill: ${COLORS.accent}; }
.tg-node[data-state="current"] rect.tg-box { fill: ${COLORS.accent}; stroke: ${COLORS.accent}; }
.tg-node[data-state="current"] text { fill: #fff; }
.tg-node rect.tg-ring { fill: none; stroke: ${COLORS.accent}; stroke-width: 1.6; opacity: 0;
  transition: opacity 0.15s ease; pointer-events: none; }
.tg-node.is-queued rect.tg-ring { opacity: 1; stroke-dasharray: 4 3; }
.tg-node.is-selectable { cursor: pointer; }
.tg-node.is-selectable:hover rect.tg-ring, .tg-node.is-selectable:focus-visible rect.tg-ring { opacity: 1; stroke-dasharray: none; }
.tg-node:focus { outline: none; }
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
   * @param {{onSelect?: (node: string) => void}} [options] called when a selectable node is chosen
   */
  constructor(container, { onSelect = () => {}, compact = false } = {}) {
    this.onSelect = onSelect;
    this.container = container;
    this.state = { current: null, available: [], queued: null, selectable: false };
    this.build(compact);
  }

  /** Switch between the regular and the compact geometry (rebuilds the SVG, keeps the state). */
  setCompact(compact) {
    if (compact === this.compact) return;
    this.svg.remove();
    this.build(compact);
    this.set(this.state);
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
      const n = el('g', { class: 'tg-node', 'data-node': node, 'data-state': 'unavailable' }, nodes);
      el('rect', { class: 'tg-ring', x: r.x - 3.5, y: r.y - 3.5, width: r.w + 7, height: r.h + 7, rx: 6 }, n);
      el('rect', { class: 'tg-box', x: r.x, y: r.y, width: r.w, height: r.h, rx: 4 }, n);
      el('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 + 0.5, 'font-size': g.letters }, n).textContent = node;
      el('title', {}, n).textContent = `${node}: ${taskWords(node)}`;
      n.addEventListener('click', () => { if (n.classList.contains('is-selectable')) this.onSelect(node); });
      n.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && n.classList.contains('is-selectable')) {
          e.preventDefault();
          this.onSelect(node);
        }
      });
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

  /**
   * Show one state.
   * @param {object} s
   * @param {string|null} s.current the task being reached (filled teal), or null
   * @param {string[]} s.available tasks available as the next goal
   * @param {string|null} [s.queued] the task queued as the next goal (dashed ring)
   * @param {boolean} [s.selectable] available nodes are buttons (manual mode)
   */
  set({ current = null, available = [], queued = null, selectable = false }) {
    this.state = { current, available, queued, selectable };
    const key = JSON.stringify([current, available, queued, selectable]);
    if (key === this.key) return; // unchanged: no DOM writes at 20 Hz
    this.key = key;
    const open = new Set(available);
    const state = (node) => (node === current ? 'current' : open.has(node) ? 'available' : 'unavailable');
    for (const [node, g] of Object.entries(this.nodes)) {
      const st = state(node), pick = selectable && open.has(node);
      g.dataset.state = st;
      g.classList.toggle('is-queued', node === queued);
      g.classList.toggle('is-selectable', pick);
      if (pick) {
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', `Next task ${node}: ${taskWords(node)}${node === queued ? ' (queued)' : ''}`);
      } else {
        g.removeAttribute('role');
        g.removeAttribute('tabindex');
        g.setAttribute('aria-label', `${node}: ${taskWords(node)}${st === 'current' ? ' (current task)' : ''}`);
      }
    }
    for (const { lower, line } of this.edges) line.classList.toggle('is-active', state(lower) !== 'unavailable');
  }
}
