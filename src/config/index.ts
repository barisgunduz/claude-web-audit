export {
  DEFAULT_A11Y_PAGES,
  DEFAULT_CONCURRENCY,
  DEFAULT_SPEED_PAGES,
  DEFAULT_THIN_CONTENT_WORDS,
  DEFAULT_WEIGHTS,
  MAX_A11Y_PAGES,
  MAX_SPEED_PAGES,
} from './defaults.js';
export { loadConfigFile } from './load.js';
export { resolveSettings } from './resolve.js';
export type { CwaConfig, EmailConfig, OutputsConfig, Settings } from './types.js';
export { ConfigError, validateConfig } from './validate.js';
