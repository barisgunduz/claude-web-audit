import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditDeps } from '../src/audit/deps.js';
import type { Io } from '../src/cli/io.js';
import { run } from '../src/cli/run.js';
import type { PsiFetch, PsiResponse } from '../src/engines/psi.js';
import { EngineError } from '../src/engines/types.js';
import { fakeDns, goodTls, NOW } from './support/builders.js';
import { defectSite } from './support/defect-site.js';
import { fakeEngine, FIXTURE, labResult } from './support/lab.js';
import { startTestSite, type TestSite } from './support/test-site.js';

/** A clearly fake key that is easy to search for. */
const SENTINEL = 'TEST_FAKE_PSI_KEY_SENTINEL_7f3a91';
const QUOTA = JSON.stringify({
  error: {
    code: 429,
    message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'",
    status: 'RESOURCE_EXHAUSTED',
  },
});

const reply = (status: number, body: string): PsiResponse => ({
  status,
  headers: { get: () => null },
  text: () => Promise.resolve(body),
});

let site: TestSite;
let folder: string;
beforeEach(async () => {
  site = await startTestSite(defectSite());
  folder = await mkdtemp(join(tmpdir(), 'cwa-secrets-'));
});
afterEach(async () => {
  await site.close();
  await rm(folder, { recursive: true, force: true });
});

interface Outcome {
  code: number;
  out: string;
  err: string;
  audit: string;
  urls: string[];
}

async function audit(
  answer: (url: string, call: number) => PsiResponse | Error,
  extra: Partial<AuditDeps> = {},
  args: string[] = [],
): Promise<Outcome> {
  let out = '';
  let err = '';
  const io: Io = {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  };
  const urls: string[] = [];
  const psiFetch: PsiFetch = (url) => {
    urls.push(url);
    const next = answer(url, urls.length);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const code = await run(
    [
      'example.test',
      '--only',
      'speed',
      '--strategy',
      'mobile',
      '--runs',
      '1',
      '--delay',
      '0',
      '--verbose',
      '--pages',
      '4',
      ...args,
    ],
    io,
    { PSI_API_KEY: ` ${SENTINEL} ` },
    {
      fetchImpl: site.fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
      dns: fakeDns({}),
      now: () => NOW,
      cwd: folder,
      chrome: { source: 'none' },
      sleep: () => Promise.resolve(),
      psiFetch,
      ...extra,
    },
  );
  const file = join(folder, 'audits', 'example.test', '2026-11-21', 'audit.json');
  const audit = await readFile(file, 'utf8').catch(() => '');
  return { code, out, err, audit, urls };
}

function expectNoSecret(result: Outcome): void {
  expect(result.out).not.toContain(SENTINEL);
  expect(result.err).not.toContain(SENTINEL);
  expect(result.audit).not.toContain(SENTINEL);
  expect(result.out + result.err + result.audit).not.toContain('TEST_FAKE_PSI');
  expect(result.out + result.err + result.audit).not.toMatch(/[?&]key=/);
}

describe('PSI_API_KEY never leaves the request', () => {
  it('on success: the key is sent to PSI, and appears nowhere else', async () => {
    const result = await audit(() => reply(200, JSON.stringify(FIXTURE)));
    expect(result.code).toBe(0);
    expect(result.urls.length).toBeGreaterThan(0);
    expect(result.urls.every((url) => new URL(url).searchParams.get('key') === SENTINEL)).toBe(
      true,
    );
    expect(result.audit).toContain('"engine": "psi"');
    expectNoSecret(result);
  });

  it.each([
    ['a server error', () => reply(500, '{"error":{"message":"boom"}}')],
    ['the daily quota', () => reply(429, QUOTA)],
    [
      'a bad request',
      () =>
        reply(400, '{"error":{"message":"Lighthouse returned error: FAILED_DOCUMENT_REQUEST"}}'),
    ],
    ['a response that is not JSON', () => reply(200, 'not json')],
    ['a response that is JSON of the wrong shape', () => reply(200, '{"x":1}')],
    ['a network error that carries the URL', (url: string) => new TypeError(`fetch failed ${url}`)],
    [
      'an error body that echoes the key',
      () => reply(403, JSON.stringify({ error: { message: `API key not valid: ${SENTINEL}` } })),
    ],
  ])(
    'on %s in psi mode: the key is in no output and the audit still finishes',
    async (_name, answer) => {
      const result = await audit(answer, {}, ['--engine', 'psi']);
      expect(result.code).toBe(0);
      expect(result.audit).toContain('"schemaVersion"');
      expectNoSecret(result);
    },
  );

  it('on a timeout', async () => {
    const hang: PsiFetch = (url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new TypeError(`fetch failed ${url}`));
        });
      });
    let out = '';
    let err = '';
    const io: Io = {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
    };
    const code = await run(
      [
        'example.test',
        '--only',
        'speed',
        '--strategy',
        'mobile',
        '--runs',
        '1',
        '--delay',
        '0',
        '--verbose',
        '--pages',
        '2',
        '--engine',
        'psi',
      ],
      io,
      { PSI_API_KEY: SENTINEL },
      {
        fetchImpl: site.fetchImpl,
        tlsProbe: () => Promise.resolve(goodTls()),
        dns: fakeDns({}),
        now: () => NOW,
        cwd: folder,
        chrome: { source: 'none' },
        sleep: () => Promise.resolve(),
        psiFetch: hang,
        psiTimeoutMs: 20,
      },
    );
    const audit = await readFile(
      join(folder, 'audits', 'example.test', '2026-11-21', 'audit.json'),
      'utf8',
    );
    expect(code).toBe(0);
    expect(audit).toContain('timed out');
    expectNoSecret({ code, out, err, audit, urls: [] });
  });

  it('on a fallback in auto mode: the fallback and its reason are recorded, without the key', async () => {
    const local = fakeEngine('lighthouse', () => labResult());
    const result = await audit(() => reply(500, '{}'), {
      engines: { local },
      chrome: { path: '/chrome', source: 'installed' },
    });
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/\d+ fell back from PSI to local Lighthouse/);
    expect(result.audit).toMatch(/"fallbacks": [1-9]/);
    expect(result.audit).toContain('PageSpeed Insights server error (HTTP 500)');
    expect(result.err).toContain('Falling back to local Lighthouse');
    expectNoSecret(result);
  });

  it('with a key set, in auto mode without Chrome: PSI failure is reported as not measured, without the key', async () => {
    const result = await audit(() => new TypeError('fetch failed'));
    expect(result.audit).toContain('network error');
    expectNoSecret(result);
  });

  it('when the whole run is stopped by an error: the thrown error has no key either', async () => {
    const throwing = {
      name: 'psi' as const,
      measure: () =>
        Promise.reject(
          new EngineError('network', 'The PageSpeed Insights request failed (network error).'),
        ),
    };
    const result = await audit(() => reply(200, '{}'), { engines: { psi: throwing } });
    expectNoSecret(result);
  });
});

describe('the key is read only from the environment', () => {
  it('an audit without the variable sends no key at all', async () => {
    let urls: string[] = [];
    let out = '';
    const io: Io = {
      stdout: (text) => {
        out += text;
      },
      stderr: () => undefined,
    };
    await run(
      [
        'example.test',
        '--only',
        'speed',
        '--strategy',
        'mobile',
        '--runs',
        '1',
        '--delay',
        '0',
        '--pages',
        '2',
        '--engine',
        'psi',
      ],
      io,
      {},
      {
        fetchImpl: site.fetchImpl,
        tlsProbe: () => Promise.resolve(goodTls()),
        dns: fakeDns({}),
        now: () => NOW,
        cwd: folder,
        chrome: { source: 'none' },
        sleep: () => Promise.resolve(),
        psiFetch: (url) => {
          urls = [...urls, url];
          return Promise.resolve(reply(200, JSON.stringify(FIXTURE)));
        },
      },
    );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => !new URL(url).searchParams.has('key'))).toBe(true);
    expect(out).toContain('Output:');
  });

  it('there is no parameter or config field for the key', async () => {
    const { PARAMS } = await import('../src/cli/params.js');
    expect(PARAMS.map((spec) => spec.flag).some((flag) => /key|psi/i.test(flag))).toBe(false);
  });
});
