import { bareHost } from '../../crawler/url.js';
import { makeFinding, outcome } from '../../checks/support.js';
import type { Check, CheckContext } from '../../model/check.js';
import { DnsLookupError } from './dns.js';
import { analyzeSpf, SPF_LOOKUP_LIMIT, spfRecords } from './spf.js';

function domainOf(context: CheckContext): string {
  return bareHost(context.crawl.host.canonicalHost);
}

/** A DNS failure means "could not measure". It is never turned into a finding. */
function dnsFailure(error: unknown): ReturnType<typeof outcome> {
  const reason = error instanceof DnsLookupError ? error.message : 'DNS lookup failed';
  return outcome([], undefined, reason);
}

const spf: Check = {
  id: 'email.spf',
  module: 'email',
  codes: ['EML-001', 'EML-002', 'EML-003', 'EML-004', 'EML-005'],
  async run(context) {
    const domain = domainOf(context);
    try {
      const records = spfRecords(await context.dns.resolveTxt(domain));
      if (records.length === 0)
        return outcome([makeFinding('email', 'EML-001', 'important', [domain])]);
      if (records.length > 1)
        return outcome([makeFinding('email', 'EML-002', 'important', records)]);
      const record = records[0] ?? '';
      const analysis = await analyzeSpf(context.dns, record);
      const findings = [];
      if (analysis.invalidTerms.length > 0) {
        findings.push(makeFinding('email', 'EML-003', 'important', analysis.invalidTerms));
      }
      if (analysis.lookups > SPF_LOOKUP_LIMIT) {
        findings.push(
          makeFinding('email', 'EML-004', 'important', [domain], {
            lookups: analysis.lookups,
            limit: SPF_LOOKUP_LIMIT,
          }),
        );
      }
      const weak = analysis.allQualifier === '+' || analysis.allQualifier === '?';
      const missingAll = analysis.allQualifier === undefined && !analysis.hasRedirect;
      if (weak || missingAll) {
        findings.push(
          makeFinding('email', 'EML-005', 'important', [record], {
            qualifier: analysis.allQualifier ?? 'none',
          }),
        );
      }
      return outcome(findings, { spfLookups: analysis.lookups });
    } catch (error) {
      return dnsFailure(error);
    }
  },
};

function parseTags(record: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of record.split(';')) {
    const [name, ...rest] = part.split('=');
    if (name && rest.length > 0) tags.set(name.trim().toLowerCase(), rest.join('=').trim());
  }
  return tags;
}

const dmarc: Check = {
  id: 'email.dmarc',
  module: 'email',
  codes: ['EML-006', 'EML-007', 'EML-008', 'EML-009', 'EML-010'],
  async run(context) {
    const name = `_dmarc.${domainOf(context)}`;
    try {
      const records = (await context.dns.resolveTxt(name))
        .map((parts) => parts.join(''))
        .filter((record) => /^v=DMARC1\s*;?/i.test(record.trim()));
      if (records.length === 0)
        return outcome([makeFinding('email', 'EML-006', 'important', [name])]);
      if (records.length > 1)
        return outcome([
          makeFinding('email', 'EML-010', 'important', records, { reason: 'more than one record' }),
        ]);

      const record = records[0] ?? '';
      const tags = parseTags(record);
      const policy = (tags.get('p') ?? '').toLowerCase();
      if (!['none', 'quarantine', 'reject'].includes(policy)) {
        return outcome([
          makeFinding('email', 'EML-010', 'important', [record], {
            reason: 'missing or invalid p tag',
          }),
        ]);
      }
      const findings = [];
      if (policy === 'none')
        findings.push(makeFinding('email', 'EML-007', 'improvement', [record]));
      if ((tags.get('rua') ?? '') === '')
        findings.push(makeFinding('email', 'EML-008', 'improvement', [record]));
      const pct = Number(tags.get('pct') ?? 100);
      if (Number.isFinite(pct) && pct < 100 && policy !== 'none') {
        findings.push(makeFinding('email', 'EML-009', 'improvement', [record], { pct }));
      }
      return outcome(findings, { dmarcPolicy: policy });
    } catch (error) {
      return dnsFailure(error);
    }
  },
};

const mx: Check = {
  id: 'email.mx',
  module: 'email',
  codes: ['EML-011'],
  async run(context) {
    const domain = domainOf(context);
    try {
      const records = await context.dns.resolveMx(domain);
      const nullMx = records.length === 1 && records[0]?.exchange === '';
      const missing = records.length === 0;
      return outcome(missing ? [makeFinding('email', 'EML-011', 'improvement', [domain])] : [], {
        mxRecords: nullMx ? 0 : records.length,
      });
    } catch (error) {
      return dnsFailure(error);
    }
  },
};

const dkim: Check = {
  id: 'email.dkim',
  module: 'email',
  codes: ['EML-012'],
  async run(context) {
    const selectors = context.settings.dkimSelectors;
    if (selectors.length === 0) {
      return outcome(
        [],
        { dkim: 'not_measured' },
        'DKIM is not measured because no selectors are set (email.dkimSelectors in the config file)',
      );
    }
    const domain = domainOf(context);
    const missing: string[] = [];
    try {
      for (const selector of selectors) {
        const records = await context.dns.resolveTxt(`${selector}._domainkey.${domain}`);
        const valid = records.some((parts) => /(^|;)\s*p=\s*[^;\s]/i.test(parts.join('')));
        if (!valid) missing.push(`${selector}._domainkey.${domain}`);
      }
    } catch (error) {
      return dnsFailure(error);
    }
    return outcome(
      missing.length > 0 ? [makeFinding('email', 'EML-012', 'important', missing)] : [],
      {
        dkimSelectorsChecked: selectors.length,
      },
    );
  },
};

export const emailChecks: readonly Check[] = [spf, dmarc, mx, dkim];
