import { readFieldData, normalizeLighthouseResult } from './normalize.js';
import { redactSecret } from './redact.js';
import {
  CATEGORIES,
  EngineError,
  type FormFactor,
  type LabEngine,
  type LabResult,
} from './types.js';

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export const PSI_TIMEOUT_MS = 120_000;
export const PSI_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30_000;
const RETRY_AFTER_MAX_S = 60;
const MAX_MESSAGE = 200;

export interface PsiResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type PsiFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<PsiResponse>;

export interface PsiOptions {
  /** Optional. It is only ever passed in from the PSI_API_KEY environment variable. */
  apiKey?: string | undefined;
  fetchImpl?: PsiFetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * The API key goes in the `key` query parameter, which is the only way that the PSI documentation
 * describes. The URL is therefore never logged, never put in an error and never stored.
 */
export function buildPsiUrl(url: string, strategy: FormFactor, apiKey?: string): string {
  const request = new URL(PSI_ENDPOINT);
  request.searchParams.set('url', url);
  request.searchParams.set('strategy', strategy);
  for (const category of CATEGORIES) request.searchParams.append('category', category);
  if (apiKey !== undefined && apiKey !== '') request.searchParams.set('key', apiKey);
  return request.href;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function errorMessageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const error = body.error;
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined;
  return typeof error.message === 'string' ? error.message : undefined;
}

/** Runs PageSpeed Insights, one request after another. */
export class PsiEngine implements LabEngine {
  readonly name = 'psi';
  readonly #apiKey: string | undefined;
  readonly #fetch: PsiFetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;

  constructor(options: PsiOptions = {}) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs ?? PSI_TIMEOUT_MS;
    this.#maxRetries = options.maxRetries ?? PSI_MAX_RETRIES;
  }

  /** Removes the key and cuts the text, so a message from Google is safe to show. */
  #safe(message: string): string {
    const clean = redactSecret(message, this.#apiKey).replace(/\s+/g, ' ').trim();
    return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}...` : clean;
  }

  async measure(url: string, strategy: FormFactor, signal?: AbortSignal): Promise<LabResult> {
    for (let attempt = 0; ; attempt++) {
      const { status, retryAfter, body } = await this.#request(url, strategy, signal);
      if (status >= 200 && status < 300) return this.#normalize(body, url);

      const detail = errorMessageOf(body);
      const suffix = detail === undefined ? '' : `: ${this.#safe(detail)}`;
      const retryable = status === 429 || status >= 500;
      // A daily quota does not come back within the retry window, so retrying only wastes time.
      const dailyQuota = status === 429 && /per day/i.test(detail ?? '');
      if (retryable && !dailyQuota && attempt < this.#maxRetries) {
        await this.#sleep(this.#delay(attempt, retryAfter));
        continue;
      }
      if (status === 429)
        throw new EngineError('quota', `PageSpeed Insights quota exceeded (HTTP 429)${suffix}`);
      if (status >= 500)
        throw new EngineError(
          'server',
          `PageSpeed Insights server error (HTTP ${status})${suffix}`,
        );
      throw new EngineError(
        'client',
        `PageSpeed Insights rejected the request (HTTP ${status})${suffix}`,
      );
    }
  }

  #delay(attempt: number, retryAfter: string | null): number {
    const seconds = Number(retryAfter);
    if (
      retryAfter !== null &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      seconds <= RETRY_AFTER_MAX_S
    ) {
      return seconds * 1000;
    }
    return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  }

  async #request(
    url: string,
    strategy: FormFactor,
    signal: AbortSignal | undefined,
  ): Promise<{ status: number; retryAfter: string | null; body: unknown }> {
    if (signal?.aborted) throw new EngineError('aborted', 'Stopped');
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    try {
      const response = await this.#fetch(buildPsiUrl(url, strategy, this.#apiKey), {
        signal: combined,
        headers: { accept: 'application/json' },
      });
      const body = parseJson(await response.text());
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body };
    } catch {
      // The original error is dropped on purpose. It could carry the request URL, and the key is in it.
      if (signal?.aborted) throw new EngineError('aborted', 'Stopped');
      if (timeout.aborted)
        throw new EngineError('timeout', 'The PageSpeed Insights request timed out.');
      throw new EngineError('network', 'The PageSpeed Insights request failed (network error).');
    }
  }

  #normalize(body: unknown, url: string): LabResult {
    if (typeof body !== 'object' || body === null || !('lighthouseResult' in body)) {
      throw new EngineError(
        'invalid_response',
        'The PageSpeed Insights response has no lighthouseResult.',
      );
    }
    const result = body.lighthouseResult;
    if (typeof result === 'object' && result !== null && 'runtimeError' in result) {
      const runtime = result.runtimeError;
      const code =
        typeof runtime === 'object' && runtime !== null && 'code' in runtime
          ? String(runtime.code)
          : 'unknown';
      throw new EngineError(
        'runtime',
        `Lighthouse could not measure the page (${this.#safe(code)}).`,
      );
    }
    const fieldData = readFieldData(
      'loadingExperience' in body ? body.loadingExperience : undefined,
    );
    return normalizeLighthouseResult(result, { engine: 'psi', url, fieldData });
  }
}
