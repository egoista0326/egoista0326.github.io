// Data for the DexGO project page (/dexgo/).
// Strings that start with "TODO" are placeholders and are not rendered (BibTeX); links with an empty `href` are
// shown as muted "soon" chips when `soon` is set (Paper, Code) and left out otherwise.
// Every clip's frame size is read from its file at build time, so a missing file fails the build.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LinkChip } from '../components/LinkChips.astro';

/** One video clip. Files live in public/assets/dexgo/clips/ (H.264 on white, no audio). */
export interface Clip {
  /** Video path under public/. */
  src: string;
  /** Poster image path under public/. */
  poster: string;
  /** Intrinsic frame size in pixels, used for width/height and the aspect ratio. */
  width: number;
  height: number;
  /** Accessible name of the clip (not shown). */
  label: string;
  /** Poster used instead under reduced motion (nothing plays there), e.g. an animation's end frame. */
  stillPoster?: string;
}

const clipDir = '/assets/dexgo/clips';

/** Path of public/assets/dexgo/clips/<file> on disk (build time). */
const clipFile = (file: string): string => join(process.cwd(), 'public', clipDir, file);

/** True if public/assets/dexgo/clips/<file> exists at build time (a hand shows only the objects it has clips for). */
const existsInClips = (file: string): boolean => existsSync(clipFile(file));

/**
 * Frame size [w, h] in pixels of the MP4 file at `path`, read at build time from its video track header (the last
 * 8 bytes of the 'tkhd' box are width and height in 16.16 fixed point; audio tracks store 0).
 */
const mp4FrameSize = (path: string): [number, number] => {
  const buf = readFileSync(path);
  for (let i = buf.indexOf('tkhd'); i >= 4; i = buf.indexOf('tkhd', i + 4)) {
    const size = buf.readUInt32BE(i - 4);
    if (size !== 92 && size !== 104) continue; // version 0 or 1 header; anything else is not a box
    const end = i - 4 + size;
    const w = buf.readUInt32BE(end - 8) / 65536;
    const h = buf.readUInt32BE(end - 4) / 65536;
    if (w > 0 && h > 0) return [Math.round(w), Math.round(h)];
  }
  throw new Error(`No video frame size in ${path}`);
};

/** Frame size of clips/<name>.mp4, for cuts whose size is not fixed in advance (content crops). */
const frameSize = (name: string): [number, number] => mp4FrameSize(clipFile(`${name}.mp4`));

/** Clip clips/<name>.mp4 at its own frame size, with its first-frame poster <name>.jpg. */
const clip = (name: string, label: string): Clip => {
  const [width, height] = frameSize(name);
  return { src: `${clipDir}/${name}.mp4`, poster: `${clipDir}/${name}.jpg`, width, height, label };
};

/**
 * The 20 unseen everyday objects of the paper in the order of its object figure: the ten tools, then the ten
 * household items; [file slug, name]. Clip files are unseen_mano_<slug>.mp4 and unseen_sharpa_<slug>.mp4
 * (960x720, one common hand scale); a hand shows only the objects it has clips for.
 */
const everydayObjects: [string, string][] = [
  ['short_screwdriver', 'Short screwdriver'],
  ['long_screwdriver', 'Long screwdriver'],
  ['mallet', 'Mallet'],
  ['hammer', 'Hammer'],
  ['spatula', 'Spatula'],
  ['spoon', 'Spoon'],
  ['marker', 'Marker'],
  ['pipe_wrench', 'Pipe wrench'],
  ['wrench', 'Wrench'],
  ['ratchet', 'Ratchet'],
  ['flashlight', 'Flashlight'],
  ['cucumber', 'Cucumber'],
  ['spice_jar', 'Spice jar'],
  ['carrot', 'Carrot'],
  ['bottle', 'Bottle'],
  ['cream_tube', 'Cream tube'],
  ['water_bottle', 'Water bottle'],
  ['spray_can', 'Spray can'],
  ['banana', 'Banana'],
  ['corn', 'Corn']
];

/** One carousel item: a clip and the object's name shown under it. */
export interface ObjectItem extends Clip {
  name: string;
}

/** Carousel items of one hand, in list order: the objects it has an unseen_<hand>_<slug> clip for. */
const objectItems = (hand: 'mano' | 'sharpa', handName: string): ObjectItem[] =>
  everydayObjects
    .filter(([slug]) => existsInClips(`unseen_${hand}_${slug}.mp4`))
    .map(([slug, name]) => ({ ...clip(`unseen_${hand}_${slug}`, `${name}, ${handName} hand`), name }));

/**
 * Where the hand and the object sit in a size clip, in source px, measured once over all frames of the file
 * (pixels darker than 240 on the white frame): `handY` the hand's centre height (median over the clip), `top` the
 * highest point drawn in any frame, `left`/`right` the horizontal extent the row gives the clip, `bottom` the
 * lowest point of the object at rest (median over the clip). The row's outer edges (thin `left`, long `right`) are
 * the full extent of every frame, so nothing passes the column; the thin clip's inner edge leaves out a brief swing
 * into the gap (to 283), and the thick clip's `left` a swing to source x 25 (45 of its 229 frames), so on phones
 * a frame may overlap its neighbour's object; the frames multiply (global.css, .dx-size-stage), so both stay visible.
 */
export interface SizePlace {
  handY: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * Size clip size_<name>_hand.mp4 at its own frame size. The three files are rendered with the hand at one
 * size (about 93 source px), so showing them at one common scale (screen px per source px) keeps the hands
 * equal while the frames, and the objects in them, differ in size.
 */
const sizeClip = (name: string, label: string, place: SizePlace): Clip & SizePlace => ({
  ...clip(`size_${name}_hand`, label),
  ...place
});

/** Short capability words for combination tasks, as on the video's ticker; single tasks use the full names of the
    method intro (`capabilityNames`). */
const capabilityWords: Record<string, string> = {
  R: 'reorientation',
  T: 'translation',
  G: 'grasp type change',
  L: 'relocation'
};

/** Full capability names, as in the method intro, under the graph's nodes and in the live demo. */
const capabilityNames: Record<string, string> = {
  R: 'in-hand reorientation',
  T: 'in-hand translation',
  G: 'grasp type change',
  L: 'object relocation'
};

/** One node of the prerequisite graph. */
export interface GraphTask {
  /** Capability letters, e.g. 'RTL'. */
  id: string;
  /** Capability words shown under the player and read by screen readers: the full name for a single task (e.g.
      'in-hand translation'), the short words for a combination (e.g. 'reorientation, translation and relocation'). */
  spoken: string;
  /** The unlock rule shown under the player. */
  rule: string;
  /** Node rectangle in pixels of the 1100x806 unlock animation (its final frame). */
  rect: [x: number, y: number, w: number, h: number];
  /** Tasks with one capability fewer (empty for single capabilities). */
  prerequisites: string[];
  /** Row of the graph (0 = top). */
  row: number;
  clip: Clip;
}

const joinNames = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const task = (id: string, rect: GraphTask['rect']): GraphTask => {
  const letters = [...id];
  // Drop the last letter first, so the list reads as in the video (RT, RL and TL for RTL).
  const prerequisites = letters.map((_, i) => letters.filter((__, j) => j !== letters.length - 1 - i).join(''));
  return {
    id,
    spoken:
      id.length === 4
        ? 'all four capabilities'
        : id.length === 1
          ? capabilityNames[id]
          : joinNames(letters.map((l) => capabilityWords[l])),
    rule:
      id.length === 1
        ? 'Trained from the start.'
        : `Unlocked once ${joinNames(prerequisites)} ${prerequisites.length > 1 ? 'are' : 'is'} learned.`,
    prerequisites: id.length === 1 ? [] : prerequisites,
    rect,
    row: 4 - id.length,
    clip: clip(`node_${id}_common`, `Example of task ${id}`)
  };
};

export const dexgoPage = {
  title: 'DexGO',
  subtitle: 'Dexterous Grasp Transition with Object Relocation',
  metaDescription:
    'DexGO trains one reinforcement learning policy that changes how a hand holds an object while moving the object to a desired world pose.',
  /** Share image (og:image, 1200x630): a teaser frame at 6.8 s, the screwdriver held in a pinch on the screw. */
  share: {
    src: '/assets/dexgo/share.jpg',
    width: 1200,
    height: 630,
    alt: 'A simulated hand holds a screwdriver with its fingertips, its tip on a screw in a wooden board.'
  },
  /** In paper order; `equal` marks the co-first authors (equal contribution). */
  authors: [
    { name: 'Jiaxin Li', href: 'https://egoista0326.github.io/', equal: true },
    { name: 'Hui Zhang', href: 'https://zdchan.github.io/', equal: true },
    // ETH profile pages (no personal sites); the path is case-sensitive ("Mark.html").
    { name: 'Mark Zander', href: 'https://pdz.ethz.ch/the-group/people/Mark.html', equal: false },
    { name: 'Mirko Meboldt', href: 'https://pdz.ethz.ch/the-group/people/meboldt.html', equal: false }
  ],
  affiliation: 'ETH Zurich',
  equalNote: 'Equal contribution',
  // Link pills of the title block (LinkChips.astro), after the filled "Interactive demo" pill (dexgo.astro). A link
  // with an empty `href` is shown muted and marked "soon" when `soon` is set (Paper, Code: owner).
  links: [
    { label: 'Paper', icon: 'paper', href: '', soon: true },
    { label: 'Code', icon: 'code', href: '', soon: true }
  ] as (LinkChip & { soon: boolean })[],
  /** The title block's first pill: jumps to the Live demo part and puts focus on its start button. */
  demoLink: { label: 'Interactive demo', href: '#live-demo' },
  /** The hero (owner 2026-11-23: the teaser, not the full project video): the video's opening teaser, 2:1 (table
      and the whole hand path), and below 640 px its 4:3 phone cut framed on the hand's path; true BT.709 files of
      the talk's web/clips (re-encoded 2026-11-22 after the BT.601 mistag), each with its first-frame poster. The
      posters are WebP (quality 80, the wide one at 1600x800, twice its 800 px display width; about 23-25 KB) of the
      same frames as the JPEGs, so the first screen's largest image arrives early on slow networks. */
  teaser: {
    ...clip('teaser_1080p_crop', 'A hand changes its grasp on a screwdriver to drive a screw, then changes it again to place the screwdriver in its holder.'),
    poster: `${clipDir}/teaser_1080p_crop.webp`
  },
  teaserPhone: {
    ...clip('teaser_phone', 'A hand changes its grasp on a screwdriver to drive a screw, then changes it again to place the screwdriver in its holder.'),
    poster: `${clipDir}/teaser_phone.webp`
  },
  abstract:
    'Different tasks require an object to be held in different ways. Humans therefore often adjust their grasp while moving an object into place. Motivated by this, we study \\emph{grasp transition with object relocation}: given a target grasp and a desired object world pose, the hand must transition from its initial grasp to the target grasp while relocating the object to the specified pose. This problem is challenging because the goals specify only the final state without intermediate guidance, and their complexity varies widely, from minor in-hand adjustments to grasp type changes coupled with long-distance relocations. In this work, we present DexGO, a reinforcement learning framework that trains a single policy through progressive task composition. Specifically, we introduce a prerequisite graph that organizes four basic capabilities and their increasingly complex combinations, allowing simpler tasks to provide intermediate guidance for learning more complex ones. We further introduce a task-wise annealed kernel reward and a nonlinear encoding of spatial observations to facilitate precise reaching across a wide range of goal distances. Experiments demonstrate that a single policy can achieve diverse target grasps and object world poses across a wide range of task complexities, producing precise and controllable motions.',
  /** Problem definition (owner 2026-11-23): what ONE goal is, from the paper's problem statement (Sec. 3.1: the
      desired object world pose, and the target grasp given by the relative object pose and the finger configuration)
      in the talk's wording. No capability letters here (they belong to the Method). The figure is composed from the
      talk's layered renders of one episode (scripts/build_problem_definition.py); `geometry` is its output. */
  problem: {
    id: 'problem',
    eyebrow: 'Problem definition',
    heading: 'A goal specifies a *target grasp* and an object world pose.',
    text: 'Starting from an initial grasp, the policy must reach the target grasp, given by the object pose relative to the hand and the finger configuration, while moving the object to its desired world pose. Only this final goal is given, with no reference trajectory or contact sequence.',
    figure: {
      dir: '/assets/dexgo/problem',
      width: 1600,
      height: 652,
      // State boxes as fractions of the frame (x0, y0, x1, y1), from geometry.json.
      init: [0.0109, 0.112, 0.2557, 0.752],
      goal: [0.549, 0.2373, 0.8787, 0.6933],
      initLabel: 'Initial grasp',
      goalLabel: 'Goal',
      alt: 'A hand holds a hexagonal bar in an enveloping grasp on the left; the goal on the right is the same bar held in a pinch, about 40 cm to the right and turned.',
      hint: 'Select a part to see it on the goal.',
      motionLabel: 'The motion to the goal',
      playLabel: 'Play the motion',
      stopLabel: 'Stop the motion',
      groups: [
        { label: 'Target grasp', parts: ['rel', 'fingers'] },
        { label: 'Desired object pose', parts: ['world'] }
      ],
      parts: [
        {
          key: 'rel',
          label: 'Relative object pose',
          description: 'The object pose relative to the hand: the goal object, the wrist frame and the object frame, linked.'
        },
        {
          key: 'fingers',
          label: 'Finger configuration',
          description: 'The joint configuration of the fingers: the goal hand, outlined.'
        },
        {
          key: 'world',
          label: 'Object world pose',
          description: 'The desired object pose in the world: the goal object, outlined, with its frame.'
        }
      ]
    }
  },
  method: {
    eyebrow: 'Method',
    intro:
      'DexGO trains a single policy with reinforcement learning on tasks that group goals by the capabilities they require: in-hand reorientation (R), in-hand translation (T), grasp type change (G) and object relocation (L).',
    heading: 'Complex motions *combine* basic capabilities.',
    figure: {
      /** Web cut of the paper's figure (method_overview.svg): every label about 11 viewBox units (12 px at the 800 px
          column), the observation boxes and capability chips re-spaced to fit them, the state legend and the
          "current/target" and "grasps" captions dropped. Geometry elsewhere is the paper's, so the regions below are in
          the same units. */
      src: '/assets/dexgo/method_overview_web.svg',
      /** viewBox of the SVG (points of the paper's PDF figure). */
      width: 715.68,
      height: 250.56,
      alt: 'Overview of DexGO: a single policy observes goal errors, local geometry and proprioception and is trained with an annealed kernel reward on tasks and goals sampled from the prerequisite graph; a grasp library supplies initial and target grasps.',
      /** Clickable regions in viewBox units: [x, y, w, h]. */
      // In the order of the subsections they jump to (graph, kernel, encoding), which is the link row's order.
      hotspots: [
        { target: 'prerequisite-graph', label: 'Prerequisite graph', rect: [486.8, 1.5, 226.4, 138] },
        { target: 'annealed-kernel-reward', label: 'Annealed kernel reward', rect: [215, 84, 163, 26] },
        { target: 'observation-encoding', label: 'Nonlinear observation encoding', rect: [112, 17.5, 92, 77] }
      ] as { target: string; label: string; rect: [number, number, number, number] }[],
      /** Accessible name of the figure (the image's alt describes it). */
      label: 'Overview of DexGO',
      /** Link to the figure page, shown below 864 px where the figure is drawn under 800 px (a thumbnail below 720 px):
          src/pages/dexgo/figure.astro. */
      openLabel: 'Open the figure',
      openHref: '/dexgo/figure/',
      /** The figure page (titled `label`): the figure at this width in a horizontally scrolling box, so its labels read
          on a phone. */
      page: {
        width: 1000,
        backLabel: 'Back to DexGO',
        // The Method part (as the nav's "Method"), so its eyebrow lands under the nav with the figure below it.
        backHref: '/dexgo/#method'
      }
    },
    graph: {
      id: 'prerequisite-graph',
      heading: 'Simple tasks *unlock* their combinations.',
      text: 'The prerequisite graph orders the 15 tasks. Training starts with the four single-capability tasks, and a combination task is unlocked once all its subsets with one fewer capability have been learned.',
      // The video's unlock animation cut to its graph (frame x 0-1100 of the 1790 px frame) from 6.6 s, where the
      // graph has settled in its place; poster = first frame, endPoster = last frame (every task learned).
      animation: { ...clip('method_graph', 'Animation of the prerequisite graph: starting from the four single-capability tasks, each task is unlocked once its prerequisites are learned, up to RTGL.'), endPoster: `${clipDir}/method_graph_end.jpg` },
      hint: 'Select a task to watch an example.',
      /** No line under the graph (owner 2026-11-22: the axes legend and the clip-speed sentence were removed). */
      legend: '',
      defaultTask: 'RTGL',
      /** Legend of the three states, covered once every task is learned: [x, y, w, h] in frame pixels. */
      legendRect: [250, 672, 600, 80] as [number, number, number, number],
      /** Phones (below 640 px) and from 864 px, where the video's text would be about 8 px: from `top` (frame pixels)
          down, every frame of the video shows only the capability captions under the base row (y 630-653) and the
          state legend (y 697-727); that band is covered and the same words are set as HTML (UnlockGraph.astro), each
          caption in two lines under its task. */
      phoneText: {
        top: 622,
        captions: {
          R: ['In-hand', 'reorientation'],
          T: ['In-hand', 'translation'],
          G: ['Grasp type', 'change'],
          L: ['Object', 'relocation']
        } as Record<string, [string, string]>,
        states: [
          { id: 'locked', label: 'Locked' },
          { id: 'training', label: 'In training' },
          { id: 'learned', label: 'Learned' }
        ]
      },
      tasks: [
        task('RTGL', [433, 40, 239, 71]),
        task('RTG', [43, 203, 206, 77]),
        task('RTL', [314, 203, 205, 77]),
        task('RGL', [585, 204, 206, 75]),
        task('TGL', [856, 203, 206, 77]),
        task('RT', [44, 369, 139, 76]),
        task('RG', [219, 369, 140, 77]),
        task('RL', [394, 369, 141, 77]),
        task('TG', [570, 369, 140, 76]),
        task('TL', [745, 369, 141, 77]),
        task('GL', [923, 369, 138, 77]),
        task('R', [43, 535, 206, 76]),
        task('T', [314, 535, 205, 76]),
        task('G', [585, 535, 206, 77]),
        task('L', [855, 535, 206, 76])
      ]
    },
    kernel: {
      id: 'annealed-kernel-reward',
      // No-break spaces keep "guidance first," and "precision later." whole where the heading takes two lines.
      heading: 'Reward: *guidance*\u00a0first, *precision*\u00a0later.',
      /** Paragraph with inline TeX between $...$ (rendered by KaTeX at build time). */
      text: 'The reward includes a kernel on the goal distance. A wide kernel guides the policy from far away; annealing narrows it as the policy improves, moving from coarse guidance to precise goal reaching. The annealing is task-wise: each task has its own kernel width, which narrows at its own pace.',
      // The curve-only cut, starting once the wide kernel is drawn: its first frame is the poster, so playback starts
      // without a jump; under reduced motion (nothing plays) the poster is its last frame, the narrowed kernel.
      animation: {
        ...clip(
          'method_kernel_curve',
          'Animation of the annealed kernel reward: as the policy improves, the kernel narrows step by step until it passes the learned width (dashed) and turns teal.'
        ),
        stillPoster: `${clipDir}/method_kernel_curve_end.jpg`
      },
      /** What the last frame draws besides the kernel (video source make_full.py: the dashed curve is the kernel at
          the width below which a task counts as learned, paper Sec. 3.4 / 4.1; the kernel turns teal on the step that
          takes it below). Shown under the clip, beside its replay button. */
      note: 'Dashed: the kernel at the width below which a task counts as learned.'
    },
    encoding: {
      id: 'observation-encoding',
      heading: 'A nonlinear encoding *magnifies small deviations*.',
      lead: 'Each position error, rotation vector and local geometry vector the policy observes is expressed in the current wrist frame $h$ as ${}_{h}\\mathbf{x}$ and encoded as',
      formula:
        'f({}_{h}\\mathbf{x}) = \\frac{{}_{h}\\mathbf{x}}{\\|{}_{h}\\mathbf{x}\\|}\\,\\frac{\\log\\bigl(1 + \\min(\\|{}_{h}\\mathbf{x}\\|, d_{\\max}) / d_0\\bigr)}{\\log(1 + d_{\\max} / d_0)}.',
      text: 'It keeps the direction while magnifying small deviations and compressing large ones, with the scales $d_0$ and $d_{\\max}$ setting its sensitivity and saturation.',
      /** The figure after the text (EncodingFigure.astro), redrawn from the talk deck's encoding page and the video's
          shot "A nonlinear encoding magnifies small deviations": the encoded value of one error magnitude for the
          supplementary's object-position scales, against linear scaling, with a 2 cm interval near the goal and one
          far away; the legend uses the video's wording. */
      figure: {
        d0: 1,
        dmax: 30,
        near: [0, 2] as [number, number],
        far: [28, 30] as [number, number],
        xLabel: 'Error (cm)',
        yLabel: 'Encoded value',
        linearLabel: 'linear',
        nearLabel: 'Small errors: magnified',
        farLabel: 'Large errors: compressed',
        label:
          'Plot of the encoded value against the error from 0 to 30 cm: the logarithmic curve rises steeply near zero and flattens far away, above a dashed linear line. A 2 cm interval near the goal spans a large part of the encoded range (small errors magnified); a 2 cm interval far away spans a small part (large errors compressed).'
      }
    }
  },
  results: {
    /** Long-horizon manipulation, shown by the live demo: the policy chains goal after goal in the browser. */
    demo: {
      // A hyphenated word never splits at its hyphen (KeyHeading keeps it on one line).
      eyebrow: 'Live demo',
      heading: '*Long-horizon* manipulation, live in your browser.',
      // No caption under the demo (owner 2026-11-22); the line keeps only "Open in a new tab".
      caption: '',
      src: '/dexgo/demo/index.html',
      title: 'DexGO interactive demo',
      /** The preview before Start (owner 2026-11-23): the project video's long-horizon showcase, a muted loop of the
          recorded chain with its task ticker (all eight goals R, TL, GL, RL, TGL, RTL, RGL, RTGL on the flashlight;
          true BT.709 files of the talk's web/clips), so a reader who never starts the demo still sees a long-horizon
          chain. `previewPhone` is its phone cut, used where the stage is stacked (LazyDemo.astro). Both posters are
          the frame at 9.0 s (GL current, ticker TL, GL, RL), so the stage looks alive before playback. No label says
          it is recorded (owner): the start button names the switch to the live simulation. */
      preview: clip('chain_ticker', 'Recorded long-horizon chain: a simulated hand reaches eight goals in a row on a flashlight, each a different task, named on a ticker above.'),
      previewPhone: clip('chain_ticker_phone', 'Recorded long-horizon chain: a simulated hand reaches eight goals in a row on a flashlight, each a different task, named on a ticker above.'),
      startLabel: 'Start the live demo',
      loadingLabel: 'Loading the demo…',
      newTabLabel: 'Open in a new tab'
    },
    targets: {
      eyebrow: 'Results',
      heading: 'Different target grasps, *distinct motions*.',
      // One composite per pair, its two rows stacked in the file; screwdriver left, hammer right, as in the video.
      pair: [
        clip('control_screwdriver_pair_crop', 'Screwdriver: top, relocation only; bottom, grasp type change and relocation.'),
        clip('control_hammer_pair_crop', 'Hammer: top, relocation only; bottom, reorientation, translation and relocation.')
      ],
      /** Label above each pair, in the order of `pair`. */
      names: ['Screwdriver', 'Hammer'],
      // No-break spaces keep each row's label with its value ("Top: L, relocation only." whole, "Bottom: GL").
      caption:
        'In each clip, both rows start from the same grasp (left) and bring the object to the same world pose; only the target grasp (faint, right) differs. Top: L, relocation only. Bottom: GL for the screwdriver, RTL for the hammer.'
    },
    objects: {
      heading: '*Unseen* everyday objects.',
      /** One swipeable row per hand; a hand without clips is left out (and with it the toggle). */
      hands: [
        {
          id: 'mano',
          label: 'MANO hand',
          // Paper wording (Sec. 4.1 / 4.4).
          note: '', // owner 2026-11-22: no note under the MANO carousel
          items: objectItems('mano', 'MANO')
        },
        {
          id: 'sharpa',
          label: 'Sharpa Wave hand',
          // Paper wording (Sec. 4.4).
          note: 'The same framework, without hand-specific tuning, also trains a policy for the Sharpa Wave hand.',
          items: objectItems('sharpa', 'Sharpa Wave')
        }
      ].filter((hand) => hand.items.length > 0)
    },
    sizes: {
      // Owner (2026-11-22): titled as examples.
      heading: 'Examples *outside* the training range.',
      // Labels are the owner-approved video labels.
      clips: [
        { ...sizeClip('thin', 'A 2 cm thin object', { handY: 133, top: 12, left: 22, right: 255, bottom: 268 }), name: 'Thin: 2\u00a0cm' },
        { ...sizeClip('thick', 'A 7.2 cm thick object', { handY: 142, top: 25, left: 57, right: 378, bottom: 398 }), name: 'Thick: 7.2\u00a0cm' },
        // The long clip shows the whole motion (owner 2026-11-22, MUST): every control step from the pinch at the
        // rod's upper end (step 0, held 0.5 s) through the swing down, the grasp change and the move into place to
        // the stable hold (step 126, held 1.0 s). The fast swing (steps 10-30) plays at 1x real time, the rest at
        // 1.5x like the thin and thick clips. `top` is the rod's upper end in the first frame, so the long clip sets
        // the row's headroom (--reach) and may cover part of the heading (global.css, .dx-sizes). `left` leaves out
        // the swing's brief reach into the gap (to source x 32, steps 16-22), as before; handY, right and bottom,
        // re-measured over the new file, differ from these by at most 2 source px and are kept.
        { ...sizeClip('long', 'A 50 cm long object', { handY: 387, top: 32, left: 116, right: 725, bottom: 730 }), name: 'Long: 50\u00a0cm' }
      ],
      // Training range as stated in Sec. 4.1 of the paper (no clip-speed statement: owner 2026-11-22). A
      // word joiner (U+2060) after each en dash keeps a range on one line.
      caption: 'Training objects have a long axis of 10–\u206032\u00a0cm and two short axes of 3–\u20605\u00a0cm.'
    }
  },
  bibtex: 'TODO: BibTeX entry'
};
