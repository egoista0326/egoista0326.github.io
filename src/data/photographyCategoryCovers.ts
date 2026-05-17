import type { CategorySlug } from './photographyVocab';

export type CategoryCover = {
  image: string;
  alt: string;
  width: number;
  height: number;
  objectPosition?: string;
};

export const photographyCategoryCovers: Record<CategorySlug, CategoryCover> = {
  'still-life': {
    image: '/assets/photography/works/dsc-0013.webp',
    alt: 'Low-light still life detail used as the Still Life category cover.',
    width: 2400,
    height: 1350,
    objectPosition: 'center'
  },
  landscape: {
    image: '/assets/photography/works/dsc-8339.webp',
    alt: 'Mountain and water landscape used as the Landscape category cover.',
    width: 2400,
    height: 1600,
    objectPosition: 'center'
  },
  street: {
    image: '/assets/photography/works/dsc-0046.webp',
    alt: 'Rainy city window scene used as the Street category cover.',
    width: 1800,
    height: 2400,
    objectPosition: 'center'
  }
};
