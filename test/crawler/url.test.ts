import { describe, expect, it } from 'vitest';
import {
  InputError,
  isPrivateHost,
  parseDomainInput,
  resolveUrl,
  toCanonicalOrigin,
} from '../../src/crawler/url.js';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'printer.local',
    'db.internal',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '[::1]',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'LOCALHOST',
    'localhost.',
  ])('%s is private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    'example.com',
    'www.example.com',
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '192.169.0.1',
    '11.0.0.1',
    '2606:4700::1111',
    'notlocalhost.com',
    'internal.example.com',
  ])('%s is public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

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
