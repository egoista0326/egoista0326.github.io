import { photographyCategories } from './photographyVocab';

export const photographyProfile = {
  title: 'Jiaxin Li Photography',
  intro: 'I am Jiaxin Li, an amateur photographer.',
  email: 'ljx2986519980@gmail.com',
  instagram: {
    label: 'Open Instagram',
    url: 'https://www.instagram.com/egoista_li2003?igsh=MWVkeXh5anZmZzluOQ%3D%3D&utm_source=qr'
  },
  rednote: {
    label: 'Show Rednote Card',
    closeLabel: 'Close Rednote Card',
    title: 'Rednote Card',
    displayName: 'egoista',
    id: '2989511395',
    cardImage: '/assets/photography/rednote-card.jpg',
    alt: 'Rednote card for egoista, Rednote ID 2989511395.'
  },
  workTypeLabel: 'Work Types',
  workTypes: photographyCategories
};

export const photographyNews = [
  {
    date: '2025.6',
    text: 'buy my first camera!'
  }
] as const;

export const photographyProjects = [
  {
    slug: 'urban-isolation',
    title: '城市孤岛',
    startDate: '2025.6',
    summary: 'A developing street series about solitude, distance, and small pauses inside dense city spaces.',
    description:
      '城市孤岛 is an ongoing street photography project looking at quiet separation in public life: people resting, waiting, passing, or looking through rainy windows while the city continues around them.',
    photoSlugs: ['dsc-0046', 'dsc-0086', 'dsc-0152', 'dsc-0163', 'dsc-2799', 'dsc-2862', 'dsc-9266', 'dsc-9871', 'dsc-9971']
  }
] as const;

export type PhotographyProject = (typeof photographyProjects)[number];
