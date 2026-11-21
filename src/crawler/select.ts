import { isHtmlPage } from './dom.js';
import type { CrawlResult } from '../model/crawl.js';

/**
 * The home page first, then the most linked HTML pages. Ties keep crawl order.
 * Returns the final URL of each page, so redirects are not measured twice.
 */
export function pickPages(crawl: CrawlResult, limit: number): string[] {
  const seen = new Set<string>();
  const unique = crawl.pages.filter((page) => {
    if (!isHtmlPage(page) || seen.has(page.finalUrl)) return false;
    seen.add(page.finalUrl);
    return true;
  });
  const home = unique.find((page) => page.url === crawl.startUrl);
  const others = unique
    .filter((page) => page !== home)
    .map((page, order) => ({ page, order }))
    .sort((a, b) => b.page.inbound.length - a.page.inbound.length || a.order - b.order)
    .map(({ page }) => page);
  return [...(home ? [home] : []), ...others].slice(0, limit).map((page) => page.finalUrl);
}
