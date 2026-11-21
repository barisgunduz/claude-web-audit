import type { ModuleName } from '../modules/names.js';

export const ENGINES = ['auto', 'psi', 'lighthouse'] as const;
export type Engine = (typeof ENGINES)[number];

export const STRATEGIES = ['mobile', 'desktop', 'both'] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Every option the audit command accepts, after parsing. */
export interface CliOptions {
  lang: string;
  by: string;
  pages: number;
  only: ModuleName[] | undefined;
  skip: ModuleName[];
  engine: Engine;
  strategy: Strategy;
  runs: number;
  compare: string | undefined;
  card: boolean;
  social: boolean;
  pdf: boolean;
  fixPlan: boolean;
  out: string;
  config: string;
  delay: number;
  failUnder: number | undefined;
  verbose: boolean;
}

export const DEFAULTS: Readonly<CliOptions> = {
  lang: 'en',
  by: '',
  pages: 150,
  only: undefined,
  skip: [],
  engine: 'auto',
  strategy: 'both',
  runs: 3,
  compare: undefined,
  card: true,
  social: false,
  pdf: true,
  fixPlan: true,
  out: './audits',
  config: 'cwa.config.json',
  delay: 250,
  failUnder: undefined,
  verbose: false,
};

export type ParamKind = 'string' | 'integer' | 'list' | 'enum' | 'switch';

export interface ParamSpec {
  /** Flag name without the leading dashes. */
  readonly flag: string;
  /** Key in CliOptions that this flag sets. */
  readonly key: keyof CliOptions;
  readonly kind: ParamKind;
  readonly description: string;
  /** Placeholder shown in help, for flags that take a value. */
  readonly valueName?: string;
  /** Allowed values, for the enum kind. */
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  /** Value assigned to the key when a switch is present. */
  readonly switchValue?: boolean;
  readonly allowEmpty?: boolean;
  readonly pattern?: RegExp;
  readonly patternHint?: string;
}

export const PARAMS = [
  {
    flag: 'lang',
    key: 'lang',
    kind: 'string',
    valueName: 'code',
    description: 'Language of report, card and social slides',
    pattern: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/,
    patternHint: 'a language code such as en or tr',
  },
  {
    flag: 'by',
    key: 'by',
    kind: 'string',
    valueName: 'name',
    description: 'Name shown as "prepared by" on the cover and footer, omitted when empty',
    allowEmpty: true,
  },
  {
    flag: 'pages',
    key: 'pages',
    kind: 'integer',
    valueName: 'n',
    description: 'Maximum pages to crawl',
    min: 1,
    max: 100_000,
  },
  {
    flag: 'only',
    key: 'only',
    kind: 'list',
    valueName: 'a,b',
    description: 'Run only these modules',
  },
  {
    flag: 'skip',
    key: 'skip',
    kind: 'list',
    valueName: 'a,b',
    description: 'Skip these modules',
  },
  {
    flag: 'engine',
    key: 'engine',
    kind: 'enum',
    valueName: 'name',
    values: ENGINES,
    description: 'Speed engine, auto uses psi if PSI_API_KEY is set and local Lighthouse otherwise',
  },
  {
    flag: 'strategy',
    key: 'strategy',
    kind: 'enum',
    valueName: 'name',
    values: STRATEGIES,
    description: 'Device strategy for speed measurement',
  },
  {
    flag: 'runs',
    key: 'runs',
    kind: 'integer',
    valueName: 'n',
    description: 'Speed measurement repeats, the median is used',
    min: 1,
    max: 20,
  },
  {
    flag: 'compare',
    key: 'compare',
    kind: 'string',
    valueName: 'last|path',
    description: 'Compare with the previous audit, or with the audit in a folder path',
  },
  {
    flag: 'card',
    key: 'card',
    kind: 'switch',
    switchValue: true,
    description: 'Write the one-screen summary card',
  },
  {
    flag: 'no-card',
    key: 'card',
    kind: 'switch',
    switchValue: false,
    description: 'Do not write the summary card',
  },
  {
    flag: 'social',
    key: 'social',
    kind: 'switch',
    switchValue: true,
    description: 'Write three 4:5 social images',
  },
  {
    flag: 'no-pdf',
    key: 'pdf',
    kind: 'switch',
    switchValue: false,
    description: 'Write only audit.json and FIX_PLAN.md',
  },
  {
    flag: 'no-fix-plan',
    key: 'fixPlan',
    kind: 'switch',
    switchValue: false,
    description: 'Do not write FIX_PLAN.md',
  },
  {
    flag: 'out',
    key: 'out',
    kind: 'string',
    valueName: 'dir',
    description: 'Output folder',
  },
  {
    flag: 'config',
    key: 'config',
    kind: 'string',
    valueName: 'file',
    description: 'Config file',
  },
  {
    flag: 'delay',
    key: 'delay',
    kind: 'integer',
    valueName: 'ms',
    description: 'Wait between requests in milliseconds',
    min: 0,
    max: 60_000,
  },
  {
    flag: 'fail-under',
    key: 'failUnder',
    kind: 'integer',
    valueName: 'n',
    description: 'Exit with an error code if the total score is below n (for CI)',
    min: 0,
    max: 100,
  },
  {
    flag: 'verbose',
    key: 'verbose',
    kind: 'switch',
    switchValue: true,
    description: 'Print detailed logs',
  },
] as const satisfies readonly ParamSpec[];

export const SUBCOMMAND_NAMES = [
  'init',
  'doctor',
  'fix',
  'verify',
  'recheck',
  'compare',
  'list',
] as const;
export type SubcommandName = (typeof SUBCOMMAND_NAMES)[number];
export type CommandName = SubcommandName | 'audit';

export interface CommandSpec {
  readonly name: CommandName;
  readonly usage: string;
  readonly description: string;
  readonly minArgs: number;
  readonly maxArgs: number;
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'audit',
    usage: 'cwa <domain> [options]',
    description: 'Audit a website',
    minArgs: 0,
    maxArgs: 1,
  },
  {
    name: 'init',
    usage: 'cwa init',
    description: 'Create the config file by asking for domain, name, language and page limit',
    minArgs: 0,
    maxArgs: 0,
  },
  {
    name: 'doctor',
    usage: 'cwa doctor',
    description: 'Check the environment and name what is missing',
    minArgs: 0,
    maxArgs: 0,
  },
  {
    name: 'fix',
    usage: 'cwa fix [audit]',
    description: 'Work through FIX_PLAN.md task by task',
    minArgs: 0,
    maxArgs: 1,
  },
  {
    name: 'verify',
    usage: 'cwa verify <task-id>',
    description: 'Re-measure the acceptance criteria of one task',
    minArgs: 1,
    maxArgs: 1,
  },
  {
    name: 'recheck',
    usage: 'cwa recheck [domain]',
    description: 'Re-run the audit with the same settings and compare it with the previous one',
    minArgs: 0,
    maxArgs: 1,
  },
  {
    name: 'compare',
    usage: 'cwa compare <a> <b>',
    description: 'Compare two stored audits',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'list',
    usage: 'cwa list [domain]',
    description: 'List stored audits for a domain',
    minArgs: 0,
    maxArgs: 1,
  },
];

/** Text for the default column in help and docs, for example "150", "off" or "none". */
export function describeDefault(spec: ParamSpec): string {
  if (spec.kind === 'switch') {
    return spec.switchValue === DEFAULTS[spec.key] ? 'on' : 'off';
  }
  const value = DEFAULTS[spec.key];
  if (spec.key === 'only') return 'all';
  if (value === undefined) return 'none';
  if (Array.isArray(value)) return value.length > 0 ? value.join(',') : 'none';
  if (value === '') return 'empty';
  return String(value);
}
