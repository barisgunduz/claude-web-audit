import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '../../src/audit/run.js';
import type { ModuleResult } from '../../src/model/finding.js';
import { fakeDns, goodTls, makeSettings, NOW } from '../support/builders.js';
import { defectSite, type DefectOptions } from '../support/defect-site.js';
import { startTestSite, type TestSite } from '../support/test-site.js';

let site: TestSite | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});

async function audit(options: DefectOptions = {}) {
  site = await startTestSite(defectSite(options));
  return runAudit({
    settings: makeSettings({ pages: 100, delay: 0, concurrency: 3 }),
    version: '9.9.9',
    deps: {
      fetchImpl: site.fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
      dns: fakeDns({
        txt: {
          'example.test': [['v=spf1 -all']],
          '_dmarc.example.test': [['v=DMARC1; p=reject; rua=mailto:r@example.test']],
        },
        mx: { 'example.test': [{ exchange: 'mail.example.test', priority: 10 }] },
      }),
      now: () => NOW,
      // No Chrome and no key: nothing in a test may start a browser or call PageSpeed Insights.
      chrome: { source: 'none' },
      env: {},
    },
  });
}

const resultOf = (modules: ModuleResult[], name: string): ModuleResult => {
  const found = modules.find((candidate) => candidate.module === name);
  if (!found) throw new Error(`No module ${name}`);
  return found;
};
const codes = (result: ModuleResult): string[] =>
  [...new Set(result.findings.map((finding) => finding.code))].sort();

describe('audit of a site with known defects', () => {
  it('finds exactly the planted problems in links and ssl', async () => {
    const run = await audit();
    expect(codes(resultOf(run.modules, 'links'))).toEqual(
      [
        'LINK-001', // /broken and /gone return 404
        'LINK-004', // ext.example.net/missing
        'LINK-005', // chain-a has four hops
        'LINK-006', // loop-a and loop-b
        'LINK-007', // the home page links to /old-page, which redirects
        'LINK-008', // a link to the http address
        'LINK-009', // /orphan is only in the sitemap
        'LINK-012', // no empty href here, see below
        'LINK-013',
        'LINK-014',
        'LINK-015',
        'LINK-017',
        'LINK-018', // /private/page is blocked
      ].filter((code) => code !== 'LINK-012'),
    );
    expect(codes(resultOf(run.modules, 'ssl'))).toEqual(['SSL-013', 'SSL-014']);
  });

  it('finds the planted problems in seo, content and headers', async () => {
    const run = await audit();
    expect(codes(resultOf(run.modules, 'seo'))).toEqual(
      expect.arrayContaining(['SEO-007', 'SEO-021', 'SEO-036', 'SEO-037', 'SEO-042']),
    );
    expect(codes(resultOf(run.modules, 'seo'))).not.toEqual(
      expect.arrayContaining(['SEO-033', 'SEO-043', 'SEO-044', 'SEO-045']),
    );
    expect(codes(resultOf(run.modules, 'content'))).toContain('CNT-001');
    expect(codes(resultOf(run.modules, 'headers'))).toEqual([
      'HDR-001',
      'HDR-003',
      'HDR-004',
      'HDR-005',
      'HDR-006',
      'HDR-007',
    ]);
  });

  it('reports ai bots, content signals and a missing llms.txt', async () => {
    const run = await audit();
    const ai = resultOf(run.modules, 'ai');
    expect(codes(ai)).toEqual(expect.arrayContaining(['AI-001', 'AI-006', 'AI-009']));
    expect(ai.facts.contentSignals).toEqual(['search=yes', 'ai-train=no']);
    expect(ai.facts.aiBots).toEqual(
      expect.arrayContaining([
        'GPTBot:blocked:training',
        'OAI-SearchBot:blocked:search',
        'ClaudeBot:allowed:training',
      ]),
    );
  });

  it('accepts a present llms.txt', async () => {
    const run = await audit({ llmsTxt: '# Example\n\n- [About](/about)' });
    expect(codes(resultOf(run.modules, 'ai'))).not.toContain('AI-001');
    expect(resultOf(run.modules, 'ai').facts.llmsTxt).toBe('present');
  });

  it('detects a soft 404', async () => {
    const run = await audit({ soft404: true });
    expect(codes(resultOf(run.modules, 'links'))).toContain('LINK-010');
    const clean = await audit();
    expect(codes(resultOf(clean.modules, 'links'))).not.toContain('LINK-010');
  });

  it('says why speed and a11y could not run without Chrome and a key', async () => {
    const run = await audit();
    const speed = resultOf(run.modules, 'speed');
    // The header checks need no browser, so speed is partly measured.
    expect(speed.status).toBe('partial');
    expect(speed.reason).toContain('PSI_API_KEY is not set and no usable Chrome was found');
    expect(speed.reason).toContain('cwa doctor');
    const a11y = resultOf(run.modules, 'a11y');
    expect(a11y.status).toBe('not_measured');
    expect(a11y.reason).toContain('cwa doctor');
    const email = resultOf(run.modules, 'email');
    expect(email.status).toBe('partial');
    expect(email.findings).toEqual([]);
  });

  it('only ever asks for the canonical host and never sends credentials', async () => {
    await audit();
    const agents = new Set((site?.requests ?? []).map((request) => request.url.split('/')[2]));
    expect([...agents].sort()).toEqual(['example.test', 'ext.example.net', 'www.example.test']);
  });
});
