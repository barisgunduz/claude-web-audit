import type { ModuleDefinition } from '../types.js';
import { contentChecks } from './checks.js';

export const contentModule: ModuleDefinition = { name: 'content', checks: contentChecks };
