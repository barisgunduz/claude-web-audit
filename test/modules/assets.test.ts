import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/crawler/http.js';
import {
  extractAssetUrls,
  isCompressed,
  isCompressibleType,
  isVersionedUrl,
  LONG_CACHE_SECONDS,
  MAX_ASSETS,
  parseCachePolicy,
} from '../../src/modules/speed/assets.js';
import { speedModule } from '../../src/modules/speed/index.js';
import { runModule } from '../../src/modules/runner.js';
import {
  fakeHttp,
  makeContext,
  makeCrawl,
  makePage,
  NOW,
  ORIGIN,
  pageHtml,
} from '../support/builders.js';
import { canonicalSite, html, startTestSite, type TestSite } from '../support/test-site.js';

describe('compression helpers', () => {
  it.each([
    ['text/html; charset=utf-8', true],
    ['text/css', true],
    ['application/javascript', true],
    ['application/json', true],
    ['application/ld+json', true],
    ['image/svg+xml', true],
    ['font/ttf', true],
    ['application/vnd.ms-fontobject', true],
    ['image/png', false],
    ['image/webp', false],
    ['font/woff2', false],
    ['application/pdf', false],
    ['', false],
  ])('%s is compressible: %s', (type, expected) => {
    expect(isCompressibleType(type)).toBe(expected);
  });

  it.each([
    ['gzip', true],
    ['br', true],
    ['GZIP', true],
    ['zstd', true],
    ['gzip, br', true],
    ['identity', false],
    ['', false],
    [undefined, false],
  ])('content-encoding %s is compressed: %s', (value, expected) => {
    expect(isCompressed(value)).toBe(expected);
  });
});

describe('parseCachePolicy', () => {
  const policy = (headers: Record<string, string>) => parseCachePolicy(headers, NOW);
  it('reads max-age, s-maxage, no-store and no-cache', () => {
    expect(policy({ 'cache-control': 'public, max-age=31536000, immutable' })).toMatchObject({
      ttl: 31_536_000,
      noStore: false,
      hasAnyHeader: true,
    });
    expect(policy({ 'cache-control': 's-maxage=60' }).ttl).toBe(60);
    expect(policy({ 'cache-control': 'no-store' })).toMatchObject({
      noStore: true,
      ttl: undefined,
    });
    expect(policy({ 'cache-control': 'no-cache', etag: '"a"' })).toMatchObject({
      noCache: true,
      hasValidator: true,
    });
  });
  it('falls back to Expires, and treats a past or broken date as 0', () => {
    expect(policy({ expires: new Date(NOW.getTime() + 3600_000).toUTCString() }).ttl).toBe(3600);
    expect(policy({ expires: new Date(NOW.getTime() - 3600_000).toUTCString() }).ttl).toBe(0);
    expect(policy({ expires: 'never' }).ttl).toBe(0);
  });
  it('prefers max-age over Expires and knows when no header is present', () => {
    expect(
      policy({
        'cache-control': 'max-age=10',
        expires: new Date(NOW.getTime() + 3600_000).toUTCString(),
      }).ttl,
    ).toBe(10);
    expect(policy({})).toMatchObject({ hasAnyHeader: false, hasValidator: false, ttl: undefined });
    expect(policy({ 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' })).toMatchObject({
      hasAnyHeader: true,
      hasValidator: true,
    });
  });
});

describe('isVersionedUrl', () => {
  it.each([
    ['https://e.test/assets/app.3f9a1c7b2d.js', true],
    ['https://e.test/assets/app-3f9a1c7b2d.css', true],
    ['https://e.test/style.css?ver=6.4.2', true],
    ['https://e.test/style.css?x=1&v=3', true],
    ['https://e.test/style.css', false],
    ['https://e.test/assets/app.js', false],
    ['https://e.test/logo.png?width=200', false],
    ['https://e.test/assets/readme.txt', false],
  ])('%s is versioned: %s', (url, expected) => {
    expect(isVersionedUrl(url)).toBe(expected);
  });
});

describe('extractAssetUrls', () => {
  const body =
    '<script src="/a.js"></script><link rel="stylesheet" href="b.css"><link rel="preload" href="/c.woff2" as="font"><img src="/d.png"><img src="/d.png"><script src="https://cdn.other.test/x.js"></script><script src="https://www.example.test/y.js"></script><img src="data:image/png;base64,AAAA"><script src="mailto:x"></script>';
  it('keeps same-site assets without repeats, scripts first, and drops other hosts and data URLs', () => {
    const pages = [makePage({ url: `${ORIGIN}/dir/`, html: pageHtml({ body }) })];
    expect(extractAssetUrls(pages, 'example.test')).toEqual([
      `${ORIGIN}/a.js`,
      'https://www.example.test/y.js',
      `${ORIGIN}/dir/b.css`,
      `${ORIGIN}/c.woff2`,
      `${ORIGIN}/d.png`,
    ]);
  });
  it('stops at the limit', () => {
    const many = Array.from(
      { length: 50 },
      (_, index) => `<script src="/s${index}.js"></script>`,
    ).join('');
    const urls = extractAssetUrls(
      [makePage({ url: `${ORIGIN}/`, html: pageHtml({ body: many }) })],
      'example.test',
    );
    expect(urls).toHaveLength(MAX_ASSETS);
  });
});

describe('speed.asset-headers with fake responses', () => {
  const page = (
    body: string,
    headers: Record<string, string> = { 'content-encoding': 'br' },
    text = 'x'.repeat(2000),
  ) => makePage({ url: `${ORIGIN}/`, headers, html: pageHtml({ body: `${body}<p>${text}</p>` }) });
  const run = (
    body: string,
    routes: Record<string, { status: number; contentType?: string }> = {},
    pageHeaders?: Record<string, string>,
  ) =>
    runModule(
      speedModule,
      makeContext(makeCrawl({ pages: [page(body, pageHeaders)] }), { http: fakeHttp(routes) }),
    );

  it('flags an HTML document without compression, and accepts br and gzip', async () => {
    const result = await run('', {}, {});
    expect(result.findings.find((f) => f.code === 'SPD-050')).toMatchObject({
      severity: 'important',
      evidence: [`${ORIGIN}/`],
    });
    expect(
      (await run('', {}, { 'content-encoding': 'gzip' })).findings.some(
        (f) => f.code === 'SPD-050',
      ),
    ).toBe(false);
  });

  it('does not flag a tiny document', async () => {
    const tiny = makePage({ url: `${ORIGIN}/`, html: '<html></html>', headers: {} });
    const result = await runModule(speedModule, makeContext(makeCrawl({ pages: [tiny] })));
    expect(result.findings.some((f) => f.code === 'SPD-050')).toBe(false);
  });

  it('says not measured for the header checks when no HTML page was crawled', async () => {
    const result = await runModule(speedModule, makeContext(makeCrawl({ pages: [] })));
    expect(result.reason).toContain('asset-headers: There are no crawled HTML pages to check.');
  });
});

describe('speed.asset-headers against a local server', () => {
  let site: TestSite | undefined;
  afterEach(async () => {
    await site?.close();
    site = undefined;
  });

  const big = 'body { color: red; }\n'.repeat(200);
  const js = 'var a = 1;\n'.repeat(300);

  async function audit(
    assetHeaders: Record<string, Record<string, string | number>>,
    requests: string[] = [],
  ) {
    const assets = Object.fromEntries(
      Object.entries(assetHeaders).map(([path, headers]) => [
        path,
        {
          headers: {
            'content-type': path.endsWith('.css')
              ? 'text/css'
              : path.endsWith('.js')
                ? 'application/javascript'
                : 'image/png',
            ...headers,
          },
          body: path.endsWith('.css') ? big : js,
        },
      ]),
    );
    site = await startTestSite(
      canonicalSite({
        '/': (request) => {
          requests.push(request.url.pathname);
          return html(
            Object.keys(assetHeaders)
              .map((path) =>
                path.endsWith('.css')
                  ? `<link rel="stylesheet" href="${path}">`
                  : path.endsWith('.js')
                    ? `<script src="${path}"></script>`
                    : `<img src="${path}">`,
              )
              .join('') + 'x'.repeat(1500),
          );
        },
        ...assets,
      }),
    );
    const http = new HttpClient({
      userAgent: 'test',
      timeoutMs: 2000,
      maxBodyBytes: 1_000_000,
      delayMs: 0,
      fetchImpl: site.fetchImpl,
    });
    const crawlPage = makePage({
      url: `${ORIGIN}/`,
      headers: { 'content-encoding': 'gzip' },
      html: await (
        await site.fetchImpl(`${ORIGIN}/`, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(2000),
          headers: {},
        })
      ).text(),
    });
    return runModule(speedModule, makeContext(makeCrawl({ pages: [crawlPage] }), { http }));
  }

  it('sees real Content-Encoding headers and flags text assets that are not compressed', async () => {
    const result = await audit({
      '/plain.css': { 'cache-control': 'public, max-age=31536000' },
      '/zipped.js': { 'content-encoding': 'gzip', 'cache-control': 'public, max-age=31536000' },
    });
    const finding = result.findings.find((f) => f.code === 'SPD-051');
    expect(finding?.evidence).toEqual([`${ORIGIN}/plain.css (text/css)`]);
  });

  it('flags assets without caching headers, with caching disabled, and versioned assets cached too briefly', async () => {
    const result = await audit({
      '/none.css': {},
      '/off.js': { 'cache-control': 'no-store' },
      '/app.3f9a1c7b2d.js': { 'cache-control': 'public, max-age=3600' },
      '/good.3f9a1c7b2d.css': { 'cache-control': `public, max-age=${LONG_CACHE_SECONDS}` },
      '/revalidated.css': { 'cache-control': 'no-cache', etag: '"abc"' },
    });
    const codes = Object.fromEntries(
      result.findings.filter((f) => /SPD-05[2-4]/.test(f.code)).map((f) => [f.code, f.evidence]),
    );
    expect(codes['SPD-052']).toEqual([`${ORIGIN}/none.css`]);
    expect(codes['SPD-054']).toEqual([`${ORIGIN}/off.js`]);
    expect(codes['SPD-053']).toEqual([`${ORIGIN}/app.3f9a1c7b2d.js (max-age 3600s)`]);
  });

  it('accepts a well-served site', async () => {
    const result = await audit({
      '/a.css': { 'content-encoding': 'br', 'cache-control': 'public, max-age=31536000' },
    });
    expect(result.findings.filter((f) => f.code.startsWith('SPD-05'))).toEqual([]);
    expect(result.facts).toMatchObject({ assetsChecked: 1, documentsChecked: 1 });
  });

  it('compresses for real: a gzip body is seen as gzip', async () => {
    site = await startTestSite(
      canonicalSite({
        '/z.css': {
          headers: { 'content-type': 'text/css', 'content-encoding': 'gzip' },
          body: gzipSync(big),
        },
      }),
    );
    const http = new HttpClient({
      userAgent: 'test',
      timeoutMs: 2000,
      maxBodyBytes: 1_000_000,
      delayMs: 0,
      fetchImpl: site.fetchImpl,
    });
    const response = await http.request(`${ORIGIN}/z.css`, { body: 'text' });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.text).toContain('color: red');
  });
});
