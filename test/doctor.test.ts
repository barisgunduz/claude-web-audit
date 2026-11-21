import { describe, expect, it } from 'vitest';
import { formatDoctor, runDoctor, satisfiesMinimum, type DoctorDeps } from '../src/doctor/index.js';

const SECRET = 'TEST_FAKE_PSI_KEY_0123456789';
const ok = () => Promise.resolve({ status: 200 });

const deps = (overrides: Partial<DoctorDeps> = {}): DoctorDeps => ({
  env: {},
  nodeVersion: '26.7.0',
  nodeRange: '>=22.19',
  findChrome: () => Promise.resolve({ path: '/chrome', source: 'installed' }),
  chromeVersion: () => Promise.resolve('Google Chrome 157.0.0.0'),
  lighthouseVersion: () => '13.6.0',
  axeVersion: () => '4.14.0',
  fetchImpl: ok,
  ...overrides,
});

describe('satisfiesMinimum', () => {
  it.each([
    ['22.19.0', '>=22.19', true],
    ['22.19.5', '>=22.19', true],
    ['22.18.9', '>=22.19', false],
    ['22.12.0', '>=22.19', false],
    ['23.0.0', '>=22.19', true],
    ['26.7.0', '>=22.19', true],
    ['21.99.99', '>=22.19', false],
    ['v22.19.0', '>=22.19.0', true],
    ['22.19.0', '>=22.19.1', false],
    ['22.0.0', '>=22', true],
    ['20.0.0', '>=22', false],
    ['22.19.0', '^22.19', false],
  ])('%s against %s is %s', (version, range, expected) => {
    expect(satisfiesMinimum(version, range)).toBe(expected);
  });
});

describe('runDoctor', () => {
  it('is ready when everything is there', async () => {
    const result = await runDoctor('auto', deps());
    expect(result.ready).toBe(true);
    expect(result.lines.map((line) => line.label)).toEqual([
      'Node.js',
      'Chrome',
      'Lighthouse',
      'axe-core',
      'PSI_API_KEY',
      'PageSpeed Insights',
      'Network',
    ]);
    expect(result.lines.find((line) => line.label === 'Chrome')?.detail).toBe(
      '/chrome (Google Chrome 157.0.0.0)',
    );
  });

  it('fails for an old Node and says which one to install', async () => {
    const result = await runDoctor('auto', deps({ nodeVersion: '22.18.0' }));
    expect(result.ready).toBe(false);
    expect(result.lines[0]).toMatchObject({
      status: 'fail',
      detail: '22.18.0 (needs >=22.19)',
      fix: 'Install Node.js 22.19 or newer.',
    });
  });

  it('needs Chrome for the local engine, and gives the fix', async () => {
    const result = await runDoctor(
      'lighthouse',
      deps({ findChrome: () => Promise.resolve({ source: 'none' }) }),
    );
    expect(result.ready).toBe(false);
    expect(result.lines.find((line) => line.label === 'Chrome')).toMatchObject({
      status: 'fail',
      detail: 'not found',
    });
    expect(result.lines.find((line) => line.label === 'Chrome')?.fix).toContain('CHROME_PATH');
  });

  it('reports a Chrome path that cannot be run', async () => {
    const result = await runDoctor(
      'lighthouse',
      deps({
        findChrome: () =>
          Promise.resolve({
            source: 'config',
            problem: 'chromePath points to a file that cannot be run',
          }),
      }),
    );
    expect(result.lines.find((line) => line.label === 'Chrome')?.detail).toBe(
      'chromePath points to a file that cannot be run',
    );
  });

  it('is ready with PSI and a key but no Chrome in auto mode, and warns about axe', async () => {
    const result = await runDoctor(
      'auto',
      deps({ env: { PSI_API_KEY: SECRET }, findChrome: () => Promise.resolve({ source: 'none' }) }),
    );
    expect(result.ready).toBe(true);
    expect(result.lines.at(-1)).toMatchObject({ status: 'warn', label: 'Accessibility checks' });
  });

  it('is not ready in auto mode without a key and without Chrome', async () => {
    const result = await runDoctor(
      'auto',
      deps({ findChrome: () => Promise.resolve({ source: 'none' }) }),
    );
    expect(result.ready).toBe(false);
  });

  it('shows that the key is set, and never prints any part of it', async () => {
    const result = await runDoctor('auto', deps({ env: { PSI_API_KEY: SECRET } }));
    expect(result.lines.find((line) => line.label === 'PSI_API_KEY')).toMatchObject({
      status: 'ok',
      detail: 'set',
    });
    const text = formatDoctor('auto', result).join('\n') + JSON.stringify(result);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('TEST_FAKE');
  });

  it('does not send the key to the reachability check', async () => {
    const urls: string[] = [];
    await runDoctor(
      'auto',
      deps({
        env: { PSI_API_KEY: SECRET },
        fetchImpl: (url) => {
          urls.push(url);
          return ok();
        },
      }),
    );
    expect(urls.join(' ')).not.toContain(SECRET);
    expect(urls).toHaveLength(2);
  });

  it('warns when the key is not set', async () => {
    const line = (await runDoctor('auto', deps())).lines.find(
      (entry) => entry.label === 'PSI_API_KEY',
    );
    expect(line).toMatchObject({ status: 'warn', detail: 'not set' });
  });

  it('notices that PSI refuses requests without a key, because of quota', async () => {
    const result = await runDoctor(
      'psi',
      deps({
        fetchImpl: (url) => Promise.resolve({ status: url.includes('googleapis') ? 429 : 200 }),
      }),
    );
    expect(result.lines.find((line) => line.label === 'PageSpeed Insights')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('refuses requests without a key'),
    });
    expect(result.ready).toBe(false);
    const withKey = await runDoctor(
      'psi',
      deps({
        env: { PSI_API_KEY: SECRET },
        fetchImpl: (url) => Promise.resolve({ status: url.includes('googleapis') ? 429 : 200 }),
      }),
    );
    expect(withKey.ready).toBe(true);
  });

  it('fails when PSI cannot be reached in psi mode, and only warns in lighthouse mode', async () => {
    const fetchImpl: DoctorDeps['fetchImpl'] = (url) =>
      url.includes('googleapis') ? Promise.reject(new Error('offline')) : ok();
    expect((await runDoctor('psi', deps({ fetchImpl }))).ready).toBe(false);
    const local = await runDoctor('lighthouse', deps({ fetchImpl }));
    expect(local.ready).toBe(true);
    expect(local.lines.find((line) => line.label === 'PageSpeed Insights')?.status).toBe('warn');
  });

  it('fails without network, and when Lighthouse or axe-core are missing', async () => {
    expect(
      (await runDoctor('auto', deps({ fetchImpl: () => Promise.reject(new Error('offline')) })))
        .ready,
    ).toBe(false);
    expect((await runDoctor('auto', deps({ lighthouseVersion: () => undefined }))).ready).toBe(
      false,
    );
    expect((await runDoctor('auto', deps({ axeVersion: () => undefined }))).ready).toBe(false);
  });

  it('times out a slow network call', async () => {
    const fetchImpl: DoctorDeps['fetchImpl'] = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const result = await runDoctor('lighthouse', deps({ fetchImpl, timeoutMs: 20 }));
    expect(result.lines.find((line) => line.label === 'Network')).toMatchObject({
      status: 'fail',
      detail: 'not reachable',
    });
  });
});

describe('formatDoctor', () => {
  it('prints one line per check, a fix line under problems, and a verdict', async () => {
    const text = formatDoctor(
      'auto',
      await runDoctor('auto', deps({ findChrome: () => Promise.resolve({ source: 'none' }) })),
    ).join('\n');
    expect(text).toContain('cwa doctor (engine: auto)');
    expect(text).toContain('ok    Node.js: 26.7.0 (needs >=22.19)');
    expect(text).toContain('FAIL  Chrome: not found\n      Fix: Install Google Chrome');
    expect(text).toContain('warn  PSI_API_KEY: not set\n      Fix: Optional.');
    expect(text.trimEnd().endsWith('Not ready: fix the FAIL lines above.')).toBe(true);
  });
});
