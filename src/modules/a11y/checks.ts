import { makeFinding, outcome, toFact } from '../../checks/support.js';
import { pickPages } from '../../crawler/select.js';
import type { Check } from '../../model/check.js';
import type { Finding } from '../../model/finding.js';
import type { AxeImpact } from './axe-types.js';
import { higherImpact, severityForImpact } from './severity.js';

export const MAX_SELECTORS = 10;
const MAX_PAGES_IN_EVIDENCE = 5;
const NO_CHROME =
  'Chrome was not found, so axe-core could not run. Run "cwa doctor" to see what is missing.';

interface RuleGroup {
  id: string;
  help: string;
  helpUrl: string;
  impact: AxeImpact | null;
  pages: Set<string>;
  selectors: string[];
  total: number;
}

const axeCheck: Check = {
  id: 'a11y.axe',
  module: 'a11y',
  codes: ['A11Y-001', 'A11Y-002'],
  async run(context) {
    const { axe, crawl, settings, lab } = context;
    if (!axe) return outcome([], undefined, NO_CHROME);

    const urls = pickPages(crawl, settings.a11yPages);
    if (urls.length === 0)
      return outcome([], undefined, 'There are no crawled HTML pages to test.');
    const run = await axe.run(urls);

    const groups = new Map<string, RuleGroup>();
    for (const page of run.pages) {
      for (const violation of page.violations) {
        const group = groups.get(violation.id) ?? {
          id: violation.id,
          help: violation.help,
          helpUrl: violation.helpUrl,
          impact: null,
          pages: new Set<string>(),
          selectors: [],
          total: 0,
        };
        group.impact = higherImpact(group.impact, violation.impact);
        group.pages.add(page.url);
        group.total += violation.selectors.length;
        for (const selector of violation.selectors) {
          if (group.selectors.length < MAX_SELECTORS)
            group.selectors.push(`${page.url}: ${selector}`);
        }
        groups.set(violation.id, group);
      }
    }

    const findings: Finding[] = [...groups.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((group) => {
        const severity = severityForImpact(group.impact);
        const pages = [...group.pages].slice(0, MAX_PAGES_IN_EVIDENCE);
        return makeFinding(
          'a11y',
          severity === 'important' ? 'A11Y-001' : 'A11Y-002',
          severity,
          [...pages, ...group.selectors],
          {
            ruleId: group.id,
            impact: group.impact ?? 'none',
            help: group.help,
            helpUrl: group.helpUrl,
            elements: group.total,
            pages: group.pages.size,
          },
          MAX_PAGES_IN_EVIDENCE + MAX_SELECTORS,
        );
      });

    const failedPages = run.pages.filter((page) => page.error !== undefined);
    const lighthouseScores = (lab?.pages ?? [])
      .filter((page) => page.result)
      .map((page) => ({
        url: page.url,
        strategy: page.strategy,
        engine: page.engine,
        score: page.result?.categories.accessibility,
      }));
    const facts = {
      axeVersion: run.axeVersion,
      axePagesTested: run.pages.length - failedPages.length,
      axePagesFailed: failedPages.length,
      axeRulesViolated: groups.size,
      lighthouseAccessibility: toFact(lighthouseScores),
    };
    const reason =
      failedPages.length === 0
        ? undefined
        : `${failedPages.length} of ${run.pages.length} pages could not be tested. First problem: ${failedPages[0]?.error ?? 'unknown'}`;
    const allFailed = failedPages.length === run.pages.length;
    return outcome(findings, facts, allFailed ? reason : undefined, allFailed ? undefined : reason);
  },
};

export const a11yChecks: readonly Check[] = [axeCheck];
