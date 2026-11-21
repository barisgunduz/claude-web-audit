import type { ModuleDefinition } from '../types.js';
import { speedChecks } from './checks.js';

export const speedModule: ModuleDefinition = { name: 'speed', checks: speedChecks };
