import { describe, expect, it } from 'vitest';
import { AI_BOTS } from '../../src/modules/ai/bots.js';
import { aiChecks } from '../../src/modules/ai/checks.js';
import type { Check } from '../../src/model/check.js';
import type { ProbeRecord } from '../../src/model/crawl.js';
import {
  codesOf,
  fakeHttp,
  makeContext,
  makeCrawl,
  makePage,
  ORIGIN,
  pageHtml,
  withRobots,
} from '../support/builders.js';

function check(id: string): Check {
  const found = aiChecks.find((candidate) => candidate.id === `ai.${id}`);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}
const llms = (status: number, contentType: string, body: string): ProbeRecord => ({
  url: `${ORIGIN}/llms.txt`,
  finalUrl: `${ORIGIN}/llms.txt`,
  status,
  chain: [],
  loop: false,
  contentType,
  body,
});

describe('ai.llms-txt', () => {
  const run = (probe: ProbeRecord, routes = {}) =>
    check('llms-txt').run(makeContext(makeCrawl({ llmsProbe: probe }), { http: fakeHttp(routes) }));
  it('reports a missing file', async () => {
    expect(codesOf((await run(llms(404, '', ''))).findings)).toEqual(['AI-001']);
  });
  it('accepts a well-formed file whose links resolve', async () => {
    const body = '# Example\n\n> About\n\n- [Docs](/docs)\n- [Blog](https://example.test/blog)';
    const result = await run(llms(200, 'text/plain; charset=utf-8', body), {
      [`${ORIGIN}/docs`]: { status: 200 },
      [`${ORIGIN}/blog`]: { status: 200 },
    });
    expect(result.findings).toEqual([]);
    expect(result.facts).toMatchObject({ llmsTxt: 'present', llmsTxtLinksChecked: 2 });
  });
  it('flags content type, structure and broken links', async () => {
    const result = await run(llms(200, 'text/html', 'No title here\n[Gone](/gone)'), {});
    expect(codesOf(result.findings)).toEqual(['AI-002', 'AI-004', 'AI-005']);
    expect(result.findings.find((finding) => finding.code === 'AI-005')?.evidence).toEqual([
      `${ORIGIN}/gone (404)`,
    ]);
  });
  it('flags an empty file', async () => {
    expect(codesOf((await run(llms(200, 'text/plain', '  \n'))).findings)).toEqual(['AI-003']);
  });
  it('accepts markdown content type', async () => {
    expect((await run(llms(200, 'text/markdown', '# Title'))).findings).toEqual([]);
  });
  it('says not measured when the request failed', async () => {
    expect((await run(llms(0, '', ''))).notMeasured).toBeDefined();
  });
});

describe('ai.bot-status', () => {
  const run = (robotsText: string, status = 200) =>
    check('bot-status').run(makeContext(makeCrawl({ robots: withRobots(robotsText, status) })));
  it('uses the official token list with a purpose for each bot', () => {
    expect(AI_BOTS.map((bot) => bot.token)).toEqual(
      expect.arrayContaining([
        'GPTBot',
        'OAI-SearchBot',
        'ChatGPT-User',
        'ClaudeBot',
        'Claude-SearchBot',
        'Claude-User',
        'PerplexityBot',
        'Google-Extended',
      ]),
    );
    expect(new Set(AI_BOTS.map((bot) => bot.token)).size).toBe(AI_BOTS.length);
    expect(new Set(AI_BOTS.map((bot) => bot.purpose))).toEqual(
      new Set(['training', 'search', 'user']),
    );
  });
  it('reports blocked training bots only in the facts', async () => {
    const result = await run(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /',
    );
    expect(result.findings).toEqual([]);
    expect(result.facts?.aiBots).toEqual(
      expect.arrayContaining([
        'GPTBot:blocked:training',
        'ClaudeBot:blocked:training',
        'OAI-SearchBot:allowed:search',
      ]),
    );
  });
  it('flags blocked search and user-triggered bots', async () => {
    const result = await run(
      'User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /',
    );
    expect(result.findings[0]).toMatchObject({ code: 'AI-006', severity: 'improvement' });
    expect(result.findings[0]?.evidence).toEqual([
      'OAI-SearchBot (OpenAI, search)',
      'PerplexityBot (Perplexity, search)',
    ]);
  });
  it('treats a blanket block as a block for every bot', async () => {
    const result = await run('User-agent: *\nDisallow: /');
    expect(result.findings[0]?.data.count).toBe(
      AI_BOTS.filter((bot) => bot.purpose !== 'training').length,
    );
  });
  it('treats a missing robots.txt as allowed', async () => {
    const result = await run('', 404);
    expect(result.findings).toEqual([]);
    expect(result.facts?.aiBots).toEqual(expect.arrayContaining(['GPTBot:allowed:training']));
  });
  it('parses Content-Signal and flags values it does not recognize', async () => {
    const good = await run('User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=no');
    expect(good.findings).toEqual([]);
    expect(good.facts?.contentSignals).toEqual(['search=yes', 'ai-input=yes', 'ai-train=no']);
    const bad = await run('User-agent: *\nContent-Signal: ai-train=maybe, mining=yes');
    expect(bad.findings[0]).toMatchObject({
      code: 'AI-007',
      evidence: ['ai-train=maybe', 'mining=yes'],
    });
  });
  it('says not measured when robots.txt could not be fetched', async () => {
    expect((await run('', 0)).notMeasured).toBeDefined();
  });
});

describe('ai.static-content', () => {
  const scripts =
    '<script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>';
  const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
  const run = (html: string) =>
    check('static-content').run(
      makeContext(makeCrawl({ pages: [makePage({ url: `${ORIGIN}/`, html })] })),
    );
  it('flags a nearly empty page with many scripts, with low-confidence data', async () => {
    const result = await run(pageHtml({ body: `<div id="root"></div>${scripts}` }));
    expect(result.findings[0]).toMatchObject({ code: 'AI-008', severity: 'important' });
    expect(result.findings[0]?.evidence[0]).toContain('empty root element');
  });
  it('accepts a page with readable text, and a short page without script signs', async () => {
    expect(
      (await run(pageHtml({ body: `<div id="root"><p>${words}</p></div>${scripts}` }))).findings,
    ).toEqual([]);
    expect((await run(pageHtml({ body: '<p>Hi</p>' }))).findings).toEqual([]);
  });
  it('does not count text inside script or noscript', async () => {
    const result = await run(
      pageHtml({
        body: `<div id="app"></div><noscript>${words}</noscript><script>var t="${words}"</script>`,
      }),
    );
    expect(codesOf(result.findings)).toEqual(['AI-008']);
  });
});

describe('ai.entity-data', () => {
  const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;
  const run = (head: string) =>
    check('entity-data').run(
      makeContext(
        makeCrawl({ pages: [makePage({ url: `${ORIGIN}/`, html: pageHtml({ head }) })] }),
      ),
    );
  it('flags a home page without organization data', async () => {
    expect(
      codesOf(
        (await run(ld('{"@context":"https://schema.org","@type":"WebSite","name":"A"}'))).findings,
      ),
    ).toEqual(['AI-009']);
    expect(codesOf((await run('')).findings)).toEqual(['AI-009']);
  });
  it('lists missing entity properties', async () => {
    const result = await run(
      ld(
        '{"@context":"https://schema.org","@type":"Organization","name":"A","url":"https://example.test"}',
      ),
    );
    expect(result.findings[0]).toMatchObject({
      code: 'AI-010',
      evidence: [`${ORIGIN}/: logo`, `${ORIGIN}/: address`, `${ORIGIN}/: sameAs`],
    });
  });
  it('accepts a complete entity inside @graph, including a LocalBusiness subtype', async () => {
    const graph =
      '{"@context":"https://schema.org","@graph":[{"@type":"Dentist","name":"A","url":"u","logo":"l","address":"a","sameAs":["https://social.test/a"]}]}';
    expect((await run(ld(graph))).findings).toEqual([]);
  });
  it('says not measured when the home page is missing', async () => {
    expect((await check('entity-data').run(makeContext(makeCrawl()))).notMeasured).toBeDefined();
  });
});
