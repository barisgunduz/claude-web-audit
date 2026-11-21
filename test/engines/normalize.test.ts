import { describe, expect, it } from 'vitest';
import { normalizeLighthouseResult, readFieldData } from '../../src/engines/normalize.js';
import { EngineError } from '../../src/engines/types.js';
import { FIXTURE } from '../support/lab.js';

const normalize = (raw: unknown = FIXTURE.lighthouseResult) =>
  normalizeLighthouseResult(raw, { engine: 'psi', url: 'https://example.com/' });

describe('normalizeLighthouseResult with a real result', () => {
  const result = normalize();

  it('keeps the identity and method of the run', () => {
    expect(result).toMatchObject({
      url: 'https://example.com/',
      engine: 'psi',
      formFactor: 'mobile',
      lighthouseVersion: '13.6.0',
      throttling: 'simulate: RTT 150 ms, throughput 1638.4 Kbps, CPU slowdown 4x',
    });
    expect(Date.parse(result.fetchedAt)).not.toBeNaN();
  });

  it('reads category scores as whole numbers from 0 to 100', () => {
    expect(result.categories).toEqual({
      performance: 99,
      accessibility: 96,
      'best-practices': 100,
      seo: 80,
    });
  });

  it('reads the five metrics with their units', () => {
    expect(result.metrics.fcp).toMatchObject({
      unit: 'millisecond',
      display: expect.stringMatching(/^0\.8\s*s$/),
    });
    expect(result.metrics.lcp?.value).toBeCloseTo(894.64, 1);
    expect(result.metrics.tbt).toMatchObject({ value: 94, unit: 'millisecond' });
    expect(result.metrics.cls).toMatchObject({ value: 0, unit: 'unitless' });
    expect(result.metrics.speedIndex?.value).toBeGreaterThan(800);
  });

  it('lists only audits below 0.9, and not the metric audits', () => {
    const ids = result.audits.map((audit) => audit.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'landmark-one-main',
        'meta-description',
        'link-text',
        'cache-insight',
        'network-dependency-tree-insight',
      ]),
    );
    expect(ids).not.toContain('largest-contentful-paint');
    expect(ids).not.toContain('render-blocking-insight');
    for (const audit of result.audits) {
      if (audit.displayMode !== 'informative') expect(audit.score).toBeLessThan(0.9);
    }
  });

  it('keeps savings and table rows of an audit, flattened', () => {
    const cache = result.audits.find((audit) => audit.id === 'cache-insight');
    expect(cache).toMatchObject({ score: 0.5, savingsBytes: 1500 });
    expect(cache?.items[0]).toMatchObject({
      url: 'https://example.com/s.js',
      cacheLifetimeMs: 0,
      wastedBytes: 1500,
    });
  });

  it('keeps informative long tasks only because they carry rows', () => {
    const tasks = result.audits.find((audit) => audit.id === 'long-tasks');
    expect(tasks?.items.length).toBeGreaterThan(0);
  });

  it('finds the LCP element and the transfer size', () => {
    expect(result.lcpElement).toMatchObject({ selector: 'body > p', snippet: '<p lang="ru">' });
    expect(result.transferBytes).toBe(2022);
  });

  it('drops everything it does not use', () => {
    const text = JSON.stringify(result);
    expect(text).not.toContain('fullPageScreenshot');
    expect(text).not.toContain('boundingRect');
    expect(Object.keys(result).sort()).toEqual(
      [
        'audits',
        'categories',
        'engine',
        'fetchedAt',
        'finalUrl',
        'formFactor',
        'lcpElement',
        'lighthouseVersion',
        'metrics',
        'throttling',
        'transferBytes',
        'url',
      ].sort(),
    );
  });
});

describe('normalizeLighthouseResult edge cases', () => {
  const base = (): Record<string, unknown> => structuredClone(FIXTURE.lighthouseResult);

  it('reads the form factor from emulatedFormFactor, as PSI names it', () => {
    const raw = base();
    raw.configSettings = { emulatedFormFactor: 'desktop' };
    const result = normalize(raw);
    expect(result.formFactor).toBe('desktop');
    expect(result.throttling).toBe('not reported by the engine');
  });

  it('keeps the checklist answers of document-latency-insight', () => {
    const raw = base();
    (raw.audits as Record<string, unknown>)['document-latency-insight'] = {
      id: 'document-latency-insight',
      title: 'Document request latency',
      score: 0.5,
      scoreDisplayMode: 'metricSavings',
      metricSavings: { FCP: 300, LCP: 450 },
      details: {
        type: 'checklist',
        items: {
          noRedirects: { label: 'x', value: false },
          serverResponseIsFast: { label: 'y', value: true },
        },
      },
    };
    const audit = normalize(raw).audits.find((entry) => entry.id === 'document-latency-insight');
    expect(audit?.checklist).toEqual({ noRedirects: false, serverResponseIsFast: true });
    expect(audit?.savingsMs).toBe(450);
  });

  it('cuts rows to five and long text to 200 characters', () => {
    const raw = base();
    (raw.audits as Record<string, unknown>)['unused-css-rules'] = {
      id: 'unused-css-rules',
      title: 'T'.repeat(500),
      score: 0.2,
      scoreDisplayMode: 'metricSavings',
      details: {
        type: 'opportunity',
        overallSavingsMs: 120,
        overallSavingsBytes: 4096,
        items: Array.from({ length: 9 }, (_, index) => ({
          url: `https://e.test/${index}.css`,
          wastedBytes: 10,
        })),
      },
    };
    const audit = normalize(raw).audits.find((entry) => entry.id === 'unused-css-rules');
    expect(audit?.items).toHaveLength(5);
    expect(audit?.title.length).toBeLessThanOrEqual(203);
    expect(audit).toMatchObject({ savingsMs: 120, savingsBytes: 4096 });
  });

  it('gives null for a category without a score and for a missing metric', () => {
    const raw = base();
    (raw.categories as Record<string, unknown>).seo = { id: 'seo', score: null };
    delete (raw.audits as Record<string, unknown>)['speed-index'];
    const result = normalize(raw);
    expect(result.categories.seo).toBeNull();
    expect(result.metrics.speedIndex).toBeNull();
  });

  it.each([
    ['not an object', 'text'],
    [
      'no audits',
      { categories: {}, configSettings: { formFactor: 'mobile' }, lighthouseVersion: '1' },
    ],
    [
      'no categories',
      { audits: {}, configSettings: { formFactor: 'mobile' }, lighthouseVersion: '1' },
    ],
    ['no settings', { audits: {}, categories: {}, lighthouseVersion: '1' }],
    [
      'an unknown form factor',
      {
        audits: {},
        categories: {},
        configSettings: { formFactor: 'tablet' },
        lighthouseVersion: '1',
      },
    ],
    ['no version', { audits: {}, categories: {}, configSettings: { formFactor: 'mobile' } }],
  ])('rejects a result with %s', (_name, raw) => {
    expect(() => normalize(raw)).toThrow(EngineError);
    expect(() => normalize(raw)).toThrow(expect.objectContaining({ kind: 'invalid_response' }));
  });
});

describe('readFieldData', () => {
  it('reads real-user data when it has the expected shape', () => {
    expect(readFieldData(FIXTURE.loadingExperience)).toEqual({
      overallCategory: 'FAST',
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1300, category: 'FAST' },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 2, category: 'FAST' },
      },
    });
  });

  it.each([
    undefined,
    null,
    'x',
    {},
    { metrics: 'x' },
    { metrics: {} },
    { metrics: { A: { percentile: 'x' } } },
  ])('ignores %j', (value) => {
    expect(readFieldData(value)).toBeUndefined();
  });
});
