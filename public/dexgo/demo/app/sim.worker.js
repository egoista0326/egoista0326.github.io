// Simulation worker: MuJoCo WASM + the v7 actor of the chosen hand as a plain-JS MLP (engine/mlp.js, weights
// <hand root>/policy/actor_mlp.*) + the engine loop, paced at twice real time (SPEED: one control step = policy_dt =
// 50 ms simulated per 25 ms wall; no speed control on the page, owner 2026-11-21). Two scenes:
// - chain: one hand (assets/hands.json, app/hands.js: MANO's root is assets/, Sharpa's its own folder; the page passes
//   the root) and one object of its objects/index.json (its scene.xml + meshes, object.json, chain.json; the shared
//   control.json and world_facts.json named there) driven by engine/chain.js ChainRunner (built as
//   tools/chain_headless.mjs builds it, onFailure 'restart'), goal after goal, with the hand's per-goal timeout
//   settings.timeout_steps of its objects/index.json (control steps without a latch; owner 2026-11-22: 1200 = 60 s
//   simulated, 30 s on screen, both hands; ChainRunner's default, chain_mujoco.py's TIMEOUT 600, stays the Python
//   runs' and the tests' value); an object or hand switch reloads the
//   model here (a hand's policy, objects index, control and world facts are fetched the first time it is chosen, then
//   kept). A failed goal (drop, or a timeout without recovery) restarts from a fresh start grasp inside the runner;
//   the worker then holds the new start still for RESTART_HOLD_MS while the page fades it in.
//   runner.available() draws from the RNG when its design changed, so it is called once per event batch that
//   installs a goal (goal / restart / recover / end) and cached here, never per frame.
// - marker: assets/models/<tag>/ with the 4 start rows of task.json, one goal per row, 500-step episodes.
// Draw stream (app/rng.js): seeded runs (?seed=<n>; the project page starts with 47, the posters' scene) keep the
// seed for the first OPENING_GOALS goals installed since init (the curated opening), then re-seed from
// crypto.getRandomValues; a Reset or an object or hand switch ends the opening early (re-seeded at once). msg.opening
// overrides the count (tests: Infinity keeps the seed for the whole run). Unseeded runs draw a crypto seed at init.
// After every control step it posts the geom poses, the hand state the page skins (wrist link pose + the finger
// angles) and the object body pose (its axes); whenever the goal changes, the goal (object goal pose, wrist goal H*,
// finger target q_B*) and the ghost: the poses of every geom at the goal state, by forward kinematics on a second
// MjData (World.geomPosesAt): the hand at its goal configuration (engine/loop.js goalConfiguration: the wrist joints of
// H* relative to the hand root, the fingers at q_B*), the object body at G*. All visual only.
// Each hand hull geom also carries its body's name and its frame in that body (geom_pos, geom_quat: the page poses a
// hand's render meshes from it, app/hands.js partOffsets). (Until review r9 round 8 a hull also carried its joint to
// the previous hull, app/hull_surface.js handJoints, for the smooth finger surfaces the page no longer draws.)
// MuJoCo's loader reports "still waiting on run dependencies" on slow downloads as console errors; those three-line
// reports are dropped (printErr), every other message still reaches the console.
//   main -> worker: {type: 'init', scene: 'chain', hand, root, object, mode, seed, opening?}
//                   | {type: 'init', scene: 'marker', model}
//                   | {type: 'play'} | {type: 'pause'} | {type: 'reset', start?} | {type: 'object', object}
//                   | {type: 'hand', hand, root, object} (hand: its id; root: its asset root relative to assets/)
//                   | {type: 'mode', mode: 'random'|'manual'} | {type: 'queue', node}
//   worker -> main: {type: 'model', geoms, policyDt, speed, nStarts?, object?, hand?}
//                   | {type: 'frame', poses, hand, object, info, cut?, goal?, ghost?, events?, chain?}
//                   | {type: 'chain', chain} (after a mode change or a queued task: no new poses)
//                   | {type: 'error', message, fatal} (fatal: init, an object switch or Reset failed)
//   'mode' and 'queue' before the first runner exists (still loading) do not throw: the mode is kept for it.
//   'mode' 'random' also clears the runner's queued task (a Manual pick never starts later by itself).
//   frame.cut: 'init' | 'load' (object) | 'hand' | 'reset' | 'restart' (no interpolation from the previous frame);
//   frame.hand: wrist link position (3), rotation (9, row-major), the n - 6 finger angles; frame.ghost: 12 per
//   geom (position, row-major rotation), geom order (model.geoms);
//   frame.info: {step, time, simTime, playing, ...marker fields}; frame.chain: {node, phase, goalsDone, available,
//   queued, mode, stepInGoal}; goalsDone counts the 'done' events since init, Reset or an object or hand switch.

import loadMujoco from '../vendor/mujoco/mujoco.js';
import { ChainRunner, Generator, generatorOptions } from '../engine/chain.js';
import { fetchLoader } from '../engine/loader.js';
import { Episode, goalConfiguration } from '../engine/loop.js';
import { MlpPolicy } from '../engine/mlp.js';
import { loadModel, World } from '../engine/world.js';
import { cryptoSeed, reseedableRng } from './rng.js';

const ASSETS = new URL('../assets/', import.meta.url).href;
const OPENING_GOALS = 10; // a seeded run keeps its seed for this many goals (the curated opening), then re-seeds
const EPISODE_STEPS = 500; // marker scene: 25 s, as the Python runs
const RESTART_HOLD_MS = 420; // a fresh start grasp stays still while the page fades it in
// Pacing: SPEED control steps of policy_dt per policy_dt of wall time (twice real time: two steps per 50 ms). A slow
// device runs every step, all its physics steps included, as fast as it can and keeps at most one period of
// catch-up debt (no bursts, nothing skipped). slowStepMs: test-only extra busy time per control step (?slowstep=<ms>).
const SPEED = 2;

let mujoco = null, policy = null, index = null, control = null, facts = null, rng = null, available = [];
let scene = 'chain', world = null, episode = null, runner = null, objectId = null, mode = 'random';
let handId = null; // the loaded hand (assets/hands.json id)
const hands = new Map(); // hand id -> {policy, index, control, facts}, loaded the first time the hand is chosen
let opening = 0, goalsDrawn = 0; // goals the seed is kept for (0: re-seeded); goals installed since init
let playing = false, timer = null, sentGoal = undefined, slowStepMs = 0;
let steps = 0; // control steps simulated since init (simulated time = steps x policy_dt)
let completed = 0; // goals completed since init, Reset or an object switch
let epoch = 0, stepping = null; // a reset / object switch invalidates a control step still awaiting the policy

const post = (msg, transfer = []) => self.postMessage(msg, transfer);

/** Emscripten's stderr: drop its periodic "still waiting on run dependencies:" report (the line, its "dependency: ..."
 *  lines and "(end of list)"; normal on a slow connection), pass everything else to console.error. */
let waitingReport = false;
function printErr(text) {
  const line = String(text);
  if (line.startsWith('still waiting on run dependencies')) { waitingReport = true; return; }
  if (waitingReport && (line.startsWith('dependency:') || line === '(end of list)')) {
    if (line === '(end of list)') waitingReport = false;
    return;
  }
  waitingReport = false;
  console.error(line);
}

async function init(msg) {
  scene = msg.scene;
  slowStepMs = msg.slowStep ?? 0;
  if (scene === 'marker') { // MANO's single-goal scene (assets/models/)
    [mujoco, policy] = await Promise.all([loadMujoco({ printErr }), MlpPolicy.load(fetchLoader(ASSETS))]);
    await loadMarker(msg.model);
  } else {
    [mujoco] = await Promise.all([loadMujoco({ printErr }), useHand(msg.hand, msg.root)]);
    const seeded = Number.isFinite(msg.seed);
    rng = reseedableRng(seeded ? msg.seed : cryptoSeed());
    opening = seeded ? (msg.opening ?? OPENING_GOALS) : 0;
    mode = msg.mode ?? mode; // (the page enables its mode tabs only once a runner exists)
    await loadObject(msg.object, 'init');
  }
}

/** Make a hand current: its policy, objects index (its settings.timeout_steps checked here), control block and world
 *  facts (fetched once, from its root). */
async function useHand(id, root) {
  if (!hands.has(id)) {
    const base = new URL(root, ASSETS).href, objects = fetchLoader(new URL('objects/', base).href);
    const [mlp, idx] = await Promise.all([MlpPolicy.load(fetchLoader(base)), objects.json('index.json')]);
    const timeout = idx.settings?.timeout_steps; // the runner's per-goal timeout (loadObject); no silent default
    if (!Number.isInteger(timeout) || timeout < 1) {
      throw new Error(`${id} objects/index.json: settings.timeout_steps ${timeout}`);
    }
    const [ctl, fct] = await Promise.all([objects.json(idx.control), objects.json(idx.world_facts)]);
    hands.set(id, { policy: mlp, index: idx, control: ctl, facts: fct, objectsUrl: new URL('objects/', base).href });
  }
  ({ policy, index, control, facts } = hands.get(id));
  handId = id;
}

/** End the seeded opening: the stream continues from a crypto seed (after OPENING_GOALS goals, a Reset or a switch). */
function endOpening() {
  if (!opening) return;
  opening = 0;
  rng.reseed(cryptoSeed());
}

/** Count the goals a batch of runner events installed; the opening ends after its last goal is installed (the next
 *  goal is drawn from the new stream). */
function countGoals(events) {
  goalsDrawn += events.filter((e) => e.type === 'goal').length;
  if (opening && goalsDrawn >= opening) endOpening();
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

/** Chain scene: load one object's model and chain table, build its runner and start a run (resume: startRun). */
async function loadObject(id, cut, resume = false) {
  const entry = index.objects.find((o) => o.id === id) ?? index.objects[0];
  const base = hands.get(handId).objectsUrl, objects = fetchLoader(base);
  const sceneDir = entry.scene.includes('/') ? entry.scene.slice(0, entry.scene.lastIndexOf('/') + 1) : '';
  const [object, table, model] = await Promise.all([objects.json(entry.object), objects.json(entry.chain),
    loadModel(mujoco, fetchLoader(new URL(sceneDir, base).href), entry.scene.slice(sceneDir.length))]);
  setWorld(model, control);
  episode = new Episode({ world, policy, task: { control }, surfaceLocal: object.grasp_samples });
  const generator = new Generator(table, facts, rng, generatorOptions(entry));
  runner = new ChainRunner({ episode, generator, mode, onFailure: 'restart', recover: true,
    timeout: index.settings.timeout_steps });
  objectId = entry.id;
  post({ type: 'model', geoms: renderGeoms(), policyDt: episode.policyDt, speed: SPEED, object: entry.id,
    hand: handId });
  startRun(cut, resume);
}

/** A new run on the loaded object (load, Reset): fresh start grasp, goal counter 0. resume: the loop ran when the
 *  switch or Reset began (settle); it continues at once, and the run's first frame already reports it running, so
 *  the page never shows a one-step 'paused' state that a click or a test could act on (timeout_cmp/NOPLAY.md). */
function startRun(cut, resume = false) {
  completed = 0;
  const events = runner.restart();
  available = runner.available();
  countGoals(events);
  sentGoal = undefined;
  const resumes = resume && !ended();
  sendFrame({ cut }, resumes);
  if (resumes) play();
}

/** Static render data of every geom: type, size, rgba, mesh vertices / faces (mesh frame), whether it is the object's;
 *  a hand geom also its body's name and its frame in that body ({p: geom_pos, q: geom_quat w x y z}). */
function renderGeoms() {
  const m = world.model, geoms = [];
  const type = m.geom_type, size = m.geom_size, rgba = m.geom_rgba, dataid = m.geom_dataid, body = m.geom_bodyid;
  const vadr = m.mesh_vertadr, vnum = m.mesh_vertnum, fadr = m.mesh_faceadr, fnum = m.mesh_facenum;
  const MESH = mujoco.mjtGeom.mjGEOM_MESH.value, BODY = mujoco.mjtObj.mjOBJ_BODY.value;
  for (let g = 0; g < m.ngeom; g++) {
    const item = {
      type: type[g], size: Array.from(size.subarray(3 * g, 3 * g + 3)), rgba: Array.from(rgba.subarray(4 * g, 4 * g + 4)),
      isObject: body[g] === world.obj,
    };
    if (!item.isObject && body[g] > 0) {
      item.body = mujoco.mj_id2name(m, BODY, body[g]);
      item.local = { p: Array.from(m.geom_pos.subarray(3 * g, 3 * g + 3)), q: Array.from(m.geom_quat.subarray(4 * g, 4 * g + 4)) };
    }
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

/** Hand state (12 + n - 6): the wrist link's world position (3) and rotation (9, row-major), the finger angles
 *  q[6:n] (rad; MANO 20, Sharpa 22). */
function handState() {
  const d = world.data, b = world.wrist, out = new Float64Array(12 + world.n - 6);
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

/** A goal for the page (engine/loop.js makeGoal): object goal G*, wrist goal H* (world), finger target q_B* (n - 6). */
function goalMessage(g) {
  const a = (x) => Array.from(x);
  return { objectP: a(g.objectP), objectR: a(g.objectR), wristP: a(g.wristP), wristR: a(g.wristR), finger: a(g.fingerRef) };
}

const currentGoal = () => (scene === 'marker' ? episode.goal : runner.state.goal ?? null);
const ended = () => (scene === 'marker' ? episode.stepCount >= EPISODE_STEPS || episode.dropped
  : runner.phase === 'ended');

/** Post the state after a control step (or a reset); the goal and its ghost go along whenever the goal changed.
 *  resuming: the loop restarts right after this frame (startRun), which then reports playing. */
function sendFrame(extra = {}, resuming = false) {
  const poses = world.geomPoses(), hand = handState(), object = objectState();
  const msg = { type: 'frame', poses, hand, object, ...extra };
  const goal = currentGoal();
  if (goal !== sentGoal) {
    sentGoal = goal;
    msg.goal = goal ? goalMessage(goal) : null;
    msg.ghost = goal ? ghostPoses(goal) : null;
  }
  const base = { step: steps, time: steps * episode.policyDt, simTime: steps * episode.policyDt,
    playing: playing || resuming };
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
  countGoals(events);
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
        endOpening();
        startRun('reset', was);
      }
    } else if (msg.type === 'object') {
      if (scene !== 'chain' || msg.object === objectId) return;
      const was = await settle();
      endOpening();
      await loadObject(msg.object, 'load', was);
    } else if (msg.type === 'hand') {
      if (scene !== 'chain' || msg.hand === handId) return;
      const was = await settle();
      endOpening();
      await useHand(msg.hand, msg.root);
      await loadObject(msg.object, 'hand', was);
    } else if (msg.type === 'mode') {
      mode = msg.mode; // before the first runner exists (still loading) it is only remembered for it
      if (!runner) return;
      runner.setMode(mode); // an idle runner switched to random draws its node at the next step
      // Random chain forgets a Manual pick, as the page does (main.js wantedNext): the runner's random draw never
      // reads `queued`, so a kept pick would start by itself after the next switch to Manual (review r9 round 5).
      if (mode === 'random') runner.queued = null;
      post({ type: 'chain', chain: chainState() });
    } else if (msg.type === 'queue') {
      if (!runner) return;
      runner.queue(msg.node);
      post({ type: 'chain', chain: chainState() });
    }
  } catch (err) {
    // fatal: nothing runs afterwards (the page shows that the demo could not start); else the page only logs it
    const fatal = msg.type === 'init' || msg.type === 'object' || msg.type === 'hand' || msg.type === 'reset';
    post({ type: 'error', message: String(err?.stack ?? err), fatal });
  }
};
