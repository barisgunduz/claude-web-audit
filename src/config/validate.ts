import { ENGINES, STRATEGIES } from '../cli/params.js';
import { isModuleName, MODULE_NAMES } from '../modules/names.js';
import { MAX_A11Y_PAGES, MAX_SPEED_PAGES } from './defaults.js';
import type { CwaConfig } from './types.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join(' '));
    this.issues = issues;
  }
}

const TOP_LEVEL_KEYS = [
  'domain',
  'pages',
  'prepared_by',
  'report_language',
  'engine',
  'strategy',
  'runs',
  'delay',
  'concurrency',
  'thinContentWords',
  'speedPages',
  'a11yPages',
  'chromePath',
  'email',
  'weights',
  'modules',
  'outputs',
] as const;
const OUTPUT_KEYS = ['card', 'social', 'pdf', 'fixPlan'] as const;
const SECRET_LIKE = /key|token|secret|password/i;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWholeNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function checkUnknownKeys(obj: Obj, allowed: readonly string[], where: string, issues: string[]) {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    issues.push(
      SECRET_LIKE.test(key)
        ? `Unknown field "${key}" in ${where}. Secrets are never read from the config file, set PSI_API_KEY in the environment instead.`
        : `Unknown field "${key}" in ${where}.`,
    );
  }
}

/** Checks the parsed JSON of a config file and returns it typed, or throws a ConfigError. */
export function validateConfig(input: unknown): CwaConfig {
  if (!isObject(input)) throw new ConfigError(['The config file must contain a JSON object.']);

  const issues: string[] = [];
  checkUnknownKeys(input, TOP_LEVEL_KEYS, 'the config file', issues);

  const { domain, pages, prepared_by, report_language, engine, strategy, runs, delay } = input;
  if (domain !== undefined && (typeof domain !== 'string' || domain.trim() === '')) {
    issues.push('"domain" must be a non-empty string.');
  }
  if (pages !== undefined && !isWholeNumber(pages, 1, 100_000)) {
    issues.push('"pages" must be a whole number from 1 to 100000.');
  }
  if (prepared_by !== undefined && typeof prepared_by !== 'string') {
    issues.push('"prepared_by" must be a string.');
  }
  if (
    report_language !== undefined &&
    (typeof report_language !== 'string' ||
      !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(report_language))
  ) {
    issues.push('"report_language" must be a language code such as en or tr.');
  }
  if (engine !== undefined && !(ENGINES as readonly unknown[]).includes(engine)) {
    issues.push(`"engine" must be one of ${ENGINES.join(', ')}.`);
  }
  if (strategy !== undefined && !(STRATEGIES as readonly unknown[]).includes(strategy)) {
    issues.push(`"strategy" must be one of ${STRATEGIES.join(', ')}.`);
  }
  if (runs !== undefined && !isWholeNumber(runs, 1, 20)) {
    issues.push('"runs" must be a whole number from 1 to 20.');
  }
  if (delay !== undefined && !isWholeNumber(delay, 0, 60_000)) {
    issues.push('"delay" must be a whole number from 0 to 60000.');
  }

  const { concurrency, thinContentWords, speedPages, a11yPages, chromePath, email } = input;
  if (concurrency !== undefined && !isWholeNumber(concurrency, 1, 8)) {
    issues.push('"concurrency" must be a whole number from 1 to 8.');
  }
  if (thinContentWords !== undefined && !isWholeNumber(thinContentWords, 1, 100_000)) {
    issues.push('"thinContentWords" must be a whole number from 1 to 100000.');
  }
  if (speedPages !== undefined && !isWholeNumber(speedPages, 1, MAX_SPEED_PAGES)) {
    issues.push(`"speedPages" must be a whole number from 1 to ${MAX_SPEED_PAGES}.`);
  }
  if (a11yPages !== undefined && !isWholeNumber(a11yPages, 1, MAX_A11Y_PAGES)) {
    issues.push(`"a11yPages" must be a whole number from 1 to ${MAX_A11Y_PAGES}.`);
  }
  if (chromePath !== undefined && (typeof chromePath !== 'string' || chromePath.trim() === '')) {
    issues.push('"chromePath" must be a non-empty string.');
  }
  if (email !== undefined) {
    if (!isObject(email)) {
      issues.push('"email" must be an object.');
    } else {
      checkUnknownKeys(email, ['dkimSelectors'], '"email"', issues);
      const selectors = email.dkimSelectors;
      const valid =
        selectors === undefined ||
        (Array.isArray(selectors) &&
          selectors.every(
            (item) => typeof item === 'string' && /^[A-Za-z0-9._-]{1,63}$/.test(item),
          ));
      if (!valid) issues.push('"email.dkimSelectors" must be a list of selector names.');
    }
  }

  const { weights, modules, outputs } = input;
  if (weights !== undefined) {
    if (!isObject(weights)) {
      issues.push('"weights" must be an object.');
    } else {
      checkUnknownKeys(weights, MODULE_NAMES, '"weights"', issues);
      for (const [name, weight] of Object.entries(weights)) {
        if (
          isModuleName(name) &&
          !(typeof weight === 'number' && Number.isFinite(weight) && weight >= 0)
        ) {
          issues.push(`Weight for "${name}" must be a number of 0 or more.`);
        }
      }
    }
  }
  if (modules !== undefined) {
    const valid =
      Array.isArray(modules) &&
      modules.length > 0 &&
      modules.every((item) => typeof item === 'string' && isModuleName(item));
    if (!valid) issues.push(`"modules" must be a non-empty list of: ${MODULE_NAMES.join(', ')}.`);
  }
  if (outputs !== undefined) {
    if (!isObject(outputs)) {
      issues.push('"outputs" must be an object.');
    } else {
      checkUnknownKeys(outputs, OUTPUT_KEYS, '"outputs"', issues);
      for (const key of OUTPUT_KEYS) {
        if (outputs[key] !== undefined && typeof outputs[key] !== 'boolean') {
          issues.push(`"outputs.${key}" must be true or false.`);
        }
      }
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);
  return input;
}
