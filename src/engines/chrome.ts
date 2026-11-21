import { execFile } from 'node:child_process';
import { access, constants, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as chromeLauncher from 'chrome-launcher';
import { EngineError } from './types.js';

const run = promisify(execFile);

export interface ChromeLookup {
  /** The Chrome that will be used, when one was found. */
  path?: string;
  /** Where the lookup came from, or what was tried, for the doctor output. */
  source: 'config' | 'CHROME_PATH' | 'installed' | 'none';
  /** Set when a path was given (config or CHROME_PATH) but is not usable. */
  problem?: string;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface FindChromeOptions {
  chromePath?: string | undefined;
  env: NodeJS.ProcessEnv;
  /** For tests. The default asks chrome-launcher for the common install locations. */
  installations?: () => string[];
  isExecutable?: (path: string) => Promise<boolean>;
}

/** Order: the chromePath config field, then CHROME_PATH, then the common install locations. */
export async function findChrome(options: FindChromeOptions): Promise<ChromeLookup> {
  const usable = options.isExecutable ?? isExecutable;
  const given: [string | undefined, 'config' | 'CHROME_PATH'][] = [
    [options.chromePath, 'config'],
    [options.env.CHROME_PATH, 'CHROME_PATH'],
  ];
  for (const [path, source] of given) {
    if (path === undefined || path.trim() === '') continue;
    if (await usable(path)) return { path, source };
    return {
      source,
      problem: `${source === 'config' ? 'chromePath' : 'CHROME_PATH'} points to a file that cannot be run`,
    };
  }
  const installed = (options.installations ?? (() => chromeLauncher.Launcher.getInstallations()))();
  for (const path of installed) {
    if (await usable(path)) return { path, source: 'installed' };
  }
  return { source: 'none' };
}

/** The version line of a Chrome binary, for example "Google Chrome 157.0.7000.0". */
export async function chromeVersion(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(path, ['--version'], { timeout: 10_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Chrome refuses to start as root without --no-sandbox. Allow that only inside a container. */
export function shouldDisableSandbox(
  getUid: (() => number) | undefined = process.getuid?.bind(process),
  inContainer: () => boolean = () => existsSync('/.dockerenv') || existsSync('/run/.containerenv'),
): boolean {
  return getUid?.() === 0 && inContainer();
}

export interface ChromeHandle {
  port: number;
  /** Stops Chrome and deletes its temporary profile. Safe to call more than once. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  chromePath: string;
  signal?: AbortSignal | undefined;
  noSandbox?: boolean;
}

/** Starts headless Chrome with a fresh temporary profile. */
export async function launchChrome(options: LaunchOptions): Promise<ChromeHandle> {
  if (options.signal?.aborted) throw new EngineError('aborted', 'Stopped');
  const profile = await mkdtemp(join(tmpdir(), 'cwa-chrome-'));
  let closed = false;
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | undefined;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener('abort', onAbort);
    try {
      chrome?.kill();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  };
  const onAbort = (): void => {
    void close();
  };

  try {
    const noSandbox = options.noSandbox ?? shouldDisableSandbox();
    chrome = await chromeLauncher.launch({
      chromePath: options.chromePath,
      userDataDir: profile,
      // The CLI handles Ctrl+C itself and closes Chrome through the abort signal.
      handleSIGINT: false,
      chromeFlags: ['--headless=new', '--disable-gpu', ...(noSandbox ? ['--no-sandbox'] : [])],
    });
  } catch (error) {
    await close();
    throw new EngineError(
      'no_chrome',
      `Chrome could not be started (${error instanceof Error ? error.message : 'unknown error'}).`,
    );
  }
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) await close();
  return { port: chrome.port, close };
}
