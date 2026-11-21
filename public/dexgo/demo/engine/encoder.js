// The v7 actor input obs141: the 8 actor fields of the wrist_local291 encoding, in the checkpoint's actor_fields
// order. Port of observations/encoders.py encode_wrist_local (distance_map "log", compact layout) restricted to
// the fields the actor reads, plus simulation/scene.py nearest_surface_vectors.
// All poses world frame, SI units; H = the actual wrist link frame (right_wrist_rz); joints in source order (26).

import {
  add3, clamp, matmul, matmulT, matTmul, mulTVec, mulVec, radialLog, so3Log, sub3, vec3,
} from './math.js';

/** Field order and widths of obs141 (must equal policy/actor.json "fields"). */
export const ACTOR_FIELDS = [
  ['finger_position', 20],
  ['finger_pd_error', 20],
  ['object_goal', 6],
  ['gravity_direction', 3],
  ['surface', 60],
  ['process_relation', 6],
  ['task_wrist_error', 6],
  ['finger_reference', 20],
];
export const OBS_DIM = ACTOR_FIELDS.reduce((n, [, w]) => n + w, 0); // 141

const GRAVITY_W = vec3(0, 0, -9.81);

/**
 * From each surface link to the nearest of the object's surface samples (scene.nearest_surface_vectors).
 * @param {Float64Array} surfaceLocal (P*3) object-frame samples
 * @param {ArrayLike<number>} objP object body position (3, world)
 * @param {ArrayLike<number>} objR object body rotation (9, row-major)
 * @param {Float64Array} links (L*3) link origins (world)
 * @returns {{vectors: Float64Array, distances: Float64Array}} (L*3) world vectors link -> nearest point, (L) lengths
 */
export function nearestSurfaceVectors(surfaceLocal, objP, objR, links) {
  const P = surfaceLocal.length / 3, L = links.length / 3;
  const sw = new Float64Array(P * 3);
  for (let p = 0; p < P; p++) {
    const x = surfaceLocal[3 * p], y = surfaceLocal[3 * p + 1], z = surfaceLocal[3 * p + 2];
    sw[3 * p] = objR[0] * x + objR[1] * y + objR[2] * z + objP[0];
    sw[3 * p + 1] = objR[3] * x + objR[4] * y + objR[5] * z + objP[1];
    sw[3 * p + 2] = objR[6] * x + objR[7] * y + objR[8] * z + objP[2];
  }
  const vectors = new Float64Array(L * 3), distances = new Float64Array(L);
  for (let l = 0; l < L; l++) {
    const lx = links[3 * l], ly = links[3 * l + 1], lz = links[3 * l + 2];
    let best = Infinity, bi = 0;
    for (let p = 0; p < P; p++) {
      const dx = sw[3 * p] - lx, dy = sw[3 * p + 1] - ly, dz = sw[3 * p + 2] - lz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = p; } // first minimum, as torch.min
    }
    vectors[3 * l] = sw[3 * bi] - lx;
    vectors[3 * l + 1] = sw[3 * bi + 1] - ly;
    vectors[3 * l + 2] = sw[3 * bi + 2] - lz;
    distances[l] = Math.sqrt(best);
  }
  return { vectors, distances };
}

/** [R_H^T (p_T - p_H), so3_log(R_H^T R_T)] (features.pd_error), metres / radians in H. */
export function pdError(wristP, wristR, targetP, targetR) {
  const p = mulTVec(wristR, sub3(targetP, wristP));
  const r = so3Log(matTmul(wristR, targetR));
  return [p, r];
}

/**
 * Encode obs141 of one frame.
 * @param {object} frame  {q, qd (26), rootP, rootR, wristP, wristR, objP, objR, links (60)} world
 * @param {object} goal   {objectP, objectR, objToHandP, objToHandR, fingerRef (20), wristP, wristR}
 * @param {ArrayLike<number>} pdTarget (26) the PD target decided at the previous control step (source order)
 * @param {ArrayLike<number>} lower, upper (26) joint limits (model jnt_range, source order)
 * @param {Float64Array} surfaceLocal (600) object-frame surface samples
 * @param {object} config encoder_config of the checkpoint (task.json control.encoder)
 * @returns {{obs: Float64Array, surface: {vectors, distances}}}
 */
export function encodeActor(frame, goal, pdTarget, lower, upper, surfaceLocal, config) {
  if ((config.distance_map ?? 'log') !== 'log') throw new Error('only the log distance map is ported');
  const obs = new Float64Array(OBS_DIM);
  let o = 0;
  const put3 = (v) => { obs[o++] = v[0]; obs[o++] = v[1]; obs[o++] = v[2]; };
  const rh = frame.wristR;
  const q = frame.q;

  // finger_position: 2 (q - lower) / span - 1, clipped
  for (let i = 6; i < 26; i++) obs[o++] = clamp((2 * (q[i] - lower[i])) / (upper[i] - lower[i]) - 1, -1, 1);
  // finger_pd_error: 2 (target - q) / span, clipped
  for (let i = 6; i < 26; i++) obs[o++] = clamp((2 * (pdTarget[i] - q[i])) / (upper[i] - lower[i]), -1, 1);

  // object_goal: transforms.goal_error_in_wrist_frame, then radial maps
  const goalP = mulTVec(rh, sub3(goal.objectP, frame.objP));
  const goalR = so3Log(matmulT(matTmul(rh, goal.objectR), matTmul(rh, frame.objR)));
  put3(radialLog(goalP, ...config.goal_position));
  put3(radialLog(goalR, ...config.goal_rotation));

  // gravity_direction: R_H^T g / |g|
  const gn = Math.hypot(GRAVITY_W[0], GRAVITY_W[1], GRAVITY_W[2]);
  put3(mulTVec(rh, vec3(GRAVITY_W[0] / gn, GRAVITY_W[1] / gn, GRAVITY_W[2] / gn)));

  // surface: per link, R_H^T (nearest surface point - link), radial map
  const surface = nearestSurfaceVectors(surfaceLocal, frame.objP, frame.objR, frame.links);
  const [sd0, scap] = config.surface;
  for (let l = 0; l < surface.distances.length; l++) {
    const v = surface.vectors.subarray(3 * l, 3 * l + 3);
    put3(radialLog(mulTVec(rh, v), sd0, scap));
  }

  // process_relation: E_rel = pd_error(H, T_WO B), B = object-to-hand relation (features.process_relation)
  const refP = add3(frame.objP, mulVec(frame.objR, goal.objToHandP));
  const refR = matmul(frame.objR, goal.objToHandR);
  const [relP, relR] = pdError(frame.wristP, rh, refP, refR);
  put3(radialLog(relP, ...config.process_position));
  put3(radialLog(relR, ...config.process_rotation));

  // task_wrist_error: pd_error(H, H*)
  const [twP, twR] = pdError(frame.wristP, rh, goal.wristP, goal.wristR);
  put3(radialLog(twP, ...config.task_wrist_position));
  put3(radialLog(twR, ...config.task_wrist_rotation));

  // finger_reference: sign(d) (1 - exp(-(|d| / sigma)^2)), d = q - q_B*
  const sigma = config.finger_reference_sigma;
  for (let i = 0; i < 20; i++) {
    const d = q[6 + i] - goal.fingerRef[i];
    obs[o++] = Math.sign(d) * -Math.expm1(-((Math.abs(d) / sigma) ** 2));
  }
  if (o !== OBS_DIM) throw new Error(`encoder wrote ${o} of ${OBS_DIM} columns`);
  return { obs, surface };
}
