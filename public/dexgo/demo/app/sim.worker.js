// Simulation worker: MuJoCo WASM + the v7 actor as a plain-JS MLP (engine/mlp.js, weights assets/policy/actor_mlp.*)
// + the engine loop, paced at twice real time (SPEED: one control step = policy_dt = 50 ms simulated per 25 ms wall;
// no speed control on the page, owner 2026-11-21). Two scenes:
// - chain: one object of assets/objects/index.json (its scene.xml + meshes, object.json, chain.json; the shared
//   control.json and world_facts.json named there) driven by engine/chain.js ChainRunner (built as
//   tools/chain_headless.mjs builds it, onFailure 'restart'), goal after goal; an object switch reloads the model
//   here. A failed goal (drop, or a timeout without recovery) restarts from a fresh start grasp inside the runner;
//   the worker then holds the new start still for RESTART_HOLD_MS while the page fades it in.
//   runner.available() draws from the RNG when its design changed, so it is called once per event batch that
//   installs a goal (goal / restart / recover / end) and cached here, never per frame.
// - marker: assets/models/<tag>/ with the 4 start rows of task.json, one goal per row, 500-step episodes.
// After every control step it posts the geom poses, the hand state the page skins (wrist link pose + the 20 finger
// angles) and the object body pose (its axes); whenever the goal changes, the goal (object goal pose, wrist goal H*,
// finger target q_B*) and the ghost: the poses of every geom at the goal state, by forward kinematics on a second
// MjData (World.geomPosesAt): the hand at its goal configuration (engine/loop.js goalConfiguration: the wrist joints of
// H* relative to the hand root, the fingers at q_B*), the object body at G*. All visual only.
//   main -> worker: {type: 'init', scene: 'chain', object, mode, seed} | {type: 'init', scene: 'marker', model}
//                   | {type: 'play'} | {type: 'pause'} | {type: 'reset', start?} | {type: 'object', object}
//                   | {type: 'mode', mode: 'random'|'manual'} | {type: 'queue', node}
//   worker -> main: {type: 'model', geoms, policyDt, speed, nStarts?, object?}
//                   | {type: 'frame', poses, hand, object, info, cut?, goal?, ghost?, events?, chain?}
//                   | {type: 'chain', chain} (after a mode change or a queued task: no new poses) | {type: 'error', message}
//   frame.cut: 'init' | 'load' | 'reset' | 'restart' (no interpolation from the previous frame); frame.ghost: 12 per
//   geom (position, row-major rotation), geom order (model.geoms);
//   frame.info: {step, time, simTime, playing, ...marker fields}; frame.chain: {node, phase, goalsDone, available,
//   queued, mode, stepInGoal}; goalsDone counts the 'done' events since init, Reset or an object switch.

import loadMujoco from '../vendor/mujoco/mujoco.js';
import { ChainRunner, Generator, generatorOptions, makeRng } from '../engine/chain.js';
import { fetchLoader } from '../engine/loader.js';
import { Episode, goalConfiguration } from '../engine/loop.js';
import { MlpPolicy } from '../engine/mlp.js';
import { loadModel, World } from '../engine/world.js';

const ASSETS = new URL('../assets/', import.meta.url).href;
const EPISODE_STEPS = 500; // marker scene: 25 s, as the Python runs
const RESTART_HOLD_MS = 420; // a fresh start grasp stays still while the page fades it in
// Pacing: SPEED control steps of policy_dt per policy_dt of wall time (twice real time: two steps per 50 ms). A slow
// device runs every step, all its physics steps included, as fast as it can and keeps at most one period of
// catch-up debt (no bursts, nothing skipped). slowStepMs: test-only extra busy time per control step (?slowstep=<ms>).
const SPEED = 2;

let mujoco = null, policy = null, index = null, control = null, facts = null, rng = null, available = [];
let scene = 'chain', world = null, episode = null, runner = null, objectId = null, mode = 'random';
let playing = false, timer = null, sentGoal = undefined, slowStepMs = 0;
let steps = 0; // control steps simulated since init (simulated time = steps x policy_dt)
let completed = 0; // goals completed since init, Reset or an object switch
let epoch = 0, stepping = null; // a reset / object switch invalidates a control step still awaiting the policy

const post = (msg, transfer = []) => self.postMessage(msg, transfer);

async function init(msg) {
  const assets = fetchLoader(ASSETS);
  const [mj, mlp] = await Promise.all([loadMujoco(), MlpPolicy.load(assets)]);
  mujoco = mj;
  policy = mlp;
  scene = msg.scene;
  slowStepMs = msg.slowStep ?? 0;
  if (scene === 'marker') {
    await loadMarker(msg.model);
  } else {
    const objects = fetchLoader(`${ASSETS}objects/`);
    index = await objects.json('index.json');
    [control, facts] = await Promise.all([objects.json(index.control), objects.json(index.world_facts)]);
    rng = makeRng(Number.isFinite(msg.seed) ? msg.seed : (Math.random() * 2 ** 32) >>> 0);
    mode = msg.mode ?? 'random';
    await loadObject(msg.object, 'init');
  }
}

/** Replace the world (the old one is freed once nothing refers to it). */
function setWorld(model, control) {
  const old = world;
  world = new World(mujoco, model, control.native_joints, control.surface_links);
  old?.delete();
}

async function loadMarker(tag) {
  const files = fetchLoader(`${ASSETS}models/${tag}/`);
  const [task, object] = await Promise.all([files.json('task.json'), files.json('object.json')]);
  setWorld(await loadModel(mujoco, files), task.control);
  episode = new Episode({ world, policy, task, surfaceLocal: object.grasp_samples });
  post({ type: 'model', geoms: renderGeoms(), nStarts: episode.nStarts, policyDt: episode.policyDt, speed: SPEED });
  episode.reset(0);
  sendFrame({ cut: 'init' });
}

/** Chain scene: load one object's model and chain table, build its runner and start a run. */
async function loadObject(id, cut) {
  const entry = index.objects.find((o) => o.id === id) ?? index.objects[0];
  const objects = fetchLoader(`${ASSETS}objects/`);
  const sceneDir = entry.scene.includes('/') ? entry.scene.slice(0, entry.scene.lastIndexOf('/') + 1) : '';
  const [object, table, model] = await Promise.all([objects.json(entry.object), objects.json(entry.chain),
    loadModel(mujoco, fetchLoader(`${ASSETS}objects/${sceneDir}`), entry.scene.slice(sceneDir.length))]);
  setWorld(model, control);
  episode = new Episode({ world, policy, task: { control }, surfaceLocal: object.grasp_samples });
  const generator = new Generator(table, facts, rng, generatorOptions(entry));
  runner = new ChainRunner({ episode, generator, mode, onFailure: 'restart', recover: true });
  objectId = entry.id;
  post({ type: 'model', geoms: renderGeoms(), policyDt: episode.policyDt, speed: SPEED, object: entry.id });
  startRun(cut);
}

/** A new run on the loaded object (load, Reset): fresh start grasp, goal counter 0. */
function startRun(cut) {
  completed = 0;
  runner.restart();
  available = runner.available();
  sentGoal = undefined;
  sendFrame({ cut });
}

/** Static render data of every geom: type, size, rgba, mesh vertices / faces (mesh frame), owning body. */
function renderGeoms() {
  const m = world.model, geoms = [];
  const type = m.geom_type, size = m.geom_size, rgba = m.geom_rgba, dataid = m.geom_dataid, body = m.geom_bodyid;
  const vadr = m.mesh_vertadr, vnum = m.mesh_vertnum, fadr = m.mesh_faceadr, fnum = m.mesh_facenum;
  const MESH = mujoco.mjtGeom.mjGEOM_MESH.value;
  for (let g = 0; g < m.ngeom; g++) {
    const item = {
      type: type[g], size: Array.from(size.subarray(3 * g, 3 * g + 3)), rgba: Array.from(rgba.subarray(4 * g, 4 * g + 4)),
      isObject: body[g] === world.obj,
    };
    if (type[g] === MESH && dataid[g] >= 0) {
      const id = dataid[g];
      item.vert = m.mesh_vert.slice(3 * vadr[id], 3 * (vadr[id] + vnum[id]));
      item.face = m.mesh_face.slice(3 * fadr[id], 3 * (fadr[id] + fnum[id]));
    }
    geoms.push(item);
  }
  return geoms;
}

/** The goal ghost: world poses (12 per geom) of every geom at the goal state (hand at its goal configuration, object
 *  at G*), by forward kinematics on the world's second MjData; the simulation is untouched. */
const ghostPoses = (goal) => world.geomPosesAt(goalConfiguration(goal, episode.s), goal.objectP, goal.objectR);

/** Hand state (32): right_wrist_rz world position (3) and rotation (9, row-major), finger angles q[6:26] (rad). */
function handState() {
  const d = world.data, b = world.wrist, out = new Float64Array(32);
  out.set(d.xpos.subarray(3 * b, 3 * b + 3), 0);
  out.set(d.xmat.subarray(9 * b, 9 * b + 9), 3);
  out.set(world.jointQ().subarray(6), 12);
  return out;
}

/** Object body (MuJoCo body `object`, the object frame) world position (3) and rotation (9, row-major). */
function objectState() {
  const d = world.data, b = world.obj, out = new Float64Array(12);
  out.set(d.xpos.subarray(3 * b, 3 * b + 3), 0);
  out.set(d.xmat.subarray(9 * b, 9 * b + 9), 3);
  return out;
}

/** A goal for the page (engine/loop.js makeGoal): object goal G*, wrist goal H* (world), finger target q_B* (20). */
function goalMessage(g) {
  const a = (x) => Array.from(x);
  return { objectP: a(g.objectP), objectR: a(g.objectR), wristP: a(g.wristP), wristR: a(g.wristR), finger: a(g.fingerRef) };
}

const currentGoal = () => (scene === 'marker' ? episode.goal : runner.state.goal ?? null);
const ended = () => (scene === 'marker' ? episode.stepCount >= EPISODE_STEPS || episode.dropped
  : runner.phase === 'ended');

/** Post the state after a control step (or a reset); the goal and its ghost go along whenever the goal changed. */
function sendFrame(extra = {}) {
  const poses = world.geomPoses(), hand = handState(), object = objectState();
  const msg = { type: 'frame', poses, hand, object, ...extra };
  const goal = currentGoal();
  if (goal !== sentGoal) {
    sentGoal = goal;
    msg.goal = goal ? goalMessage(goal) : null;
    msg.ghost = goal ? ghostPoses(goal) : null;
  }
  const base = { step: steps, time: steps * episode.policyDt, simTime: steps * episode.policyDt, playing };
  if (scene === 'marker') {
    const info = episode.info();
    msg.info = { ...info, ...base, end: ended() };
  } else {
    msg.info = { ...base, end: ended() };
    msg.chain = chainState();
  }
  const transfer = [poses.buffer, hand.buffer, object.buffer];
  if (msg.ghost) transfer.push(msg.ghost.buffer);
  post(msg, transfer);
}

/** The chain state the page shows (status line, graph). */
function chainState() {
  const st = runner.state;
  return { node: st.node ?? null, phase: st.phase, goalsDone: completed, available, queued: st.queued ?? null,
    mode: st.mode, stepInGoal: st.stepInGoal };
}

/** One control step; returns the extra hold (ms) before the next one. */
async function advance() {
  if (scene === 'marker') {
    await episode.step();
    steps += 1;
    if (ended()) playing = false;
    sendFrame();
    return 0;
  }
  const events = await runner.step();
  steps += 1;
  let hold = 0, cut, designChanged = false;
  for (const e of events) {
    if (e.type === 'done') completed += 1;
    else if (e.type === 'restart') { cut = 'restart'; hold = RESTART_HOLD_MS; }
    if (e.type === 'goal' || e.type === 'restart' || e.type === 'recover' || e.type === 'end') designChanged = true;
  }
  if (designChanged) available = runner.available();
  if (ended()) playing = false;
  sendFrame({ cut, events: events.map(({ type, node, reason }) => ({ type, node, reason })) });
  return hold;
}

/** Stop the loop and wait for a control step in flight; afterwards that step's result is dropped. */
async function settle() {
  const was = playing;
  pause();
  epoch += 1;
  if (stepping) await stepping.catch(() => {});
  return was;
}

function pause() {
  playing = false;
  clearTimeout(timer);
}

function play() {
  if (playing || !episode || ended()) return;
  playing = true;
  const mine = epoch;
  let due = performance.now();
  const tick = async () => {
    if (!playing || mine !== epoch) return;
    stepping = advance();
    const hold = await stepping;
    stepping = null;
    if (slowStepMs) { const end = performance.now() + slowStepMs; while (performance.now() < end); } // test only
    if (mine !== epoch || !playing) return;
    const period = (episode.policyDt * 1000) / SPEED;
    due += period + hold;
    const now = performance.now();
    if (now - due > period) due = now; // fell behind (slow device, background tab): at most one period of debt
    timer = setTimeout(tick, Math.max(0, due - now));
  };
  tick();
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init(msg);
    else if (msg.type === 'play') play();
    else if (msg.type === 'pause') { pause(); sendFrame(); }
    else if (msg.type === 'reset') {
      const was = await settle();
      if (scene === 'marker') {
        episode.reset(msg.start ?? 0);
        sendFrame({ cut: 'reset' });
      } else {
        startRun('reset');
        if (was) play();
      }
    } else if (msg.type === 'object') {
      if (scene !== 'chain' || msg.object === objectId) return;
      const was = await settle();
      await loadObject(msg.object, 'load');
      if (was) play();
    } else if (msg.type === 'mode') {
      mode = msg.mode;
      runner.setMode(mode); // an idle runner switched to random draws its node at the next step
      post({ type: 'chain', chain: chainState() });
    } else if (msg.type === 'queue') {
      runner.queue(msg.node);
      post({ type: 'chain', chain: chainState() });
    }
  } catch (err) {
    post({ type: 'error', message: String(err?.stack ?? err) });
  }
};
