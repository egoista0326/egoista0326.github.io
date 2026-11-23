// Viewer page of the DexGO demo. Two scenes:
// - chain (default): the long-horizon mode. One hand of assets/hands.json (tabs "MANO" | "Sharpa"; app/hands.js) and
//   goal after goal on one object of that hand's objects/index.json (MANO: assets/objects/index.json): "Random
//   chain" draws each next task at random among the available ones, "Manual" waits for a click on an available node
//   of the prerequisite graph (app/graph.js). A failed goal (timeout or drop, decided by engine/chain.js) restarts
//   from a fresh start grasp, shown as a quick fade-in.
// - marker (?scene=marker): the single-goal check scene on assets/models/<?model=m_marker> (4 start rows of task.json).
// The simulation runs in app/sim.worker.js paced at twice real time (no speed control); this page renders the poses
// it posts after each control step, interpolated over one wall period of a control step (longer while frames arrive
// late on a slow device, so the motion stays continuous). MuJoCo is z-up, metres.
// Look of the project videos (runs/demo/20261119_everyday_L_render; render_scene.py, overlay.py of the demo line):
// - Hand: with assets/mano_local/ (licensed MANO data, local preview only), the MANO skin (engine/mano_skin.js) from
//   the interpolated wrist pose and finger angles, subdivided once (engine/skin_surface.js) and textured with the
//   renders' baked skin albedo; its 16 convex colliders are hidden (marker scene: "Show colliders" overlays them).
//   Without the albedo: flat skin colour. Without mano_local/, or with SKIN = false in app/config.js (the public
//   build, which then requests nothing from mano_local/): the colliders are the hand, the angular look of the first
//   public demo (owner 2026-11-22: the smooth "skin" surfaces of review r9 rounds 1-7, app/hull_surface.js, were
//   rejected as unnatural): each of MANO's 16 convex hulls drawn as it is (its own vertices and faces; creased
//   normals: a hard edge wherever two faces meet at more than 45 deg), the digit bases as the colliders are, in a flat
//   skin tone with the skin's roughness and specular, no sheen. app/hull_surface.js is no longer imported.
// - Hands with look "visual" in assets/hands.json (Sharpa): the hand's own render meshes (visual.json / visual.bin of
//   tools/export_hand_visual.py, the URDF's visual meshes decimated), each posed from its link's collider geom
//   (app/hands.js partOffsets), creased normals; the silvery grey shell and green fingertip pads of the project
//   video's Sharpa clips (owner 2026-11-22; LOOK.visual); its colliders are hidden (still posed: the follow camera
//   reads them). The goal hand is the same meshes in the collider goal hand's one-layer grey. Fetched only when that
//   hand is chosen.
// - Light: the renders' three studio softboxes as directional lights (one casts soft shadows), a RoomEnvironment
//   PMREM environment, ACES filmic tone mapping; a visual-look hand takes its own, lower share of the environment
//   (LOOK.visual fill), so its shading keeps the video's contrast.
// - Goal ghost: goal object (paper green, 40 % per surface) and goal hand (cool grey: wrist goal H*, finger target
//   q_B*), drawn in a first pass UNDER the real frame (the videos' target layer composited under the frame), so they
//   never hide the real hand or object. A new goal fades in over 0.28 s. The worker sends the poses of every geom at
//   the goal state (forward kinematics on a second MjData). The goal hand is the MANO skin at the goal (a 2 mm inflated
//   shell) with the skin, else the same 16 collider hulls at those poses: drawn after the goal object as ONE layer (a
//   depth pre-pass, then only its nearest surface, LOOK.ghostHandOpacity), so its fingers show through the goal object
//   and overlapping hulls do not stack into dark blots. A visual-look hand (Sharpa): its render meshes in that layer.
// - Axes: object frame solid, goal frame dashed at 50 %, screen space on top (app/axes_overlay.js).
// - Camera: chain scene a follow camera (section "follow camera" below: it fits hand, object and goal ghost; with
//   ?camera=fixed the fixed camera per object, aimed at the start grasp with the relocation range in view); marker
//   scene between the start and the goal. Drag to orbit (two fingers on touch screens); Ctrl / Cmd + wheel or a pinch
//   zooms. A plain wheel and one-finger swipes scroll the page around the demo (it sits in an iframe of the page).
// - Rendering stops when nothing moves (paused and settled), when the document is hidden and when the view is off
//   screen; the simulation worker is paused in the same three cases.
// Everything here is visual: physics, observations and policy run on the colliders in the worker.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { fetchLoader } from '../engine/loader.js';
import { AxesOverlay } from './axes_overlay.js';
import { SKIN } from './config.js';
import { ROWS, TaskGraph, taskWords } from './graph.js';
import { decodeVisual, partOffsets, resolveHands } from './hands.js';

const params = new URLSearchParams(location.search);
const SCENE = params.get('scene') === 'marker' ? 'marker' : 'chain';
const MODEL = params.get('model') ?? 'm_marker'; // marker scene
const SEED = params.has('seed') ? Number(params.get('seed')) : null; // chain scene: reproducible runs
// seeded runs keep the seed for this many goals, then re-seed (the worker's OPENING_GOALS, 10, without the parameter;
// tests that replay a whole Node chain pass ?opening=Infinity)
const OPENING = params.has('opening') ? Number(params.get('opening')) : undefined;
// The worker owns the playback speed (twice real time) and reports it with the model; interpolation follows its wall
// period, while the camera smoothing, ghost fade, restart fade and notes keep wall time.
const SLOW_STEP = Number(params.get('slowstep')) || 0; // test only: extra busy ms per control step in the worker
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('play'), playLabel: $('play-label'), reset: $('reset'), setup: $('setup'), pop: $('setup-pop'),
  setupHand: $('setup-hand'), setupObject: $('setup-object'), view: $('view'), axes: $('axes'), loading: $('loading'),
  colliders: $('colliders'), collidersToggle: $('colliders-toggle'), objects: $('objects'), hands: $('hands'),
  modes: [...document.querySelectorAll('[data-mode]')], code: $('task-code'), words: $('task-words'),
  goals: $('goals'), note: $('note'), graph: $('graph'), marker: $('marker-status'), announce: $('announce'),
};
document.body.dataset.scene = SCENE;
const LOCAL = new URL('../assets/mano_local/', import.meta.url).href;
const ASSETS = new URL('../assets/', import.meta.url).href;

// --------------------------------------------------------------------------------------------- embedding page
// The project page (LazyDemo.astro) keeps its poster over this frame until the first frame is drawn
// ('dexgo-demo-ready'), and shows the failure sentence instead of its loading line when the demo cannot start
// ('dexgo-demo-failed', {message, retry}: retry, whether loading again can help, i.e. anything but a missing WebGL 2;
// the page then offers "Try again", which reloads this frame). Same origin only; nothing is posted when the page is
// opened alone.
// While embedded it also reports whether the simulation runs ('dexgo-demo-running', {running}): Play / Pause, the view
// leaving the screen, a hidden tab or the chain's end; the page suspends its own clips only while the demo runs in view.
// With every model (start, hand and object switches) it reports the hand and the object ('dexgo-demo-hand', {hand,
// first, object, firstObject}: the hands.json id, whether it is the first entry; the object's label slug, the
// ?object= value, whether it is the first of that hand's list), so the page's "Open in a new tab" opens the same hand
// and object (?hand=<id>&object=<slug>, each left out when it is the first).
// After a keyboard start the page sends 'dexgo-focus': "Pause demo" takes the focus with a visible ring.
// The page's nav "Pause all motion" / "Play all motion" arrives as 'dexgo-pause' {paused} (only when the visitor presses
// it, never at Start): paused stops a running demo (pausedByPage); a play resumes it only if that pause stopped it and
// the visitor has not since pressed Play / Pause or Reset or picked a node in the demo, so the nav never overrides a
// choice made in the demo.
const FAILED = 'The demo could not load.'; // a failed download or model load; details go to the console
const NO_WEBGL = 'The demo needs WebGL 2, which this browser has turned off or does not support.';
const EMBEDDED = window.parent !== window;
if (EMBEDDED) { // one main landmark and one h1 on the project page (axe landmark-unique, heading-order)
  document.querySelector('.demo[role="main"]')?.removeAttribute('role');
  document.querySelector('.demo > h1')?.remove();
}
function tellPage(type, extra = {}) {
  if (!EMBEDDED) return;
  window.parent.postMessage({ type, message: '', ...extra }, location.origin);
}
// a hand or object switch under way, from the click until its model arrives (or a hand's files fail to download):
// {timer, shownAt} (the delayed loading line of a hand or object switch; when it was shown, 0 while not); null
// otherwise (beginSwitch, endSwitch)
let switching = null;
// a switch's loading line still on screen after its switch ended, until it has been up LINE_MIN_MS: {since, timer}
// (endSwitch); null otherwise
let lineHold = null;
/** The demo cannot start (no WebGL 2, a failed download or model load): say so in the view and to the page. */
function fail(detail, message = FAILED) {
  clearTimeout(switching?.timer); // a pending switch's loading line would replace the sentence
  clearTimeout(lineHold?.timer); // a held switch line would hide it
  lineHold = null;
  ui.loading.hidden = false;
  ui.loading.textContent = message;
  console.error(detail);
  tellPage('dexgo-demo-failed', { message, retry: message !== NO_WEBGL });
}
let focusWanted = false; // the page asked for the focus before the controls were enabled
let pausedByPage = false; // the page's nav pause stopped the demo; its play resumes it (cleared by a choice in the demo)
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return;
  if (e.data?.type === 'dexgo-pause') {
    pageWantsPause(e.data.paused === true);
    return;
  }
  if (e.data?.type !== 'dexgo-focus') return;
  if (ui.play.disabled) focusWanted = true;
  else ui.play.focus({ focusVisible: true });
});

// --------------------------------------------------------------------------------------------- look (video values)
const linear = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const LOOK = {
  // render_scene.py _lighting in the video batches: disc softboxes at subject + offset (m, world), energy (W);
  // view exposure -1 stop. Directional intensity = energy / (pi |offset|^2) x 2^exposure x LIGHT_SCALE (on-axis
  // irradiance of a Lambertian disc; LIGHT_SCALE matches the rendered brightness by eye, three.js has no Filmic).
  lights: [[0.35, -0.48, 0.65, 25.2], [-0.4, -0.12, 0.25, 13.2], [0.25, 0.35, 0.4, 24.0]],
  exposure: -1,
  lightScale: 0.5,
  environment: 0.35, // RoomEnvironment intensity (the renders' world: (0.78, 0.83, 0.9) at strength 0.18)
  toneExposure: 1.1, // by eye: mean back-of-hand sRGB (197, 166, 146) vs (201, 167, 137) in the screwdriver poster
  skinFlat: 0xe6c3a0, // without the albedo
  colliderSkin: 0xb4826c, // the colliders drawn as the hand (no skin): rendered like the textured skin's mean tone
  shadowIntensity: 0.7, // the key light's shadow (hand on object and on itself): 70 % dark, so no crevice goes black
  // everyday_L.py GOAL: --ghost-color 0.2711,0.5024,0.4737 --ghost-opacity 0.4 --hand-color 0.36,0.385,0.375
  // --hand-opacity 0.4 --hand-inflate 0.002 (linear RGB; roughness 0.5, overlay.GHOST). The collider goal hand (public
  // build) is a dark, cool, matte grey at a low opacity, drawn as one layer: the video's 0.36 grey at 40 % read at
  // about 217/255 on white (1.4:1) and vanished inside the goal object (review r9 round 2); at 64 % it read at 159/255,
  // darker than the real hand (round 3). At 42 % (seeds 3, 7, 12, 20 samples each, isolated renders): median 192/255 on
  // white, RGB about (189, 192, 195), 23 levels under the real hand's median; over the goal object it changes the
  // luminance by 13.7 or more at the 5th percentile (a lighter grey at 64 % matched the goal object's luminance on its
  // lit palm).
  // a visual-look hand (Sharpa): the look of the project video's Sharpa clips (owner 2026-11-22), material N1 of
  // runs/demo/20261116_sharpa_variety/render/material_test.py (render_multi.py --sharpa-body 0.30,0.30,0.30
  // --sharpa-pad 0.0331,1.0,0.0331, Principled, linear RGB): mid-grey shell roughness 0.45, metallic 0, specular 0.5;
  // the URDF's green elastomer pads rgba (0.2, 1, 0.2) read as sRGB #33FF33, roughness 0.7; Cycles, Filmic Medium High
  // Contrast, exposure -1, world (0.78, 0.83, 0.9) at 0.18. The 0.30 grey reads silvery there: lit faces near white
  // under the large softboxes, a broad specular sheen, crevices and turned-away faces dark under the dim world.
  // Here (ACES, three directional lights, one shadow, no ambient occlusion) the same values render flat and bright, so
  // these are matched to the video frames (tools/sharpa_material.mjs vs tools/sharpa_video_stats.py, README "Sharpa
  // material"): `fill` = the hand's own environment intensity (envMapIntensity; the scene's is LOOK.environment),
  // `specular` = specularIntensity (1 = F0 0.04). Shell sRGB grey p25 / p50 / p75 / p95 161 / 178 / 204 / 226 vs the
  // video's hand 133 / 182 / 213 / 234; pads median (111, 210, 106) vs (101, 231, 101) (ACES moves a bright saturated
  // green toward yellow-white: the URDF green renders (188, 237, 146); this one is near the closest ACES reaches).
  // Was (r9 round 8, 2026-11-22, a wrong spec) a near-white shell 0.62 with near-black pads 0.02.
  visual: {
    shell: { color: linear(0.25, 0.25, 0.25), roughness: 0.4, specular: 1.8, fill: 0.05 },
    pad: { color: linear(0, 0.45, 0.04), roughness: 0.7, specular: 1, fill: 0 },
  },
  visualCrease: Math.PI / 5, // normals smooth across fillets, sharp at shell edges (angle between faces > 36 deg)
  ghostObject: linear(0.2711, 0.5024, 0.4737),
  ghostHand: linear(0.36, 0.385, 0.375), // the MANO skin's goal hand (local preview)
  ghostColliderHand: linear(0.05, 0.06, 0.068), // matte (roughness 0.85): no bright highlight that would blend into the goal object
  ghostOpacity: 0.4,
  ghostHandOpacity: 0.42, // the collider goal hand, one layer
  ghostInflate: 0.002,
  ghostFadeMs: 280, // a new goal fades in
  // everyday_L.py compose(): axis length min(0.15 x ortho_scale (the longer image side), 0.10 m), 8 px at 1280 px
  axisFraction: 0.15, axisMax: 0.10, axisWidth: 8, axisReference: 1280,
};
const GHOST = 1; // render layer of the goal ghost
const CAMERA_DIRECTION = new THREE.Vector3(0.5, -0.75, 0.42).normalize(); // default view, from the target
// Chain scene: a fixed camera per object with a narrow field of view (closer to the videos' orthographic camera, so a
// hand relocated toward the camera barely grows). Framed on measured motion: Node runs of random chains (4 x 3
// simulated minutes, both rods, the worker's construction) sampled the 16 hand collider centres and the rod ends
// (20 cm rods) every 0.25 s, and the goal rods' ends, relative to the start hand-object midpoint. The rods start
// along about (0.64, -0.77, 0.10), so the view looks from azimuth 225 deg, elevation 35 deg: rod side-on, the
// fingers around it in view (azimuth 45 deg shows the back of the hand and cut the wrist on phones). Projected on
// that image plane, all samples lie in a box of half size 0.239 x 0.227 m centred at the world offset
// (-0.003, 0.028, 0.025) m from the start midpoint (the wrist goals lie within +-0.10 m xy / +-0.04 m z of home).
// The distance fits that box plus FRAME_MARGIN to the view's aspect; projected with this camera (perspective
// included), no sample point leaves the view (worst 0.95 of the half view). Tighter boxes cut the hand or a rod end
// in 0.97 % (0.05-99.95th percentile box) or 4.1 % (0.2-99.8th) of the desktop samples.
const CHAIN_FOV = 24; // deg, vertical (the marker scene keeps 40)
const CHAIN_VIEW = { direction: [-0.579, -0.579, 0.574], offset: [-0.003, 0.028, 0.025], half: [0.239, 0.227] };
// Small views (the page's phone frame): the full box gives about 700 px per metre at 390 px width, a hand of about
// 90 px. Where the full box gives less than MIN_SCALE px per metre at the target, the frame fits the 0.5-99.5th
// percentile box instead (half 0.160 x 0.130 m at (-0.018, 0.012, -0.006) m): about 1000 px per metre at 390 px
// width. Projected on the same samples, a hand collider (1.2 cm radius) then crosses the edge in 0.8 % (390 x 498
// view, the 390 x 844 frame) to 1.5 % (390 x 347, the 390 x 693 frame) of the samples, a rod tip in 3.7 % to 11 %
// (README "Viewer").
const CHAIN_TIGHT = { offset: [-0.018, 0.012, -0.006], half: [0.160, 0.130] };
const MIN_SCALE = 900; // px per metre at the target
const FRAME_MARGIN = 0.035; // m, added to each half size (collider hulls around their centres)

// --------------------------------------------------------------------------------------------- scene
let renderer = null;
try { // three.js r187 needs WebGL 2: checked first, so a browser without it gets the message instead of three's error
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) throw new Error('WebGL 2 is not available');
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
} catch (err) {
  fail(`The demo needs WebGL 2: ${err?.message ?? err}`, NO_WEBGL);
}
// Without WebGL nothing below can run: module evaluation stops here (no worker, no downloads); the message stays.
if (!renderer) await new Promise(() => {});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK.toneExposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // Vogel-disk PCF, soft with shadow.radius
renderer.shadowMap.autoUpdate = false; // updated once per frame, in the main pass
renderer.autoClear = false;
ui.view.insertBefore(renderer.domElement, ui.axes);
renderer.domElement.setAttribute('role', 'img'); // the view's name (axe: a label needs a role; the div has none)
renderer.domElement.setAttribute('aria-label',
  '3D view of the hand and the object; drag to rotate, Ctrl + scroll or pinch to zoom');
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = LOOK.environment;
const camera = new THREE.PerspectiveCamera(SCENE === 'chain' ? CHAIN_FOV : 40, 1, 0.01, 20);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Page scrolling (the demo sits in an iframe of the project page): the plain wheel and one-finger swipes scroll the
// page; Ctrl / Cmd + wheel zooms (a trackpad pinch arrives as Ctrl + wheel); two fingers orbit and pinch-zoom.
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
// Never under the floor: the polar angle from the up axis (+z, camera.up above) stays within 10-95 deg, an elevation
// of 80 to -5 deg seen from the target (an unclamped drag reached -90 deg: the view looked up through the floor grid
// at the unlit back of the hand). The default views (35 deg chain, 25 deg marker) lie inside; turning about the
// vertical stays free.
controls.minPolarAngle = THREE.MathUtils.degToRad(10);
controls.maxPolarAngle = THREE.MathUtils.degToRad(95);
renderer.domElement.style.touchAction = 'pan-y'; // OrbitControls sets 'none'
const zoomHint = $('zoom-hint');
if (/Mac|iPhone|iPad/.test(navigator.platform)) zoomHint.textContent = '\u2318 + scroll to zoom';
let hintTimer = 0;
// Ctrl / Cmd + wheel zooms here, never in OrbitControls: three's OrbitControls takes a Ctrl + wheel whose Control
// keydown its own document did not see (keyboard focus in the embedding page) for a trackpad pinch and multiplies it
// by 10 (review r9 round 3: -40 % per notch, the camera ended inside the rod). One rule for a mouse notch and a pinch:
// the distance to the target scales by exp(ZOOM.rate x px), px = deltaY in pixels clamped to +-ZOOM.clampPx (a 100 px
// notch -10.4 % / +11.6 %; a trackpad pinch event of 1-10 px 0.1-1.1 %), within ZOOM.range x the automatic distance
// (setZoomBounds; OrbitControls applies the same bounds to the two-finger pinch on touch screens).
const ZOOM = { rate: 0.0011, clampPx: 150, range: [0.35, 3] };
let zoomBase = 0; // the automatic camera distance (m) the zoom bounds refer to
/** Bound the viewer's zoom to ZOOM.range x the automatic distance (the fixed camera's, or the follow camera's). */
function setZoomBounds(distance) {
  zoomBase = distance;
  controls.minDistance = ZOOM.range[0] * distance;
  controls.maxDistance = ZOOM.range[1] * distance;
}
const zoomOffset = new THREE.Vector3();
function zoomWheel(e) {
  const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1); // lines / pages -> px
  const scale = Math.exp(ZOOM.rate * THREE.MathUtils.clamp(px, -ZOOM.clampPx, ZOOM.clampPx));
  zoomOffset.subVectors(camera.position, controls.target);
  const distance = zoomOffset.length();
  if (!(distance > 0) || !(zoomBase > 0)) return;
  const next = THREE.MathUtils.clamp(distance * scale, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).addScaledVector(zoomOffset, next / distance);
  controls.update(); // the follow camera then keeps this distance (follow.manual) until Reset or an object switch
  kick();
}
ui.view.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) { // zoom (a trackpad pinch arrives as Ctrl + wheel); no page zoom, no OrbitControls
    e.preventDefault();
    e.stopPropagation();
    zoomWheel(e);
    return;
  }
  e.stopPropagation(); // never reaches OrbitControls: the page scrolls
  zoomHint.classList.add('is-shown');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => zoomHint.classList.remove('is-shown'), 1400);
}, { capture: true, passive: false });
const axes = new AxesOverlay(ui.axes);

const studio = LOOK.lights.map(([x, y, z, energy], i) => {
  const offset = new THREE.Vector3(x, y, z);
  const light = new THREE.DirectionalLight(0xffffff,
    (energy / (Math.PI * offset.lengthSq())) * 2 ** LOOK.exposure * LOOK.lightScale);
  light.layers.enableAll(); // also lights the ghost pass
  if (i === 0) { // the key light casts soft shadows (hand on object and on itself)
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -0.22, right: 0.22, top: 0.22, bottom: -0.22, near: 0.2, far: 2.2 });
    light.shadow.radius = 3;
    light.shadow.intensity = LOOK.shadowIntensity;
    light.shadow.bias = -0.0003;
    light.shadow.normalBias = 0.0015;
  }
  scene.add(light, light.target);
  return { light, direction: offset.normalize() };
});

/** Aim the studio at the subject (the lights keep the renders' world directions; the shadow box is centred here). */
function aimStudio(center) {
  for (const { light, direction } of studio) {
    light.target.position.copy(center);
    light.position.copy(center).addScaledVector(direction, 1.2);
  }
}

function resize() {
  const { clientWidth: w, clientHeight: h } = ui.view;
  // the Mode segmented control over the view's top-left corner (stacked layout; Pause / Reset sit there too when a
  // layout puts them over the view): the follow camera keeps the span below it
  const view = ui.view.getBoundingClientRect();
  follow.reserve = Math.max(0, ...[ui.play.parentElement, ui.modes[0].parentElement].map((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > view.top && r.top < view.bottom ? Math.ceil(r.bottom - view.top) + 6 : 0;
  }));
  renderer.setSize(w, h, false);
  axes.resize(w, h, renderer.getPixelRatio());
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  if (w !== follow.size?.[0] || h !== follow.size?.[1]) follow.frozen = false; // re-fit at a new size
  follow.size = [w, h];
  kick(); // redraw at the new size (the loop may be stopped)
}
new ResizeObserver(resize).observe(ui.view);

/** three.js geometry of one MuJoCo geom (mjtGeom: 0 plane, 2 sphere, 3 capsule, 4 ellipsoid, 5 cylinder, 6 box, 7 mesh).
 *  A mesh (the object's convex pieces, MANO's 16 hulls) is drawn as it is: its own vertices and faces, creased normals
 *  (the public collider hand's angular look, owner 2026-11-22). */
function geometryOf(g) {
  const [a, b, c] = g.size;
  switch (g.type) {
    case 0: return new THREE.PlaneGeometry(2 * (a || 1), 2 * (b || 1));
    case 2: return new THREE.SphereGeometry(a, 24, 16);
    case 3: return new THREE.CapsuleGeometry(a, 2 * b, 8, 16).rotateX(Math.PI / 2);
    case 4: return new THREE.SphereGeometry(1, 24, 16).scale(a, b, c);
    case 5: return new THREE.CylinderGeometry(a, a, 2 * b, 24).rotateX(Math.PI / 2);
    case 6: return new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
    case 7: {
      if (!g.vert) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(g.vert), 3));
      geo.setIndex(Array.from(g.face));
      // smooth sides, sharp rims. In millimetres: toCreasedNormals joins vertices on a 0.01-unit grid, which in metres
      // shared one normal among facets up to 1 cm apart and shaded the round rod in flat bands of about five facets
      geo.scale(1000, 1000, 1000);
      return toCreasedNormals(geo, g.isObject ? Math.PI / 6 : Math.PI / 4).scale(1e-3, 1e-3, 1e-3);
    }
    default: return null;
  }
}

let meshes = [], ghosts = [], handGhosts = [], policyDt = 0.05, nStarts = 1, start = 0;
let prevPoses = null, nextPoses = null, arrived = 0, lastInfo = null, lastChain = null;
// wall ms per control step (the worker's policy_dt / speed); span: the interpolation time, that step or, while frames
// arrive later than it (a device slower than twice real time), their smoothed arrival interval
let stepMs = 25, span = 25;
let prevHand = null, nextHand = null; // wrist position (3), rotation (9, row-major), finger angles (MANO 20)
let prevObject = null, nextObject = null; // object body position (3), rotation (9, row-major)
let goal = null, axisLength = 0.08; // goal from the worker (objectP/R, wristP/R, finger); axis length (m)
let ghostShown = 0; // performance.now() when the current goal appeared (its fade-in)
let posed = false; // the current model's meshes have received a pose (hidden until then)
const handMeshes = []; // the hand's collider meshes: [mesh, its opaque material]
const objectMeshes = []; // the object's meshes (their geometry bounding boxes frame the follow camera)
// ghostByGeom: the goal ghost of each geom
let ghostByGeom = [];
// render parts of a visual-look hand (Sharpa): {geom (its link's collider geom), offset (Matrix4: the part in that
// geom's frame), mesh, ghost / depth (the goal hand's part)}; the geometries and materials belong to the look (kept)
let parts = [];
// the hand's look (assets/hands.json "look"): {kind: 'colliders'} or {kind: 'visual', parts, geometries, shell, pad}
let look = { kind: 'colliders' };
// The collider goal hand in one layer (ghost pass): its depth first (no colour), then its colour on its nearest surface
// only, both after the goal object (renderOrder), so its fingers show through the goal object.
const GHOST_ORDER = { object: 1, handDepth: 2, hand: 3 };

/** Remove the previous model's meshes (object switch: the worker loads another model). */
function clearScene() {
  const depths = handGhosts.map((g) => g.userData.depth);
  const all = [...meshes, ...ghosts, ...handGhosts, ...depths].filter(Boolean);
  for (const mesh of all) {
    scene.remove(mesh);
    if (mesh.material !== colliderOverlay && mesh.material !== handGhostMaterial
      && mesh.material !== ghostDepthMaterial) mesh.material.dispose(); // not shared
  }
  for (const g of new Set(all.map((m) => m.geometry))) g.dispose();
  for (const [, opaque] of handMeshes) opaque.dispose();
  for (const p of parts) scene.remove(p.mesh, p.ghost, p.depth); // the look's geometries and materials stay
  parts = [];
  meshes = [];
  ghosts = [];
  handGhosts = [];
  ghostByGeom = [];
  goal = null; // the new model's first frame brings its goal
  handMeshes.length = 0;
  objectMeshes.length = 0;
  prevPoses = nextPoses = prevHand = nextHand = prevObject = nextObject = null;
  posed = false;
}

function buildScene(geoms) {
  clearScene();
  // one mesh per geom: the object's pieces and the hand's collider hulls (MANO: drawn as the hand; a visual-look hand
  // draws its render meshes below, its hulls stay hidden but posed: the follow camera and tests read them)
  for (const [id, g] of geoms.entries()) {
    const geo = geometryOf(g);
    if (!geo || g.rgba[3] === 0) { meshes.push(null); continue; }
    const color = new THREE.Color().setRGB(g.rgba[0], g.rgba[1], g.rgba[2], THREE.SRGBColorSpace);
    const mesh = new THREE.Mesh(geo, g.isObject
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.0 })
      : colliderSkinMaterial()); // the colliders drawn as the hand (no skin)
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = !!g.isObject;
    mesh.visible = false; // until the first frame
    mesh.userData.geom = id;
    scene.add(mesh);
    meshes.push(mesh);
    if (!g.isObject) handMeshes.push([mesh, mesh.material]);
    if (g.isObject) {
      geo.computeBoundingBox();
      objectMeshes.push(mesh);
    }
    // its goal ghost (the object's, or one part of the collider goal hand), placed by the worker's ghost poses
    const ghost = ghostMesh(geo, g.isObject ? ghostMaterial(LOOK.ghostObject) : handGhostMaterial,
      g.isObject ? GHOST_ORDER.object : GHOST_ORDER.hand);
    ghost.userData.geom = id;
    if (!g.isObject) ghost.userData.depth = ghostMesh(geo, ghostDepthMaterial, GHOST_ORDER.handDepth);
    ghostByGeom[id] = ghost;
    (g.isObject ? ghosts : handGhosts).push(ghost);
  }
  // a visual-look hand: its render parts, each posed from its link's collider geom (app/hands.js partOffsets)
  if (look.kind === 'visual') {
    partOffsets(look.parts, geoms).forEach(({ geom, offset }, k) => {
      const geo = look.geometries[look.parts[k].mesh];
      const mesh = new THREE.Mesh(geo, look.parts[k].kind === 'pad' ? look.pad : look.shell);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      parts.push({ geom, offset: new THREE.Matrix4().fromArray(offset), mesh,
        ghost: ghostMesh(geo, handGhostMaterial, GHOST_ORDER.hand),
        depth: ghostMesh(geo, ghostDepthMaterial, GHOST_ORDER.handDepth) });
    });
  }
  styleColliders();
}

/** A goal-ghost mesh (ghost pass, placed by setGoal, hidden until a goal exists). */
function ghostMesh(geometry, material, order) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(GHOST);
  mesh.renderOrder = order;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

/** The skin's material (flat colour until an albedo map is set): roughness, specular and sheen of the renders. */
function skinLikeMaterial(m = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: LOOK.skinFlat, roughness: m.roughness ?? 0.6, metalness: 0.0,
    specularIntensity: (m.specular ?? 0.08) / 0.5, // Blender Principled specular 0.5 = F0 0.04 = three.js 1.0
    sheen: 0.25, sheenRoughness: 0.8, sheenColor: 0xffe2cc, // a soft grazing rim (cheap stand-in for scattering)
  });
}

/** The colliders as the hand (no skin; the public build's angular hulls): the first public demo's material (site
 *  commit 4c6b6b9, owner 2026-11-22): the skin's roughness and specular, no sheen (it whitens the coarse hulls), the
 *  scene's environment. */
function colliderSkinMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: LOOK.colliderSkin, roughness: 0.6, metalness: 0.0,
    specularIntensity: 0.16 });
}

/** A goal-ghost surface: 40 % opaque per surface, both faces (they accumulate, as in the ray-traced renders). */
function ghostMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.5, metalness: 0.0, transparent: true, opacity: LOOK.ghostOpacity, depthWrite: false,
    side: THREE.DoubleSide,
  });
}
// The goal hand without the skin (the collider hand's surfaces, or a visual-look hand's render meshes), shared by its
// parts (kept across object and hand switches): its depth pre-pass, then one layer of colour (front faces, depth equal
// to the pre-pass: only the nearest surface).
const ghostDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true });
const handGhostMaterial = new THREE.MeshStandardMaterial({ color: LOOK.ghostColliderHand, roughness: 0.85,
  metalness: 0.0, transparent: true, opacity: LOOK.ghostHandOpacity, depthWrite: false });

// --------------------------------------------------------------------------------------------- MANO skin
// depth-tested against the skin and pushed slightly back: blue where a collider lies outside the skin
const colliderOverlay = new THREE.MeshStandardMaterial({
  color: 0x2f6fdf, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.6, flatShading: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
let skin = null, skinMesh = null, skinSurface = null, skinKey = null, ghostHand = null, ghostSurface = null;

/** The MANO skin is drawn (local SKIN build, loaded, and the MANO hand: a hand with look "colliders"). */
const skinShown = () => !!skinMesh && look.kind === 'colliders';

/** Without the skin the colliders are the hand (opaque); with it they are an optional translucent overlay; a
 *  visual-look hand hides them (its render parts are the hand). The goal ghosts show while a goal is installed; the
 *  collider goal hand only without the skin (which has its own). */
function styleColliders() {
  const skinOn = skinShown(), visual = look.kind === 'visual';
  if (skinMesh && !skinOn) skinMesh.visible = ghostHand.visible = false; // another hand than MANO
  for (const [mesh, opaque] of handMeshes) {
    mesh.visible = !visual && (!skinOn || ui.colliders.checked) && posed;
    mesh.material = skinOn ? colliderOverlay : opaque;
    mesh.renderOrder = skinOn ? 2 : 0;
    mesh.castShadow = mesh.receiveShadow = !skinOn;
  }
  for (const ghost of ghosts) ghost.visible = !!goal;
  for (const ghost of handGhosts) {
    ghost.visible = ghost.userData.depth.visible = !!goal && !skinOn && !visual;
  }
  for (const p of parts) {
    p.mesh.visible = posed;
    p.ghost.visible = p.depth.visible = !!goal;
  }
}

/** A mesh drawing a SkinSurface's render vertices (its arrays are the attribute arrays). */
function surfaceMesh(surface, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(surface.position, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(surface.normal, 3).setUsage(THREE.DynamicDrawUsage));
  if (surface.uv) geo.setAttribute('uv', new THREE.BufferAttribute(surface.uv, 2));
  geo.setIndex(new THREE.BufferAttribute(surface.index, 1));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // vertices move every frame
  mesh.visible = false; // until the first state
  return mesh;
}

function markUpdated(mesh) {
  const a = mesh.geometry.attributes;
  a.position.needsUpdate = a.normal.needsUpdate = true;
  mesh.visible = true;
}

/** Load the MANO skin (SKIN builds only); without it (404 or SKIN = false) the colliders stay the hand. */
async function loadSkin() {
  const [{ ManoSkin }, { SkinSurface }] = await Promise.all([import('../engine/mano_skin.js'),
    import('../engine/skin_surface.js')]);
  skin = await ManoSkin.load(fetchLoader(LOCAL));
  const m = skin.material ?? {};
  const levels = m.subdivision ?? 1;
  skinSurface = new SkinSurface(skin.faces, skin.nVert, skin.faceUV, levels);
  ghostSurface = new SkinSurface(skin.faces, skin.nVert, null, levels);
  const material = skinLikeMaterial(m);
  skinMesh = surfaceMesh(skinSurface, material);
  skinMesh.castShadow = skinMesh.receiveShadow = true;
  ghostHand = surfaceMesh(ghostSurface, ghostMaterial(LOOK.ghostHand));
  ghostHand.layers.set(GHOST);
  scene.add(skinMesh, ghostHand);
  ui.collidersToggle.hidden = false;
  document.body.dataset.skin = 'mano';
  styleColliders();
  skinKey = null;
  skinGoal();
  if (m.albedo && skinSurface.uv) {
    new THREE.TextureLoader().loadAsync(LOCAL + m.albedo).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace; // flipY (default): UV v up, as in Blender
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      document.body.dataset.skin = 'mano-textured';
      kick();
    }).catch((err) => console.info(`skin albedo not loaded (${err.message ?? err}); flat skin colour`));
  }
}
if (SKIN) {
  loadSkin().catch((err) => { // no assets/mano_local/: the colliders are the hand, no hand ghost
    console.info(`MANO skin not loaded (${err.message}); drawing the hand colliders`);
    skin = skinMesh = null;
    document.body.dataset.skin = 'colliders';
  });
} else {
  document.body.dataset.skin = 'colliders';
}
ui.colliders.onchange = styleColliders;

/** The goal hand: skin at the wrist goal H* with the finger target q_B*, inflated (static per goal). */
function skinGoal() {
  if (!ghostSurface) return;
  if (!goal || !skinShown()) { ghostHand.visible = false; return; }
  const { positions } = skin.skin(goal.finger, goal.wristP, goal.wristR);
  ghostSurface.update(positions, LOOK.ghostInflate);
  markUpdated(ghostHand);
}

const pose = { p: new THREE.Vector3(), pa: new THREE.Vector3(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(),
  m: new THREE.Matrix4(), R: new Float64Array(9) };
const rotationOf = (h, m) => m.set(h[3], h[4], h[5], 0, h[6], h[7], h[8], 0, h[9], h[10], h[11], 0, 0, 0, 0, 1);

/** Interpolate a (position 3, rotation 9 row-major, ...) state: position lerp, rotation slerp -> pose.p, pose.R. */
function interpolatePose(a, b, t) {
  pose.p.set(b[0], b[1], b[2]);
  pose.qb.setFromRotationMatrix(rotationOf(b, pose.m));
  if (t < 1) {
    pose.p.lerp(pose.pa.set(a[0], a[1], a[2]), 1 - t);
    pose.qb.copy(pose.qa.setFromRotationMatrix(rotationOf(a, pose.m)).slerp(pose.qb, t));
  }
  const e = pose.m.makeRotationFromQuaternion(pose.qb).elements; // column-major
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) pose.R[3 * r + c] = e[4 * c + r];
  return pose;
}

const finger = new Float64Array(20);
/** Skin the hand state interpolated like the geoms (position lerp, rotation slerp, finger angles lerp). */
function applySkin(alpha) {
  if (!skinShown() || !nextHand) return;
  const t = prevHand && alpha < 1 ? alpha : 1;
  if (skinKey && skinKey[0] === nextHand && skinKey[1] === t) return; // unchanged (paused / between frames)
  skinKey = [nextHand, t];
  const a = prevHand ?? nextHand, b = nextHand;
  const { p, R } = interpolatePose(a, b, t);
  for (let i = 0; i < 20; i++) finger[i] = a[12 + i] + t * (b[12 + i] - a[12 + i]);
  const { positions } = skin.skin(finger, p.toArray(), R);
  skinSurface.update(positions);
  markUpdated(skinMesh);
}

const matrixOf = (poses, g, m = new THREE.Matrix4()) => {
  const o = 12 * g, p = poses;
  return m.set(p[o + 3], p[o + 4], p[o + 5], p[o], p[o + 6], p[o + 7], p[o + 8], p[o + 1],
    p[o + 9], p[o + 10], p[o + 11], p[o + 2], 0, 0, 0, 1);
};

const tmp = { a: new THREE.Matrix4(), b: new THREE.Matrix4(), pa: new THREE.Vector3(), pb: new THREE.Vector3(),
  qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), s: new THREE.Vector3() };

function applyPoses(alpha) {
  if (!nextPoses) return;
  meshes.forEach((mesh, g) => {
    if (!mesh) return;
    matrixOf(nextPoses, g, tmp.b).decompose(tmp.pb, tmp.qb, tmp.s);
    if (prevPoses && alpha < 1) {
      matrixOf(prevPoses, g, tmp.a).decompose(tmp.pa, tmp.qa, tmp.s);
      tmp.pb.lerpVectors(tmp.pa, tmp.pb, alpha);
      tmp.qb.slerpQuaternions(tmp.qa, tmp.qb, alpha);
    }
    mesh.matrix.compose(tmp.pb, tmp.qb, tmp.s.set(1, 1, 1));
  });
  for (const p of parts) p.mesh.matrix.multiplyMatrices(meshes[p.geom].matrix, p.offset);
}

// --------------------------------------------------------------------------------------------- camera
// Marker scene: aim between hand and object, halfway from the start to the goal; back off for a wide start-goal gap
// or a portrait view. Chain scene: fixed per object (load, Reset), aimed at the start grasp with the measured motion
// (CHAIN_VIEW) in view; a fresh start after a failure keeps the camera (the start grasps share the home pose).
function snapCamera(target, distance, direction = CAMERA_DIRECTION) {
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  setZoomBounds(distance);
  controls.update();
  aimStudio(controls.target);
  // the videos' axis length: a fraction of the visible extent (longer image side) at the target, capped
  const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  axisLength = Math.min(LOOK.axisFraction * Math.max(height, height * camera.aspect), LOOK.axisMax);
}

function frameMarker(objP, goalP, handP) {
  const obj = new THREE.Vector3(...objP), goalV = new THREE.Vector3(...goalP);
  const shift = goalV.clone().sub(obj).multiplyScalar(0.5);
  const hand = new THREE.Vector3(...handP).add(shift);
  const target = obj.clone().add(shift).lerp(hand, 0.5);
  snapCamera(target, (0.34 + 1.2 * obj.distanceTo(goalV)) * Math.max(1, 0.9 / camera.aspect));
}

function frameChain(objP, handP) {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fit = (v) => Math.max((v.half[1] + FRAME_MARGIN) / t, (v.half[0] + FRAME_MARGIN) / (t * camera.aspect));
  let v = CHAIN_VIEW, distance = fit(v);
  if (ui.view.clientHeight / (2 * t * distance) < MIN_SCALE) { // a small view: the tighter box
    v = CHAIN_TIGHT;
    distance = fit(v);
  }
  const target = new THREE.Vector3(...objP).lerp(new THREE.Vector3(...handP), 0.5).add(new THREE.Vector3(...v.offset));
  snapCamera(target, distance, new THREE.Vector3(...CHAIN_VIEW.direction).normalize());
  document.body.dataset.frame = `${v === CHAIN_TIGHT ? 'tight' : 'full'} ${Math.round(ui.view.clientHeight / (2 * t * distance))}`;
}

// --------------------------------------------------------------------------------------------- follow camera
// Chain scene (both layouts; ?camera=fixed keeps the fixed camera above): the camera keeps its viewing direction (the
// default one, or the viewer's orbit) and only translates and zooms. Every frame it fits the projected span of the hand
// (collider centres), the object (its bounding box) and the goal ghost (the goal object's box and the goal hand's
// collider centres, from the worker's forward kinematics), plus FOLLOW.margin on each side, into the view below the
// Play / Reset overlay (follow.reserve px, stacked layout). Target (the span's centre) and distance are first-order
// low-passes with time constant FOLLOW.tau, k = 1 - exp(-dt / tau) per frame (frame-rate independent). Zoom limits: at
// most FOLLOW.scale[1] px per metre at the target; zoomed out, at least FOLLOW.scale[0] px per metre, unless that would
// show less than FOLLOW.extent m across the narrower usable side (short views). A cut (load, Reset, an object switch, a
// fresh start after a failure) snaps without smoothing. The viewer's orbit changes the viewing direction, which the
// follow camera keeps. A viewer zoom (Ctrl / Cmd + wheel, pinch; within ZOOM.range of the automatic distance) suspends
// the automatic zoom: the distance stays where the viewer left it, the target keeps following, until Reset or an object
// switch. Clipping of this filter, replayed on Node chains: README "Viewer".
// Tuned for twice real time in the page's frames (review r9, 2026-11-22; was tau 0.8 s, margin 0.03 m, 1400 px/m,
// dead 0.9, chosen at 1x): share of 0.1 s samples with the hand / object / goal box past the view edge, seeds 7, 3,
// 12, 50 s each (README "Viewer"): 800 x 474 frame 17.5 % -> 4.7 % (hand 169 -> 163 px), 350 x 622 7.2 -> 2.8 %.
const FOLLOW = { tau: 0.35, margin: 0.045, scale: [1350, 3200], extent: 0.279 }; // s, m, px/m, m
const CAMERA_MODE = params.get('camera');
const follow = { target: new THREE.Vector3(), distance: 1, manual: 0, applied: 0, snap: true, reserve: 0,
  anchor: new THREE.Vector3(), anchorDistance: 0, reaim: true, heading: 0, dir: null };
// Set goal camera (lead 2026-11-23, relative_sweep/RESULTS.md section 6): the once-per-goal re-aim stays; for editor
// goals the zoom-out floor is EDITOR_VIEW.scale px per metre (the hand's own floor when lower: Sharpa 600), so the
// largest relative goals (p95 span 0.55 m) fit; at each started editor goal the view turns about the vertical by
// that goal's applied Turn (the worker's frame.view.turnDeg: R* = Rz(turn) R ..., so the same side of the hand stays
// in view after accumulated turns; review M3: a heading read from the goal rotation is undefined palm down, where it
// swung the view by up to 128 deg on a goal with Turn 0), the viewer's orbit azimuth kept, and its elevation follows
// the goal palm: the default 35 deg up to a sideways palm, falling linearly to EDITOR_VIEW.lowDeg at palm down (from
// above, the back of the hand covers the rod). follow.dir: the direction the view eases to (time constant
// FOLLOW.tau); follow.heading: the sum (deg) of the turns applied since the last cut (leaving Set goal or a fresh
// start in it turns the view back by it).
const EDITOR_VIEW = { scale: 800, lowDeg: 8 };
const VIEW_ELEVATION = Math.asin(CHAIN_VIEW.direction[2] / Math.hypot(...CHAIN_VIEW.direction)); // rad (35 deg)
const DIAG = params.has('diag'); // tools: body data-overflow = whether the span leaves the view (followStep)
const fwDir = new THREE.Vector3();
const editorGoals = () => document.body.dataset.mode === 'editor';
/** Turn the follow view by turnDeg (deg, about the vertical) and set its elevation for a goal palm tilt palmDeg (deg;
 *  see EDITOR_VIEW): a started editor goal's frame.view, or the way back to the default view. */
function editorCamera({ turnDeg, palmDeg }) {
  if (!following()) return;
  const base = follow.dir ?? fwDir.subVectors(camera.position, controls.target).normalize();
  const az = Math.atan2(base.y, base.x) + THREE.MathUtils.degToRad(turnDeg);
  follow.heading += turnDeg;
  const low = THREE.MathUtils.degToRad(EDITOR_VIEW.lowDeg), palm = Math.min(180, Math.max(90, palmDeg));
  const el = VIEW_ELEVATION + ((low - VIEW_ELEVATION) * (palm - 90)) / 90;
  follow.dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
}
/** The default view direction again after editor goals (leaving Set goal, a fresh start in it). */
const editorCameraBack = () => editorCamera({ turnDeg: -follow.heading, palmDeg: 0 });
/** Azimuth (deg from world +x toward +y, whole degrees) of the view's horizontal viewing direction, the one it eases
 *  to when it turns: Set goal's Right / Away sliders (#ed-x / #ed-y) move along screen right and away from the viewer
 *  (the worker's setting.awayDeg, editor.js moveAxes; review S2: world x / y had no on-screen reference). */
function awayDeg() {
  const d = follow.dir ? fw.mean.copy(follow.dir) : fwDir.subVectors(camera.position, controls.target);
  return Math.round(THREE.MathUtils.radToDeg(Math.atan2(-d.y, -d.x)));
}
// Bounded follow (owner feedback, relocation must show): the camera aims once per goal (anchor = the span's centre and
// fit when the goal appears), then holds; within the goal it moves only by the amount the span (hand, object, goal
// ghost, plus the margin) would leave FOLLOW.dead of the half view, and zooms out but never in. Replayed on the Node
// chains this shows 2.5 times more on-screen travel of the object over relocation goals than following the span's
// centre (median 76 vs 31 px at 1080 x 640, 48 vs 19 px at 390 x 844), with less clipping (README "Viewer").
FOLLOW.dead = 0.85;
// Paused: the camera finishes its easing with time constant pauseTau and snaps pauseCap s after the pause, so the frame
// loop stops within about a second on every viewport (it eased with tau before and kept drawing for 2-10 s).
FOLLOW.pauseTau = 0.15; // s
FOLLOW.pauseCap = 0.6; // s
// manual: the viewer's distance after a zoom (0: automatic zoom)
const fw = { r: new THREE.Vector3(), u: new THREE.Vector3(), f: new THREE.Vector3(), p: new THREE.Vector3(),
  mean: new THREE.Vector3(), raw: new THREE.Vector3(), box: null, depth: 0 };

/** Whether the follow camera drives the view now (chain scene; the stacked layout unless ?camera= says otherwise). */
const following = () => SCENE === 'chain' && CAMERA_MODE !== 'fixed';

/** The raw aim of the follow camera: fw.raw (target) and the returned distance, or null before the first frame. */
function followAim() {
  if (!nextHand || !handMeshes.length) return null;
  const { r, u, f, p, mean } = fw;
  f.subVectors(controls.target, camera.position).normalize(); // viewing direction (fixed: the view's own)
  r.crossVectors(f, camera.up).normalize();
  u.crossVectors(r, f);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
  mean.set(0, 0, 0);
  const add = (v) => {
    const x = v.dot(r), y = v.dot(u);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    mean.add(v); n += 1;
  };
  const corners = (mesh, matrix) => {
    const b = mesh.geometry.boundingBox;
    for (let i = 0; i < 8; i++) {
      add(p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(matrix));
    }
  };
  // the hand: its collider centres (MANO), or a visual-look hand's part boxes (Sharpa: its large links' centres lie
  // far inside the surface; framed by centres the hand or the goal hand crossed the view's edge in 15-31 % of the
  // samples, README "Hand choice")
  if (parts.length) for (const q of parts) corners(q.mesh, q.mesh.matrix);
  else for (const [mesh] of handMeshes) add(p.setFromMatrixPosition(mesh.matrix));
  for (const mesh of objectMeshes) corners(mesh, mesh.matrix);
  if (goal) { // the goal ghost: object box and the goal hand's collider centres (drawn as the skin or the colliders)
    for (const ghost of ghosts) corners(ghost, ghost.matrix);
    if (parts.length) for (const q of parts) corners(q.ghost, q.ghost.matrix);
    else for (const ghost of handGhosts) add(p.setFromMatrixPosition(ghost.matrix));
  }
  mean.multiplyScalar(1 / n);
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const W = ui.view.clientWidth, H = Math.max(1, ui.view.clientHeight), usable = H - follow.reserve;
  const fit = Math.max(((y1 - y0) / 2 + FOLLOW.margin) / (t * usable / H),
    ((x1 - x0) / 2 + FOLLOW.margin) / (t * camera.aspect));
  const near = H / (2 * t * FOLLOW.scale[1]);
  // zoomed out at least FOLLOW.scale[0] px per metre, or the hand's own floor (assets/hands.json minScale: Sharpa 600)
  const floor = hand?.minScale ?? FOLLOW.scale[0];
  const far = Math.max(H / (2 * t * (editorGoals() ? Math.min(floor, EDITOR_VIEW.scale) : floor)),
    (FOLLOW.extent * H) / (2 * t * Math.min(W, usable)));
  const distance = THREE.MathUtils.clamp(fit, near, far);
  // target: the span's centre on the image plane at the points' mean depth, raised by half the reserve so the span
  // sits centred in the usable part of the view
  fw.raw.copy(f).multiplyScalar(mean.dot(f)).addScaledVector(r, (x0 + x1) / 2)
    .addScaledVector(u, (y0 + y1) / 2 + (follow.reserve / H) * distance * t);
  fw.box = [x0, x1, y0, y1];
  fw.depth = mean.dot(f);
  return distance;
}

/** One frame of the follow camera (dt in s); returns how far the view still is from its aim (screen px, for the
 *  render loop). Within 1 px of the aim it snaps there, so a paused view settles and the loop can stop. */
function followStep(dt) {
  controls.enablePan = !following(); // the follow camera owns the target
  if (!following()) { follow.applied = 0; return 0; }
  // paused and settled: the camera stays exactly where it is (a swipe, a scroll or a page event that redraws never
  // re-aims it) until play, a cut or a resize
  const paused = !lastInfo?.playing, pausedFor = (performance.now() - pausedAt) / 1000;
  if (!paused || follow.snap) follow.frozen = false;
  if (follow.frozen) return 0;
  let raw = followAim();
  if (raw === null) return 0;
  if (follow.reaim) { // a new goal (or a cut): aim at the span once
    follow.anchor.copy(fw.raw);
    follow.anchorDistance = raw;
    follow.reaim = false;
  }
  { // deadband: shift the anchor only by what the span would leave of FOLLOW.dead of the half view; zoom out only
    const d = (follow.anchorDistance = Math.max(follow.anchorDistance, raw));
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), H = Math.max(1, ui.view.clientHeight);
    const fy = (H - follow.reserve) / H, [x0, x1, y0, y1] = fw.box, { r, u, f } = fw;
    const ax = follow.anchor.dot(r), ay = follow.anchor.dot(u) - (follow.reserve / H) * d * t;
    const hw = d * t * camera.aspect * FOLLOW.dead - FOLLOW.margin, hh = d * t * fy * FOLLOW.dead - FOLLOW.margin;
    const ex = Math.max(0, x1 - (ax + hw)) - Math.max(0, ax - hw - x0);
    const ey = Math.max(0, y1 - (ay + hh)) - Math.max(0, ay - hh - y0);
    follow.anchor.addScaledVector(r, ex).addScaledVector(u, ey).addScaledVector(f, fw.depth - follow.anchor.dot(f));
    fw.raw.copy(follow.anchor);
    raw = d;
  }
  const actual = camera.position.distanceTo(controls.target);
  if (follow.applied > 0 && Math.abs(actual - follow.applied) > 1e-6) follow.manual = actual; // the viewer zoomed
  const scale0 = ui.view.clientHeight / (2 * Math.max(actual, 1e-6) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const turnLeft = follow.dir ? fwDir.subVectors(camera.position, controls.target).normalize().angleTo(follow.dir) : 0;
  const residual = fw.raw.distanceTo(follow.target) * scale0
    + (follow.manual ? 0 : (Math.abs(raw - follow.distance) / Math.max(raw, 1e-6)) * ui.view.clientHeight / 2)
    + turnLeft * ui.view.clientHeight; // an editor view turn still to go (rad x view height)
  // Paused (or ended): finish the easing quickly so the frame loop stops: time constant FOLLOW.pauseTau, and a snap
  // to the aim FOLLOW.pauseCap s after the pause at the latest (left: about exp(-cap / pauseTau) = 2 % of the lag)
  const tau = paused ? FOLLOW.pauseTau : FOLLOW.tau;
  const k = follow.snap || residual < 1 || (paused && pausedFor > FOLLOW.pauseCap) ? 1 : 1 - Math.exp(-dt / tau);
  if (paused && k === 1) follow.frozen = true;
  follow.snap = false;
  follow.target.lerp(fw.raw, k);
  follow.distance += (raw - follow.distance) * k;
  setZoomBounds(follow.distance); // the viewer's zoom stays within ZOOM.range of the automatic distance
  const direction = fw.p.subVectors(camera.position, controls.target).normalize();
  if (follow.dir) { // an editor goal's view turn (EDITOR_VIEW), eased as the target
    direction.lerp(follow.dir, k).normalize();
    if (k === 1 || direction.angleTo(follow.dir) < 1e-4) follow.dir = null;
  }
  controls.target.copy(follow.target);
  follow.applied = follow.manual || follow.distance;
  camera.position.copy(follow.target).addScaledVector(direction, follow.applied);
  aimStudio(follow.target);
  const height = 2 * follow.applied * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  axisLength = Math.min(LOOK.axisFraction * Math.max(height, height * camera.aspect), LOOK.axisMax);
  document.body.dataset.scale = String(Math.round(ui.view.clientHeight / height)); // px per metre at the target
  if (DIAG && fw.box) { // tools: the span (hand, object, goal ghost) past the view's usable part at this frame
    const H = Math.max(1, ui.view.clientHeight), t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hw = follow.applied * t * camera.aspect, hh = follow.applied * t * ((H - follow.reserve) / H);
    const cx = follow.target.dot(fw.r), cy = follow.target.dot(fw.u) - (follow.reserve / H) * follow.applied * t;
    const [x0, x1, y0, y1] = fw.box;
    document.body.dataset.overflow = x0 < cx - hw || x1 > cx + hw || y0 < cy - hh || y1 > cy + hh ? '1' : '0';
    // the view direction (from the target to the camera): azimuth and elevation (deg), and the editor turn sum
    document.body.dataset.view = `${THREE.MathUtils.radToDeg(Math.atan2(direction.y, direction.x)).toFixed(1)} `
      + `${THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.max(-1, direction.z)))).toFixed(1)} ${follow.heading}`;
  }
  return k === 1 ? 0 : residual;
}

// --------------------------------------------------------------------------------------------- world reference
// A very light floor grid, fixed in the world 16 cm below the start wrist (5 cm cells, 1 px lines at most 22 %
// dark, fading out radially within 0.5 m), so a relocation reads against it while the camera follows. (A trail of the object
// centre was tried and dropped: over composite goals the centre loops and the trail read as a scribble.) Drawn first, in the ghost pass, so the ghost,
// the hand and the object all draw over it. Placed at load and Reset (the start grasps share the home pose); in Set
// goal moved along at each started goal (floorUnder, review S3: far relocations left it behind).
const FLOOR_CELL = 0.05; // m
const floor = (() => { // 1 px lines (a textured plane was 10 x slower under software rendering)
  const half = 0.6, cell = FLOOR_CELL, piece = 0.025, n = Math.round((2 * half) / cell);
  const pos = [], col = [];
  const alpha = (x, y) => 0.22 * Math.max(0, 1 - Math.hypot(x, y) / (0.85 * half)) ** 1.5; // radial fade
  for (let i = 0; i <= n; i++) {
    const c = -half + i * cell;
    for (let a = -half; a < half - 1e-9; a += piece) {
      for (const [x0, y0, x1, y1] of [[c, a, c, a + piece], [a, c, a + piece, c]]) {
        pos.push(x0, y0, 0, x1, y1, 0);
        col.push(0.118, 0.145, 0.157, alpha(x0, y0), 0.118, 0.145, 0.157, alpha(x1, y1));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
    depthWrite: false, toneMapped: false }));
  mesh.layers.set(GHOST);
  mesh.renderOrder = -1;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();

function placeFloor(objP, handP) {
  floor.position.set((objP[0] + handP[0]) / 2, (objP[1] + handP[1]) / 2, handP[2] - 0.16);
  floor.userData.origin = floor.position.clone(); // the cells' world positions (floorUnder keeps them)
  floor.visible = true;
}
/** Set goal: the grid under a started goal, centred between the hand and the goal wrist in whole cells from its
 *  origin (the lines keep their world positions); lowered when a wrist or object (now or at the goal) comes within
 *  0.16 m of it, raised to that when they are all more than 0.4 m above it. points: world positions (3 each). */
function floorUnder(handP, goalP, points) {
  const o = floor.userData.origin, c = FLOOR_CELL;
  if (!o) return;
  const snap = (v, v0) => v0 + Math.round((v - v0) / c) * c, low = Math.min(...points.map((q) => q[2])) - 0.16;
  const z = low < floor.position.z || low - floor.position.z > 0.24 ? low : floor.position.z;
  floor.position.set(snap((handP[0] + goalP[0]) / 2, o.x), snap((handP[1] + goalP[1]) / 2, o.y), z);
}

// --------------------------------------------------------------------------------------------- goal, axes
/** Install a goal (or none) with the worker's ghost poses (12 per geom at the goal state): goal object, goal hand
 *  (skin, or its colliders), fade-in; reaim: the follow camera aims at the new span once (false for Set goal
 *  previews). */
function setGoal(newGoal, poses, reaim = true) {
  goal = newGoal;
  if (reaim) follow.reaim = true; // (a Set goal preview: the deadband keeps its ghost in view, no pan per slider step)
  if (goal) {
    for (const ghost of [...ghosts, ...handGhosts]) {
      matrixOf(poses, ghost.userData.geom, ghost.matrix);
      ghost.userData.depth?.matrix.copy(ghost.matrix);
    }
    for (const p of parts) {
      p.ghost.matrix.multiplyMatrices(ghostByGeom[p.geom].matrix, p.offset);
      p.depth.matrix.copy(p.ghost.matrix);
    }
  }
  styleColliders();
  skinGoal();
  ghostShown = performance.now();
}

function ghostFade(now) {
  const f = Math.min(1, (now - ghostShown) / LOOK.ghostFadeMs);
  for (const ghost of ghosts) ghost.material.opacity = LOOK.ghostOpacity * f;
  handGhostMaterial.opacity = LOOK.ghostHandOpacity * f;
  if (ghostHand) ghostHand.material.opacity = LOOK.ghostOpacity * f;
  return f;
}

// window.viewerGhost() (tests): which goal hand is drawn ('skin' | 'colliders' | 'visual' | 'none'), its opacity, and
// the mean / max distance (mm) between the goal hand's collider centres and the hand's in the latest frame (small at a
// latch)
window.viewerGhost = () => {
  const drawn = !goal ? 'none' : ghostHand?.visible ? 'skin' : parts.some((p) => p.ghost.visible) ? 'visual'
    : handGhosts.some((g) => g.visible) ? 'colliders' : 'none';
  let sum = 0, max = 0;
  for (const ghost of handGhosts) {
    const o = 12 * ghost.userData.geom, e = ghost.matrix.elements;
    const d = nextPoses ? Math.hypot(e[12] - nextPoses[o], e[13] - nextPoses[o + 1], e[14] - nextPoses[o + 2]) : NaN;
    sum += d;
    max = Math.max(max, d);
  }
  // parts: drawn parts of the goal hand (its collider hulls, or a visual-look hand's render meshes)
  return { hand: drawn, parts: drawn === 'visual' ? parts.filter((p) => p.ghost.visible).length
    : handGhosts.filter((g) => g.visible).length,
    opacity: handGhostMaterial.opacity,
    gapMm: (1000 * sum) / Math.max(1, handGhosts.length), maxMm: 1000 * max };
};

const project = new THREE.Vector3();

/** Screen points (CSS px) of a frame (origin p, rotation R row-major) with axes of the given length, or null. */
function frameOnScreen(p, R, length, style) {
  const w = ui.view.clientWidth, h = ui.view.clientHeight;
  const px = (x, y, z) => {
    project.set(x, y, z).project(camera);
    return project.z > 1 ? null : [(project.x + 1) * 0.5 * w, (1 - project.y) * 0.5 * h];
  };
  const origin = px(p[0], p[1], p[2]);
  const tips = [0, 1, 2].map((k) => px(p[0] + R[k] * length, p[1] + R[3 + k] * length, p[2] + R[6 + k] * length));
  return origin && tips.every(Boolean) ? { origin, tips, style } : null;
}

function drawAxes(alpha, goalAlpha) {
  if (!nextObject) return;
  const t = prevObject && alpha < 1 ? alpha : 1;
  const { p, R } = interpolatePose(prevObject ?? nextObject, nextObject, t);
  const width = LOOK.axisWidth * Math.max(ui.view.clientWidth, ui.view.clientHeight) / LOOK.axisReference;
  axes.draw([goal ? frameOnScreen(goal.objectP, goal.objectR, axisLength, 'goal') : null,
    frameOnScreen(p.toArray(), R, axisLength, 'object')], width, goalAlpha);
}

// --------------------------------------------------------------------------------------------- status
const deg = (r) => (r * 180) / Math.PI;
// wording of the project page's copy review (review_copy_r2.md, row 6); drop and 'no node available' shortened to fit
// one phone line (320 px frame, stacked note; review r9 round 12 DN-a)
const NOTES = {
  drop: 'Object dropped: starting from a new initial grasp.',
  timeout: 'Goal not reached: starting from a new initial grasp.',
  recover: 'Goal not reached: continuing from the current grasp.',
  'no node available': 'No task available: starting from a new initial grasp.',
  restart: 'Starting from a new initial grasp.',
};
// a reached goal: the note line shows "✓ <task> reached" in the ink colour (bold) for SUCCESS_MS of wall time (the
// dwell itself lasts 0.25 s at twice real time), while the next goal already runs
const SUCCESS_MS = 1200;
// a queued task dropped at a failure: its refusal outline stays at full opacity this long before its 0.6 s fade
const REFUSED_HOLD_MS = 1200;
let note = { text: '', kind: '', until: 0 }, noteTimer = 0;
// the stacked layout of index.html (tall or narrow viewports) uses the compact graph; the same query as its CSS
const STACKED = matchMedia('(max-width: 779px), (max-aspect-ratio: 1/1)');
const graph = SCENE === 'chain' ? new TaskGraph(ui.graph, { onSelect: queueTask, compact: STACKED.matches }) : null;
STACKED.addEventListener('change', () => {
  graph?.setCompact(STACKED.matches);
  follow.snap = true;
  resize();
});

/** Write a text only when it changes (frames arrive at 40 Hz). */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/** A note for ms of wall time: kind 'fail' (a failed goal, brown), 'error' (a hand that could not be loaded, brown) or
 *  'done' (a reached goal, ink). A reached goal's note does not replace a failure or error note while it shows (in
 *  Random chain goals are reached every 1-3 s; the failure note names the failed task): the reached goal still counts
 *  in "N goals completed", and say() still reads it in Manual. */
function flashNote(text, ms = 2600, kind = 'fail') {
  if (kind === 'done' && (note.kind === 'error' || note.kind === 'fail') && note.until > performance.now()) return;
  note = { text, kind, until: performance.now() + ms };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { // the note expires (a timer: the frame loop may be stopped)
    note.until = 0;
    if (lastChain) showChain(lastChain);
  }, ms);
}

// Screen readers: the visible status is not a live region (in Random chain it changes every 1-3 s); one visually
// hidden status line speaks, at most one message per SAY_MS (messages that arrive in between are joined into the next
// one; a joined "Goal X" is dropped when "X reached" follows it, so nothing stale is read):
// - Random chain without the viewer's input: only the start, Reset, a mode or object change, a failure with its fresh
//   start, the chain's end and every PROGRESS_EVERY-th completed goal (about 2 a minute at twice real time; the goals
//   are not read one by one, they change every 1-3 s);
// - Manual: the prompt, the chosen task, its goal and its result.
const SAY_MS = 3000;
const PROGRESS_EVERY = 10;
let sayParts = [], sayLast = -Infinity, sayTimer = 0;
/** Queue one message; goal / reached: the task it announces (for dropping a stale goal within one batch). */
function say(text, { goal = null, reached = null } = {}) {
  if (!ui.announce || sayParts.some((p) => p.text === text)) return;
  sayParts.push({ text, goal, reached });
  if (sayTimer) return;
  sayTimer = setTimeout(() => {
    sayTimer = 0;
    sayLast = performance.now();
    const parts = sayParts.filter((p, i) => !p.goal || !sayParts.slice(i + 1).some((q) => q.reached === p.goal));
    ui.announce.textContent = parts.slice(-3).map((p) => p.text).join(' ');
    sayParts = [];
  }, Math.max(0, sayLast + SAY_MS - performance.now()));
}

const GRAPH_NODES = new Set(ROWS.flat()); // the 15 tasks (a Set goal goal is named 'Goal')
function showChain(c) {
  const previous = lastChain;
  lastChain = c;
  const manual = c.mode === 'manual';
  const active = c.node && (c.phase === 'reach' || c.phase === 'dwell');
  if (c.phase === 'ended') {
    setText(ui.code, '');
    setText(ui.words, 'Chain ended. Press Reset to start again.');
  } else if (active) {
    setText(ui.code, c.node);
    // no check mark here: the note line's "✓ X reached" is the one success signal (review r9 round 3); "grasp type
    // change" never splits over two lines here (no-break spaces; the announcer and the graph keep plain spaces). A Set
    // goal goal ('Goal', no graph node) has no words, in any mode (it may still run after a switch to Manual).
    setText(ui.words, GRAPH_NODES.has(c.node)
      ? taskWords(c.node).replace('grasp type change', 'grasp\u00a0type\u00a0change') : '');
  } else {
    setText(ui.code, '');
    setText(ui.words, manual ? 'Select the next task on the graph.' : '');
  }
  setText(ui.goals, `${c.goalsDone} goal${c.goalsDone === 1 ? '' : 's'} completed`);
  const now = performance.now(), noted = note.until > now;
  if (noted) {
    setText(ui.note, note.text);
  } else {
    // only while a goal runs: an idle pick starts at the next step, so its "Next:" would flash for a frame or two
    setText(ui.note, manual && c.queued && active ? `Next: ${c.queued}, ${taskWords(c.queued)}` : '');
  }
  ui.note.classList.toggle('is-flash', noted && (note.kind === 'fail' || note.kind === 'error'));
  ui.note.classList.toggle('is-done', noted && note.kind === 'done');
  // available nodes are buttons in both modes: a click in Random chain switches to Manual (queueTask); the queue ring
  // only in Manual (Random chain draws its own next node, the worker drops a Manual pick on the switch)
  // while a hand or object switch loads, no node is a button (the new model's runner would drop a pick made now)
  graph.set({ current: active ? c.node : null, available: c.available ?? [], queued: manual ? (c.queued ?? null) : null,
    selectable: c.phase !== 'ended' && !switching });
  for (const b of ui.modes) b.setAttribute('aria-pressed', String(b.dataset.mode === c.mode));
  if (manual && !active && c.phase !== 'ended' && !c.queued && (previous?.node !== c.node || previous?.phase !== c.phase)) {
    say('Select the next task on the graph.');
  }
  if (c.phase === 'ended' && previous?.phase !== 'ended') say('Chain ended. Press Reset to start again.');
  Object.assign(document.body.dataset, { node: c.node ?? '', phase: c.phase, goals: String(c.goalsDone),
    mode: c.mode, goalstep: String(c.stepInGoal ?? 0) });
}

function showMarker(info) {
  const [gp, ga, rp, ra] = info.errors;
  const latch = info.latched ? `yes at ${(info.doneStep * policyDt).toFixed(2)} s` : 'no';
  const state = info.dropped ? 'dropped' : info.end ? 'episode end' : info.playing ? 'playing' : 'paused';
  ui.marker.innerHTML =
    `<span>start ${info.start + 1}/${nStarts}</span><span>t ${info.time.toFixed(2)} s</span>`
    + `<span>goal ${(1000 * gp).toFixed(1)} mm / ${deg(ga).toFixed(1)}&deg;</span>`
    + `<span>relation ${(1000 * rp).toFixed(1)} mm / ${deg(ra).toFixed(1)}&deg;</span>`
    + `<span class="${info.latched ? 'ok' : ''}">latched ${latch}</span><span class="muted">${state}</span>`;
}

let pausedAt = 0; // when the simulation last stopped playing
let toldRunning = null; // the running state last reported to the embedding page
function showInfo(info) {
  if (lastInfo?.playing && !info.playing) pausedAt = performance.now();
  lastInfo = info;
  if (info.playing !== toldRunning) { // the page suspends its own clips only while the demo runs (and is in view)
    toldRunning = info.playing;
    tellPage('dexgo-demo-running', { running: info.playing });
  }
  setPlay(info.playing || (wantPlay && autoPaused) ? 'Pause demo' : 'Play demo');
  ui.play.disabled = !!info.end;
  if (SCENE === 'marker') showMarker(info);
  Object.assign(document.body.dataset, { state: info.playing ? 'playing' : 'idle', step: String(info.step),
    simtime: info.simTime.toFixed(2) });
}

// --------------------------------------------------------------------------------------------- worker
const worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
let wantPlay = SCENE === 'chain'; // the chain starts by itself; the marker scene waits for Play
let autoPaused = false, inSight = true, ready = false;
let wantedNext = null; // Manual: the task the viewer clicked, until its goal starts (queueTask)
const counts = { restarts: 0, drops: 0, timeouts: 0 };

/** Whether the view can be seen: the document is visible and the view intersects the (top-level) viewport. */
function shown() {
  return inSight && document.visibilityState === 'visible';
}

/** Run the worker iff the viewer wants it and the view is visible (pauses off-screen and in background tabs); the
 *  frame loop follows (kick). Sent when the wish differs from the worker's last report or from the last request:
 *  the report lags a request by one worker round trip, so a 'pause' followed within it by the wish to play again
 *  (the view leaving and re-entering the screen, a tab hidden and shown again) would otherwise send nothing and
 *  leave the demo paused under "Play demo" (timeout_cmp/NOPLAY.md). */
let asked = false; // the last request sent: true 'play', false 'pause' (the worker starts paused)
function syncPlay() {
  kick();
  if (!ready) return;
  const run = wantPlay && shown();
  autoPaused = wantPlay && !shown();
  if (run === !!lastInfo?.playing && run === asked) return;
  asked = run;
  worker.postMessage({ type: run ? 'play' : 'pause' });
}
document.addEventListener('visibilitychange', syncPlay);
/** The page's nav pause (true) or play (false), 'dexgo-pause': a pause stops a demo the visitor wants running; a play
 *  resumes only a demo that pause stopped (pausedByPage), never one the visitor paused in the demo. */
function pageWantsPause(paused) {
  if (paused) {
    if (!wantPlay) return;
    wantPlay = false;
    pausedByPage = true;
    syncPlay();
    if (lastInfo) showInfo(lastInfo);
    return;
  }
  if (pausedByPage) {
    wantPlay = true;
    syncPlay();
    if (lastInfo) showInfo(lastInfo);
  }
  pausedByPage = false;
}
new IntersectionObserver((entries) => {
  inSight = entries[entries.length - 1].isIntersecting;
  syncPlay();
}).observe(ui.view);

// The view's two canvases fade, not #view itself: the loading line of a slow hand switch (#loading, inside #view)
// stays at full opacity over the dimmed scene.
let fadeOut = [];
const viewLayers = () => [renderer.domElement, ui.axes];
/** Object or hand switch: dim the view until the new model's first frame fades in. */
function dimView() {
  for (const a of fadeOut) a.cancel();
  fadeOut = viewLayers().map((el) => el.animate([{ opacity: 1 }, { opacity: 0.2 }],
    { duration: 220, easing: 'ease-in', fill: 'forwards' }));
}
const FADE_IN_MS = 380; // a cut's fade-in of the view (also the delay of a refusal outline shown with a cut)
/** Fade the view in from opacity `from` (a cut: 0; a failed hand switch: the dim it reached). */
function fadeIn(from = 0) {
  for (const a of fadeOut) a.cancel();
  fadeOut = [];
  for (const el of viewLayers()) {
    el.animate([{ opacity: from }, { opacity: 1 }], { duration: FADE_IN_MS, easing: 'ease-out' });
  }
}

const SWITCH_LINE_MS = 400; // a switch still loading after this long shows its loading line
const LINE_MIN_MS = 400; // a shown loading line stays at least this long (it never flashes for a few frames)
/** Hide the loading line now (and drop a held line's timer). */
function hideLine() {
  clearTimeout(lineHold?.timer);
  lineHold = null;
  ui.loading.hidden = true;
}
/** A hand or object switch starts: the view dims, the Mode tabs and the graph's nodes wait (the hand and object tabs
 *  are set by the caller); a switch still loading after SWITCH_LINE_MS shows its line ("Loading the Sharpa hand…",
 *  "Loading the hexagonal object…") over the dimmed view (no line on a fast link). If the last switch's line is still
 *  held (endSwitch), it goes on at once as this switch's line: it never flashes off and on, never shows the old text. */
function beginSwitch(line) {
  clearTimeout(switching?.timer);
  const held = lineHold;
  clearTimeout(held?.timer);
  lineHold = null;
  const s = { timer: 0, shownAt: held ? held.since : 0 };
  const show = () => {
    ui.loading.textContent = line;
    ui.loading.hidden = false;
    ui.view.setAttribute('aria-busy', 'true');
  };
  if (held) {
    show();
  } else {
    s.timer = setTimeout(() => {
      s.shownAt = performance.now();
      show();
    }, SWITCH_LINE_MS);
  }
  switching = s;
  for (const b of ui.modes) b.setAttribute('aria-disabled', 'true');
  if (lastChain) showChain(lastChain); // the nodes stop being buttons now, not at the next frame
  dimView();
}
/** The switch's model arrived, or its files failed: the Mode tabs and nodes answer again at once; a loading line that
 *  was shown goes once it has been up LINE_MIN_MS (the new model fades in under it meanwhile). */
function endSwitch() {
  if (!switching) return;
  clearTimeout(switching.timer);
  const { shownAt } = switching;
  switching = null;
  const left = shownAt ? LINE_MIN_MS - (performance.now() - shownAt) : 0;
  if (left > 0) lineHold = { since: shownAt, timer: setTimeout(hideLine, left) };
  else hideLine();
  ui.view.removeAttribute('aria-busy');
  for (const b of ui.modes) b.removeAttribute('aria-disabled');
}
// during a switch a click, Enter or Space on a node chooses nothing and draws no refusal outline (the arrows still move)
ui.graph.addEventListener('click', (e) => { if (switching) e.stopPropagation(); }, true);
ui.graph.addEventListener('keydown', (e) => {
  if (switching && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

function onFrame(msg) {
  const now = performance.now();
  kick();
  prevPoses = msg.cut ? null : nextPoses;
  nextPoses = msg.poses;
  prevHand = msg.cut ? null : nextHand;
  nextHand = msg.hand;
  prevObject = msg.cut ? null : nextObject;
  nextObject = msg.object;
  // frames later than the nominal step (a slow device; never after a cut, a pause or a restart hold): interpolate over
  // their smoothed arrival interval, so the motion stays continuous instead of moving and holding
  const gap = now - arrived, steady = !msg.cut && gap < 4 * stepMs;
  if (steady) stats.hold += Math.max(0, gap - span); // the last pose stood still on screen for this long
  span = steady ? Math.max(stepMs, span + 0.25 * (gap - span)) : stepMs;
  arrived = now;
  if (!posed) { // first pose of this model: show the object (the hand colliders follow styleColliders)
    posed = true;
    const hand = new Set(handMeshes.map(([m]) => m));
    for (const m of meshes) if (m && !hand.has(m)) m.visible = true;
    styleColliders();
  }
  if ('goal' in msg) setGoal(msg.goal, msg.ghost);
  if (msg.view) { // a Set goal goal started: the view turns by its Turn (EDITOR_VIEW), the grid comes along
    editorCamera(msg.view);
    if (msg.goal) floorUnder(msg.hand, msg.goal.wristP, [msg.hand, msg.goal.wristP, msg.object, msg.goal.objectP]);
  }
  const events = msg.events ?? [];
  for (const e of events) if (e.type === 'goal' && e.node === wantedNext) wantedNext = null; // the clicked task runs
  // Manual: every goal and result is read; Random chain: only every PROGRESS_EVERY-th completed goal (say)
  const modeNow = (msg.chain ?? lastChain)?.mode, editing = modeNow === 'editor';
  const manual = modeNow === 'manual' || editing;
  // a timeout comes before its recovery or fresh start in the same frame: their note names the task ("GL not reached")
  let timedOut = null;
  for (const e of events) { // a failure and its fresh start come in the same frame (cut 'restart')
    if (e.type === 'drop' || e.type === 'timeout') counts[`${e.type}s`] += 1;
    if (e.type === 'timeout') timedOut = e.node;
    if (e.type === 'done') { // held SUCCESS_MS while the next goal already runs
      flashNote(`✓ ${e.node} reached`, SUCCESS_MS, 'done');
      const done = msg.chain?.goalsDone ?? 0;
      if (manual) say(`${e.node} reached.`, { reached: e.node });
      else if (done > 0 && done % PROGRESS_EVERY === 0) say(`${done} goals completed.`);
    }
    if (e.type === 'goal' && manual) {
      say(GRAPH_NODES.has(e.node) ? `Goal ${e.node}: ${taskWords(e.node)}.` : 'Goal started.', { goal: e.node });
    }
    if (e.type === 'recover') {
      const text = timedOut ? `${timedOut} not reached: continuing from the current grasp.` : NOTES.recover;
      flashNote(text);
      say(text);
    }
    if (e.type === 'restart') {
      counts.restarts += 1;
      const text = e.reason === 'timeout' && timedOut ? `${timedOut} not reached: starting from a new initial grasp.`
        : (NOTES[e.reason] ?? NOTES.restart);
      flashNote(text);
      say(text);
    }
  }
  if (msg.cut) { // 'init' | 'load' (object switch) | 'hand' (hand switch) | 'reset' (Reset) | 'restart' (fresh start)
    const handP = msg.hand.subarray(0, 3), objP = msg.object.subarray(0, 3);
    if (SCENE === 'marker') frameMarker(objP, goal.objectP, handP);
    else if (msg.cut !== 'restart') frameChain(objP, handP); // the fixed camera (also the follow camera's direction)
    follow.snap = true; // the follow camera jumps to the new state, it never pans across a cut
    follow.reaim = true;
    if (msg.cut !== 'restart' && SCENE === 'chain') placeFloor(objP, handP);
    else if (floor.userData.origin) floor.position.copy(floor.userData.origin); // a fresh start at home: the grid too
    if (msg.cut !== 'restart') follow.manual = 0; // load, Reset, an object or hand switch: automatic zoom again
    if (msg.cut !== 'restart') { follow.heading = 0; follow.dir = null; } // frameChain's default view
    else if (editing) editorCameraBack(); // a fresh start at the home pose: Set goal's default view again
    // frameChain's snap moved the camera: not a viewer zoom (followStep reads a distance other than the one it applied
    // as one; before 2026-11-22 every Reset and object switch left the view at the fixed camera's zoom, 1594 instead of
    // about 3000 px per metre at 1440 x 900)
    follow.applied = 0;
    // a fresh start of the old model while a switch loads keeps the view dimmed and the loading line (the switch's own
    // cut comes after its model, which ended the switch)
    if (!switching) {
      if (msg.cut !== 'init') fadeIn();
      if (!lineHold) ui.loading.hidden = true; // a switch's line that was shown keeps its LINE_MIN_MS (endSwitch)
    }
    if (SCENE === 'chain' && msg.cut === 'init') say(`Demo running in ${MODE_NAMES[msg.chain?.mode] ?? 'Random chain'}.`);
    if (SCENE === 'chain' && msg.cut === 'reset') say(`Reset. ${NOTES.restart}`);
    if (SCENE === 'chain' && msg.cut === 'load') say(`${labelOf.get(current) ?? 'New'} object loaded. ${NOTES.restart}`);
    if (SCENE === 'chain' && msg.cut === 'hand') say(`${hand?.label ?? 'New'} hand loaded. ${NOTES.restart}`);
  }
  // Manual: a failure (a timeout or drop starts a fresh grasp; a recovery keeps the grasp) clears the runner's queue, or
  // drops a queued task the grasp no longer offers. The task the viewer clicked is queued again when the grasp offers
  // it (it starts after the fresh start's hold), else its node shows the refusal outline; either way it is said.
  if (editing && (msg.cut || events.some((e) => ['done', 'recover', 'restart', 'end', 'drop'].includes(e.type)))) editorFresh();
  const failed = events.some((e) => e.type === 'restart' || e.type === 'recover');
  if (failed && wantedNext && msg.chain?.mode === 'manual' && !msg.chain.queued && msg.chain.phase !== 'ended') {
    const node = wantedNext;
    if (msg.chain.available?.includes(node)) {
      worker.postMessage({ type: 'queue', node });
      msg.chain = { ...msg.chain, queued: node }; // shown until the worker's own chain state arrives
      say(`Next: ${node}, ${taskWords(node)}.`);
    } else {
      wantedNext = null;
      // after the view's fade-in (a fresh start's cut), held 1.2 s: a sighted visitor sees that the pick was dropped
      graph?.refuse(node, { delay: msg.cut ? FADE_IN_MS : 0, hold: REFUSED_HOLD_MS });
      say(`${node} is not available from this grasp.`);
    }
  }
  if (msg.chain) showChain(msg.chain);
  showInfo(msg.info);
  // The worker resumes by itself after a switch or Reset if it was playing when that began (sim.worker.js: settle,
  // then startRun(cut, was)); a Pause or the view leaving the screen in the meantime still holds (at most one more
  // control step runs).
  if (ready && msg.info.playing && !(wantPlay && shown())) syncPlay();
  Object.assign(document.body.dataset, { restarts: String(counts.restarts), drops: String(counts.drops),
    timeouts: String(counts.timeouts) });
}

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'model') {
    ({ policyDt } = msg);
    stepMs = span = (1000 * policyDt) / msg.speed;
    document.body.dataset.speed = String(msg.speed);
    nStarts = msg.nStarts ?? 1;
    endSwitch(); // the switch's model is here: its first frame follows
    if (msg.hand) { // the hand this model belongs to: its look (fetched before the worker was asked for it)
      hand = hands.find((h) => h.id === msg.hand) ?? hand;
      look = looks.get(msg.hand) ?? look;
      document.body.dataset.hand = msg.hand;
      for (const b of ui.hands.querySelectorAll('[data-hand]')) {
        b.setAttribute('aria-pressed', String(b.dataset.hand === msg.hand));
        b.removeAttribute('aria-disabled');
      }
    }
    buildScene(msg.geoms);
    if (msg.object) {
      current = msg.object;
      document.body.dataset.object = slugOf.get(msg.object) ?? '';
      for (const b of ui.objects.querySelectorAll('[data-object]')) {
        b.setAttribute('aria-pressed', String(b.dataset.object === document.body.dataset.object));
        b.removeAttribute('aria-disabled');
      }
    }
    if (msg.hand) { // the page's "Open in a new tab" follows (the object tabs list this hand's objects in order)
      const object = slugOf.get(current) ?? '';
      tellPage('dexgo-demo-hand', { hand: msg.hand, first: msg.hand === hands[0]?.id, object,
        firstObject: object === ui.objects.querySelector('[data-object]')?.dataset.object });
    }
  } else if (msg.type === 'frame') {
    onFrame(msg);
    if (!ready) { // the controls that need a running chain (the mode tabs too: the worker has no runner before)
      ready = true;
      ui.play.disabled = ui.reset.disabled = false;
      for (const b of ui.modes) b.disabled = false;
      if (focusWanted) ui.play.focus({ focusVisible: true });
      syncPlay();
    }
  } else if (msg.type === 'editor') {
    onEditor(msg);
  } else if (msg.type === 'chain') {
    showChain(msg.chain);
  } else if (msg.type === 'error') {
    if (msg.fatal) fail(msg.message); // init, an object switch or Reset failed: nothing runs
    else console.error(msg.message);
  }
};
worker.onerror = (e) => fail(`worker: ${e.message}`);

// --------------------------------------------------------------------------------------------- controls
/** The Pause / Play icon button: its hidden label (its name, which the tools read as its text) and tooltip, and the
 *  glyph (data-paused shows Play). */
function setPlay(label) {
  if (ui.playLabel.textContent === label) return;
  ui.playLabel.textContent = label;
  ui.play.dataset.tip = label;
  ui.play.toggleAttribute('data-paused', label === 'Play demo');
}

/** A segmented control's thumb under its pressed segment (offsets within the track, px); it slides from the second
 *  placement on (data-placed), and is hidden while no segment is pressed or the track is not laid out (closed
 *  popover; a ResizeObserver places it when the popover opens). */
function placeThumb(seg) {
  const on = seg.querySelector('.toggle[aria-pressed="true"]');
  const thumb = seg.querySelector('.seg-thumb');
  if (!thumb) return;
  if (!on || !seg.offsetWidth) {
    thumb.style.visibility = 'hidden';
    return;
  }
  seg.style.setProperty('--x', `${on.offsetLeft}px`);
  seg.style.setProperty('--w', `${on.offsetWidth}px`);
  thumb.style.visibility = '';
  if (!seg.hasAttribute('data-placed')) requestAnimationFrame(() => seg.setAttribute('data-placed', ''));
}
const segs = [ui.hands, ui.objects, ui.modes[0].parentElement];
const thumbs = new ResizeObserver((entries) => { for (const e of entries) placeThumb(e.target); });
for (const seg of segs) thumbs.observe(seg);

/** The setup menu button: it names the pressed hand and object ("MANO · Round", also while a switch loads) and
 *  answers only while no model loads (aria-disabled, not disabled, so a keyboard user keeps the focus on it). */
function syncSetup() {
  const pressed = (box) => box.querySelector('.toggle[aria-pressed="true"]')?.textContent;
  ui.setupHand.textContent = pressed(ui.hands) ?? ui.setupHand.textContent;
  ui.setupObject.textContent = pressed(ui.objects) ?? ui.setupObject.textContent;
  const busy = !ui.hands.querySelector('[data-hand]') || !ui.objects.querySelector('[data-object]')
    || !!ui.pop.querySelector('[aria-disabled="true"]');
  if (busy) ui.setup.setAttribute('aria-disabled', 'true');
  else ui.setup.removeAttribute('aria-disabled');
  for (const seg of segs) placeThumb(seg);
}
// the hand, object and mode tabs change their pressed / disabled marks in many places (switches, the worker's model
// message, a failed hand switch, a click on a node that turns Random chain into Manual): one observer follows them all
new MutationObserver(syncSetup).observe(ui.pop, { subtree: true, childList: true, attributes: true,
  attributeFilter: ['aria-pressed', 'aria-disabled'] });
new MutationObserver(() => placeThumb(segs[2])).observe(segs[2], { subtree: true, attributes: true,
  attributeFilter: ['aria-pressed'] });

/** The setup popover: opens from the button (click, Enter, Space), closes on Escape, a choice, a click or focus
 *  outside, or when the frame loses the focus (a click in the embedding page); Escape and a choice return the focus
 *  to the button. */
function openSetup(open, refocus = false) {
  if (open === !ui.pop.hidden) return;
  ui.pop.hidden = !open;
  ui.setup.setAttribute('aria-expanded', String(open));
  if (open) {
    for (const seg of [ui.hands, ui.objects]) placeThumb(seg);
    (ui.hands.querySelector('[aria-pressed="true"]') ?? ui.hands.querySelector('button'))?.focus();
  } else if (refocus) ui.setup.focus();
}
ui.setup.onclick = () => {
  if (ui.setup.getAttribute('aria-disabled') === 'true' && ui.pop.hidden) return;
  openSetup(ui.pop.hidden);
};
ui.setup.parentElement.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.pop.hidden) {
    e.preventDefault();
    e.stopPropagation();
    openSetup(false, true);
  }
});
// a choice closes the popover after the tab's own handler has started the switch (bubbling order)
ui.pop.addEventListener('click', (e) => { if (e.target.closest('.toggle')) openSetup(false, true); });
ui.setup.parentElement.addEventListener('focusout', (e) => {
  if (e.relatedTarget && !ui.setup.parentElement.contains(e.relatedTarget)) openSetup(false);
});
document.addEventListener('pointerdown', (e) => {
  if (!ui.pop.hidden && !ui.setup.parentElement.contains(e.target)) openSetup(false);
});
window.addEventListener('blur', () => openSetup(false));

ui.play.onclick = () => {
  pausedByPage = false; // the visitor's own choice: a later nav play does not override it
  wantPlay = !(lastInfo?.playing || autoPaused);
  syncPlay();
  if (lastInfo) showInfo(lastInfo);
};
ui.reset.onclick = () => {
  if (SCENE === 'marker') {
    start = (start + 1) % nStarts;
    worker.postMessage({ type: 'reset', start });
  } else {
    counts.restarts = counts.drops = counts.timeouts = 0;
    note.until = 0;
    wantedNext = null;
    pausedByPage = false;
    worker.postMessage({ type: 'reset' });
  }
};
const MODE_NAMES = { random: 'Random chain', manual: 'Manual', editor: 'Set goal' };
for (const b of ui.modes) {
  b.onclick = () => {
    if (b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-disabled') === 'true') return; // (a switch)
    if (b.dataset.mode !== 'manual') wantedNext = null; // Random chain and Set goal forget a Manual pick (worker too)
    if (document.body.dataset.mode === 'editor') editorCameraBack(); // the default view back
    for (const o of ui.modes) o.setAttribute('aria-pressed', String(o === b));
    worker.postMessage({ type: 'mode', mode: b.dataset.mode });
    document.body.dataset.mode = b.dataset.mode;
    if (b.dataset.mode === 'editor') editorFresh();
    say(`${MODE_NAMES[b.dataset.mode]}.`);
  };
}

// ---------------------------------------------------------------------------- Set goal (the hands-on editor)
// The page sends the setting; the worker (app/editor.js) builds the exact goal (base grasp + exact roll / slide, no
// snapping), clamps it to the trained single-goal ranges and answers with the offered grasp types, the applied values
// and the goal's ghost. Go runs it as
// ONE goal (ChainRunner.runCustom); afterwards the editor starts again from the new state.
// Sliders: Position is the fingertip-cluster centre along the object (mm, absolute; enclosure targets only); Roll,
// Right / Away (#ed-x / #ed-y: the move along the view's screen right and away from the viewer, awayDeg), Height,
// Turn, Tilt and Twist are changes RELATIVE to the reached pose (0 = no change; after each goal
// they start at zero again, so turns and travel add up). The tracks span the full per-goal ranges (Move +-250 mm,
// Height +-150 mm, rotations +-90 deg); the part a guard forbids (the worker's limits: each slider's interval with
// the others at their values) is washed out and the thumb stops at its edge (each slider clamped on its own, no
// coupled pull-back); a slider with no room left is greyed. The tick marks the current state (Position: the current
// grip; its track also reaches a current grip outside -50..55 mm, washed out), the fill the asked change. On release,
// on a grasp choice and after an orbit of the view, each thumb moves to the value the goal applies, and the preview
// follows, so a thumb always matches its readout. A greyed grasp choice does nothing (review M1).
const ed = { form: $('editor'), grasp: $('ed-grasp'), go: $('ed-go'), aRow: document.querySelector('[data-for="a"]'),
  inputs: {}, outs: {}, seq: 0, design: null, options: [], family: null, busy: true, timer: 0, noop: true,
  touchedA: false, settle: false, zeroA: 0, lim: {} };
const ED_KEYS = ['a', 'roll', 'x', 'y', 'z', 'turn', 'tilt', 'twist'];
const ED_WRIST = ['x', 'y', 'z', 'turn', 'tilt', 'twist']; // relative wrist keys (mm, deg), editor.js WRIST_KEYS
const ED_DEG = new Set(['roll', 'turn', 'tilt', 'twist']);
const A_MM = [-50, 55]; // the Position slider's range (mm; editor.js LIMITS.A_MM)
for (const k of ED_KEYS) {
  ed.inputs[k] = $(`ed-${k}`);
  ed.outs[k] = $(`ed-${k}-out`);
  ed.inputs[k].addEventListener('input', () => {
    if (k === 'a') ed.touchedA = true;
    const lim = ed.lim[k], el = ed.inputs[k]; // per-axis clamp to the guard interval (the others at their values)
    if (lim) el.value = String(Math.min(lim[1], Math.max(lim[0], Number(el.value))));
    paintSlider(k);
    editorChanged();
  });
  ed.inputs[k].addEventListener('change', () => { ed.settle = true; editorChanged(); });
}
const isEncl = (f) => f === 'E_n' || f === 'E_r';
/** Button text of target family f from start family f0 (the rod end named by the hand's side). */
function graspName(f0, f) {
  if (f === f0) return 'Keep';
  if (isEncl(f0)) return (f0 === 'E_n') === (f === 'T_b') ? 'Pinch, little-finger end' : 'Pinch, thumb end';
  return (f0 === 'T_b') === (f === 'E_n') ? 'Wrap, end to little finger' : 'Wrap, end to thumb';
}
/** The track of slider k: the tick at the current state (--z), the fill from it to the thumb (--v), as fractions. */
function paintSlider(k) {
  const el = ed.inputs[k], lo = Number(el.min), hi = Number(el.max), span = hi - lo || 1;
  const zero = k === 'a' ? ed.zeroA : 0;
  el.style.setProperty('--z', String(Math.min(1, Math.max(0, (zero - lo) / span))));
  el.style.setProperty('--v', String((Number(el.value) - lo) / span));
  const lim = ed.lim[k] ?? [lo, hi]; // the admissible part of the track (outside: washed out)
  el.style.setProperty('--la', String((lim[0] - lo) / span));
  el.style.setProperty('--lb', String((lim[1] - lo) / span));
  el.closest('.ed-row')?.classList.toggle('ed-blocked', lim[0] === 0 && lim[1] === 0 && ED_WRIST.includes(k));
}
function setSlider(k, value, range = null) {
  const el = ed.inputs[k];
  if (range) { el.min = String(range[0]); el.max = String(range[1]); }
  el.value = String(Math.round(value));
  paintSlider(k);
}
function editorSetting() {
  const v = (k) => Number(ed.inputs[k].value);
  return { family: ed.family, aMm: ed.touchedA ? v('a') : null, rollDeg: v('roll'),
    wrist: Object.fromEntries(ED_WRIST.map((k) => [k, v(k)])), awayDeg: awayDeg() };
}
function editorLock(on) {
  ed.busy = on;
  for (const el of Object.values(ed.inputs)) el.disabled = on;
  for (const b of ed.grasp.querySelectorAll('button')) b.disabled = on;
  ed.go.disabled = on || !ed.design || ed.noop;
}
/** A fresh start from the runner's current design (after a goal, a recovery, a fresh grasp, a load or the mode). */
function editorFresh() {
  ed.design = null;
  editorLock(true);
  worker?.postMessage({ type: 'editor', seq: ++ed.seq, setting: null, awayDeg: awayDeg() });
}
// an orbit moves screen right / away: the preview follows the new view, the thumbs to the values it applies
controls.addEventListener('end', () => {
  if (document.body.dataset.mode !== 'editor' || ed.busy || !ed.design) return;
  ed.settle = true;
  editorChanged();
});
function editorChanged() {
  if (ed.busy || !ed.design) return;
  ed.aRow.hidden = !isEncl(ed.family);
  clearTimeout(ed.timer); // at most one preview request per frame of slider motion
  ed.timer = setTimeout(() => worker?.postMessage({ type: 'editor', seq: ++ed.seq, setting: editorSetting() }), 30);
}
function renderGrasp(f0) {
  ed.grasp.replaceChildren(...ed.options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-choice';
    b.textContent = graspName(f0, o.family);
    b.dataset.family = o.family;
    b.setAttribute('aria-pressed', String(o.family === ed.family));
    if (!o.enabled) b.setAttribute('aria-disabled', 'true');
    b.disabled = ed.busy;
    b.onclick = () => { // (Enter / Space on a focused chip too) the live offer, not the one this chip was drawn with
      const live = ed.options.find((x) => x.family === b.dataset.family);
      if (!live?.enabled || ed.busy || ed.family === live.family) return;
      ed.family = live.family;
      ed.settle = true; // the thumbs move to what the new grasp applies (a switch caps the turn at 60 deg)
      for (const x of ed.grasp.children) x.setAttribute('aria-pressed', String(x.dataset.family === ed.family));
      editorChanged();
    };
    return b;
  }));
}
const fmt = (v, unit, signed = false) => {
  const r = Math.round(v) === 0 ? 0 : Math.round(v);
  return `${signed && r > 0 ? '+' : ''}${r}${unit}`;
};
/** A new design (sliders at "no change", Keep), relative to the reached pose: the wrist tracks keep their full
 *  spans, the design's limits wash out what the guards forbid. */
function editorStart(design, options) {
  ed.family = design.family;
  ed.options = options;
  ed.touchedA = false;
  ed.settle = false;
  ed.zeroA = Math.round(design.aMm);
  // the Position track: LIMITS.A_MM (editor.js), reaching the current grip when it lies outside (washed out)
  setSlider('a', design.aMm, [Math.min(A_MM[0], ed.zeroA), Math.max(A_MM[1], ed.zeroA)]);
  ed.lim = { a: A_MM, ...design.limits };
  setSlider('roll', 0);
  for (const k of ED_WRIST) setSlider(k, 0);
  for (const k of ED_KEYS) { setText(ed.outs[k], ''); ed.inputs[k].removeAttribute('aria-valuetext'); }
  ed.aRow.hidden = !isEncl(ed.family);
  renderGrasp(design.family);
}
function onEditor(msg) {
  if (msg.seq !== ed.seq) return; // a later request is on its way
  if (!msg.design) { ed.design = null; editorLock(true); return; }
  if (msg.running) { // a goal still runs (entered during a Random / Manual goal): its design, locked until it ends
    ed.design = null;
    editorStart(msg.design, msg.options);
    editorLock(true);
    return;
  }
  if (!ed.design) { // a new start: Keep, the current position, no roll, no move, no turn
    ed.design = msg.design;
    ed.noop = true;
    editorStart(msg.design, msg.options);
    editorLock(false);
    worker.postMessage({ type: 'editor', seq: ++ed.seq, setting: editorSetting() });
    return;
  }
  ed.options = msg.options;
  ed.lim = { a: msg.applied?.aLimitsMm ?? ed.lim.a ?? A_MM, ...msg.design.limits };
  for (const b of ed.grasp.children) { // the switch rules follow the setting (total turn, joint guards)
    const o = ed.options.find((x) => x.family === b.dataset.family);
    if (o?.enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
  }
  for (const k of ED_KEYS) paintSlider(k);
  if (msg.started) { editorLock(true); return; }
  if (msg.custom) editorLock(false); // Go was refused (a no-op): the preview below
  if (msg.goal) setGoal(msg.goal, msg.ghost, false); // a preview: no re-aim
  const sn = msg.applied;
  if (sn) { // the exact values of the goal that will run (clamped position / roll, clamped wrist)
    const vals = { a: sn.aMm, roll: sn.rollDeg, ...sn.wrist };
    for (const k of ED_KEYS) {
      const text = fmt(vals[k], ED_DEG.has(k) ? '°' : ' mm', k !== 'a');
      setText(ed.outs[k], text);
      ed.inputs[k].setAttribute('aria-valuetext', text);
    }
    if (ed.settle) { // released: each thumb to the applied value; the preview follows when one moved
      ed.settle = false;
      let moved = false;
      for (const k of ED_KEYS) {
        if (k === 'a' && !isEncl(sn.family)) continue; // (no Position row; untouched, its value stays unsent)
        const before = ed.inputs[k].value;
        setSlider(k, vals[k]);
        moved ||= ed.inputs[k].value !== before;
      }
      if (moved) editorChanged();
    }
  }
  ed.noop = !sn || !!msg.noop;
  ed.go.disabled = ed.busy || ed.noop;
}
ed.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (ed.busy || !ed.design || ed.noop) return;
  clearTimeout(ed.timer);
  editorLock(true);
  worker.postMessage({ type: 'custom', seq: ++ed.seq, setting: editorSetting() });
  if (note.kind === 'done') note.until = 0;
  pausedByPage = false;
  wantPlay = true;
  syncPlay();
});
editorLock(true);

/** A click on an available node: queue it as the next goal (it starts once the running goal is done, at once when
 *  the runner waits); in Random chain the click switches to Manual first. It also starts a paused simulation. The
 *  choice is kept (wantedNext) until its goal starts, so a failure that clears the runner's queue cannot drop it
 *  silently (onFrame); Reset, an object switch and Random chain forget it. */
function queueTask(node) {
  wantedNext = node;
  if (lastChain && lastChain.mode !== 'manual') {
    for (const b of ui.modes) b.setAttribute('aria-pressed', String(b.dataset.mode === 'manual'));
    worker.postMessage({ type: 'mode', mode: 'manual' });
    lastChain = { ...lastChain, mode: 'manual' };
  }
  worker.postMessage({ type: 'queue', node });
  if (note.kind === 'done') note.until = 0; // the click's own feedback ("Next: ...") replaces a success note
  if (lastChain) showChain({ ...lastChain, queued: node });
  say(`Next: ${node}, ${taskWords(node)}.`);
  pausedByPage = false;
  wantPlay = true;
  syncPlay();
}

function selectObject(id) {
  if (current === id || ui.objects.querySelector('[aria-disabled="true"]')) return; // (a model is still loading)
  for (const b of ui.objects.querySelectorAll('[data-object]')) {
    b.setAttribute('aria-pressed', String(b.dataset.object === slugOf.get(id)));
    // until the model is loaded: aria-disabled, not disabled, so a keyboard switch keeps the focus on the pressed tab
    b.setAttribute('aria-disabled', 'true');
  }
  counts.restarts = counts.drops = counts.timeouts = 0;
  note.until = 0;
  wantedNext = null;
  // dims the view: the new model's first frame fades in ("object", not "rod": the demo and the page say object)
  beginSwitch(`Loading the ${(labelOf.get(id) ?? 'new').toLowerCase()} object…`);
  worker.postMessage({ type: 'object', object: id });
}

/** The object list of a hand (its objects/index.json: [{id, label}] or {objects: [...]}). */
let current = null; // id of the loaded object
const slugOf = new Map(); // object id -> slug of its label
const labelOf = new Map(); // object id -> its label (tab text)
async function objectIndex(entry) {
  const index = await fetchLoader(entry.rootUrl).json('objects/index.json');
  return (Array.isArray(index) ? index : index.objects).map((o) => (typeof o === 'string' ? { id: o } : o));
}

/** The object tabs of a list; wanted (an id or a label slug: ?object=, or the object shown before a hand switch) picks
 *  the first, else the list's first object; its tab is marked pressed at once (a hand switch keeps the mark). The page
 *  shows the labels; DOM attributes carry slugs of the labels ("round", "hexagonal"), never the ids. Built only once
 *  a hand's files are all in, so a failed hand switch leaves the loaded hand's tabs. */
function objectTabs(list, wanted) {
  const labelFor = (o) => o.label ?? o.name ?? o.id;
  const slug = (o) => labelFor(o).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const chosen = (list.find((o) => o.id === wanted || slug(o) === wanted) ?? list[0]).id;
  for (const b of ui.objects.querySelectorAll('[data-object]')) b.remove(); // (the track's thumb stays)
  for (const o of list) {
    slugOf.set(o.id, slug(o));
    labelOf.set(o.id, labelFor(o));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle';
    b.dataset.object = slugOf.get(o.id);
    b.textContent = labelFor(o);
    b.setAttribute('aria-pressed', String(o.id === chosen));
    b.setAttribute('aria-disabled', 'true'); // until its model is loaded
    b.onclick = () => { if (b.getAttribute('aria-disabled') !== 'true') selectObject(o.id); };
    ui.objects.appendChild(b);
  }
  return chosen;
}

// --------------------------------------------------------------------------------------------- hands
// assets/hands.json (app/hands.js): one tab per hand beside the object tabs; the first hand is the default (?hand=<id>
// picks another). A hand's object list and, for look "visual", its render meshes are fetched when it is first chosen;
// the worker then loads its policy and model (message 'hand'). Its first frame arrives as a cut 'hand', like an
// object switch: the view fades in from the new start grasp, the camera snaps, the goal counter restarts.
let hands = [], hand = null; // resolveHands entries; the hand whose model is loaded (or being loaded)
const looks = new Map(); // hand id -> look (buildScene)

/** The look of a hand: 'colliders' as it is; 'visual' with its render meshes as three.js geometries (creased normals,
 *  computed in millimetres as the object's) and its two materials. Fetched once per hand. */
async function lookOf(entry) {
  if (looks.has(entry.id)) return looks.get(entry.id);
  let result = { kind: 'colliders' };
  if (entry.look === 'visual') {
    const header = await (await fetchOk(entry.visualUrl)).json();
    const buffer = await (await fetchOk(new URL(header.bin, entry.visualUrl))).arrayBuffer();
    const visual = decodeVisual(header, buffer);
    const geometries = visual.meshes.map((m) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(m.position), 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.index), 1));
      geo.scale(1000, 1000, 1000);
      const out = toCreasedNormals(geo, LOOK.visualCrease).scale(1e-3, 1e-3, 1e-3);
      geo.dispose();
      out.computeBoundingBox(); // the follow camera frames a visual-look hand by its parts' boxes
      return out;
    });
    // dielectric (metallic 0, as the render's Principled BSDF) with the hand's own environment intensity (LOOK.visual)
    const material = (m) => new THREE.MeshPhysicalMaterial({ color: m.color, roughness: m.roughness, metalness: 0,
      specularIntensity: m.specular, envMap: scene.environment, envMapIntensity: m.fill });
    result = { kind: 'visual', parts: visual.parts, geometries,
      shell: material(LOOK.visual.shell), pad: material(LOOK.visual.pad) };
  }
  looks.set(entry.id, result);
  return result;
}
const fetchOk = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
};

function handTabs() {
  for (const h of hands) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle';
    b.dataset.hand = h.id;
    b.textContent = h.label;
    b.setAttribute('aria-pressed', String(h === hand));
    b.setAttribute('aria-disabled', 'true'); // until the first model is loaded
    b.onclick = () => { if (b.getAttribute('aria-disabled') !== 'true') selectHand(h.id); };
    ui.hands.appendChild(b);
  }
}

/** A hand tab: fetch the hand's object list and look, then ask the worker for its model (same object shape if the
 *  hand has one: Round stays Round). The tabs wait (aria-disabled) until its model arrives. If the hand's files cannot
 *  be fetched, nothing has been sent to the worker: the loaded hand keeps running at full opacity, its tabs answer
 *  again and the note line says so (not the start-up failure, which would leave the demo dead). */
async function selectHand(id) {
  const entry = hands.find((h) => h.id === id);
  if (!entry || entry === hand || switching || ui.objects.querySelector('[aria-disabled="true"]')) return;
  const tabs = () => [...ui.hands.querySelectorAll('[data-hand]'), ...ui.objects.querySelectorAll('[data-object]')];
  const press = (wanted) => {
    for (const b of ui.hands.querySelectorAll('[data-hand]')) {
      b.setAttribute('aria-pressed', String(b.dataset.hand === wanted));
    }
  };
  for (const b of tabs()) b.setAttribute('aria-disabled', 'true');
  press(id);
  beginSwitch(`Loading the ${entry.label} hand…`); // dims the view: the new model's first frame fades in
  try {
    const [list] = await Promise.all([objectIndex(entry), lookOf(entry)]);
    const object = objectTabs(list, slugOf.get(current));
    hand = entry;
    counts.restarts = counts.drops = counts.timeouts = 0;
    note.until = 0;
    wantedNext = null;
    worker.postMessage({ type: 'hand', hand: entry.id, root: entry.root, object });
  } catch (err) {
    console.error(`hand ${id}: ${err?.message ?? err}`);
    const dim = Number(getComputedStyle(renderer.domElement).opacity);
    endSwitch();
    for (const b of tabs()) b.removeAttribute('aria-disabled');
    press(hand.id);
    fadeIn(Number.isFinite(dim) ? dim : 0.2);
    const text = `The ${entry.label} hand could not be loaded.`;
    flashNote(text, 2600, 'error'); // as long as the other notes
    if (lastChain) showChain(lastChain); // the note now, also while paused (no frames)
    say(text);
  }
}

if (SCENE === 'marker') {
  worker.postMessage({ type: 'init', scene: 'marker', model: MODEL });
} else {
  (async () => {
    hands = resolveHands(await fetchLoader(ASSETS).json('hands.json'), ASSETS);
    hand = hands.find((h) => h.id === params.get('hand')?.toLowerCase()) ?? hands[0];
    handTabs();
    const [list] = await Promise.all([objectIndex(hand), lookOf(hand)]);
    const object = objectTabs(list, params.get('object'));
    look = looks.get(hand.id);
    worker.postMessage({ type: 'init', scene: 'chain', hand: hand.id, root: hand.root, object, mode: 'random',
      seed: SEED, opening: OPENING, slowStep: SLOW_STEP });
  })().catch((err) => fail(`hands / object list: ${err?.message ?? err}`));
}

// --------------------------------------------------------------------------------------------- frame loop
// The loop draws only while something moves: the simulation plays, a pose interpolation or the goal ghost's fade-in
// is under way, the follow camera is still more than 1 px from its aim, or OrbitControls is damping a
// viewer's orbit. It stops otherwise, and whenever the document is hidden or the view is off screen (the worker is
// paused then too). kick() restarts it: a worker frame, a viewer's orbit or zoom, a resize, the view coming back on
// screen, the skin texture. After a stop the first frame has dt = 0, so the camera filter does not jump.
// window.viewerStats: rolling means over the last 120 frames (ms): frame interval, CPU time of the frame update
// (poses + skin + subdivision), of the two render calls (WebGL command submission) and of the axes; n = frames drawn;
// hold = wall ms during which the drawn pose stood still while playing (the interpolation had reached the latest step
// and the next one had not arrived; a stall on screen); span = the current interpolation time (ms).
// window.viewerCamera(): camera position and target (m), for tests.
const stats = { n: 0, interval: 0, update: 0, render: 0, overlay: 0, last: 0, hold: 0, span: 0,
  why: { playing: 0, interpolation: 0, ghost: 0, camera: 0, controls: 0 } }; // frames that kept the loop running
window.viewerStats = stats;
window.viewerCamera = () => [...camera.position.toArray(), ...controls.target.toArray()];
const mean = (old, x, n) => old + (x - old) / Math.min(n, 120);
let rafId = 0, inFrame = false, toldReady = false;
// window.viewerSpan() (tests): the view (CSS px) and the projected boxes [x0, y0, x1, y1] (CSS px, view frame) of the
// hand (collider centres, grown by a 1.2 cm radius at the target's scale; a visual-look hand: its parts' box corners),
// the object (its box corners) and the goal (goal object box corners and goal hand collider centres, or its parts' box
// corners), as the follow camera sees them in the latest frame
window.viewerSpan = () => {
  const w = ui.view.clientWidth, h = ui.view.clientHeight, v = new THREE.Vector3();
  const box = () => [Infinity, Infinity, -Infinity, -Infinity];
  const put = (b, p, r = 0) => {
    v.copy(p).project(camera);
    const x = (v.x + 1) * 0.5 * w, y = (1 - v.y) * 0.5 * h;
    b[0] = Math.min(b[0], x - r); b[1] = Math.min(b[1], y - r); b[2] = Math.max(b[2], x + r); b[3] = Math.max(b[3], y + r);
  };
  const corners = (b, mesh) => {
    const bb = mesh.geometry.boundingBox;
    for (let i = 0; i < 8; i++) {
      put(b, new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z)
        .applyMatrix4(mesh.matrix));
    }
  };
  const scale = h / (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const hand = box(), object = box(), goalBox = box();
  if (parts.length) for (const p of parts) corners(hand, p.mesh); // a visual-look hand: its parts' boxes
  else for (const [mesh] of handMeshes) put(hand, new THREE.Vector3().setFromMatrixPosition(mesh.matrix), 0.012 * scale);
  for (const mesh of objectMeshes) corners(object, mesh);
  if (goal) {
    for (const ghost of ghosts) corners(goalBox, ghost);
    if (parts.length) for (const p of parts) corners(goalBox, p.ghost);
    else for (const ghost of handGhosts) put(goalBox, new THREE.Vector3().setFromMatrixPosition(ghost.matrix));
  }
  return { w, h, reserve: follow.reserve, hand, object, goal: goal ? goalBox : null };
};

function kick() {
  if (rafId || inFrame || !shown()) return; // inside a frame the frame itself decides whether to go on
  stats.last = 0; // no time jump after a stop
  rafId = requestAnimationFrame(animate);
}

function animate(now) {
  rafId = 0;
  inFrame = true;
  const t0 = performance.now();
  const alpha = Math.min(1, (t0 - arrived) / span);
  applyPoses(alpha);
  applySkin(alpha);
  const goalAlpha = ghostFade(t0);
  const moved = followStep(stats.last ? Math.min(0.25, (now - stats.last) / 1000) : 0);
  // OrbitControls.update() also reports a "change" when lookAt flips the camera quaternion's sign (q vs -q, the same
  // rotation) under floating-point noise near a branch of its matrix-to-quaternion conversion; at some camera poses that
  // happens every frame, so its result counts only while the viewer orbits or zooms and for ORBIT_DAMPING_MS after
  // (the damping decays to about 1 % by then)
  const damping = controls.update() && (orbiting || now - orbitEnd < ORBIT_DAMPING_MS);
  const t1 = performance.now();
  renderer.clear();
  camera.layers.set(GHOST); // goal ghost first: the real frame is drawn over it
  renderer.render(scene, camera);
  renderer.clearDepth();
  camera.layers.set(0);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  const t2 = performance.now();
  drawAxes(alpha, goalAlpha);
  const t3 = performance.now();
  stats.n += 1;
  stats.span = span;
  if (stats.last) stats.interval = mean(stats.interval, now - stats.last, stats.n);
  stats.last = now;
  stats.update = mean(stats.update, t1 - t0, stats.n);
  stats.render = mean(stats.render, t2 - t1, stats.n);
  stats.overlay = mean(stats.overlay, t3 - t2, stats.n);
  if (posed && !toldReady) { // the first drawn frame of the scene: the embedding page may now show this frame
    toldReady = true;
    tellPage('dexgo-demo-ready');
  }
  inFrame = false;
  const why = { playing: !!lastInfo?.playing, interpolation: alpha < 1, ghost: goalAlpha < 1, camera: moved > 0,
    controls: damping };
  for (const k in why) if (why[k]) stats.why[k] += 1;
  const busy = Object.values(why).some(Boolean);
  if (busy && shown()) rafId = requestAnimationFrame(animate);
}
const ORBIT_DAMPING_MS = 1500;
let orbiting = false, orbitEnd = -Infinity; // the viewer's orbit / zoom (OrbitControls start / end)
controls.addEventListener('change', kick);
controls.addEventListener('start', () => { orbiting = true; kick(); });
controls.addEventListener('end', () => { orbiting = false; orbitEnd = performance.now(); kick(); });
resize();
kick();
