import type { ModuleDefinition } from '../types.js';
import { a11yChecks } from './checks.js';

export const a11yModule: ModuleDefinition = { name: 'a11y', checks: a11yChecks };
