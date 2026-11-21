import { randomUUID } from 'node:crypto';
import type {
  CrawlResult,
  PageRecord,
  ProbeRecord,
  RobotsData,
  SitemapData,
  TlsInfo,
} from '../model/crawl.js';
import { checkExternalLinks, collectExternalLinks, EXTERNAL_LINK_CAP } from './external.js';
import { detectCanonicalHost } from './hosts.js';
import { HttpClient } from './http.js';
import { extractLinks } from './links.js';
import { groupsFor, isAllowed, parseRobots } from './robots.js';
import { readSitemaps } from './sitemap.js';
import { probeTls, type TlsProbe } from './tls.js';
import { traceUrl } from './trace.js';
import {
  isPrivateHost,
  pathAndQuery,
  parseDomainInput,
  resolveUrl,
  toCanonicalOrigin,
} from './url.js';

export const ROBOTS_TOKEN = 'claude-web-audit';
export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface CrawlOptions {
  input: string;
  pages: number;
  delayMs: number;
  concurrency: number;
  version: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  tlsProbe?: TlsProbe;
  timeoutMs?: number;
  externalCap?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export function buildUserAgent(version: string): string {
  return `claude-web-audit/${version} (+https://github.com/barisgunduz/claude-web-audit)`;
}

async function fetchRobots(http: HttpClient, origin: string): Promise<RobotsData> {
  const url = `${origin}/robots.txt`;
  const { trace, response } = await traceUrl(http, url, { body: 'text' });
  const found = trace.status === 200 && response !== undefined;
  const text = found ? response.text : '';
  return { url, status: trace.status, found, text, parsed: parseRobots(text) };
}

async function probe(http: HttpClient, url: string, readBody: boolean): Promise<ProbeRecord> {
  const { trace, response } = await traceUrl(http, url, readBody ? { body: 'text' } : {});
  return {
    ...trace,
    contentType: response?.contentType ?? '',
    body: response?.text ?? '',
  };
}

/** Fewest clicks from the home page, by breadth first search over internal links. */
function assignClickDepth(pages: PageRecord[], startUrl: string, origin: string): void {
  const byUrl = new Map<string, PageRecord>();
  for (const page of pages) {
    byUrl.set(page.url, page);
    byUrl.set(page.finalUrl, page);
  }
  const home = byUrl.get(startUrl);
  if (!home) return;
  home.clickDepth = 0;
  const queue = [home];
  // The queue grows while it is walked, and for-of visits the added pages too.
  for (const page of queue) {
    const depth = page.clickDepth ?? 0;
    for (const link of page.links) {
      if (!link.internal || link.url === undefined) continue;
      const target = byUrl.get(toCanonicalOrigin(link.url, origin));
      if (target && target.clickDepth === undefined) {
        target.clickDepth = depth + 1;
        queue.push(target);
      }
    }
  }
}

function assignInbound(pages: PageRecord[], origin: string): void {
  const byUrl = new Map<string, PageRecord>();
  for (const page of pages) {
    byUrl.set(page.url, page);
    byUrl.set(page.finalUrl, page);
  }
  const inbound = new Map<PageRecord, Set<string>>();
  for (const page of pages) {
    for (const link of page.links) {
      if (!link.internal || link.url === undefined) continue;
      const target = byUrl.get(toCanonicalOrigin(link.url, origin));
      if (!target || target === page) continue;
      const sources = inbound.get(target) ?? new Set<string>();
      sources.add(page.url);
      inbound.set(target, sources);
    }
  }
  for (const page of pages) page.inbound = [...(inbound.get(page) ?? [])];
}

/** Crawls one site. A failing page never aborts the crawl, and a stop returns what was found. */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const started = Date.now();
  const log = options.log ?? (() => undefined);
  const userAgent = buildUserAgent(options.version);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const shouldStop = (): boolean => options.signal?.aborted === true;
  const inputHost = parseDomainInput(options.input);
  const http = new HttpClient({
    allowPrivateHosts: isPrivateHost(inputHost),
    userAgent,
    timeoutMs,
    maxBodyBytes: MAX_BODY_BYTES,
    delayMs: options.delayMs,
    ...(options.fetchImpl && { fetchImpl: options.fetchImpl }),
    ...(options.sleep && { sleep: options.sleep }),
    ...(options.signal && { signal: options.signal }),
  });
  const errors: string[] = [];

  log(`Checking host variants for ${inputHost}`);
  const host = await detectCanonicalHost(http, inputHost);
  const origin = host.canonicalOrigin;
  const startUrl = `${origin}/`;

  const robots = await fetchRobots(http, origin);
  const crawlDelay = groupsFor(robots.parsed, ROBOTS_TOKEN).find(
    (group) => group.crawlDelay !== undefined,
  )?.crawlDelay;
  if (crawlDelay !== undefined) http.raiseDelay(Math.min(crawlDelay, 30) * 1000);
  const sitemapCandidates = [...new Set([...robots.parsed.sitemaps, `${origin}/sitemap.xml`])];
  let sitemaps: SitemapData = await readSitemaps(http, sitemapCandidates);

  const notFoundProbe = await probe(http, `${origin}/cwa-404-${randomUUID().slice(0, 8)}`, false);
  const llmsProbe = await probe(http, `${origin}/llms.txt`, true);

  let tls: TlsInfo | undefined;
  if (origin.startsWith('https://')) {
    tls = await (options.tlsProbe ?? probeTls)(host.canonicalHost);
  }

  // The home page first, then sitemap URLs, then links in the order they are found.
  const queue: string[] = [startUrl];
  const queued = new Set<string>(queue);
  const enqueue = (url: string): void => {
    const target = toCanonicalOrigin(url, origin);
    if (new URL(target).hostname !== host.canonicalHost || queued.has(target)) return;
    queued.add(target);
    queue.push(target);
  };
  let sitemapCount = 0;
  for (const entry of sitemaps.urls) {
    const resolved = resolveUrl(entry.loc, origin);
    if (resolved) {
      enqueue(resolved);
      sitemapCount++;
    }
  }
  sitemaps = { ...sitemaps, truncated: sitemapCount > options.pages };

  const pages: PageRecord[] = [];
  const blockedByRobots: string[] = [];
  const fetchedFinals = new Set<string>();
  let cursor = 0;
  let pagesCapReached = false;

  const crawlPage = async (url: string): Promise<void> => {
    const { trace, response } = await traceUrl(http, url, { body: 'text' });
    const isHtml =
      response !== undefined && /text\/html|application\/xhtml/.test(response.contentType);
    const html = isHtml && trace.status >= 200 && trace.status < 300 ? response.text : undefined;
    const page: PageRecord = {
      url,
      finalUrl: trace.finalUrl,
      status: trace.status,
      redirectChain: trace.chain,
      redirectLoop: trace.loop,
      headers: response?.headers ?? {},
      setCookies: response?.setCookies ?? [],
      contentType: response?.contentType ?? '',
      bodyTruncated: response?.bodyTruncated ?? false,
      timingMs: response?.timingMs ?? 0,
      inbound: [],
      links: html === undefined ? [] : extractLinks(html, trace.finalUrl, host.canonicalHost),
      ...(html !== undefined && { html }),
      ...(trace.error !== undefined && { error: trace.error }),
    };
    pages.push(page);
    fetchedFinals.add(trace.finalUrl);
    for (const link of page.links) {
      if (link.internal && link.url !== undefined) enqueue(link.url);
    }
  };

  const takeNext = (): string | undefined => {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      if (url === undefined || fetchedFinals.has(url)) continue;
      if (!isAllowed(robots.parsed, ROBOTS_TOKEN, pathAndQuery(url))) {
        blockedByRobots.push(url);
        continue;
      }
      if (pages.length + inFlight >= options.pages) {
        pagesCapReached = true;
        cursor = queue.length;
        return undefined;
      }
      return url;
    }
    return undefined;
  };

  let inFlight = 0;
  const worker = async (): Promise<void> => {
    while (!shouldStop()) {
      const url = takeNext();
      if (url !== undefined) {
        inFlight++;
        try {
          await crawlPage(url);
        } catch (error) {
          errors.push(`${url}: ${error instanceof Error ? error.message : 'Unexpected error'}`);
        } finally {
          inFlight--;
        }
        continue;
      }
      // Nothing is queued. Wait while other workers may still add links, stop when none can.
      if (inFlight === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  log(`Crawling up to ${options.pages} pages`);
  await Promise.all(Array.from({ length: options.concurrency }, worker));

  assignInbound(pages, origin);
  assignClickDepth(pages, startUrl, origin);

  const externalCap = options.externalCap ?? EXTERNAL_LINK_CAP;
  const collection = collectExternalLinks(pages, externalCap);
  log(`Checking ${collection.urls.size} external links`);
  const externalLinks = shouldStop()
    ? []
    : await checkExternalLinks(http, collection.urls, Math.min(options.concurrency, 4), shouldStop);

  return {
    inputDomain: inputHost,
    startUrl,
    userAgent,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    host,
    robots,
    sitemaps,
    tls,
    pages,
    blockedByRobots,
    externalLinks,
    notFoundProbe,
    llmsProbe,
    limits: {
      pagesCap: options.pages,
      pagesCapReached,
      externalCap,
      externalCapReached: collection.capReached,
      stopped: shouldStop(),
    },
    errors,
  };
}
