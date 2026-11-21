import { loadPage, visibleText } from '../../crawler/dom.js';
import { contentSignalsFor, isAllowed } from '../../crawler/robots.js';
import { traceUrl } from '../../crawler/trace.js';
import { resolveUrl } from '../../crawler/url.js';
import { flattenNodes, hasValue, readBlocks, typesOf } from '../../checks/jsonld.js';
import { homePage, htmlPages, makeFinding, outcome, samplePages } from '../../checks/support.js';
import type { Check } from '../../model/check.js';
import rules from '../seo/jsonld-rules.json' with { type: 'json' };
import { AI_BOTS, CONTENT_SIGNAL_NAMES, CONTENT_SIGNAL_VALUES } from './bots.js';

const LLMS_LINK_LIMIT = 20;
const ENTITY_PROPERTIES = ['name', 'url', 'logo', 'address', 'sameAs'];
const ORGANIZATION_TYPES = new Set([
  'Organization',
  'Corporation',
  'NGO',
  ...rules.localBusinessSubtypes,
]);

const llmsTxt: Check = {
  id: 'ai.llms-txt',
  module: 'ai',
  codes: ['AI-001', 'AI-002', 'AI-003', 'AI-004', 'AI-005'],
  async run(context) {
    const probe = context.crawl.llmsProbe;
    if (probe.status === 0) return outcome([], undefined, 'llms.txt could not be fetched');
    if (probe.status !== 200)
      return outcome([makeFinding('ai', 'AI-001', 'improvement', [probe.url])], {
        llmsTxt: 'missing',
      });

    const findings = [];
    const isText = /text\/(plain|markdown)/.test(probe.contentType);
    if (!isText)
      findings.push(
        makeFinding('ai', 'AI-002', 'improvement', [probe.url], {
          contentType: probe.contentType || 'none',
        }),
      );
    const body = probe.body.trim();
    if (body === '') {
      findings.push(makeFinding('ai', 'AI-003', 'improvement', [probe.url]));
      return outcome(findings, { llmsTxt: 'empty' });
    }
    if (!/^#\s+\S/.test(body))
      findings.push(makeFinding('ai', 'AI-004', 'improvement', [probe.url]));

    const links = [...body.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => resolveUrl(match[1] ?? '', probe.finalUrl))
      .filter((url): url is string => url !== undefined);
    const unique = [...new Set(links)].slice(0, LLMS_LINK_LIMIT);
    const broken: string[] = [];
    for (const url of unique) {
      const { trace } = await traceUrl(context.http, url, { method: 'HEAD', maxHops: 5 });
      if (trace.status === 0 || trace.status >= 400)
        broken.push(`${url} (${trace.status === 0 ? 'no response' : trace.status})`);
    }
    if (broken.length > 0) findings.push(makeFinding('ai', 'AI-005', 'improvement', broken));
    return outcome(findings, { llmsTxt: 'present', llmsTxtLinksChecked: unique.length });
  },
};

const botStatus: Check = {
  id: 'ai.bot-status',
  module: 'ai',
  codes: ['AI-006', 'AI-007'],
  run({ crawl }) {
    const { robots } = crawl;
    if (robots.status === 0) return outcome([], undefined, 'robots.txt could not be fetched');
    const statuses = AI_BOTS.map((bot) => ({
      bot,
      allowed: !robots.found || isAllowed(robots.parsed, bot.token, '/'),
    }));
    const visibilityBlocked = statuses
      .filter((entry) => !entry.allowed && entry.bot.purpose !== 'training')
      .map((entry) => `${entry.bot.token} (${entry.bot.vendor}, ${entry.bot.purpose})`);

    const signals = contentSignalsFor(robots.parsed);
    const unrecognized = Object.entries(signals)
      .filter(
        ([name, value]) =>
          !(CONTENT_SIGNAL_NAMES as readonly string[]).includes(name) ||
          !(CONTENT_SIGNAL_VALUES as readonly string[]).includes(value),
      )
      .map(([name, value]) => `${name}=${value}`);

    return outcome(
      [
        ...(visibilityBlocked.length > 0
          ? [makeFinding('ai', 'AI-006', 'improvement', visibilityBlocked)]
          : []),
        ...(unrecognized.length > 0
          ? [makeFinding('ai', 'AI-007', 'improvement', unrecognized)]
          : []),
      ],
      {
        aiBots: statuses.map(
          (entry) =>
            `${entry.bot.token}:${entry.allowed ? 'allowed' : 'blocked'}:${entry.bot.purpose}`,
        ),
        contentSignals: Object.entries(signals).map(([name, value]) => `${name}=${value}`),
      },
    );
  },
};

const MIN_STATIC_WORDS = 50;
const ROOT_SELECTORS = '#root, #app, #__next, #__nuxt, [data-reactroot]';

const staticContent: Check = {
  id: 'ai.static-content',
  module: 'ai',
  codes: ['AI-008'],
  run(context) {
    const suspects: string[] = [];
    for (const page of samplePages(context, 4)) {
      const $ = loadPage(page);
      if (!$) continue;
      const wordCount = visibleText($).split(/\s+/).filter(Boolean).length;
      const scripts = $('script[src]').length;
      const emptyRoot = $(ROOT_SELECTORS)
        .toArray()
        .some((element) => $(element).text().trim() === '');
      if (wordCount < MIN_STATIC_WORDS && (scripts >= 3 || emptyRoot)) {
        suspects.push(
          `${page.url} (${wordCount} words, ${scripts} scripts${emptyRoot ? ', empty root element' : ''})`,
        );
      }
    }
    return outcome(suspects.length > 0 ? [makeFinding('ai', 'AI-008', 'important', suspects)] : []);
  },
};

const entityData: Check = {
  id: 'ai.entity-data',
  module: 'ai',
  codes: ['AI-009', 'AI-010'],
  run(context) {
    const home = homePage(context);
    if (!home || !htmlPages(context).includes(home)) {
      return outcome([], undefined, 'The home page could not be read');
    }
    const entities = readBlocks(home)
      .flatMap((block) => flattenNodes(block.roots))
      .filter((node) => typesOf(node).some((type) => ORGANIZATION_TYPES.has(type)));
    if (entities.length === 0)
      return outcome([makeFinding('ai', 'AI-009', 'improvement', [home.url])]);

    const best =
      entities
        .map((node) => ENTITY_PROPERTIES.filter((property) => !hasValue(node, property)))
        .sort((a, b) => a.length - b.length)[0] ?? [];
    return outcome(
      best.length > 0
        ? [
            makeFinding(
              'ai',
              'AI-010',
              'improvement',
              best.map((p) => `${home.url}: ${p}`),
            ),
          ]
        : [],
    );
  },
};

export const aiChecks: readonly Check[] = [llmsTxt, botStatus, staticContent, entityData];
