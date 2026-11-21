import type { HostDecision, VariantProbe } from '../model/crawl.js';
import type { HttpClient } from './http.js';
import { traceUrl } from './trace.js';
import { bareHost } from './url.js';

export class CrawlError extends Error {
  override readonly name = 'CrawlError';
}

/** Tests http and https, with and without www, and decides which host is canonical. */
export async function detectCanonicalHost(
  http: HttpClient,
  inputHost: string,
): Promise<HostDecision> {
  const bare = bareHost(inputHost);
  const hosts = [bare, `www.${bare}`];
  const urls = ['https', 'http'].flatMap((scheme) => hosts.map((host) => `${scheme}://${host}/`));

  const variants: VariantProbe[] = [];
  for (const variant of urls) {
    const { trace } = await traceUrl(http, variant);
    variants.push({ ...trace, variant });
  }

  const reachable = variants.filter((variant) => variant.status > 0 && variant.error === undefined);
  const preferred =
    reachable.find((variant) => variant.variant === `https://${inputHost}/`) ??
    reachable.find((variant) => variant.variant.startsWith('https://')) ??
    reachable[0];
  if (!preferred) {
    throw new CrawlError(`Could not reach ${inputHost} on http or https, with or without www.`);
  }

  const canonical = new URL(preferred.finalUrl);
  const finals = new Set(reachable.map((variant) => variant.finalUrl));
  return {
    inputHost,
    canonicalHost: canonical.hostname,
    canonicalOrigin: canonical.origin,
    variants,
    consistent: finals.size === 1,
  };
}
