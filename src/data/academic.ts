import type { LinkChip } from '../components/LinkChips.astro';
import { dexgoPage } from './dexgo';
import { newsItems, projectPlaceholder, site } from './site';

// Strings that start with "TODO" are placeholders. In `astro dev` they render with a visible dashed highlight
// (TodoText.astro) so they are easy to find; a production build renders nothing for them.

/** Break points of the bio's long words, shown as soft hyphens (U+00AD) in its rendered text. The bio is justified
 *  (owner 2026-11-22) and these are its only in-word breaks (`hyphens: manual`), so every browser sets the same lines;
 *  automatic hyphenation depends on the browser's dictionary. Without them a 390 px phone left word gaps of up to 4.7
 *  spaces in the bio; with them, at most 2. */
const bioBreaks = ['cur-rent-ly', 'stu-dent', 'in-ter-est-ed', 'dex-ter-ous', 'ma-nip-u-la-tion', 're-in-force-ment', 'learn-ing',
  're-ceived', 'Me-chan-i-cal', 'En-gi-neer-ing', 'Uni-ver-si-ty'];

export const academicProfile = {
  fullName: site.name,
  /** site.bio with soft hyphens at `bioBreaks` (a soft hyphen shows only at a line end). */
  summary: bioBreaks.reduce((text, word) => text.replaceAll(word.replaceAll('-', ''), word.replaceAll('-', '\u00ad')), site.bio),
  // A square cut of the ski photo (helmet to hands, mountains beside), 600 px for the 200 px slot at 3x.
  // `objectPosition` chooses which part stays visible if the slot is ever not square.
  portrait: {
    src: '/assets/profile/portrait.webp',
    alt: 'Jiaxin Li on a ski slope with snowy mountains behind.',
    width: 600,
    height: 600,
    objectPosition: '50% 50%'
  }
};

// Entries with an empty `href` are not rendered.
export const academicLinks = [
  { label: 'Email', href: `mailto:${site.email}` },
  { label: 'GitHub', href: site.github },
  { label: 'Google Scholar', href: '' },
  { label: 'LinkedIn', href: '' },
  { label: 'X', href: '' }
];

export const academicNews = newsItems;

/** A link chip of a project (LinkChips.astro): without `href` it is shown muted, marked "soon", not a link. */
export type ProjectLink = LinkChip;

export interface ProjectAuthor {
  name: string;
  href: string;
  /** Co-first author (equal contribution), marked with `*`. */
  equal: boolean;
}

export interface ProjectEntry {
  /** Full title, as in a publication list; links to `href`. */
  title: string;
  href: string;
  /** In paper order. The site owner (`site.name`) is shown in bold and not linked. */
  authors: ProjectAuthor[];
  /** Note explaining the `*` of equal-contribution authors. */
  equalNote: string;
  /** Muted looping clip (H.264, no audio) and its first frame as poster; frame size in px. */
  media: { video: string; poster: string; width: number; height: number };
  links: ProjectLink[];
}

/** The DexGO page's link with this label, if it has a target yet (dexgo.ts owns the paper and code links). */
const dexgoLink = (label: string): string | undefined =>
  dexgoPage.links.find((link) => link.label === label)?.href || undefined;

export const academicProjects: {
  heading: string;
  entries: ProjectEntry[];
  empty: typeof projectPlaceholder;
} = {
  heading: 'Projects',
  entries: [
    {
      title: `${dexgoPage.title}: ${dexgoPage.subtitle}`,
      href: '/dexgo/',
      authors: dexgoPage.authors,
      equalNote: dexgoPage.equalNote,
      // Card cut of the DexGO teaser (from teaser_1080p.mp4): one fixed 1280x720 window, the same in every frame, that
      // holds the hand's whole path, the screw base and the rack (no zoom or pan), scaled to 640x360; the loop starts in
      // the pinch (poster = frame 0).
      media: {
        video: '/assets/dexgo/card_teaser.mp4',
        poster: '/assets/dexgo/card_teaser.webp',
        width: 640,
        height: 360
      },
      links: [
        { label: 'Paper', icon: 'paper', href: dexgoLink('Paper') },
        { label: 'Project Page', icon: 'globe', href: '/dexgo/' },
        { label: 'Code', icon: 'code', href: dexgoLink('Code') }
      ]
    }
  ],
  empty: projectPlaceholder
};

/** The News section is hidden for now (owner 2026-11-22); the items stay in site.ts. */
export const showNews = false;

export const academicEducation = [
  {
    institution: 'ETH Zurich',
    degree: 'MSc in Robotics, Systems and Control',
    major: '',
    period: '2025 – present'
  },
  {
    institution: 'Shanghai Jiao Tong University',
    degree: 'BEng in Mechanical Engineering',
    major: '',
    period: '2021 – 2025'
  }
];
