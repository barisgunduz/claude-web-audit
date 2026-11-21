import { isIP } from 'node:net';
import type { DnsResolver } from './dns.js';

export const SPF_LOOKUP_LIMIT = 10;

export interface SpfAnalysis {
  /** Terms that are not valid SPF syntax. */
  invalidTerms: string[];
  /** The qualifier of the final "all" term, or undefined when there is none and no redirect. */
  allQualifier: '+' | '-' | '~' | '?' | undefined;
  hasRedirect: boolean;
  /** DNS lookups the record causes, counted through include and redirect. */
  lookups: number;
}

const QUALIFIERS = new Set(['+', '-', '~', '?']);

export function splitTerms(record: string): string[] {
  return record.trim().split(/\s+/).slice(1);
}

function isValidTerm(term: string): boolean {
  const body = QUALIFIERS.has(term[0] ?? '') ? term.slice(1) : term;
  const lower = body.toLowerCase();
  if (lower === 'all' || lower === 'a' || lower === 'mx' || lower === 'ptr') return true;
  if (/^(a|mx)(:[^\s:]+)?(\/\d{1,3}){0,2}$/.test(lower)) return true;
  if (/^(include|exists):[^\s]+$/.test(lower)) return true;
  if (/^(redirect|exp)=[^\s]+$/.test(lower)) return true;
  const ip = /^ip([46]):([^/]+)(\/\d{1,3})?$/.exec(body);
  if (ip) return isIP(ip[2] ?? '') === (ip[1] === '4' ? 4 : 6);
  return false;
}

function spfRecords(records: readonly (readonly string[])[]): string[] {
  return records.map((parts) => parts.join('')).filter((record) => /^v=spf1(\s|$)/i.test(record));
}

async function countLookups(
  dns: DnsResolver,
  record: string,
  seen: Set<string>,
  depth: number,
): Promise<number> {
  let lookups = 0;
  for (const term of splitTerms(record)) {
    const body = (QUALIFIERS.has(term[0] ?? '') ? term.slice(1) : term).toLowerCase();
    if (/^(a|mx|ptr|exists)(:|\/|$)/.test(body)) lookups++;
    const target = /^include:(.+)$/.exec(body)?.[1] ?? /^redirect=(.+)$/.exec(body)?.[1];
    if (target === undefined) continue;
    lookups++;
    if (seen.has(target) || depth >= SPF_LOOKUP_LIMIT) continue;
    seen.add(target);
    const [inner] = spfRecords(await dns.resolveTxt(target));
    if (inner !== undefined) lookups += await countLookups(dns, inner, seen, depth + 1);
  }
  return lookups;
}

export async function analyzeSpf(dns: DnsResolver, record: string): Promise<SpfAnalysis> {
  const terms = splitTerms(record);
  const invalidTerms = terms.filter((term) => !isValidTerm(term));
  const allTerm = terms.find((term) => /^[+\-~?]?all$/i.test(term));
  const qualifier = allTerm === undefined ? undefined : allTerm.length === 3 ? '+' : allTerm[0];
  return {
    invalidTerms,
    allQualifier: qualifier as SpfAnalysis['allQualifier'],
    hasRedirect: terms.some((term) => /^redirect=/i.test(term)),
    lookups: await countLookups(dns, record, new Set(), 0),
  };
}

export { spfRecords };
