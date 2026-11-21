import type { Check } from '../model/check.js';
import type { ModuleName } from './names.js';

export interface ModuleDefinition {
  name: ModuleName;
  checks: readonly Check[];
  /** Set for a module that cannot run yet. It then reports not_measured with this reason. */
  notMeasuredReason?: string;
}
