import { readFileSync } from 'node:fs';
import type { LabEngine, LabResult, FormFactor, CategoryId } from '../../src/engines/types.js';
import { EngineError } from '../../src/engines/types.js';

export const FIXTURE = JSON.parse(
  readFileSync('test/fixtures/lighthouse-example-com-mobile.json', 'utf8'),
) as {
  loadingExperience: unknown;
  lighthouseResult: Record<string, unknown>;
};

export function labResult(overrides: Partial<LabResult> = {}): LabResult {
  const categories: Record<CategoryId, number | null> = {
    performance: 90,
    accessibility: 95,
    'best-practices': 100,
    seo: 90,
  };
  return {
    url: 'https://example.test/',
    finalUrl: 'https://example.test/',
    engine: 'lighthouse',
    formFactor: 'mobile',
    lighthouseVersion: '13.6.0',
    throttling: 'simulate: RTT 150 ms, throughput 1638.4 Kbps, CPU slowdown 4x',
    fetchedAt: '2026-11-21T12:00:00.000Z',
    categories,
    metrics: {
      fcp: { value: 1000, unit: 'millisecond', display: '1.0 s' },
      lcp: { value: 1500, unit: 'millisecond', display: '1.5 s' },
      tbt: { value: 100, unit: 'millisecond', display: '100 ms' },
      cls: { value: 0.01, unit: 'unitless', display: '0.01' },
      speedIndex: { value: 2000, unit: 'millisecond', display: '2.0 s' },
    },
    audits: [],
    ...overrides,
  };
}

export type Script = (
  url: string,
  strategy: FormFactor,
  call: number,
) => LabResult | EngineError | Error;

/** An engine that answers from a script and counts its calls. */
export function fakeEngine(
  name: 'psi' | 'lighthouse',
  script: Script,
): LabEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    measure(url, strategy) {
      calls.push(`${url} ${strategy}`);
      const answer = script(url, strategy, calls.length);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}
