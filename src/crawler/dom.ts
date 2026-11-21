import * as cheerio from 'cheerio';
import type { PageRecord } from '../model/crawl.js';

const cache = new WeakMap<PageRecord, cheerio.CheerioAPI>();

/** Parses the HTML of a page once and reuses the result. */
export function loadPage(page: PageRecord): cheerio.CheerioAPI | undefined {
  if (page.html === undefined) return undefined;
  const cached = cache.get(page);
  if (cached) return cached;
  const document = cheerio.load(page.html);
  cache.set(page, document);
  return document;
}

export function isHtmlPage(page: PageRecord): boolean {
  return page.status >= 200 && page.status < 300 && page.html !== undefined;
}

export function visibleText($: cheerio.CheerioAPI): string {
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg').remove();
  return body.text().replace(/\s+/g, ' ').trim();
}
