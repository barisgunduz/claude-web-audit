import { describe, expect, it } from 'vitest';
import { COMMANDS, DEFAULTS, PARAMS, SUBCOMMAND_NAMES } from '../src/cli/params.js';
import { parseCliArgs, UsageError } from '../src/cli/parse.js';

describe('params table', () => {
  it('has unique flags', () => {
    const flags = PARAMS.map((spec) => spec.flag);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('covers every option key', () => {
    const keys = new Set<string>(PARAMS.map((spec) => spec.key));
    expect([...keys].sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it('uses the defaults from SCOPE.md', () => {
    expect(DEFAULTS).toMatchObject({
      lang: 'en',
      by: '',
      pages: 150,
      engine: 'auto',
      strategy: 'both',
      runs: 3,
      card: true,
      social: false,
      pdf: true,
      fixPlan: true,
      out: './audits',
      config: 'cwa.config.json',
      delay: 250,
      verbose: false,
    });
    expect(DEFAULTS.only).toBeUndefined();
    expect(DEFAULTS.compare).toBeUndefined();
    expect(DEFAULTS.failUnder).toBeUndefined();
  });

  it('lists every subcommand once', () => {
    const names = COMMANDS.map((command) => command.name);
    expect(names).toEqual(['audit', ...SUBCOMMAND_NAMES]);
  });
});

describe('parseCliArgs', () => {
  it('treats a bare domain as the audit command', () => {
    const parsed = parseCliArgs(['example.com']);
    expect(parsed.command).toBe('audit');
    expect(parsed.args).toEqual(['example.com']);
    expect(parsed.options).toEqual({});
  });

  it('parses every kind of option', () => {
    const parsed = parseCliArgs([
      'example.com',
      '--lang',
      'tr',
      '--by',
      'Example Studio',
      '--pages=40',
      '--only',
      'seo,speed,seo',
      '--skip',
      'email',
      '--engine',
      'lighthouse',
      '--strategy',
      'mobile',
      '--runs',
      '5',
      '--compare',
      'last',
      '--no-card',
      '--social',
      '--no-pdf',
      '--no-fix-plan',
      '--out',
      'reports',
      '--config',
      'my.json',
      '--delay',
      '0',
      '--fail-under',
      '80',
      '--verbose',
    ]);
    expect(parsed.options).toEqual({
      lang: 'tr',
      by: 'Example Studio',
      pages: 40,
      only: ['seo', 'speed'],
      skip: ['email'],
      engine: 'lighthouse',
      strategy: 'mobile',
      runs: 5,
      compare: 'last',
      card: false,
      social: true,
      pdf: false,
      fixPlan: false,
      out: 'reports',
      config: 'my.json',
      delay: 0,
      failUnder: 80,
      verbose: true,
    });
  });

  it('allows an empty --by', () => {
    expect(parseCliArgs(['example.com', '--by', '']).options.by).toBe('');
  });

  it('routes subcommands and keeps their arguments', () => {
    expect(parseCliArgs(['verify', 'T-014'])).toMatchObject({ command: 'verify', args: ['T-014'] });
    expect(parseCliArgs(['compare', 'a', 'b']).args).toEqual(['a', 'b']);
    expect(parseCliArgs(['--lang', 'tr', 'list']).command).toBe('list');
  });

  it.each([
    [['example.com', '--pages', 'abc'], '--pages expects a whole number'],
    [['example.com', '--pages', '0'], '--pages expects a whole number'],
    [['example.com', '--runs', '-1'], '--runs'],
    [['example.com', '--fail-under', '101'], '--fail-under expects a whole number from 0 to 100'],
    [['example.com', '--engine', 'chrome'], '--engine expects one of auto, psi, lighthouse'],
    [['example.com', '--strategy', 'tablet'], '--strategy expects one of mobile, desktop, both'],
    [['example.com', '--only', 'seo,nope'], 'unknown module "nope"'],
    [['example.com', '--lang', 'english!'], '--lang expects a language code'],
    [['example.com', '--card', '--no-card'], 'cannot be used together'],
    [['example.com', '--unknown'], "Unknown option '--unknown'"],
    [['example.com', '--pages'], 'argument missing'],
    [['verify'], '"verify" takes 1 argument(s)'],
    [['compare', 'a'], '"compare" takes 2 argument(s)'],
    [['init', 'extra'], '"init" takes 0 argument(s)'],
    [['a.com', 'b.com'], '"audit" takes 0 to 1 argument(s)'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
