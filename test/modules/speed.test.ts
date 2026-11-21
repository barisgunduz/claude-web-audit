import { describe, expect, it } from 'vitest';
import type { LabOutcome, LabPageResult } from '../../src/engines/measure.js';
import type { AuditSummary, FormFactor, LabResult } from '../../src/engines/types.js';
import { speedModule } from '../../src/modules/speed/index.js';
import { bandOf, formatMetric, METRIC_CODES, rateMetric } from '../../src/modules/speed/rating.js';
import { runModule } from '../../src/modules/runner.js';
import { makeContext, makeCrawl, makePage, ORIGIN, pageHtml } from '../support/builders.js';
import { labResult } from '../support/lab.js';

const ms = (value: number) => ({ value, unit: 'millisecond' as const });

function page(result: LabResult, url = `${ORIGIN}/`): LabPageResult {
  return {
    url,
    strategy: result.formFactor,
    engine: result.engine,
    result,
    runs: {
      scores: [result.categories.performance],
      min: result.categories.performance,
      max: result.categories.performance,
      spread: 0,
      failed: 0,
    },
  };
}
function outcome(pages: LabPageResult[], extra: Partial<LabOutcome> = {}): LabOutcome {
  return {
    status: 'measured',
    pages,
    method: {
      requestedEngine: 'auto',
      runsPerPage: 1,
      strategies: ['mobile'],
      pages: pages.length,
      enginesUsed: ['lighthouse'],
      fallbacks: 0,
      lighthouseVersions: ['13.6.0'],
      throttling: ['simulate'],
    },
    ...extra,
  };
}
const audit = (overrides: Partial<AuditSummary> & { id: string }): AuditSummary => ({
  title: overrides.id,
  score: 0.3,
  displayMode: 'metricSavings',
  items: [],
  ...overrides,
});
const withPerf = (
  score: number,
  formFactor: FormFactor = 'mobile',
  overrides: Partial<LabResult> = {},
) =>
  labResult({
    formFactor,
    categories: { performance: score, accessibility: 95, 'best-practices': 100, seo: 90 },
    ...overrides,
  });

const crawlWithHome = () =>
  makeCrawl({ pages: [makePage({ url: `${ORIGIN}/`, headers: { 'content-encoding': 'br' } })] });
async function codesFor(lab: LabOutcome | undefined, crawl = crawlWithHome()) {
  const result = await runModule(speedModule, makeContext(crawl, { lab }));
  return result;
}

describe('rateMetric with the Lighthouse control points', () => {
  it.each([
    ['lcp', 'mobile', 2500, 'good'],
    ['lcp', 'mobile', 2501, 'needs-improvement'],
    ['lcp', 'mobile', 4000, 'needs-improvement'],
    ['lcp', 'mobile', 4001, 'poor'],
    ['lcp', 'desktop', 1200, 'good'],
    ['lcp', 'desktop', 1201, 'needs-improvement'],
    ['lcp', 'desktop', 2401, 'poor'],
    ['fcp', 'mobile', 1800, 'good'],
    ['fcp', 'mobile', 3001, 'poor'],
    ['fcp', 'desktop', 934, 'good'],
    ['fcp', 'desktop', 1601, 'poor'],
    ['tbt', 'mobile', 200, 'good'],
    ['tbt', 'mobile', 601, 'poor'],
    ['tbt', 'desktop', 150, 'good'],
    ['tbt', 'desktop', 351, 'poor'],
    ['cls', 'mobile', 0.1, 'good'],
    ['cls', 'mobile', 0.11, 'needs-improvement'],
    ['cls', 'desktop', 0.26, 'poor'],
    ['speedIndex', 'mobile', 3387, 'good'],
    ['speedIndex', 'mobile', 5801, 'poor'],
    ['speedIndex', 'desktop', 1311, 'good'],
    ['speedIndex', 'desktop', 2301, 'poor'],
  ] as const)('%s on %s at %s is %s', (name, formFactor, value, expected) => {
    expect(rateMetric(name, formFactor, value)).toBe(expected);
  });

  it('has a code for every metric', () => {
    expect(Object.keys(METRIC_CODES).sort()).toEqual(['cls', 'fcp', 'lcp', 'speedIndex', 'tbt']);
  });

  it('formats a metric with its display text or its value', () => {
    expect(formatMetric({ value: 2400, unit: 'millisecond', display: '2.4 s' })).toBe('2.4 s');
    expect(formatMetric({ value: 2400.4, unit: 'millisecond' })).toBe('2400 ms');
    expect(formatMetric({ value: 0.1234, unit: 'unitless' })).toBe('0.123');
  });
});

describe('bandOf the performance score', () => {
  it.each([
    [49, 'mobile', 'critical'],
    [50, 'mobile', 'needs-improvement'],
    [89, 'mobile', 'needs-improvement'],
    [90, 'mobile', 'good'],
    [49, 'desktop', 'poor'],
    [50, 'desktop', 'needs-improvement'],
    [90, 'desktop', 'good'],
  ] as const)('%s on %s is %s', (score, formFactor, expected) => {
    expect(bandOf(score, formFactor)).toBe(expected);
  });
});

describe('speed.lab-metrics', () => {
  it('reports a mobile score below 50 as critical and names the page and strategy', async () => {
    const result = await codesFor(outcome([page(withPerf(42))]));
    const finding = result.findings.find((candidate) => candidate.code === 'SPD-001');
    expect(finding).toMatchObject({
      severity: 'critical',
      evidence: [`${ORIGIN}/ (mobile): 42`],
      data: { lowest: 42 },
    });
  });

  it('reports desktop below 50 as important and 50 to 89 as an improvement', async () => {
    const desktop = await codesFor(outcome([page(withPerf(45, 'desktop'))]));
    expect(desktop.findings.find((f) => f.code === 'SPD-001')?.severity).toBe('important');
    const middle = await codesFor(outcome([page(withPerf(75))]));
    expect(middle.findings.find((f) => f.code === 'SPD-001')?.severity).toBe('improvement');
    const good = await codesFor(outcome([page(withPerf(90))]));
    expect(good.findings.find((f) => f.code === 'SPD-001')).toBeUndefined();
  });

  it('rates every metric with the limits of the form factor', async () => {
    // 1.5 s LCP is good on mobile (limit 2.5 s) but needs improvement on desktop (limit 1.2 s).
    const mobile = await codesFor(outcome([page(withPerf(95, 'mobile'))]));
    expect(mobile.findings.find((f) => f.code === 'SPD-002')).toBeUndefined();
    const desktop = await codesFor(outcome([page(withPerf(95, 'desktop'))]));
    expect(desktop.findings.find((f) => f.code === 'SPD-002')).toMatchObject({
      severity: 'improvement',
      data: { poor: 0, needsImprovement: 1 },
    });
  });

  it('makes a poor metric important, and counts poor and needs-improvement pages', async () => {
    const poorLcp = withPerf(95, 'mobile', {
      metrics: {
        ...labResult().metrics,
        lcp: { value: 5200, unit: 'millisecond', display: '5.2 s' },
      },
    });
    const slowLcp = withPerf(95, 'mobile', { metrics: { ...labResult().metrics, lcp: ms(3000) } });
    const result = await codesFor(
      outcome([page(poorLcp, `${ORIGIN}/a`), page(slowLcp, `${ORIGIN}/b`)]),
    );
    const finding = result.findings.find((f) => f.code === 'SPD-002');
    expect(finding).toMatchObject({
      severity: 'important',
      data: { metric: 'Largest Contentful Paint', poor: 1, needsImprovement: 1 },
    });
    expect(finding?.evidence).toEqual([
      `${ORIGIN}/a (mobile): 5.2 s (poor)`,
      `${ORIGIN}/b (mobile): 3000 ms (needs improvement)`,
    ]);
  });

  it('skips a metric that Lighthouse did not return', async () => {
    const result = await codesFor(
      outcome([page(withPerf(95, 'mobile', { metrics: { ...labResult().metrics, cls: null } }))]),
    );
    expect(result.findings.find((f) => f.code === 'SPD-005')).toBeUndefined();
  });

  it('stores the facts that the report needs', async () => {
    const result = await codesFor(
      outcome([
        {
          ...page(
            withPerf(80, 'mobile', { transferBytes: 5000, lcpElement: { selector: 'img.hero' } }),
          ),
          runs: { scores: [70, 80, 90], min: 70, max: 90, spread: 20, failed: 0 },
        },
      ]),
    );
    const lab = result.facts.lab as {
      method: Record<string, unknown>;
      pages: Record<string, unknown>[];
    };
    expect(lab.method).toMatchObject({
      requestedEngine: 'auto',
      runsPerPage: 1,
      lighthouseVersions: ['13.6.0'],
    });
    expect(lab.pages[0]).toMatchObject({
      url: `${ORIGIN}/`,
      strategy: 'mobile',
      engine: 'lighthouse',
      runScores: [70, 80, 90],
      runMin: 70,
      runMax: 90,
      runSpread: 20,
      lighthouseVersion: '13.6.0',
      throttling: expect.stringContaining('RTT 150 ms'),
      fetchedAt: '2026-11-21T12:00:00.000Z',
      categories: { performance: 80, accessibility: 95, 'best-practices': 100, seo: 90 },
      transferBytes: 5000,
      lcpElement: { selector: 'img.hero' },
    });
    expect((lab.pages[0]?.metrics as Record<string, unknown>).lcp).toMatchObject({
      value: 1500,
      unit: 'millisecond',
    });
  });
});

describe('speed.lab-audits', () => {
  const run = async (audits: AuditSummary[], result: Partial<LabResult> = {}) =>
    codesFor(outcome([page(withPerf(80, 'mobile', { audits, ...result }))]));

  it('turns Lighthouse audits into findings with the estimated savings as evidence', async () => {
    const result = await run([
      audit({
        id: 'render-blocking-insight',
        title: 'Render blocking requests',
        score: 0.2,
        savingsMs: 450,
        items: [{ url: 'https://example.test/a.css' }],
      }),
    ]);
    const finding = result.findings.find((f) => f.code === 'SPD-020');
    expect(finding).toMatchObject({ severity: 'important', data: { savingsMs: 450 } });
    expect(finding?.evidence[0]).toBe(
      `${ORIGIN}/ (mobile): Render blocking requests, estimated savings about 450 ms, for example https://example.test/a.css`,
    );
  });

  it('uses the audit score for severity: below 0.5 is important, 0.5 to 0.9 an improvement', async () => {
    const result = await run([
      audit({ id: 'unused-css-rules', score: 0.5, savingsBytes: 20_480 }),
      audit({ id: 'unused-javascript', score: 0.49 }),
    ]);
    expect(result.findings.find((f) => f.code === 'SPD-021')).toMatchObject({
      severity: 'improvement',
      data: { savingsKiB: 20 },
    });
    expect(result.findings.find((f) => f.code === 'SPD-022')?.severity).toBe('important');
  });

  it('skips the audits that the header checks own', async () => {
    const result = await run([
      audit({ id: 'cache-insight', score: 0 }),
      audit({ id: 'uses-text-compression', score: 0 }),
      audit({ id: 'uses-long-cache-ttl', score: 0 }),
    ]);
    expect(result.findings.filter((f) => f.code.startsWith('SPD-0'))).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          evidence: expect.arrayContaining([expect.stringContaining('cache')]),
        }),
      ]),
    );
    expect(
      result.findings.map((f) => f.code).filter((code) => code >= 'SPD-020' && code <= 'SPD-040'),
    ).toEqual([]);
  });

  it('reads the redirect and server answers of document-latency-insight, and ignores its compression answer', async () => {
    const result = await run([
      audit({
        id: 'document-latency-insight',
        score: 0.4,
        checklist: { noRedirects: false, serverResponseIsFast: false, usesCompression: false },
      }),
    ]);
    expect(result.findings.map((f) => [f.code, f.severity])).toEqual(
      expect.arrayContaining([
        ['SPD-038', 'improvement'],
        ['SPD-039', 'important'],
      ]),
    );
    expect(result.findings.some((f) => f.code === 'SPD-050')).toBe(false);
  });

  it('counts a code once per page when two audits map to it', async () => {
    const result = await run([
      audit({ id: 'cls-culprits-insight', score: 0.4 }),
      audit({ id: 'layout-shifts', score: 0.4 }),
    ]);
    expect(result.findings.find((f) => f.code === 'SPD-027')?.evidence).toHaveLength(1);
  });

  it('reports long tasks only when Total Blocking Time is not good', async () => {
    const longTasks = audit({
      id: 'long-tasks',
      score: null,
      displayMode: 'informative',
      items: [{ url: 'https://example.test/app.js', duration: 300 }],
    });
    expect((await run([longTasks])).findings.some((f) => f.code === 'SPD-028')).toBe(false);
    const slow = await run([longTasks], { metrics: { ...labResult().metrics, tbt: ms(450) } });
    expect(slow.findings.some((f) => f.code === 'SPD-028')).toBe(true);
  });

  it('reports page weight with its size, from the Lighthouse result', async () => {
    const result = await run([audit({ id: 'total-byte-weight', score: 0.2 })], {
      transferBytes: 6 * 1024 * 1024,
    });
    expect(result.findings.find((f) => f.code === 'SPD-040')).toMatchObject({
      data: { largestKiB: 6144 },
    });
  });

  it('ignores audits it does not know', async () => {
    const result = await run([audit({ id: 'some-new-audit', score: 0 })]);
    expect(result.findings.filter((f) => /^SPD-0[2-4]/.test(f.code))).toEqual([]);
  });
});

describe('speed status', () => {
  it('is partial with the reason when only some pages were measured', async () => {
    const lab = outcome([page(withPerf(95))], {
      status: 'partial',
      reason: '1 of 2 measurements finished. First problem: quota',
    });
    const result = await codesFor(lab);
    expect(result.status).toBe('partial');
    expect(result.reason).toContain('1 of 2 measurements finished');
  });

  it('is partial, not not_measured, when Lighthouse could not run but the header checks did', async () => {
    const result = await codesFor(
      outcome([], {
        status: 'not_measured',
        reason: 'No usable Chrome was found. Run "cwa doctor" to see what is missing.',
      }),
    );
    expect(result.status).toBe('partial');
    expect(result.reason).toContain('cwa doctor');
    expect(result.findings.filter((f) => f.code.startsWith('SPD-00'))).toEqual([]);
  });

  it('is not measured when neither Lighthouse nor the header checks have anything', async () => {
    const result = await codesFor(undefined, makeCrawl());
    expect(result.status).toBe('not_measured');
  });

  it('is measured when everything worked', async () => {
    const html = pageHtml({});
    const crawl = makeCrawl({
      pages: [makePage({ url: `${ORIGIN}/`, html, headers: { 'content-encoding': 'gzip' } })],
    });
    const result = await codesFor(outcome([page(withPerf(95))]), crawl);
    expect(result.status).toBe('measured');
  });
});
