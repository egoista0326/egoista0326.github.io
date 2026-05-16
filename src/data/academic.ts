import { newsItems, projectPlaceholder, site } from './site';

export const academicProfile = {
  fullName: site.name,
  title: 'MSc student in Robotics, Systems and Control',
  institute: 'ETH Zurich',
  summary: site.bio
};

export const academicLinks = [
  { label: 'Email', href: `mailto:${site.email}` },
  { label: 'GitHub', href: site.github }
];

export const academicNews = newsItems;

export const academicProjects = {
  entries: [],
  empty: projectPlaceholder
};
