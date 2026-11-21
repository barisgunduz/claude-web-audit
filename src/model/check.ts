import type { Settings } from '../config/types.js';
import type { HttpClient } from '../crawler/http.js';
import type { DnsResolver } from '../modules/email/dns.js';
import type { CrawlResult } from './crawl.js';
import type { Facts, Finding } from './finding.js';
import type { ModuleName } from '../modules/names.js';

export interface CheckContext {
  crawl: CrawlResult;
  settings: Settings;
  http: HttpClient;
  dns: DnsResolver;
  /** The current time, injected so that tests do not depend on the clock. */
  now: Date;
}

export interface CheckOutcome {
  findings: Finding[];
  facts?: Facts;
  /** Set when the check could not measure what it is about. The module becomes partial. */
  notMeasured?: string;
}

export interface Check {
  id: string;
  module: ModuleName;
  /** Every finding code this check can produce. */
  codes: readonly string[];
  run(context: CheckContext): CheckOutcome | Promise<CheckOutcome>;
}
