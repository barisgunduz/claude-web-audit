import type { LabPageResult } from '../../engines/measure.js';
import type { MetricName } from '../../engines/types.js';
import { pickPages } from '../../crawler/select.js';
import { makeFinding, outcome, toFact } from '../../checks/support.js';
import type { Check, CheckContext } from '../../model/check.js';
import type { FactValue, Finding, Severity } from '../../model/finding.js';
import {
  extractAssetUrls,
  isCompressed,
  isCompressibleType,
  isVersionedUrl,
  LONG_CACHE_SECONDS,
  MIN_COMPRESSIBLE_BYTES,
  parseCachePolicy,
} from './assets.js';
import auditMap from './audit-findings.json' with { type: 'json' };
import { bandOf, formatMetric, METRIC_CODES, metricLabel, rateMetric } from './rating.js';

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, important: 1, improvement: 2 };

function worst(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

function measured(context: CheckContext): LabPageResult[] {
  return (context.lab?.pages ?? []).filter((page) => page.result !== undefined);
}

function label(page: LabPageResult): string {
  return `${page.url} (${page.strategy})`;
}

function labFacts(context: CheckContext): Record<string, FactValue> {
  const lab = context.lab;
  if (!lab) return {};
  return {
    lab: toFact({
      status: lab.status,
      method: lab.method,
      pages: lab.pages.map((page) => ({
        url: page.url,
        strategy: page.strategy,
        engine: page.engine,
        error: page.error,
        runScores: page.runs.scores,
        runMin: page.runs.min,
        runMax: page.runs.max,
        runSpread: page.runs.spread,
        runsFailed: page.runs.failed,
        fallback: page.fallback,
        lighthouseVersion: page.result?.lighthouseVersion,
        throttling: page.result?.throttling,
        fetchedAt: page.result?.fetchedAt,
        categories: page.result?.categories,
        metrics: page.result?.metrics,
        transferBytes: page.result?.transferBytes,
        lcpElement: page.result?.lcpElement,
        fieldData: page.result?.fieldData,
      })),
    }),
  };
}

const labMetrics: Check = {
  id: 'speed.lab-metrics',
  module: 'speed',
  codes: ['SPD-001', ...Object.values(METRIC_CODES)],
  run(context) {
    const lab = context.lab;
    if (!lab || lab.status === 'not_measured') {
      return outcome([], labFacts(context), lab?.reason ?? 'Lighthouse measurements were not run.');
    }

    const findings: Finding[] = [];
    const scoreEvidence: string[] = [];
    let scoreSeverity: Severity = 'improvement';
    let lowest = 100;
    const perMetric = new Map<
      MetricName,
      { evidence: string[]; severity: Severity; poor: number; needs: number }
    >();

    for (const page of measured(context)) {
      const result = page.result;
      if (!result) continue;
      const score = result.categories.performance;
      if (score !== null) {
        const band = bandOf(score, result.formFactor);
        if (band !== 'good') {
          scoreEvidence.push(`${label(page)}: ${score}`);
          scoreSeverity = worst(
            scoreSeverity,
            band === 'critical' ? 'critical' : band === 'poor' ? 'important' : 'improvement',
          );
          lowest = Math.min(lowest, score);
        }
      }
      for (const name of Object.keys(METRIC_CODES) as MetricName[]) {
        const metric = result.metrics[name];
        if (!metric) continue;
        const rating = rateMetric(name, result.formFactor, metric.value);
        if (rating === 'good') continue;
        const entry = perMetric.get(name) ?? {
          evidence: [],
          severity: 'improvement' as Severity,
          poor: 0,
          needs: 0,
        };
        entry.evidence.push(
          `${label(page)}: ${formatMetric(metric)} (${rating === 'poor' ? 'poor' : 'needs improvement'})`,
        );
        if (rating === 'poor') {
          entry.severity = worst(entry.severity, 'important');
          entry.poor++;
        } else {
          entry.needs++;
        }
        perMetric.set(name, entry);
      }
    }

    if (scoreEvidence.length > 0) {
      findings.push(makeFinding('speed', 'SPD-001', scoreSeverity, scoreEvidence, { lowest }));
    }
    for (const [name, entry] of perMetric) {
      findings.push(
        makeFinding('speed', METRIC_CODES[name], entry.severity, entry.evidence, {
          metric: metricLabel(name),
          poor: entry.poor,
          needsImprovement: entry.needs,
        }),
      );
    }
    return outcome(
      findings,
      labFacts(context),
      undefined,
      lab.status === 'partial' ? lab.reason : undefined,
    );
  },
};

interface Hit {
  evidence: string[];
  severity: Severity;
  savingsMs: number;
  savingsBytes: number;
  largestKiB: number;
}

const labAudits: Check = {
  id: 'speed.lab-audits',
  module: 'speed',
  codes: [...new Set([...auditMap.audits.map((entry) => entry.code), 'SPD-038', 'SPD-039'])],
  run(context) {
    const lab = context.lab;
    if (!lab || lab.status === 'not_measured') {
      return outcome([], undefined, lab?.reason ?? 'Lighthouse measurements were not run.');
    }
    const hits = new Map<string, Hit>();
    const add = (
      code: string,
      severity: Severity,
      line: string,
      savingsMs = 0,
      savingsBytes = 0,
      bytes = 0,
    ): void => {
      const hit = hits.get(code) ?? {
        evidence: [],
        severity: 'improvement' as Severity,
        savingsMs: 0,
        savingsBytes: 0,
        largestKiB: 0,
      };
      hit.evidence.push(line);
      hit.severity = worst(hit.severity, severity);
      hit.savingsMs = Math.max(hit.savingsMs, savingsMs);
      hit.savingsBytes = Math.max(hit.savingsBytes, savingsBytes);
      hit.largestKiB = Math.max(hit.largestKiB, Math.round(bytes / 1024));
      hits.set(code, hit);
    };

    for (const page of measured(context)) {
      const result = page.result;
      if (!result) continue;
      const done = new Set<string>();
      const tbt = result.metrics.tbt;
      const tbtGood = !tbt || rateMetric('tbt', result.formFactor, tbt.value) === 'good';

      for (const audit of result.audits) {
        if (audit.id === 'document-latency-insight' && audit.checklist) {
          const note = `${label(page)}: ${audit.displayValue ?? audit.title}`;
          if (audit.checklist.noRedirects === false) add('SPD-038', 'improvement', note);
          if (audit.checklist.serverResponseIsFast === false)
            add('SPD-039', 'important', note, audit.savingsMs ?? 0);
          continue;
        }
        const mapped = auditMap.audits.find((entry) => entry.id === audit.id);
        if (!mapped || done.has(mapped.code)) continue;
        if ('onlyWhenPoor' in mapped && tbtGood) continue;
        done.add(mapped.code);
        const severity: Severity =
          audit.score !== null && audit.score < 0.5 ? 'important' : 'improvement';
        const savings = [
          audit.savingsMs !== undefined ? `about ${Math.round(audit.savingsMs)} ms` : undefined,
          audit.savingsBytes !== undefined
            ? `${Math.round(audit.savingsBytes / 1024)} KiB`
            : undefined,
        ].filter((part) => part !== undefined);
        const example = audit.items[0]?.url;
        const line = `${label(page)}: ${audit.title}${savings.length > 0 ? `, estimated savings ${savings.join(' and ')}` : ''}${typeof example === 'string' ? `, for example ${example}` : ''}`;
        add(
          mapped.code,
          severity,
          line,
          audit.savingsMs,
          audit.savingsBytes,
          mapped.code === 'SPD-040' ? (result.transferBytes ?? 0) : 0,
        );
      }
    }

    const findings = [...hits.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, hit]) =>
        makeFinding('speed', code, hit.severity, hit.evidence, {
          savingsMs: Math.round(hit.savingsMs),
          savingsKiB: Math.round(hit.savingsBytes / 1024),
          largestKiB: hit.largestKiB,
        }),
      );
    return outcome(
      findings,
      undefined,
      undefined,
      lab.status === 'partial' ? lab.reason : undefined,
    );
  },
};

const assetHeaders: Check = {
  id: 'speed.asset-headers',
  module: 'speed',
  codes: ['SPD-050', 'SPD-051', 'SPD-052', 'SPD-053', 'SPD-054'],
  async run(context) {
    const { crawl, settings } = context;
    const urls = pickPages(crawl, settings.speedPages);
    const pages = urls
      .map((url) => crawl.pages.find((page) => page.finalUrl === url))
      .filter((page): page is NonNullable<typeof page> => page !== undefined);
    if (pages.length === 0)
      return outcome([], undefined, 'There are no crawled HTML pages to check.');

    const uncompressedDocuments = pages
      .filter(
        (page) =>
          (page.html?.length ?? 0) >= MIN_COMPRESSIBLE_BYTES &&
          !isCompressed(page.headers['content-encoding']),
      )
      .map((page) => page.finalUrl);

    const uncompressed: string[] = [];
    const noHeaders: string[] = [];
    const versionedShort: string[] = [];
    const disabled: string[] = [];
    let checked = 0;
    let failed = 0;
    for (const url of extractAssetUrls(pages, crawl.host.canonicalHost)) {
      let response;
      try {
        response = await context.http.request(url, { body: 'none' });
      } catch {
        failed++;
        continue;
      }
      if (response.status !== 200) continue;
      checked++;
      const length = Number(response.headers['content-length']);
      const small = Number.isFinite(length) && length < MIN_COMPRESSIBLE_BYTES;
      if (
        isCompressibleType(response.contentType) &&
        !small &&
        !isCompressed(response.headers['content-encoding'])
      ) {
        uncompressed.push(`${url} (${response.contentType.split(';')[0] ?? ''})`);
      }
      const policy = parseCachePolicy(response.headers, context.now);
      if (!policy.hasAnyHeader) noHeaders.push(url);
      else if (policy.noStore || ((policy.noCache || policy.ttl === 0) && !policy.hasValidator))
        disabled.push(url);
      else if (isVersionedUrl(url) && (policy.ttl ?? 0) < LONG_CACHE_SECONDS) {
        versionedShort.push(`${url} (max-age ${policy.ttl ?? 0}s)`);
      }
    }

    const findings: Finding[] = [
      ...(uncompressedDocuments.length > 0
        ? [makeFinding('speed', 'SPD-050', 'important', uncompressedDocuments)]
        : []),
      ...(uncompressed.length > 0
        ? [makeFinding('speed', 'SPD-051', 'improvement', uncompressed)]
        : []),
      ...(noHeaders.length > 0 ? [makeFinding('speed', 'SPD-052', 'improvement', noHeaders)] : []),
      ...(versionedShort.length > 0
        ? [
            makeFinding('speed', 'SPD-053', 'improvement', versionedShort, {
              days: LONG_CACHE_SECONDS / 86_400,
            }),
          ]
        : []),
      ...(disabled.length > 0 ? [makeFinding('speed', 'SPD-054', 'improvement', disabled)] : []),
    ];
    return outcome(
      findings,
      { assetsChecked: checked, assetsFailed: failed, documentsChecked: pages.length },
      checked === 0 && failed > 0 ? 'No static asset could be fetched.' : undefined,
    );
  },
};

export const speedChecks: readonly Check[] = [labMetrics, labAudits, assetHeaders];
