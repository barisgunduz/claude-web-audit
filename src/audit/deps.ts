import type { ChromeLookup } from '../engines/chrome.js';
import type { LabEngine } from '../engines/types.js';
import type { PsiFetch } from '../engines/psi.js';
import type { AxeRunner } from '../modules/a11y/axe-types.js';
import type { DoctorDeps } from '../doctor/index.js';
import type { FetchFunction } from '../crawler/http.js';
import type { TlsProbe } from '../crawler/tls.js';
import type { DnsResolver } from '../modules/email/dns.js';

/** Things the audit gets from outside. Tests replace them so that nothing touches the internet. */
export interface AuditDeps {
  fetchImpl?: FetchFunction;
  tlsProbe?: TlsProbe;
  dns?: DnsResolver;
  now?: () => Date;
  /** Folder that relative output paths are resolved against. */
  cwd?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** The environment. PSI_API_KEY and CHROME_PATH are read from here and nowhere else. */
  env?: NodeJS.ProcessEnv;
  /** Replaces the PageSpeed Insights transport. */
  psiFetch?: PsiFetch;
  /** Replaces the Lighthouse engines. */
  engines?: { psi?: LabEngine; local?: LabEngine };
  /** Replaces the axe runner. */
  axe?: AxeRunner;
  /** Replaces the Chrome lookup. */
  chrome?: ChromeLookup;
  /** Replaces parts of the doctor environment, for example its network calls. */
  doctor?: Partial<DoctorDeps>;
}
