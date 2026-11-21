import type { ModuleName } from '../modules/names.js';

/** Default module weights from SCOPE.md section 6. They add up to 100. */
export const DEFAULT_WEIGHTS: Readonly<Record<ModuleName, number>> = {
  speed: 20,
  seo: 20,
  links: 10,
  ssl: 10,
  a11y: 10,
  headers: 8,
  content: 8,
  ai: 8,
  email: 6,
};

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_THIN_CONTENT_WORDS = 300;
export const DEFAULT_SPEED_PAGES = 3;
export const MAX_SPEED_PAGES = 10;
export const DEFAULT_A11Y_PAGES = 10;
export const MAX_A11Y_PAGES = 50;
