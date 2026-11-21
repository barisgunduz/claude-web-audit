import { isHtmlPage } from '../../crawler/dom.js';
import { isAllowed } from '../../crawler/robots.js';
import { SITEMAP_MAX_BYTES, SITEMAP_MAX_URLS } from '../../crawler/sitemap.js';
import { resolveUrl, toCanonicalOrigin } from '../../crawler/url.js';
import { makeFinding, outcome } from '../../checks/support.js';
import type { Check } from '../../model/check.js';
import type { Finding } from '../../model/finding.js';
import { canonicalOf, isNoindex, sameUrl } from './page-data.js';

const LASTMOD = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

export function isValidLastmod(value: string): boolean {
  return LASTMOD.test(value) && !Number.isNaN(Date.parse(value));
}

const sitemap: Check = {
  id: 'seo.sitemap',
  module: 'seo',
  codes: [
    'SEO-033',
    'SEO-034',
    'SEO-035',
    'SEO-036',
    'SEO-037',
    'SEO-038',
    'SEO-039',
    'SEO-040',
    'SEO-041',
    'SEO-042',
  ],
  run({ crawl }) {
    const { files, urls } = crawl.sitemaps;
    const origin = crawl.host.canonicalOrigin;
    const usable = files.filter((file) => file.kind === 'urlset' || file.kind === 'index');
    if (usable.length === 0) {
      return outcome(
        [
          makeFinding(
            'seo',
            'SEO-033',
            'important',
            files.map((file) => file.url),
          ),
        ],
        {
          sitemapFiles: 0,
          sitemapUrls: 0,
        },
      );
    }

    const findings: Finding[] = [];
    const add = (code: string, severity: 'important' | 'improvement', evidence: string[]): void => {
      if (evidence.length > 0)
        findings.push(makeFinding('seo', code, severity, [...new Set(evidence)]));
    };
    add(
      'SEO-034',
      'important',
      files
        .filter((file) => file.kind === 'invalid')
        .map((file) => `${file.url}: ${file.error ?? 'invalid'}`),
    );
    add(
      'SEO-035',
      'important',
      files
        .filter((file) => file.urlCount > SITEMAP_MAX_URLS || file.bytes > SITEMAP_MAX_BYTES)
        .map((file) => `${file.url} (${file.urlCount} URLs, ${file.bytes} bytes)`),
    );

    const pages = new Map(crawl.pages.map((page) => [page.url, page]));
    const listed = new Set<string>();
    const broken: string[] = [];
    const redirected: string[] = [];
    const noindexed: string[] = [];
    const nonCanonical: string[] = [];
    let checked = 0;
    for (const entry of urls) {
      const absolute = resolveUrl(entry.loc, origin);
      if (absolute === undefined) continue;
      const target = toCanonicalOrigin(absolute, origin);
      listed.add(target);
      if (new URL(absolute).origin !== origin) nonCanonical.push(`${entry.loc} (not on ${origin})`);
      const page = pages.get(target);
      if (!page) continue;
      checked++;
      if (page.status === 0 || page.status >= 400)
        broken.push(`${entry.loc} (${page.status === 0 ? 'no response' : page.status})`);
      else if (page.redirectChain.length > 0) redirected.push(`${entry.loc} -> ${page.finalUrl}`);
      else if (isNoindex(page)) noindexed.push(entry.loc);
      else {
        const canonical = canonicalOf(page).resolved;
        if (canonical !== undefined && !sameUrl(canonical, page.finalUrl))
          nonCanonical.push(`${entry.loc} -> ${canonical}`);
      }
    }
    add('SEO-036', 'important', broken);
    add('SEO-037', 'improvement', redirected);
    add('SEO-038', 'important', noindexed);
    add('SEO-039', 'important', nonCanonical);

    add(
      'SEO-040',
      'improvement',
      urls
        .filter((entry) => entry.lastmod !== undefined && !isValidLastmod(entry.lastmod))
        .map((entry) => `${entry.loc}: ${entry.lastmod ?? ''}`),
    );
    const withoutLastmod = urls.filter((entry) => entry.lastmod === undefined);
    if (urls.length > 0 && withoutLastmod.length > urls.length / 2) {
      add(
        'SEO-041',
        'improvement',
        withoutLastmod.map((entry) => entry.loc),
      );
    }

    const missingFromSitemap = crawl.pages
      .filter((page) => isHtmlPage(page) && page.redirectChain.length === 0 && !isNoindex(page))
      .filter((page) => {
        const canonical = canonicalOf(page).resolved;
        return canonical === undefined || sameUrl(canonical, page.finalUrl);
      })
      .filter((page) => !listed.has(page.url))
      .map((page) => page.url);
    if (urls.length > 0) add('SEO-042', 'improvement', missingFromSitemap);

    return outcome(findings, {
      sitemapFiles: files.length,
      sitemapUrls: urls.length,
      sitemapUrlsCrawled: checked,
    });
  },
};

const robotsTxt: Check = {
  id: 'seo.robots-txt',
  module: 'seo',
  codes: ['SEO-043', 'SEO-044', 'SEO-045', 'SEO-046'],
  run({ crawl }) {
    const { robots } = crawl;
    if (robots.status === 0) return outcome([], undefined, 'robots.txt could not be fetched');
    if (!robots.found) return outcome([makeFinding('seo', 'SEO-043', 'improvement', [robots.url])]);

    const findings: Finding[] = [];
    const blocksAll =
      !isAllowed(robots.parsed, '*', '/') && !isAllowed(robots.parsed, '*', '/index.html');
    if (blocksAll) findings.push(makeFinding('seo', 'SEO-044', 'critical', [robots.url]));
    if (robots.parsed.sitemaps.length === 0)
      findings.push(makeFinding('seo', 'SEO-045', 'improvement', [robots.url]));
    if (robots.parsed.issues.length > 0) {
      findings.push(
        makeFinding(
          'seo',
          'SEO-046',
          'improvement',
          robots.parsed.issues.map((issue) => `line ${issue.line}: ${issue.reason}`),
        ),
      );
    }
    return outcome(findings, { robotsGroups: robots.parsed.groups.length });
  },
};

export const seoSiteChecks: readonly Check[] = [sitemap, robotsTxt];
