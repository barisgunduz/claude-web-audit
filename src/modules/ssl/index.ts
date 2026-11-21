import type { ModuleDefinition } from '../types.js';
import { sslChecks } from './checks.js';

export const sslModule: ModuleDefinition = { name: 'ssl', checks: sslChecks };
