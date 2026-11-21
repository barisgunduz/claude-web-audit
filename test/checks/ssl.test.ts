import { describe, expect, it } from 'vitest';
import { daysUntil, evaluateTls } from '../../src/modules/ssl/evaluate.js';
import { sslChecks } from '../../src/modules/ssl/checks.js';
import type { Check } from '../../src/model/check.js';
import type { VariantProbe } from '../../src/model/crawl.js';
import {
  codesOf,
  goodTls,
  makeContext,
  makeCrawl,
  makePage,
  NOW,
  ORIGIN,
  pageHtml,
} from '../support/builders.js';

function check(id: string): Check {
  const found = sslChecks.find((candidate) => candidate.id === `ssl.${id}`);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}
const daysFromNow = (days: number): string =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('evaluateTls', () => {
  it.each([
    ['a healthy certificate', {}, []],
    ['an expired certificate', { validTo: daysFromNow(-1) }, ['SSL-003']],
    ['6 days left', { validTo: daysFromNow(6.5) }, ['SSL-004']],
    ['29 days left', { validTo: daysFromNow(29.5) }, ['SSL-005']],
    ['30 days left', { validTo: daysFromNow(30.5) }, []],
    ['a hostname that is not in the SAN list', { hostnameMatches: false }, ['SSL-006']],
    [
      'an incomplete chain',
      { authorized: false, authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
      ['SSL-007'],
    ],
    [
      'a self-signed certificate',
      { authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      ['SSL-007'],
    ],
    [
      'an error that other findings cover',
      { authorized: false, authorizationError: 'CERT_HAS_EXPIRED', validTo: daysFromNow(-5) },
      ['SSL-003'],
    ],
    ['TLS 1.1', { protocol: 'TLSv1.1' }, ['SSL-008']],
    ['TLS 1.2', { protocol: 'TLSv1.2' }, []],
  ] as const)('%s', (_name, overrides, expected) => {
    expect(codesOf(evaluateTls(goodTls(overrides), NOW))).toEqual(expected);
  });

  it('makes expiry and self-signed findings critical', () => {
    expect(evaluateTls(goodTls({ validTo: daysFromNow(3) }), NOW)[0]?.severity).toBe('critical');
    expect(evaluateTls(goodTls({ validTo: daysFromNow(20) }), NOW)[0]?.severity).toBe('important');
    expect(
      evaluateTls(
        goodTls({ authorized: false, authorizationError: 'SELF_SIGNED_CERT_IN_CHAIN' }),
        NOW,
      )[0]?.severity,
    ).toBe('critical');
    expect(
      evaluateTls(
        goodTls({ authorized: false, authorizationError: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }),
        NOW,
      )[0]?.severity,
    ).toBe('important');
  });

  it('reports an unreachable TLS endpoint as critical', () => {
    const findings = evaluateTls(goodTls({ reachable: false, error: 'ECONNREFUSED' }), NOW);
    expect(findings).toMatchObject([
      { code: 'SSL-002', severity: 'critical', data: { reason: 'ECONNREFUSED' } },
    ]);
  });

  it('counts whole days', () => {
    expect(daysUntil(daysFromNow(10.4), NOW)).toBe(10);
  });
});

describe('ssl.https-served', () => {
  it('is critical when the site ends on http', async () => {
    const crawl = makeCrawl({
      host: { ...makeCrawl().host, canonicalOrigin: 'http://example.test' },
    });
    expect((await check('https-served').run(makeContext(crawl))).findings[0]).toMatchObject({
      code: 'SSL-001',
      severity: 'critical',
    });
    expect((await check('https-served').run(makeContext(makeCrawl()))).findings).toEqual([]);
  });
});

describe('ssl.certificate', () => {
  it('needs a TLS probe', async () => {
    const result = await check('certificate').run(makeContext(makeCrawl({ tls: undefined })));
    expect(result.notMeasured).toContain('not served over HTTPS');
  });

  it('adds facts for the report', async () => {
    const result = await check('certificate').run(
      makeContext(makeCrawl({ tls: goodTls({ validTo: daysFromNow(100.5) }) })),
    );
    expect(result.facts).toEqual({ tlsProtocol: 'TLSv1.3', certificateDaysRemaining: 100 });
  });
});

function variants(rows: [string, number[], string][]): VariantProbe[] {
  return rows.map(([variant, statuses, finalUrl]) => ({
    variant,
    url: variant,
    finalUrl,
    status: 200,
    loop: false,
    chain: statuses.map((status) => ({ url: variant, status, location: finalUrl })),
  }));
}
const crawlWith = (rows: [string, number[], string][], consistent = true) =>
  makeCrawl({ host: { ...makeCrawl().host, variants: variants(rows), consistent } });

describe('ssl.http-redirect', () => {
  const final = `${ORIGIN}/`;
  it('accepts permanent redirects', async () => {
    const crawl = crawlWith([
      ['http://example.test/', [301], final],
      ['http://www.example.test/', [308], final],
    ]);
    expect((await check('http-redirect').run(makeContext(crawl))).findings).toEqual([]);
  });
  it('flags temporary redirects and missing redirects', async () => {
    const crawl = crawlWith([
      ['http://example.test/', [302], final],
      ['http://www.example.test/', [], 'http://www.example.test/'],
    ]);
    expect(codesOf((await check('http-redirect').run(makeContext(crawl))).findings)).toEqual([
      'SSL-009',
      'SSL-010',
    ]);
  });
});

describe('ssl.host-variants', () => {
  it('flags variants that end on different pages and temporary redirects', async () => {
    const crawl = crawlWith(
      [
        ['https://example.test/', [], `${ORIGIN}/`],
        ['https://www.example.test/', [302], 'https://www.example.test/home'],
      ],
      false,
    );
    expect(codesOf((await check('host-variants').run(makeContext(crawl))).findings)).toEqual([
      'SSL-011',
      'SSL-012',
    ]);
  });
  it('accepts one final URL with permanent redirects', async () => {
    const crawl = crawlWith([
      ['https://example.test/', [], `${ORIGIN}/`],
      ['https://www.example.test/', [301], `${ORIGIN}/`],
    ]);
    expect((await check('host-variants').run(makeContext(crawl))).findings).toEqual([]);
  });
});

describe('ssl.mixed-content', () => {
  const page = (inner: string, url = `${ORIGIN}/`) =>
    makePage({ url, html: pageHtml({ body: inner }) });

  it('separates active and passive mixed content', async () => {
    const crawl = makeCrawl({
      pages: [
        page(
          [
            '<script src="http://cdn.test/a.js"></script>',
            '<link rel="stylesheet" href="http://cdn.test/a.css">',
            '<iframe src="http://cdn.test/f"></iframe>',
            '<form action="http://example.test/post"></form>',
            '<img src="http://cdn.test/i.png">',
            '<img srcset="http://cdn.test/1.png 1x, https://cdn.test/2.png 2x">',
            '<video poster="http://cdn.test/p.png"></video>',
            '<img src="https://cdn.test/safe.png"><a href="http://other.test/">plain link is fine</a>',
          ].join(''),
        ),
      ],
    });
    const result = await check('mixed-content').run(makeContext(crawl));
    const counts = Object.fromEntries(
      result.findings.map((finding) => [finding.code, finding.data.count]),
    );
    expect(counts).toEqual({ 'SSL-013': 4, 'SSL-014': 3 });
    expect(result.findings.find((finding) => finding.code === 'SSL-013')?.severity).toBe(
      'important',
    );
    expect(result.findings.find((finding) => finding.code === 'SSL-014')?.severity).toBe(
      'improvement',
    );
  });

  it('ignores pages that are served over http', async () => {
    const crawl = makeCrawl({
      pages: [page('<script src="http://cdn.test/a.js"></script>', 'http://example.test/')],
    });
    expect((await check('mixed-content').run(makeContext(crawl))).findings).toEqual([]);
  });
});
