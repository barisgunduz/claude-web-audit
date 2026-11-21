import { loadConfigFile } from '../../config/load.js';
import { resolveSettings } from '../../config/resolve.js';
import { DEFAULTS } from '../params.js';
import { reportNotImplemented, type CommandContext } from './context.js';

export async function runAudit({ parsed, io }: CommandContext): Promise<number> {
  const explicitConfig = parsed.options.config;
  const config = await loadConfigFile(
    explicitConfig ?? DEFAULTS.config,
    explicitConfig !== undefined,
  );
  resolveSettings(config, parsed.options, parsed.args[0]);
  return reportNotImplemented(io);
}
