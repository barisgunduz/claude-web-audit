export type EngineName = 'psi' | 'lighthouse';
export type FormFactor = 'mobile' | 'desktop';
export type CategoryId = 'performance' | 'accessibility' | 'best-practices' | 'seo';

export const CATEGORIES: readonly CategoryId[] = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
];

export interface MetricValue {
  value: number;
  unit: 'millisecond' | 'unitless';
  display?: string;
}

export interface Metrics {
  fcp: MetricValue | null;
  lcp: MetricValue | null;
  tbt: MetricValue | null;
  cls: MetricValue | null;
  speedIndex: MetricValue | null;
}

export type MetricName = keyof Metrics;

/** One row of an audit table, reduced to plain values. */
export type AuditItem = Readonly<Record<string, string | number>>;

export interface AuditSummary {
  id: string;
  title: string;
  /** 0 to 1, or null when the audit has no score. */
  score: number | null;
  displayMode: string;
  displayValue?: string;
  savingsMs?: number;
  savingsBytes?: number;
  /** At most five rows. */
  items: AuditItem[];
  /** Yes or no answers of a checklist audit, for example "usesCompression". */
  checklist?: Record<string, boolean>;
}

export interface FieldData {
  overallCategory?: string;
  metrics: Record<string, { percentile: number; category: string }>;
}

/** The normalized result of one Lighthouse run. Everything else Lighthouse returns is dropped. */
export interface LabResult {
  url: string;
  finalUrl: string;
  engine: EngineName;
  formFactor: FormFactor;
  lighthouseVersion: string;
  throttling: string;
  fetchedAt: string;
  /** Category scores from 0 to 100, null when a category has no score. */
  categories: Record<CategoryId, number | null>;
  metrics: Metrics;
  /** Audits that scored below 0.9, with their details and estimated savings. */
  audits: AuditSummary[];
  lcpElement?: { selector?: string; snippet?: string; label?: string };
  transferBytes?: number;
  /** Real-user data from PSI. Optional, never scored, and nothing depends on it. */
  fieldData?: FieldData;
}

export interface LabEngine {
  readonly name: EngineName;
  measure(url: string, strategy: FormFactor, signal?: AbortSignal): Promise<LabResult>;
}

export type EngineErrorKind =
  | 'quota'
  | 'server'
  | 'network'
  | 'timeout'
  | 'client'
  | 'invalid_response'
  | 'runtime'
  | 'no_chrome'
  | 'aborted';

export class EngineError extends Error {
  override readonly name = 'EngineError';
  readonly kind: EngineErrorKind;

  constructor(kind: EngineErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
