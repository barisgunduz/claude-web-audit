import type { ModuleDefinition } from '../types.js';
import { seoPageChecks } from './page-checks.js';
import { seoSiteChecks } from './site-checks.js';
import { structuredData } from './structured-data.js';

export const seoModule: ModuleDefinition = {
  name: 'seo',
  checks: [...seoPageChecks, structuredData, ...seoSiteChecks],
};
