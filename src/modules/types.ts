import type { Placeholder } from '../types.js';
import type { ModuleName } from './names.js';

export interface ModulePlaceholder extends Placeholder {
  readonly name: ModuleName;
}
