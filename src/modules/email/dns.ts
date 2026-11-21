import { Resolver } from 'node:dns/promises';

export interface MxRecord {
  exchange: string;
  priority: number;
}

/** The DNS lookups the email module needs. Tests inject a fake. */
export interface DnsResolver {
  /** TXT records of a name, each record as the list of its strings. Empty when the name has none. */
  resolveTxt(name: string): Promise<string[][]>;
  resolveMx(name: string): Promise<MxRecord[]>;
}

export class DnsLookupError extends Error {
  override readonly name = 'DnsLookupError';
}

const MISSING_CODES = new Set(['ENODATA', 'ENOTFOUND']);

async function orEmpty<T>(lookup: Promise<T[]>): Promise<T[]> {
  try {
    return await lookup;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (MISSING_CODES.has(code)) return [];
    throw new DnsLookupError(code === '' ? 'DNS lookup failed' : `DNS lookup failed (${code})`);
  }
}

export function createSystemResolver(): DnsResolver {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  return {
    resolveTxt: (name) => orEmpty(resolver.resolveTxt(name)),
    resolveMx: (name) => orEmpty(resolver.resolveMx(name)),
  };
}
