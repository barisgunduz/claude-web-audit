import { describe, expect, it } from 'vitest';
import {
  InputError,
  parseDomainInput,
  resolveUrl,
  toCanonicalOrigin,
} from '../../src/crawler/url.js';

describe('parseDomainInput', () => {
  it('accepts domains and full URLs, and ignores the path and port', () => {
    expect(parseDomainInput('Example.COM')).toBe('example.com');
    expect(parseDomainInput('https://www.Example.com/a/b?x=1')).toBe('www.example.com');
    expect(parseDomainInput('example.com:8080/x')).toBe('example.com');
  });

  it.each(['', '   ', 'not a domain', 'ftp://example.com', 'http://', 'a b.com'])(
    'rejects %j',
    (input) => {
      expect(() => parseDomainInput(input)).toThrow(InputError);
    },
  );
});

describe('url helpers', () => {
  it('resolves links and refuses other schemes', () => {
    expect(resolveUrl('/a#frag', 'https://e.test/x/')).toBe('https://e.test/a');
    expect(resolveUrl('mailto:a@b.co', 'https://e.test/')).toBeUndefined();
    expect(resolveUrl('javascript:void(0)', 'https://e.test/')).toBeUndefined();
    expect(resolveUrl('http://[bad', 'https://e.test/')).toBeUndefined();
  });

  it('moves www and http variants of the same site onto the canonical origin only', () => {
    expect(toCanonicalOrigin('http://www.e.test/a?b=1', 'https://e.test')).toBe(
      'https://e.test/a?b=1',
    );
    expect(toCanonicalOrigin('https://other.test/a', 'https://e.test')).toBe(
      'https://other.test/a',
    );
  });
});
