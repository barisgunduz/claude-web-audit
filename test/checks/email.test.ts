import { describe, expect, it } from 'vitest';
import { emailChecks } from '../../src/modules/email/checks.js';
import { analyzeSpf, SPF_LOOKUP_LIMIT } from '../../src/modules/email/spf.js';
import { emailModule } from '../../src/modules/email/index.js';
import { runModule } from '../../src/modules/runner.js';
import type { Check } from '../../src/model/check.js';
import { codesOf, fakeDns, makeContext, makeCrawl, makeSettings } from '../support/builders.js';

function check(id: string): Check {
  const found = emailChecks.find((candidate) => candidate.id === `email.${id}`);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}
const txt = (records: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(records).map(([name, list]) => [name, list.map((record) => [record])]),
  );
const context = (records: Parameters<typeof fakeDns>[0], settings = makeSettings()) =>
  makeContext(makeCrawl(), { dns: fakeDns(records), settings });

describe('email.spf', () => {
  // Each record is a list of TXT strings, because DNS can split a long record into parts.
  const one = (record: string): string[] => [record];
  it.each([
    ['no record', {}, ['EML-001']],
    ['two records', { 'example.test': [one('v=spf1 -all'), one('v=spf1 ~all')] }, ['EML-002']],
    [
      'a valid record',
      {
        'example.test': [one('v=spf1 mx include:_spf.mail.test ~all')],
        '_spf.mail.test': [one('v=spf1 ip4:192.0.2.1 -all')],
      },
      [],
    ],
    [
      'an invalid term',
      { 'example.test': [one('v=spf1 bogus:thing ip4:999.1.1.1 -all')] },
      ['EML-003'],
    ],
    ['a pass-all qualifier', { 'example.test': [one('v=spf1 +all')] }, ['EML-005']],
    ['a neutral all', { 'example.test': [one('v=spf1 mx ?all')] }, ['EML-005']],
    ['a bare all', { 'example.test': [one('v=spf1 all')] }, ['EML-005']],
    ['no all term', { 'example.test': [one('v=spf1 mx')] }, ['EML-005']],
    [
      'a redirect instead of all',
      {
        'example.test': [one('v=spf1 redirect=_spf.mail.test')],
        '_spf.mail.test': [one('v=spf1 -all')],
      },
      [],
    ],
    ['a record split in two strings', { 'example.test': [['v=spf1 mx ', '-all']] }, []],
  ] as const)('%s', async (_name, records, expected) => {
    const result = await check('spf').run(
      context({ txt: records as unknown as Record<string, string[][]> }),
    );
    expect(codesOf(result.findings)).toEqual(expected);
  });

  it('counts DNS lookups through includes and flags more than ten', async () => {
    const includes = Array.from({ length: 11 }, (_, index) => `include:i${index}.test`).join(' ');
    const dns = fakeDns({ txt: txt({ 'example.test': [`v=spf1 ${includes} -all`] }) });
    expect((await analyzeSpf(dns, `v=spf1 ${includes} -all`)).lookups).toBe(11);
    const result = await check('spf').run(
      context({ txt: txt({ 'example.test': [`v=spf1 ${includes} -all`] }) }),
    );
    expect(codesOf(result.findings)).toEqual(['EML-004']);
    expect(result.findings[0]?.data).toMatchObject({ lookups: 11, limit: SPF_LOOKUP_LIMIT });
  });

  it('accepts exactly ten lookups, and counts nested includes', async () => {
    const ten = Array.from({ length: 10 }, (_, index) => `include:i${index}.test`).join(' ');
    expect(
      codesOf(
        (await check('spf').run(context({ txt: txt({ 'example.test': [`v=spf1 ${ten} -all`] }) })))
          .findings,
      ),
    ).toEqual([]);
    const dns = fakeDns({
      txt: txt({ 'a.test': ['v=spf1 include:b.test mx -all'], 'b.test': ['v=spf1 a ptr -all'] }),
    });
    expect((await analyzeSpf(dns, 'v=spf1 include:a.test -all')).lookups).toBe(5);
  });

  it('does not loop on circular includes', async () => {
    const dns = fakeDns({
      txt: txt({
        'a.test': ['v=spf1 include:b.test -all'],
        'b.test': ['v=spf1 include:a.test -all'],
      }),
    });
    expect((await analyzeSpf(dns, 'v=spf1 include:a.test -all')).lookups).toBe(3);
  });

  it('turns a DNS failure into not measured, never a finding', async () => {
    const result = await check('spf').run(context({ fail: true }));
    expect(result.findings).toEqual([]);
    expect(result.notMeasured).toBeDefined();
  });
});

describe('email.dmarc', () => {
  const run = (record: string[] | undefined) =>
    check('dmarc').run(context({ txt: record ? txt({ '_dmarc.example.test': record }) : {} }));
  it.each([
    ['no record', undefined, ['EML-006']],
    ['two records', ['v=DMARC1; p=reject', 'v=DMARC1; p=none'], ['EML-010']],
    ['no p tag', ['v=DMARC1; rua=mailto:a@example.test'], ['EML-010']],
    ['an unknown policy', ['v=DMARC1; p=allow'], ['EML-010']],
    ['policy none without rua', ['v=DMARC1; p=none'], ['EML-007', 'EML-008']],
    ['reject with rua', ['v=DMARC1; p=reject; rua=mailto:a@example.test'], []],
    ['partial pct', ['v=DMARC1; p=quarantine; rua=mailto:a@example.test; pct=50'], ['EML-009']],
    ['pct 100', ['v=DMARC1; p=quarantine; rua=mailto:a@example.test; pct=100'], []],
  ] as const)('%s', async (_name, record, expected) => {
    expect(codesOf((await run(record ? [...record] : undefined)).findings)).toEqual(expected);
  });
  it('says not measured when DNS fails', async () => {
    expect((await check('dmarc').run(context({ fail: true }))).notMeasured).toBeDefined();
  });
});

describe('email.mx', () => {
  it('flags a domain with no MX and accepts one with a record or a null MX', async () => {
    expect(codesOf((await check('mx').run(context({}))).findings)).toEqual(['EML-011']);
    expect(
      (
        await check('mx').run(
          context({ mx: { 'example.test': [{ exchange: 'mail.test', priority: 10 }] } }),
        )
      ).findings,
    ).toEqual([]);
    const nullMx = await check('mx').run(
      context({ mx: { 'example.test': [{ exchange: '', priority: 0 }] } }),
    );
    expect(nullMx.findings).toEqual([]);
    expect(nullMx.facts).toEqual({ mxRecords: 0 });
  });
});

describe('email.dkim', () => {
  it('is not measured without selectors', async () => {
    const result = await check('dkim').run(context({}));
    expect(result.notMeasured).toContain('no selectors');
    expect(result.facts).toEqual({ dkim: 'not_measured' });
  });
  it('checks each selector', async () => {
    const settings = makeSettings({ dkimSelectors: ['good', 'bad'] });
    const result = await check('dkim').run(
      context(
        {
          txt: txt({
            'good._domainkey.example.test': ['v=DKIM1; k=rsa; p=ABC'],
            'bad._domainkey.example.test': ['v=DKIM1; p='],
          }),
        },
        settings,
      ),
    );
    expect(result.findings[0]).toMatchObject({
      code: 'EML-012',
      evidence: ['bad._domainkey.example.test'],
    });
  });
});

describe('email module status', () => {
  it('is partial when only DKIM is not measured, and not_measured when all DNS lookups fail', async () => {
    const records = {
      'example.test': [['v=spf1 -all']],
      '_dmarc.example.test': [['v=DMARC1; p=reject; rua=mailto:a@example.test']],
    };
    const ok = await runModule(
      emailModule,
      makeContext(makeCrawl(), {
        dns: fakeDns({
          txt: records,
          mx: { 'example.test': [{ exchange: 'm.test', priority: 1 }] },
        }),
      }),
    );
    expect(ok.status).toBe('partial');
    expect(ok.reason).toContain('DKIM');
    const down = await runModule(
      emailModule,
      makeContext(makeCrawl(), { dns: fakeDns({ fail: true }) }),
    );
    expect(down.status).toBe('not_measured');
    expect(down.findings).toEqual([]);
  });
  it('uses the host without www for lookups', async () => {
    const crawl = makeCrawl({ host: { ...makeCrawl().host, canonicalHost: 'www.example.test' } });
    const result = await check('mx').run(
      makeContext(crawl, {
        dns: fakeDns({ mx: { 'example.test': [{ exchange: 'm.test', priority: 1 }] } }),
      }),
    );
    expect(result.findings).toEqual([]);
  });
});
