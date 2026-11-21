import type { ModuleDefinition } from '../types.js';
import { headersChecks } from './checks.js';

export const headersModule: ModuleDefinition = { name: 'headers', checks: headersChecks };
