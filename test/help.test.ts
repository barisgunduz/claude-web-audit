import { describe, expect, it } from 'vitest';
import { buildHelp } from '../src/cli/help.js';
import { COMMANDS, describeDefault, PARAMS } from '../src/cli/params.js';

describe('buildHelp', () => {
  const help = buildHelp('1.2.3');

  it('starts with the version', () => {
    expect(help.startsWith('cwa 1.2.3\n')).toBe(true);
  });

  it('mentions every flag and subcommand from the params table', () => {
    for (const spec of PARAMS) expect(help).toContain(`--${spec.flag}`);
    for (const command of COMMANDS) expect(help).toContain(command.usage.replace(/^cwa /, ''));
  });

  it('prints defaults from the table', () => {
    expect(help).toContain('Maximum pages to crawl (default: 150)');
    expect(help).toContain('Run only these modules (default: all)');
    expect(help).toContain('Do not write FIX_PLAN.md (default: off)');
  });

  it('describes defaults in the words used by SCOPE.md', () => {
    const byFlag = (flag: string): string => {
      const spec = PARAMS.find((candidate) => candidate.flag === flag);
      if (!spec) throw new Error(`Missing flag ${flag}`);
      return describeDefault(spec);
    };
    expect(byFlag('card')).toBe('on');
    expect(byFlag('no-card')).toBe('off');
    expect(byFlag('by')).toBe('empty');
    expect(byFlag('compare')).toBe('none');
    expect(byFlag('skip')).toBe('none');
    expect(byFlag('out')).toBe('./audits');
  });

  it('documents PSI_API_KEY without a value', () => {
    expect(help).toContain('PSI_API_KEY');
  });
});
