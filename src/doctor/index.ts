import { createRequire } from 'node:module';
import axe from 'axe-core';
import {
  chromeVersion,
  findChrome,
  type ChromeLookup,
  type FindChromeOptions,
} from '../engines/chrome.js';
import { PSI_ENDPOINT } from '../engines/psi.js';
import type { EngineSetting } from '../engines/measure.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorLine {
  status: DoctorStatus;
  label: string;
  detail: string;
  /** What to do when the status is not ok. */
  fix?: string;
}

export interface DoctorDeps {
  env: NodeJS.ProcessEnv;
  nodeVersion?: string;
  /** The "engines.node" range of package.json, for example ">=22.19". */
  nodeRange: string;
  chromePath?: string | undefined;
  findChrome?: (options: FindChromeOptions) => Promise<ChromeLookup>;
  chromeVersion?: (path: string) => Promise<string | undefined>;
  lighthouseVersion?: () => string | undefined;
  axeVersion?: () => string | undefined;
  fetchImpl?: (
    url: string,
    init: { method: string; signal: AbortSignal },
  ) => Promise<{ status: number }>;
  timeoutMs?: number;
}

export interface DoctorResult {
  lines: DoctorLine[];
  /** True when everything that the chosen engine needs is available. */
  ready: boolean;
}

/** Compares a version with a ">=major.minor[.patch]" range. */
export function satisfiesMinimum(version: string, range: string): boolean {
  const wanted = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (!wanted) return false;
  const need = [Number(wanted[1]), Number(wanted[2] ?? 0), Number(wanted[3] ?? 0)];
  const have = version
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index++) {
    const a = have[index] ?? 0;
    const b = need[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function installedLighthouseVersion(): string | undefined {
  try {
    const manifest = createRequire(import.meta.url)('lighthouse/package.json') as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

async function reachable(
  url: string,
  deps: DoctorDeps,
  method: string,
): Promise<{ ok: boolean; detail: string; status?: number }> {
  const fetchImpl = deps.fetchImpl ?? ((target, init) => fetch(target, init));
  try {
    const response = await fetchImpl(url, {
      method,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    // Any HTTP answer means the host can be reached, even an error status for a request without parameters.
    return { ok: true, detail: `reachable (HTTP ${response.status})`, status: response.status };
  } catch {
    return { ok: false, detail: 'not reachable' };
  }
}

/** Checks what the audit needs and says what to fix. The value of PSI_API_KEY is never printed. */
export async function runDoctor(setting: EngineSetting, deps: DoctorDeps): Promise<DoctorResult> {
  const lines: DoctorLine[] = [];
  const find = deps.findChrome ?? findChrome;
  const versionOf = deps.chromeVersion ?? chromeVersion;
  const hasKey = (deps.env.PSI_API_KEY?.trim() ?? '') !== '';

  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const nodeOk = satisfiesMinimum(nodeVersion, deps.nodeRange);
  lines.push({
    status: nodeOk ? 'ok' : 'fail',
    label: 'Node.js',
    detail: `${nodeVersion} (needs ${deps.nodeRange})`,
    ...(!nodeOk && { fix: `Install Node.js ${deps.nodeRange.replace('>=', '')} or newer.` }),
  });

  const chrome = await find({ chromePath: deps.chromePath, env: deps.env });
  let chromeOk = false;
  if (chrome.path !== undefined) {
    chromeOk = true;
    const version = await versionOf(chrome.path);
    lines.push({
      status: 'ok',
      label: 'Chrome',
      detail: `${chrome.path}${version ? ` (${version})` : ''}`,
    });
  } else {
    lines.push({
      status: 'fail',
      label: 'Chrome',
      detail: chrome.problem ?? 'not found',
      fix: 'Install Google Chrome, or set CHROME_PATH or the chromePath config field to its executable.',
    });
  }

  const lighthouse = (deps.lighthouseVersion ?? installedLighthouseVersion)();
  lines.push({
    status: lighthouse ? 'ok' : 'fail',
    label: 'Lighthouse',
    detail: lighthouse ?? 'not installed',
    ...(!lighthouse && { fix: 'Run "npm ci" in the project folder.' }),
  });
  const axeVersion = (deps.axeVersion ?? (() => axe.version))();
  lines.push({
    status: axeVersion ? 'ok' : 'fail',
    label: 'axe-core',
    detail: axeVersion ?? 'not installed',
    ...(!axeVersion && { fix: 'Run "npm ci" in the project folder.' }),
  });

  lines.push({
    status: hasKey ? 'ok' : 'warn',
    label: 'PSI_API_KEY',
    detail: hasKey ? 'set' : 'not set',
    ...(!hasKey && {
      fix: 'Optional. Set the PSI_API_KEY environment variable to use your own PageSpeed Insights quota.',
    }),
  });
  const psi = await reachable(PSI_ENDPOINT, deps, 'GET');
  // A request without a key was refused for quota. With a key the quota is your own.
  const keylessRefused = psi.ok && psi.status === 429 && !hasKey;
  lines.push({
    status: !psi.ok ? (setting === 'lighthouse' ? 'warn' : 'fail') : keylessRefused ? 'warn' : 'ok',
    label: 'PageSpeed Insights',
    detail: keylessRefused
      ? `reachable, but it refuses requests without a key (HTTP ${psi.status}, quota)`
      : psi.detail,
    ...(!psi.ok && {
      fix: 'Check your network or proxy. The local Lighthouse engine does not need PSI.',
    }),
    ...(keylessRefused && {
      fix: 'Set the PSI_API_KEY environment variable, or use --engine lighthouse.',
    }),
  });
  const network = await reachable('https://example.com/', deps, 'HEAD');
  lines.push({
    status: network.ok ? 'ok' : 'fail',
    label: 'Network',
    detail: network.detail,
    ...(!network.ok && { fix: 'Check your internet connection or proxy.' }),
  });

  const psiReady = hasKey && psi.ok;
  const engineReady =
    setting === 'psi' ? psi.ok : setting === 'lighthouse' ? chromeOk : chromeOk || psiReady;
  const ready = nodeOk && network.ok && Boolean(lighthouse) && Boolean(axeVersion) && engineReady;
  if (!chromeOk && setting !== 'lighthouse') {
    lines.push({
      status: 'warn',
      label: 'Accessibility checks',
      detail: 'axe-core needs Chrome, so the a11y module will be "not measured"',
      fix: 'Install Chrome, or set CHROME_PATH or the chromePath config field.',
    });
  }
  return { lines, ready };
}

export function formatDoctor(setting: EngineSetting, result: DoctorResult): string[] {
  const mark: Record<DoctorStatus, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  const lines = [`cwa doctor (engine: ${setting})`];
  for (const line of result.lines) {
    lines.push(`${mark[line.status]}  ${line.label}: ${line.detail}`);
    if (line.fix !== undefined && line.status !== 'ok') lines.push(`      Fix: ${line.fix}`);
  }
  lines.push(
    result.ready
      ? 'Ready: everything that this engine needs is available.'
      : 'Not ready: fix the FAIL lines above.',
  );
  return lines;
}
