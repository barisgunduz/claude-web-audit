import { readFile } from 'node:fs/promises';
import type { CwaConfig } from './types.js';
import { ConfigError, validateConfig } from './validate.js';

/**
 * Reads and validates a config file. A missing file is fine when it was not asked for by name.
 * Error messages never include the file content.
 */
export async function loadConfigFile(path: string, required: boolean): Promise<CwaConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (missing && !required) return {};
    throw new ConfigError([
      missing ? `Config file not found: ${path}` : `Config file could not be read: ${path}`,
    ]);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ConfigError([`Config file is not valid JSON: ${path}`]);
  }
  return validateConfig(json);
}
