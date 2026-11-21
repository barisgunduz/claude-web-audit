import type { FetchTrace, Hop } from '../model/crawl.js';
import { HttpError, type BodyMode, type HttpClient, type HttpResponse } from './http.js';
import { resolveUrl } from './url.js';

export const MAX_HOPS = 10;

export interface TraceOptions {
  method?: 'GET' | 'HEAD';
  /** Applies to the last response only, redirect responses never keep a body. */
  body?: BodyMode;
  maxBytes?: number;
  maxHops?: number;
}

export interface TraceResult {
  trace: FetchTrace;
  /** The last response, undefined when the request failed. */
  response: HttpResponse | undefined;
}

/** Follows redirects one hop at a time, so that every hop is recorded. */
export async function traceUrl(
  http: HttpClient,
  url: string,
  options: TraceOptions = {},
): Promise<TraceResult> {
  const chain: Hop[] = [];
  const visited = new Set<string>([url]);
  const maxHops = options.maxHops ?? MAX_HOPS;
  let current = url;

  for (;;) {
    let response: HttpResponse;
    try {
      response = await http.request(current, {
        ...(options.method && { method: options.method }),
        ...(options.body && { body: options.body }),
        ...(options.maxBytes !== undefined && { maxBytes: options.maxBytes }),
      });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'Request failed';
      return {
        trace: { url, finalUrl: current, status: 0, chain, loop: false, error: message },
        response: undefined,
      };
    }

    const next =
      response.status >= 300 && response.status < 400 && response.location
        ? resolveUrl(response.location, current)
        : undefined;
    if (next === undefined) {
      return {
        trace: { url, finalUrl: current, status: response.status, chain, loop: false },
        response,
      };
    }

    chain.push({ url: current, status: response.status, location: next });
    if (visited.has(next)) {
      return {
        trace: { url, finalUrl: next, status: response.status, chain, loop: true },
        response,
      };
    }
    if (chain.length >= maxHops) {
      return {
        trace: {
          url,
          finalUrl: next,
          status: response.status,
          chain,
          loop: false,
          error: 'Too many redirects',
        },
        response,
      };
    }
    visited.add(next);
    current = next;
  }
}
