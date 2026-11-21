import type { ModuleDefinition } from '../types.js';
import { aiChecks } from './checks.js';

export const aiModule: ModuleDefinition = { name: 'ai', checks: aiChecks };
