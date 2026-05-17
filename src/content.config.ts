import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import {
  cameraSlugs,
  categorySlugs,
  conditionSlugs,
  lensSlugs,
  locationSlugs
} from './data/photographyVocab';

const optionalCamera = z.enum(cameraSlugs).or(z.literal('')).default('');
const optionalLens = z.enum(lensSlugs).or(z.literal('')).default('');
const optionalLocation = z.enum(locationSlugs).or(z.literal('')).default('');
const optionalCondition = z.enum(conditionSlugs).or(z.literal('')).default('');

const photos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/photos' }),
  schema: z.object({
    title: z.string().default('Untitled'),
    slug: z.string(),
    category: z.enum(categorySlugs),
    categories: z.array(z.enum(categorySlugs)).default([]),
    image: z.string().default(''),
    alt: z.string().default(''),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.enum(['landscape', 'portrait', 'square']),
    date: z.string().optional().default(''),
    year: z.string().optional().default(''),
    location: optionalLocation,
    camera: optionalCamera,
    lens: optionalLens,
    condition: optionalCondition,
    conditions: z.array(z.enum(conditionSlugs)).default([]),
    featured: z.boolean().default(false),
    order: z.number().int().default(0),
    note: z.string().optional().default(''),
    draftMetadata: z.boolean().default(false),
    language: z.enum(['en', 'zh']).default('en')
  })
});

export const collections = { photos };
