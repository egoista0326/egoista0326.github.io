// The demo's hands (owner 2026-11-22: MANO and Sharpa) as data, and the Sharpa hand's render meshes. No three.js and no
// DOM: the page, the worker and the Node tests import it.
//
// assets/hands.json (format "hands-v1") lists the hands in tab order; the first is the default. Per hand:
//   id     the URL and DOM name (?hand=<id>, body[data-hand]);
//   label  the tab text ("MANO", "Sharpa");
//   root   its asset root, relative to assets/, with the layout of assets/ (policy/actor_mlp.{json,bin},
//          world_facts.json, objects/{index,control}.json + objects/<id>/): MANO "./" (assets/ itself), Sharpa its own
//          folder. Changing a hand's assets (for example the final d40-rod Sharpa assets) is this one entry;
//   look   how the page draws the hand: "colliders" (its convex collider hulls as they are, the angular look; the
//          MANO skin in local SKIN builds) or "visual" (the hand's own render meshes, `visual`);
//   visual (look "visual") its render meshes, relative to assets/: visual.json + visual.bin of
//          tools/export_hand_visual.py;
//   minScale (optional) the follow camera's zoom-out floor, px per metre at the target (app/main.js FOLLOW.scale[0],
//          1350, without it). Sharpa 600: framed by its parts' boxes (a goal hand far from the hand needs a wider
//          view), at 1350 the hand or goal crossed the view's edge in 17-43 % of 0.1 s samples, at 600 in 0.7-1.8 %
//          (seeds 47 and 7, 40 s each, 800 x 474, 350 x 622, 390 x 844, 1440 x 900; README "Hand choice").
// The worker loads a hand's policy, objects, control and world facts from its root only when that hand is chosen, and
// the page fetches its object list and render meshes then too (nothing of Sharpa is requested before).

/**
 * Validate hands.json and resolve each root / visual against the assets URL.
 * @param {object} json the parsed file
 * @param {string} assetsUrl absolute URL of assets/ (ending in '/')
 * @returns {Array<{id: string, label: string, root: string, rootUrl: string, look: 'colliders' | 'visual',
 *   visualUrl: string | null}>} in tab order (the first is the default)
 */
export function resolveHands(json, assetsUrl) {
  if (json?.format !== 'hands-v1' || !Array.isArray(json.hands) || !json.hands.length) {
    throw new Error('hands.json: format hands-v1 with a non-empty "hands" list expected');
  }
  const seen = new Set();
  return json.hands.map((h) => {
    if (!h.id || !h.label || typeof h.root !== 'string' || seen.has(h.id)) throw new Error(`hands.json: bad entry ${JSON.stringify(h)}`);
    seen.add(h.id);
    if (!['colliders', 'visual'].includes(h.look) || (h.look === 'visual' && !h.visual)) {
      throw new Error(`hands.json: ${h.id}: look "colliders" or "visual" (with "visual") expected`);
    }
    const root = h.root.endsWith('/') ? h.root : `${h.root}/`;
    return { id: h.id, label: h.label, root, rootUrl: new URL(root, assetsUrl).href, look: h.look,
      visualUrl: h.look === 'visual' ? new URL(h.visual, assetsUrl).href : null, minScale: h.minScale ?? null };
  });
}

/**
 * The render meshes of visual.json + visual.bin (format hand-visual-v1): per mesh its vertices (Float32, m, link frame)
 * and triangles (Uint16 indices).
 * @param {object} header visual.json
 * @param {ArrayBuffer} buffer visual.bin
 * @returns {{parts: Array<{link: string, mesh: number, kind: string, origin: {p: number[], R: number[]}}>,
 *   meshes: Array<{name: string, position: Float32Array, index: Uint16Array}>}}
 */
export function decodeVisual(header, buffer) {
  if (header?.format !== 'hand-visual-v1') throw new Error('visual.json: format hand-visual-v1 expected');
  const meshes = header.meshes.map((m) => {
    const position = new Float32Array(buffer, m.position, 3 * m.vertices);
    const index = new Uint16Array(buffer, m.index, 3 * m.triangles);
    for (const i of index) if (i >= m.vertices) throw new Error(`visual.bin: ${m.name}: index ${i} out of range`);
    return { name: m.name, position, index };
  });
  for (const p of header.parts) if (!meshes[p.mesh]) throw new Error(`visual.json: part ${p.link}: no mesh ${p.mesh}`);
  return { parts: header.parts, meshes };
}

// rigid transforms {q (w x y z), t}
const qrot = (q, v) => {
  const [w, x, y, z] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const qmat = (q) => { // rotation matrix, row-major
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
};

/**
 * Where each render part sits on the hand's geoms: a part belongs to the body named by its link, and is posed from
 * that body's collider geom (whose world pose the worker sends every control step):
 *   part world = geom world * offset,  offset = inv(geom in its body) * origin (the part in the link frame).
 * @param {Array<{link: string, origin: {p: number[], R: number[]}}>} parts decodeVisual's parts
 * @param {Array<{isObject?: boolean, body?: string, local?: {p: number[], q: number[]}} | null>} geoms the worker's
 *   model geoms (a hand geom carries its body name and its frame in that body: geom_pos, geom_quat w x y z)
 * @returns {Array<{geom: number, offset: Float64Array}>} per part: the geom index and the offset as a column-major 4 x 4
 *   matrix (three.js Matrix4.elements order)
 */
export function partOffsets(parts, geoms) {
  const byBody = new Map();
  geoms.forEach((g, i) => {
    if (!g || g.isObject || !g.body || !g.local) return;
    if (!byBody.has(g.body)) byBody.set(g.body, i); // the first geom of a body
  });
  return parts.map((part) => {
    const g = byBody.get(part.link);
    if (g === undefined) throw new Error(`hand visual: no geom on body ${part.link}`);
    const { p, q } = geoms[g].local;
    const qi = [q[0], -q[1], -q[2], -q[3]];
    const Ri = qmat(qi), ti = qrot(qi, p).map((x) => -x); // inv(local): x -> Ri x + ti
    const R0 = part.origin.R, t0 = part.origin.p;
    const R = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[3 * r + c] += Ri[3 * r + k] * R0[3 * k + c];
    const t = [0, 1, 2].map((r) => Ri[3 * r] * t0[0] + Ri[3 * r + 1] * t0[1] + Ri[3 * r + 2] * t0[2] + ti[r]);
    const offset = Float64Array.from([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1]);
    return { geom: g, offset };
  });
}
