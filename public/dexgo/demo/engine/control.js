// Action decode (direct_delta) and the explicit PD law. Port of control/actions.py (decode_action direct_delta
// branch, executed_action, pd_effort) and geometry/transforms.py (nonlinear_wrist_action_map,
// direct_delta_wrist_target, source_target_from_world_pose). Joint vectors are source order (26): wrist x, y, z (m,
// in the root frame), wrist RxRyRz Euler (rad), then 20 finger joints (rad).

import { add3, clamp, matmul, matTmul, mulTVec, mulVec, nearestEulerXyzFromMatrix, so3Exp, sub3 } from './math.js';

/** Control constants of task.json "control" as the decoder and PD law read them. */
export function controlSpec(control) {
  if (control.mode !== 'direct_delta') throw new Error(`only direct_delta is ported, got ${control.mode}`);
  return {
    positionScale: control.position_scale, // m per unit action
    rotationScale: control.rotation_scale, // rad per unit action
    fingerScale: control.finger_scale, // rad per unit action per control step
    power: control.power,
    beta: control.beta,
    pGain: Float64Array.from(control.p_gain),
    dGain: Float64Array.from(control.d_gain),
    wristLimit: control.wrist_effort_limit, // N / Nm
    fingerLimit: control.finger_effort_limit, // Nm
  };
}

/** Odd, endpoint-preserving wrist map beta a + (1 - beta) sign(a) |a|^power (transforms.nonlinear_wrist_action_map). */
export const wristMap = (a, power, beta) => beta * a + (1 - beta) * Math.sign(a) * Math.abs(a) ** power;

/**
 * Source wrist joints (6: x, y, z in m, RxRyRz Euler in rad) of a wrist link world pose
 * (transforms.source_target_from_world_pose): the position in the hand root (sliderBar) frame, and the source Euler
 * branch of rootR^T targetR nearest currentEuler. The wrist chain of scene.xml (three slides, then hinges x, y, z,
 * no body offsets) puts right_wrist_rz exactly at these joints.
 * @param {ArrayLike<number>} rootP, rootR hand root pose, world (rotation row-major)
 * @param {ArrayLike<number>} targetP, targetR wrist link pose, world
 * @param {ArrayLike<number>} currentEuler (3) the wrist joints q[3:6] the branch stays near
 * @param {Float64Array} [out] (6) written in place (a subarray works)
 */
export function sourceTargetFromWorldPose(rootP, rootR, targetP, targetR, currentEuler, out = new Float64Array(6)) {
  out.set(mulTVec(rootR, sub3(targetP, rootP)), 0);
  out.set(nearestEulerXyzFromMatrix(matTmul(rootR, targetR), currentEuler), 3);
  return out;
}

/**
 * New PD target (26) from the policy action (decode_action, direct_delta): the wrist target is the current wrist
 * pose moved by the mapped action along the current wrist axes, converted to root-frame xyz and the source Euler
 * branch nearest the current wrist joints; fingers add finger_scale * action to the previous finger target; all
 * clipped to the joint limits.
 * @param {ArrayLike<number>} action (26) raw policy output (latent units; clipped to [-1, 1] here)
 * @param {ArrayLike<number>} q (26) current joint positions
 * @param {ArrayLike<number>} previousTarget (26)
 * @param {ArrayLike<number>} rootP, rootR  hand root (sliderBar) pose, world
 * @param {ArrayLike<number>} wristP, wristR current wrist link pose, world
 */
export function decodeAction(action, q, previousTarget, rootP, rootR, wristP, wristR, spec, lower, upper) {
  const a = Float64Array.from(action, (x) => clamp(x, -1, 1)); // executed_action
  const m = new Float64Array(6);
  for (let i = 0; i < 6; i++) m[i] = wristMap(a[i], spec.power, spec.beta);
  const dp = [spec.positionScale * m[0], spec.positionScale * m[1], spec.positionScale * m[2]];
  const dr = [spec.rotationScale * m[3], spec.rotationScale * m[4], spec.rotationScale * m[5]];
  const targetP = add3(wristP, mulVec(wristR, dp));
  const targetR = matmul(wristR, so3Exp(dr));
  const target = new Float64Array(26);
  sourceTargetFromWorldPose(rootP, rootR, targetP, targetR, [q[3], q[4], q[5]], target.subarray(0, 6));
  for (let i = 6; i < 26; i++) target[i] = previousTarget[i] + spec.fingerScale * a[i];
  for (let i = 0; i < 26; i++) target[i] = clamp(target[i], lower[i], upper[i]);
  return target;
}

/**
 * Explicit PD effort of one physics step (actions.pd_effort): p (target - q) - d qd_fd, wrist clipped to
 * +-wristLimit, fingers to +-fingerLimit. qdFd is the caller's physics-dt finite difference (q - q_prev) / dt.
 */
export function pdEffort(target, q, qdFd, spec, out = new Float64Array(26)) {
  for (let i = 0; i < 26; i++) {
    const e = spec.pGain[i] * (target[i] - q[i]) - spec.dGain[i] * qdFd[i];
    const lim = i < 6 ? spec.wristLimit : spec.fingerLimit;
    out[i] = clamp(e, -lim, lim);
  }
  return out;
}

/**
 * PD target at reset (capture.py's start rule, as export_web.golden): wrist = q; fingers
 * q - v dt + (e + d v) / p with the start row's finite-difference velocity v and effort e, dt the recording's
 * physics step (Isaac Lab 1/120 s), p / d the finger gains.
 */
export function startTarget(q, v, e, spec, dt) {
  const target = Float64Array.from(q);
  const p = spec.pGain[6], d = spec.dGain[6];
  for (let i = 6; i < 26; i++) target[i] = q[i] - v[i] * dt + (e[i] + d * v[i]) / p;
  return target;
}
