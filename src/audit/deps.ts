import type { TlsProbe } from '../crawler/tls.js';
import type { DnsResolver } from '../modules/email/dns.js';

/** Things the audit gets from outside. Tests replace them so that nothing touches the internet. */
export interface AuditDeps {
  fetchImpl?: typeof fetch;
  tlsProbe?: TlsProbe;
  dns?: DnsResolver;
  now?: () => Date;
  /** Folder that relative output paths are resolved against. */
  cwd?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}
