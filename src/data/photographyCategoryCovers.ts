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
    image: '/assets/photography/works/low-light-still-life.jpg',
    alt: 'Low-light still life detail used as the Still Life category cover.',
    width: 1800,
    height: 1012,
    objectPosition: 'center'
  },
  landscape: {
    image: '/assets/photography/works/iceland-still-water.jpg',
    alt: 'Mountain and water landscape used as the Landscape category cover.',
    width: 1800,
    height: 1200,
    objectPosition: 'center'
  },
  street: {
    image: '/assets/photography/works/zurich-rain-window.jpg',
    alt: 'Rainy city window scene used as the Street category cover.',
    width: 1350,
    height: 1800,
    objectPosition: 'center'
  }
};
