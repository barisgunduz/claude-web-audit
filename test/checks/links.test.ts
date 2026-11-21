import { describe, expect, it } from 'vitest';
import { linksChecks } from '../../src/modules/links/checks.js';
import type { Check } from '../../src/model/check.js';
import {
  codesOf,
  makeContext,
  makeCrawl,
  makePage,
  ORIGIN,
  pageHtml,
  withRobots,
} from '../support/builders.js';

function check(id: string): Check {
  const found = linksChecks.find((candidate) => candidate.id === `links.${id}`);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}
const home = `${ORIGIN}/`;
const body = (inner: string): string => pageHtml({ body: inner });

describe('links.internal-status', () => {
  it('flags 4xx, 5xx and unreachable pages', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({ url: home }),
        makePage({ url: `${ORIGIN}/a`, status: 404, html: undefined }),
        makePage({ url: `${ORIGIN}/b`, status: 503, html: undefined }),
        makePage({ url: `${ORIGIN}/c`, status: 0, html: undefined, error: 'Timed out' }),
      ],
    });
    const result = await check('internal-status').run(makeContext(crawl));
    expect(codesOf(result.findings)).toEqual(['LINK-001', 'LINK-002', 'LINK-003']);
    expect(result.findings.map((finding) => finding.severity)).toEqual([
      'important',
      'important',
      'important',
    ]);
    expect(result.facts).toMatchObject({ pagesCrawled: 4 });
  });

  it('makes a failing home page critical', async () => {
    const down = makeCrawl({ pages: [makePage({ url: home, status: 500, html: undefined })] });
    expect((await check('internal-status').run(makeContext(down))).findings[0]).toMatchObject({
      code: 'LINK-002',
      severity: 'critical',
    });
    const silent = makeCrawl({ pages: [makePage({ url: home, status: 0, html: undefined })] });
    expect((await check('internal-status').run(makeContext(silent))).findings[0]).toMatchObject({
      code: 'LINK-003',
      severity: 'critical',
    });
  });

  it('reports nothing for healthy pages', async () => {
    const result = await check('internal-status').run(
      makeContext(makeCrawl({ pages: [makePage({ url: home })] })),
    );
    expect(result.findings).toEqual([]);
  });
});

describe('links.external-status', () => {
  it('flags broken links and ignores statuses that bots get for working pages', async () => {
    const link = (url: string, status: number) => ({ url, status, finalUrl: url, sources: [home] });
    const crawl = makeCrawl({
      externalLinks: [
        link('https://a.test/', 200),
        link('https://b.test/', 404),
        link('https://c.test/', 0),
        link('https://d.test/', 403),
        link('https://e.test/', 999),
        link('https://f.test/', 503),
      ],
    });
    const result = await check('external-status').run(makeContext(crawl));
    expect(result.findings[0]?.evidence).toEqual([
      'https://b.test/ (404)',
      'https://c.test/ (no response)',
      'https://f.test/ (503)',
    ]);
    expect(result.findings[0]?.code).toBe('LINK-004');
  });
});

describe('links.redirects', () => {
  const hops = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ url: `${ORIGIN}/h${index}`, status: 301 }));
  it('flags chains over three hops and loops, not three hops', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({ url: `${ORIGIN}/three`, redirectChain: hops(3) }),
        makePage({ url: `${ORIGIN}/four`, redirectChain: hops(4) }),
        makePage({ url: `${ORIGIN}/loop`, redirectChain: hops(2), redirectLoop: true }),
      ],
    });
    const result = await check('redirects').run(makeContext(crawl));
    expect(result.findings.map((finding) => [finding.code, finding.evidence])).toEqual([
      ['LINK-005', [`${ORIGIN}/four (4 hops)`]],
      ['LINK-006', [`${ORIGIN}/loop`]],
    ]);
  });
});

describe('links.targets', () => {
  it('flags links to redirecting URLs and to non-canonical variants', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({
          url: home,
          html: body(
            '<a href="/old">old</a><a href="http://example.test/new">http</a><a href="https://www.example.test/new">www</a><a href="/new">fine</a>',
          ),
        }),
        makePage({
          url: `${ORIGIN}/old`,
          finalUrl: `${ORIGIN}/new`,
          redirectChain: [{ url: `${ORIGIN}/old`, status: 301 }],
        }),
        makePage({ url: `${ORIGIN}/new` }),
      ],
    });
    const result = await check('targets').run(makeContext(crawl));
    expect(codesOf(result.findings)).toEqual(['LINK-007', 'LINK-008']);
    expect(result.findings.find((finding) => finding.code === 'LINK-008')?.data.count).toBe(2);
  });
});

describe('links.orphans', () => {
  const sitemap = {
    files: [],
    urls: [
      { loc: `${ORIGIN}/lonely`, sitemap: 's' },
      { loc: `${ORIGIN}/linked`, sitemap: 's' },
    ],
    truncated: false,
  };
  const pages = [
    makePage({ url: home }),
    makePage({ url: `${ORIGIN}/lonely`, inbound: [] }),
    makePage({ url: `${ORIGIN}/linked`, inbound: [home] }),
  ];

  it('flags sitemap pages that nobody links to', async () => {
    const result = await check('orphans').run(makeContext(makeCrawl({ pages, sitemaps: sitemap })));
    expect(result.findings[0]?.evidence).toEqual([`${ORIGIN}/lonely`]);
  });

  it('says not measured when the page limit was reached', async () => {
    const crawl = makeCrawl({
      pages,
      sitemaps: sitemap,
      limits: {
        pagesCap: 3,
        pagesCapReached: true,
        externalCap: 200,
        externalCapReached: false,
        stopped: false,
      },
    });
    const result = await check('orphans').run(makeContext(crawl));
    expect(result.findings).toEqual([]);
    expect(result.notMeasured).toContain('page limit');
  });
});

describe('links.not-found-page', () => {
  const probe = (status: number, chain = 0) => ({
    url: `${ORIGIN}/x`,
    finalUrl: `${ORIGIN}/x`,
    status,
    chain: Array.from({ length: chain }, () => ({ url: 'u', status: 302 })),
    loop: false,
    contentType: '',
    body: '',
  });
  it.each([
    [404, 0, []],
    [410, 0, []],
    [200, 0, ['LINK-010']],
    [200, 1, ['LINK-010']],
    [503, 0, ['LINK-011']],
    [403, 0, []],
  ])('status %i after %i redirects gives %j', async (status, chain, expected) => {
    const result = await check('not-found-page').run(
      makeContext(makeCrawl({ notFoundProbe: probe(status, chain) })),
    );
    expect(codesOf(result.findings)).toEqual(expected);
  });

  it('says not measured when the test request failed', async () => {
    const result = await check('not-found-page').run(
      makeContext(makeCrawl({ notFoundProbe: probe(0) })),
    );
    expect(result.notMeasured).toBeDefined();
  });
});

describe('links.href-hygiene', () => {
  it('flags empty, hash, javascript, mailto and tel problems', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({
          url: home,
          html: body(
            [
              '<a href="">a</a>',
              '<a href="#">b</a>',
              '<a href="#section">fine</a>',
              '<a href="javascript:void(0)">c</a>',
              '<a href="mailto:">d</a>',
              '<a href="mailto:not-an-address">e</a>',
              '<a href="mailto:ok@example.com?subject=Hi">fine</a>',
              '<a href="mailto:a@example.com,b@example.com">fine</a>',
              '<a href="mailto:%E0%A4%A">bad escape</a>',
              '<a href="tel:abc">f</a>',
              '<a href="tel:+90 555 123 45 67">fine</a>',
            ].join(''),
          ),
        }),
      ],
    });
    const result = await check('href-hygiene').run(makeContext(crawl));
    const evidence = Object.fromEntries(
      result.findings.map((finding) => [finding.code, finding.evidence.length]),
    );
    expect(evidence).toEqual({
      'LINK-012': 1,
      'LINK-013': 1,
      'LINK-014': 1,
      'LINK-015': 3,
      'LINK-016': 1,
    });
  });
});

describe('links.anchor-text', () => {
  it('flags generic text, including arrows and image-only links', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({
          url: home,
          html: body(
            '<a href="/a">Click here</a><a href="/b">Read more »</a><a href="/c">Pricing</a><a href="/d"><img src="x.png" alt="Learn more"></a><a href="/e">here...</a>',
          ),
        }),
      ],
    });
    const result = await check('anchor-text').run(makeContext(crawl));
    expect(result.findings[0]?.evidence).toHaveLength(4);
  });
});

describe('links.robots-blocked', () => {
  it('lists blocked links', async () => {
    const crawl = makeCrawl({
      blockedByRobots: [`${ORIGIN}/private`],
      robots: withRobots('User-agent: *\nDisallow: /private'),
    });
    const result = await check('robots-blocked').run(makeContext(crawl));
    expect(codesOf(result.findings)).toEqual(['LINK-018']);
    expect(result.facts).toEqual({ blockedByRobots: 1 });
  });
});
