import { readFileSync } from 'node:fs';
import { formatDoctor, runDoctor } from '../../doctor/index.js';
import { loadConfigFile } from '../../config/load.js';
import { DEFAULTS } from '../params.js';
import { EXIT_OK, EXIT_USAGE, type CommandContext } from './context.js';

function nodeRange(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as {
    engines?: { node?: unknown };
  };
  return typeof manifest.engines?.node === 'string' ? manifest.engines.node : '>=22.19';
}

export async function runDoctorCommand({ parsed, io, env, deps }: CommandContext): Promise<number> {
  const explicit = parsed.options.config;
  const config = await loadConfigFile(explicit ?? DEFAULTS.config, explicit !== undefined);
  const setting = parsed.options.engine ?? DEFAULTS.engine;
  const result = await runDoctor(setting, {
    env,
    nodeRange: nodeRange(),
    chromePath: config.chromePath,
    ...deps.doctor,
  });
  io.stdout(`${formatDoctor(setting, result).join('\n')}\n`);
  return result.ready ? EXIT_OK : EXIT_USAGE;
}
