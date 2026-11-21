import { describe, expect, it } from 'vitest';
import {
  describeMethod,
  estimateMeasurement,
  measureLab,
  planEngines,
  type MeasureInput,
} from '../../src/engines/measure.js';
import { EngineError, type LabEngine, type LabResult } from '../../src/engines/types.js';
import { fakeEngine, labResult } from '../support/lab.js';

const perf = (
  score: number,
  engine: 'psi' | 'lighthouse' = 'lighthouse',
  overrides: Partial<LabResult> = {},
): LabResult =>
  labResult({
    engine,
    categories: { performance: score, accessibility: 90, 'best-practices': 90, seo: 90 },
    ...overrides,
  });

describe('planEngines', () => {
  it.each([
    ['psi', true, true, ['psi']],
    ['psi', false, false, ['psi']],
    ['lighthouse', true, true, ['lighthouse']],
    ['auto', true, true, ['psi', 'lighthouse']],
    ['auto', true, false, ['psi']],
    ['auto', false, true, ['lighthouse']],
  ] as const)('%s with key %s and chrome %s runs %j', (setting, hasKey, hasChrome, order) => {
    expect(planEngines(setting, hasKey, hasChrome)).toEqual({ order });
  });

  it('points to cwa doctor when nothing can run', () => {
    expect(planEngines('lighthouse', true, false).unavailable).toContain('cwa doctor');
    expect(planEngines('auto', false, false).unavailable).toMatch(
      /PSI_API_KEY is not set and no usable Chrome.*cwa doctor/,
    );
  });
});

describe('estimateMeasurement', () => {
  it('multiplies pages, strategies and runs, and gives a range', () => {
    const estimate = estimateMeasurement({
      pages: 3,
      strategies: 2,
      runs: 3,
      firstEngine: 'lighthouse',
    });
    expect(estimate.runs).toBe(18);
    expect(estimate.minSeconds).toBe(18 * 15);
    expect(estimate.maxSeconds).toBe(18 * 60);
    expect(estimate.text).toBe(
      'Speed: 18 Lighthouse runs (3 pages x 2 strategies x 3 runs), roughly 5 minutes to 18 minutes.',
    );
  });
  it('speaks in seconds for a short job', () => {
    expect(
      estimateMeasurement({ pages: 1, strategies: 1, runs: 1, firstEngine: 'psi' }).text,
    ).toContain('roughly 10 seconds to 60 seconds');
  });
});

const base = (overrides: Partial<MeasureInput>): MeasureInput => ({
  urls: ['https://example.test/'],
  strategies: ['mobile'],
  runs: 1,
  setting: 'auto',
  hasKey: true,
  hasChrome: true,
  ...overrides,
});

describe('measureLab', () => {
  it('uses PSI first in auto mode with a key, and does not touch local Lighthouse', async () => {
    const psi = fakeEngine('psi', () => perf(80, 'psi'));
    const local = fakeEngine('lighthouse', () => perf(70));
    const outcome = await measureLab(base({ psi, local }));
    expect(outcome.status).toBe('measured');
    expect(outcome.pages[0]).toMatchObject({ engine: 'psi' });
    expect(outcome.pages[0]?.fallback).toBeUndefined();
    expect(local.calls).toEqual([]);
    expect(outcome.method).toMatchObject({
      enginesUsed: ['psi'],
      fallbacks: 0,
      lighthouseVersions: ['13.6.0'],
    });
  });

  it('uses local Lighthouse in auto mode without a key', async () => {
    const psi = fakeEngine('psi', () => perf(80, 'psi'));
    const local = fakeEngine('lighthouse', () => perf(70));
    const outcome = await measureLab(base({ psi, local, hasKey: false }));
    expect(outcome.pages[0]?.engine).toBe('lighthouse');
    expect(psi.calls).toEqual([]);
  });

  it('falls back to local Lighthouse when PSI fails, and records why', async () => {
    const psi = fakeEngine(
      'psi',
      () => new EngineError('server', 'PageSpeed Insights server error (HTTP 500)'),
    );
    const local = fakeEngine('lighthouse', () => perf(70));
    const outcome = await measureLab(base({ psi, local }));
    expect(outcome.pages[0]).toMatchObject({
      engine: 'lighthouse',
      fallback: { from: 'psi', reason: 'PageSpeed Insights server error (HTTP 500)' },
    });
    expect(outcome.method).toMatchObject({ enginesUsed: ['lighthouse'], fallbacks: 1 });
    expect(describeMethod(outcome.method)).toContain(
      '1 measurement(s) fell back from PageSpeed Insights to local Lighthouse',
    );
  });

  it('stops asking PSI after a quota error, and falls back for every later page', async () => {
    const psi = fakeEngine(
      'psi',
      () => new EngineError('quota', 'PageSpeed Insights quota exceeded (HTTP 429)'),
    );
    const local = fakeEngine('lighthouse', () => perf(70));
    const outcome = await measureLab(
      base({
        psi,
        local,
        urls: ['https://example.test/a', 'https://example.test/b', 'https://example.test/c'],
      }),
    );
    expect(psi.calls).toHaveLength(1);
    expect(local.calls).toHaveLength(3);
    expect(outcome.pages.every((page) => page.fallback?.reason.includes('quota'))).toBe(true);
    expect(outcome.method.fallbacks).toBe(3);
  });

  it('never falls back silently in psi mode', async () => {
    const psi = fakeEngine(
      'psi',
      () => new EngineError('network', 'The PageSpeed Insights request failed (network error).'),
    );
    const local = fakeEngine('lighthouse', () => perf(70));
    const outcome = await measureLab(base({ psi, local, setting: 'psi' }));
    expect(local.calls).toEqual([]);
    expect(outcome.status).toBe('not_measured');
    expect(outcome.reason).toContain('network error');
    expect(outcome.pages[0]).toMatchObject({ error: expect.stringContaining('network error') });
  });

  it('is partly measured when only some pages work', async () => {
    const psi = fakeEngine('psi', (url) =>
      url.endsWith('/bad')
        ? new EngineError('client', 'PageSpeed Insights rejected the request (HTTP 400)')
        : perf(80, 'psi'),
    );
    const outcome = await measureLab(
      base({ psi, setting: 'psi', urls: ['https://example.test/', 'https://example.test/bad'] }),
    );
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toMatch(/^1 of 2 measurements finished\. First problem: .*HTTP 400/);
  });

  it('is not measured with a pointer to doctor when local Lighthouse has no Chrome', async () => {
    const outcome = await measureLab(
      base({ setting: 'lighthouse', hasChrome: false, local: undefined }),
    );
    expect(outcome).toMatchObject({ status: 'not_measured', pages: [] });
    expect(outcome.reason).toContain('cwa doctor');
  });

  it('measures every page with every strategy, one at a time', async () => {
    const order: string[] = [];
    const local = fakeEngine('lighthouse', (url, strategy) => {
      order.push(`${url.split('/').pop()}:${strategy}`);
      return perf(70, 'lighthouse', { formFactor: strategy });
    });
    const outcome = await measureLab(
      base({
        local,
        hasKey: false,
        urls: ['https://example.test/a', 'https://example.test/b'],
        strategies: ['mobile', 'desktop'],
      }),
    );
    expect(order).toEqual(['a:mobile', 'a:desktop', 'b:mobile', 'b:desktop']);
    expect(outcome.pages).toHaveLength(4);
    expect(outcome.method.throttling).toHaveLength(1);
  });

  it('reports the median run of several, with all run scores', async () => {
    const scores = [80, 40, 60];
    const local = fakeEngine('lighthouse', (_url, _strategy, call) => perf(scores[call - 1] ?? 0));
    const outcome = await measureLab(base({ local, hasKey: false, runs: 3 }));
    expect(outcome.pages[0]?.result?.categories.performance).toBe(60);
    expect(outcome.pages[0]?.runs).toEqual({
      scores: [80, 40, 60],
      min: 40,
      max: 80,
      spread: 40,
      failed: 0,
    });
  });

  it('keeps the runs that worked when a later run fails', async () => {
    const local = fakeEngine('lighthouse', (_url, _strategy, call) =>
      call === 2 ? new EngineError('runtime', 'Lighthouse failed') : perf(75),
    );
    const outcome = await measureLab(base({ local, hasKey: false, runs: 3 }));
    expect(outcome.status).toBe('measured');
    expect(outcome.pages[0]?.runs).toMatchObject({ scores: [75], failed: 2 });
    expect(local.calls).toHaveLength(2);
  });

  it('prints the estimate before the first measurement', async () => {
    const messages: string[] = [];
    const local = fakeEngine('lighthouse', () => {
      expect(messages).toHaveLength(1);
      return perf(70);
    });
    await measureLab(
      base({ local, hasKey: false, notice: (message) => messages.push(message), runs: 3 }),
    );
    expect(messages[0]).toBe(
      'Speed: 3 Lighthouse runs (1 pages x 1 strategies x 3 runs), roughly 45 seconds to 3 minutes.',
    );
  });

  it('stops when the signal is aborted and keeps what it has', async () => {
    const controller = new AbortController();
    const local: LabEngine = {
      name: 'lighthouse',
      measure: () => {
        controller.abort();
        return Promise.resolve(perf(70));
      },
    };
    const outcome = await measureLab(
      base({
        local,
        hasKey: false,
        signal: controller.signal,
        urls: ['https://example.test/a', 'https://example.test/b'],
      }),
    );
    expect(outcome.pages).toHaveLength(1);
    expect(outcome.status).toBe('partial');
  });

  it('says that nothing was measured when there are no pages', async () => {
    const outcome = await measureLab(base({ urls: [], psi: fakeEngine('psi', () => perf(1)) }));
    expect(outcome).toMatchObject({
      status: 'not_measured',
      reason: 'There are no pages to measure.',
    });
  });
});

describe('describeMethod', () => {
  it('states engine, version, strategies, runs and throttling', () => {
    expect(
      describeMethod({
        requestedEngine: 'auto',
        runsPerPage: 3,
        strategies: ['mobile', 'desktop'],
        pages: 3,
        enginesUsed: ['lighthouse'],
        fallbacks: 0,
        lighthouseVersions: ['13.6.0'],
        throttling: ['simulate: RTT 150 ms'],
      }),
    ).toBe(
      'Measured with lighthouse (Lighthouse 13.6.0), mobile and desktop, 3 run(s) per page with the median run reported, throttling: simulate: RTT 150 ms.',
    );
  });
});
