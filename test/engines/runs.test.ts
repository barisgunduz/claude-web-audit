import { describe, expect, it } from 'vitest';
import { pickMedianRun, summarizeRuns } from '../../src/engines/runs.js';
import { labResult } from '../support/lab.js';

const run = (score: number | null, tag: string) =>
  labResult({
    finalUrl: tag,
    categories: { performance: score, accessibility: 1, 'best-practices': 1, seo: 1 },
  });

describe('pickMedianRun', () => {
  it('takes the middle run of an odd count', () => {
    const { result, index } = pickMedianRun([run(80, 'a'), run(40, 'b'), run(60, 'c')]);
    expect(result.finalUrl).toBe('c');
    expect(index).toBe(2);
  });

  it('takes the lower middle run of an even count', () => {
    expect(
      pickMedianRun([run(10, 'a'), run(40, 'b'), run(30, 'c'), run(20, 'd')]).result.finalUrl,
    ).toBe('d');
    expect(pickMedianRun([run(70, 'a'), run(50, 'b')]).result.finalUrl).toBe('b');
  });

  it('takes the only run of one, and keeps the earlier run on a tie', () => {
    expect(pickMedianRun([run(55, 'only')]).index).toBe(0);
    expect(
      pickMedianRun([run(50, 'first'), run(50, 'second'), run(50, 'third')]).result.finalUrl,
    ).toBe('second');
  });

  it('ranks a run without a score below all others', () => {
    expect(
      pickMedianRun([run(null, 'none'), run(90, 'high'), run(80, 'mid')]).result.finalUrl,
    ).toBe('mid');
  });

  it('keeps every metric of the chosen run together', () => {
    const slow = labResult({
      categories: { performance: 30, accessibility: 1, 'best-practices': 1, seo: 1 },
      metrics: { ...labResult().metrics, lcp: { value: 9000, unit: 'millisecond' } },
    });
    const mid = labResult({
      categories: { performance: 60, accessibility: 1, 'best-practices': 1, seo: 1 },
      metrics: { ...labResult().metrics, lcp: { value: 3000, unit: 'millisecond' } },
    });
    const fast = labResult({
      categories: { performance: 95, accessibility: 1, 'best-practices': 1, seo: 1 },
      metrics: { ...labResult().metrics, lcp: { value: 900, unit: 'millisecond' } },
    });
    expect(pickMedianRun([fast, slow, mid]).result.metrics.lcp?.value).toBe(3000);
  });

  it('refuses an empty list', () => {
    expect(() => pickMedianRun([])).toThrow();
  });
});

describe('summarizeRuns', () => {
  it('stores every score with min, max and spread', () => {
    expect(summarizeRuns([run(80, 'a'), run(60, 'b'), run(70, 'c')], 3)).toEqual({
      scores: [80, 60, 70],
      min: 60,
      max: 80,
      spread: 20,
      failed: 0,
    });
  });
  it('counts runs that gave no result, and handles no known scores', () => {
    expect(summarizeRuns([run(75, 'a')], 3)).toMatchObject({
      min: 75,
      max: 75,
      spread: 0,
      failed: 2,
    });
    expect(summarizeRuns([run(null, 'a')], 1)).toMatchObject({
      min: null,
      max: null,
      spread: null,
    });
  });
});
