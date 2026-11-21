import { loadPage } from '../../crawler/dom.js';
import { htmlPages, isHomePage, makeFinding, outcome } from '../../checks/support.js';
import { resolveUrl, toCanonicalOrigin } from '../../crawler/url.js';
import type { Check, CheckContext } from '../../model/check.js';
import type { PageRecord } from '../../model/crawl.js';
import type { Finding, Severity } from '../../model/finding.js';
import { canonicalOf, isNoindex, sameUrl } from './page-data.js';

export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;

type Bucket = Map<string, string[]>;

function push(bucket: Bucket, code: string, note: string): void {
  const list = bucket.get(code) ?? [];
  list.push(note);
  bucket.set(code, list);
}

function toFindings(bucket: Bucket, severities: Record<string, Severity>): Finding[] {
  return [...bucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, evidence]) =>
      makeFinding('seo', code, severities[code] ?? 'improvement', evidence),
    );
}

const pageBasics: Check = {
  id: 'seo.page-basics',
  module: 'seo',
  codes: [
    'SEO-001',
    'SEO-002',
    'SEO-003',
    'SEO-004',
    'SEO-005',
    'SEO-006',
    'SEO-013',
    'SEO-014',
    'SEO-015',
    'SEO-025',
    'SEO-026',
    'SEO-027',
    'SEO-028',
  ],
  run(context) {
    const bucket: Bucket = new Map();
    const pages = htmlPages(context);
    for (const page of pages) {
      const $ = loadPage(page);
      if (!$) continue;
      const title = $('head title').first().text().replace(/\s+/g, ' ').trim();
      if (title === '') push(bucket, 'SEO-001', page.url);
      else if (title.length < TITLE_MIN)
        push(bucket, 'SEO-002', `${page.url} (${title.length} characters)`);
      else if (title.length > TITLE_MAX)
        push(bucket, 'SEO-003', `${page.url} (${title.length} characters)`);

      const description = ($('meta[name="description" i]').first().attr('content') ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (description === '') push(bucket, 'SEO-004', page.url);
      else if (description.length < DESCRIPTION_MIN)
        push(bucket, 'SEO-005', `${page.url} (${description.length} characters)`);
      else if (description.length > DESCRIPTION_MAX)
        push(bucket, 'SEO-006', `${page.url} (${description.length} characters)`);

      const h1Count = $('h1').length;
      if (h1Count === 0) push(bucket, 'SEO-013', page.url);
      else if (h1Count > 1) push(bucket, 'SEO-014', `${page.url} (${h1Count} h1 elements)`);

      let previous = 0;
      let skipped = false;
      for (const element of $('h1, h2, h3, h4, h5, h6').toArray()) {
        const level = Number(element.tagName.slice(1));
        if (previous > 0 && level > previous + 1) skipped = true;
        previous = level;
      }
      if (skipped) push(bucket, 'SEO-015', page.url);

      if ($('meta[name="viewport" i]').length === 0) push(bucket, 'SEO-025', page.url);
      if (($('html').attr('lang') ?? '').trim() === '') push(bucket, 'SEO-026', page.url);

      $('img').each((_, element) => {
        const image = $(element);
        const label = `${page.url}: ${image.attr('src') ?? '(no src)'}`;
        if (image.attr('alt') === undefined) push(bucket, 'SEO-027', label);
        if (image.attr('width') === undefined || image.attr('height') === undefined)
          push(bucket, 'SEO-028', label);
      });
    }
    const severities: Record<string, Severity> = {
      'SEO-001': 'important',
      'SEO-004': 'important',
      'SEO-013': 'important',
      'SEO-025': 'important',
    };
    return outcome(toFindings(bucket, severities), { seoPagesAnalyzed: pages.length });
  },
};

function crawledTarget(context: CheckContext, url: string): PageRecord | undefined {
  const target = toCanonicalOrigin(url, context.crawl.host.canonicalOrigin);
  const { pages } = context.crawl;
  // A page that was requested by this URL wins over a page that only ended up here.
  return (
    pages.find((page) => page.url === target) ?? pages.find((page) => page.finalUrl === target)
  );
}

const canonicalAndRobots: Check = {
  id: 'seo.canonical-and-robots-meta',
  module: 'seo',
  codes: ['SEO-007', 'SEO-008', 'SEO-009', 'SEO-010', 'SEO-011', 'SEO-012'],
  run(context) {
    const bucket: Bucket = new Map();
    for (const page of htmlPages(context)) {
      const noindex = isNoindex(page);
      if (noindex) {
        push(bucket, isHomePage(context, page) ? 'SEO-011' : 'SEO-012', page.url);
        continue;
      }
      const canonical = canonicalOf(page);
      if (canonical.raw.length === 0) {
        push(bucket, 'SEO-007', page.url);
        continue;
      }
      if (canonical.raw.some((href) => !/^https?:\/\//i.test(href.trim()))) {
        push(bucket, 'SEO-008', `${page.url}: ${canonical.raw[0] ?? ''}`);
      }
      const target = canonical.resolved;
      if (target === undefined) continue;
      const isParameterised = new URL(page.finalUrl).search !== '';
      if (!sameUrl(target, page.finalUrl) && !sameUrl(target, page.url) && !isParameterised) {
        push(bucket, 'SEO-009', `${page.url} -> ${target}`);
      }
      const crawled = crawledTarget(context, target);
      if (crawled && (crawled.status !== 200 || crawled.redirectChain.length > 0)) {
        push(bucket, 'SEO-010', `${page.url} -> ${target} (${crawled.status})`);
      }
    }
    const severities: Record<string, Severity> = {
      'SEO-007': 'important',
      'SEO-010': 'important',
      'SEO-011': 'critical',
    };
    return outcome(toFindings(bucket, severities));
  },
};

const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i;

const hreflang: Check = {
  id: 'seo.hreflang',
  module: 'seo',
  codes: ['SEO-016', 'SEO-017', 'SEO-018'],
  run(context) {
    const bucket: Bucket = new Map();
    for (const page of htmlPages(context)) {
      const $ = loadPage(page);
      if (!$) continue;
      const alternates = $('link[rel~="alternate"][hreflang]')
        .map((_, element) => ({
          code: ($(element).attr('hreflang') ?? '').trim(),
          href: ($(element).attr('href') ?? '').trim(),
        }))
        .get();
      if (alternates.length === 0) continue;

      for (const { code, href } of alternates) {
        if (code.toLowerCase() !== 'x-default' && !LANGUAGE_CODE.test(code)) {
          push(bucket, 'SEO-016', `${page.url}: ${code}`);
        }
        const absolute = href === '' ? undefined : resolveUrl(href, page.finalUrl);
        const target = absolute === undefined ? undefined : crawledTarget(context, absolute);
        const targetDoc = target && target !== page ? loadPage(target) : undefined;
        if (target && targetDoc) {
          const returnLinks = targetDoc('link[rel~="alternate"][hreflang]')
            .map((_, element) => targetDoc(element).attr('href') ?? '')
            .get();
          const returns = returnLinks.some((link) => {
            const resolved = resolveUrl(link, target.finalUrl);
            return resolved !== undefined && sameUrl(resolved, page.finalUrl);
          });
          if (!returns) push(bucket, 'SEO-017', `${page.url} -> ${target.url}`);
        }
      }
      const languages = new Set(alternates.map((entry) => entry.code.toLowerCase().split('-')[0]));
      const hasDefault = alternates.some((entry) => entry.code.toLowerCase() === 'x-default');
      if (languages.size > 1 && !hasDefault) push(bucket, 'SEO-018', page.url);
    }
    return outcome(toFindings(bucket, { 'SEO-016': 'important', 'SEO-017': 'important' }));
  },
};

const OPEN_GRAPH = ['og:title', 'og:description', 'og:image', 'og:url'];

const social: Check = {
  id: 'seo.social-tags',
  module: 'seo',
  codes: ['SEO-019', 'SEO-020'],
  run(context) {
    const openGraph: string[] = [];
    const twitter: string[] = [];
    const missingTags = new Set<string>();
    for (const page of htmlPages(context)) {
      const $ = loadPage(page);
      if (!$) continue;
      const missing = OPEN_GRAPH.filter(
        (tag) => ($(`meta[property="${tag}"]`).attr('content') ?? '').trim() === '',
      );
      if (missing.length > 0) {
        openGraph.push(`${page.url}: ${missing.join(', ')}`);
        missing.forEach((tag) => missingTags.add(tag));
      }
      if (($('meta[name="twitter:card"]').attr('content') ?? '').trim() === '')
        twitter.push(page.url);
    }
    return outcome([
      ...(openGraph.length > 0
        ? [
            makeFinding('seo', 'SEO-019', 'improvement', openGraph, {
              tags: [...missingTags].join(', '),
            }),
          ]
        : []),
      ...(twitter.length > 0 ? [makeFinding('seo', 'SEO-020', 'improvement', twitter)] : []),
    ]);
  },
};

const favicon: Check = {
  id: 'seo.favicon',
  module: 'seo',
  codes: ['SEO-024'],
  async run(context) {
    const home = context.crawl.pages.find((page) => isHomePage(context, page));
    const $ = home ? loadPage(home) : undefined;
    if (!home || !$) return outcome([], undefined, 'The home page could not be read');
    if ($('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0)
      return outcome([]);
    const url = `${context.crawl.host.canonicalOrigin}/favicon.ico`;
    const response = await context.http.request(url, { method: 'HEAD' }).catch(() => undefined);
    const found = response?.status === 200 && response.contentType.startsWith('image/');
    return outcome(found ? [] : [makeFinding('seo', 'SEO-024', 'improvement', [home.url])]);
  },
};

const urlHygiene: Check = {
  id: 'seo.url-hygiene',
  module: 'seo',
  codes: ['SEO-029', 'SEO-030', 'SEO-031', 'SEO-032'],
  run({ crawl }) {
    const bucket: Bucket = new Map();
    for (const page of crawl.pages) {
      const url = new URL(page.url);
      if (/[A-Z]/.test(url.pathname)) push(bucket, 'SEO-029', page.url);
      if (url.pathname.includes('_')) push(bucket, 'SEO-030', page.url);
      if (page.url.length > 115)
        push(bucket, 'SEO-031', `${page.url} (${page.url.length} characters)`);
      if ([...url.searchParams.keys()].length > 3) push(bucket, 'SEO-032', page.url);
    }
    return outcome(toFindings(bucket, {}));
  },
};

export const seoPageChecks: readonly Check[] = [
  pageBasics,
  canonicalAndRobots,
  hreflang,
  social,
  favicon,
  urlHygiene,
];
