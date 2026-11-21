// Data for the DexGO project page (/dexgo/).
// Strings that start with "TODO" are placeholders and are not rendered (BibTeX); links with
// an empty `href` are not rendered either, so each item appears as soon as it is filled in.
// Every clip's frame size is read from its file at build time, so a missing file fails the build.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
}

const clipDir = '/assets/dexgo/clips';

/** Path of public/assets/dexgo/clips/<file> on disk (build time). */
const clipFile = (file: string): string => join(process.cwd(), 'public', clipDir, file);

/** True if public/assets/dexgo/clips/<file> exists at build time (a hand shows only the objects it has clips for). */
const existsInClips = (file: string): boolean => existsSync(clipFile(file));

/**
 * Frame size [w, h] in pixels of clips/<name>.mp4, read at build time from its video track header (the last
 * 8 bytes of the 'tkhd' box are width and height in 16.16 fixed point; audio tracks store 0). Used for cuts
 * whose size is not fixed in advance (phone and content crops).
 */
const frameSize = (name: string): [number, number] => {
  const buf = readFileSync(clipFile(`${name}.mp4`));
  for (let i = buf.indexOf('tkhd'); i >= 4; i = buf.indexOf('tkhd', i + 4)) {
    const size = buf.readUInt32BE(i - 4);
    if (size !== 92 && size !== 104) continue; // version 0 or 1 header; anything else is not a box
    const end = i - 4 + size;
    const w = buf.readUInt32BE(end - 8) / 65536;
    const h = buf.readUInt32BE(end - 4) / 65536;
    if (w > 0 && h > 0) return [Math.round(w), Math.round(h)];
  }
  throw new Error(`No video frame size in ${name}.mp4`);
};

/** Phone cut clips/<name>.mp4 (used below 640 px) with its first-frame poster <name>.jpg and its box aspect. */
const phoneCut = (name: string): { src: string; poster: string; aspect: string } => {
  const [w, h] = frameSize(name);
  return { src: `${clipDir}/${name}.mp4`, poster: `${clipDir}/${name}.jpg`, aspect: `${w} / ${h}` };
};

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
    .map(([slug, name]) => ({ ...clip(`unseen_${hand}_${slug}`, `${handName} hand, ${name.toLowerCase()}`), name }));

/**
 * Where the hand and the object sit in a size clip, in source px, measured once over all frames of the file:
 * `handY` the hand's centre height (median over the clip), `top` the highest point drawn in any frame,
 * `left`/`right` the horizontal extent of everything drawn in any frame, `bottom` the lowest point of the object
 * at rest (median over the clip).
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
  /** Words shown under the player, e.g. 'reorientation + translation + relocation'. */
  words: string;
  /** The same words for screen readers, joined with "and". */
  spoken: string;
  /** The unlock rule shown under the player. */
  rule: string;
  /** Node rectangle in pixels of the 1790x806 unlock animation (its final frame). */
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
    words: id.length === 4 ? 'all four capabilities' : letters.map((l) => capabilityWords[l]).join(' + '),
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
    'DexGO: Dexterous Grasp Transition with Object Relocation. A reinforcement learning framework that trains a single policy to change how a hand holds an object while moving it to a desired pose.',
  /** Alt text of the share image (the teaser poster, its first frame). */
  shareImageAlt:
    'A simulated hand holds a screwdriver on a table, beside a wooden board with a screw and a screwdriver holder.',
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
  // Links with an empty `href` render as inactive text.
  links: [
    { label: 'Paper', href: '' },
    { label: 'Video', href: '' },
    { label: 'Code', href: '' }
  ],
  /** Opening teaser of the video: the 2:1 cut (table and the whole hand path); below 640 px the 4:3 phone cut,
      framed on the hand's path, with its own poster. */
  teaser: {
    ...clip(
      'teaser_1080p_crop',
      'A hand changes its grasp on a screwdriver to drive a screw, then changes it again to place the screwdriver in its holder.'
    ),
    phone: phoneCut('teaser_phone')
  },
  abstract:
    'Different tasks require an object to be held in different ways. Humans therefore often adjust their grasp while moving an object into place. Motivated by this, we study grasp transition with object relocation: given a target grasp and a desired object world pose, the hand must transition from its initial grasp to the target grasp while relocating the object to the specified pose. This problem is challenging because the goals specify only the final state without intermediate guidance, and their complexity varies widely, from minor in-hand adjustments to grasp type changes coupled with long-distance relocations. In this work, we present DexGO, a reinforcement learning framework that trains a single policy through progressive task composition. Specifically, we introduce a prerequisite graph that organizes four basic capabilities and their increasingly complex combinations, allowing simpler tasks to provide intermediate guidance for learning more complex ones. We further introduce a task-wise annealed kernel reward and a nonlinear encoding of spatial observations to facilitate precise reaching across a wide range of goal distances. Experiments demonstrate that a single policy can achieve diverse target grasps and object world poses across a wide range of task complexities, producing precise and controllable motions.',
  method: {
    intro:
      'DexGO trains a single policy with reinforcement learning on tasks that group goals by the capabilities they require: in-hand reorientation (R), in-hand translation (T), grasp type change (G) and object relocation (L).',
    heading: 'Complex motions *combine* basic capabilities.',
    figure: {
      src: '/assets/dexgo/method_overview.svg',
      /** viewBox of the SVG (points of the paper's PDF figure). */
      width: 715.68,
      height: 250.56,
      alt: 'Overview of DexGO: a single policy observes goal errors, local geometry and proprioception and is trained with an annealed kernel reward on tasks and goals sampled from the prerequisite graph; a grasp library supplies initial and target grasps.',
      /** Clickable regions in viewBox units: [x, y, w, h]. */
      // In the order of the subsections they jump to (graph, kernel, encoding), which is the link row's order.
      hotspots: [
        { target: 'prerequisite-graph', label: 'Prerequisite graph', rect: [486.8, 1.5, 226.4, 138] },
        { target: 'annealed-kernel-reward', label: 'Annealed kernel reward', rect: [215, 84, 163, 26] },
        { target: 'observation-encoding', label: 'Nonlinear observation encoding', rect: [122, 18, 80, 77] }
      ] as { target: string; label: string; rect: [number, number, number, number] }[],
      /** Phone-only link to the full-size figure (the figure is a thumbnail below 720 px). */
      openLabel: 'Open the figure'
    },
    graph: {
      id: 'prerequisite-graph',
      heading: 'Simple tasks *unlock* their combinations.',
      text: 'Training starts with the four single-capability tasks; a combination task is unlocked once all its subsets with one fewer capability have been learned.',
      animation: { ...clip('method_graph', 'Animation of the prerequisite graph: tasks unlock and are learned one after another.'), endPoster: `${clipDir}/method_graph_end.jpg` },
      hint: 'Select a task to watch an example.',
      defaultTask: 'RTGL',
      /** Part of the animation frame that holds the graph (its example clips on the right are cropped away). */
      graphWidth: 1100,
      /** Seconds into the animation where the graph rests in its final place (before, it is centred in the full
          frame and slides left until frame 197, 6.567 s); the page starts the animation here, one frame later, so
          the first frame matches the poster and the graph never shifts. */
      startAt: 6.6,
      /** Legend of the three states, covered once every task is learned: [x, y, w, h] in frame pixels. */
      legendRect: [250, 672, 600, 80] as [number, number, number, number],
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
      heading: 'Reward: *guidance* first, *precision* later.',
      /** Paragraph with inline TeX between $...$ (rendered by KaTeX at build time). */
      text: 'The main reward term is a kernel on the distance to the goal: a wide kernel guides the policy from far away, and narrowing it as the policy improves brings precision. Each task has its own kernel width, which narrows at its own pace.',
      // The curve-only cut. Its first frame is blank, so the poster is its last frame (the narrowed kernel): the
      // figure is never empty at rest (before it plays, under reduced motion, with videos paused).
      animation: {
        ...clip('method_kernel_curve', 'Animation of the annealed kernel reward: as the policy improves, the kernel narrows step by step.'),
        poster: `${clipDir}/method_kernel_curve_end.jpg`
      }
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
      caption: 'The policy trained with DexGO reaches one goal after another, from random tasks or from the tasks you select on the graph.',
      src: '/dexgo/demo/index.html',
      title: 'DexGO interactive demo',
      /** Captures of the running demo (seed 3, goal 70: a TGL goal whose grey goal hand is about 11 cm from the
          hand, so the target grasp reads apart from the current one), its controls, status and legend hidden:
          `poster` its wide layout, 2x of 1080x640; `posterMid` the same layout in a narrower frame (its graph panel
          is then a larger share of the width), 2x of 864x512, same aspect, used between 884 and 1023 px;
          `posterPhone` its stacked 9:16 layout, used where the stage is narrower than the demo's wide layout needs
          (LazyDemo.astro), 3x of 350x622. Sizes in CSS px. */
      poster: { src: '/assets/dexgo/demo_poster_wide.webp', width: 1080, height: 640 },
      posterMid: { src: '/assets/dexgo/demo_poster_mid.webp', width: 864, height: 512 },
      posterPhone: { src: '/assets/dexgo/demo_poster_tall.webp', width: 350, height: 622 },
      posterAlt:
        'Preview of the demo: a simulated hand holds an elongated object; a semi-transparent goal shows the target grasp and object pose, and the graph of the 15 tasks marks the current task.',
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
      caption: 'Each pair shares its start (faint, left) and desired object world pose; only the target grasp differs.'
    },
    objects: {
      heading: '*Unseen* everyday objects.',
      /** One swipeable row per hand; a hand without clips is left out (and with it the toggle). */
      hands: [
        { id: 'mano', label: 'MANO hand', note: '', items: objectItems('mano', 'MANO') },
        {
          id: 'sharpa',
          label: 'Sharpa hand',
          note: 'DexGO can also be applied to a different hand morphology.',
          items: objectItems('sharpa', 'Sharpa')
        }
      ].filter((hand) => hand.items.length > 0)
    },
    sizes: {
      heading: '*Beyond* the training size range.',
      // Labels are the owner-approved video labels.
      clips: [
        { ...sizeClip('thin', 'A thin object, 2 cm across', { handY: 133, top: 12, left: 25, right: 255, bottom: 268 }), name: 'Thin: 2\u00a0cm' },
        { ...sizeClip('thick', 'A thick object, 7.2 cm across', { handY: 142, top: 25, left: 57, right: 378, bottom: 398 }), name: 'Thick: 7.2\u00a0cm' },
        { ...sizeClip('long', 'A long object, 50 cm long', { handY: 387, top: 32, left: 116, right: 697, bottom: 729 }), name: 'Long: 50\u00a0cm' }
      ],
      // Training range as stated in Sec. 4.1 of the paper. A word joiner (U+2060) after each en dash keeps a range
      // on one line.
      caption: 'Training objects have a long axis of 10–\u206032\u00a0cm and two short axes of 3–\u20605\u00a0cm.'
    }
  },
  bibtex: 'TODO: BibTeX entry'
};
