import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json' with { type: 'json' };
import tr from '../src/i18n/tr.json' with { type: 'json' };
import { createTranslator, DICTIONARIES } from '../src/i18n/index.js';

describe('i18n', () => {
  it('keeps en and tr on the same keys', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('translates with the selected language', () => {
    expect(createTranslator('tr')('status.notMeasured')).toBe('Ölçülmedi');
    expect(createTranslator('en')('status.notMeasured')).toBe('Not measured');
  });

  it('falls back to English for a missing key', () => {
    const translate = createTranslator('xx', {
      en: { 'status.notMeasured': 'Not measured' },
      xx: {},
    });
    expect(translate('status.notMeasured')).toBe('Not measured');
  });

  it('falls back to English for an unknown language', () => {
    expect(createTranslator('de')('module.seo')).toBe(en['module.seo']);
  });

  it('matches regional codes to the base language, ignoring case', () => {
    expect(createTranslator('TR-tr')('module.speed')).toBe(tr['module.speed']);
  });

  it('does not read inherited object properties as languages', () => {
    expect(createTranslator('constructor')('module.seo')).toBe(en['module.seo']);
  });

  it('returns the key when no dictionary has it', () => {
    const translate = createTranslator('en', {});
    expect(translate('module.seo')).toBe('module.seo');
  });

  it('exposes the built-in languages', () => {
    expect(Object.keys(DICTIONARIES)).toEqual(['en', 'tr']);
  });
});
