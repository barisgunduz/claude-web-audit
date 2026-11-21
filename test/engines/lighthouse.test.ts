import { afterEach, describe, expect, it } from 'vitest';
import {
  findChrome,
  shouldDisableSandbox,
  type ChromeHandle,
  type LaunchOptions,
} from '../../src/engines/chrome.js';
import { LocalLighthouseEngine, type RunLighthouse } from '../../src/engines/lighthouse.js';
import { EngineError } from '../../src/engines/types.js';
import { FIXTURE } from '../support/lab.js';

function launcher() {
  const state = { launched: [] as LaunchOptions[], closed: 0, port: 9222 };
  const launch = (options: LaunchOptions): Promise<ChromeHandle> => {
    state.launched.push(options);
    return Promise.resolve({
      port: state.port,
      close: () => {
        state.closed++;
        return Promise.resolve();
      },
    });
  };
  return { state, launch };
}

const lhr = FIXTURE.lighthouseResult;

describe('LocalLighthouseEngine', () => {
  it('runs Lighthouse against the port of a new Chrome and closes Chrome afterwards', async () => {
    const { state, launch } = launcher();
    const seen: [string, number, string][] = [];
    const runLighthouse: RunLighthouse = (url, port, strategy) => {
      seen.push([url, port, strategy]);
      return Promise.resolve(lhr);
    };
    const engine = new LocalLighthouseEngine({ chromePath: '/chrome', launch, runLighthouse });
    const result = await engine.measure('https://example.com/', 'mobile');
    expect(result).toMatchObject({ engine: 'lighthouse', formFactor: 'mobile' });
    expect(seen).toEqual([['https://example.com/', 9222, 'mobile']]);
    expect(state.launched[0]?.chromePath).toBe('/chrome');
    expect(state.closed).toBe(1);
  });

  it('starts a fresh Chrome for every run', async () => {
    const { state, launch } = launcher();
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      launch,
      runLighthouse: () => Promise.resolve(lhr),
    });
    await engine.measure('https://example.com/', 'mobile');
    await engine.measure('https://example.com/', 'desktop');
    expect(state.launched).toHaveLength(2);
    expect(state.closed).toBe(2);
  });

  it('closes Chrome when Lighthouse fails, and reports a short reason', async () => {
    const { state, launch } = launcher();
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      launch,
      runLighthouse: () => Promise.reject(new Error('Protocol error\n    at stack line')),
    });
    await expect(engine.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'runtime',
      message: 'Lighthouse failed (Protocol error).',
    });
    expect(state.closed).toBe(1);
  });

  it('closes Chrome and says so when the page could not be loaded', async () => {
    const { state, launch } = launcher();
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      launch,
      runLighthouse: () => Promise.resolve({ runtimeError: { code: 'FAILED_DOCUMENT_REQUEST' } }),
    });
    await expect(engine.measure('https://example.com/', 'mobile')).rejects.toMatchObject({
      kind: 'runtime',
      message: expect.stringContaining('FAILED_DOCUMENT_REQUEST'),
    });
    expect(state.closed).toBe(1);
  });

  it('closes Chrome when the result is not readable', async () => {
    const { state, launch } = launcher();
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      launch,
      runLighthouse: () => Promise.resolve({ audits: {} }),
    });
    await expect(engine.measure('https://example.com/', 'mobile')).rejects.toBeInstanceOf(
      EngineError,
    );
    expect(state.closed).toBe(1);
  });

  it('closes Chrome when the run is stopped', async () => {
    const { state, launch } = launcher();
    const controller = new AbortController();
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      launch,
      runLighthouse: () => {
        controller.abort();
        return Promise.reject(new Error('Target closed'));
      },
    });
    await expect(
      engine.measure('https://example.com/', 'mobile', controller.signal),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(state.closed).toBe(1);
  });

  it('closes Chrome when a run takes too long', async () => {
    const { state, launch } = launcher();
    let release: () => void = () => undefined;
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      launch,
      timeoutMs: 10,
      runLighthouse: () =>
        new Promise((_resolve, reject) => {
          release = () => {
            reject(new Error('Target closed'));
          };
        }),
    });
    const pending = engine
      .measure('https://example.com/', 'mobile')
      .catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(state.closed).toBeGreaterThanOrEqual(1);
    release();
    expect(await pending).toBeInstanceOf(EngineError);
  });

  it('passes the no-sandbox choice on to the launcher', async () => {
    const { state, launch } = launcher();
    const engine = new LocalLighthouseEngine({
      chromePath: '/chrome',
      noSandbox: true,
      launch,
      runLighthouse: () => Promise.resolve(lhr),
    });
    await engine.measure('https://example.com/', 'mobile');
    expect(state.launched[0]?.noSandbox).toBe(true);
  });
});

describe('shouldDisableSandbox', () => {
  it.each([
    [0, true, true],
    [0, false, false],
    [1000, true, false],
    [undefined, true, false],
  ])('uid %s in a container %s gives %s', (uid, inContainer, expected) => {
    expect(shouldDisableSandbox(uid === undefined ? undefined : () => uid, () => inContainer)).toBe(
      expected,
    );
  });
});

describe('findChrome', () => {
  const executable =
    (...paths: string[]) =>
    (path: string) =>
      Promise.resolve(paths.includes(path));
  const installed = () => ['/usr/bin/chrome-a', '/usr/bin/chrome-b'];
  afterEach(() => undefined);

  it('prefers the chromePath config field, then CHROME_PATH, then the install locations', async () => {
    const allowed = executable('/cfg', '/env', '/usr/bin/chrome-a', '/usr/bin/chrome-b');
    expect(
      await findChrome({
        chromePath: '/cfg',
        env: { CHROME_PATH: '/env' },
        installations: installed,
        isExecutable: allowed,
      }),
    ).toEqual({ path: '/cfg', source: 'config' });
    expect(
      await findChrome({
        env: { CHROME_PATH: '/env' },
        installations: installed,
        isExecutable: allowed,
      }),
    ).toEqual({ path: '/env', source: 'CHROME_PATH' });
    expect(await findChrome({ env: {}, installations: installed, isExecutable: allowed })).toEqual({
      path: '/usr/bin/chrome-a',
      source: 'installed',
    });
  });

  it('takes the first installation that can run', async () => {
    expect(
      (
        await findChrome({
          env: {},
          installations: installed,
          isExecutable: executable('/usr/bin/chrome-b'),
        })
      ).path,
    ).toBe('/usr/bin/chrome-b');
  });

  it('says so when a given path is not usable, and does not fall through to another Chrome', async () => {
    const result = await findChrome({
      chromePath: '/missing',
      env: {},
      installations: installed,
      isExecutable: executable('/usr/bin/chrome-a'),
    });
    expect(result).toEqual({
      source: 'config',
      problem: 'chromePath points to a file that cannot be run',
    });
    const env = await findChrome({
      env: { CHROME_PATH: '/missing' },
      installations: installed,
      isExecutable: executable(),
    });
    expect(env.problem).toContain('CHROME_PATH');
  });

  it('ignores empty values and reports none when nothing is found', async () => {
    expect(
      await findChrome({
        chromePath: ' ',
        env: { CHROME_PATH: '' },
        installations: () => [],
        isExecutable: executable(),
      }),
    ).toEqual({ source: 'none' });
  });
});
