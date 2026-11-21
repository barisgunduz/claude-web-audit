import { describe, expect, it } from 'vitest';
import { ipv6Bytes, isPrivateAddress, isPrivateHost } from '../../src/crawler/address.js';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'printer.local',
    'db.internal',
    'nas.home.arpa',
    'host.localdomain',
    'LOCALHOST',
    'localhost.',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.255',
    '192.0.0.8',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
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
    '192.0.1.1',
    '198.17.0.1',
    '198.20.0.1',
    '11.0.0.1',
    '223.255.255.255',
    'notlocalhost.com',
    'internal.example.com',
    'local.example.com',
  ])('%s is public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('IPv6 addresses', () => {
  it.each([
    '::',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    'fd00::1',
    'fc00::',
    'fe80::1',
    'febf::1',
    'fec0::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::FFFF:7F00:1',
    '::ffff:a00:1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1',
    '64:ff9b::10.0.0.1',
    '64:ff9b:1::1',
    '2002:7f00:1::',
    '2002:a00:1::1',
    '2002:c0a8:101::',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '::7f00:1',
    '::10.0.0.1',
    '::192.168.0.1',
    '0:0:0:0:0:ffff:7f00:1',
  ])('%s is private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
    expect(isPrivateHost(address)).toBe(true);
  });

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    '64:ff9b::808:808',
    '2002:808:808::',
    '2a00:1450:4001::1',
  ])('%s is public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('rejects malformed IPv6 text', () => {
    expect(ipv6Bytes('1::2::3')).toBeUndefined();
    expect(ipv6Bytes('::ffff:999.1.1.1')).toBeUndefined();
    expect(ipv6Bytes('1:2:3:4:5:6:7:8:9')).toBeUndefined();
    expect(ipv6Bytes('g::1')).toBeUndefined();
  });

  it('reads the forms that the URL parser produces for every way of writing 127.0.0.1', () => {
    const written = [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://127.1/',
      'http://0177.0.0.1/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[::127.0.0.1]/',
      'http://[64:ff9b::127.0.0.1]/',
      'http://[::1]/',
      'http://[0000:0000:0000:0000:0000:0000:0000:0001]/',
      'http://0/',
      'http://localhost./',
    ];
    for (const url of written) expect(isPrivateHost(new URL(url).hostname), url).toBe(true);
  });
});
