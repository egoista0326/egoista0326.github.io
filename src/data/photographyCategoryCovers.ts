import type { CategorySlug } from './photographyVocab';

/**
 * Category cards on `/photography/`: one cover photo per category.
 *
 * `photo` is the slug of a photo in `src/content/photos/` that belongs to the category; its image
 * file, width and height come from that photo's metadata. The build fails if a category has no
 * cover, or if the cover photo is missing or no longer in the category.
 */
export type CategoryCoverSpec = {
  photo: string;
  /** Alt text of the card image: describes the image only (the card title names the category). */
  alt: string;
  /** CSS `object-position` for the fixed-ratio card window. */
  objectPosition?: string;
};

export const photographyCategoryCovers: Record<CategorySlug, CategoryCoverSpec> = {
  'still-life': {
    photo: 'dsc-2583',
    alt: 'Spiderweb fibers glowing in window light beside a glass jar.',
    objectPosition: 'center 55%'
  },
  landscape: {
    photo: 'dsc-8652',
    alt: 'Red kitesurfing kites over a mountain lake below hazy peaks.',
    objectPosition: 'center'
  },
  street: {
    photo: 'dsc-0046',
    alt: 'Rain-speckled window in front of blurred string lights and passers-by.',
    objectPosition: 'center'
  },
  abstract: {
    photo: 'dsc-0534',
    alt: 'Close-up of blue ice ridges with peach-toned reflections.',
    objectPosition: 'center'
  },
  'black-and-white': {
    photo: 'dsc-0213',
    alt: 'Surf bursting against a dark cliff, with sea stacks in the mist, in black and white.',
    objectPosition: 'center'
  },
  architecture: {
    photo: 'dsc-2723',
    alt: 'Apartment balconies above a shaded courtyard with bicycles behind a wire fence.',
    objectPosition: 'center'
  }
};
