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

interface LookupState {
  lookups: number;
  seen: Set<string>;
}

/**
 * Counts the DNS lookups of a record, following include and redirect. It stops asking DNS as
 * soon as the count passes the limit, so a hostile record cannot make the audit query endlessly.
 */
async function countLookups(
  dns: DnsResolver,
  record: string,
  state: LookupState,
  depth: number,
): Promise<void> {
  for (const term of splitTerms(record)) {
    if (state.lookups > SPF_LOOKUP_LIMIT) return;
    const body = (QUALIFIERS.has(term[0] ?? '') ? term.slice(1) : term).toLowerCase();
    if (/^(a|mx|ptr|exists)(:|\/|$)/.test(body)) state.lookups++;
    const target = /^include:(.+)$/.exec(body)?.[1] ?? /^redirect=(.+)$/.exec(body)?.[1];
    if (target === undefined) continue;
    state.lookups++;
    if (state.lookups > SPF_LOOKUP_LIMIT || state.seen.has(target) || depth >= SPF_LOOKUP_LIMIT)
      continue;
    state.seen.add(target);
    const [inner] = spfRecords(await dns.resolveTxt(target));
    if (inner !== undefined) await countLookups(dns, inner, state, depth + 1);
  }
}

async function lookupCount(dns: DnsResolver, record: string): Promise<number> {
  const state: LookupState = { lookups: 0, seen: new Set() };
  await countLookups(dns, record, state, 0);
  return state.lookups;
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
    lookups: await lookupCount(dns, record),
  };
}

export { spfRecords };
