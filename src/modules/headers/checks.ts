import { makeFinding, outcome, samplePages } from '../../checks/support.js';
import type { Check } from '../../model/check.js';
import type { PageRecord } from '../../model/crawl.js';
import type { Finding } from '../../model/finding.js';

export const SAMPLE_SIZE = 10;
export const HSTS_MIN_SECONDS = 15_552_000;
const VERSION_PATTERN = /\d+\.\d+/;

interface Cookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: boolean;
}

export function parseSetCookie(value: string): Cookie {
  const [pair = '', ...attributes] = value.split(';').map((part) => part.trim());
  const flags = attributes.map((attribute) => attribute.toLowerCase());
  return {
    name: pair.split('=')[0] ?? '',
    secure: flags.includes('secure'),
    httpOnly: flags.includes('httponly'),
    sameSite: flags.some((flag) => flag.startsWith('samesite=')),
  };
}

function header(page: PageRecord, name: string): string | undefined {
  return page.headers[name];
}

function hasFrameProtection(page: PageRecord): boolean {
  const csp = header(page, 'content-security-policy') ?? '';
  return header(page, 'x-frame-options') !== undefined || /frame-ancestors/i.test(csp);
}

function collect(pages: readonly PageRecord[], missing: (page: PageRecord) => boolean): string[] {
  return pages.filter(missing).map((page) => page.url);
}

const securityHeaders: Check = {
  id: 'headers.security-headers',
  module: 'headers',
  codes: ['HDR-001', 'HDR-002', 'HDR-003', 'HDR-004', 'HDR-005', 'HDR-006', 'HDR-007'],
  run(context) {
    const pages = samplePages(context, SAMPLE_SIZE);
    if (pages.length === 0) return outcome([], undefined, 'No HTML pages were crawled');
    const https = pages.filter((page) => page.finalUrl.startsWith('https://'));
    const findings: Finding[] = [];
    const add = (
      code: string,
      severity: 'important' | 'improvement',
      urls: string[],
      data = {},
    ): void => {
      if (urls.length > 0) findings.push(makeFinding('headers', code, severity, urls, data));
    };

    add(
      'HDR-001',
      'important',
      collect(https, (page) => header(page, 'strict-transport-security') === undefined),
    );
    add(
      'HDR-002',
      'improvement',
      collect(https, (page) => {
        const value = header(page, 'strict-transport-security');
        if (value === undefined) return false;
        const seconds = Number(/max-age=(\d+)/i.exec(value)?.[1] ?? 0);
        return seconds < HSTS_MIN_SECONDS;
      }),
      { minimum: HSTS_MIN_SECONDS },
    );
    add(
      'HDR-003',
      'important',
      collect(pages, (page) => header(page, 'content-security-policy') === undefined),
    );
    add(
      'HDR-004',
      'important',
      collect(pages, (page) => header(page, 'x-content-type-options')?.toLowerCase() !== 'nosniff'),
    );
    add(
      'HDR-005',
      'important',
      collect(pages, (page) => !hasFrameProtection(page)),
    );
    add(
      'HDR-006',
      'improvement',
      collect(pages, (page) => header(page, 'referrer-policy') === undefined),
    );
    add(
      'HDR-007',
      'improvement',
      collect(pages, (page) => header(page, 'permissions-policy') === undefined),
    );
    return outcome(findings, { headerPagesChecked: pages.length });
  },
};

const leaks: Check = {
  id: 'headers.information-leaks',
  module: 'headers',
  codes: ['HDR-008', 'HDR-009'],
  run(context) {
    const pages = samplePages(context, SAMPLE_SIZE);
    const server = pages.filter((page) => VERSION_PATTERN.test(header(page, 'server') ?? ''));
    const poweredBy = pages.filter((page) => header(page, 'x-powered-by') !== undefined);
    return outcome([
      ...(server.length > 0
        ? [
            makeFinding(
              'headers',
              'HDR-008',
              'improvement',
              server.map((p) => `${p.url}: Server: ${header(p, 'server') ?? ''}`),
            ),
          ]
        : []),
      ...(poweredBy.length > 0
        ? [
            makeFinding(
              'headers',
              'HDR-009',
              'improvement',
              poweredBy.map((p) => `${p.url}: X-Powered-By: ${header(p, 'x-powered-by') ?? ''}`),
            ),
          ]
        : []),
    ]);
  },
};

const cookies: Check = {
  id: 'headers.cookies',
  module: 'headers',
  codes: ['HDR-010', 'HDR-011', 'HDR-012'],
  run(context) {
    const pages = samplePages(context, SAMPLE_SIZE);
    const noSecure: string[] = [];
    const noHttpOnly: string[] = [];
    const noSameSite: string[] = [];
    for (const page of pages) {
      for (const raw of page.setCookies) {
        const cookie = parseSetCookie(raw);
        const note = `${page.url}: ${cookie.name}`;
        if (!cookie.secure && page.finalUrl.startsWith('https://')) noSecure.push(note);
        if (!cookie.httpOnly) noHttpOnly.push(note);
        if (!cookie.sameSite) noSameSite.push(note);
      }
    }
    const unique = (list: string[]): string[] => [...new Set(list)];
    return outcome([
      ...(noSecure.length > 0
        ? [makeFinding('headers', 'HDR-010', 'important', unique(noSecure))]
        : []),
      ...(noHttpOnly.length > 0
        ? [makeFinding('headers', 'HDR-011', 'improvement', unique(noHttpOnly))]
        : []),
      ...(noSameSite.length > 0
        ? [makeFinding('headers', 'HDR-012', 'improvement', unique(noSameSite))]
        : []),
    ]);
  },
};

export const headersChecks: readonly Check[] = [securityHeaders, leaks, cookies];
