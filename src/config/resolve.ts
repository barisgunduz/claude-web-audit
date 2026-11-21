import { DEFAULTS, type CliOptions } from '../cli/params.js';
import { MODULE_NAMES } from '../modules/names.js';
import {
  DEFAULT_A11Y_PAGES,
  DEFAULT_CONCURRENCY,
  DEFAULT_SPEED_PAGES,
  DEFAULT_THIN_CONTENT_WORDS,
  DEFAULT_WEIGHTS,
} from './defaults.js';
import type { CwaConfig, Settings } from './types.js';
import { ConfigError } from './validate.js';

function pick<T>(...candidates: readonly (T | undefined)[]): T {
  const found = candidates.find((value) => value !== undefined);
  if (found === undefined) throw new Error('No value and no default.');
  return found;
}

/**
 * Merges settings. Order of precedence: command line, config file, built-in defaults.
 * `domainArg` is the domain given on the command line.
 */
export function resolveSettings(
  config: CwaConfig,
  cli: Partial<CliOptions>,
  domainArg?: string,
): Settings {
  const domain = domainArg ?? config.domain;
  if (domain === undefined) {
    throw new ConfigError([
      'A domain is required. Pass it as an argument or set "domain" in the config file.',
    ]);
  }

  const enabled = cli.only ?? config.modules ?? [...MODULE_NAMES];
  const skipped = new Set(cli.skip ?? []);
  const modules = enabled.filter((name) => !skipped.has(name));
  if (modules.length === 0)
    throw new ConfigError(['No modules are left to run after --only and --skip.']);

  const outputs = config.outputs ?? {};
  return {
    domain,
    pages: pick(cli.pages, config.pages, DEFAULTS.pages),
    preparedBy: pick(cli.by, config.prepared_by, DEFAULTS.by),
    language: pick(cli.lang, config.report_language, DEFAULTS.lang),
    engine: pick(cli.engine, config.engine, DEFAULTS.engine),
    strategy: pick(cli.strategy, config.strategy, DEFAULTS.strategy),
    runs: pick(cli.runs, config.runs, DEFAULTS.runs),
    delay: pick(cli.delay, config.delay, DEFAULTS.delay),
    concurrency: pick(config.concurrency, DEFAULT_CONCURRENCY),
    thinContentWords: pick(config.thinContentWords, DEFAULT_THIN_CONTENT_WORDS),
    speedPages: pick(config.speedPages, DEFAULT_SPEED_PAGES),
    a11yPages: pick(config.a11yPages, DEFAULT_A11Y_PAGES),
    chromePath: config.chromePath,
    dkimSelectors: config.email?.dkimSelectors ?? [],
    weights: { ...DEFAULT_WEIGHTS, ...config.weights },
    modules,
    outputs: {
      card: pick(cli.card, outputs.card, DEFAULTS.card),
      social: pick(cli.social, outputs.social, DEFAULTS.social),
      pdf: pick(cli.pdf, outputs.pdf, DEFAULTS.pdf),
      fixPlan: pick(cli.fixPlan, outputs.fixPlan, DEFAULTS.fixPlan),
    },
    compare: cli.compare,
    out: pick(cli.out, DEFAULTS.out),
    failUnder: cli.failUnder,
    verbose: pick(cli.verbose, DEFAULTS.verbose),
  };
}
