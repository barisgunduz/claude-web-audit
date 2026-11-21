import {
  CATEGORIES,
  EngineError,
  type AuditItem,
  type AuditSummary,
  type CategoryId,
  type EngineName,
  type FieldData,
  type LabResult,
  type MetricValue,
  type Metrics,
} from './types.js';

type Json = Record<string, unknown>;

const METRIC_AUDITS = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  speedIndex: 'speed-index',
} as const;

/** Informative audits that carry rows worth keeping even though they have no score. */
const KEEP_WHEN_INFORMATIVE = new Set(['long-tasks']);
const SCORED_MODES = new Set(['numeric', 'binary', 'metricSavings']);
const MAX_ITEMS = 5;
const MAX_TEXT = 200;
export const GOOD_SCORE = 0.9;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function short(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}...` : value;
}

function invalid(what: string): never {
  throw new EngineError('invalid_response', `The Lighthouse result is missing ${what}.`);
}

function describeThrottling(settings: Json): string {
  const method = text(settings.throttlingMethod);
  const throttling = settings.throttling;
  if (isRecord(throttling)) {
    const parts = [
      finite(throttling.rttMs) !== undefined ? `RTT ${String(throttling.rttMs)} ms` : undefined,
      finite(throttling.throughputKbps) !== undefined
        ? `throughput ${String(throttling.throughputKbps)} Kbps`
        : undefined,
      finite(throttling.cpuSlowdownMultiplier) !== undefined
        ? `CPU slowdown ${String(throttling.cpuSlowdownMultiplier)}x`
        : undefined,
    ].filter((part): part is string => part !== undefined);
    if (parts.length > 0) return `${method ?? 'throttling'}: ${parts.join(', ')}`;
  }
  return method ?? 'not reported by the engine';
}

function metricOf(audits: Json, id: string): MetricValue | null {
  const audit = audits[id];
  if (!isRecord(audit)) return null;
  const value = finite(audit.numericValue);
  if (value === undefined) return null;
  const display = text(audit.displayValue);
  return {
    value,
    unit: audit.numericUnit === 'millisecond' ? 'millisecond' : 'unitless',
    ...(display !== undefined && { display }),
  };
}

function flattenItem(raw: unknown): AuditItem | undefined {
  if (!isRecord(raw)) return undefined;
  const item: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') item[key] = short(value);
    else if (typeof value === 'number' && Number.isFinite(value)) item[key] = value;
    else if (isRecord(value)) {
      const selector = text(value.selector);
      const inner = finite(value.value);
      if (selector !== undefined) item[key] = short(selector);
      else if (inner !== undefined) item[key] = inner;
    }
  }
  return Object.keys(item).length > 0 ? item : undefined;
}

function itemsOf(details: Json): AuditItem[] {
  const rows = details.items;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(flattenItem)
    .filter((item): item is AuditItem => item !== undefined)
    .slice(0, MAX_ITEMS);
}

function checklistOf(details: Json): Record<string, boolean> | undefined {
  const items = details.items;
  if (details.type !== 'checklist' || !isRecord(items)) return undefined;
  const result: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(items)) {
    if (isRecord(entry) && typeof entry.value === 'boolean') result[key] = entry.value;
  }
  return result;
}

function summarizeAudit(id: string, audit: Json): AuditSummary | undefined {
  const mode = text(audit.scoreDisplayMode) ?? '';
  const score = finite(audit.score) ?? null;
  const details = isRecord(audit.details) ? audit.details : {};
  const items = itemsOf(details);
  const belowGood = SCORED_MODES.has(mode) && score !== null && score < GOOD_SCORE;
  const informative = mode === 'informative' && KEEP_WHEN_INFORMATIVE.has(id) && items.length > 0;
  if (!belowGood && !informative) return undefined;

  const metricSavings = isRecord(audit.metricSavings)
    ? Math.max(0, ...Object.values(audit.metricSavings).map((value) => finite(value) ?? 0))
    : 0;
  const savingsMs =
    finite(details.overallSavingsMs) ?? (metricSavings > 0 ? metricSavings : undefined);
  const wasted = rowsWastedBytes(details.items);
  const savingsBytes = finite(details.overallSavingsBytes) ?? (wasted > 0 ? wasted : undefined);
  const displayValue = text(audit.displayValue);
  const checklist = checklistOf(details);

  return {
    id,
    title: short(text(audit.title) ?? id),
    score,
    displayMode: mode,
    ...(displayValue !== undefined && displayValue !== '' && { displayValue: short(displayValue) }),
    ...(savingsMs !== undefined && savingsMs > 0 && { savingsMs }),
    ...(savingsBytes !== undefined && savingsBytes > 0 && { savingsBytes }),
    items,
    ...(checklist && { checklist }),
  };
}

function rowsWastedBytes(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce<number>(
    (sum, row) => sum + (isRecord(row) ? (finite(row.wastedBytes) ?? 0) : 0),
    0,
  );
}

function lcpElementOf(audits: Json): LabResult['lcpElement'] {
  const breakdown = audits['lcp-breakdown-insight'];
  const details =
    isRecord(breakdown) && isRecord(breakdown.details) ? breakdown.details : undefined;
  const rows = details?.items;
  const node: unknown = Array.isArray(rows)
    ? rows.find((row: unknown) => isRecord(row) && row.type === 'node')
    : undefined;
  if (!isRecord(node)) return undefined;
  const selector = text(node.selector);
  const snippet = text(node.snippet);
  const label = text(node.nodeLabel);
  if (selector === undefined && snippet === undefined && label === undefined) return undefined;
  return {
    ...(selector !== undefined && { selector: short(selector) }),
    ...(snippet !== undefined && { snippet: short(snippet) }),
    ...(label !== undefined && { label: short(label) }),
  };
}

/** Real-user data, if the response has it. The shape is read defensively and may disappear. */
export function readFieldData(experience: unknown): FieldData | undefined {
  if (!isRecord(experience) || !isRecord(experience.metrics)) return undefined;
  const metrics: FieldData['metrics'] = {};
  for (const [name, entry] of Object.entries(experience.metrics)) {
    if (!isRecord(entry)) continue;
    const percentile = finite(entry.percentile);
    const category = text(entry.category);
    if (percentile !== undefined && category !== undefined)
      metrics[name] = { percentile, category };
  }
  const overallCategory = text(experience.overall_category);
  if (Object.keys(metrics).length === 0 && overallCategory === undefined) return undefined;
  return { ...(overallCategory !== undefined && { overallCategory }), metrics };
}

export interface NormalizeMeta {
  engine: EngineName;
  /** The URL that was asked for. */
  url: string;
  fieldData?: FieldData | undefined;
}

/**
 * Reads a Lighthouse result (the `lhr` of the library, or `lighthouseResult` of PSI) and keeps only
 * what this tool uses. Throws an EngineError when the result is not shaped as expected.
 */
export function normalizeLighthouseResult(raw: unknown, meta: NormalizeMeta): LabResult {
  if (!isRecord(raw)) return invalid('the result object');
  const audits = raw.audits;
  const categories = raw.categories;
  const settings = raw.configSettings;
  if (!isRecord(audits)) return invalid('audits');
  if (!isRecord(categories)) return invalid('categories');
  if (!isRecord(settings)) return invalid('configSettings');

  const formFactor = text(settings.formFactor) ?? text(settings.emulatedFormFactor);
  if (formFactor !== 'mobile' && formFactor !== 'desktop') return invalid('the form factor');
  const lighthouseVersion = text(raw.lighthouseVersion);
  if (lighthouseVersion === undefined) return invalid('the Lighthouse version');

  const scores = Object.fromEntries(
    CATEGORIES.map((id: CategoryId) => {
      const category = categories[id];
      const score = isRecord(category) ? finite(category.score) : undefined;
      return [id, score === undefined ? null : Math.round(score * 100)];
    }),
  ) as Record<CategoryId, number | null>;

  const metrics: Metrics = {
    fcp: metricOf(audits, METRIC_AUDITS.fcp),
    lcp: metricOf(audits, METRIC_AUDITS.lcp),
    tbt: metricOf(audits, METRIC_AUDITS.tbt),
    cls: metricOf(audits, METRIC_AUDITS.cls),
    speedIndex: metricOf(audits, METRIC_AUDITS.speedIndex),
  };

  const metricIds = new Set<string>(Object.values(METRIC_AUDITS));
  const summaries = Object.entries(audits)
    .filter(([id]) => !metricIds.has(id))
    .flatMap(([id, audit]) => {
      const summary = isRecord(audit) ? summarizeAudit(id, audit) : undefined;
      return summary ? [summary] : [];
    });

  const weight = audits['total-byte-weight'];
  const transferBytes = isRecord(weight) ? finite(weight.numericValue) : undefined;
  const lcpElement = lcpElementOf(audits);
  const requested = text(raw.requestedUrl) ?? meta.url;
  const finalUrl = text(raw.finalDisplayedUrl) ?? text(raw.finalUrl) ?? requested;

  return {
    url: meta.url,
    finalUrl,
    engine: meta.engine,
    formFactor,
    lighthouseVersion,
    throttling: describeThrottling(settings),
    fetchedAt: text(raw.fetchTime) ?? new Date(0).toISOString(),
    categories: scores,
    metrics,
    audits: summaries,
    ...(lcpElement && { lcpElement }),
    ...(transferBytes !== undefined && { transferBytes }),
    ...(meta.fieldData && { fieldData: meta.fieldData }),
  };
}
