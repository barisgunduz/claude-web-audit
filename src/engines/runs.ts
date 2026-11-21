import type { LabResult } from './types.js';

export interface RunSummary {
  /** Performance score of every run, 0 to 100. */
  scores: (number | null)[];
  min: number | null;
  max: number | null;
  spread: number | null;
  /** How many of the requested runs did not give a result. */
  failed: number;
}

/**
 * The run whose performance score is the median. With an even count it is the lower middle run.
 * All numbers of the report come from this one run, so they stay consistent with each other.
 */
export function pickMedianRun(results: readonly LabResult[]): { result: LabResult; index: number } {
  if (results.length === 0) throw new Error('No runs to choose from.');
  const ranked = results
    .map((result, index) => ({ result, index, score: result.categories.performance ?? -1 }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  const chosen = ranked[Math.floor((ranked.length - 1) / 2)];
  if (!chosen) throw new Error('No runs to choose from.');
  return { result: chosen.result, index: chosen.index };
}

export function summarizeRuns(results: readonly LabResult[], requested: number): RunSummary {
  const scores = results.map((result) => result.categories.performance);
  const known = scores.filter((score): score is number => score !== null);
  const min = known.length > 0 ? Math.min(...known) : null;
  const max = known.length > 0 ? Math.max(...known) : null;
  return {
    scores,
    min,
    max,
    spread: min !== null && max !== null ? max - min : null,
    failed: requested - results.length,
  };
}
