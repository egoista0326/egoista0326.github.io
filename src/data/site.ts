export const site = {
  name: 'Jiaxin Li',
  title: 'Jiaxin Li',
  /** Meta and share description of the homepage: the bio's facts in the third person. */
  description:
    'Jiaxin Li, MSc student in Robotics, Systems and Control at ETH Zurich, interested in dexterous manipulation and reinforcement learning.',
  // Owner's wording (2026-11-22): the programme is stated here, as there is no role line under the name; "dexterous
  // manipulation", not "dexterous robotic manipulation".
  bio: 'I am currently an MSc student in Robotics, Systems and Control at ETH Zurich, interested in dexterous manipulation and reinforcement learning. I received my BEng in Mechanical Engineering from Shanghai Jiao Tong University in 2025.',
  email: 'ljx2986519980@gmail.com',
  github: 'https://github.com/egoista0326',
  /** Share image of the homepage (og:image): a JPEG copy of the portrait (some link previews skip WebP). */
  shareImage: {
    src: '/assets/profile/portrait.jpg',
    width: 600,
    height: 600,
    alt: 'Jiaxin Li on a ski slope with snowy mountains behind.'
  }
};

/** Header nav; `labelZh` shows instead of `label` when a photography page is set to 中文 (photography.css). */
export const navItems = [
  { label: 'Academic', labelZh: '学术', href: '/' },
  { label: 'Photography', labelZh: '摄影', href: '/photography/' }
];

export const newsItems = [
  {
    year: '2025',
    text: 'Started MSc in Robotics, Systems and Control at ETH Zurich.'
  }
];

export const projectPlaceholder = {
  heading: 'Projects will be added here as they become ready.',
  body: 'This section is reserved for selected academic and technical work; no project entries are listed yet.'
};
