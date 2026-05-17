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
    image: '/assets/photography/works/dsc-2583.webp',
    alt: 'Spiderweb fibers glowing against glass used as the Still Life category cover.',
    width: 1600,
    height: 2400,
    objectPosition: 'center 55%'
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
  },
  abstract: {
    image: '/assets/photography/works/dsc-0013.webp',
    alt: 'Low-light abstract reflection used as the Abstract category cover.',
    width: 2400,
    height: 1350,
    objectPosition: 'center'
  },
  'black-and-white': {
    image: '/assets/photography/works/dsc-8072.webp',
    alt: 'Black-and-white light and shadow with a small figure used as the Black and White category cover.',
    width: 1800,
    height: 2400,
    objectPosition: 'center 58%'
  },
  architecture: {
    image: '/assets/photography/works/dsc-9605.webp',
    alt: 'Paris street framed by buildings with a Ferris wheel beyond used as the Architecture category cover.',
    width: 1800,
    height: 2400,
    objectPosition: 'center 45%'
  }
};
