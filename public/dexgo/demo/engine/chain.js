// Long-horizon chains: the goal generator and the chain state machine of ../scripts/chain_mujoco.py, line by line
// (class Generator, start_state, run_chain), on the slim record tables of ../scripts/export_chain_web.py
// (assets/objects/<id>/chain.json). Pure JS; the physics and the policy are an engine/loop.js Episode.
//
// Names (the Python ones):
//   record     one cached grasp of a family (E_n enclosure, T_b pinch at the +Y end, E_r reversed enclosure, T_s pinch
//              at the -Y end): relation C = (c_p, c_r), the object in the wrist frame (m, rotation), and the fingers
//              q_B* (nF, rad); pd (nF, rad) its finger PD target (start rule; E_n and E_r only)
//   design     the current designed goal state (family f, record i, wrist goal H* = (hP, hR), world); each node
//              builds the next design from it, never from the measured state
//   goal       engine/loop.js makeGoal(hP, hR, c_p, c_r, q_B*): wrist goal H*, object goal G* = H* C*, finger
//              reference q_B*; the fields the viewer ghost reads (wristP / wristR, objectP / objectR, fingerRef)
//   node       R roll, T slide, G grasp switch (E_n <-> T_b, with er also E_r <-> T_b, with ts also E_n / E_r <->
//              T_s), RT / RG / TG / RTG composites, L relocation; a name ending in L adds a relocation (new wrist
//              goal near home); nodes without L keep H*
//   latch      the demo gate (15 mm / 15 deg on object goal and relation, 0.05 m/s, 1 rad/s) held 3 control steps
//
// Options (chain_mujoco.py "Options", 2026-11-21; all off = v2 exactly; index.json "options" per object, mapped by
// generatorOptions(entry)):
//   er                 E_r as a third family: from T_b one integers draw over the E_n and E_r partners (E_n first);
//                      E_r <-> T_b switches; E_r has the enclosure ops (rolls, slides, sr, srs); starts from E_n or
//                      E_r (one integers draw over n(E_n) + n(E_r)); nearest over E_n, T_b, E_r
//   erStart            (er) false: E_n starts only;  erInhand (er) false: no roll / slide from E_r
//   variety            magnitudes drawn (one permutation, the first one the table has): R rolls ROLL_VARIETY[90] deg,
//                      the roll of RG ROLL_VARIETY[60], slides of T / TG SLIDE_VARIETY cm (RT, RTG keep their keys);
//                      sign rule: a roll (slide) tries the sign of the chain's most recent roll (slide) first
//                      (Generator.last, set by remember(info) when a node is chosen, reset at each chain start);
//                      with none yet, the sign order is a permutation draw
//   varietyComposites  (variety) false: drawn magnitudes only in R and T; RG rolls 60, TG slides 5 / 4 / 3 (v2
//                      order, one sign order for all three); the sign rule everywhere
//   switchTryKeys      (option D, chain_mujoco --switch-try-keys, 2026-11-22) in RG / TG / RTG (and their L
//                      versions) built op-then-switch (RG: roll 60 then switch; TG / RTG from an enclosure: slide /
//                      srs then switch), the op walks its keys in its usual order (magnitudes, sign rule or drawn
//                      signs; each draw made when the walk reaches it, as Python's generator expressions) and takes
//                      the first whose landed record has a switch partner (hasPartner), else the first key the
//                      table has (the default). Its info gets switch_try = {key, default, differed, partner}. The
//                      switch-then-op orders are unchanged. Off: the draws of the options above exactly
//   ts                 (chain_mujoco --ts, 2026-11-22, owner: grasp changes at both rod ends; a chain-table-v3 table with
//                      T_s) T_s, the pinch at the rod's -Y end, as a 4th family beside T_b (the pinch at the +Y end).
//                      From an enclosure (E_n, or E_r with er) a switch is one integers draw over the joined partner
//                      lists, T_b partners first ('switch'), then T_s partners ('switch_T_s'); the target family is the
//                      list the partner came from. From T_s exactly as from T_b ('switch' = its E_n partners; with er
//                      one integers draw over 'switch' then 'switch_E_r'; without er choice over 'switch').
//                      hasPartner counts an enclosure's T_s partners, so switchTryKeys (D) does too. T_s has the
//                      pinch ops (rolls only); TG / RTG from T_s switch first, as from T_b. nearest runs over E_n,
//                      T_b (, E_r), T_s (T_s last: ties keep the earlier order). Starts unchanged. Off: no T_s, no
//                      extra draw
// Diagnostics (chain_mujoco's, no draw): a switch's info has switch_pair = [from family, record, to family, record];
// a log entry has from_family, available_nodes (the buildable nodes, GENERATOR_ORDER), g_available (some node with G
// among them) and available_try (those whose op key differed from the default under D). Options B (switch_near) and
// C (er_share) of chain_mujoco.py are not ported (not shipped), nor their diagnostic available_near.
//
// Hands (2026-11-22, Sharpa port): the generator is hand-agnostic. The finger width nF of a record comes from the
// table (q length / n: MANO 20, Sharpa 22), and the start wrist palm_up (the reset root rotation, = the home wrist)
// is the Generator option palmUp: index.json "options" "palm_up" (chain_mujoco.Generator keyword palm_up =
// PALM_UPS[hand]); without it MANO's PALM_UP. Sharpa: [[0, 0, -1], [0, 1, 0], [1, 0, 0]] = MANO palm_up x
// bench_goals.SHARPA_TO_MANO, the same physical pose in the Sharpa wrist frame.
//
// API
//   NODES                 the 15 node names in display order (the viewer's); GENERATOR_ORDER: chain_mujoco.NODES,
//                         the order the generator iterates and draws in (the twin needs it)
//   SETTINGS              chain_mujoco.py's constants (relocation range, DWELL 10 steps, TIMEOUT 600 steps = 30 s,
//                         recovery 20 mm / 20 deg, ...); index.json "settings" holds the Python values
//   makeRng(seed)         seeded PRNG (xoshiro128**). The draw interface every random choice goes through:
//                           integers(n) -> int in [0, n); uniform(lo, hi); normal(n) -> n standard normals;
//                           permutation(array) -> new shuffled array; choice(array) -> one element.
//                         Any object with these five methods can be injected (tests replay Python's draws).
//   ROLL_VARIETY, SLIDE_VARIETY   the variety magnitudes (deg by requested roll 90 / 60; cm), chain_mujoco's
//   decodeTable(json)     chain.json -> typed arrays (integer / scale, the same doubles Python decodes)
//   generatorOptions(entry)  Generator options of an index.json object entry: {nodes, er, variety, erStart,
//                         erInhand, varietyComposites, switchTryKeys, ts, palmUp} from its "nodes" and "options"
//                         (er_start, er_inhand, variety_composites, switch_try_keys, ts, palm_up); a missing option
//                         takes the v2 default (ts false; palm_up: MANO's PALM_UP)
//   new Generator(table, facts, rng, {nodes, er, variety, erStart, erInhand, varietyComposites, switchTryKeys, ts,
//                 palmUp})
//                         twin of chain_mujoco.Generator (defaults = v2: er false, variety false, erStart true,
//                         erInhand true, varietyComposites true, switchTryKeys false, ts false). table: chain.json (raw or
//                         decoded); facts: world_facts.json;
//                         nodes: the allowed node set (index.json "nodes"), iterated in GENERATOR_ORDER. Methods
//                         (Python name): rec, op (_op), roll, slide, slideRoll (slide_roll), switch, chain, inHand
//                         (in_hand), relocation, build, nearest, candidates, remember, hasPartner (has_partner),
//                         _first; field last = {roll, slide} ('+' | '-' | null, the sign rule's memory). A built
//                         design is {family, record, hP, hR, info}; info as Python's dict (roll_deg, slide_m, switch,
//                         switch_pair, switch_try, wrist_step_m, wrist_turn_deg).
//   startState(gen, i, family = 'E_n')   twin of start_state: {handRoot (13), objectRoot (13), q (6 + nF), target
//                         (6 + nF)} of record i of a start family (E_n, E_r): hand root at the reset root with the
//                         palm_up wrist (gen.rootR), wrist joints 0
//   surfaceGap(s, surfaceLocal)   smallest hand surface link to object surface sample distance (m) of a state;
//                         dropped(s, surfaceLocal) = surfaceGap > DROP_DISTANCE_M (the runner's drop rule)
//   new ChainRunner({episode, generator, rng, mode = 'random' | 'manual', onFailure = 'restart' | 'end',
//                    maxNodes = Infinity, recover = true, dwell, timeout})
//     restart()           fresh start grasp from a random E_n record (one integers draw), or with er (erStart) from
//                         an E_n or E_r record (one integers draw over both); resets the sign memory
//                         (Generator.last). Installs the hold goal of the start design; random mode then installs
//                         the first node's goal; manual mode holds (phase 'idle') and waits for queue(). Returns the
//                         events.
//     await step()        one control step (Episode.step, then the state machine); resolves to an array of events
//                         (possibly empty), each {type, ...}:
//                           'goal'    {node, index, goal, family, record, info, routedFrom}  a node's goal is
//                                     installed; index = its 0-based position in the current chain; routedFrom =
//                                     the node the page shows for it (queue's routedFrom), else null
//                           'latch'   {node, t, step}  t = latch time (s) since the goal was installed
//                           'done'    {node, goalsDone}  DWELL steps after the latch
//                           'timeout' {node}  no latch within TIMEOUT steps;  'drop' {node}  the training drop rule
//                                     (dropped below, 2026-11-22): every hand surface link farther than
//                                     DROP_DISTANCE_M (0.02 m) from the object's surface samples on the state after
//                                     the control step; checked in every phase (reach, dwell, idle) after 'done'
//                           'recover' {family, record, mm, deg, goal}  after a timeout: the record nearest the
//                                     measured grasp is within 20 mm / 20 deg; the chain continues from it with the
//                                     measured wrist as H* (goal = its hold goal; at most 2 recoveries in a row)
//                           'restart' {goal, family, record, reason, previous}  a fresh start (onFailure
//                                     'restart', or restart() itself); family / record = the start record; goal =
//                                     the hold goal; previous = result() of the chain that ended, null if it had no
//                                     step
//                           'end'     {reason, result}  'timeout' | 'drop' | 'no node available' |
//                                     'max nodes reached' (onFailure 'end', or maxNodes)
//                         After 'done' (or 'recover') random mode draws the next node at once ('goal' in the same
//                         array). Manual mode installs the queued node; with nothing queued it keeps the current
//                         goal installed (phase 'idle') and keeps stepping the policy (a drop still fails).
//     available()         node names buildable from the current design (Generator.candidates, one draw each, cached
//                         per design; the chosen node uses its cached goal). Calling it before a goal completes
//                         draws earlier than run_chain does: only matters when replaying Python's draws.
//     queue(node, routedFrom = null)   manual mode: the next node; ignored (returns false) unless in available().
//                         routedFrom (app/routing.js, the demo's routing): the node the viewer clicked when `node` is
//                         the buildable subset that runs for it; kept with the goal (state.routedFrom, the 'goal'
//                         event) and logged as routed_from; no draw
//     setMode(mode)       'random' | 'manual'; an idle runner switched to random draws a node at its next step
//     get state           {node, phase: 'reach' | 'dwell' | 'idle' | 'ended', goalsDone, goal, stepInGoal, queued,
//                          queuedFrom, routedFrom, family, record, attempts, timeoutsInRow, chainSteps, mode}; node /
//                          queued are the executed (queued) nodes, routedFrom / queuedFrom their clicked nodes or null
//     result()            the current chain in run_chain's return format {start_family, start_record, nodes_done,
//                         timeouts, end, sim_s, log} (log entries as Python's: node, family, record, result, latch_s,
//                         final_goal_mm, final_goal_deg, available, from_family (the design's family the node was
//                         built from), available_nodes, g_available, available_try, info..., recovered_to, and
//                         routed_from (the clicked node) only for a routed goal; a 'no node available' entry: node
//                         null, result, from_family ... available_try)
// The Episode the runner drives: resetTo({handRoot, objectRoot, q, target}), setGoal(goal), await step(), and the
// fields s (state; the drop rule reads s.objP, s.objR, s.links), errors (gate errors of the installed goal),
// surfaceLocal (the object-frame surface samples), task.control.gate, policyDt.
//
// Drop rule (2026-11-22, drop_bug/FIX.md; replaces "relation position error > 0.15 m against the goal just
// installed", which failed held objects at the first step of a goal whose designed relation lies > 0.15 m away: the
// Sharpa thumb-side switches): the training termination of both v7 actors (rod line rewards/common.py object_dropped,
// tasks/keyframe.py, drop_distance 0.02): the object counts as dropped when EVERY hand surface link origin (the 20
// links of control.json "surface_links", the encoder's) is farther than DROP_DISTANCE_M from the nearest of the
// object's surface samples (the encoder's grasp_samples; encoder.js nearestSurfaceVectors). Hand-agnostic: each hand
// brings its own links. It never compares the object with a goal, so a goal change cannot fire it; no random draw.

import { nearestSurfaceVectors } from './encoder.js';
import { Gate, makeGoal } from './loop.js';
import {
  add3, matmul, matmulT, matrixToQuatXyzw, matTmul, mulTVec, mulVec, quatWxyzToMatrix, rotationAngle, sub3,
} from './math.js';

export const NODES = ['R', 'T', 'G', 'L', 'RT', 'RG', 'RL', 'TG', 'TL', 'GL', 'RTG', 'RTL', 'RGL', 'TGL', 'RTGL'];
const INHAND = ['R', 'T', 'G', 'RT', 'RG', 'TG', 'RTG'];
export const GENERATOR_ORDER = [...INHAND, ...INHAND.map((n) => n + 'L'), 'L'];

export const SETTINGS = Object.freeze({
  RELOC_XY: 0.10, RELOC_Z: 0.04, // m: the wrist goal within this box around home
  STEP_M: [0.05, 0.14], // m: wrist step from the previous wrist goal
  HOME_TURN_DEG: 35.0, TURN_DEG: [15.0, 60.0], // wrist rotation within 35 deg of home, 15-60 deg from the previous
  PITCH_DEG: 65.0, // |sin y| of the wrist joint chain (R_root^T R*)[0, 2] <= sin(65 deg)
  MAX_TURN_DEG: 120.0, MAX_OBJECT_STEP_M: 0.6, RELOCATION_TRIES: 200, // v7's checks (bench_goals._motion)
  DWELL: 10, TIMEOUT: 600, // control steps (0.5 s, 30 s)
  RECOVER_MM: 20.0, RECOVER_DEG: 20.0, RECOVERIES_IN_ROW: 2,
  DROP_DISTANCE_M: 0.02, // m: every hand surface link farther than this from the object: dropped (training's drop_distance)
});
export const START_FAMILY = 'E_n'; // the default family of startState (the only start family without er)
/** chain_mujoco.ROLL_VARIETY (deg, by the requested roll: R 90, the roll of RG 60) and SLIDE_VARIETY (cm). */
export const ROLL_VARIETY = Object.freeze({ 90: Object.freeze([45, 60, 75, 90, 120]), 60: Object.freeze([45, 60, 75, 90]) });
export const SLIDE_VARIETY = Object.freeze([2, 3, 4, 5]);
/** bench_goals.MANO_WRISTS palm_up (row-major), the reset root rotation of a MANO chain start (the default; another
 * hand passes its own through the Generator option palmUp, index.json "options" "palm_up"). */
export const PALM_UP = Object.freeze([1, 0, 0, 0, 0, 1, 0, -1, 0]);

const S = SETTINGS;
const radians = (d) => d * (Math.PI / 180);
const degrees = (r) => r * (180 / Math.PI);
const norm = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
/** Python round(x, n) (exact ties aside). */
const pyRound = (x, n) => Number(x.toFixed(n));

// ------------------------------------------------------------------------------------------------ PRNG
const rotl = (v, k) => (v << k) | (v >>> (32 - k));

/** Seeded PRNG (xoshiro128**, seeded by splitmix32) with the draw interface of the generator and the runner. */
export function makeRng(seed = 1) {
  let x = seed >>> 0;
  const splitmix = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let s0 = splitmix(), s1 = splitmix(), s2 = splitmix(), s3 = splitmix();
  const next32 = () => {
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
    return r;
  };
  const random = () => ((next32() >>> 5) * 67108864 + (next32() >>> 6)) / 9007199254740992; // [0, 1), 53 bits
  let spare = null;
  const gauss = () => { // Box-Muller, the second value kept for the next call
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0;
    while (u === 0) u = random();
    const r = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * random();
    spare = r * Math.sin(a);
    return r * Math.cos(a);
  };
  const integers = (n) => Math.floor(random() * n);
  return {
    seed,
    random,
    integers,
    uniform: (lo, hi) => lo + (hi - lo) * random(),
    normal: (n) => Array.from({ length: n }, gauss),
    permutation: (array) => {
      const a = Array.from(array);
      for (let i = a.length - 1; i > 0; i--) {
        const j = integers(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    choice: (array) => array[integers(array.length)],
  };
}

// ------------------------------------------------------------------------------------------------ table
/**
 * chain.json -> {<family>: {n, nF, cP (3n), cR (9n), q (nF n), pd (nF n) | null, ops: {key: {next, slide, roll}}, switch,
 * switch_E_r (T_b / T_s, else null), switch_T_s (E_n / E_r of a table with T_s, else null)}}.
 * Every value is integer / scale (export_chain_web.decode_table does the same divisions); the rotation is the
 * quaternion normalized, then mju_quat2Mat's formula.
 */
export function decodeTable(table) {
  if (table.decoded) return table;
  const sc = table.scale, families = {};
  for (const [f, e] of Object.entries(table.families)) {
    const n = e.n;
    const cP = Float64Array.from(e.c_p, (v) => v / sc.c_p);
    const cR = new Float64Array(9 * n);
    for (let k = 0; k < n; k++) {
      const w = e.c_q[4 * k] / sc.c_q, x = e.c_q[4 * k + 1] / sc.c_q;
      const y = e.c_q[4 * k + 2] / sc.c_q, z = e.c_q[4 * k + 3] / sc.c_q;
      const s = Math.sqrt(w * w + x * x + y * y + z * z);
      cR.set(quatWxyzToMatrix([w / s, x / s, y / s, z / s]), 9 * k);
    }
    const q = Float64Array.from(e.q, (v) => v / sc.q);
    const pd = e.pd_dq ? Float64Array.from(e.pd_dq, (d, k) => (e.q[k] + d) / sc.pd) : null;
    const ops = {};
    for (const [key, o] of Object.entries(e.ops)) {
      ops[key] = { next: Int32Array.from(o.next), slide: Float64Array.from(o.slide, (v) => v / sc.slide),
        roll: Float64Array.from(o.roll, (v) => v / sc.roll) };
    }
    const nF = q.length / n; // fingers per record (MANO 20, Sharpa 22)
    if (!Number.isInteger(nF)) throw new Error(`chain.json ${f}: ${q.length} finger values for ${n} records`);
    // a (m): the record's fingertip-cluster centre on the rod's own +Y (object frame; the hands-on editor's position
    // along the rod; editor_feasibility/scripts/export_axial.py), null in a table without it
    const a = e.a ? Float64Array.from(e.a, (v) => v / sc.a) : null;
    families[f] = { n, nF, cP, cR, q, pd, ops, a, switch: e.switch, switch_E_r: e.switch_E_r ?? null,
      switch_T_s: e.switch_T_s ?? null };
  }
  return { decoded: true, objectId: table.object_id, rod: table.rod, startFamilies: table.start_families, families };
}

/** Generator options of an index.json object entry ("nodes", "options" with Python names; v2 defaults). */
export function generatorOptions(entry) {
  const o = entry.options ?? {};
  return { nodes: entry.nodes, er: o.er ?? false, variety: o.variety ?? false, erStart: o.er_start ?? true,
    erInhand: o.er_inhand ?? true, varietyComposites: o.variety_composites ?? true,
    switchTryKeys: o.switch_try_keys ?? false, ts: o.ts ?? false, palmUp: o.palm_up ? o.palm_up.flat() : PALM_UP };
}

// ------------------------------------------------------------------------------------------------ generator
/** Rotation about axis by angle (rad): chain_mujoco.rot, same operation order. */
export function rot(axis, angle) {
  const n = norm(axis);
  const x = axis[0] / n, y = axis[1] / n, z = axis[2] / n;
  const k = [0, -z, y, z, 0, -x, -y, x, 0];
  const s = Math.sin(angle), c = 1 - Math.cos(angle);
  const ck = k.map((v) => c * v);
  const ckk = matmul(ck, k); // ((1 - cos) * k) @ k, as Python evaluates (1 - cos) * k @ k
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return Float64Array.from(I, (v, i) => v + s * k[i] + ckk[i]);
}

/** MuJoCo quaternion (w, x, y, z) of a rotation (chain_mujoco.quat_wxyz; the sign may differ, the rotation not). */
export function quatWxyz(r) {
  const q = matrixToQuatXyzw(r);
  return [q[3], q[0], q[1], q[2]];
}

export class Generator {
  /**
   * @param {object} table chain.json (raw or decodeTable output)
   * @param {object} facts world_facts.json: box_low / box_high (m, the object goal's keyframe box), root_position
   * @param {object} rng the draw interface (makeRng or an injected replay)
   * @param {{nodes?: string[], er?: boolean, variety?: boolean, erStart?: boolean, erInhand?: boolean,
   *   varietyComposites?: boolean, switchTryKeys?: boolean, ts?: boolean, palmUp?: ArrayLike<number>}} [options]
   *   allowed nodes
   *   (index.json "nodes"; iterated in GENERATOR_ORDER), the generator options (header; defaults = v2) and the start
   *   wrist palmUp (9, row-major; default MANO's PALM_UP)
   */
  constructor(table, facts, rng, { nodes, er = false, variety = false, erStart = true, erInhand = true,
    varietyComposites = true, switchTryKeys = false, ts = false, palmUp = PALM_UP } = {}) {
    this.table = decodeTable(table);
    this.fam = this.table.families;
    this.rng = rng;
    const allowed = new Set(nodes ?? GENERATOR_ORDER);
    this.nodes = GENERATOR_ORDER.filter((n) => allowed.has(n));
    this.er = er;
    this.variety = variety;
    this.erStart = er && erStart;
    this.erInhand = erInhand;
    this.ts = ts; // T_s, the pinch at the -Y end: appended last (nearest's tie order kept)
    if (ts && !this.fam.T_s) throw new Error('option ts needs a chain table with T_s records (chain-table-v3)');
    this.fams = [...(er ? ['E_n', 'T_b', 'E_r'] : ['E_n', 'T_b']), ...(ts ? ['T_s'] : [])];
    this.pinches = ts ? ['T_b', 'T_s'] : ['T_b'];
    this.slideFams = er ? ['E_n', 'E_r'] : ['E_n'];
    this.varietyComposites = varietyComposites;
    this.switchTryKeys = switchTryKeys; // option D
    this.last = { roll: null, slide: null };
    this.boxLow = Float64Array.from(facts.box_low);
    this.boxHigh = Float64Array.from(facts.box_high);
    this.rootP = Float64Array.from(facts.root_position);
    this.rootR = Float64Array.from(palmUp); // the hand's start wrist (chain_mujoco PALM_UPS[hand])
    this.homeP = Float64Array.from(this.rootP); // wrist joints 0: wrist = root
    this.homeR = Float64Array.from(palmUp);
  }

  /** {cP, cR, q, pd} of record i of family f (views into the table; pd null outside the start families). */
  rec(f, i) {
    const t = this.fam[f], w = t.nF;
    return { cP: t.cP.subarray(3 * i, 3 * i + 3), cR: t.cR.subarray(9 * i, 9 * i + 9),
      q: t.q.subarray(w * i, w * i + w), pd: t.pd ? t.pd.subarray(w * i, w * i + w) : null };
  }

  /** _op: [next record, realized slide m, realized roll deg] of a transition, the partner list of 'switch' /
   * 'switch_E_r' / 'switch_T_s', or null. */
  op(f, i, key) {
    const t = this.fam[f];
    if (key === 'switch' || key === 'switch_E_r' || key === 'switch_T_s') {
      const ps = t[key]?.[i];
      return ps && ps.length ? ps : null;
    }
    const o = t.ops[key];
    if (!o || o.next[i] < 0) return null;
    return [o.next[i], o.slide[i], o.roll[i]];
  }

  _inBox(g) {
    for (let a = 0; a < 3; a++) if (!(g[a] >= this.boxLow[a] && g[a] <= this.boxHigh[a])) return false;
    return true;
  }

  _inhandOk(f) {
    return !(this.er && f === 'E_r' && !this.erInhand);
  }

  /** Sign order of a roll / slide (variety): the chain's most recent sign first; drawn when there is none. */
  _signs(kind) {
    const last = this.last[kind];
    if (last === null) return this.rng.permutation(['+', '-']);
    return [last, last === '+' ? '-' : '+'];
  }

  /** After a node is chosen: its roll / slide signs for the sign rule (variety). */
  remember(info) {
    if (this.variety) {
      if ('roll_deg' in info) this.last.roll = info.roll_deg > 0 ? '+' : '-';
      if ('slide_m' in info) this.last.slide = info.slide_m > 0 ? '+' : '-';
    }
  }

  /**
   * {family, record, info} of the first key of keys (an iterable; a generator makes its draws as it is walked) that
   * the table has, info = fields(transition); null if none (chain_mujoco Generator._first). Option D: with want
   * (f, record) -> boolean, the first key whose landed record satisfies it (walking further keys and their draws),
   * else the first the table has (the default); info then gets switch_try = {key, default, differed, partner (want
   * met)}.
   */
  _first(f, i, keys, fields, want = null) {
    let def = null;
    for (const key of keys) {
      const t = this.op(f, i, key);
      if (t === null) continue;
      if (want === null) return { family: f, record: t[0], info: fields(t) };
      if (def === null) def = [key, t];
      if (want(f, t[0])) {
        return { family: f, record: t[0],
          info: { ...fields(t), switch_try: { key, default: def[0], differed: key !== def[0], partner: true } } };
      }
    }
    if (def === null) return null;
    const [key, t] = def;
    return { family: f, record: t[0],
      info: { ...fields(t), switch_try: { key, default: key, differed: false, partner: false } } };
  }

  roll(f, i, deg, want = null) {
    if (!this._inhandOk(f)) return null;
    let keys;
    if (this.variety) {
      const mags = deg === 90 || this.varietyComposites ? this.rng.permutation(ROLL_VARIETY[deg]) : [deg];
      const signs = this._signs('roll');
      keys = mags.flatMap((d) => signs.map((s) => `roll${s}${d}`));
    } else {
      keys = this.rng.permutation(['+', '-']).map((s) => `roll${s}${deg}`);
    }
    return this._first(f, i, keys, (t) => ({ roll_deg: t[2] }), want);
  }

  slide(f, i, composite = false, want = null) {
    if (!this.slideFams.includes(f) || !this._inhandOk(f)) return null;
    let keys;
    if (this.variety) {
      const mags = composite && !this.varietyComposites ? [5, 4, 3] : this.rng.permutation(SLIDE_VARIETY);
      const signs = this._signs('slide');
      keys = mags.flatMap((cm) => signs.map((s) => `slide${s}${cm}`));
    } else { // one sign draw per magnitude, made only when the walk reaches that magnitude
      const rng = this.rng;
      keys = (function* walk() {
        for (const cm of [5, 4, 3]) for (const s of rng.permutation(['+', '-'])) yield `slide${s}${cm}`;
      })();
    }
    return this._first(f, i, keys, (t) => ({ slide_m: t[1] }), want);
  }

  slideRoll(f, i, small = false, want = null) {
    if (!this.slideFams.includes(f) || !this._inhandOk(f)) return null;
    const p = small ? 'srs' : 'sr';
    let keys;
    if (this.variety) { // Python [p + a + b for a in _signs('slide') for b in _signs('roll')]: roll signs per a
      keys = [];
      for (const a of this._signs('slide')) for (const b of this._signs('roll')) keys.push(p + a + b);
    } else {
      keys = this.rng.permutation([p + '++', p + '+-', p + '-+', p + '--']);
    }
    return this._first(f, i, keys, (t) => ({ slide_m: t[1], roll_deg: t[2] }), want);
  }

  /** Record i of family f has a switch partner (a pinch under er: in E_n or in E_r; an enclosure under ts: in T_b
   * or in T_s) (has_partner). */
  hasPartner(f, i) {
    if (this.er && this.pinches.includes(f)) return this.op(f, i, 'switch') !== null || this.op(f, i, 'switch_E_r') !== null;
    if (this.ts && !this.pinches.includes(f)) return this.op(f, i, 'switch') !== null || this.op(f, i, 'switch_T_s') !== null;
    return this.op(f, i, 'switch') !== null;
  }

  /** {family, record, info} of a switch to a random partner; info.switch_pair = the table pair used. */
  switch(f, i) {
    let to, rec;
    if (this.er && this.pinches.includes(f)) { // partners in E_n and E_r: one draw over both lists
      const both = [...(this.op(f, i, 'switch') ?? []).map((p) => ['E_n', p]),
        ...(this.op(f, i, 'switch_E_r') ?? []).map((p) => ['E_r', p])];
      if (!both.length) return null;
      [to, rec] = both[Number(this.rng.integers(both.length))];
    } else if (this.ts && !this.pinches.includes(f)) { // ts: an enclosure's T_b and T_s partners, one draw over both
      const both = [...(this.op(f, i, 'switch') ?? []).map((p) => ['T_b', p]),
        ...(this.op(f, i, 'switch_T_s') ?? []).map((p) => ['T_s', p])];
      if (!both.length) return null;
      [to, rec] = both[Number(this.rng.integers(both.length))];
    } else {
      const ps = this.op(f, i, 'switch');
      if (!ps) return null;
      to = f === 'E_n' || f === 'E_r' ? 'T_b' : 'E_n';
      rec = this.rng.choice(ps);
    }
    rec = Number(rec);
    return { family: to, record: rec, info: { switch: `${f}->${to}`, switch_pair: [f, Number(i), to, rec] } };
  }

  chain(f, i, ops) {
    const info = {};
    for (const op of ops) {
      const out = op(f, i);
      if (out === null) return null;
      f = out.family;
      i = out.record;
      Object.assign(info, out.info);
    }
    return { family: f, record: i, info };
  }

  /** {family, record, info} of the in-hand part of node (no L), null if not buildable. */
  inHand(node, f, i) {
    // D: an op before the switch walks its keys for a landed record with a partner (want); after it, as before
    const want = this.switchTryKeys ? (f2, i2) => this.hasPartner(f2, i2) : null;
    const roll = (deg, w = null) => (f2, i2) => this.roll(f2, i2, deg, w);
    const sw = (f2, i2) => this.switch(f2, i2);
    const sl = (w = null) => (f2, i2) => this.slide(f2, i2, true, w);
    const smallSr = (w = null) => (f2, i2) => this.slideRoll(f2, i2, true, w);
    const slideFirst = this.slideFams.includes(f);
    if (node === 'R') return this.roll(f, i, 90);
    if (node === 'T') return this.slide(f, i);
    if (node === 'RT') return this.slideRoll(f, i);
    if (node === 'G') return this.switch(f, i);
    const orders = {
      RG: [[roll(60, want), sw], [sw, roll(60)]],
      TG: slideFirst ? [[sl(want), sw]] : [[sw, sl()]],
      RTG: slideFirst ? [[smallSr(want), sw]] : [[sw, smallSr()]],
    }[node];
    if (!orders) throw new Error(`unknown node ${node}`);
    for (const ops of orders) {
      const out = this.chain(f, i, ops);
      if (out !== null) return out;
    }
    return null;
  }

  /** A wrist goal {hP, hR, info} near home, STEP_M from (hP, hR) and TURN_DEG from hR, passing v7's checks. */
  relocation(hP, hR, cP, tries = S.RELOCATION_TRIES) {
    const rng = this.rng;
    for (let t = 0; t < tries; t++) {
      const u = [rng.uniform(-S.RELOC_XY, S.RELOC_XY), rng.uniform(-S.RELOC_XY, S.RELOC_XY),
        rng.uniform(-S.RELOC_Z, S.RELOC_Z)];
      const p = add3(this.homeP, u);
      const step = norm(sub3(p, hP));
      if (!(S.STEP_M[0] <= step && step <= S.STEP_M[1])) continue;
      const a = rng.normal(3);
      const r = matmul(rot(a, radians(rng.uniform(0, S.HOME_TURN_DEG))), this.homeR);
      const turn = degrees(rotationAngle(matmulT(r, hR)));
      if (!(S.TURN_DEG[0] <= turn && turn <= S.TURN_DEG[1])) continue;
      const sinY = Math.abs(matTmul(this.rootR, r)[2]);
      const g = add3(p, mulVec(r, cP));
      const d = sub3(g, add3(hP, mulVec(hR, cP)));
      if (sinY <= Math.sin(radians(S.PITCH_DEG)) && turn <= S.MAX_TURN_DEG && norm(d) <= S.MAX_OBJECT_STEP_M
        && this._inBox(g)) {
        return { hP: p, hR: r, info: { wrist_step_m: pyRound(step, 3), wrist_turn_deg: pyRound(turn, 1) } };
      }
    }
    return null;
  }

  /** Next design {family, record, hP, hR, info} of node from the current one, or null. */
  build(node, f, i, hP, hR) {
    let f2, i2, info;
    if (node === 'L') {
      f2 = f; i2 = i; info = {};
    } else {
      const out = this.inHand(node.replace(/L+$/, ''), f, i);
      if (out === null) return null;
      ({ family: f2, record: i2, info } = out);
    }
    const { cP } = this.rec(f2, i2);
    if (node.endsWith('L')) {
      const reloc = this.relocation(hP, hR, cP);
      if (reloc === null) return null;
      hP = reloc.hP;
      hR = reloc.hR;
      Object.assign(info, reloc.info);
    }
    const g = add3(hP, mulVec(hR, cP));
    if (!this._inBox(g)) return null;
    return { family: f2, record: i2, hP: Float64Array.from(hP), hR: Float64Array.from(hR), info };
  }

  /** {family, record, mm, deg} of the record nearest the measured relation (cP m, cR row-major), by the score
   * mm / RECOVER_MM + deg / RECOVER_DEG over the generator's families (first minimum; the earlier family of
   * E_n, T_b, E_r, T_s wins ties). */
  nearest(cP, cR) {
    let best = null;
    for (const f of this.fams) {
      const t = this.fam[f];
      let k = -1, kScore = Infinity, kMm = 0, kDeg = 0;
      for (let j = 0; j < t.n; j++) {
        const dx = t.cP[3 * j] - cP[0], dy = t.cP[3 * j + 1] - cP[1], dz = t.cP[3 * j + 2] - cP[2];
        const dp = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let tr = 0;
        for (let a = 0; a < 9; a++) tr += t.cR[9 * j + a] * cR[a]; // trace(cr_j^T c_r)
        const ang = degrees(Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))));
        const score = (dp * 1000) / S.RECOVER_MM + ang / S.RECOVER_DEG;
        if (score < kScore) { k = j; kScore = score; kMm = dp * 1000; kDeg = ang; }
      }
      if (best === null || kScore < best.score) best = { family: f, record: k, mm: kMm, deg: kDeg, score: kScore };
    }
    return { family: best.family, record: best.record, mm: best.mm, deg: best.deg };
  }

  /** {node: built design} of every allowed node buildable from the design (one draw each). */
  candidates(f, i, hP, hR) {
    const out = {};
    for (const n of this.nodes) {
      const built = this.build(n, f, i, hP, hR);
      if (built !== null) out[n] = built;
    }
    return out;
  }
}

/** Start state of record i of a start family (E_n, E_r) (chain_mujoco.start_state). */
export function startState(gen, i, family = START_FAMILY) {
  const { cP, cR, q, pd } = gen.rec(family, i);
  const objP = add3(gen.rootP, mulVec(gen.rootR, cP));
  const objQ = quatWxyz(matmul(gen.rootR, cR));
  const z6 = [0, 0, 0, 0, 0, 0];
  return {
    handRoot: Float64Array.from([...gen.rootP, ...quatWxyz(gen.rootR), ...z6]),
    objectRoot: Float64Array.from([...objP, ...objQ, ...z6]),
    q: Float64Array.from([...z6, ...q]),
    target: Float64Array.from([...z6, ...pd]),
  };
}

/**
 * Smallest distance (m) from any hand surface link origin (s.links, 3 L, world) to the nearest of the object's surface
 * samples (surfaceLocal, 3 P, object frame, placed at s.objP / s.objR): the training's drop quantity (the minimum over
 * links of scene.nearest_surface_vectors; chain_mujoco.surface_gap).
 */
export function surfaceGap(s, surfaceLocal) {
  const { distances } = nearestSurfaceVectors(surfaceLocal, s.objP, s.objR, s.links);
  let gap = Infinity;
  for (let l = 0; l < distances.length; l++) if (distances[l] < gap) gap = distances[l];
  return gap;
}

/** The drop rule (rod line object_dropped): every hand surface link farther than DROP_DISTANCE_M from the object. */
export const dropped = (s, surfaceLocal) => surfaceGap(s, surfaceLocal) > S.DROP_DISTANCE_M;

// ------------------------------------------------------------------------------------------------ runner
const copy3 = (v) => Float64Array.from(v);

/** Runner modes: random draws, manual queue, editor (custom goals only, ChainRunner.runCustom). */
export const MODES = Object.freeze(['random', 'manual', 'editor']);

export class ChainRunner {
  constructor({ episode, generator, rng = null, mode = 'random', onFailure = 'restart', maxNodes = Infinity,
    recover = true, dwell = S.DWELL, timeout = S.TIMEOUT } = {}) {
    if (!MODES.includes(mode)) throw new Error(`mode ${mode}`);
    if (!['restart', 'end'].includes(onFailure)) throw new Error(`onFailure ${onFailure}`);
    this.episode = episode;
    this.gen = generator;
    if (rng) generator.rng = rng; // one stream for the generator and the runner, as run_chain uses gen.rng
    this.mode = mode;
    this.onFailure = onFailure;
    this.maxNodes = maxNodes;
    this.recover = recover;
    this.dwell = dwell;
    this.timeout = timeout;
    this.stepsPerSecond = Math.round(1 / (episode.policyDt ?? 0.05)); // run_chain's latch / 20, t_total / 20
    this.gateConfig = episode.task.control.gate;
    this.phase = 'ended';
    this.log = [];
    this.chainSteps = 0;
    this.totalSteps = 0;
    this.chains = 0;
    this.noNodeRestarts = 0;
    this.node = null;
    this.goal = null;
    this.design = null;
    this.queued = null;
    this.custom = null; // editor mode: the custom goal waiting to start (runCustom)
    this.queuedFrom = null;
    this.routedFrom = null;
    this._cands = null;
  }

  get state() {
    return {
      node: this.node, phase: this.phase, goalsDone: this.goalsDone ?? 0, goal: this.goal,
      stepInGoal: this.stepInGoal ?? 0, queued: this.queued, queuedFrom: this.queuedFrom ?? null,
      routedFrom: this.routedFrom ?? null, family: this.design?.family ?? null,
      record: this.design?.record ?? null, attempts: this.attempts ?? 0, timeoutsInRow: this.timeoutsInRow ?? 0,
      chainSteps: this.chainSteps, mode: this.mode,
    };
  }

  /** The current chain in run_chain's return format. */
  result() {
    const log = this.log;
    return {
      start_family: this.startFamily ?? null,
      start_record: this.startRecord ?? null,
      nodes_done: log.filter((x) => x.result === 'done').length,
      timeouts: log.filter((x) => x.result === 'timeout').length,
      end: log.length ? log[log.length - 1].result : null,
      sim_s: this.chainSteps / this.stepsPerSecond,
      log,
    };
  }

  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`mode ${mode}`);
    this.mode = mode;
    if (mode !== 'editor') this.custom = null;
  }

  /** The current design {family, record, hP, hR, cP, cR, a} (copies; cP / cR the relation, a the cluster position
   *  (m, null in a table without a): an exact editor goal's, else the record's), or null when ended. */
  currentDesign() {
    if (this.phase === 'ended' || !this.design) return null;
    const d = this.design, r = this.gen.rec(d.family, d.record), t = this.gen.fam[d.family];
    return { family: d.family, record: d.record, hP: Float64Array.from(d.hP), hR: Float64Array.from(d.hR),
      cP: Float64Array.from(d.cP ?? r.cP), cR: Float64Array.from(d.cR ?? r.cR), a: d.a ?? (t.a ? t.a[d.record] : null) };
  }

  /** Editor mode: run ONE custom goal, record `record` of family `family` with the wrist goal (hP m, hR row-major)
   *  and, when given, the exact relation cP (m) / cR (row-major) and cluster position a (m) of an editor goal (the
   *  record's fingers; else the record's relation), under the same gate, dwell, timeout, drop rule and timeout recovery as a node goal. It starts at the next step
   *  once the runner waits (at once when idle). The generator and its random stream are not used: no candidates are
   *  built and nothing is drawn (gen.remember is not called). Returns false when ended or not in editor mode. */
  runCustom({ family, record, hP, hR, cP = null, cR = null, a = null }, label = 'Goal') {
    if (this.phase === 'ended' || this.mode !== 'editor') return false;
    if (!this.gen.fam[family] || !(record >= 0 && record < this.gen.fam[family].n)) throw new Error('custom record');
    if ((cP === null) !== (cR === null)) throw new Error('custom relation: cP and cR together');
    this.custom = { family, record, hP: Float64Array.from(hP), hR: Float64Array.from(hR), label,
      ...(cP === null ? {} : { cP: Float64Array.from(cP), cR: Float64Array.from(cR), a }) };
    return true;
  }

  /** Node names buildable from the current design (cached candidates of that design). */
  available() {
    if (this.phase === 'ended' || !this.design) return [];
    return Object.keys(this._candidates());
  }

  queue(node, routedFrom = null) {
    if (!this.available().includes(node)) return false;
    this.queued = node;
    this.queuedFrom = routedFrom;
    return true;
  }

  restart(reason = 'restart') {
    const events = [];
    const previous = this.chainSteps > 0 || this.log.length ? this.result() : null;
    const gen = this.gen;
    const nE = gen.fam.E_n.n;
    let f0, i0;
    if (gen.erStart) { // E_n or E_r records, one draw over both
      const k = Number(gen.rng.integers(nE + gen.fam.E_r.n));
      [f0, i0] = k < nE ? ['E_n', k] : ['E_r', k - nE];
    } else {
      f0 = 'E_n';
      i0 = Number(gen.rng.integers(nE));
    }
    gen.last = { roll: null, slide: null };
    this.episode.resetTo(startState(gen, i0, f0));
    const s = this.episode.s;
    this.design = { family: f0, record: i0, hP: copy3(s.wristP), hR: Float64Array.from(s.wristR) };
    this.startFamily = f0;
    this.startRecord = i0;
    this.log = [];
    this.chainSteps = 0;
    this.attempts = 0;
    this.goalsDone = 0;
    this.timeoutsInRow = 0;
    this.queued = null;
    this.custom = null;
    this.queuedFrom = null;
    this.node = null;
    this.routedFrom = null;
    this.chains += 1;
    this._cands = null;
    this._hold();
    events.push({ type: 'restart', goal: this.goal, family: f0, record: i0, reason, previous });
    this._next(events);
    return events;
  }

  async step() {
    const events = [];
    if (this.phase === 'ended') return events;
    if (this.phase === 'idle' && (this.mode === 'random' || this.queued !== null || this.custom)) {
      this._next(events);
      if (this.phase === 'ended') return events;
    }
    const ep = this.episode;
    await ep.step();
    this.chainSteps += 1;
    this.totalSteps += 1;
    const e = ep.errors, s = ep.s;
    if (this.phase === 'idle') {
      if (dropped(s, ep.surfaceLocal)) {
        events.push({ type: 'drop', node: this.node });
        this._fail('drop', events);
      }
      return events;
    }
    this.stepInGoal += 1;
    this.gate.push(this.stepInGoal, e, norm(s.objLin), norm(s.objAng));
    if (this.latched < 0 && this.gate.doneStep > 0) {
      this.latched = this.gate.doneStep;
      this.phase = 'dwell';
      events.push({ type: 'latch', node: this.node, t: this.latched / this.stepsPerSecond, step: this.latched });
    }
    let result = null;
    if (this.latched > 0 && this.stepInGoal >= this.latched + this.dwell) result = 'done';
    else if (dropped(s, ep.surfaceLocal)) result = 'drop';
    else if (this.latched < 0 && this.stepInGoal >= this.timeout) result = 'timeout';
    if (result === null) return events;
    this._logGoal(result, e);
    if (result === 'done') {
      this.goalsDone += 1;
      this.timeoutsInRow = 0;
      events.push({ type: 'done', node: this.node, goalsDone: this.goalsDone });
      this._next(events);
    } else if (result === 'drop') {
      events.push({ type: 'drop', node: this.node });
      this._fail('drop', events);
    } else {
      events.push({ type: 'timeout', node: this.node });
      if (this.recover && this.timeoutsInRow < S.RECOVERIES_IN_ROW) {
        const cR = matTmul(s.wristR, s.objR);
        const cP = mulTVec(s.wristR, sub3(s.objP, s.wristP));
        const nb = this.gen.nearest(cP, cR);
        this.log[this.log.length - 1].recovered_to = [nb.family, nb.record, pyRound(nb.mm, 1), pyRound(nb.deg, 1)];
        if (nb.mm <= S.RECOVER_MM && nb.deg <= S.RECOVER_DEG) {
          this.design = { family: nb.family, record: nb.record, hP: copy3(s.wristP), hR: Float64Array.from(s.wristR) };
          this._cands = null;
          this.timeoutsInRow += 1;
          this._hold();
          events.push({ type: 'recover', ...nb, goal: this.goal });
          this._next(events);
          return events;
        }
      }
      this._fail('timeout', events);
    }
    return events;
  }

  // ---------------------------------------------------------------------------------------------- internals
  _candidates() {
    let d = this.design;
    if (d.cP && this._cands === null) { // an exact editor goal's relation: the record-based modes go on from the
      const nb = this.gen.nearest(d.cP, d.cR); // nearest record of that relation (the timeout recovery's rule)
      d = this.design = { family: nb.family, record: nb.record, hP: d.hP, hR: d.hR };
    }
    if (this._cands === null) this._cands = this.gen.candidates(d.family, d.record, d.hP, d.hR);
    return this._cands;
  }

  _makeGoal(d) {
    const { cP, cR, q } = this.gen.rec(d.family, d.record);
    return makeGoal(d.hP, d.hR, d.cP ?? cP, d.cR ?? cR, q);
  }

  /** Install the hold goal of the current design (no node: the policy holds the designed grasp). */
  _hold() {
    this.goal = this._makeGoal(this.design);
    this.episode.setGoal(this.goal);
    this.phase = 'idle';
    this.stepInGoal = 0;
  }

  /** The design is ready for the next node: max nodes, then random draw / manual queue / idle. */
  _next(events) {
    if (this.attempts >= this.maxNodes) return this._end('max nodes reached', events);
    if (this.mode === 'editor') { // no candidates (no draw): a custom goal when one is set, else the hold goal stays
      const c = this.custom;
      this.custom = null;
      if (c) return this._installCustom(c, events);
      this.phase = 'idle';
      return undefined;
    }
    const cands = this._candidates();
    const names = Object.keys(cands);
    if (!names.length) {
      this.log.push({ node: null, result: 'no node available', ...this._diag(cands) });
      return this._fail('no node available', events);
    }
    this.noNodeRestarts = 0;
    if (this.mode === 'random') return this._install(String(this.gen.rng.choice(names)), events);
    const node = this.queued, from = this.queuedFrom ?? null;
    this.queued = null;
    this.queuedFrom = null;
    if (node !== null && node in cands) return this._install(node, events, from);
    this.phase = 'idle'; // the current goal stays installed
    return undefined;
  }

  /** run_chain's diagnostics of the candidates of the current design (no draw; Python's available_near, option B,
   * is not ported). */
  _diag(cands) {
    const names = Object.keys(cands);
    return { from_family: this.design.family, available_nodes: names, g_available: names.some((n) => n.includes('G')),
      available_try: names.filter((n) => cands[n].info.switch_try?.differed === true) };
  }

  _install(node, events, routedFrom = null) {
    const built = this._cands[node];
    this.availableCount = Object.keys(this._cands).length;
    this.diag = this._diag(this._cands);
    this._cands = null;
    this.design = { family: built.family, record: built.record, hP: built.hP, hR: built.hR };
    this.gen.remember(built.info);
    this.goal = this._makeGoal(this.design);
    this.episode.setGoal(this.goal);
    this.gate = new Gate(this.gateConfig);
    this.node = node;
    this.routedFrom = routedFrom;
    this.nodeInfo = built.info;
    this.phase = 'reach';
    this.stepInGoal = 0;
    this.latched = -1;
    events.push({ type: 'goal', node, index: this.attempts, goal: this.goal, family: built.family,
      record: built.record, info: built.info, routedFrom });
    this.attempts += 1;
  }

  _installCustom(c, events) {
    this.availableCount = null;
    this.diag = { from_family: this.design.family };
    this._cands = null;
    this.design = { family: c.family, record: c.record, hP: c.hP, hR: c.hR,
      ...(c.cP ? { cP: c.cP, cR: c.cR, a: c.a } : {}) };
    this.goal = this._makeGoal(this.design);
    this.episode.setGoal(this.goal);
    this.gate = new Gate(this.gateConfig);
    this.node = c.label;
    this.routedFrom = null;
    this.nodeInfo = { custom: true };
    this.phase = 'reach';
    this.stepInGoal = 0;
    this.latched = -1;
    events.push({ type: 'goal', node: c.label, index: this.attempts, goal: this.goal, family: c.family,
      record: c.record, info: this.nodeInfo, routedFrom: null, custom: true });
    this.attempts += 1;
  }

  _logGoal(result, e) {
    this.log.push({
      node: this.node, family: this.design.family, record: this.design.record, result,
      latch_s: this.latched > 0 ? this.latched / this.stepsPerSecond : null,
      final_goal_mm: pyRound(1000 * e[0], 1), final_goal_deg: pyRound(degrees(e[1]), 1),
      available: this.availableCount, ...this.diag, ...this.nodeInfo,
      ...(this.routedFrom ? { routed_from: this.routedFrom } : {}),
    });
  }

  _fail(reason, events) {
    if (this.onFailure === 'restart') {
      if (reason === 'no node available' && ++this.noNodeRestarts > 10) return this._end(reason, events);
      events.push(...this.restart(reason));
      return undefined;
    }
    return this._end(reason, events);
  }

  _end(reason, events) {
    this.phase = 'ended';
    events.push({ type: 'end', reason, result: this.result() });
    return undefined;
  }
}
