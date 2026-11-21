import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json' with { type: 'json' };
import { createTranslator } from '../src/i18n/index.js';
import { renderFinding } from '../src/i18n/messages.js';
import { MODULE_NAMES } from '../src/modules/names.js';
import { CHECKS, checkCodes, MODULES } from '../src/modules/registry.js';
import { makeFinding } from '../src/checks/support.js';

// Built from code points so that this file holds no dash character itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const docs = readFileSync('docs/checks.md', 'utf8');
const PLACEHOLDERS = new Set([
  'count',
  'groups',
  'pages',
  'minimum',
  'limit',
  'lookups',
  'qualifier',
  'pct',
  'reason',
  'contentType',
  'days',
  'validTo',
  'host',
  'protocol',
  'tags',
]);

describe('check registry', () => {
  const codes = checkCodes();

  it('has unique check ids and unique codes', () => {
    expect(new Set(CHECKS.map((check) => check.id)).size).toBe(CHECKS.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('puts every check under the module that registered it', () => {
    for (const name of MODULE_NAMES) {
      for (const check of MODULES[name].checks) expect(check.module).toBe(name);
    }
  });

  it('uses the module prefix for every code', () => {
    const prefixes: Record<string, string> = {
      links: 'LINK',
      ssl: 'SSL',
      headers: 'HDR',
      seo: 'SEO',
      content: 'CNT',
      email: 'EML',
      ai: 'AI',
    };
    for (const check of CHECKS) {
      for (const code of check.codes)
        expect(code.startsWith(`${prefixes[check.module] ?? '?'}-`)).toBe(true);
    }
  });

  it.each(codes)('%s has an English message and an entry in docs/checks.md', (code) => {
    expect(en).toHaveProperty([`finding.${code}`]);
    expect(docs).toContain(`| ${code} |`);
  });

  it('has no message or docs row without a check', () => {
    const messageCodes = Object.keys(en)
      .filter((key) => key.startsWith('finding.'))
      .map((key) => key.slice('finding.'.length));
    expect(messageCodes.sort()).toEqual([...codes].sort());
    const docCodes = [...docs.matchAll(/^\| ([A-Z]+-\d{3}) \|/gm)].map((match) => match[1]);
    expect(docCodes.sort()).toEqual([...codes].sort());
  });

  it('only uses placeholders that findings provide', () => {
    for (const [key, message] of Object.entries(en)) {
      if (!key.startsWith('finding.')) continue;
      for (const match of message.matchAll(/\{(\w+)\}/g))
        expect(PLACEHOLDERS.has(match[1] ?? '')).toBe(true);
    }
  });

  it('keeps messages free of em dashes and en dashes', () => {
    for (const message of Object.values(en)) expect(message).not.toMatch(DASHES);
  });
});

describe('renderFinding', () => {
  const translate = createTranslator('en');
  it('fills placeholders from the finding data', () => {
    const finding = makeFinding('links', 'LINK-001', 'important', ['a', 'b']);
    expect(renderFinding(finding, translate)).toBe('2 internal URLs return a 4xx client error.');
  });
  it('keeps a placeholder that has no data, and falls back to the code for an unknown finding', () => {
    expect(renderFinding(makeFinding('seo', 'SEO-019', 'improvement', ['x']), translate)).toBe(
      '1 pages miss Open Graph tags ({tags}).',
    );
    expect(renderFinding(makeFinding('seo', 'SEO-999', 'improvement', []), translate)).toBe(
      'finding.SEO-999',
    );
  });
  it('falls back to English when the Turkish file has no message', () => {
    expect(
      renderFinding(makeFinding('links', 'LINK-001', 'important', ['a']), createTranslator('tr')),
    ).toBe('1 internal URLs return a 4xx client error.');
  });
});
