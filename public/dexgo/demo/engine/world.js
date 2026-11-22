// One hand + object MuJoCo world (port of mj_port.World). The MuJoCo module (@mujoco/mujoco, single threaded) is
// passed in, so this file runs unchanged in Node, a page or a worker. Units SI, poses world frame.
// Hand-agnostic (2026-11-22): the n hand joints are the given native joint names (MANO 26, Sharpa 28; source order:
// the 6 wrist joints x, y, z, rx, ry, rz, then the fingers). The hand root and the wrist link are read from the
// model's joint tree, not named: the wrist link is the body of the sixth wrist joint (rz) and the root is the parent
// body of the first one (x). MANO: sliderBar / right_wrist_rz (mj_port.HANDS["mano"]); Sharpa: sharpa_root0 /
// right_hand_C_MC (mj_port.HANDS["sharpa"]). Hand-specific physics (Sharpa's gravcomp on the hand bodies, its PhysX
// hulls) is compiled from scene.xml; nothing here depends on it.

import { matrixToQuatXyzw, mulTVec, mulVec, quatWxyzToMatrix } from './math.js';

/** MANO's body names (mj_port.HANDS["mano"]); World derives the root and wrist from the joint tree (see the header). */
export const BODY_NAMES = { root: 'sliderBar', wrist: 'right_wrist_rz', object: 'object' };
export const OBJECT_JOINT = 'object_free';

/**
 * Compile scene.xml with its mesh files in a MuJoCo virtual file system.
 * @param {object} mujoco the loaded @mujoco/mujoco module
 * @param {object} loader engine/loader.js loader rooted at the model directory
 */
export async function loadModel(mujoco, loader, xmlName = 'scene.xml') {
  const xml = await loader.text(xmlName);
  const files = [...new Set([...xml.matchAll(/\bfile="([^"]+)"/g)].map((m) => m[1]))];
  const vfs = new mujoco.MjVFS();
  try {
    const buffers = await Promise.all(files.map((f) => loader.bytes(f)));
    files.forEach((f, i) => vfs.addBuffer(f, buffers[i]));
    return mujoco.MjModel.from_xml_string(xml, vfs);
  } finally {
    vfs.delete();
  }
}

export class World {
  /**
   * @param {object} mujoco module; @param {object} model MjModel
   * @param {string[]} jointNames the n hand joints, source order (task.json / control.json native_joints)
   * @param {string[]} linkNames the 20 surface links (task.json / control.json surface_links)
   */
  constructor(mujoco, model, jointNames, linkNames) {
    this.mj = mujoco;
    this.model = model;
    this.data = new mujoco.MjData(model);
    // second MjData for geomPosesAt (forward kinematics of another configuration); made here, so the WASM heap does
    // not grow mid-run (growth detaches typed-array views of the module's memory that a caller still holds)
    this.scratch = new mujoco.MjData(model);
    const id = (type, name) => {
      const i = mujoco.mj_name2id(model, mujoco.mjtObj[type].value, name);
      if (i < 0) throw new Error(`${name} missing in the model`);
      return i;
    };
    const jid = jointNames.map((n) => id('mjOBJ_JOINT', n));
    this.n = jid.length; // hand joints: 6 wrist + the fingers
    this.qadr = Int32Array.from(jid, (j) => model.jnt_qposadr[j]);
    this.dadr = Int32Array.from(jid, (j) => model.jnt_dofadr[j]);
    const range = model.jnt_range;
    this.lower = Float64Array.from(jid, (j) => range[2 * j]);
    this.upper = Float64Array.from(jid, (j) => range[2 * j + 1]);
    this.wrist = model.jnt_bodyid[jid[5]]; // the body the rz joint moves: the wrist link
    this.root = model.body_parentid[model.jnt_bodyid[jid[0]]]; // the body the x joint hangs from: the hand root
    const name = (b) => mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b);
    this.rootName = name(this.root);
    this.wristName = name(this.wrist);
    this.obj = id('mjOBJ_BODY', BODY_NAMES.object);
    this.links = Int32Array.from(linkNames, (n) => id('mjOBJ_BODY', n));
    const fj = id('mjOBJ_JOINT', OBJECT_JOINT);
    this.oq = model.jnt_qposadr[fj];
    this.ov = model.jnt_dofadr[fj];
    this.dt = model.opt.timestep;
  }

  /**
   * Reset to one start row (mj_port.World.reset). handRoot / objectRoot (13): position, quaternion wxyz,
   * linear and angular velocity (world); q (n) hand joints. The hand root body is moved in the model.
   */
  reset(handRoot, objectRoot, q) {
    const { mj, model: m, data: d } = this;
    mj.mj_resetData(m, d);
    const bp = m.body_pos, bq = m.body_quat;
    for (let i = 0; i < 3; i++) bp[3 * this.root + i] = handRoot[i];
    for (let i = 0; i < 4; i++) bq[4 * this.root + i] = handRoot[3 + i];
    const qpos = d.qpos, qvel = d.qvel;
    for (let i = 0; i < this.n; i++) qpos[this.qadr[i]] = q[i];
    for (let i = 0; i < 7; i++) qpos[this.oq + i] = objectRoot[i];
    const r = quatWxyzToMatrix(objectRoot.slice(3, 7));
    const wBody = mulTVec(r, objectRoot.slice(10, 13)); // free joint: body-frame angular velocity
    for (let i = 0; i < 3; i++) {
      qvel[this.ov + i] = objectRoot[7 + i];
      qvel[this.ov + 3 + i] = wBody[i];
    }
    mj.mj_forward(m, d);
  }

  /**
   * The facts the policy loop reads (mj_port.World.state). q / qd and the object velocity are the current state;
   * the body poses are data.xpos / xmat as they stand. After mj_step those belong to the state before the last
   * integration (MuJoCo computes kinematics at the start of a step); callers that need poses of the current qpos
   * run mj_kinematics first (Episode.readState with freshKinematics, as mj_port.World.state since 2026-11-21).
   */
  state() {
    const d = this.data;
    const xpos = d.xpos, xmat = d.xmat, qpos = d.qpos, qvel = d.qvel;
    const pos = (b) => xpos.slice(3 * b, 3 * b + 3);
    const rot = (b) => xmat.slice(9 * b, 9 * b + 9);
    const links = new Float64Array(3 * this.links.length);
    this.links.forEach((b, i) => links.set(xpos.subarray(3 * b, 3 * b + 3), 3 * i));
    const objR = rot(this.obj);
    return {
      q: Float64Array.from(this.qadr, (a) => qpos[a]),
      qd: Float64Array.from(this.dadr, (a) => qvel[a]),
      rootP: pos(this.root), rootR: rot(this.root),
      wristP: pos(this.wrist), wristR: rot(this.wrist),
      objP: pos(this.obj), objR,
      links,
      objLin: qvel.slice(this.ov, this.ov + 3),
      objAng: mulVec(objR, qvel.subarray(this.ov + 3, this.ov + 6)),
    };
  }

  /** Current hand joint positions (n, source order). */
  jointQ(out = new Float64Array(this.n)) {
    const qpos = this.data.qpos;
    for (let i = 0; i < this.n; i++) out[i] = qpos[this.qadr[i]];
    return out;
  }

  /** Write the effort (n, source order) into qfrc_applied at the joints' dofs. */
  applyEffort(effort) {
    const f = this.data.qfrc_applied;
    for (let i = 0; i < this.n; i++) f[this.dadr[i]] = effort[i];
  }

  step() {
    this.mj.mj_step(this.model, this.data);
  }

  /** Overwrite the full qpos / qvel (test replays); kinematics are not recomputed. */
  setState(qpos, qvel) {
    this.data.qpos.set(qpos);
    this.data.qvel.set(qvel);
  }

  /**
   * World poses of every geom (12 per geom: position m, rotation row-major) as an MjData holds them (default: the
   * simulated data, poses of its last kinematics).
   */
  geomPoses(d = this.data, out = new Float64Array(12 * this.model.ngeom)) {
    const xpos = d.geom_xpos, xmat = d.geom_xmat;
    for (let g = 0; g < this.model.ngeom; g++) {
      out.set(xpos.subarray(3 * g, 3 * g + 3), 12 * g);
      out.set(xmat.subarray(9 * g, 9 * g + 9), 12 * g + 3);
    }
    return out;
  }

  /**
   * World poses of every geom (as geomPoses) in another configuration, by forward kinematics (mj_kinematics) on a
   * second MjData; the simulated data is untouched. The n hand joints at q (source order), the object body at
   * objP / objR (world, rotation row-major), any other joint as in the simulated state. The hand root pose is the
   * model's (reset() sets it). Visual use: the goal ghost (hand at the goal configuration, object at its goal pose).
   */
  geomPosesAt(q, objP, objR) {
    const { mj, model: m } = this;
    const d = this.scratch, qpos = d.qpos;
    qpos.set(this.data.qpos);
    for (let i = 0; i < this.n; i++) qpos[this.qadr[i]] = q[i];
    const quat = matrixToQuatXyzw(objR); // x, y, z, w; MuJoCo's free joint takes w, x, y, z
    for (let i = 0; i < 3; i++) qpos[this.oq + i] = objP[i];
    for (let i = 0; i < 4; i++) qpos[this.oq + 3 + i] = quat[(i + 3) % 4];
    mj.mj_kinematics(m, d);
    return this.geomPoses(d);
  }

  delete() {
    this.scratch.delete();
    this.data.delete();
    this.model.delete();
  }
}
