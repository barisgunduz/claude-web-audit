import type { Severity } from '../../model/finding.js';
import type { AxeImpact } from './axe-types.js';

/**
 * critical and serious become important, moderate and minor become improvement. A rule without an
 * impact is an improvement. This module never emits a critical finding, so a missing label or a
 * low contrast ratio never makes a site "broken" in the sense of the severity rule.
 */
export function severityForImpact(impact: AxeImpact | null): Severity {
  return impact === 'critical' || impact === 'serious' ? 'important' : 'improvement';
}

const ORDER: readonly AxeImpact[] = ['minor', 'moderate', 'serious', 'critical'];

/** The more severe of two impacts. */
export function higherImpact(a: AxeImpact | null, b: AxeImpact | null): AxeImpact | null {
  if (a === null) return b;
  if (b === null) return a;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}
