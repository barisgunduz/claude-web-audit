import type { CheckContext, CheckOutcome } from '../model/check.js';
import type { PageRecord } from '../model/crawl.js';
import type { Facts, Finding, FindingData, Severity } from '../model/finding.js';
import type { ModuleName } from '../modules/names.js';
import { isHtmlPage } from '../crawler/dom.js';

export const EVIDENCE_LIMIT = 10;

/** Creates a finding. Evidence is cut to the first ten items, and `count` keeps the real total. */
export function makeFinding(
  module: ModuleName,
  code: string,
  severity: Severity,
  evidence: readonly string[],
  data: FindingData = {},
): Finding {
  return {
    code,
    module,
    severity,
    evidence: evidence.slice(0, EVIDENCE_LIMIT),
    data: { count: evidence.length, ...data },
  };
}

export function outcome(findings: Finding[], facts?: Facts, notMeasured?: string): CheckOutcome {
  return { findings, ...(facts && { facts }), ...(notMeasured !== undefined && { notMeasured }) };
}

/** Pages that returned an HTML document with a 2xx status. */
export function htmlPages(context: CheckContext): PageRecord[] {
  return context.crawl.pages.filter(isHtmlPage);
}

export function isHomePage(context: CheckContext, page: PageRecord): boolean {
  return page.url === context.crawl.startUrl;
}

export function homePage(context: CheckContext): PageRecord | undefined {
  return context.crawl.pages.find((page) => isHomePage(context, page));
}

/** Home page plus up to `limit` other HTML pages, spread evenly over the crawl order. */
export function samplePages(context: CheckContext, limit: number): PageRecord[] {
  const home = homePage(context);
  const others = htmlPages(context).filter((page) => page !== home);
  const step = others.length > limit ? others.length / limit : 1;
  const picked: PageRecord[] = [];
  for (let index = 0; picked.length < Math.min(limit, others.length); index++) {
    const page = others[Math.floor(index * step)];
    if (page) picked.push(page);
  }
  return home && isHtmlPage(home) ? [home, ...picked] : picked;
}

export function stripTrailingSlash(url: string): string {
  return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
}
