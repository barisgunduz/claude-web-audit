import type { Settings } from '../config/types.js';
import { pickPages } from '../crawler/select.js';
import { findChrome } from '../engines/chrome.js';
import { LocalLighthouseEngine } from '../engines/lighthouse.js';
import { measureLab, type LabOutcome } from '../engines/measure.js';
import { PsiEngine } from '../engines/psi.js';
import type { FormFactor } from '../engines/types.js';
import { createAxeRunner } from '../modules/a11y/axe-runner.js';
import type { AxeRunner } from '../modules/a11y/axe-types.js';
import { crawl } from '../crawler/crawl.js';
import { HttpClient } from '../crawler/http.js';
import { isPrivateHost } from '../crawler/address.js';
import { createTransport } from '../crawler/guarded-fetch.js';
import { parseDomainInput } from '../crawler/url.js';
import type { CheckContext } from '../model/check.js';
import type { CrawlResult } from '../model/crawl.js';
import type { ModuleResult } from '../model/finding.js';
import { createSystemResolver } from '../modules/email/dns.js';
import { MODULES } from '../modules/registry.js';
import { runModule } from '../modules/runner.js';
import { buildUserAgent, MAX_BODY_BYTES, REQUEST_TIMEOUT_MS } from '../crawler/crawl.js';
import type { AuditDeps } from './deps.js';

export interface AuditRun {
  crawl: CrawlResult;
  modules: ModuleResult[];
  /** Lighthouse measurements, when the speed module ran. */
  lab?: LabOutcome;
}

export interface AuditInput {
  settings: Settings;
  version: string;
  deps?: AuditDeps;
  log?: (message: string) => void;
  /** Progress that is always shown, such as the time estimate. */
  notice?: (message: string) => void;
}

interface BrowserWorkInput {
  settings: Settings;
  deps: AuditDeps;
  crawl: CrawlResult;
  allowPrivate: boolean;
  version: string;
  log: ((message: string) => void) | undefined;
  notice: ((message: string) => void) | undefined;
}

/** Runs the Lighthouse measurements and prepares the axe runner, for the modules that need Chrome. */
async function prepareBrowserWork(
  input: BrowserWorkInput,
): Promise<{ lab?: LabOutcome; axe?: AxeRunner }> {
  const { settings, deps, crawl: site } = input;
  const wantsSpeed = settings.modules.includes('speed');
  const wantsA11y = settings.modules.includes('a11y');
  if (!wantsSpeed && !wantsA11y) return {};

  const env = deps.env ?? process.env;
  const lookup = deps.chrome ?? (await findChrome({ chromePath: settings.chromePath, env }));
  const chromePath = lookup.path;
  const trimmedKey = env.PSI_API_KEY?.trim() ?? '';
  const apiKey = trimmedKey === '' ? undefined : trimmedKey;
  let lab: LabOutcome | undefined;

  if (wantsSpeed) {
    const strategies: FormFactor[] =
      settings.strategy === 'both' ? ['mobile', 'desktop'] : [settings.strategy];
    const psi =
      deps.engines?.psi ??
      new PsiEngine({
        apiKey,
        ...(deps.psiTimeoutMs !== undefined && { timeoutMs: deps.psiTimeoutMs }),
        ...(deps.psiFetch && { fetchImpl: deps.psiFetch }),
        ...(deps.sleep && { sleep: deps.sleep }),
      });
    const local =
      deps.engines?.local ??
      (chromePath ? new LocalLighthouseEngine({ chromePath, signal: deps.signal }) : undefined);
    lab = await measureLab({
      urls: pickPages(site, settings.speedPages),
      strategies,
      runs: settings.runs,
      setting: settings.engine,
      hasKey: apiKey !== undefined,
      hasChrome: local !== undefined,
      psi,
      local,
      signal: deps.signal,
      ...(input.notice && { notice: input.notice }),
      ...(input.log && { log: input.log }),
    });
  }

  const axe =
    deps.axe ??
    (wantsA11y && chromePath
      ? createAxeRunner({
          chromePath,
          userAgent: buildUserAgent(input.version),
          delayMs: settings.delay,
          allowPrivate: input.allowPrivate,
          signal: deps.signal,
        })
      : undefined);
  return { ...(lab && { lab }), ...(axe && { axe }) };
}

/** Crawls the site, then runs the enabled modules. */
export async function runAudit({
  settings,
  version,
  deps = {},
  log,
  notice,
}: AuditInput): Promise<AuditRun> {
  const inputHost = parseDomainInput(settings.domain);
  const allowPrivate = isPrivateHost(inputHost);
  // Real requests share one transport that refuses private addresses. Tests inject their own fetch.
  const transport = deps.fetchImpl ? undefined : createTransport({ allowPrivate });
  const fetchImpl = deps.fetchImpl ?? transport?.fetch;

  try {
    const result = await crawl({
      input: settings.domain,
      pages: settings.pages,
      delayMs: settings.delay,
      concurrency: settings.concurrency,
      version,
      ...(fetchImpl && { fetchImpl }),
      ...(deps.signal && { signal: deps.signal }),
      ...(deps.tlsProbe && { tlsProbe: deps.tlsProbe }),
      ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
      ...(deps.sleep && { sleep: deps.sleep }),
      ...(log && { log }),
    });

    // Checks make a few extra requests of their own, through a client with the same politeness.
    const http = new HttpClient({
      userAgent: buildUserAgent(version),
      timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
      delayMs: settings.delay,
      allowPrivateHosts: allowPrivate,
      ...(fetchImpl && { fetchImpl }),
      ...(deps.sleep && { sleep: deps.sleep }),
      ...(deps.signal && { signal: deps.signal }),
    });
    const { lab, axe } = await prepareBrowserWork({
      settings,
      deps,
      crawl: result,
      allowPrivate,
      version,
      log,
      notice,
    });
    const context: CheckContext = {
      crawl: result,
      settings,
      http,
      dns: deps.dns ?? createSystemResolver(),
      now: (deps.now ?? (() => new Date()))(),
      lab,
      axe,
    };

    const modules: ModuleResult[] = [];
    for (const name of settings.modules) {
      log?.(`Running module ${name}`);
      modules.push(await runModule(MODULES[name], context));
    }
    return { crawl: result, modules, ...(lab && { lab }) };
  } finally {
    await transport?.close();
  }
}
