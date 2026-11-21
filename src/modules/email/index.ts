import type { ModuleDefinition } from '../types.js';
import { emailChecks } from './checks.js';

export const emailModule: ModuleDefinition = { name: 'email', checks: emailChecks };
