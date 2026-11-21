import type { AuditDeps } from '../audit/deps.js';
import { CrawlError } from '../crawler/hosts.js';
import { InputError } from '../crawler/url.js';
import { ConfigError } from '../config/validate.js';
import { runAudit } from './commands/audit.js';
import { runCompare } from './commands/compare.js';
import { EXIT_OK, EXIT_USAGE, type CommandContext } from './commands/context.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runFix } from './commands/fix.js';
import { runInit } from './commands/init.js';
import { runList } from './commands/list.js';
import { runRecheck } from './commands/recheck.js';
import { runVerify } from './commands/verify.js';
import { buildHelp } from './help.js';
import { processIo, withRedaction, type Io } from './io.js';
import { parseCliArgs, UsageError } from './parse.js';
import type { CommandName } from './params.js';
import { readVersion } from './version.js';

type Handler = (context: CommandContext) => number | Promise<number>;

const HANDLERS: Readonly<Record<CommandName, Handler>> = {
  audit: runAudit,
  init: runInit,
  doctor: runDoctorCommand,
  fix: runFix,
  verify: runVerify,
  recheck: runRecheck,
  compare: runCompare,
  list: runList,
};

/** Runs the CLI and returns the exit code. Output goes through `io` with the API key redacted. */
export async function run(
  argv: readonly string[],
  io: Io = processIo,
  env: NodeJS.ProcessEnv = process.env,
  deps: AuditDeps = {},
): Promise<number> {
  const safeIo = withRedaction(io, env);
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
      safeIo.stdout(buildHelp(readVersion()));
      return EXIT_OK;
    }
    if (parsed.version) {
      safeIo.stdout(`${readVersion()}\n`);
      return EXIT_OK;
    }
    return await HANDLERS[parsed.command]({
      parsed,
      io: safeIo,
      version: readVersion(),
      deps,
      env,
    });
  } catch (error) {
    if (
      error instanceof UsageError ||
      error instanceof ConfigError ||
      error instanceof CrawlError ||
      error instanceof InputError
    ) {
      safeIo.stderr(`Error: ${error.message}\nRun "cwa --help" for usage.\n`);
      return EXIT_USAGE;
    }
    safeIo.stderr('Error: something unexpected went wrong.\n');
    return EXIT_USAGE;
  }
}
