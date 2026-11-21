import type { HostDecision, VariantProbe } from '../model/crawl.js';
import type { HttpClient } from './http.js';
import { traceUrl } from './trace.js';
import { bareHost } from './url.js';

export class CrawlError extends Error {
  override readonly name = 'CrawlError';
}

/** True when a URL is on the same site (www or not) and uses the default port. */
function endsOnSite(url: string, bare: string): boolean {
  const parsed = new URL(url);
  return bareHost(parsed.hostname) === bare && parsed.port === '';
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
  // The audit stays on the given domain. A variant that ends on another site is not a candidate.
  const onSite = reachable.filter((variant) => endsOnSite(variant.finalUrl, bare));
  const preferred =
    onSite.find((variant) => variant.variant === `https://${inputHost}/`) ??
    onSite.find((variant) => variant.variant.startsWith('https://')) ??
    onSite[0];
  if (!preferred) {
    const elsewhere = reachable[0] ? new URL(reachable[0].finalUrl).hostname : undefined;
    throw new CrawlError(
      elsewhere === undefined
        ? `Could not reach ${inputHost} on http or https, with or without www.`
        : `${inputHost} redirects to ${elsewhere}. Audit that domain instead.`,
    );
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
