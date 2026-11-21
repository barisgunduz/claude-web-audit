import { describe, expect, it } from 'vitest';
import type { Check } from '../../src/model/check.js';
import { MODULES } from '../../src/modules/registry.js';
import { runModule, UnknownCodeError } from '../../src/modules/runner.js';
import { makeFinding } from '../../src/checks/support.js';
import { makeContext, makeCrawl } from '../support/builders.js';

const check = (overrides: Partial<Check>): Check => ({
  id: 't.check',
  module: 'links',
  codes: ['LINK-001'],
  run: () => Promise.resolve({ findings: [] }),
  ...overrides,
});
const context = makeContext(makeCrawl());

describe('runModule', () => {
  it('is measured when every check succeeds', async () => {
    const found = makeFinding('links', 'LINK-001', 'important', ['u']);
    const result = await runModule(
      {
        name: 'links',
        checks: [check({ run: () => Promise.resolve({ findings: [found], facts: { n: 1 } }) })],
      },
      context,
    );
    expect(result).toEqual({
      module: 'links',
      status: 'measured',
      findings: [found],
      facts: { n: 1 },
    });
  });

  it('is partial when one check fails or is not measured, and keeps the others', async () => {
    const found = makeFinding('links', 'LINK-001', 'important', ['u']);
    const result = await runModule(
      {
        name: 'links',
        checks: [
          check({ id: 'a', run: () => Promise.resolve({ findings: [found] }) }),
          check({ id: 'b', run: () => Promise.reject(new Error('boom')) }),
          check({ id: 'c', run: () => Promise.resolve({ findings: [], notMeasured: 'no data' }) }),
        ],
      },
      context,
    );
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('b: boom; c: no data');
    expect(result.findings).toEqual([found]);
  });

  it('is not measured when no check could measure anything', async () => {
    const result = await runModule(
      { name: 'links', checks: [check({ run: () => Promise.reject(new Error('down')) })] },
      context,
    );
    expect(result.status).toBe('not_measured');
  });

  it('rejects a finding code that the check did not declare', async () => {
    const rogue = check({
      run: () => Promise.resolve({ findings: [makeFinding('links', 'LINK-999', 'important', [])] }),
    });
    await expect(runModule({ name: 'links', checks: [rogue] }, context)).rejects.toBeInstanceOf(
      UnknownCodeError,
    );
  });

  it('says not measured for speed and a11y when there is no lab data, no pages and no axe', async () => {
    const speed = await runModule(MODULES.speed, context);
    expect(speed.status).toBe('not_measured');
    const a11y = await runModule(MODULES.a11y, context);
    expect(a11y).toMatchObject({ status: 'not_measured', findings: [] });
    expect(a11y.reason).toContain('cwa doctor');
  });
});

describe('makeFinding', () => {
  it('cuts evidence to ten items and keeps the real count', () => {
    const finding = makeFinding(
      'links',
      'LINK-001',
      'important',
      Array.from({ length: 25 }, (_, index) => `u${index}`),
    );
    expect(finding.evidence).toHaveLength(10);
    expect(finding.data.count).toBe(25);
  });
});
