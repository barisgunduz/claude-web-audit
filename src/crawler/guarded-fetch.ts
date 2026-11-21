import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPrivateAddress } from './address.js';
import { BLOCKED_CODE, BLOCKED_MESSAGE, type FetchFunction } from './http.js';

export interface FetchTransport {
  fetch: FetchFunction;
  /** Closes the open connections. Call it when the audit is done. */
  close(): Promise<void>;
}

export interface TransportOptions {
  /** Allow private addresses. Only for an audit of a site that is itself on a private address. */
  allowPrivate: boolean;
  /** For tests. The default is the system resolver. */
  lookup?: (
    hostname: string,
    options: LookupOptions,
    callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
  ) => void;
  /** For tests. The default is isPrivateAddress. */
  isBlocked?: (address: string) => boolean;
}

/**
 * A fetch whose connections only go to public addresses. The check runs inside the lookup that the
 * socket itself uses, so the address that was checked is the address that is connected to.
 * A name is not resolved twice, which closes the gap that DNS rebinding relies on.
 */
export function createTransport(options: TransportOptions): FetchTransport {
  const resolve =
    options.lookup ??
    ((hostname, lookupOptions, callback) => {
      dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
        callback(error, addresses);
      });
    });
  const isBlocked = options.isBlocked ?? isPrivateAddress;

  const guardedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
    resolve(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0);
        return;
      }
      // One private address is enough to refuse the name, since a hostile name can mix both kinds.
      if (addresses.length === 0 || addresses.some((entry) => isBlocked(entry.address))) {
        const blocked: NodeJS.ErrnoException = new Error(BLOCKED_MESSAGE);
        blocked.code = BLOCKED_CODE;
        callback(blocked, '', 0);
        return;
      }
      if (lookupOptions.all === true) {
        callback(null, addresses);
        return;
      }
      const [first] = addresses;
      callback(null, first?.address ?? '', first?.family ?? 4);
    });
  };

  const agent = new Agent({ connect: options.allowPrivate ? {} : { lookup: guardedLookup } });
  return {
    fetch: (url, init) => undiciFetch(url, { ...init, dispatcher: agent }),
    close: () => agent.close(),
  };
}
