import { runAudit as runAuditPipeline } from '../../audit/run.js';
import { buildSummary, writeAuditJson } from '../../audit/output.js';
import { loadConfigFile } from '../../config/load.js';
import { resolveSettings } from '../../config/resolve.js';
import { DEFAULTS } from '../params.js';
import { EXIT_OK, type CommandContext } from './context.js';

export async function runAudit({
  parsed,
  io,
  version,
  deps,
  env,
}: CommandContext): Promise<number> {
  const explicitConfig = parsed.options.config;
  const config = await loadConfigFile(
    explicitConfig ?? DEFAULTS.config,
    explicitConfig !== undefined,
  );
  const settings = resolveSettings(config, parsed.options, parsed.args[0]);

  // Ctrl+C stops the crawl, and the findings so far are still written.
  const controller = new AbortController();
  const onInterrupt = (): void => {
    controller.abort();
  };
  if (!deps.signal) process.once('SIGINT', onInterrupt);

  try {
    const log =
      parsed.options.verbose === true
        ? (message: string) => {
            io.stderr(`${message}\n`);
          }
        : undefined;
    const run = await runAuditPipeline({
      settings,
      version,
      deps: { signal: controller.signal, env, ...deps },
      notice: (message) => {
        io.stderr(`${message}\n`);
      },
      ...(log && { log }),
    });
    const now = deps.now?.() ?? new Date();
    const file = await writeAuditJson(run, settings, version, deps.cwd ?? process.cwd(), now);
    io.stdout(`${buildSummary(run, file).join('\n')}\n`);
    return EXIT_OK;
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}
