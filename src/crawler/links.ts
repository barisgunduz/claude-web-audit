import * as cheerio from 'cheerio';
import type { PageLink } from '../model/crawl.js';
import { bareHost, resolveUrl } from './url.js';

function anchorText($: cheerio.CheerioAPI, element: cheerio.Cheerio<never>): string {
  const text = element.text().replace(/\s+/g, ' ').trim();
  if (text !== '') return text;
  const alt = element.find('img[alt]').first().attr('alt');
  return alt?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Reads every a[href] of a page. Internal means the same site, www and http variants included. */
export function extractLinks(html: string, pageUrl: string, canonicalHost: string): PageLink[] {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').first().attr('href');
  const base = (baseHref ? resolveUrl(baseHref, pageUrl) : undefined) ?? pageUrl;
  const siteHost = bareHost(canonicalHost);
  const links: PageLink[] = [];

  $('a[href]').each((_, node) => {
    const element = $(node) as cheerio.Cheerio<never>;
    const href = (element.attr('href') ?? '').trim();
    const url = href === '' || href.startsWith('#') ? undefined : resolveUrl(href, base);
    links.push({
      href,
      ...(url !== undefined && { url }),
      text: anchorText($, element),
      internal: url !== undefined && bareHost(new URL(url).hostname) === siteHost,
    });
  });
  return links;
}
