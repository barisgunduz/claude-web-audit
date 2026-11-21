import type { Settings } from '../config/types.js';
import type { HttpClient } from '../crawler/http.js';
import type { LabOutcome } from '../engines/measure.js';
import type { AxeRunner } from '../modules/a11y/axe-types.js';
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
  /** Lighthouse measurements, set when the speed module is enabled. */
  lab?: LabOutcome | undefined;
  /** Set when Chrome was found. Without it the a11y module cannot run. */
  axe?: AxeRunner | undefined;
}

export interface CheckOutcome {
  findings: Finding[];
  facts?: Facts;
  /** Set when the check could not measure what it is about. The module becomes partial. */
  notMeasured?: string;
  /** Set when the check measured, but only part of what it covers. The module becomes partial. */
  partial?: string;
}

export interface Check {
  id: string;
  module: ModuleName;
  /** Every finding code this check can produce. */
  codes: readonly string[];
  run(context: CheckContext): CheckOutcome | Promise<CheckOutcome>;
}
