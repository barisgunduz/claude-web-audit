import { parseArgs } from 'node:util';
import { isModuleName, MODULE_NAMES, type ModuleName } from '../modules/names.js';
import {
  COMMANDS,
  PARAMS,
  SUBCOMMAND_NAMES,
  type CliOptions,
  type CommandName,
  type ParamSpec,
  type SubcommandName,
} from './params.js';

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export interface ParsedArgs {
  command: CommandName;
  /** Positional arguments after the command name, such as the domain. */
  args: string[];
  /** Only the options that were given on the command line. */
  options: Partial<CliOptions>;
  help: boolean;
  version: boolean;
}

type OptionValue = string | number | boolean | ModuleName[];

function fail(message: string): never {
  throw new UsageError(message);
}

function parseValue(spec: ParamSpec, raw: string): OptionValue {
  const flag = `--${spec.flag}`;
  switch (spec.kind) {
    case 'string': {
      if (raw === '' && spec.allowEmpty !== true) fail(`${flag} needs a value.`);
      if (spec.pattern && !spec.pattern.test(raw)) {
        fail(`${flag} expects ${spec.patternHint ?? 'a different format'}, got "${raw}".`);
      }
      return raw;
    }
    case 'integer': {
      const min = spec.min ?? 0;
      const max = spec.max ?? Number.MAX_SAFE_INTEGER;
      const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(value) || value < min || value > max) {
        fail(`${flag} expects a whole number from ${min} to ${max}, got "${raw}".`);
      }
      return value;
    }
    case 'enum': {
      const values = spec.values ?? [];
      if (!values.includes(raw)) fail(`${flag} expects one of ${values.join(', ')}, got "${raw}".`);
      return raw;
    }
    case 'list': {
      const items = raw.split(',').map((item) => item.trim());
      const unknown = items.find((item) => !isModuleName(item));
      if (unknown !== undefined) {
        fail(`${flag} has an unknown module "${unknown}". Modules: ${MODULE_NAMES.join(', ')}.`);
      }
      return [...new Set(items)] as ModuleName[];
    }
    case 'switch':
      return spec.switchValue ?? true;
  }
}

function isSubcommand(value: string | undefined): value is SubcommandName {
  return (SUBCOMMAND_NAMES as readonly (string | undefined)[]).includes(value);
}

function readSpecs(): Record<string, { type: 'string' | 'boolean'; short?: string }> {
  const specs: Record<string, { type: 'string' | 'boolean'; short?: string }> = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  };
  for (const spec of PARAMS) {
    specs[spec.flag] = { type: spec.kind === 'switch' ? 'boolean' : 'string' };
  }
  return specs;
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: readSpecs(),
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid arguments.';
    const firstSentence = message.split('. ')[0] ?? message;
    return fail(firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`);
  }

  const options: Record<string, OptionValue> = {};
  for (const spec of PARAMS) {
    const raw = (parsed.values as Record<string, string | boolean | undefined>)[spec.flag];
    if (raw === undefined) continue;
    const value = parseValue(spec, typeof raw === 'string' ? raw : '');
    const previous = options[spec.key];
    if (spec.kind === 'switch' && previous !== undefined && previous !== value) {
      fail('--card and --no-card cannot be used together.');
    }
    options[spec.key] = value;
  }

  const [first, ...rest] = parsed.positionals;
  const command: CommandName = isSubcommand(first) ? first : 'audit';
  const args = command === 'audit' ? parsed.positionals : rest;

  const spec = COMMANDS.find((candidate) => candidate.name === command);
  if (spec && (args.length < spec.minArgs || args.length > spec.maxArgs)) {
    const needed =
      spec.minArgs === spec.maxArgs ? `${spec.minArgs}` : `${spec.minArgs} to ${spec.maxArgs}`;
    fail(`"${command}" takes ${needed} argument(s). Usage: ${spec.usage}`);
  }

  return {
    command,
    args,
    options,
    help: parsed.values.help === true,
    version: parsed.values.version === true,
  };
}
