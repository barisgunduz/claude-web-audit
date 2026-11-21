import { describe, expect, it } from 'vitest';
import { contentChecks, DEEP_CLICK_DEPTH } from '../../src/modules/content/checks.js';
import {
  jaccard,
  mainText,
  shingles,
  SIMILARITY_THRESHOLD,
  words,
} from '../../src/modules/content/text.js';
import * as cheerio from 'cheerio';
import type { Check } from '../../src/model/check.js';
import {
  codesOf,
  makeContext,
  makeCrawl,
  makePage,
  makeSettings,
  ORIGIN,
  pageHtml,
} from '../support/builders.js';

function check(id: string): Check {
  const found = contentChecks.find((candidate) => candidate.id === `content.${id}`);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}
const sentence = (seed: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${seed}${index % 40} word${index}`).join(' ');
const article = (title: string, body: string, description = 'A description') =>
  pageHtml({
    head: `<title>${title}</title><meta name="description" content="${description}">`,
    body: `<main><h1>${title}</h1><p>${body}</p></main>`,
  });

describe('content.duplicate-meta', () => {
  it('groups pages with the same title or description, ignoring case and spacing', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({ url: `${ORIGIN}/`, html: article('Home page', 'a') }),
        makePage({ url: `${ORIGIN}/a`, html: article('Same  Title', 'b', 'Shared') }),
        makePage({ url: `${ORIGIN}/b`, html: article('same title', 'c', 'shared') }),
        makePage({ url: `${ORIGIN}/c`, html: article('Other', 'd', 'Unique') }),
      ],
    });
    const result = await check('duplicate-meta').run(makeContext(crawl));
    expect(codesOf(result.findings)).toEqual(['CNT-001', 'CNT-002']);
    expect(result.findings[0]?.evidence).toEqual([`${ORIGIN}/a | ${ORIGIN}/b`]);
    expect(result.findings[0]?.data).toMatchObject({ groups: 1, pages: 2 });
  });

  it('ignores empty titles and counts a redirected page once', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({ url: `${ORIGIN}/a`, html: pageHtml() }),
        makePage({ url: `${ORIGIN}/b`, html: pageHtml() }),
        makePage({ url: `${ORIGIN}/x`, finalUrl: `${ORIGIN}/y`, html: article('T', 'a') }),
        makePage({ url: `${ORIGIN}/y`, html: article('T', 'a') }),
      ],
    });
    expect((await check('duplicate-meta').run(makeContext(crawl))).findings).toEqual([]);
  });
});

describe('content.near-duplicates', () => {
  const longText = sentence('alpha', 150);
  it('finds pages with almost the same text and leaves different pages alone', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({ url: `${ORIGIN}/a`, html: article('A', longText) }),
        makePage({
          url: `${ORIGIN}/b`,
          html: article('B', `${longText} one extra closing sentence here`),
        }),
        makePage({ url: `${ORIGIN}/c`, html: article('C', sentence('different', 150)) }),
        makePage({ url: `${ORIGIN}/short`, html: article('S', 'tiny text') }),
      ],
    });
    const result = await check('near-duplicates').run(makeContext(crawl));
    expect(result.findings[0]?.evidence).toEqual([
      expect.stringContaining(`${ORIGIN}/a ~ ${ORIGIN}/b`),
    ]);
    expect(result.facts).toMatchObject({ pagesCompared: 3, nearDuplicatePairs: 1 });
  });

  it('computes similarity on the documented threshold', () => {
    const base = words(sentence('beta', 100));
    const a = shingles(base);
    expect(jaccard(a, shingles(base))).toBe(1);
    expect(jaccard(a, new Set())).toBe(0);
    expect(jaccard(a, shingles(words(sentence('gamma', 100))))).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('ignores navigation, footer and scripts in the main text', () => {
    const $ = cheerio.load(
      '<body><nav>menu menu</nav><header>top</header><main><p>real text</p><script>var a=1</script></main><footer>foot</footer></body>',
    );
    expect(mainText($)).toBe('real text');
    const $body = cheerio.load('<body><nav>menu</nav><p>no main element</p></body>');
    expect(mainText($body)).toBe('no main element');
  });
});

describe('content.thin-content', () => {
  const crawl = makeCrawl({
    pages: [
      makePage({ url: `${ORIGIN}/thin`, html: article('Thin', sentence('t', 50)) }),
      makePage({ url: `${ORIGIN}/rich`, html: article('Rich', sentence('r', 400)) }),
      makePage({ url: `${ORIGIN}/contact`, html: article('Contact', 'Call us') }),
      makePage({ url: `${ORIGIN}/legal/privacy`, html: article('Privacy', 'Short') }),
      makePage({
        url: `${ORIGIN}/hidden`,
        html: pageHtml({ head: '<meta name="robots" content="noindex">', body: 'tiny' }),
      }),
    ],
  });
  it('flags short pages, skips utility and noindex pages, and uses the configured threshold', async () => {
    const result = await check('thin-content').run(makeContext(crawl));
    expect(result.findings[0]?.evidence).toEqual([expect.stringContaining('/thin')]);
    expect(result.facts).toEqual({ utilityPagesSkipped: 2 });
    const strict = await check('thin-content').run(
      makeContext(crawl, { settings: makeSettings({ thinContentWords: 20 }) }),
    );
    expect(strict.findings).toEqual([]);
  });
  it('tests the word count on both sides of the limit', async () => {
    const edge = (count: number) =>
      makeCrawl({
        pages: [
          makePage({
            url: `${ORIGIN}/p`,
            html: pageHtml({
              body: `<main>${Array.from({ length: count }, (_, i) => `w${i}`).join(' ')}</main>`,
            }),
          }),
        ],
      });
    const settings = makeSettings({ thinContentWords: 100 });
    expect(
      (await check('thin-content').run(makeContext(edge(100), { settings }))).findings,
    ).toEqual([]);
    expect(
      codesOf((await check('thin-content').run(makeContext(edge(99), { settings }))).findings),
    ).toEqual(['CNT-004']);
  });
});

describe('content.depth', () => {
  it('flags h5 or h6 and pages deeper than three clicks', async () => {
    const crawl = makeCrawl({
      pages: [
        makePage({ url: `${ORIGIN}/`, clickDepth: 0 }),
        makePage({ url: `${ORIGIN}/three`, clickDepth: DEEP_CLICK_DEPTH }),
        makePage({
          url: `${ORIGIN}/four`,
          clickDepth: DEEP_CLICK_DEPTH + 1,
          html: pageHtml({ body: '<h5>deep</h5>' }),
        }),
        makePage({ url: `${ORIGIN}/none` }),
      ],
    });
    const result = await check('depth').run(makeContext(crawl));
    expect(codesOf(result.findings)).toEqual(['CNT-005', 'CNT-006']);
    expect(result.findings.find((finding) => finding.code === 'CNT-006')?.evidence).toEqual([
      `${ORIGIN}/four (4 clicks)`,
    ]);
    expect(result.facts).toEqual({ maxClickDepth: 4 });
  });
});

describe('content.link-distribution', () => {
  const pages = [
    makePage({ url: `${ORIGIN}/`, inbound: [] }),
    makePage({ url: `${ORIGIN}/hub`, inbound: ['a', 'b', 'c'] }),
    makePage({ url: `${ORIGIN}/one`, inbound: [`${ORIGIN}/`] }),
    makePage({ url: `${ORIGIN}/orphan`, inbound: [] }),
    makePage({ url: `${ORIGIN}/listed-orphan`, inbound: [] }),
  ];
  it('flags weakly linked pages, leaves sitemap orphans to the links module and lists hubs', async () => {
    const crawl = makeCrawl({
      pages,
      sitemaps: {
        files: [],
        truncated: false,
        urls: [{ loc: `${ORIGIN}/listed-orphan`, sitemap: 's' }],
      },
    });
    const result = await check('link-distribution').run(makeContext(crawl));
    expect(result.findings[0]?.evidence.map((line) => line.split(' ')[0])).toEqual([
      `${ORIGIN}/one`,
      `${ORIGIN}/orphan`,
    ]);
    expect(result.facts).toMatchObject({
      topHubPages: [
        `${ORIGIN}/hub (3)`,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ],
    });
  });
  it('says not measured when the page limit was reached', async () => {
    const crawl = makeCrawl({
      pages,
      limits: {
        pagesCap: 5,
        pagesCapReached: true,
        externalCap: 200,
        externalCapReached: false,
        stopped: false,
      },
    });
    expect((await check('link-distribution').run(makeContext(crawl))).notMeasured).toBeDefined();
  });
});
