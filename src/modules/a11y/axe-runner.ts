import axe from 'axe-core';
import puppeteer from 'puppeteer-core';
import { isPrivateHost } from '../../crawler/address.js';
import { launchChrome, type ChromeHandle, type LaunchOptions } from '../../engines/chrome.js';
import type { AxeImpact, AxePageResult, AxeRun, AxeRunner, AxeViolation } from './axe-types.js';

export const SETTLE_MS = 1000;
export const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_NODES_PER_RULE = 200;
const IMPACTS = new Set<string>(['minor', 'moderate', 'serious', 'critical']);

export interface AxeRunnerOptions {
  chromePath: string;
  userAgent: string;
  /** Wait between pages, in milliseconds. This is the --delay value. */
  delayMs: number;
  /** Allow private addresses. Only when the audited site is itself private. */
  allowPrivate: boolean;
  settleMs?: number;
  navigationTimeoutMs?: number;
  noSandbox?: boolean;
  signal?: AbortSignal | undefined;
  launch?: (options: LaunchOptions) => Promise<ChromeHandle>;
}

/** Runs inside the page, after axe has been injected. It returns plain data only. */
const COLLECT = `(async () => {
  const results = await axe.run(document, { resultTypes: ['violations'] });
  return results.violations.map((rule) => ({
    id: rule.id,
    impact: rule.impact,
    help: rule.help,
    helpUrl: rule.helpUrl,
    selectors: rule.nodes.slice(0, ${MAX_NODES_PER_RULE}).map((node) =>
      node.target.map((part) => (Array.isArray(part) ? part.join(' >> ') : part)).join(' >> ')
    ),
  }));
})()`;

function readViolations(raw: unknown): AxeViolation[] {
  if (!Array.isArray(raw)) throw new Error('axe returned an unexpected result');
  return raw.flatMap((entry: unknown): AxeViolation[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const rule = entry as Record<string, unknown>;
    const { id, help, helpUrl, selectors, impact } = rule;
    if (
      typeof id !== 'string' ||
      typeof help !== 'string' ||
      typeof helpUrl !== 'string' ||
      !Array.isArray(selectors)
    )
      return [];
    return [
      {
        id,
        help,
        helpUrl,
        impact: typeof impact === 'string' && IMPACTS.has(impact) ? (impact as AxeImpact) : null,
        selectors: selectors.filter((selector): selector is string => typeof selector === 'string'),
      },
    ];
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs axe-core in the Chrome that is installed on the machine, one page after another.
 * Requests to private addresses are blocked unless the audited site is private itself.
 */
export function createAxeRunner(options: AxeRunnerOptions): AxeRunner {
  const settle = options.settleMs ?? SETTLE_MS;
  const timeout = options.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS;
  const launch = options.launch ?? launchChrome;

  return {
    async run(urls): Promise<AxeRun> {
      const chrome = await launch({
        chromePath: options.chromePath,
        signal: options.signal,
        ...(options.noSandbox !== undefined && { noSandbox: options.noSandbox }),
      });
      const pages: AxePageResult[] = [];
      try {
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
        try {
          for (const url of urls) {
            if (options.signal?.aborted) break;
            if (pages.length > 0 && options.delayMs > 0) await sleep(options.delayMs);
            pages.push(await testPage(browser, url));
          }
        } finally {
          await browser.disconnect();
        }
      } finally {
        await chrome.close();
      }
      return { axeVersion: axe.version, pages };
    },
  };

  async function testPage(
    browser: Awaited<ReturnType<typeof puppeteer.connect>>,
    url: string,
  ): Promise<AxePageResult> {
    const page = await browser.newPage();
    try {
      await page.setUserAgent({ userAgent: options.userAgent });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const blocked = !options.allowPrivate && isPrivateHost(new URL(request.url()).hostname);
        void (blocked ? request.abort('blockedbyclient') : request.continue()).catch(
          () => undefined,
        );
      });
      await page.goto(url, { waitUntil: 'load', timeout });
      await sleep(settle);
      await page.evaluate(axe.source);
      return { url, violations: readViolations(await page.evaluate(COLLECT)) };
    } catch (error) {
      return {
        url,
        violations: [],
        error: error instanceof Error ? (error.message.split('\n')[0] ?? 'failed') : 'failed',
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
