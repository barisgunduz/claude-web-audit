import type { Settings } from '../config/types.js';
import { crawl } from '../crawler/crawl.js';
import { HttpClient } from '../crawler/http.js';
import { isPrivateHost } from '../crawler/address.js';
import { createTransport } from '../crawler/guarded-fetch.js';
import { parseDomainInput } from '../crawler/url.js';
import type { CheckContext } from '../model/check.js';
import type { CrawlResult } from '../model/crawl.js';
import type { ModuleResult } from '../model/finding.js';
import { createSystemResolver } from '../modules/email/dns.js';
import { MODULES } from '../modules/registry.js';
import { runModule } from '../modules/runner.js';
import { buildUserAgent, MAX_BODY_BYTES, REQUEST_TIMEOUT_MS } from '../crawler/crawl.js';
import type { AuditDeps } from './deps.js';

export interface AuditRun {
  crawl: CrawlResult;
  modules: ModuleResult[];
}

export interface AuditInput {
  settings: Settings;
  version: string;
  deps?: AuditDeps;
  log?: (message: string) => void;
}

/** Crawls the site, then runs the enabled modules. */
export async function runAudit({
  settings,
  version,
  deps = {},
  log,
}: AuditInput): Promise<AuditRun> {
  const inputHost = parseDomainInput(settings.domain);
  const allowPrivate = isPrivateHost(inputHost);
  // Real requests share one transport that refuses private addresses. Tests inject their own fetch.
  const transport = deps.fetchImpl ? undefined : createTransport({ allowPrivate });
  const fetchImpl = deps.fetchImpl ?? transport?.fetch;

  try {
    const result = await crawl({
      input: settings.domain,
      pages: settings.pages,
      delayMs: settings.delay,
      concurrency: settings.concurrency,
      version,
      ...(fetchImpl && { fetchImpl }),
      ...(deps.signal && { signal: deps.signal }),
      ...(deps.tlsProbe && { tlsProbe: deps.tlsProbe }),
      ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
      ...(deps.sleep && { sleep: deps.sleep }),
      ...(log && { log }),
    });

    // Checks make a few extra requests of their own, through a client with the same politeness.
    const http = new HttpClient({
      userAgent: buildUserAgent(version),
      timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
      delayMs: settings.delay,
      allowPrivateHosts: allowPrivate,
      ...(fetchImpl && { fetchImpl }),
      ...(deps.sleep && { sleep: deps.sleep }),
      ...(deps.signal && { signal: deps.signal }),
    });
    const context: CheckContext = {
      crawl: result,
      settings,
      http,
      dns: deps.dns ?? createSystemResolver(),
      now: (deps.now ?? (() => new Date()))(),
    };

    const modules: ModuleResult[] = [];
    for (const name of settings.modules) {
      log?.(`Running module ${name}`);
      modules.push(await runModule(MODULES[name], context));
    }
    return { crawl: result, modules };
  } finally {
    await transport?.close();
  }
}
