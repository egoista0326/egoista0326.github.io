// Hands-on editor (owner 2026-11-22/23): the reader sets ONE goal RELATIVE to the current reached pose (the measured
// wrist when the previous goal ended; sliders start at zero after each goal, so turns and travel add up over goals):
// a grasp type, a position along the rod (enclosure targets only), a roll, a move (x / y within a 25 cm radius, along
// the view's screen right and away from the viewer (moveAxes, the page's camera); height +-15 cm) and a wrist rotation
// (turn about the vertical, tilt about the hand's side axis, twist about the forearm, +-90 deg each, total <= 120 deg
// per goal; with a grasp switch <= 60 deg; owner 2026-11-23: no palm rule, palm-down switches are accepted),
// limits from editor_feasibility/relative_sweep/RESULTS.md section 6 (lead 2026-11-23). Absolute guards against the
// fixed hand root (nearest Euler branch, as the controller): each wrist hinge within +-300 deg, wrist y joint <= 75 deg,
// object goal within +-1.5 m of home (display bound; no policy workspace box). Every slider is clamped on its own
// (Editor.limits; no coupled pull-back).
// No snapping (owner 2026-11-23, Set goal MUST): the rods are regular (uniform cross-section), so a grasp rolled about
// the rod's long axis, or an enclosure slid along it, stays a valid grasp. The goal relation is a base relation (Keep:
// the current one; a grasp change: one real record of the target family) composed with an EXACT roll about the rod's
// own +Y through the rod axis and, for enclosure targets, an EXACT slide along it; the fingers stay the base record's.
// Hexagon d40: rolled pinches stay <= 3.1 mm into the rod, rolled enclosures up to 4.7 mm (corners 2.7 mm outside the
// flats; editor_feasibility/exact_roll). Pure functions over a Generator (no DOM, no draw).
//
// Names (RESULTS.md section 2): E_n / E_r enclosures (rod +Y at the pinky / thumb side), T_b / T_s pinches at the rod's
// +Y / -Y end. a (m): a record's fingertip-cluster centre on the rod's own +Y (table field a). Roll: the turn about the
// rod's +Y from the start record to a record, after tilting the start's rod axis onto the record's (editor_lib.roll_tilt;
// the tables' roll sign). Offset of a switch: depth of the enclosure's cluster from the pinched end minus the pinch's.
import { add3, matmul, matmulT, matTmul, mulVec, nearestEulerXyzFromMatrix, rotationAngle } from '../engine/math.js';
import { rot } from '../engine/chain.js';

const RAD = Math.PI / 180;
export const LIMITS = Object.freeze({
  A_MM: Object.freeze([-50, 55]), // position slider (enclosure targets), mm of the cluster centre
  ROLL_DEG: 90, // roll slider
  // per goal, relative to the reached wrist (relative_sweep/RESULTS.md section 6, lead 2026-11-23)
  MOVE_R_M: 0.25, Z_M: 0.15, ROT_DEG: 90, // move radius in x / y, height; turn / tilt / twist each
  TOTAL_DEG: 120, // the total wrist turn of one goal (trained)
  SWITCH_TOTAL_DEG: 60, // with a grasp switch: the total turn (owner 2026-11-23: no palm-past-sideways rule)
  // absolute, against the fixed hand root
  HINGE_DEG: 300, // each wrist hinge (nearest Euler branch) within +-300 deg of the root
  PITCH_DEG: 75, // wrist y joint on the controller's nearest Euler branch (the trained max_wrist_pitch_deg; _rotOk)
  DISPLAY_M: 1.5, // object goal within +-1.5 m of home per world axis (scene / camera bound; no policy box)
  THUMB_OFFSET_M: 0.05, // thumb-side pinch only beyond this offset
  SIGMA_A_M: 0.01, SIGMA_ROLL: 10 * RAD, SAME_TILT: 20 * RAD, // base-record scales (bench rule B), same-type tilt
});
/** The wrist keys of a setting (slider units: x / y / z mm, x / y along the base's move axes (moveAxes; default the
 *  world axes), z world up; turn / tilt / twist deg) and their spans. */
export const WRIST_KEYS = Object.freeze(['x', 'y', 'z', 'turn', 'tilt', 'twist']);
export const SPAN = Object.freeze({ x: 1000 * LIMITS.MOVE_R_M, y: 1000 * LIMITS.MOVE_R_M, z: 1000 * LIMITS.Z_M,
  turn: LIMITS.ROT_DEG, tilt: LIMITS.ROT_DEG, twist: LIMITS.ROT_DEG });
const AXES = ['x', 'y', 'z'], ROT_KEYS = ['turn', 'tilt', 'twist'];
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The horizontal world axes of the x / y move keys (review S2: the page's sliders move along the view): x = screen
 *  right, y = away from the viewer, for a view whose horizontal viewing direction ('away') has azimuth awayDeg (deg
 *  from world +x toward +y): away (cos, sin, 0), right = away x world up = (sin, -cos, 0). awayDeg 90 (looking along
 *  world +y) is the world axes, the default. -> {right (2), away (2)} (world x, y) */
export function moveAxes(awayDeg = 90) {
  const t = awayDeg * RAD;
  return { right: [Math.sin(t), -Math.cos(t)], away: [Math.cos(t), Math.sin(t)] };
}
const WORLD_MOVE = moveAxes(90);

/** The exact goal relation (owner 2026-11-23): the base relation (cP m, cR row-major; object in the wrist frame) rolled
 *  by roll (rad, table sign) about the object's own +Y through its origin on the rod axis (cR Ry(roll), cP unchanged:
 *  the axis line stays fixed relative to the hand) and slid by slide (m) along that axis, so the hand's points sit
 *  slide further along the object's +Y (cP - slide * cR e_y). -> {cP (3), cR (9)} */
export function exactRelation(cP, cR, roll, slide) {
  const r = matmul(cR, rot([0, 1, 0], roll));
  return { cP: Float64Array.from([0, 1, 2], (i) => cP[i] - slide * cR[3 * i + 1]), cR: Float64Array.from(r) };
}
export const ENCLOSURES = ['E_n', 'E_r'];
export const PINCHES = ['T_b', 'T_s'];
/** The reversed family of the same type: never offered (no trained goal holds it). */
export const REVERSAL = Object.freeze({ E_n: 'E_r', E_r: 'E_n', T_b: 'T_s', T_s: 'T_b' });
/** The thumb-side pinch of an enclosure (offered only beyond LIMITS.THUMB_OFFSET_M). */
export const THUMB_SIDE = Object.freeze({ E_n: 'T_s', E_r: 'T_b' });
const isEnc = (f) => f === 'E_n' || f === 'E_r';

/** Switch offset (m) of enclosure cluster aE and pinch cluster aT of pinch family t (the ends cancel). */
export const switchOffset = (aE, aT, t) => (t === 'T_b' ? aT - aE : aE - aT);

/** Roll (table sign, rad; NaN when the axes are > 150 deg apart) and tilt (rad) from rotation cRi (9) to each record
 *  of cRk (9 n, row-major): editor_lib.roll_tilt with Editor._roll_tilt's sign. */
export function rollTilt(cRi, cRk, n) {
  const roll = new Float64Array(n), tilt = new Float64Array(n);
  const y0 = [cRi[1], cRi[4], cRi[7]];
  for (let k = 0; k < n; k++) {
    const o = 9 * k, y = [cRk[o + 1], cRk[o + 4], cRk[o + 7]];
    const c = Math.min(1, Math.max(-1, y[0] * y0[0] + y[1] * y0[1] + y[2] * y0[2]));
    tilt[k] = Math.acos(c);
    const v = [y0[1] * y[2] - y0[2] * y[1], y0[2] * y[0] - y0[0] * y[2], y0[0] * y[1] - y0[1] * y[0]];
    const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
    const KK = matmul(K, K), M = new Array(9);
    for (let j = 0; j < 9; j++) M[j] = (j % 4 === 0 ? 1 : 0) + K[j] + KK[j] / (1 + c);
    const t = matmul(M, cRi);
    // mm = cr_k^T tilted: mm[0][2] = sum_j cr_k[j][0] t[j][2], mm[0][0] = sum_j cr_k[j][0] t[j][0]
    let m02 = 0, m00 = 0;
    for (let j = 0; j < 3; j++) { m02 += cRk[o + 3 * j] * t[3 * j + 2]; m00 += cRk[o + 3 * j] * t[3 * j]; }
    roll[k] = tilt[k] > 150 * RAD ? NaN : -Math.atan2(m02, m00);
  }
  return { roll, tilt };
}

const median = (arr) => {
  const s = Float64Array.from(arr).sort(), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
};

export class Editor {
  /** @param {object} gen the runner's Generator (its table must ship a; read only)
   *  @param {{fwd: number[], lat: number[]}|null} axes the hand's forward / lateral unit axes in the wrist frame
   *    (handAxes; the worker measures them at q = 0); null: a stand-in pair orthogonal to the palm normal (tests) */
  constructor(gen, axes = null) {
    this.gen = gen;
    const h = gen.homeR;
    this.palmN = [h[6], h[7], h[8]]; // palm normal in the wrist frame: homeR^T e_z (palm up at home)
    ({ fwd: this.fwd, lat: this.lat } = axes ?? handAxes([h[0], h[1], h[2]], h));
    this.fam = gen.fam;
    for (const f of gen.fams) if (!this.fam[f].a) throw new Error(`chain.json ${f}: no a (export_axial.py)`);
    this.medianA = {};
    this.rangeA = {}; // [min, max] a (m) of the family's records: the graspable length the records cover
    for (const f of gen.fams) {
      this.medianA[f] = median(this.fam[f].a);
      this.rangeA[f] = [Math.min(...this.fam[f].a), Math.max(...this.fam[f].a)];
    }
  }

  /** Position slider limits (m) of enclosure family f: LIMITS.A_MM within the family's record range. */
  limitsA(f) {
    return [Math.max(LIMITS.A_MM[0] / 1000, this.rangeA[f][0]), Math.min(LIMITS.A_MM[1] / 1000, this.rangeA[f][1])];
  }

  /** [{family, enabled}] of the grasp types offered from (f0, i0) with the current cluster position a0 (m; default the
   *  record's): keep (family f0) first, then the other type's families of this generator. The reversal is never
   *  listed; the thumb-side pinch is disabled unless the offset to that family's median pinch exceeds
   *  LIMITS.THUMB_OFFSET_M. */
  options(f0, i0, a0 = this.fam[f0].a[i0]) {
    const out = [{ family: f0, enabled: true, keep: true }];
    const others = (isEnc(f0) ? PINCHES : ENCLOSURES).filter((f) => this.gen.fams.includes(f));
    for (const f of others) {
      let enabled = true;
      if (THUMB_SIDE[f0] === f) enabled = switchOffset(a0, this.medianA[f], f) > LIMITS.THUMB_OFFSET_M;
      out.push({ family: f, enabled, keep: false });
    }
    return out;
  }

  /** a* (m), the goal's cluster position. Enclosure targets: the slider aMm (mm) clamped to limitsA(f); an untouched
   *  slider (aMm null) keeps the current position a0 for Keep (unclamped: no slide, also beyond the slider's range,
   *  e.g. -61 mm) and aims at a0 clamped for a grasp change. A pinch keeps its depth (Keep) or sits at its end (the
   *  family's median, which picks the base record). */
  aimA(f0, a0, f, aMm) {
    if (!isEnc(f)) return f === f0 ? a0 : this.medianA[f];
    if (aMm == null && f === f0) return a0;
    const [lo, hi] = this.limitsA(f), a = aMm == null ? a0 : aMm / 1000;
    return Math.min(hi, Math.max(lo, a));
  }

  /** The base record of a grasp change to family f from (f0, i0) with the current relation rotation cR0 (9; default
   *  the record's) and cluster position a0 (m): the record of f nearest (a*, roll 0), i.e. nearest the current relation
   *  (editor_run.Editor.record's score: ((a - a*) / 10 mm)^2 + ((roll - 0) / 10 deg)^2, first minimum; same-type
   *  targets with tilt <= 20 deg when any); with thumbRule the thumb-side pinch only among records beyond the offset
   *  limit. Deterministic (no draw). -> {record, a, roll (from the current relation, table sign), tilt} or null */
  baseRecord(f0, i0, f, aStar, { thumbRule = true, cR0 = null, a0 = null } = {}) {
    if (REVERSAL[f0] === f) throw new Error(`reversal ${f0} -> ${f}`);
    const t = this.fam[f], s0 = this.fam[f0];
    const { roll, tilt } = rollTilt(cR0 ?? s0.cR.subarray(9 * i0, 9 * i0 + 9), t.cR, t.n);
    const score = new Float64Array(t.n);
    const limitThumb = thumbRule && THUMB_SIDE[f0] === f, aE = a0 ?? s0.a[i0];
    for (let k = 0; k < t.n; k++) {
      const v = ((t.a[k] - aStar) / LIMITS.SIGMA_A_M) ** 2 + (roll[k] / LIMITS.SIGMA_ROLL) ** 2;
      score[k] = Number.isFinite(v) && !(limitThumb && !(switchOffset(aE, t.a[k], f) > LIMITS.THUMB_OFFSET_M))
        ? v : Infinity;
    }
    if (isEnc(f0) === isEnc(f)) {
      let any = false;
      for (let k = 0; k < t.n; k++) if (tilt[k] <= LIMITS.SAME_TILT && score[k] < Infinity) { any = true; break; }
      if (any) for (let k = 0; k < t.n; k++) if (!(tilt[k] <= LIMITS.SAME_TILT)) score[k] = Infinity;
    }
    let k = -1, best = Infinity;
    for (let j = 0; j < t.n; j++) if (score[j] < best) { best = score[j]; k = j; }
    if (k < 0) return null;
    return { record: k, a: t.a[k], roll: roll[k], tilt: tilt[k] };
  }

  // ------------------------------------------------------------------ relative wrist goals (2026-11-23)
  /** The relative wrist goal of wrist setting w (slider units: x / y / z mm; turn / tilt / twist deg) from the
   *  reached wrist base {p (3, m), R (9, row-major), world; move: moveAxes() of the page's view, default the world
   *  axes}: p* = p + (x right + y away, z) / 1000 and R* = Rz(turn) R Rot(lat, tilt) Rot(fwd, twist) (turn about
   *  world +z, tilt about the hand's side axis, twist about the forearm; lat / fwd fixed in the wrist frame).
   *  -> {hP, hR} */
  pose(base, w) {
    const R = matmul(matmul(rot([0, 0, 1], (w.turn ?? 0) * RAD), base.R),
      matmul(rot(this.lat, (w.tilt ?? 0) * RAD), rot(this.fwd, (w.twist ?? 0) * RAD)));
    return { hP: this._moved(base, w), hR: Float64Array.from(R) };
  }

  /** The goal wrist position (3, m, world) of setting w from base (pose). */
  _moved(base, w) {
    const { right, away } = base.move ?? WORLD_MOVE, x = (w.x ?? 0) / 1000, y = (w.y ?? 0) / 1000;
    return Float64Array.of(base.p[0] + x * right[0] + y * away[0], base.p[1] + x * right[1] + y * away[1],
      base.p[2] + (w.z ?? 0) / 1000);
  }

  /** Palm tilt (deg) of wrist rotation r (9, world): the palm normal's angle from world up (0 palm up as at home,
   *  90 sideways, 180 palm down). */
  palmDeg(r) {
    const n = mulVec(r, this.palmN);
    return Math.acos(Math.min(1, Math.max(-1, n[2]))) / RAD;
  }

  /** The wrist joints (deg; x, y, z hinges relative to the fixed hand root) the controller would aim for rotation r:
   *  the source Euler of R_root^T r on the branch nearest the current joints q3 (rad; control.js
   *  sourceTargetFromWorldPose). */
  joints(r, q3) {
    return Array.from(nearestEulerXyzFromMatrix(matTmul(this.gen.rootR, r), q3), (v) => v / RAD);
  }

  /** The guard context of the reached base {p, R, q3 (rad, the current wrist joints; default: the branch nearest 0),
   *  move} for relation cP and a switch or not: each absolute limit relaxed to the base's own value when the base
   *  already exceeds it (each hinge to its own joint's value; so the zero setting always passes). */
  _ctx(base, cP, sw) {
    const q3 = base.q3 ?? nearestEulerXyzFromMatrix(matTmul(this.gen.rootR, base.R), [0, 0, 0]);
    const g = this.gen, obj0 = add3(base.p, mulVec(base.R, cP));
    return { base, q3, cP, sw,
      hinge: Array.from(q3, (v) => Math.max(LIMITS.HINGE_DEG, Math.abs(v) / RAD) + 1e-6),
      pitch: Math.max(LIMITS.PITCH_DEG, Math.abs(q3[1]) / RAD) + 1e-6,
      bound: [0, 1, 2].map((i) => Math.max(LIMITS.DISPLAY_M, Math.abs(obj0[i] - g.homeP[i])) + 1e-9) };
  }

  /** Rotation checks of rotation r (the goal's) in guard context c: total turn of the goal (<= TOTAL_DEG; a switch
   *  SWITCH_TOTAL_DEG), each wrist hinge within +-HINGE_DEG (c.hinge, per joint)
   *  and the wrist y joint within +-PITCH_DEG, both on the controller's nearest branch. (The branch-free
   *  |asin (R_root^T r)[0, 2]| of the trained sampler passes again beyond 90 + 15 deg, where the same rotation reads
   *  as y = 180 - y with x / z flipped;
   *  the controller instead follows y past 90: MANO's turn about the vertical, measured drops near the lock.) */
  _rotOk(r, c) {
    const total = rotationAngle(matmulT(r, c.base.R)) / RAD;
    if (total > (c.sw ? LIMITS.SWITCH_TOTAL_DEG : LIMITS.TOTAL_DEG) + 1e-6) return false;
    const e = this.joints(r, c.q3);
    return Math.abs(e[1]) <= c.pitch && e.every((v, i) => Math.abs(v) <= c.hinge[i]);
  }

  /** Position checks of setting w with goal rotation r: the move radius in x / y, the height, the object goal within
   *  the display bound (per world axis, from home). */
  _posOk(w, r, c) {
    if (Math.hypot(w.x, w.y) > LIMITS.MOVE_R_M * 1000 + 1e-9 || Math.abs(w.z) > LIMITS.Z_M * 1000 + 1e-9) return false;
    const rc = mulVec(r, c.cP), p = this._moved(c.base, w), g = this.gen;
    for (let i = 0; i < 3; i++) if (Math.abs(p[i] + rc[i] - g.homeP[i]) > c.bound[i]) return false;
    return true;
  }

  /** Whether wrist setting w passes every guard in context c. */
  ok(w, c) {
    const r = this.pose(c.base, w).hR;
    return this._rotOk(r, c) && this._posOk(w, r, c);
  }

  /** Per-axis limits: for each wrist key the interval [lo, hi] (slider units) of its values that pass every guard
   *  with every other key at its value in w, reached in unit steps from the key's own value when that passes (the
   *  sets are not convex: an admissible setting is never pulled back), else from 0 (no coupled pull-back: moving
   *  one slider never changes another). -> {x, y, z, turn, tilt, twist: [lo, hi]} */
  limits(w, c) {
    return Object.fromEntries(WRIST_KEYS.map((k) => [k, this.interval(k, w, c)]));
  }

  /** The interval of key k (limits()); rotOnly: rotation keys checked by the rotation guards alone (goal()'s first
   *  pass, so an out-of-range move never blocks a rotation). */
  interval(k, w, c, rotOnly = false) {
    const move = k === 'x' || k === 'y' || k === 'z';
    const r0 = move ? this.pose(c.base, w).hR : null, rotOk0 = move && this._rotOk(r0, c);
    const pass = (v) => {
      const t = { ...w, [k]: v };
      if (move) return rotOk0 && this._posOk(t, r0, c);
      return rotOnly ? this._rotOk(this.pose(c.base, t).hR, c) : this.ok(t, c);
    };
    const v0 = Math.round(w[k] ?? 0), start = v0 !== 0 && Math.abs(v0) <= SPAN[k] && pass(v0) ? v0 : 0;
    let lo = start, hi = start;
    while (hi < SPAN[k] && pass(hi + 1)) hi += 1;
    while (lo > -SPAN[k] && pass(lo - 1)) lo -= 1;
    return [lo, hi];
  }

  /** The grasp types offered from design d (goal()) for setting {aMm, rollDeg} with the wrist setting w (slider
   *  units; the applied one): options() rules first; a grasp switch only when w passes the switch rule (total turn
   *  <= SWITCH_TOTAL_DEG) and the guards with that switch's own goal relation (its base record, roll and slide:
   *  _target). Any palm tilt (owner 2026-11-23: the palm-past-sideways rule is removed).
   *  base: the reached wrist {p, R, q3, move}. -> [{family, enabled, keep}] */
  offered(d, setting, base, w = setting.wrist ?? {}) {
    const a0 = d.a ?? this.fam[d.family].a[d.record];
    const wz = Object.fromEntries(WRIST_KEYS.map((k) => [k, w[k] ?? 0]));
    return this.options(d.family, d.record, a0).map((o) => {
      if (o.keep || !o.enabled) return o;
      const t = this._target(d, { ...setting, family: o.family });
      return { ...o, enabled: !!t && this.ok(wz, this._ctx(base, t.rel.cP, true)) };
    });
  }

  /** The goal relation of setting {family f, aMm, rollDeg} from design d (goal()): the base relation (Keep: the
   *  current one; a grasp change: baseRecord) rolled exactly to the slider's roll from the current relation and, for
   *  an enclosure target, slid exactly to a* (aimA). -> {f, sw, rb {record, cP, cR, a, roll}, roll, slide, extraRoll,
   *  rel {cP, cR}} or null (no base record) */
  _target(d, setting) {
    const f = setting.family, s0 = this.fam[d.family], sw = f !== d.family;
    const cR0 = d.cR ?? s0.cR.subarray(9 * d.record, 9 * d.record + 9), a0 = d.a ?? s0.a[d.record];
    const aStar = this.aimA(d.family, a0, f, setting.aMm ?? null);
    const roll = Math.min(LIMITS.ROLL_DEG, Math.max(-LIMITS.ROLL_DEG, setting.rollDeg ?? 0)) * RAD;
    let rb;
    const cP0 = d.cP ?? s0.cP.subarray(3 * d.record, 3 * d.record + 3);
    if (!sw) rb = { record: d.record, cP: cP0, cR: cR0, a: a0, roll: 0 };
    else {
      const b = this.baseRecord(d.family, d.record, f, aStar, { cR0, a0 });
      if (!b) return null;
      const t = this.fam[f];
      rb = { ...b, cP: t.cP.subarray(3 * b.record, 3 * b.record + 3), cR: t.cR.subarray(9 * b.record, 9 * b.record + 9) };
    }
    const slide = isEnc(f) ? aStar - rb.a : 0, extraRoll = roll - rb.roll;
    return { f, sw, rb, roll, slide, extraRoll, rel: exactRelation(rb.cP, rb.cR, extraRoll, slide) };
  }

  /** The goal of an editor setting from the design d {family, record, hP, hR, cP?, cR?, a?} (cP / cR / a: the current
   *  relation and cluster position when they differ from the record's, after an exact goal), RELATIVE to the reached
   *  wrist base {p, R, q3, move} (default the design's wrist goal): setting {family, aMm (enclosure targets; null =
   *  the slider untouched), rollDeg, wrist {x, y, z (mm), turn, tilt, twist (deg)}}.
   *  Base relation: Keep = the current relation (record d.record's fingers); a grasp change = baseRecord. The roll from
   *  the current relation is exactly the slider's (clamped to +-ROLL_DEG): the base is rolled by rollDeg minus its own
   *  roll; an enclosure target is slid exactly to a* (aimA); a pinch is not slid. The fingers q* (and their PD target)
   *  are the base record's. Each wrist key is clamped on its own to its slider span, then to its interval of
   *  limits() (the others at their values). -> {family, record, cP, cR, a, roll, extraRoll, slide, hP, hR, wrist (the
   *  applied setting), limits, aLimits (m: the Position slider's limitsA of an enclosure target, else null), ok (every
   *  guard passes), totalDeg, palmDeg, jointsDeg, noop (Keep with no roll, no slide and every wrist key 0: nothing to
   *  run)} or null (a disabled or unknown grasp type). */
  goal(d, setting, base = { p: d.hP, R: d.hR }) {
    const f = setting.family, a0 = d.a ?? this.fam[d.family].a[d.record];
    const sw = f !== d.family;
    const req = Object.fromEntries(WRIST_KEYS.map((k) => [k, clampTo(setting.wrist?.[k] ?? 0, -SPAN[k], SPAN[k])]));
    // the grasp rules gate a switch; its total-turn cap is applied by the clamp below (a request past it is clamped,
    // never refused)
    const opt = this.options(d.family, d.record, a0).find((o) => o.family === f);
    if (!opt || !opt.enabled) return null;
    const t = this._target(d, setting);
    if (!t) return null;
    const { rb, roll, slide, extraRoll, rel } = t;
    // per-axis clamp, one key at a time as the page's sliders (no coupled pull-back): the rotations against the
    // rotation guards, then the moves against the clamped rotations, then the rotations again with the display bound
    // of the clamped moves; an admissible request passes unchanged. The returned limits are the applied setting's.
    const c = this._ctx(base, rel.cP, sw), w = { ...req };
    for (const k of ROT_KEYS) w[k] = clampTo(w[k], ...this.interval(k, w, c, true));
    for (const k of AXES) w[k] = clampTo(w[k], ...this.interval(k, w, c));
    for (const k of ROT_KEYS) w[k] = clampTo(w[k], ...this.interval(k, w, c));
    const lim = this.limits(w, c);
    const { hP, hR } = this.pose(base, w);
    const noop = !sw && Math.abs(roll) < 0.5 * RAD && Math.abs(slide) < 5e-4 && WRIST_KEYS.every((k) => w[k] === 0);
    return { family: f, record: rb.record, cP: rel.cP, cR: rel.cR, a: rb.a + slide, roll, extraRoll, slide, hP, hR,
      wrist: w, limits: lim, aLimits: isEnc(f) ? this.limitsA(f) : null, ok: this.ok(w, c),
      totalDeg: rotationAngle(matmulT(hR, base.R)) / RAD, palmDeg: this.palmDeg(hR), jointsDeg: this.joints(hR, c.q3),
      noop };
  }
}

/** (forward, lateral) unit axes of the hand in the wrist frame (relocation_sweep sweep_run.hand_axes): palm normal n =
 *  homeR^T e_z (palm up at home); forward = the mean of surface link positions v (wrist frame, at q = 0) made
 *  orthogonal to n; lateral = n x forward. */
export function handAxes(v, homeR) {
  const n = [homeR[6], homeR[7], homeR[8]], d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const f = [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]], s = Math.hypot(...f);
  const fwd = f.map((x) => x / s);
  return { fwd, lat: [n[1] * fwd[2] - n[2] * fwd[1], n[2] * fwd[0] - n[0] * fwd[2], n[0] * fwd[1] - n[1] * fwd[0]] };
}
