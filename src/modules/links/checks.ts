import { makeFinding, outcome, stripTrailingSlash } from '../../checks/support.js';
import { toCanonicalOrigin } from '../../crawler/url.js';
import type { Check, CheckContext } from '../../model/check.js';
import type { PageRecord } from '../../model/crawl.js';

const GENERIC_TEXT = new Set([
  'click here',
  'here',
  'read more',
  'learn more',
  'more',
  'more info',
  'more information',
  'details',
  'this link',
  'link',
  'continue',
  'view more',
  'see more',
  'find out more',
  'check it out',
]);

/** Statuses that sites return to automated clients while the link works for people. */
const UNVERIFIABLE = new Set([401, 403, 429, 999]);

function pageIndex(context: CheckContext): Map<string, PageRecord> {
  const index = new Map<string, PageRecord>();
  for (const page of context.crawl.pages) {
    index.set(page.url, page);
    index.set(page.finalUrl, page);
  }
  return index;
}

const internalStatus: Check = {
  id: 'links.internal-status',
  module: 'links',
  codes: ['LINK-001', 'LINK-002', 'LINK-003'],
  run(context) {
    const { crawl } = context;
    const clientErrors: string[] = [];
    const serverErrors: string[] = [];
    const unreachable: string[] = [];
    let homeServerError = false;
    let homeUnreachable = false;
    for (const page of crawl.pages) {
      const isHome = page.url === crawl.startUrl;
      if (page.status === 0) {
        unreachable.push(page.url);
        homeUnreachable ||= isHome;
      } else if (page.status >= 500) {
        serverErrors.push(page.url);
        homeServerError ||= isHome;
      } else if (page.status >= 400) {
        clientErrors.push(page.url);
      }
    }
    const findings = [];
    if (clientErrors.length > 0)
      findings.push(makeFinding('links', 'LINK-001', 'important', clientErrors));
    if (serverErrors.length > 0) {
      findings.push(
        makeFinding('links', 'LINK-002', homeServerError ? 'critical' : 'important', serverErrors),
      );
    }
    if (unreachable.length > 0) {
      findings.push(
        makeFinding('links', 'LINK-003', homeUnreachable ? 'critical' : 'important', unreachable),
      );
    }
    const internalLinks = crawl.pages.reduce(
      (sum, page) => sum + page.links.filter((l) => l.internal).length,
      0,
    );
    const unverifiable = crawl.externalLinks.filter((link) => UNVERIFIABLE.has(link.status)).length;
    return outcome(findings, {
      pagesCrawled: crawl.pages.length,
      internalLinksFound: internalLinks,
      externalLinksChecked: crawl.externalLinks.length,
      externalLinksUnverifiable: unverifiable,
      externalCapReached: crawl.limits.externalCapReached,
    });
  },
};

const externalStatus: Check = {
  id: 'links.external-status',
  module: 'links',
  codes: ['LINK-004'],
  run({ crawl }) {
    const broken = crawl.externalLinks.filter(
      (link) => !UNVERIFIABLE.has(link.status) && (link.status === 0 || link.status >= 400),
    );
    const evidence = broken.map(
      (link) => `${link.url} (${link.status === 0 ? 'no response' : link.status})`,
    );
    return outcome(
      evidence.length > 0 ? [makeFinding('links', 'LINK-004', 'important', evidence)] : [],
    );
  },
};

const redirects: Check = {
  id: 'links.redirects',
  module: 'links',
  codes: ['LINK-005', 'LINK-006'],
  run({ crawl }) {
    const long = crawl.pages.filter((page) => !page.redirectLoop && page.redirectChain.length > 3);
    const loops = crawl.pages.filter((page) => page.redirectLoop);
    const findings = [];
    if (long.length > 0) {
      findings.push(
        makeFinding(
          'links',
          'LINK-005',
          'important',
          long.map((p) => `${p.url} (${p.redirectChain.length} hops)`),
        ),
      );
    }
    if (loops.length > 0) {
      findings.push(
        makeFinding(
          'links',
          'LINK-006',
          'important',
          loops.map((p) => p.url),
        ),
      );
    }
    return outcome(findings);
  },
};

const linkTargets: Check = {
  id: 'links.targets',
  module: 'links',
  codes: ['LINK-007', 'LINK-008'],
  run(context) {
    const { crawl } = context;
    const index = pageIndex(context);
    const origin = crawl.host.canonicalOrigin;
    const toRedirect: string[] = [];
    const toVariant: string[] = [];
    for (const page of crawl.pages) {
      for (const link of page.links) {
        if (!link.internal || link.url === undefined) continue;
        const description = `${page.url} -> ${link.url}`;
        if (new URL(link.url).origin !== origin) {
          toVariant.push(description);
          continue;
        }
        const target = index.get(link.url);
        if (
          target &&
          target.redirectChain.length > 0 &&
          stripTrailingSlash(target.url) === stripTrailingSlash(link.url)
        ) {
          toRedirect.push(description);
        }
      }
    }
    const findings = [];
    if (toRedirect.length > 0)
      findings.push(makeFinding('links', 'LINK-007', 'improvement', toRedirect));
    if (toVariant.length > 0)
      findings.push(makeFinding('links', 'LINK-008', 'important', toVariant));
    return outcome(findings);
  },
};

const orphans: Check = {
  id: 'links.orphans',
  module: 'links',
  codes: ['LINK-009'],
  run({ crawl }) {
    if (crawl.limits.pagesCapReached) {
      return outcome([], undefined, 'The page limit was reached, so inbound links are incomplete');
    }
    const inSitemap = new Set(
      crawl.sitemaps.urls.map((entry) => toCanonicalOrigin(entry.loc, crawl.host.canonicalOrigin)),
    );
    const orphanUrls = crawl.pages
      .filter(
        (page) =>
          page.url !== crawl.startUrl &&
          page.status === 200 &&
          page.inbound.length === 0 &&
          inSitemap.has(page.url),
      )
      .map((page) => page.url);
    return outcome(
      orphanUrls.length > 0 ? [makeFinding('links', 'LINK-009', 'important', orphanUrls)] : [],
    );
  },
};

const notFoundPage: Check = {
  id: 'links.not-found-page',
  module: 'links',
  codes: ['LINK-010', 'LINK-011'],
  run({ crawl }) {
    const probe = crawl.notFoundProbe;
    if (probe.status === 0) return outcome([], undefined, 'The 404 test request failed');
    if (probe.status === 404 || probe.status === 410) return outcome([]);
    const detail = `${probe.url} returned ${probe.status}${probe.chain.length > 0 ? ` after ${probe.chain.length} redirect(s)` : ''}`;
    if (probe.status >= 500)
      return outcome([makeFinding('links', 'LINK-011', 'important', [detail])]);
    if (probe.status === 200)
      return outcome([makeFinding('links', 'LINK-010', 'important', [detail])]);
    return outcome([]);
  },
};

function isValidMailto(href: string): boolean {
  const target = decodeURIComponent(href.slice('mailto:'.length).split('?')[0] ?? '').trim();
  if (target === '') return false;
  return target.split(',').every((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()));
}

function isValidTel(href: string): boolean {
  const target = decodeURIComponent(href.slice('tel:'.length)).trim();
  return /^\+?[0-9().\-\s;ext=,]{3,}$/i.test(target) && /\d{3}/.test(target);
}

const hrefHygiene: Check = {
  id: 'links.href-hygiene',
  module: 'links',
  codes: ['LINK-012', 'LINK-013', 'LINK-014', 'LINK-015', 'LINK-016'],
  run({ crawl }) {
    const empty: string[] = [];
    const hash: string[] = [];
    const script: string[] = [];
    const mail: string[] = [];
    const tel: string[] = [];
    for (const page of crawl.pages) {
      for (const { href } of page.links) {
        const lower = href.toLowerCase();
        const note = `${page.url}: ${href === '' ? '(empty)' : href}`;
        try {
          if (href === '') empty.push(note);
          else if (href === '#') hash.push(note);
          else if (lower.startsWith('javascript:')) script.push(note);
          else if (lower.startsWith('mailto:') && !isValidMailto(href)) mail.push(note);
          else if (lower.startsWith('tel:') && !isValidTel(href)) tel.push(note);
        } catch {
          (lower.startsWith('tel:') ? tel : mail).push(note);
        }
      }
    }
    const findings = [
      ...(empty.length > 0 ? [makeFinding('links', 'LINK-012', 'improvement', empty)] : []),
      ...(hash.length > 0 ? [makeFinding('links', 'LINK-013', 'improvement', hash)] : []),
      ...(script.length > 0 ? [makeFinding('links', 'LINK-014', 'improvement', script)] : []),
      ...(mail.length > 0 ? [makeFinding('links', 'LINK-015', 'improvement', mail)] : []),
      ...(tel.length > 0 ? [makeFinding('links', 'LINK-016', 'improvement', tel)] : []),
    ];
    return outcome(findings);
  },
};

function normalizeAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s»«>→…]+$/u, '')
    .replace(/^[\s»«>→]+/u, '')
    .replace(/\.{2,}$/, '')
    .trim();
}

const anchorText: Check = {
  id: 'links.anchor-text',
  module: 'links',
  codes: ['LINK-017'],
  run({ crawl }) {
    const evidence: string[] = [];
    for (const page of crawl.pages) {
      for (const link of page.links) {
        if (link.url !== undefined && GENERIC_TEXT.has(normalizeAnchor(link.text))) {
          evidence.push(`${page.url}: "${link.text}"`);
        }
      }
    }
    return outcome(
      evidence.length > 0 ? [makeFinding('links', 'LINK-017', 'improvement', evidence)] : [],
    );
  },
};

const robotsBlocked: Check = {
  id: 'links.robots-blocked',
  module: 'links',
  codes: ['LINK-018'],
  run({ crawl }) {
    const blocked = crawl.blockedByRobots;
    return outcome(
      blocked.length > 0 ? [makeFinding('links', 'LINK-018', 'improvement', blocked)] : [],
      {
        blockedByRobots: blocked.length,
      },
    );
  },
};

export const linksChecks: readonly Check[] = [
  internalStatus,
  externalStatus,
  redirects,
  linkTargets,
  orphans,
  notFoundPage,
  hrefHygiene,
  anchorText,
  robotsBlocked,
];
