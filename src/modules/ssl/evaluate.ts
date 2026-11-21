import { makeFinding } from '../../checks/support.js';
import type { TlsInfo } from '../../model/crawl.js';
import type { Finding } from '../../model/finding.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SELF_SIGNED = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN']);
/** Authorization errors that other findings already cover. */
const COVERED_ELSEWHERE = new Set([
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID',
]);
const CURRENT_PROTOCOLS = new Set(['TLSv1.2', 'TLSv1.3']);

export function daysUntil(isoDate: string, now: Date): number {
  return Math.floor((new Date(isoDate).getTime() - now.getTime()) / DAY_MS);
}

/** Judges the certificate data of a host. Pure, so it can be tested with fake certificates. */
export function evaluateTls(info: TlsInfo, now: Date): Finding[] {
  const host = info.host;
  if (!info.reachable) {
    return [makeFinding('ssl', 'SSL-002', 'critical', [host], { reason: info.error ?? 'unknown' })];
  }

  const findings: Finding[] = [];
  if (info.validTo !== undefined) {
    const days = daysUntil(info.validTo, now);
    if (days < 0) {
      findings.push(makeFinding('ssl', 'SSL-003', 'critical', [host], { validTo: info.validTo }));
    } else if (days < 7) {
      findings.push(
        makeFinding('ssl', 'SSL-004', 'critical', [host], { days, validTo: info.validTo }),
      );
    } else if (days < 30) {
      findings.push(
        makeFinding('ssl', 'SSL-005', 'important', [host], { days, validTo: info.validTo }),
      );
    }
  }
  if (!info.hostnameMatches) {
    findings.push(
      makeFinding('ssl', 'SSL-006', 'critical', [host, ...info.subjectAltNames], { host }),
    );
  }
  const reason = info.authorizationError;
  if (!info.authorized && reason !== undefined && !COVERED_ELSEWHERE.has(reason)) {
    findings.push(
      makeFinding('ssl', 'SSL-007', SELF_SIGNED.has(reason) ? 'critical' : 'important', [host], {
        reason,
      }),
    );
  }
  if (info.protocol !== undefined && !CURRENT_PROTOCOLS.has(info.protocol)) {
    findings.push(makeFinding('ssl', 'SSL-008', 'important', [host], { protocol: info.protocol }));
  }
  return findings;
}
