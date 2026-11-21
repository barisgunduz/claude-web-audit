import { loadPage } from '../../crawler/dom.js';
import { toCanonicalOrigin } from '../../crawler/url.js';
import { htmlPages, isHomePage, makeFinding, outcome } from '../../checks/support.js';
import type { Check } from '../../model/check.js';
import type { PageRecord } from '../../model/crawl.js';
import { isNoindex } from '../seo/page-data.js';
import {
  jaccard,
  mainText,
  MIN_WORDS_FOR_COMPARISON,
  shingles,
  SIMILARITY_THRESHOLD,
  words,
} from './text.js';

export const DEEP_CLICK_DEPTH = 3;
const MAX_NEAR_DUPLICATE_PAGES = 300;
/** Path segments of pages that are short on purpose, such as contact and legal pages. */
const UTILITY_SEGMENTS = new Set([
  'contact',
  'contact-us',
  'privacy',
  'privacy-policy',
  'terms',
  'terms-of-service',
  'legal',
  'imprint',
  'impressum',
  'cookie',
  'cookies',
  'cookie-policy',
  'disclaimer',
  'login',
  'log-in',
  'sign-in',
  'register',
  'sign-up',
  'cart',
  'checkout',
  'thank-you',
  'search',
  '404',
  'sitemap',
  'accessibility',
  'unsubscribe',
]);

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isUtilityPage(page: PageRecord): boolean {
  return new URL(page.finalUrl).pathname
    .toLowerCase()
    .split('/')
    .some((segment) => UTILITY_SEGMENTS.has(segment));
}

function distinctPages(pages: PageRecord[]): PageRecord[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.finalUrl)) return false;
    seen.add(page.finalUrl);
    return true;
  });
}

function duplicateGroups(pages: PageRecord[], read: (page: PageRecord) => string): string[][] {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const value = normalize(read(page));
    if (value === '') continue;
    groups.set(value, [...(groups.get(value) ?? []), page.finalUrl]);
  }
  return [...groups.values()].filter((urls) => urls.length > 1);
}

const duplicates: Check = {
  id: 'content.duplicate-meta',
  module: 'content',
  codes: ['CNT-001', 'CNT-002'],
  run(context) {
    const pages = distinctPages(htmlPages(context));
    const titles = duplicateGroups(
      pages,
      (page) => loadPage(page)?.('head title').first().text() ?? '',
    );
    const descriptions = duplicateGroups(
      pages,
      (page) => loadPage(page)?.('meta[name="description" i]').first().attr('content') ?? '',
    );
    const evidence = (groups: string[][]): string[] => groups.map((urls) => urls.join(' | '));
    return outcome(
      [
        ...(titles.length > 0
          ? [
              makeFinding('content', 'CNT-001', 'important', evidence(titles), {
                groups: titles.length,
                pages: titles.flat().length,
              }),
            ]
          : []),
        ...(descriptions.length > 0
          ? [
              makeFinding('content', 'CNT-002', 'improvement', evidence(descriptions), {
                groups: descriptions.length,
                pages: descriptions.flat().length,
              }),
            ]
          : []),
      ],
      { duplicateTitleGroups: titles.length, duplicateDescriptionGroups: descriptions.length },
    );
  },
};

const nearDuplicates: Check = {
  id: 'content.near-duplicates',
  module: 'content',
  codes: ['CNT-003'],
  run(context) {
    const candidates = distinctPages(htmlPages(context))
      .filter((page) => !isNoindex(page))
      .slice(0, MAX_NEAR_DUPLICATE_PAGES)
      .map((page) => {
        const $ = loadPage(page);
        const list = $ ? words(mainText($)) : [];
        return { url: page.finalUrl, count: list.length, shingles: shingles(list) };
      })
      .filter((entry) => entry.count >= MIN_WORDS_FOR_COMPARISON);
    const pairs: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (!a || !b) continue;
        const similarity = jaccard(a.shingles, b.shingles);
        if (similarity >= SIMILARITY_THRESHOLD)
          pairs.push(`${a.url} ~ ${b.url} (${Math.round(similarity * 100)}%)`);
      }
    }
    return outcome(
      pairs.length > 0
        ? [
            makeFinding('content', 'CNT-003', 'important', pairs, {
              threshold: SIMILARITY_THRESHOLD,
            }),
          ]
        : [],
      { nearDuplicatePairs: pairs.length, pagesCompared: candidates.length },
    );
  },
};

const thinContent: Check = {
  id: 'content.thin-content',
  module: 'content',
  codes: ['CNT-004'],
  run(context) {
    const thin: string[] = [];
    let skipped = 0;
    for (const page of distinctPages(htmlPages(context))) {
      const $ = loadPage(page);
      if (!$ || isNoindex(page)) continue;
      if (isUtilityPage(page)) {
        skipped++;
        continue;
      }
      const count = words(mainText($)).length;
      if (count < context.settings.thinContentWords) thin.push(`${page.finalUrl} (${count} words)`);
    }
    return outcome(
      thin.length > 0
        ? [
            makeFinding('content', 'CNT-004', 'improvement', thin, {
              minimum: context.settings.thinContentWords,
            }),
          ]
        : [],
      { utilityPagesSkipped: skipped },
    );
  },
};

const depth: Check = {
  id: 'content.depth',
  module: 'content',
  codes: ['CNT-005', 'CNT-006'],
  run(context) {
    const deepHeadings: string[] = [];
    const deepClicks: string[] = [];
    let maxClickDepth = 0;
    for (const page of htmlPages(context)) {
      const $ = loadPage(page);
      if ($ && $('h5, h6').length > 0) deepHeadings.push(page.url);
      if (page.clickDepth !== undefined) {
        maxClickDepth = Math.max(maxClickDepth, page.clickDepth);
        if (page.clickDepth > DEEP_CLICK_DEPTH)
          deepClicks.push(`${page.url} (${page.clickDepth} clicks)`);
      }
    }
    return outcome(
      [
        ...(deepHeadings.length > 0
          ? [makeFinding('content', 'CNT-005', 'improvement', deepHeadings)]
          : []),
        ...(deepClicks.length > 0
          ? [
              makeFinding('content', 'CNT-006', 'improvement', deepClicks, {
                limit: DEEP_CLICK_DEPTH,
              }),
            ]
          : []),
      ],
      { maxClickDepth },
    );
  },
};

const linkDistribution: Check = {
  id: 'content.link-distribution',
  module: 'content',
  codes: ['CNT-007'],
  run(context) {
    const { crawl } = context;
    if (crawl.limits.pagesCapReached) {
      return outcome([], undefined, 'The page limit was reached, so inbound links are incomplete');
    }
    const pages = htmlPages(context);
    // Pages with no inbound link that are in a sitemap are orphans, and links.orphans owns them.
    const listed = new Set(
      crawl.sitemaps.urls.map((entry) => toCanonicalOrigin(entry.loc, crawl.host.canonicalOrigin)),
    );
    const weak = pages
      .filter((page) => !isHomePage(context, page))
      .filter(
        (page) => page.inbound.length === 1 || (page.inbound.length === 0 && !listed.has(page.url)),
      )
      .map(
        (page) =>
          `${page.url} (${page.inbound.length} inbound link${page.inbound.length === 1 ? '' : 's'})`,
      );
    const hubs = [...pages]
      .sort((a, b) => b.inbound.length - a.inbound.length)
      .slice(0, 5)
      .map((page) => `${page.url} (${page.inbound.length})`);
    return outcome(
      weak.length > 0 ? [makeFinding('content', 'CNT-007', 'improvement', weak)] : [],
      {
        topHubPages: hubs,
      },
    );
  },
};

export const contentChecks: readonly Check[] = [
  duplicates,
  nearDuplicates,
  thinContent,
  depth,
  linkDistribution,
];
