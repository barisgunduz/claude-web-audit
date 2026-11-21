import { describe, expect, it } from 'vitest';
import {
  headersChecks,
  HSTS_MIN_SECONDS,
  parseSetCookie,
  SAMPLE_SIZE,
} from '../../src/modules/headers/checks.js';
import type { Check } from '../../src/model/check.js';
import { codesOf, makeContext, makeCrawl, makePage, ORIGIN } from '../support/builders.js';

function check(id: string): Check {
  const found = headersChecks.find((candidate) => candidate.id === `headers.${id}`);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}
const GOOD = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=()',
};
const crawlOf = (headers: Record<string, string>, setCookies: string[] = []) =>
  makeCrawl({ pages: [makePage({ url: `${ORIGIN}/`, headers, setCookies })] });

describe('headers.security-headers', () => {
  it('passes with all headers', async () => {
    expect((await check('security-headers').run(makeContext(crawlOf(GOOD)))).findings).toEqual([]);
  });

  it('flags a page without headers', async () => {
    const result = await check('security-headers').run(makeContext(crawlOf({})));
    expect(codesOf(result.findings)).toEqual([
      'HDR-001',
      'HDR-003',
      'HDR-004',
      'HDR-005',
      'HDR-006',
      'HDR-007',
    ]);
  });

  it('flags a short HSTS max-age', async () => {
    const result = await check('security-headers').run(
      makeContext(
        crawlOf({ ...GOOD, 'strict-transport-security': `max-age=${HSTS_MIN_SECONDS - 1}` }),
      ),
    );
    expect(codesOf(result.findings)).toEqual(['HDR-002']);
    const exact = await check('security-headers').run(
      makeContext(crawlOf({ ...GOOD, 'strict-transport-security': `max-age=${HSTS_MIN_SECONDS}` })),
    );
    expect(exact.findings).toEqual([]);
  });

  it('accepts frame-ancestors instead of X-Frame-Options', async () => {
    const rest = Object.fromEntries(
      Object.entries(GOOD).filter(([name]) => name !== 'x-frame-options'),
    );
    const result = await check('security-headers').run(
      makeContext(
        crawlOf({
          ...rest,
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
        }),
      ),
    );
    expect(result.findings).toEqual([]);
  });

  it('rejects a nosniff value that is not nosniff', async () => {
    const result = await check('security-headers').run(
      makeContext(crawlOf({ ...GOOD, 'x-content-type-options': 'sniff' })),
    );
    expect(codesOf(result.findings)).toEqual(['HDR-004']);
  });

  it('checks the home page and a sample of at most 10 other pages', async () => {
    const pages = [
      makePage({ url: `${ORIGIN}/` }),
      ...Array.from({ length: 25 }, (_, index) => makePage({ url: `${ORIGIN}/p${index}` })),
    ];
    const result = await check('security-headers').run(makeContext(makeCrawl({ pages })));
    expect(result.facts).toEqual({ headerPagesChecked: SAMPLE_SIZE + 1 });
    expect(result.findings[0]?.data.count).toBe(SAMPLE_SIZE + 1);
  });

  it('says not measured without HTML pages', async () => {
    expect(
      (await check('security-headers').run(makeContext(makeCrawl()))).notMeasured,
    ).toBeDefined();
  });
});

describe('headers.information-leaks', () => {
  it('flags version numbers and X-Powered-By, not a bare server name', async () => {
    const leaky = await check('information-leaks').run(
      makeContext(crawlOf({ server: 'Apache/2.4.58 (Ubuntu)', 'x-powered-by': 'PHP/8.3' })),
    );
    expect(codesOf(leaky.findings)).toEqual(['HDR-008', 'HDR-009']);
    const clean = await check('information-leaks').run(makeContext(crawlOf({ server: 'nginx' })));
    expect(clean.findings).toEqual([]);
  });
});

describe('headers.cookies', () => {
  it('flags missing flags per cookie', async () => {
    const result = await check('cookies').run(
      makeContext(crawlOf({}, ['a=1', 'b=2; Secure; HttpOnly; SameSite=Lax'])),
    );
    expect(codesOf(result.findings)).toEqual(['HDR-010', 'HDR-011', 'HDR-012']);
    expect(result.findings[0]?.evidence).toEqual([`${ORIGIN}/: a`]);
  });
  it('accepts a cookie with every flag', async () => {
    expect(
      (
        await check('cookies').run(
          makeContext(crawlOf({}, ['s=1; Path=/; Secure; HttpOnly; SameSite=Strict'])),
        )
      ).findings,
    ).toEqual([]);
  });
  it('parses attributes case-insensitively', () => {
    expect(parseSetCookie('id=1; secure; HTTPONLY; samesite=none')).toEqual({
      name: 'id',
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
  });
});
