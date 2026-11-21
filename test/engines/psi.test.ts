import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPsiUrl,
  PSI_ENDPOINT,
  PsiEngine,
  type PsiFetch,
  type PsiResponse,
} from '../../src/engines/psi.js';
import { redactSecret } from '../../src/engines/redact.js';
import { EngineError } from '../../src/engines/types.js';
import { FIXTURE } from '../support/lab.js';

const SECRET = 'TEST_FAKE_PSI_KEY_0123456789';
const QUOTA_BODY = readFileSync('test/fixtures/psi-error-429.json', 'utf8');

function reply(status: number, body: unknown, headers: Record<string, string> = {}): PsiResponse {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Answers from a list, one per call, and records the URLs and the waits. */
function script(answers: (PsiResponse | Error)[]): {
  fetchImpl: PsiFetch;
  urls: string[];
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
} {
  const urls: string[] = [];
  const sleeps: number[] = [];
  return {
    urls,
    sleeps,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    fetchImpl: (url) => {
      urls.push(url);
      const next = answers.shift();
      if (!next) return Promise.reject(new Error('unexpected extra request'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

const engine = (
  answers: (PsiResponse | Error)[],
  extra: { apiKey?: string; timeoutMs?: number } = {},
) => {
  const fake = script(answers);
  return {
    ...fake,
    engine: new PsiEngine({ fetchImpl: fake.fetchImpl, sleep: fake.sleep, ...extra }),
  };
};

describe('buildPsiUrl', () => {
  it('asks for the four categories and the strategy, without a key by default', () => {
    const url = new URL(buildPsiUrl('https://example.com/a?b=1', 'desktop'));
    expect(`${url.origin}${url.pathname}`).toBe(PSI_ENDPOINT);
    expect(url.searchParams.get('url')).toBe('https://example.com/a?b=1');
    expect(url.searchParams.get('strategy')).toBe('desktop');
    expect(url.searchParams.getAll('category')).toEqual([
      'performance',
      'accessibility',
      'best-practices',
      'seo',
    ]);
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('puts the key in the key parameter, as the documentation describes', () => {
    expect(
      new URL(buildPsiUrl('https://example.com/', 'mobile', SECRET)).searchParams.get('key'),
    ).toBe(SECRET);
  });
});

describe('PsiEngine success', () => {
  it('normalizes the lighthouseResult and the field data of a response', async () => {
    const { engine: psi, urls } = engine([reply(200, FIXTURE)]);
    const result = await psi.measure('https://example.com/', 'mobile');
    expect(result).toMatchObject({
      engine: 'psi',
      formFactor: 'mobile',
      lighthouseVersion: '13.6.0',
    });
    expect(result.categories.performance).toBe(99);
    expect(result.fieldData?.overallCategory).toBe('FAST');
    expect(urls).toHaveLength(1);
  });

  it('works when the response has no field data', async () => {
    const rest = Object.fromEntries(
      Object.entries(FIXTURE).filter(([key]) => key !== 'loadingExperience'),
    );
    const { engine: psi } = engine([reply(200, rest)]);
    expect((await psi.measure('https://example.com/', 'mobile')).fieldData).toBeUndefined();
  });

  it('sends the key it was given, and only in the request URL', async () => {
    const { engine: psi, urls } = engine([reply(200, FIXTURE)], { apiKey: SECRET });
    await psi.measure('https://example.com/', 'mobile');
    expect(new URL(urls[0] ?? '').searchParams.get('key')).toBe(SECRET);
  });
});

describe('PsiEngine retries', () => {
  it('retries a 5xx with a growing wait and then succeeds', async () => {
    const {
      engine: psi,
      sleeps,
      urls,
    } = engine([reply(503, {}), reply(500, {}), reply(200, FIXTURE)]);
    await psi.measure('https://example.com/', 'mobile');
    expect(sleeps).toEqual([2000, 4000]);
    expect(urls).toHaveLength(3);
  });

  it('gives up after three retries with a server error', async () => {
    const {
      engine: psi,
      sleeps,
      urls,
    } = engine([reply(500, {}), reply(500, {}), reply(500, {}), reply(500, {})]);
    await expect(psi.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'server',
    });
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(urls).toHaveLength(4);
  });

  it('honors Retry-After on a 429 when it is short', async () => {
    const { engine: psi, sleeps } = engine([
      reply(429, { error: { message: 'slow down' } }, { 'retry-after': '3' }),
      reply(200, FIXTURE),
    ]);
    await psi.measure('https://example.com/', 'mobile');
    expect(sleeps).toEqual([3000]);
  });

  it('ignores a Retry-After that is too long or not a number', async () => {
    const { engine: psi, sleeps } = engine([
      reply(429, {}, { 'retry-after': '600' }),
      reply(429, {}, { 'retry-after': 'soon' }),
      reply(200, FIXTURE),
    ]);
    await psi.measure('https://example.com/', 'mobile');
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('does not retry a daily quota, which will not come back in time', async () => {
    const { engine: psi, sleeps, urls } = engine([reply(429, QUOTA_BODY)]);
    await expect(psi.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'quota',
    });
    expect(sleeps).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it('does not retry a client error and reports what Google said', async () => {
    const { engine: psi, sleeps } = engine([
      reply(400, { error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST' } }),
    ]);
    const error = await psi
      .measure('https://example.com/', 'mobile')
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'client' });
    expect((error as EngineError).message).toContain('HTTP 400');
    expect((error as EngineError).message).toContain('FAILED_DOCUMENT_REQUEST');
    expect(sleeps).toEqual([]);
  });

  it('can be set to fewer retries', async () => {
    const fake = script([reply(500, {}), reply(500, {})]);
    const psi = new PsiEngine({ fetchImpl: fake.fetchImpl, sleep: fake.sleep, maxRetries: 1 });
    await expect(psi.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'server',
    });
    expect(fake.sleeps).toEqual([2000]);
  });
});

describe('PsiEngine failures', () => {
  it('reports a network error without the original error', async () => {
    const { engine: psi } = engine(
      [new TypeError(`fetch failed for ${buildPsiUrl('https://example.com/', 'mobile', SECRET)}`)],
      { apiKey: SECRET },
    );
    const error = await psi
      .measure('https://example.com/', 'mobile')
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'network' });
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).stack ?? '').not.toContain(SECRET);
    expect((error as Error).cause).toBeUndefined();
  });

  it('times out with a short limit', async () => {
    const fetchImpl: PsiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const psi = new PsiEngine({ fetchImpl, timeoutMs: 20, sleep: () => Promise.resolve() });
    await expect(psi.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('stops when asked to', async () => {
    const controller = new AbortController();
    controller.abort();
    const { engine: psi, urls } = engine([reply(200, FIXTURE)]);
    await expect(
      psi.measure('https://example.com/', 'mobile', controller.signal),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(urls).toEqual([]);
  });

  it.each([
    ['not JSON', 'not json at all'],
    ['no lighthouseResult', { id: 'x' }],
    ['an unreadable lighthouseResult', { lighthouseResult: { audits: {} } }],
  ])('rejects a response that is %s', async (_name, body) => {
    const { engine: psi } = engine([reply(200, body)]);
    await expect(psi.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('reports a Lighthouse runtime error from PSI', async () => {
    const { engine: psi } = engine([
      reply(200, { lighthouseResult: { runtimeError: { code: 'FAILED_DOCUMENT_REQUEST' } } }),
    ]);
    await expect(psi.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'runtime',
      message: expect.stringContaining('FAILED_DOCUMENT_REQUEST'),
    });
  });

  it('removes the key from a message that Google sends back', async () => {
    const echo = {
      error: { message: `API key not valid: ${SECRET}. Also ${encodeURIComponent(SECRET)}` },
    };
    const { engine: psi } = engine([reply(403, echo)], { apiKey: SECRET });
    const error = await psi
      .measure('https://example.com/', 'mobile')
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toContain('[redacted]');
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('shortens a long message from Google', async () => {
    const { engine: psi } = engine([reply(400, { error: { message: 'x'.repeat(1000) } })]);
    const error = (await psi
      .measure('https://example.com/', 'mobile')
      .catch((caught: unknown) => caught)) as Error;
    expect(error.message.length).toBeLessThan(300);
  });
});

describe('the real 429 body', () => {
  it('has the shape that the engine reads', () => {
    expect(JSON.parse(QUOTA_BODY)).toMatchObject({
      error: { code: 429, status: 'RESOURCE_EXHAUSTED' },
    });
    expect(QUOTA_BODY).not.toMatch(/project_number:[1-9]/);
  });
});

describe('redactSecret', () => {
  it('replaces the key, also when it is percent-encoded, and ignores an empty key', () => {
    expect(redactSecret(`a ${SECRET} b ${encodeURIComponent('a b&c')}`, SECRET)).toBe(
      'a [redacted] b a%20b%26c',
    );
    expect(redactSecret('key=a%20b%26c', 'a b&c')).toBe('key=[redacted]');
    expect(redactSecret('nothing', '')).toBe('nothing');
    expect(redactSecret('nothing', undefined)).toBe('nothing');
    expect(redactSecret('  ', '  ')).toBe('  ');
  });
});
