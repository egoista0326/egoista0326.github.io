import { newsItems, projectPlaceholder, site } from './site';

// Strings that start with "TODO" are placeholders. They render with a visible
// dashed highlight (see src/lib/placeholders.ts) so they are easy to find in preview.

export const academicProfile = {
  fullName: site.name,
  title: 'MSc student in Robotics, Systems and Control',
  institute: 'ETH Zurich',
  summary: site.bio,
  researchInterests: 'TODO: research interests',
  // Placeholder portrait: swap `src`/`alt` for a real portrait. `objectPosition`
  // chooses which part of the image stays visible in the square crop.
  portrait: {
    src: '/assets/photography/profile-shadow-2649.webp',
    alt: 'Reflected self-portrait of Jiaxin Li (placeholder portrait).',
    width: 1920,
    height: 1280,
    objectPosition: '49% 50%'
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

export interface ProjectLink {
  label: string;
  href: string;
}

export interface ProjectEntry {
  title: string;
  href: string;
  description: string;
  /** Thumbnail image path under public/ (also the video poster); '' renders a placeholder. */
  thumbnail: string;
  /** Optional muted looping video shown in place of the image; '' for none. */
  thumbnailVideo: string;
  links: ProjectLink[];
}

export const academicProjects: {
  heading: string;
  entries: ProjectEntry[];
  empty: typeof projectPlaceholder;
} = {
  heading: 'Projects',
  entries: [
    {
      title: 'DexGO',
      href: '/dexgo/',
      description: 'Dexterous grasp transition with object relocation: a reinforcement learning framework that trains a single policy to change how a hand holds an object while moving it to a desired pose.',
      // A still of the teaser cropped to the hand driving the screw (the full frame shows the whole table,
      // so the hand would be a few pixels at card size).
      thumbnail: '/assets/dexgo/card_thumbnail.webp',
      thumbnailVideo: '',
      links: [{ label: 'Project page', href: '/dexgo/' }]
    }
  ],
  empty: projectPlaceholder
};

export const academicEducation = [
  {
    institution: 'ETH Zurich',
    degree: 'MSc in Robotics, Systems and Control',
    major: '',
    period: '2025 – present'
  },
  {
    institution: 'Shanghai Jiao Tong University',
    degree: "Bachelor's degree",
    major: 'Mechanical Engineering',
    period: '2021 – 2025'
  }
];
