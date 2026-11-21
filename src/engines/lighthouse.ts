import { launchChrome, type ChromeHandle, type LaunchOptions } from './chrome.js';
import { normalizeLighthouseResult } from './normalize.js';
import {
  CATEGORIES,
  EngineError,
  type FormFactor,
  type LabEngine,
  type LabResult,
} from './types.js';

export const LIGHTHOUSE_TIMEOUT_MS = 300_000;

/** What the engine needs from the Lighthouse library. Tests replace it. */
export type RunLighthouse = (url: string, port: number, strategy: FormFactor) => Promise<unknown>;

export interface LocalLighthouseOptions {
  chromePath: string;
  signal?: AbortSignal | undefined;
  noSandbox?: boolean;
  timeoutMs?: number;
  launch?: (options: LaunchOptions) => Promise<ChromeHandle>;
  runLighthouse?: RunLighthouse;
}

/**
 * Lighthouse's own defaults. Mobile uses the default config, which emulates a phone with simulated
 * slow 4G and a 4x CPU slowdown. Desktop uses the desktop preset that ships with Lighthouse.
 * Nothing is saved to disk, and no custom throttling is set.
 */
export const defaultRunLighthouse: RunLighthouse = async (url, port, strategy) => {
  const { default: lighthouse } = await import('lighthouse');
  const config =
    strategy === 'desktop'
      ? (await import('lighthouse/core/config/desktop-config.js')).default
      : undefined;
  const result = await lighthouse(
    url,
    { port, output: 'json', logLevel: 'silent', onlyCategories: [...CATEGORIES] },
    config,
  );
  if (!result) throw new EngineError('runtime', 'Lighthouse returned no result.');
  return result.lhr;
};

/** Measures with the Lighthouse library and the Chrome that is installed on this machine. */
export class LocalLighthouseEngine implements LabEngine {
  readonly name = 'lighthouse';
  readonly #options: LocalLighthouseOptions;

  constructor(options: LocalLighthouseOptions) {
    this.#options = options;
  }

  async measure(url: string, strategy: FormFactor, signal?: AbortSignal): Promise<LabResult> {
    const { chromePath, noSandbox, timeoutMs = LIGHTHOUSE_TIMEOUT_MS } = this.#options;
    const stop = signal ?? this.#options.signal;
    const launch = this.#options.launch ?? launchChrome;
    const run = this.#options.runLighthouse ?? defaultRunLighthouse;

    // A new Chrome with a fresh profile for every run, always closed afterwards.
    const chrome = await launch({
      chromePath,
      signal: stop,
      ...(noSandbox !== undefined && { noSandbox }),
    });
    const timer = setTimeout(() => {
      void chrome.close();
    }, timeoutMs);
    try {
      const lhr = await run(url, chrome.port, strategy);
      // The key can be present with the value undefined, which means "no error".
      if (typeof lhr === 'object' && lhr !== null && 'runtimeError' in lhr && lhr.runtimeError) {
        const runtime = lhr.runtimeError;
        const code =
          typeof runtime === 'object' && 'code' in runtime ? String(runtime.code) : 'unknown';
        throw new EngineError('runtime', `Lighthouse could not measure the page (${code}).`);
      }
      return normalizeLighthouseResult(lhr, { engine: 'lighthouse', url });
    } catch (error) {
      if (error instanceof EngineError) throw error;
      if (stop?.aborted) throw new EngineError('aborted', 'Stopped');
      throw new EngineError(
        'runtime',
        `Lighthouse failed (${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}).`,
      );
    } finally {
      clearTimeout(timer);
      await chrome.close();
    }
  }
}
