// Viewer page of the DexGO demo. Two scenes:
// - chain (default): the long-horizon mode. Goal after goal on one object (assets/objects/index.json): "Random
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
//   build, which then requests nothing from mano_local/): the colliders are the hand, in a skin tone matched to the
//   textured skin's rendered mean, the skin's roughness and specular, creased normals (smooth sides, sharp rims).
// - Light: the renders' three studio softboxes as directional lights (one casts soft shadows), a RoomEnvironment
//   PMREM environment, ACES filmic tone mapping.
// - Goal ghost: goal object (paper green) and goal hand (grey: wrist goal H*, finger target q_B*), each 40 % opaque,
//   drawn in a first pass UNDER the real frame (the videos' target layer composited under the frame), so they never
//   hide the real hand or object. A new goal fades in over 0.28 s. The worker sends the poses of every geom at the
//   goal state (forward kinematics on a second MjData). The goal hand is the MANO skin at the goal (a 2 mm inflated
//   shell) with the skin, else its 16 colliders at those poses (the public build).
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
import { TaskGraph, taskWords } from './graph.js';

const params = new URLSearchParams(location.search);
const SCENE = params.get('scene') === 'marker' ? 'marker' : 'chain';
const MODEL = params.get('model') ?? 'm_marker'; // marker scene
const SEED = params.has('seed') ? Number(params.get('seed')) : null; // chain scene: reproducible runs
// The worker owns the playback speed (twice real time) and reports it with the model; interpolation follows its wall
// period, while the camera smoothing, ghost fade, restart fade and notes keep wall time.
const SLOW_STEP = Number(params.get('slowstep')) || 0; // test only: extra busy ms per control step in the worker
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('play'), reset: $('reset'), view: $('view'), axes: $('axes'), loading: $('loading'),
  colliders: $('colliders'), collidersToggle: $('colliders-toggle'), objects: $('objects'),
  modes: [...document.querySelectorAll('[data-mode]')], code: $('task-code'), words: $('task-words'),
  goals: $('goals'), note: $('note'), graph: $('graph'), marker: $('marker-status'),
};
document.body.dataset.scene = SCENE;
const LOCAL = new URL('../assets/mano_local/', import.meta.url).href;
const ASSETS = new URL('../assets/', import.meta.url).href;

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
  // everyday_L.py GOAL: --ghost-color 0.2711,0.5024,0.4737 --ghost-opacity 0.4 --hand-color 0.36,0.385,0.375
  // --hand-opacity 0.4 --hand-inflate 0.002 (linear RGB; roughness 0.5, overlay.GHOST)
  ghostObject: linear(0.2711, 0.5024, 0.4737),
  ghostHand: linear(0.36, 0.385, 0.375),
  ghostOpacity: 0.4,
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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK.toneExposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // Vogel-disk PCF, soft with shadow.radius
renderer.shadowMap.autoUpdate = false; // updated once per frame, in the main pass
renderer.autoClear = false;
ui.view.insertBefore(renderer.domElement, ui.axes);
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
renderer.domElement.style.touchAction = 'pan-y'; // OrbitControls sets 'none'
const zoomHint = $('zoom-hint');
if (/Mac|iPhone|iPad/.test(navigator.platform)) zoomHint.textContent = '\u2318 + scroll to zoom';
let hintTimer = 0;
ui.view.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) return; // OrbitControls zooms (and prevents the page from scrolling)
  e.stopPropagation(); // never reaches OrbitControls: the page scrolls
  zoomHint.classList.add('is-shown');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => zoomHint.classList.remove('is-shown'), 1400);
}, { capture: true, passive: true });
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
  // the Play / Reset overlay at the top of the view (stacked layout): the follow camera keeps the span below it
  const actions = ui.play.parentElement.getBoundingClientRect(), view = ui.view.getBoundingClientRect();
  follow.reserve = actions.bottom > view.top && actions.top < view.bottom ? Math.ceil(actions.bottom - view.top) + 6 : 0;
  renderer.setSize(w, h, false);
  axes.resize(w, h, renderer.getPixelRatio());
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  if (w !== follow.size?.[0] || h !== follow.size?.[1]) follow.frozen = false; // re-fit at a new size
  follow.size = [w, h];
  kick(); // redraw at the new size (the loop may be stopped)
}
new ResizeObserver(resize).observe(ui.view);

/** three.js geometry of one MuJoCo geom (mjtGeom: 0 plane, 2 sphere, 3 capsule, 4 ellipsoid, 5 cylinder, 6 box, 7 mesh). */
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
      return toCreasedNormals(geo, g.isObject ? Math.PI / 6 : Math.PI / 4); // smooth sides, sharp rims
    }
    default: return null;
  }
}

let meshes = [], ghosts = [], handGhosts = [], policyDt = 0.05, nStarts = 1, start = 0;
let prevPoses = null, nextPoses = null, arrived = 0, lastInfo = null, lastChain = null;
// wall ms per control step (the worker's policy_dt / speed); span: the interpolation time, that step or, while frames
// arrive later than it (a device slower than twice real time), their smoothed arrival interval
let stepMs = 25, span = 25;
let prevHand = null, nextHand = null; // wrist position (3), rotation (9, row-major), finger angles (20)
let prevObject = null, nextObject = null; // object body position (3), rotation (9, row-major)
let goal = null, axisLength = 0.08; // goal from the worker (objectP/R, wristP/R, finger); axis length (m)
let ghostShown = 0; // performance.now() when the current goal appeared (its fade-in)
let posed = false; // the current model's meshes have received a pose (hidden until then)
const handMeshes = []; // the hand's collider meshes: [mesh, its opaque material]
const objectMeshes = []; // the object's meshes (their geometry bounding boxes frame the follow camera)

/** Remove the previous model's meshes (object switch: the worker loads another model). */
function clearScene() {
  const all = [...meshes, ...ghosts, ...handGhosts].filter(Boolean);
  for (const mesh of all) {
    scene.remove(mesh);
    if (mesh.material !== colliderOverlay && mesh.material !== handGhostMaterial) mesh.material.dispose(); // not shared
  }
  for (const g of new Set(all.map((m) => m.geometry))) g.dispose();
  for (const [, opaque] of handMeshes) opaque.dispose();
  meshes = [];
  ghosts = [];
  handGhosts = [];
  goal = null; // the new model's first frame brings its goal
  handMeshes.length = 0;
  objectMeshes.length = 0;
  prevPoses = nextPoses = prevHand = nextHand = prevObject = nextObject = null;
  posed = false;
}

function buildScene(geoms) {
  clearScene();
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
    scene.add(mesh);
    meshes.push(mesh);
    if (!g.isObject) handMeshes.push([mesh, mesh.material]);
    if (g.isObject) {
      geo.computeBoundingBox();
      objectMeshes.push(mesh);
    }
    // its goal ghost (the object's, or one part of the collider goal hand), placed by the worker's ghost poses
    const ghost = new THREE.Mesh(geo, g.isObject ? ghostMaterial(LOOK.ghostObject) : handGhostMaterial);
    ghost.matrixAutoUpdate = false;
    ghost.layers.set(GHOST);
    ghost.visible = false;
    ghost.userData.geom = id;
    scene.add(ghost);
    (g.isObject ? ghosts : handGhosts).push(ghost);
  }
  styleColliders();
}

/** The skin's material (flat colour until an albedo map is set): roughness, specular and sheen of the renders. */
function skinLikeMaterial(m = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: LOOK.skinFlat, roughness: m.roughness ?? 0.6, metalness: 0.0,
    specularIntensity: (m.specular ?? 0.08) / 0.5, // Blender Principled specular 0.5 = F0 0.04 = three.js 1.0
    sheen: 0.25, sheenRoughness: 0.8, sheenColor: 0xffe2cc, // a soft grazing rim (cheap stand-in for scattering)
  });
}

/** The colliders as the hand (no skin): the skin's roughness and specular, no sheen (it whitens the coarse hulls). */
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
// the collider goal hand (no skin): one grey ghost material shared by its 16 parts (kept across object switches)
const handGhostMaterial = ghostMaterial(LOOK.ghostHand);

// --------------------------------------------------------------------------------------------- MANO skin
// depth-tested against the skin and pushed slightly back: blue where a collider lies outside the skin
const colliderOverlay = new THREE.MeshStandardMaterial({
  color: 0x2f6fdf, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.6, flatShading: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
let skin = null, skinMesh = null, skinSurface = null, skinKey = null, ghostHand = null, ghostSurface = null;

/** Without the skin the colliders are the hand (opaque); with it they are an optional translucent overlay. The goal
 *  ghosts show while a goal is installed; the collider goal hand only without the skin (which has its own). */
function styleColliders() {
  for (const [mesh, opaque] of handMeshes) {
    mesh.visible = (!skinMesh || ui.colliders.checked) && posed;
    mesh.material = skinMesh ? colliderOverlay : opaque;
    mesh.renderOrder = skinMesh ? 2 : 0;
    mesh.castShadow = mesh.receiveShadow = !skinMesh;
  }
  for (const ghost of ghosts) ghost.visible = !!goal;
  for (const ghost of handGhosts) ghost.visible = !!goal && !skinMesh;
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
  if (!goal) { ghostHand.visible = false; return; }
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
  if (!skinMesh || !nextHand) return;
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
}

// --------------------------------------------------------------------------------------------- camera
// Marker scene: aim between hand and object, halfway from the start to the goal; back off for a wide start-goal gap
// or a portrait view. Chain scene: fixed per object (load, Reset), aimed at the start grasp with the measured motion
// (CHAIN_VIEW) in view; a fresh start after a failure keeps the camera (the start grasps share the home pose).
function snapCamera(target, distance, direction = CAMERA_DIRECTION) {
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
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
// follow camera keeps. A viewer zoom (Ctrl / Cmd + wheel, pinch) suspends the automatic zoom: the distance stays where
// the viewer left it, the target keeps following, until Reset or an object switch. Clipping of this filter, replayed on
// Node chains: README "Viewer".
const FOLLOW = { tau: 0.8, margin: 0.03, scale: [1400, 3200], extent: 0.279 }; // s, m, px/m, m
const CAMERA_MODE = params.get('camera');
const follow = { target: new THREE.Vector3(), distance: 1, manual: 0, applied: 0, snap: true, reserve: 0,
  anchor: new THREE.Vector3(), anchorDistance: 0, reaim: true };
// Bounded follow (owner feedback, relocation must show): the camera aims once per goal (anchor = the span's centre and
// fit when the goal appears), then holds; within the goal it moves only by the amount the span (hand, object, goal
// ghost, plus the margin) would leave FOLLOW.dead of the half view, and zooms out but never in. Replayed on the Node
// chains this shows 2.5 times more on-screen travel of the object over relocation goals than following the span's
// centre (median 76 vs 31 px at 1080 x 640, 48 vs 19 px at 390 x 844), with less clipping (README "Viewer").
FOLLOW.dead = 0.9;
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
  for (const [mesh] of handMeshes) add(p.setFromMatrixPosition(mesh.matrix));
  for (const mesh of objectMeshes) corners(mesh, mesh.matrix);
  if (goal) { // the goal ghost: object box and the goal hand's collider centres (drawn as the skin or the colliders)
    for (const ghost of ghosts) corners(ghost, ghost.matrix);
    for (const ghost of handGhosts) add(p.setFromMatrixPosition(ghost.matrix));
  }
  mean.multiplyScalar(1 / n);
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const W = ui.view.clientWidth, H = Math.max(1, ui.view.clientHeight), usable = H - follow.reserve;
  const fit = Math.max(((y1 - y0) / 2 + FOLLOW.margin) / (t * usable / H),
    ((x1 - x0) / 2 + FOLLOW.margin) / (t * camera.aspect));
  const near = H / (2 * t * FOLLOW.scale[1]);
  const far = Math.max(H / (2 * t * FOLLOW.scale[0]), (FOLLOW.extent * H) / (2 * t * Math.min(W, usable)));
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
  const residual = fw.raw.distanceTo(follow.target) * scale0
    + (follow.manual ? 0 : (Math.abs(raw - follow.distance) / Math.max(raw, 1e-6)) * ui.view.clientHeight / 2);
  // Paused (or ended): finish the easing quickly so the frame loop stops: time constant FOLLOW.pauseTau, and a snap
  // to the aim FOLLOW.pauseCap s after the pause at the latest (left: about exp(-cap / pauseTau) = 2 % of the lag)
  const tau = paused ? FOLLOW.pauseTau : FOLLOW.tau;
  const k = follow.snap || residual < 1 || (paused && pausedFor > FOLLOW.pauseCap) ? 1 : 1 - Math.exp(-dt / tau);
  if (paused && k === 1) follow.frozen = true;
  follow.snap = false;
  follow.target.lerp(fw.raw, k);
  follow.distance += (raw - follow.distance) * k;
  const direction = fw.p.subVectors(camera.position, controls.target).normalize();
  controls.target.copy(follow.target);
  follow.applied = follow.manual || follow.distance;
  camera.position.copy(follow.target).addScaledVector(direction, follow.applied);
  aimStudio(follow.target);
  const height = 2 * follow.applied * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  axisLength = Math.min(LOOK.axisFraction * Math.max(height, height * camera.aspect), LOOK.axisMax);
  document.body.dataset.scale = String(Math.round(ui.view.clientHeight / height)); // px per metre at the target
  return k === 1 ? 0 : residual;
}

// --------------------------------------------------------------------------------------------- world reference
// A very light floor grid, fixed in the world 16 cm below the start wrist (5 cm cells, 1 px lines at most 22 %
// dark, fading out radially within 0.5 m), so a relocation reads against it while the camera follows. (A trail of the object
// centre was tried and dropped: over composite goals the centre loops and the trail read as a scribble.) Drawn first, in the ghost pass, so the ghost,
// the hand and the object all draw over it. Placed at load and Reset (the start grasps share the home pose).
const floor = (() => { // 1 px lines (a textured plane was 10 x slower under software rendering)
  const half = 0.6, cell = 0.05, piece = 0.025, n = Math.round((2 * half) / cell);
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
  floor.visible = true;
}

// --------------------------------------------------------------------------------------------- goal, axes
/** Install a goal (or none) with the worker's ghost poses (12 per geom at the goal state): goal object, goal hand
 *  (skin, or its colliders), fade-in. */
function setGoal(newGoal, poses) {
  goal = newGoal;
  follow.reaim = true;
  if (goal) for (const ghost of [...ghosts, ...handGhosts]) matrixOf(poses, ghost.userData.geom, ghost.matrix);
  styleColliders();
  skinGoal();
  ghostShown = performance.now();
}

function ghostFade(now) {
  const f = Math.min(1, (now - ghostShown) / LOOK.ghostFadeMs);
  for (const ghost of ghosts) ghost.material.opacity = LOOK.ghostOpacity * f;
  handGhostMaterial.opacity = LOOK.ghostOpacity * f;
  if (ghostHand) ghostHand.material.opacity = LOOK.ghostOpacity * f;
  return f;
}

// window.viewerGhost() (tests): which goal hand is drawn ('skin' | 'colliders' | 'none'), its opacity, and the mean /
// max distance (mm) between the goal hand's collider centres and the hand's in the latest frame (small at a latch)
window.viewerGhost = () => {
  const drawn = !goal ? 'none' : ghostHand?.visible ? 'skin' : handGhosts.some((g) => g.visible) ? 'colliders' : 'none';
  let sum = 0, max = 0;
  for (const ghost of handGhosts) {
    const o = 12 * ghost.userData.geom, e = ghost.matrix.elements;
    const d = nextPoses ? Math.hypot(e[12] - nextPoses[o], e[13] - nextPoses[o + 1], e[14] - nextPoses[o + 2]) : NaN;
    sum += d;
    max = Math.max(max, d);
  }
  return { hand: drawn, parts: handGhosts.filter((g) => g.visible).length, opacity: handGhostMaterial.opacity,
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
const NOTES = { // wording of the project page's copy review (review_copy_r2.md, row 6)
  drop: 'The object was dropped: starting from a new initial grasp.',
  timeout: 'Goal not reached: starting from a new initial grasp.',
  recover: 'Goal not reached: continuing from the current grasp.',
  'no node available': 'No task is available from this grasp: starting from a new initial grasp.',
  restart: 'Starting from a new initial grasp.',
};
const FAILED = 'The demo could not start in this browser.'; // details go to the console
let note = { text: '', flash: false, until: 0 }, noteTimer = 0;
// the stacked layout of index.html (tall or narrow viewports) uses the compact graph
const STACKED = matchMedia('(max-width: 819px), (max-aspect-ratio: 1/1)');
const graph = SCENE === 'chain' ? new TaskGraph(ui.graph, { onSelect: queueTask, compact: STACKED.matches }) : null;
STACKED.addEventListener('change', () => {
  graph?.setCompact(STACKED.matches);
  follow.snap = true;
  resize();
});

/** Write a text only when it changes (the status is a live region; frames arrive at 20 Hz). */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function flashNote(text, ms = 2600) {
  note = { text, flash: true, until: performance.now() + ms };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { // the note expires (a timer: the frame loop may be stopped)
    note.until = 0;
    if (lastChain) showChain(lastChain);
  }, ms);
}

function showChain(c) {
  lastChain = c;
  const manual = c.mode === 'manual';
  const active = c.node && (c.phase === 'reach' || c.phase === 'dwell');
  if (c.phase === 'ended') {
    setText(ui.code, '');
    setText(ui.words, 'Chain ended. Press Reset to start again.');
  } else if (active) {
    setText(ui.code, c.node);
    setText(ui.words, taskWords(c.node) + (c.phase === 'dwell' ? ' ✓' : ''));
  } else {
    setText(ui.code, '');
    setText(ui.words, manual ? 'Select the next task on the graph.' : '');
  }
  setText(ui.goals, `${c.goalsDone} goal${c.goalsDone === 1 ? '' : 's'} completed`);
  const now = performance.now();
  if (note.until > now) {
    setText(ui.note, note.text);
  } else {
    setText(ui.note, manual && c.queued ? `Next: ${c.queued}, ${taskWords(c.queued)}` : '');
  }
  ui.note.classList.toggle('is-flash', note.until > now && note.flash);
  graph.set({ current: active ? c.node : null, available: c.available ?? [], queued: c.queued ?? null,
    selectable: manual && c.phase !== 'ended' });
  for (const b of ui.modes) b.setAttribute('aria-pressed', String(b.dataset.mode === c.mode));
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
function showInfo(info) {
  if (lastInfo?.playing && !info.playing) pausedAt = performance.now();
  lastInfo = info;
  ui.play.textContent = info.playing || (wantPlay && autoPaused) ? 'Pause demo' : 'Play demo';
  ui.play.disabled = !!info.end;
  if (SCENE === 'marker') showMarker(info);
  Object.assign(document.body.dataset, { state: info.playing ? 'playing' : 'idle', step: String(info.step),
    simtime: info.simTime.toFixed(2) });
}

// --------------------------------------------------------------------------------------------- worker
const worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
let wantPlay = SCENE === 'chain'; // the chain starts by itself; the marker scene waits for Play
let autoPaused = false, inSight = true, ready = false;
const counts = { restarts: 0, drops: 0, timeouts: 0 };

/** Whether the view can be seen: the document is visible and the view intersects the (top-level) viewport. */
function shown() {
  return inSight && document.visibilityState === 'visible';
}

/** Run the worker iff the viewer wants it and the view is visible (pauses off-screen and in background tabs); the
 *  frame loop follows (kick). */
function syncPlay() {
  kick();
  if (!ready) return;
  const run = wantPlay && shown();
  autoPaused = wantPlay && !shown();
  if (run !== !!lastInfo?.playing) worker.postMessage({ type: run ? 'play' : 'pause' });
}
document.addEventListener('visibilitychange', syncPlay);
new IntersectionObserver((entries) => {
  inSight = entries[entries.length - 1].isIntersecting;
  syncPlay();
}).observe(ui.view);

let fadeOut = null;
/** Object switch: dim the view until the new model's first frame fades in. */
function dimView() {
  fadeOut?.cancel();
  fadeOut = ui.view.animate([{ opacity: 1 }, { opacity: 0.2 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
}
function fadeIn() {
  fadeOut?.cancel();
  fadeOut = null;
  ui.view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
}

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
  const events = msg.events ?? [];
  for (const e of events) { // a failure and its fresh start come in the same frame (cut 'restart')
    if (e.type === 'drop' || e.type === 'timeout') counts[`${e.type}s`] += 1;
    if (e.type === 'recover') flashNote(NOTES.recover);
    if (e.type === 'restart') {
      counts.restarts += 1;
      flashNote(NOTES[e.reason] ?? NOTES.restart);
    }
  }
  if (msg.cut) { // 'init' | 'load' (object switch) | 'reset' (Reset) | 'restart' (fresh start after a failure)
    const handP = msg.hand.subarray(0, 3), objP = msg.object.subarray(0, 3);
    if (SCENE === 'marker') frameMarker(objP, goal.objectP, handP);
    else if (msg.cut !== 'restart') frameChain(objP, handP); // the fixed camera (also the follow camera's direction)
    follow.snap = true; // the follow camera jumps to the new state, it never pans across a cut
    follow.reaim = true;
    if (msg.cut !== 'restart' && SCENE === 'chain') placeFloor(objP, handP);
    if (msg.cut !== 'restart') follow.manual = 0; // load, Reset, an object switch: automatic zoom again
    if (msg.cut !== 'init') fadeIn();
    ui.loading.hidden = true;
  }
  if (msg.chain) showChain(msg.chain);
  showInfo(msg.info);
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
    buildScene(msg.geoms);
    if (msg.object) {
      current = msg.object;
      document.body.dataset.object = slugOf.get(msg.object) ?? '';
      for (const b of ui.objects.querySelectorAll('[data-object]')) {
        b.setAttribute('aria-pressed', String(b.dataset.object === document.body.dataset.object));
        b.disabled = false;
      }
    }
  } else if (msg.type === 'frame') {
    onFrame(msg);
    if (!ready) {
      ready = true;
      ui.play.disabled = ui.reset.disabled = false;
      syncPlay();
    }
  } else if (msg.type === 'chain') {
    showChain(msg.chain);
  } else if (msg.type === 'error') {
    ui.loading.hidden = false;
    ui.loading.textContent = FAILED;
    console.error(msg.message);
  }
};
worker.onerror = (e) => {
  ui.loading.hidden = false;
  ui.loading.textContent = FAILED;
  console.error(`worker: ${e.message}`);
};

// --------------------------------------------------------------------------------------------- controls
ui.play.onclick = () => {
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
    worker.postMessage({ type: 'reset' });
  }
};
for (const b of ui.modes) {
  b.onclick = () => {
    if (b.getAttribute('aria-pressed') === 'true') return;
    for (const o of ui.modes) o.setAttribute('aria-pressed', String(o === b));
    worker.postMessage({ type: 'mode', mode: b.dataset.mode });
  };
}

/** Manual mode: queue an available task as the next goal (a click also starts the simulation). */
function queueTask(node) {
  worker.postMessage({ type: 'queue', node });
  if (lastChain) showChain({ ...lastChain, queued: node });
  wantPlay = true;
  syncPlay();
}

function selectObject(id) {
  if (current === id) return;
  for (const b of ui.objects.querySelectorAll('[data-object]')) {
    b.setAttribute('aria-pressed', String(b.dataset.object === slugOf.get(id)));
    b.disabled = true; // until the model is loaded
  }
  counts.restarts = counts.drops = counts.timeouts = 0;
  note.until = 0;
  dimView(); // the new model's first frame fades in
  worker.postMessage({ type: 'object', object: id });
}

/** Object list (assets/objects/index.json): [{id, label}] or {objects: [...]}; ?object=<id or slug> picks the first.
 *  The page shows the labels; DOM attributes carry slugs of the labels ("round", "hexagonal"), never the ids. */
let current = null; // id of the loaded object
const slugOf = new Map(); // object id -> slug of its label
async function objectList() {
  const index = await fetchLoader(ASSETS).json('objects/index.json');
  const list = (Array.isArray(index) ? index : index.objects).map((o) => (typeof o === 'string' ? { id: o } : o));
  for (const o of list) {
    const label = o.label ?? o.name ?? o.id;
    slugOf.set(o.id, label.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle';
    b.dataset.object = slugOf.get(o.id);
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    b.disabled = true;
    b.onclick = () => selectObject(o.id);
    ui.objects.appendChild(b);
  }
  const wanted = params.get('object');
  return (list.find((o) => o.id === wanted || slugOf.get(o.id) === wanted) ?? list[0]).id;
}

if (SCENE === 'marker') {
  worker.postMessage({ type: 'init', scene: 'marker', model: MODEL });
} else {
  objectList().then((object) => {
    worker.postMessage({ type: 'init', scene: 'chain', object, mode: 'random', seed: SEED, slowStep: SLOW_STEP });
  }).catch((err) => {
    ui.loading.textContent = FAILED;
    console.error('object list', err);
  });
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
let rafId = 0, inFrame = false;

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
