import { describe, expect, it } from 'vitest';
import type {
  AxeImpact,
  AxePageResult,
  AxeRun,
  AxeRunner,
} from '../../src/modules/a11y/axe-types.js';
import { a11yModule } from '../../src/modules/a11y/index.js';
import { higherImpact, severityForImpact } from '../../src/modules/a11y/severity.js';
import { runModule } from '../../src/modules/runner.js';
import { pickPages } from '../../src/crawler/select.js';
import { makeContext, makeCrawl, makePage, makeSettings, ORIGIN } from '../support/builders.js';
import { labResult } from '../support/lab.js';
import type { LabOutcome } from '../../src/engines/measure.js';

const violation = (
  id: string,
  impact: AxeImpact | null,
  selectors: string[],
  help = `Help for ${id}`,
) => ({ id, impact, help, helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}`, selectors });

function fakeAxe(pages: (url: string) => AxePageResult): AxeRunner & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    run(urls) {
      asked.push([...urls]);
      const run: AxeRun = { axeVersion: '4.14.0', pages: urls.map(pages) };
      return Promise.resolve(run);
    },
  };
}
const crawl = () =>
  makeCrawl({
    pages: [
      makePage({ url: `${ORIGIN}/` }),
      makePage({ url: `${ORIGIN}/a`, inbound: [`${ORIGIN}/`] }),
      makePage({ url: `${ORIGIN}/b`, inbound: [`${ORIGIN}/`, `${ORIGIN}/a`] }),
    ],
  });
const run = (axe: AxeRunner | undefined, settings = makeSettings(), lab?: LabOutcome) =>
  runModule(a11yModule, makeContext(crawl(), { axe, settings, lab }));

describe('severityForImpact', () => {
  it.each([
    ['critical', 'important'],
    ['serious', 'important'],
    ['moderate', 'improvement'],
    ['minor', 'improvement'],
    [null, 'improvement'],
  ] as const)('axe impact %s is %s', (impact, severity) => {
    expect(severityForImpact(impact)).toBe(severity);
  });

  it('never gives critical', () => {
    for (const impact of [null, 'minor', 'moderate', 'serious', 'critical'] as const)
      expect(severityForImpact(impact)).not.toBe('critical');
  });

  it('picks the higher impact', () => {
    expect(higherImpact('minor', 'serious')).toBe('serious');
    expect(higherImpact('critical', 'moderate')).toBe('critical');
    expect(higherImpact(null, 'minor')).toBe('minor');
    expect(higherImpact('minor', null)).toBe('minor');
    expect(higherImpact(null, null)).toBeNull();
  });
});

describe('a11y module', () => {
  it('is not measured and points to cwa doctor when Chrome is missing', async () => {
    const result = await run(undefined);
    expect(result).toMatchObject({ status: 'not_measured', findings: [] });
    expect(result.reason).toContain('cwa doctor');
  });

  it('tests the home page and the most linked pages, up to a11yPages', async () => {
    const axe = fakeAxe((url) => ({ url, violations: [] }));
    await run(axe, makeSettings({ a11yPages: 2 }));
    expect(axe.asked).toEqual([[`${ORIGIN}/`, `${ORIGIN}/b`]]);
  });

  it('makes one finding per rule, with the severity of the axe impact', async () => {
    const axe = fakeAxe((url) => ({
      url,
      violations: [
        violation('color-contrast', 'serious', ['a.x', 'b.y']),
        violation('region', 'moderate', ['body > p']),
        violation('image-alt', 'critical', ['img']),
      ],
    }));
    const result = await run(axe);
    expect(result.findings.map((f) => [f.data.ruleId, f.code, f.severity])).toEqual([
      ['color-contrast', 'A11Y-001', 'important'],
      ['image-alt', 'A11Y-001', 'important'],
      ['region', 'A11Y-002', 'improvement'],
    ]);
    expect(result.findings.some((f) => f.severity === 'critical')).toBe(false);
  });

  it('keeps the rule id, help text and help URL in the data, and counts elements and pages', async () => {
    const axe = fakeAxe((url) => ({
      url,
      violations: [
        violation(
          'color-contrast',
          'serious',
          ['a.x', 'b.y'],
          'Elements must meet minimum color contrast ratio thresholds',
        ),
      ],
    }));
    const finding = (await run(axe)).findings[0];
    expect(finding?.data).toEqual({
      count: finding?.evidence.length,
      ruleId: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast',
      elements: 6,
      pages: 3,
    });
  });

  it('lists the affected pages and at most 10 selectors, and keeps the total count', async () => {
    const axe = fakeAxe((url) => ({
      url,
      violations: url.endsWith('/')
        ? [
            violation(
              'label',
              'critical',
              Array.from({ length: 25 }, (_, index) => `#field-${index}`),
            ),
          ]
        : [],
    }));
    const finding = (await run(axe)).findings[0];
    expect(finding?.evidence.slice(0, 1)).toEqual([`${ORIGIN}/`]);
    expect(finding?.evidence.filter((line) => line.includes('#field-'))).toHaveLength(10);
    expect(finding?.evidence[1]).toBe(`${ORIGIN}/: #field-0`);
    expect(finding?.data.elements).toBe(25);
  });

  it('uses the highest impact that a rule has on any page', async () => {
    const axe = fakeAxe((url) => ({
      url,
      violations: [violation('link-name', url.endsWith('/b') ? 'serious' : 'minor', ['a'])],
    }));
    expect((await run(axe)).findings[0]).toMatchObject({
      severity: 'important',
      data: { impact: 'serious' },
    });
  });

  it('gives a rule without an impact the improvement severity', async () => {
    const axe = fakeAxe((url) => ({ url, violations: [violation('some-rule', null, ['p'])] }));
    expect((await run(axe)).findings[0]).toMatchObject({
      code: 'A11Y-002',
      data: { impact: 'none' },
    });
  });

  it('reports nothing for clean pages and stores the axe version and counts', async () => {
    const result = await run(fakeAxe((url) => ({ url, violations: [] })));
    expect(result.status).toBe('measured');
    expect(result.facts).toMatchObject({
      axeVersion: '4.14.0',
      axePagesTested: 3,
      axePagesFailed: 0,
      axeRulesViolated: 0,
    });
  });

  it('is partial when some pages could not be tested, and not measured when none could', async () => {
    const partial = await run(
      fakeAxe((url) =>
        url.endsWith('/a')
          ? { url, violations: [], error: 'Navigation timeout' }
          : { url, violations: [violation('region', 'minor', ['p'])] },
      ),
    );
    expect(partial.status).toBe('partial');
    expect(partial.reason).toContain('1 of 3 pages could not be tested');
    expect(partial.reason).toContain('Navigation timeout');
    expect(partial.findings).toHaveLength(1);
    const none = await run(fakeAxe((url) => ({ url, violations: [], error: 'net::ERR_FAILED' })));
    expect(none.status).toBe('not_measured');
  });

  it('keeps the Lighthouse accessibility score as a fact, from the speed results', async () => {
    const lab: LabOutcome = {
      status: 'measured',
      pages: [
        {
          url: `${ORIGIN}/`,
          strategy: 'mobile',
          engine: 'lighthouse',
          result: labResult(),
          runs: { scores: [90], min: 90, max: 90, spread: 0, failed: 0 },
        },
      ],
      method: {
        requestedEngine: 'auto',
        runsPerPage: 1,
        strategies: ['mobile'],
        pages: 1,
        enginesUsed: ['lighthouse'],
        fallbacks: 0,
        lighthouseVersions: ['13.6.0'],
        throttling: [],
      },
    };
    const result = await run(
      fakeAxe((url) => ({ url, violations: [] })),
      makeSettings(),
      lab,
    );
    expect(result.facts.lighthouseAccessibility).toEqual([
      { url: `${ORIGIN}/`, strategy: 'mobile', engine: 'lighthouse', score: 95 },
    ]);
  });
});

describe('pickPages', () => {
  it('puts the home page first, then the most linked pages, once per final URL', () => {
    const pages = [
      makePage({ url: `${ORIGIN}/low`, inbound: ['x'] }),
      makePage({ url: `${ORIGIN}/`, inbound: [] }),
      makePage({ url: `${ORIGIN}/hub`, inbound: ['x', 'y', 'z'] }),
      makePage({ url: `${ORIGIN}/old`, finalUrl: `${ORIGIN}/hub`, inbound: ['q'] }),
      makePage({ url: `${ORIGIN}/same`, inbound: ['x'] }),
      makePage({
        url: `${ORIGIN}/broken`,
        status: 404,
        html: undefined,
        inbound: ['x', 'y', 'z', 'w'],
      }),
    ];
    expect(pickPages(makeCrawl({ pages }), 10)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/hub`,
      `${ORIGIN}/low`,
      `${ORIGIN}/same`,
    ]);
    expect(pickPages(makeCrawl({ pages }), 2)).toEqual([`${ORIGIN}/`, `${ORIGIN}/hub`]);
  });
  it('works without a home page', () => {
    expect(
      pickPages(makeCrawl({ pages: [makePage({ url: `${ORIGIN}/a`, inbound: ['x'] })] }), 3),
    ).toEqual([`${ORIGIN}/a`]);
  });
});
