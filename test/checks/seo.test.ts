import { describe, expect, it } from 'vitest';
import { seoModule } from '../../src/modules/seo/index.js';
import { missingProperties } from '../../src/modules/seo/structured-data.js';
import { isValidLastmod } from '../../src/modules/seo/site-checks.js';
import { runModule } from '../../src/modules/runner.js';
import type { CrawlResult, PageRecord } from '../../src/model/crawl.js';
import {
  fakeHttp,
  makeContext,
  makeCrawl,
  makePage,
  ORIGIN,
  pageHtml,
  withRobots,
} from '../support/builders.js';

const TITLE = 'A page title that is long enough for results';
const DESCRIPTION =
  'A meta description that explains what this page is about in a clear way for people reading search results.';

function head(path: string, extra = '', skip: string[] = []): string {
  const parts: Record<string, string> = {
    title: `<title>${TITLE}</title>`,
    description: `<meta name="description" content="${DESCRIPTION}">`,
    viewport: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    canonical: `<link rel="canonical" href="${ORIGIN}${path}">`,
    og: ['title', 'description', 'image', 'url']
      .map((tag) => `<meta property="og:${tag}" content="x">`)
      .join(''),
    twitter: '<meta name="twitter:card" content="summary">',
    icon: '<link rel="icon" href="/favicon.ico">',
  };
  return (
    Object.entries(parts)
      .filter(([name]) => !skip.includes(name))
      .map(([, value]) => value)
      .join('') + extra
  );
}

interface Options {
  path?: string;
  extraHead?: string;
  skip?: string[];
  body?: string;
  lang?: string | null;
  page?: Partial<PageRecord>;
}
function goodPage(options: Options = {}): PageRecord {
  const path = options.path ?? '/';
  return makePage({
    url: `${ORIGIN}${path}`,
    html: pageHtml({
      head: head(path, options.extraHead, options.skip),
      body:
        options.body ??
        '<h1>Heading</h1><h2>Sub</h2><img src="/a.png" alt="a" width="10" height="10">',
      lang: options.lang === undefined ? 'en' : options.lang,
    }),
    ...options.page,
  });
}

async function codes(pages: PageRecord[], crawl: Partial<CrawlResult> = {}): Promise<string[]> {
  const robots = withRobots(`User-agent: *\nSitemap: ${ORIGIN}/sitemap.xml`);
  const result = await runModule(seoModule, makeContext(makeCrawl({ pages, robots, ...crawl })));
  return [...new Set(result.findings.map((finding) => finding.code))].sort();
}
const withSitemap = (urls: string[]): Partial<CrawlResult> => ({
  sitemaps: {
    files: [
      {
        url: `${ORIGIN}/sitemap.xml`,
        status: 200,
        kind: 'urlset',
        gzip: false,
        bytes: 100,
        urlCount: urls.length,
      },
    ],
    urls: urls.map((loc) => ({ loc, sitemap: `${ORIGIN}/sitemap.xml`, lastmod: '2026-01-01' })),
    truncated: false,
  },
  robots: withRobots(`User-agent: *\nDisallow:\nSitemap: ${ORIGIN}/sitemap.xml`),
});

describe('seo page checks', () => {
  it('reports nothing for a clean page', async () => {
    expect(await codes([goodPage()], withSitemap([`${ORIGIN}/`]))).toEqual([]);
  });

  it.each([
    ['SEO-001', { skip: ['title'] }],
    ['SEO-002', { skip: ['title'], extraHead: '<title>Short title</title>' }],
    ['SEO-003', { skip: ['title'], extraHead: `<title>${'x'.repeat(61)}</title>` }],
    ['SEO-004', { skip: ['description'] }],
    [
      'SEO-005',
      { skip: ['description'], extraHead: '<meta name="description" content="Too short.">' },
    ],
    [
      'SEO-006',
      {
        skip: ['description'],
        extraHead: `<meta name="description" content="${'x'.repeat(161)}">`,
      },
    ],
    ['SEO-007', { skip: ['canonical'] }],
    ['SEO-008', { skip: ['canonical'], extraHead: '<link rel="canonical" href="/">' }],
    [
      'SEO-009',
      { skip: ['canonical'], extraHead: `<link rel="canonical" href="${ORIGIN}/other">` },
    ],
    ['SEO-013', { body: '<p>No heading</p>' }],
    ['SEO-014', { body: '<h1>One</h1><h1>Two</h1>' }],
    ['SEO-015', { body: '<h1>One</h1><h3>Skipped</h3>' }],
    ['SEO-019', { skip: ['og'] }],
    ['SEO-020', { skip: ['twitter'] }],
    ['SEO-025', { skip: ['viewport'] }],
    ['SEO-026', { lang: null }],
    ['SEO-027', { body: '<h1>H</h1><img src="/a.png" width="1" height="1">' }],
    ['SEO-028', { body: '<h1>H</h1><img src="/a.png" alt="a">' }],
  ] as const)('%s', async (code, options) => {
    const found = await codes([goodPage(options as Options)], withSitemap([`${ORIGIN}/`]));
    // A canonical that points elsewhere also makes the sitemap entry non-canonical.
    expect(found.filter((candidate) => candidate !== 'SEO-039')).toEqual([code]);
  });

  it('accepts empty alt text for decorative images', async () => {
    expect(
      await codes(
        [goodPage({ body: '<h1>H</h1><img src="/a.png" alt="" width="1" height="1">' })],
        withSitemap([`${ORIGIN}/`]),
      ),
    ).toEqual([]);
  });

  it('does not flag a canonical of a page with a query string', async () => {
    const page = goodPage({
      path: '/list?page=2',
      skip: ['canonical'],
      extraHead: `<link rel="canonical" href="${ORIGIN}/list">`,
    });
    expect(await codes([page], withSitemap([]))).not.toContain('SEO-009');
  });

  it('flags a canonical that points to a redirecting or missing page', async () => {
    const pages = [
      goodPage({ skip: ['canonical'], extraHead: `<link rel="canonical" href="${ORIGIN}/moved">` }),
      makePage({
        url: `${ORIGIN}/moved`,
        finalUrl: `${ORIGIN}/new`,
        redirectChain: [{ url: `${ORIGIN}/moved`, status: 301 }],
      }),
    ];
    expect(await codes(pages)).toContain('SEO-010');
  });

  it('makes noindex critical on the home page and an improvement elsewhere', async () => {
    const result = await runModule(
      seoModule,
      makeContext(
        makeCrawl({
          pages: [
            goodPage({ extraHead: '<meta name="robots" content="noindex, follow">' }),
            goodPage({ path: '/b', page: { headers: { 'x-robots-tag': 'noindex' } } }),
          ],
        }),
      ),
    );
    const noindex = result.findings.filter(
      (finding) => finding.code === 'SEO-011' || finding.code === 'SEO-012',
    );
    expect(noindex.map((finding) => [finding.code, finding.severity])).toEqual([
      ['SEO-011', 'critical'],
      ['SEO-012', 'improvement'],
    ]);
  });
});

describe('seo hreflang', () => {
  const alt = (code: string, path: string) =>
    `<link rel="alternate" hreflang="${code}" href="${ORIGIN}${path}">`;
  it('accepts alternates that link back and have x-default', async () => {
    const pages = [
      goodPage({ extraHead: alt('en', '/') + alt('tr', '/tr') + alt('x-default', '/') }),
      goodPage({
        path: '/tr',
        extraHead: alt('en', '/') + alt('tr', '/tr') + alt('x-default', '/'),
      }),
    ];
    expect(await codes(pages, withSitemap([`${ORIGIN}/`, `${ORIGIN}/tr`]))).toEqual([]);
  });
  it('flags an invalid code, a missing return link and a missing x-default', async () => {
    const pages = [
      goodPage({ extraHead: alt('en', '/') + alt('tr', '/tr') + alt('english', '/x') }),
      goodPage({ path: '/tr', extraHead: alt('tr', '/tr') }),
    ];
    expect(await codes(pages, withSitemap([`${ORIGIN}/`, `${ORIGIN}/tr`]))).toEqual([
      'SEO-016',
      'SEO-017',
      'SEO-018',
    ]);
  });
});

describe('seo structured data', () => {
  const ld = (json: string): string => `<script type="application/ld+json">${json}</script>`;
  const run = (json: string) =>
    codes([goodPage({ extraHead: ld(json) })], withSitemap([`${ORIGIN}/`]));

  it('accepts a complete LocalBusiness and a @graph', async () => {
    expect(
      await run('{"@context":"https://schema.org","@type":"Dentist","name":"A","address":"B"}'),
    ).toEqual([]);
    expect(
      await run(
        '{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"A","url":"https://example.test"}]}',
      ),
    ).toEqual([]);
  });
  it.each([
    ['SEO-021', '{not json'],
    ['SEO-022', '{"@type":"WebSite","name":"A","url":"u"}'],
    ['SEO-022', '{"@context":"https://schema.org","name":"A"}'],
    ['SEO-023', '{"@context":"https://schema.org","@type":"LocalBusiness","name":"A"}'],
    ['SEO-023', '{"@context":"https://schema.org","@type":"FAQPage"}'],
    ['SEO-023', '{"@context":"https://schema.org","@type":"Product","name":"P"}'],
    ['SEO-047', '{"@context":"https://schema.org","@type":"Article","headline":"H"}'],
    ['SEO-047', '{"@context":"https://schema.org","@type":"Organization","name":"A"}'],
  ])('%s for %s', async (code, json) => {
    expect(await run(json)).toContain(code);
  });

  it('checks required properties through the rules file', () => {
    expect(missingProperties({ '@type': 'Product', name: 'P', offers: {} })).toEqual({
      required: [],
      recommended: [],
    });
    expect(missingProperties({ '@type': 'Product', name: 'P' }).required).toEqual([
      'one of offers, review, aggregateRating',
    ]);
    expect(missingProperties({ '@type': ['Restaurant', 'Thing'], name: 'R' }).required).toEqual([
      'address',
    ]);
    expect(
      missingProperties({
        '@type': 'BreadcrumbList',
        itemListElement: [
          { position: 1, name: 'A', item: 'x' },
          { position: 2, item: { name: 'B' } },
        ],
      }).required,
    ).toEqual([]);
    expect(
      missingProperties({
        '@type': 'BreadcrumbList',
        itemListElement: [{ name: 'A' }, { position: 2 }],
      }).required,
    ).toEqual(['ListItem.position', 'ListItem.item', 'ListItem.name']);
  });
});

describe('seo favicon and url hygiene', () => {
  it('asks for /favicon.ico when the page has no icon link, and accepts an image', async () => {
    const page = goodPage({ skip: ['icon'] });
    const found = fakeHttp({
      [`${ORIGIN}/favicon.ico`]: { status: 200, contentType: 'image/x-icon' },
    });
    const ok = await runModule(
      seoModule,
      makeContext(makeCrawl({ pages: [page], ...withSitemap([`${ORIGIN}/`]) }), { http: found }),
    );
    expect(ok.findings.map((finding) => finding.code)).not.toContain('SEO-024');
    const missing = await runModule(
      seoModule,
      makeContext(makeCrawl({ pages: [page], ...withSitemap([`${ORIGIN}/`]) })),
    );
    expect(missing.findings.map((finding) => finding.code)).toContain('SEO-024');
  });

  it('flags uppercase, underscores, long URLs and many parameters', async () => {
    const pages = [
      goodPage({ path: '/About' }),
      goodPage({ path: '/my_page' }),
      goodPage({ path: `/${'a'.repeat(120)}` }),
      goodPage({ path: '/search?a=1&b=2&c=3&d=4' }),
    ];
    const found = await codes(pages, withSitemap(pages.map((page) => page.url)));
    expect(found).toEqual(expect.arrayContaining(['SEO-029', 'SEO-030', 'SEO-031', 'SEO-032']));
  });
});

describe('seo sitemap', () => {
  const xml = (kind: 'urlset' | 'invalid' | 'missing', urlCount = 1, bytes = 100) => ({
    url: `${ORIGIN}/sitemap.xml`,
    status: kind === 'missing' ? 404 : 200,
    kind,
    gzip: false,
    bytes,
    urlCount,
  });
  const base = (
    urls: { loc: string; lastmod?: string }[],
    extra: Partial<CrawlResult> = {},
  ): Partial<CrawlResult> => ({
    sitemaps: {
      files: [xml('urlset', urls.length)],
      urls: urls.map((entry) => ({ ...entry, sitemap: `${ORIGIN}/sitemap.xml` })),
      truncated: false,
    },
    robots: withRobots(`User-agent: *\nSitemap: ${ORIGIN}/sitemap.xml`),
    ...extra,
  });

  it('flags a missing sitemap', async () => {
    expect(
      await codes([goodPage()], {
        sitemaps: { files: [xml('missing')], urls: [], truncated: false },
      }),
    ).toEqual(['SEO-033']);
  });
  it('flags invalid XML and size limits', async () => {
    const crawl = {
      sitemaps: {
        files: [xml('urlset', 50_001, 60 * 1024 * 1024), { ...xml('invalid'), error: 'bad' }],
        urls: [],
        truncated: false,
      },
    };
    expect(await codes([goodPage()], crawl)).toEqual(['SEO-034', 'SEO-035']);
  });
  it('checks the pages that the sitemap lists', async () => {
    const pages = [
      goodPage(),
      makePage({ url: `${ORIGIN}/gone`, status: 404, html: undefined }),
      makePage({
        url: `${ORIGIN}/old`,
        finalUrl: `${ORIGIN}/new`,
        redirectChain: [{ url: `${ORIGIN}/old`, status: 301 }],
      }),
      goodPage({ path: '/hidden', extraHead: '<meta name="robots" content="noindex">' }),
      goodPage({
        path: '/dup',
        skip: ['canonical'],
        extraHead: `<link rel="canonical" href="${ORIGIN}/main">`,
      }),
    ];
    const urls = ['/', '/gone', '/old', '/hidden', '/dup'].map((path) => ({
      loc: `${ORIGIN}${path}`,
      lastmod: '2026-01-01',
    }));
    const found = await codes(
      pages,
      base([...urls, { loc: 'http://example.test/plain', lastmod: '2026-01-01' }]),
    );
    expect(found).toEqual(expect.arrayContaining(['SEO-036', 'SEO-037', 'SEO-038', 'SEO-039']));
  });
  it('flags invalid and missing lastmod, and pages missing from the sitemap', async () => {
    const pages = [goodPage(), goodPage({ path: '/unlisted' })];
    expect(await codes(pages, base([{ loc: `${ORIGIN}/`, lastmod: 'yesterday' }]))).toEqual([
      'SEO-040',
      'SEO-042',
    ]);
    expect(
      await codes(pages, base([{ loc: `${ORIGIN}/` }, { loc: `${ORIGIN}/unlisted` }])),
    ).toEqual(['SEO-041']);
  });
  it('validates lastmod values', () => {
    expect(
      ['2026-11-21', '2026-11-21T10:00:00Z', '2026-11-21T10:00:00+03:00', '2026-11-21T10:00'].map(
        isValidLastmod,
      ),
    ).toEqual([true, true, true, false]);
    expect(['21-11-2026', 'today', '2026-13-45'].map(isValidLastmod)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('seo robots.txt', () => {
  const run = (robots: CrawlResult['robots']) =>
    codes([goodPage()], { ...withSitemap([`${ORIGIN}/`]), robots });
  const crawlWith = (robots: CrawlResult['robots']) => ({ ...withSitemap([`${ORIGIN}/`]), robots });

  it('flags a missing file', async () => {
    expect(await codes([goodPage()], crawlWith(withRobots('', 404)))).toEqual(['SEO-043']);
  });
  it('flags a blanket Disallow as critical', async () => {
    const result = await runModule(
      seoModule,
      makeContext(
        makeCrawl({
          pages: [goodPage()],
          ...crawlWith(
            withRobots('User-agent: *\nDisallow: /\nSitemap: https://example.test/s.xml'),
          ),
        }),
      ),
    );
    expect(result.findings.find((finding) => finding.code === 'SEO-044')?.severity).toBe(
      'critical',
    );
  });
  it('does not call a partial block a blanket block', async () => {
    expect(await run(withRobots('User-agent: *\nDisallow: /private\nSitemap: x'))).toEqual([]);
  });
  it('flags a missing Sitemap line and syntax problems', async () => {
    expect(await run(withRobots('User-agent: *\nDisallow:\nbroken line'))).toEqual([
      'SEO-045',
      'SEO-046',
    ]);
  });
  it('says not measured when robots.txt could not be fetched', async () => {
    const result = await runModule(
      seoModule,
      makeContext(makeCrawl({ pages: [goodPage()], ...crawlWith(withRobots('', 0)) })),
    );
    expect(result.status).toBe('partial');
    expect(result.reason).toContain('robots.txt could not be fetched');
  });
});

describe('seo canonical targets', () => {
  it('judges the page that was requested at the canonical URL, not a redirect that ends there', async () => {
    const pages = [
      goodPage({ path: '/about' }),
      makePage({
        url: `${ORIGIN}/old-page`,
        finalUrl: `${ORIGIN}/about`,
        redirectChain: [{ url: `${ORIGIN}/old-page`, status: 301 }],
      }),
    ];
    expect(await codes(pages, withSitemap([`${ORIGIN}/about`]))).not.toContain('SEO-010');
  });
});
