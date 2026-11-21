import type { ReadableStreamDefaultReader } from 'node:stream/web';

export interface HttpOptions {
  userAgent: string;
  timeoutMs: number;
  maxBodyBytes: number;
  /** Minimum time between two requests to the same host. */
  delayMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

export type BodyMode = 'text' | 'bytes' | 'none';

export interface RequestOptions {
  method?: 'GET' | 'HEAD';
  body?: BodyMode;
  maxBytes?: number;
}

export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  contentType: string;
  location: string | undefined;
  text: string;
  bytes: Uint8Array;
  bodyTruncated: boolean;
  timingMs: number;
}

export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly kind: 'timeout' | 'network' | 'aborted';

  constructor(kind: 'timeout' | 'network' | 'aborted', message: string) {
    super(message);
    this.kind = kind;
  }
}

const EMPTY: Uint8Array = new Uint8Array(0);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string')
      return cause.code;
    return error.message;
  }
  return 'Network error';
}

async function readBody(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: EMPTY, truncated: false };
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > limit) {
        chunks.push(value.subarray(0, limit - total));
        total = limit;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

/** A polite HTTP client: per-host delay, timeout, body cap and one retry on network errors. */
export class HttpClient {
  readonly userAgent: string;
  private readonly options: HttpOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly nextSlot = new Map<string, number>();
  private delayMs: number;

  constructor(options: HttpOptions) {
    this.options = options;
    this.delayMs = options.delayMs;
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** Raises the delay between requests, for example to follow a Crawl-delay line. It never lowers it. */
  raiseDelay(ms: number): void {
    this.delayMs = Math.max(this.delayMs, ms);
  }

  private async waitForTurn(host: string): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, start + this.delayMs);
    if (start > now) await this.sleep(start - now);
  }

  async request(url: string, request: RequestOptions = {}): Promise<HttpResponse> {
    try {
      return await this.attempt(url, request);
    } catch (error) {
      if (!(error instanceof HttpError) || error.kind !== 'network') throw error;
      return this.attempt(url, request);
    }
  }

  private async attempt(url: string, request: RequestOptions): Promise<HttpResponse> {
    const { signal: stop } = this.options;
    if (stop?.aborted) throw new HttpError('aborted', 'Stopped');
    await this.waitForTurn(new URL(url).host);

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = stop ? AbortSignal.any([timeout, stop]) : timeout;
    const started = this.now();
    const method = request.method ?? 'GET';
    const mode = request.body ?? 'none';

    try {
      const response = await this.fetchImpl(url, {
        method,
        redirect: 'manual',
        signal,
        headers: { 'user-agent': this.userAgent, accept: '*/*', 'accept-encoding': 'gzip, br' },
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const isRedirect = response.status >= 300 && response.status < 400 && 'location' in headers;
      const wantBody = mode !== 'none' && method === 'GET' && !isRedirect;
      let bytes = EMPTY;
      let truncated = false;
      if (wantBody) {
        const limit = request.maxBytes ?? this.options.maxBodyBytes;
        ({ bytes, truncated } = await readBody(response, limit, signal));
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      return {
        url,
        status: response.status,
        headers,
        setCookies: response.headers.getSetCookie(),
        contentType: (headers['content-type'] ?? '').toLowerCase(),
        location: headers.location,
        text: wantBody && mode === 'text' ? new TextDecoder('utf-8').decode(bytes) : '',
        bytes,
        bodyTruncated: truncated,
        timingMs: this.now() - started,
      };
    } catch (error) {
      if (stop?.aborted) throw new HttpError('aborted', 'Stopped');
      if (timeout.aborted) throw new HttpError('timeout', 'Timed out');
      throw new HttpError('network', describeNetworkError(error));
    }
  }
}
