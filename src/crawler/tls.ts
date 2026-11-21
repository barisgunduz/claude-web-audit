import tls from 'node:tls';
import type { TlsInfo } from '../model/crawl.js';

export type TlsProbe = (host: string) => Promise<TlsInfo>;

function parseAltNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('DNS:'))
    .map((part) => part.slice(4).toLowerCase());
}

/** Connects to port 443 and records the certificate. It never sends a request. */
export const probeTls: TlsProbe = (host) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (info: TlsInfo): void => {
      if (settled) return;
      settled = true;
      resolve(info);
    };
    const failed = (error: string): TlsInfo => ({
      host,
      reachable: false,
      error,
      subjectAltNames: [],
      hostnameMatches: false,
      authorized: false,
    });

    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: 15_000 },
      () => {
        const cert = socket.getPeerCertificate();
        const rawError = socket.authorizationError as unknown;
        const authorizationError =
          typeof rawError === 'string'
            ? rawError
            : rawError instanceof Error
              ? rawError.message
              : undefined;
        finish({
          host,
          reachable: true,
          subjectAltNames: parseAltNames(cert.subjectaltname),
          hostnameMatches: tls.checkServerIdentity(host, cert) === undefined,
          authorized: socket.authorized,
          ...(socket.getProtocol() && { protocol: socket.getProtocol() ?? '' }),
          validFrom: new Date(cert.valid_from).toISOString(),
          validTo: new Date(cert.valid_to).toISOString(),
          ...(authorizationError !== undefined && { authorizationError }),
        });
        socket.end();
      },
    );
    socket.on('error', (error) => {
      finish(failed(error.message));
    });
    socket.on('timeout', () => {
      finish(failed('TLS connection timed out'));
      socket.destroy();
    });
  });
