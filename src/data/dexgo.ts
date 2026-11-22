// Data for the DexGO project page (/dexgo/).
// Strings that start with "TODO" are placeholders and are not rendered (BibTeX); links with an empty `href` are
// shown as muted "soon" chips when `soon` is set (Paper, Code) and left out otherwise (Video: the project video
// plays at the top of the page).
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

/** The project video at the top of the page (ProjectVideo.astro): a player with sound, unlike the muted clips. */
export interface ProjectVideo extends Clip {
  /** WebVTT captions of the narration (English), off until the reader turns them on in the player. */
  captions: string;
  /** Time in seconds where the page's playback starts (media fragment #t=); the poster is the frame at this time. */
  start: number;
}

const videoDir = '/assets/dexgo/video';

/**
 * public/assets/dexgo/video/<name>.mp4 at its own frame size, with <name>_poster.webp (its frame at `start` s) and
 * <name>.en.vtt.
 */
const projectVideo = (name: string, label: string, start: number): ProjectVideo => {
  const [width, height] = mp4FrameSize(join(process.cwd(), 'public', videoDir, `${name}.mp4`));
  return {
    src: `${videoDir}/${name}.mp4`,
    poster: `${videoDir}/${name}_poster.webp`,
    captions: `${videoDir}/${name}.en.vtt`,
    start,
    width,
    height,
    label
  };
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

/** Capability words of each task, as on the video's ticker. */
const capabilityWords: Record<string, string> = {
  R: 'reorientation',
  T: 'translation',
  G: 'grasp type change',
  L: 'relocation'
};

/** One node of the prerequisite graph. */
export interface GraphTask {
  /** Capability letters, e.g. 'RTL'. */
  id: string;
  /** Capability words shown under the player and read by screen readers, e.g. 'reorientation, translation and
      relocation'. */
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
    spoken: id.length === 4 ? 'all four capabilities' : joinNames(letters.map((l) => capabilityWords[l])),
    rule:
      id.length === 1
        ? 'Trained from the start.'
        : `Unlocked once ${joinNames(prerequisites)} ${prerequisites.length > 1 ? 'are' : 'is'} learned.`,
    prerequisites: id.length === 1 ? [] : prerequisites,
    rect,
    row: 4 - id.length,
    clip: clip(`node_${id}_crop`, `Example of task ${id}`)
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
  // Link chips of the title block (LinkChips.astro), as on the homepage card. A link with an empty `href` is shown
  // muted and marked "soon" when `soon` is set (Paper, Code: owner), and is left out otherwise (Video: the project
  // video plays at the top of the page).
  links: [
    { label: 'Paper', icon: 'paper', href: '', soon: true },
    { label: 'Video', icon: 'video', href: '', soon: false },
    { label: 'Code', icon: 'code', href: '', soon: true }
  ] as (LinkChip & { soon: boolean })[],
  /** The full project video at the top of the page, in place of the teaser (owner 2026-11-22): the final cut of the
      talk video (dexgo_showcase_alt_v30.mp4: 3 min 28 s, 1920x1080 H.264 at about 1 Mb/s, one mono AAC narration
      track), copied byte for byte (its index, 'moov', is already at the front, so it plays while it loads). It fades
      in from white over its first 0.33 s (frames 0-9 at 30 fps; the narration starts at 1.00 s), so the page starts
      it at 0.4 s (frame 12, the first frame fully in) and its poster is that frame (the screwdriver held at the upper
      left under "Different tasks need different grasps."; WebP quality 85, method 6). Captions: the narration at the
      video's own timings (scripts/dexgo_video_captions.py from its clips.json). */
  video: projectVideo('dexgo_video', 'DexGO project video, with narration', 0.4),
  abstract:
    'Different tasks require an object to be held in different ways. Humans therefore often adjust their grasp while moving an object into place. Motivated by this, we study \\emph{grasp transition with object relocation}: given a target grasp and a desired object world pose, the hand must transition from its initial grasp to the target grasp while relocating the object to the specified pose. This problem is challenging because the goals specify only the final state without intermediate guidance, and their complexity varies widely, from minor in-hand adjustments to grasp type changes coupled with long-distance relocations. In this work, we present DexGO, a reinforcement learning framework that trains a single policy through progressive task composition. Specifically, we introduce a prerequisite graph that organizes four basic capabilities and their increasingly complex combinations, allowing simpler tasks to provide intermediate guidance for learning more complex ones. We further introduce a task-wise annealed kernel reward and a nonlinear encoding of spatial observations to facilitate precise reaching across a wide range of goal distances. Experiments demonstrate that a single policy can achieve diverse target grasps and object world poses across a wide range of task complexities, producing precise and controllable motions.',
  method: {
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
        backHref: '/dexgo/#method-overview'
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
      text: 'It keeps the direction while magnifying small deviations and compressing large ones, with the scales $d_0$ and $d_{\\max}$ setting its sensitivity and saturation.'
    }
  },
  results: {
    /** Long-horizon manipulation, shown by the live demo: the policy chains goal after goal in the browser. */
    demo: {
      // A hyphenated word never splits at its hyphen (KeyHeading keeps it on one line).
      heading: '*Long-horizon* manipulation, live in your browser.',
      // No caption under the demo (owner 2026-11-22); the line keeps only "Open in a new tab".
      caption: '',
      src: '/dexgo/demo/index.html',
      title: 'DexGO interactive demo',
      /** Captures of the running demo (seed 47, goal 0, MANO, round object, Random chain): since the chain data for
          grasp changes at both rod ends (2026-11-22) goal 0 is an RGL goal, captured 0.60 s (12 control steps) into
          its reach, where the gray goal hand's thumb and fingers show beside and under the real hand (about 53 mm
          from it), so the target grasp reads apart from the current one; LazyDemo.astro writes RGL on the poster
          (data-first-goal). Shown: the demo's tabs, graph and legend; hidden: its Play/Reset buttons and status
          lines. `poster` its side-by-side layout in the
          page's 800 px column, 2x of 800x474; `posterPhone` its stacked 9:16 layout, used where the stage is narrower
          than the column (LazyDemo.astro), 3x of 350x622. Sizes in CSS px. */
      poster: { src: '/assets/dexgo/demo_poster_wide.webp', width: 800, height: 474 },
      posterPhone: { src: '/assets/dexgo/demo_poster_tall.webp', width: 350, height: 622 },
      posterAlt:
        'Preview of the demo: a simulated hand holds a round object; a gray goal hand and a translucent goal object show the target grasp and object pose, and the graph of the 15 tasks marks the current task.',
      startLabel: 'Start demo',
      loadingLabel: 'Loading the demo…',
      newTabLabel: 'Open in a new tab'
    },
    targets: {
      heading: 'Different target grasps, *distinct motions*.',
      // One composite per pair, its two rows stacked in the file; screwdriver left, hammer right, as in the video.
      pair: [
        clip('control_screwdriver_pair_crop', 'Screwdriver: top, relocation only; bottom, grasp type change and relocation.'),
        clip('control_hammer_pair_crop', 'Hammer: top, relocation only; bottom, reorientation, translation and relocation.')
      ],
      /** Label above each pair, in the order of `pair`. */
      names: ['Screwdriver', 'Hammer'],
      caption:
        'In each clip, both rows start from the same grasp (left) and bring the object to the same world pose; only the target grasp (faint, right) differs. Top: L, relocation only. Bottom: GL for the screwdriver, RTL for the hammer.'
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
