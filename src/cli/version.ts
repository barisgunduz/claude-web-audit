import { readFileSync } from 'node:fs';

export function readVersion(): string {
  const text = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(text) as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
}
