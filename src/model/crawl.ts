import type { ParsedRobots } from '../crawler/robots.js';

export interface Hop {
  url: string;
  status: number;
  location?: string;
}

/** The result of following one URL, one hop at a time. */
export interface FetchTrace {
  url: string;
  finalUrl: string;
  status: number;
  chain: Hop[];
  loop: boolean;
  /** Set when the request failed before a response arrived. */
  error?: string;
}

export interface PageLink {
  /** The raw href attribute. */
  href: string;
  /** The absolute URL, or undefined when the href is empty, "#" or not a web URL. */
  url?: string;
  text: string;
  internal: boolean;
}

export interface PageRecord {
  url: string;
  finalUrl: string;
  status: number;
  redirectChain: Hop[];
  redirectLoop: boolean;
  headers: Record<string, string>;
  setCookies: string[];
  contentType: string;
  html?: string;
  bodyTruncated: boolean;
  timingMs: number;
  /** Fewest clicks from the home page, undefined when no link path exists. */
  clickDepth?: number;
  /** Unique crawled pages that link to this page. */
  inbound: string[];
  links: PageLink[];
  error?: string;
}

export interface VariantProbe extends FetchTrace {
  variant: string;
}

export interface HostDecision {
  inputHost: string;
  canonicalHost: string;
  canonicalOrigin: string;
  variants: VariantProbe[];
  /** True when every reachable variant ends on one final URL. */
  consistent: boolean;
}

export interface RobotsData {
  url: string;
  status: number;
  found: boolean;
  text: string;
  parsed: ParsedRobots;
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  sitemap: string;
}

export interface SitemapFile {
  url: string;
  status: number;
  kind: 'urlset' | 'index' | 'invalid' | 'missing';
  gzip: boolean;
  bytes: number;
  urlCount: number;
  error?: string;
}

export interface SitemapData {
  files: SitemapFile[];
  urls: SitemapUrl[];
  /** True when the URL list was cut because of the page cap. */
  truncated: boolean;
}

export interface TlsInfo {
  host: string;
  reachable: boolean;
  error?: string;
  protocol?: string;
  validFrom?: string;
  validTo?: string;
  subjectAltNames: string[];
  hostnameMatches: boolean;
  authorized: boolean;
  authorizationError?: string;
}

export interface ExternalLinkRecord {
  url: string;
  status: number;
  finalUrl: string;
  error?: string;
  sources: string[];
}

export interface ProbeRecord extends FetchTrace {
  contentType: string;
  body: string;
}

export interface CrawlLimits {
  pagesCap: number;
  pagesCapReached: boolean;
  externalCap: number;
  externalCapReached: boolean;
  stopped: boolean;
}

export interface CrawlResult {
  inputDomain: string;
  startUrl: string;
  userAgent: string;
  startedAt: string;
  durationMs: number;
  host: HostDecision;
  robots: RobotsData;
  sitemaps: SitemapData;
  tls: TlsInfo | undefined;
  pages: PageRecord[];
  blockedByRobots: string[];
  externalLinks: ExternalLinkRecord[];
  notFoundProbe: ProbeRecord;
  llmsProbe: ProbeRecord;
  limits: CrawlLimits;
  errors: string[];
}
