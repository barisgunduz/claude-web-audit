import type { FormFactor, MetricName, MetricValue } from '../../engines/types.js';
import thresholds from './metric-thresholds.json' with { type: 'json' };

export type Rating = 'good' | 'needs-improvement' | 'poor';

export const METRIC_CODES: Readonly<Record<MetricName, string>> = {
  lcp: 'SPD-002',
  fcp: 'SPD-003',
  tbt: 'SPD-004',
  cls: 'SPD-005',
  speedIndex: 'SPD-006',
};

export const CRITICAL_SCORE = thresholds.performanceScore.critical;
export const GOOD_SCORE = thresholds.performanceScore.good;

/** Rates a metric value with the Lighthouse control points of the form factor. */
export function rateMetric(name: MetricName, formFactor: FormFactor, value: number): Rating {
  const limits = thresholds.metrics[name][formFactor];
  if (value <= limits.good) return 'good';
  return value <= limits.poor ? 'needs-improvement' : 'poor';
}

export function metricLabel(name: MetricName): string {
  return thresholds.metrics[name].label;
}

export function formatMetric(metric: MetricValue): string {
  if (metric.display !== undefined && metric.display !== '') return metric.display;
  return metric.unit === 'millisecond'
    ? `${Math.round(metric.value)} ms`
    : String(Math.round(metric.value * 1000) / 1000);
}

export type PerformanceBand = 'critical' | 'poor' | 'needs-improvement' | 'good';

/** Mobile below 50 is critical. Desktop below 50 is important. 50 to 89 is an improvement. */
export function bandOf(score: number, formFactor: FormFactor): PerformanceBand {
  if (score < CRITICAL_SCORE) return formFactor === 'mobile' ? 'critical' : 'poor';
  return score < GOOD_SCORE ? 'needs-improvement' : 'good';
}
