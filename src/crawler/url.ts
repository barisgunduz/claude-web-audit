/** Lowercase host without a leading "www.". */
export function bareHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

export class InputError extends Error {
  override readonly name = 'InputError';
}

/** Turns "domain.com" or a full URL into a lowercase host name. Paths and ports are ignored. */
export function parseDomainInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '' || /\s/.test(trimmed)) throw new InputError(`Not a valid domain: "${input}"`);
  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new InputError(`Not a valid domain: "${input}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InputError(`Only http and https addresses can be audited: "${input}"`);
  }
  if (url.hostname === '') throw new InputError(`Not a valid domain: "${input}"`);
  return url.hostname.toLowerCase();
}

/** Resolves a link against a base. Returns undefined for anything that is not an http(s) URL. */
export function resolveUrl(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/** Moves a URL onto the canonical origin, so www and http variants map to one page. */
export function toCanonicalOrigin(url: string, canonicalOrigin: string): string {
  const parsed = new URL(url);
  const canonical = new URL(canonicalOrigin);
  if (bareHost(parsed.hostname) !== bareHost(canonical.hostname)) return url;
  parsed.protocol = canonical.protocol;
  parsed.host = canonical.host;
  return parsed.href;
}

export function pathAndQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
