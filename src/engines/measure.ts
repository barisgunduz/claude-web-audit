import type { ModuleStatus } from '../model/finding.js';
import { pickMedianRun, summarizeRuns, type RunSummary } from './runs.js';
import {
  EngineError,
  type EngineName,
  type FormFactor,
  type LabEngine,
  type LabResult,
} from './types.js';

export type EngineSetting = 'auto' | 'psi' | 'lighthouse';

export interface LabPageResult {
  url: string;
  strategy: FormFactor;
  /** The engine that gave the result. */
  engine?: EngineName;
  /** The median run. */
  result?: LabResult;
  runs: RunSummary;
  fallback?: { from: EngineName; reason: string };
  error?: string;
}

export interface LabMethod {
  requestedEngine: EngineSetting;
  runsPerPage: number;
  strategies: FormFactor[];
  pages: number;
  enginesUsed: EngineName[];
  fallbacks: number;
  lighthouseVersions: string[];
  throttling: string[];
}

export interface LabOutcome {
  status: ModuleStatus;
  reason?: string;
  pages: LabPageResult[];
  method: LabMethod;
}

export interface EnginePlan {
  order: EngineName[];
  /** Set when nothing can be measured. */
  unavailable?: string;
}

const DOCTOR_HINT = 'Run "cwa doctor" to see what is missing.';

/** Which engines to try, in order. This is where the rules for --engine live. */
export function planEngines(
  setting: EngineSetting,
  hasKey: boolean,
  hasChrome: boolean,
): EnginePlan {
  if (setting === 'psi') return { order: ['psi'] };
  if (setting === 'lighthouse') {
    return hasChrome
      ? { order: ['lighthouse'] }
      : { order: [], unavailable: `No usable Chrome was found. ${DOCTOR_HINT}` };
  }
  if (hasKey) return { order: hasChrome ? ['psi', 'lighthouse'] : ['psi'] };
  return hasChrome
    ? { order: ['lighthouse'] }
    : {
        order: [],
        unavailable: `PSI_API_KEY is not set and no usable Chrome was found. ${DOCTOR_HINT}`,
      };
}

/** Rough planning values, not measurements. A page can take much longer. */
const SECONDS_PER_RUN: Record<EngineName, readonly [number, number]> = {
  lighthouse: [15, 60],
  psi: [10, 60],
};

export interface Estimate {
  runs: number;
  minSeconds: number;
  maxSeconds: number;
  text: string;
}

function minutes(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

export function estimateMeasurement(input: {
  pages: number;
  strategies: number;
  runs: number;
  firstEngine: EngineName;
}): Estimate {
  const runs = input.pages * input.strategies * input.runs;
  const [low, high] = SECONDS_PER_RUN[input.firstEngine];
  return {
    runs,
    minSeconds: runs * low,
    maxSeconds: runs * high,
    text: `Speed: ${runs} Lighthouse runs (${input.pages} pages x ${input.strategies} strategies x ${input.runs} runs), roughly ${minutes(runs * low)} to ${minutes(runs * high)}.`,
  };
}

export interface MeasureInput {
  urls: readonly string[];
  strategies: readonly FormFactor[];
  runs: number;
  setting: EngineSetting;
  hasKey: boolean;
  hasChrome: boolean;
  psi?: LabEngine | undefined;
  local?: LabEngine | undefined;
  signal?: AbortSignal | undefined;
  notice?: (message: string) => void;
  log?: (message: string) => void;
}

interface Collected {
  results: LabResult[];
}

/** Runs one engine several times in a row. The first error stops the runs, since a second try rarely differs. */
async function collectRuns(
  engine: LabEngine,
  url: string,
  strategy: FormFactor,
  runs: number,
  signal?: AbortSignal,
): Promise<Collected> {
  const results: LabResult[] = [];
  for (let run = 0; run < runs; run++) {
    if (signal?.aborted) break;
    try {
      results.push(await engine.measure(url, strategy, signal));
    } catch (error) {
      if (results.length === 0) throw error;
      break;
    }
  }
  if (results.length === 0) throw new EngineError('aborted', 'Stopped');
  return { results };
}

function reasonOf(error: unknown): string {
  return error instanceof EngineError ? error.message : 'The measurement failed.';
}

/** Measures every page and strategy, one at a time. A failure on one page never stops the others. */
export async function measureLab(input: MeasureInput): Promise<LabOutcome> {
  const plan = planEngines(input.setting, input.hasKey, input.hasChrome);
  const method: LabMethod = {
    requestedEngine: input.setting,
    runsPerPage: input.runs,
    strategies: [...input.strategies],
    pages: input.urls.length,
    enginesUsed: [],
    fallbacks: 0,
    lighthouseVersions: [],
    throttling: [],
  };
  if (plan.unavailable !== undefined) {
    return { status: 'not_measured', reason: plan.unavailable, pages: [], method };
  }
  const first = plan.order[0];
  if (first === undefined || input.urls.length === 0) {
    return { status: 'not_measured', reason: 'There are no pages to measure.', pages: [], method };
  }

  const engines: Record<EngineName, LabEngine | undefined> = {
    psi: input.psi,
    lighthouse: input.local,
  };
  input.notice?.(
    estimateMeasurement({
      pages: input.urls.length,
      strategies: input.strategies.length,
      runs: input.runs,
      firstEngine: first,
    }).text,
  );

  const pages: LabPageResult[] = [];
  let psiOffReason: string | undefined;

  for (const url of input.urls) {
    for (const strategy of input.strategies) {
      if (input.signal?.aborted) break;
      let fallbackFrom: { from: EngineName; reason: string } | undefined;
      let entry: LabPageResult | undefined;
      let lastError = 'The measurement failed.';

      for (const name of plan.order) {
        const engine = engines[name];
        if (!engine) continue;
        if (name === 'psi' && psiOffReason !== undefined) {
          fallbackFrom = { from: 'psi', reason: psiOffReason };
          continue;
        }
        input.log?.(`Measuring ${url} (${strategy}) with ${name}`);
        try {
          const { results } = await collectRuns(engine, url, strategy, input.runs, input.signal);
          const { result } = pickMedianRun(results);
          entry = {
            url,
            strategy,
            engine: name,
            result,
            runs: summarizeRuns(results, input.runs),
            ...(fallbackFrom && { fallback: fallbackFrom }),
          };
          break;
        } catch (error) {
          lastError = reasonOf(error);
          if (name === 'psi' && plan.order.length > 1) {
            fallbackFrom = { from: 'psi', reason: lastError };
            // A quota or server problem will not go away within this audit.
            if (error instanceof EngineError && (error.kind === 'quota' || error.kind === 'server'))
              psiOffReason = lastError;
            input.log?.(`PSI failed (${lastError}). Falling back to local Lighthouse.`);
          }
        }
      }
      pages.push(entry ?? { url, strategy, runs: summarizeRuns([], input.runs), error: lastError });
    }
  }

  for (const page of pages) {
    if (!page.result) continue;
    if (page.engine && !method.enginesUsed.includes(page.engine))
      method.enginesUsed.push(page.engine);
    if (page.fallback) method.fallbacks++;
    if (!method.lighthouseVersions.includes(page.result.lighthouseVersion))
      method.lighthouseVersions.push(page.result.lighthouseVersion);
    if (!method.throttling.includes(page.result.throttling))
      method.throttling.push(page.result.throttling);
  }

  const measured = pages.filter((page) => page.result).length;
  const failed = pages.filter((page) => !page.result);
  const expected = input.urls.length * input.strategies.length;
  const status: ModuleStatus =
    measured === 0 ? 'not_measured' : measured < expected ? 'partial' : 'measured';
  const firstError = failed[0]?.error;
  const reason =
    status === 'measured'
      ? undefined
      : `${measured} of ${expected} measurements finished${firstError !== undefined ? `. First problem: ${firstError}` : ''}`;
  return { status, ...(reason !== undefined && { reason }), pages, method };
}

/** The method statement that the report prints later. */
export function describeMethod(method: LabMethod): string {
  const engines = method.enginesUsed.length > 0 ? method.enginesUsed.join(' and ') : 'none';
  const versions =
    method.lighthouseVersions.length > 0 ? method.lighthouseVersions.join(', ') : 'unknown';
  const throttling = method.throttling.length > 0 ? method.throttling.join('; ') : 'unknown';
  const fallback =
    method.fallbacks > 0
      ? ` ${method.fallbacks} measurement(s) fell back from PageSpeed Insights to local Lighthouse.`
      : '';
  return `Measured with ${engines} (Lighthouse ${versions}), ${method.strategies.join(' and ')}, ${method.runsPerPage} run(s) per page with the median run reported, throttling: ${throttling}.${fallback}`;
}
