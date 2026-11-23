// The DexGO project card of the homepage (src/data/academic.ts). The project page itself is its own repository
// (egoista0326/dexgo, GitHub project Pages served at /dexgo/ on this domain); this file keeps only what the card shows,
// which matches that page's title block (its src/data/dexgo.ts): title, subtitle, authors, the equal-contribution
// note and the paper and code links.

export const dexgoCard = {
  title: 'DexGO',
  subtitle: 'Dexterous Grasp Transition with Object Relocation',
  /** In paper order; `equal` marks the co-first authors (equal contribution). */
  authors: [
    { name: 'Jiaxin Li', href: 'https://egoista0326.github.io/', equal: true },
    { name: 'Hui Zhang', href: 'https://zdchan.github.io/', equal: true },
    // ETH profile pages (no personal sites); the path is case-sensitive ("Mark.html").
    { name: 'Mark Zander', href: 'https://pdz.ethz.ch/the-group/people/Mark.html', equal: false },
    { name: 'Mirko Meboldt', href: 'https://pdz.ethz.ch/the-group/people/meboldt.html', equal: false }
  ],
  equalNote: 'Equal contribution',
  /** The project page: an absolute path on this domain, served by the egoista0326/dexgo repository. */
  href: '/dexgo/',
  /** Paper and code links; an empty `href` shows a muted "soon" chip on the card (owner). */
  links: [
    { label: 'Paper', href: '' },
    { label: 'Code', href: '' }
  ]
};
