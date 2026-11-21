import type { ModuleDefinition } from '../types.js';
import { linksChecks } from './checks.js';

export const linksModule: ModuleDefinition = { name: 'links', checks: linksChecks };
