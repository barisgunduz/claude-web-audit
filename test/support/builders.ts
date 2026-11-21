import { HttpClient } from '../../src/crawler/http.js';
import { extractLinks } from '../../src/crawler/links.js';
import { parseRobots } from '../../src/crawler/robots.js';
import type { Settings } from '../../src/config/types.js';
import { DEFAULT_WEIGHTS } from '../../src/config/defaults.js';
import { MODULE_NAMES } from '../../src/modules/names.js';
import type { DnsResolver } from '../../src/modules/email/dns.js';
import type { CheckContext } from '../../src/model/check.js';
import type { CrawlResult, PageRecord, ProbeRecord, TlsInfo } from '../../src/model/crawl.js';

export const ORIGIN = 'https://example.test';
export const NOW = new Date('2026-11-21T12:00:00Z');

export function pageHtml(
  options: { head?: string; body?: string; lang?: string | null } = {},
): string {
  const lang = options.lang === null ? '' : ` lang="${options.lang ?? 'en'}"`;
  return `<!doctype html><html${lang}><head><meta charset="utf-8">${options.head ?? ''}</head><body>${options.body ?? ''}</body></html>`;
}

export interface PageInput extends Partial<Omit<PageRecord, 'url'>> {
  url: string;
}

/** A crawled page. Links are read from the HTML in the same way as the crawler does. */
export function makePage(input: PageInput): PageRecord {
  const html = 'html' in input ? input.html : pageHtml();
  const finalUrl = input.finalUrl ?? input.url;
  return {
    finalUrl,
    status: 200,
    redirectChain: [],
    redirectLoop: false,
    headers: {},
    setCookies: [],
    contentType: 'text/html',
    bodyTruncated: false,
    timingMs: 5,
    inbound: [],
    links: html === undefined ? [] : extractLinks(html, finalUrl, 'example.test'),
    ...input,
    ...(html !== undefined && { html }),
  };
}

export function goodTls(overrides: Partial<TlsInfo> = {}): TlsInfo {
  return {
    host: 'example.test',
    reachable: true,
    protocol: 'TLSv1.3',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z',
    subjectAltNames: ['example.test', 'www.example.test'],
    hostnameMatches: true,
    authorized: true,
    ...overrides,
  };
}

function emptyProbe(url: string, status: number): ProbeRecord {
  return { url, finalUrl: url, status, chain: [], loop: false, contentType: '', body: '' };
}

export function makeCrawl(overrides: Partial<CrawlResult> = {}): CrawlResult {
  const variants = [
    'https://example.test/',
    'https://www.example.test/',
    'http://example.test/',
    'http://www.example.test/',
  ].map((variant) => ({
    variant,
    url: variant,
    finalUrl: `${ORIGIN}/`,
    status: 200,
    chain: variant === `${ORIGIN}/` ? [] : [{ url: variant, status: 301, location: `${ORIGIN}/` }],
    loop: false,
  }));
  return {
    inputDomain: 'example.test',
    startUrl: `${ORIGIN}/`,
    userAgent: 'claude-web-audit/test',
    startedAt: NOW.toISOString(),
    durationMs: 10,
    host: {
      inputHost: 'example.test',
      canonicalHost: 'example.test',
      canonicalOrigin: ORIGIN,
      variants,
      consistent: true,
    },
    robots: {
      url: `${ORIGIN}/robots.txt`,
      status: 200,
      found: true,
      text: '',
      parsed: parseRobots(''),
    },
    sitemaps: { files: [], urls: [], truncated: false },
    tls: goodTls(),
    pages: [],
    blockedByRobots: [],
    externalLinks: [],
    notFoundProbe: emptyProbe(`${ORIGIN}/cwa-404-test`, 404),
    llmsProbe: emptyProbe(`${ORIGIN}/llms.txt`, 404),
    limits: {
      pagesCap: 150,
      pagesCapReached: false,
      externalCap: 200,
      externalCapReached: false,
      stopped: false,
    },
    errors: [],
    ...overrides,
  };
}

export function withRobots(text: string, status = 200): CrawlResult['robots'] {
  return {
    url: `${ORIGIN}/robots.txt`,
    status,
    found: status === 200,
    text,
    parsed: parseRobots(text),
  };
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    domain: 'example.test',
    pages: 150,
    preparedBy: '',
    language: 'en',
    engine: 'auto',
    strategy: 'both',
    runs: 3,
    delay: 0,
    concurrency: 4,
    thinContentWords: 300,
    dkimSelectors: [],
    weights: { ...DEFAULT_WEIGHTS },
    modules: [...MODULE_NAMES],
    outputs: { card: true, social: false, pdf: true, fixPlan: true },
    compare: undefined,
    out: './audits',
    failUnder: undefined,
    verbose: false,
    ...overrides,
  };
}

export function fakeDns(records: {
  txt?: Record<string, string[][]>;
  mx?: Record<string, { exchange: string; priority: number }[]>;
  fail?: boolean;
}): DnsResolver {
  return {
    resolveTxt: (name) =>
      records.fail
        ? Promise.reject(new Error('DNS lookup failed'))
        : Promise.resolve(records.txt?.[name] ?? []),
    resolveMx: (name) =>
      records.fail
        ? Promise.reject(new Error('DNS lookup failed'))
        : Promise.resolve(records.mx?.[name] ?? []),
  };
}

export function fakeHttp(
  routes: Record<string, { status: number; contentType?: string }> = {},
): HttpClient {
  const fetchImpl: typeof fetch = (input) => {
    const route = routes[requestUrl(input)] ?? { status: 404 };
    return Promise.resolve(
      new Response('', {
        status: route.status,
        headers: { 'content-type': route.contentType ?? 'text/html' },
      }),
    );
  };
  return new HttpClient({
    userAgent: 'test',
    timeoutMs: 1000,
    maxBodyBytes: 1_000_000,
    delayMs: 0,
    fetchImpl,
  });
}

export function makeContext(
  crawl: CrawlResult,
  overrides: Partial<CheckContext> = {},
): CheckContext {
  return {
    crawl,
    settings: makeSettings(),
    http: fakeHttp(),
    dns: fakeDns({}),
    now: NOW,
    ...overrides,
  };
}

export function codesOf(findings: readonly { code: string }[]): string[] {
  return findings.map((finding) => finding.code).sort();
}

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
