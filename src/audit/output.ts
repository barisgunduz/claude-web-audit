import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Settings } from '../config/types.js';
import { createTranslator } from '../i18n/index.js';
import { renderFinding } from '../i18n/messages.js';
import type { CrawlResult } from '../model/crawl.js';
import type { Finding, ModuleResult, Severity } from '../model/finding.js';
import { SEVERITIES } from '../model/finding.js';
import type { AuditRun } from './run.js';

export const SCHEMA_VERSION = '0-interim';

/** The crawl without page bodies, headers and cookies. */
export function summarizeCrawl(crawl: CrawlResult): Record<string, unknown> {
  return {
    inputDomain: crawl.inputDomain,
    startUrl: crawl.startUrl,
    userAgent: crawl.userAgent,
    startedAt: crawl.startedAt,
    durationMs: crawl.durationMs,
    host: crawl.host,
    robots: {
      url: crawl.robots.url,
      status: crawl.robots.status,
      found: crawl.robots.found,
      groups: crawl.robots.parsed.groups.length,
      sitemaps: crawl.robots.parsed.sitemaps,
      issues: crawl.robots.parsed.issues,
    },
    sitemaps: { files: crawl.sitemaps.files, urlCount: crawl.sitemaps.urls.length },
    tls: crawl.tls ?? null,
    pages: crawl.pages.map((page) => ({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      redirects: page.redirectChain.length,
      contentType: page.contentType,
      timingMs: page.timingMs,
      clickDepth: page.clickDepth ?? null,
      inboundLinks: page.inbound.length,
      ...(page.error !== undefined && { error: page.error }),
    })),
    blockedByRobots: crawl.blockedByRobots,
    externalLinks: crawl.externalLinks,
    probes: {
      notFound: {
        url: crawl.notFoundProbe.url,
        status: crawl.notFoundProbe.status,
        redirects: crawl.notFoundProbe.chain.length,
      },
      llmsTxt: {
        url: crawl.llmsProbe.url,
        status: crawl.llmsProbe.status,
        contentType: crawl.llmsProbe.contentType,
      },
    },
    limits: crawl.limits,
    errors: crawl.errors,
  };
}

function describeModule(
  result: ModuleResult,
  message: (finding: Finding) => string,
): Record<string, unknown> {
  return {
    ...result,
    findings: result.findings.map((finding) => ({ ...finding, message: message(finding) })),
  };
}

export function buildAuditJson(
  run: AuditRun,
  settings: Settings,
  version: string,
): Record<string, unknown> {
  const translate = createTranslator('en');
  const message = (finding: Finding): string => renderFinding(finding, translate);
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: 'claude-web-audit', version },
    domain: run.crawl.host.canonicalHost,
    settings: {
      pages: settings.pages,
      delay: settings.delay,
      concurrency: settings.concurrency,
      modules: settings.modules,
    },
    crawl: summarizeCrawl(run.crawl),
    modules: run.modules.map((result) => describeModule(result, message)),
  };
}

/** A folder name made only of safe characters. */
export function safeFolderName(host: string): string {
  return host.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}

export async function writeAuditJson(
  run: AuditRun,
  settings: Settings,
  version: string,
  cwd: string,
  date: Date,
): Promise<string> {
  const folder = join(
    resolve(cwd, settings.out),
    safeFolderName(run.crawl.host.canonicalHost),
    date.toISOString().slice(0, 10),
  );
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'audit.json');
  await writeFile(
    file,
    `${JSON.stringify(buildAuditJson(run, settings, version), null, 2)}\n`,
    'utf8',
  );
  return file;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, important: 1, improvement: 2 };

/** Terminal summary, at most 10 lines. */
export function buildSummary(run: AuditRun, file: string): string[] {
  const translate = createTranslator('en');
  const all = run.modules.flatMap((result) => result.findings);
  const counts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, all.filter((f) => f.severity === severity).length]),
  );
  const top = [...all]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        Number(b.data.count ?? 0) - Number(a.data.count ?? 0) ||
        a.code.localeCompare(b.code),
    )
    .slice(0, 5);
  const notMeasured = run.modules
    .filter((result) => result.status === 'not_measured')
    .map((result) => result.module);
  const partial = run.modules
    .filter((result) => result.status === 'partial')
    .map((result) => result.module);
  const seconds = (run.crawl.durationMs / 1000).toFixed(1);

  return [
    `Audit of ${run.crawl.host.canonicalHost}: ${run.crawl.pages.length} pages crawled in ${seconds}s${run.crawl.limits.pagesCapReached ? ' (page limit reached)' : ''}`,
    `Findings: ${counts.critical ?? 0} critical, ${counts.important ?? 0} important, ${counts.improvement ?? 0} improvement`,
    `Not measured: ${notMeasured.length > 0 ? notMeasured.join(', ') : 'none'}${partial.length > 0 ? `. Partly measured: ${partial.join(', ')}` : ''}`,
    ...top.map(
      (finding) => `  ${finding.code} ${finding.severity}: ${renderFinding(finding, translate)}`,
    ),
    `Output: ${file}`,
  ];
}
