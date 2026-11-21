import type { ExternalLinkRecord, PageRecord } from '../model/crawl.js';
import type { HttpClient } from './http.js';
import { runPool } from './pool.js';
import { traceUrl } from './trace.js';

export const EXTERNAL_LINK_CAP = 200;
const HEAD_REJECTED = new Set([400, 403, 404, 405, 501]);

export interface ExternalCollection {
  urls: Map<string, string[]>;
  capReached: boolean;
}

/** Unique external URLs in the order they were found, with the pages that link to them. */
export function collectExternalLinks(
  pages: readonly PageRecord[],
  cap: number,
): ExternalCollection {
  const urls = new Map<string, string[]>();
  let capReached = false;
  for (const page of pages) {
    for (const link of page.links) {
      if (link.internal || link.url === undefined) continue;
      const sources = urls.get(link.url);
      if (sources) {
        if (!sources.includes(page.url) && sources.length < 5) sources.push(page.url);
      } else if (urls.size < cap) {
        urls.set(link.url, [page.url]);
      } else {
        capReached = true;
      }
    }
  }
  return { urls, capReached };
}

/** Checks status codes only. HEAD first, GET when HEAD is rejected or fails. */
export async function checkExternalLinks(
  http: HttpClient,
  urls: ReadonlyMap<string, string[]>,
  concurrency: number,
  shouldStop: () => boolean,
): Promise<ExternalLinkRecord[]> {
  const records: ExternalLinkRecord[] = [];
  await runPool(
    [...urls.entries()],
    concurrency,
    async ([url, sources]) => {
      let { trace } = await traceUrl(http, url, { method: 'HEAD', maxHops: 5 });
      if (trace.status === 0 || HEAD_REJECTED.has(trace.status)) {
        ({ trace } = await traceUrl(http, url, { method: 'GET', body: 'none', maxHops: 5 }));
      }
      records.push({
        url,
        status: trace.status,
        finalUrl: trace.finalUrl,
        sources,
        ...(trace.error !== undefined && { error: trace.error }),
      });
    },
    shouldStop,
  );
  const order = [...urls.keys()];
  return records.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
}
