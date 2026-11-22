// The closed policy loop of mj_port.run_row: goal construction (make_goal), one control step (encode -> policy ->
// decode -> decimation x (PD effort, mj_step)), the demo gate errors (gate_errors) and the latch (latch).
// Frames: world; H = wrist link (MANO right_wrist_rz, Sharpa right_hand_C_MC); relations "object in hand" C* =
// (c_r, c_p) map object to wrist. Hand-agnostic (2026-11-22): n = 6 + nF hand joints (World.n; MANO 26, Sharpa 28),
// nF finger references.
// Chains (engine/chain.js, chain_mujoco.run_chain): resetTo() starts from a given state (a record start) instead of
// a task.json row, and setGoal() switches the goal mid-episode, keeping the PD target and the physics state.

import { decodeAction, controlSpec, pdEffort, sourceTargetFromWorldPose, startTarget } from './control.js';
import { encodeActor } from './encoder.js';
import { add3, matmul, matTmul, mulTVec, mulVec, norm3, rotationAngle, scale3, sub3, transpose } from './math.js';

/** Physics step of the recording the start rows come from (Isaac Lab, 1/120 s); the start rule's dt. */
export const START_RULE_DT = 1 / 120;
/** An episode ends when the object falls this far (m) below its start height (run_row). */
export const DROP_DISTANCE = 0.3;

const rows3 = (m) => Float64Array.from(m.flat());

/**
 * Goal of one row (mj_port.make_goal): wrist goal H* = (hR, hP), relation C* = (cR, cP) (object in hand),
 * object goal G* = H* C*, object-to-hand B = C*^-1, finger reference q_B* (nF).
 */
export function makeGoal(hP, hR, cP, cR, finger) {
  return {
    objectP: add3(hP, mulVec(hR, cP)),
    objectR: matmul(hR, cR),
    objToHandP: scale3(mulTVec(cR, cP), -1),
    objToHandR: transpose(cR),
    fingerRef: Float64Array.from(finger),
    wristP: Float64Array.from(hP),
    wristR: Float64Array.from(hR),
    relationP: Float64Array.from(cP),
    relationR: Float64Array.from(cR),
  };
}

/**
 * Hand configuration (6 + nF, source order) of a goal, for drawing the goal hand: the wrist joints that put the wrist
 * link at the wrist goal H* relative to the hand root (sourceTargetFromWorldPose, the Euler branch nearest the
 * current wrist joints), then the finger target q_B*. s: a World.state() (rootP, rootR, q).
 */
export function goalConfiguration(goal, s) {
  const q = new Float64Array(6 + goal.fingerRef.length);
  sourceTargetFromWorldPose(s.rootP, s.rootR, goal.wristP, goal.wristR, s.q.subarray(3, 6), q.subarray(0, 6));
  q.set(goal.fingerRef, 6);
  return q;
}

/** (goal position m, goal angle rad, relation position m, relation angle rad) of one state (mj_port.gate_errors). */
export function gateErrors(s, goal) {
  const relR = matTmul(s.wristR, s.objR);
  const relP = mulTVec(s.wristR, sub3(s.objP, s.wristP));
  return [
    norm3(sub3(s.objP, goal.objectP)),
    rotationAngle(matTmul(goal.objectR, s.objR)),
    norm3(sub3(relP, goal.relationP)),
    rotationAngle(matTmul(goal.relationR, relR)),
  ];
}

/** Incremental mj_port.latch: doneStep = first control step (1-based) at which the gate held holdSteps steps. */
export class Gate {
  constructor(gate) {
    this.gate = gate;
    this.run = 0;
    this.doneStep = -1;
  }

  /** @returns {boolean} whether this frame is inside the gate */
  push(step, errors, lin, ang) {
    const g = this.gate;
    const ok = errors[0] <= g.position_m && errors[1] <= g.angle_rad && errors[2] <= g.position_m
      && errors[3] <= g.angle_rad && lin <= g.linear_speed && ang <= g.angular_speed;
    this.run = ok ? this.run + 1 : 0;
    if (this.doneStep < 0 && this.run >= g.hold_steps) this.doneStep = step;
    return ok;
  }
}

export class Episode {
  /**
   * @param {object} o.world engine/world.js World; o.policy engine/policy.js Policy (or {act})
   * @param {object} o.task task.json (a chain object: {control} of objects/control.json); o.surfaceLocal (600) object-frame surface samples
   * @param {number} [o.startRuleDt] dt of the reset target rule (START_RULE_DT)
   * @param {boolean} [o.freshKinematics] recompute body poses before reading them (default true since 2026-11-21: the Python port also recomputes them)
   */
  constructor({ world, policy, task, surfaceLocal, startRuleDt = START_RULE_DT, freshKinematics = true }) {
    this.world = world;
    this.policy = policy;
    if (policy?.outputDim !== undefined && policy.outputDim !== world.n)
      throw new Error(`policy acts on ${policy.outputDim} joints, the world's hand has ${world.n}`);
    this.task = task;
    this.surfaceLocal = Float64Array.from(surfaceLocal.flat ? surfaceLocal.flat() : surfaceLocal);
    this.spec = controlSpec(task.control);
    this.encoder = task.control.encoder;
    this.decimation = task.control.decimation;
    this.policyDt = task.control.policy_dt;
    this.startRuleDt = startRuleDt;
    this.freshKinematics = freshKinematics;
    this.nStarts = task.start?.q?.length ?? 0; // a chain object's task has only "control"
    this.goal = null;
  }

  readState() {
    if (this.freshKinematics) this.world.mj.mj_kinematics(this.world.model, this.world.data);
    return this.world.state();
  }

  /** Reset to start row k (run_row before its loop). */
  reset(k) {
    const st = this.task.start, tg = this.task.goal;
    const q = Float64Array.from(st.q[k]);
    const target = startTarget(q, st.finite_difference_qd[k], st.effort[k], this.spec, this.startRuleDt);
    this.resetState(st.hand_root_local[k], st.object_root_local[k], q, target);
    this.k = k;
    const hR = matmul(rows3(tg.wrist_turn[k]), this.s.wristR);
    const hP = add3(this.s.wristP, tg.wrist_displacement[k]);
    this.setGoal(makeGoal(hP, hR, tg.relation_position[k], rows3(tg.relation_rotation[k]), tg.finger[k]));
    return this.info();
  }

  /**
   * Reset to a given state instead of a task.json row (chain_mujoco.run_chain's start: chain.js startState of a
   * record). handRoot / objectRoot (13): position, quaternion wxyz, linear and angular velocity (world); q (n) hand
   * joints; target (n) the PD target. The goal is installed with setGoal (here if given; step() needs one).
   */
  resetTo({ handRoot, objectRoot, q, target, goal = null }) {
    this.resetState(handRoot, objectRoot, q, target);
    if (goal) this.setGoal(goal);
    return this.info();
  }

  /** World reset + the episode state shared by reset() and resetTo(); no goal. */
  resetState(handRoot, objectRoot, q, target) {
    this.k = null;
    this.target = Float64Array.from(target);
    this.world.reset(handRoot, objectRoot, q);
    this.s = this.readState();
    this.prevQ = Float64Array.from(this.s.q);
    this.startZ = objectRoot[2];
    this.stepCount = 0;
    this.dropped = false;
    this.action = null;
    this.obs = null;
    this.goal = null;
    this.errors = null;
    this.gate = new Gate(this.task.control.gate);
    this.goalStep = 0;
  }

  /**
   * Install a new goal mid-episode (run_chain between nodes): the state, the PD target and the previous joint
   * positions are kept; the gate (latch) and the goal's step count restart, the errors are those of the new goal.
   */
  setGoal(goal) {
    this.goal = goal;
    this.gate = new Gate(this.task.control.gate);
    this.goalStep = 0;
    this.errors = gateErrors(this.s, goal);
  }

  /** One control step; returns info() of the state after it. */
  async step() {
    if (!this.goal) throw new Error('Episode.step: no goal installed (setGoal)');
    const w = this.world, s = this.s, spec = this.spec;
    const { obs } = encodeActor(s, this.goal, this.target, w.lower, w.upper, this.surfaceLocal, this.encoder);
    const action = await this.policy.act(obs);
    this.target = decodeAction(action, s.q, this.target, s.rootP, s.rootR, s.wristP, s.wristR, spec, w.lower, w.upper);
    this.physics(this.target);
    this.obs = obs;
    this.action = action;
    this.s = this.readState();
    this.stepCount += 1;
    this.goalStep += 1;
    this.errors = gateErrors(this.s, this.goal);
    this.gate.push(this.goalStep, this.errors, norm3(this.s.objLin), norm3(this.s.objAng));
    this.dropped = this.s.objP[2] < this.startZ - DROP_DISTANCE;
    return this.info();
  }

  /** decimation physics steps with the explicit PD effort toward target (run_row inner loop). */
  physics(target) {
    const w = this.world, dt = w.dt;
    const n = w.n, q = new Float64Array(n), fd = new Float64Array(n), effort = new Float64Array(n);
    for (let j = 0; j < this.decimation; j++) {
      w.jointQ(q);
      for (let i = 0; i < n; i++) fd[i] = (q[i] - this.prevQ[i]) / dt;
      pdEffort(target, q, fd, this.spec, effort);
      this.prevQ.set(q);
      w.applyEffort(effort);
      w.step();
    }
  }

  info() {
    return {
      start: this.k,
      step: this.stepCount,
      time: this.stepCount * this.policyDt,
      goalStep: this.goalStep, // control steps since the goal was installed (= step for one goal per episode)
      errors: this.errors,
      doneStep: this.gate.doneStep,
      latched: this.gate.doneStep > 0,
      dropped: this.dropped,
    };
  }
}
