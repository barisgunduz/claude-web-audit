import { loadPage } from '../../crawler/dom.js';
import { makeFinding, outcome } from '../../checks/support.js';
import type { Check } from '../../model/check.js';
import type { VariantProbe } from '../../model/crawl.js';
import { daysUntil, evaluateTls } from './evaluate.js';

const PERMANENT = new Set([301, 308]);

const httpsServed: Check = {
  id: 'ssl.https-served',
  module: 'ssl',
  codes: ['SSL-001'],
  run({ crawl }) {
    const origin = crawl.host.canonicalOrigin;
    return outcome(
      origin.startsWith('https://') ? [] : [makeFinding('ssl', 'SSL-001', 'critical', [origin])],
    );
  },
};

const certificate: Check = {
  id: 'ssl.certificate',
  module: 'ssl',
  codes: ['SSL-002', 'SSL-003', 'SSL-004', 'SSL-005', 'SSL-006', 'SSL-007', 'SSL-008'],
  run({ crawl, now }) {
    const { tls } = crawl;
    if (!tls)
      return outcome(
        [],
        undefined,
        'The site is not served over HTTPS, so there is no certificate to check',
      );
    const facts = {
      ...(tls.protocol !== undefined && { tlsProtocol: tls.protocol }),
      ...(tls.validTo !== undefined && { certificateDaysRemaining: daysUntil(tls.validTo, now) }),
    };
    return outcome(evaluateTls(tls, now), facts);
  },
};

function isHttp(variant: VariantProbe): boolean {
  return variant.variant.startsWith('http://');
}

const httpRedirect: Check = {
  id: 'ssl.http-redirect',
  module: 'ssl',
  codes: ['SSL-009', 'SSL-010'],
  run({ crawl }) {
    if (!crawl.host.canonicalOrigin.startsWith('https://')) return outcome([]);
    const reachable = crawl.host.variants.filter(
      (v) => isHttp(v) && v.status > 0 && v.error === undefined,
    );
    const notRedirected = reachable.filter(
      (v) => v.chain.length === 0 && v.finalUrl.startsWith('http://'),
    );
    const temporary = reachable.filter((v) => {
      const upgrade = v.chain.find((hop) => hop.location?.startsWith('https://') === true);
      return upgrade !== undefined && !PERMANENT.has(upgrade.status);
    });
    const findings = [
      ...(notRedirected.length > 0
        ? [
            makeFinding(
              'ssl',
              'SSL-010',
              'important',
              notRedirected.map((v) => v.variant),
            ),
          ]
        : []),
      ...(temporary.length > 0
        ? [
            makeFinding(
              'ssl',
              'SSL-009',
              'important',
              temporary.map((v) => `${v.variant} (${v.chain[0]?.status ?? 0})`),
            ),
          ]
        : []),
    ];
    return outcome(findings);
  },
};

const hostVariants: Check = {
  id: 'ssl.host-variants',
  module: 'ssl',
  codes: ['SSL-011', 'SSL-012'],
  run({ crawl }) {
    const reachable = crawl.host.variants.filter((v) => v.status > 0 && v.error === undefined);
    const findings = [];
    if (!crawl.host.consistent) {
      findings.push(
        makeFinding(
          'ssl',
          'SSL-011',
          'important',
          reachable.map((v) => `${v.variant} -> ${v.finalUrl}`),
        ),
      );
    }
    const temporary = reachable.filter(
      (v) => !isHttp(v) && v.chain.some((hop) => !PERMANENT.has(hop.status)),
    );
    if (temporary.length > 0) {
      findings.push(
        makeFinding(
          'ssl',
          'SSL-012',
          'important',
          temporary.map((v) => `${v.variant} (${v.chain.map((h) => h.status).join(', ')})`),
        ),
      );
    }
    return outcome(findings);
  },
};

/** Selector and the attribute that holds the URL. */
const ACTIVE: readonly (readonly [string, string])[] = [
  ['script[src]', 'src'],
  ['link[rel~="stylesheet"][href]', 'href'],
  ['iframe[src]', 'src'],
  ['form[action]', 'action'],
  ['object[data]', 'data'],
  ['embed[src]', 'src'],
];
const PASSIVE: readonly (readonly [string, string])[] = [
  ['img[src]', 'src'],
  ['img[srcset]', 'srcset'],
  ['source[src]', 'src'],
  ['source[srcset]', 'srcset'],
  ['audio[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
];

function insecureUrls(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
    .filter((candidate) => /^http:\/\//i.test(candidate));
}

const mixedContent: Check = {
  id: 'ssl.mixed-content',
  module: 'ssl',
  codes: ['SSL-013', 'SSL-014'],
  run({ crawl }) {
    const active: string[] = [];
    const passive: string[] = [];
    for (const page of crawl.pages) {
      if (!page.finalUrl.startsWith('https://')) continue;
      const $ = loadPage(page);
      if (!$) continue;
      for (const [selector, attribute] of ACTIVE) {
        $(selector).each((_, element) => {
          for (const url of insecureUrls($(element).attr(attribute)))
            active.push(`${page.url}: ${url}`);
        });
      }
      for (const [selector, attribute] of PASSIVE) {
        $(selector).each((_, element) => {
          for (const url of insecureUrls($(element).attr(attribute)))
            passive.push(`${page.url}: ${url}`);
        });
      }
    }
    const unique = (list: string[]): string[] => [...new Set(list)];
    return outcome([
      ...(active.length > 0 ? [makeFinding('ssl', 'SSL-013', 'important', unique(active))] : []),
      ...(passive.length > 0
        ? [makeFinding('ssl', 'SSL-014', 'improvement', unique(passive))]
        : []),
    ]);
  },
};

export const sslChecks: readonly Check[] = [
  httpsServed,
  certificate,
  httpRedirect,
  hostVariants,
  mixedContent,
];
