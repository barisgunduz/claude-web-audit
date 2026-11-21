import { isIP } from 'node:net';

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function isPrivateIpv4Bytes(bytes: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = bytes;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** The 16 bytes of an IPv6 address in any written form, or undefined when it is not valid. */
export function ipv6Bytes(address: string): number[] | undefined {
  let text = address.toLowerCase();
  let tailBytes: number[] | undefined;
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text)?.[1];
  if (dotted !== undefined) {
    tailBytes = dotted.split('.').map(Number);
    if (tailBytes.some((part) => part > 255)) return undefined;
    text = `${text.slice(0, -dotted.length)}0:0`;
  }
  const parts = text.split('::');
  if (parts.length > 2) return undefined;
  const groups = (side: string | undefined): string[] =>
    side === undefined || side === '' ? [] : side.split(':');
  const left = groups(parts[0]);
  const right = groups(parts[1]);
  const missing = 8 - left.length - right.length;
  if (parts.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const all = [
    ...left,
    ...Array.from({ length: parts.length === 2 ? missing : 0 }, () => '0'),
    ...right,
  ];
  if (all.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const bytes = all.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
  if (tailBytes) bytes.splice(12, 4, ...tailBytes);
  return bytes;
}

function isPrivateIpv6Bytes(bytes: readonly number[]): boolean {
  const [b0 = 0, b1 = 0] = bytes;
  const embedded = bytes.slice(12, 16);
  const zeros = (from: number, to: number): boolean =>
    bytes.slice(from, to).every((byte) => byte === 0);

  // ::/96 holds the unspecified address, loopback and IPv4-compatible addresses.
  if (zeros(0, 12)) return isPrivateIpv4Bytes(embedded);
  // ::ffff:0:0/96, IPv4-mapped.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIpv4Bytes(embedded);
  // 64:ff9b::/96 NAT64, and 64:ff9b:1::/48 for local use.
  if (b0 === 0x00 && b1 === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return bytes[4] === 0 && bytes[5] === 0 ? isPrivateIpv4Bytes(embedded) : true;
  }
  // 2002::/16 6to4 carries an IPv4 address in bytes 2 to 5.
  if (b0 === 0x20 && b1 === 0x02) return isPrivateIpv4Bytes(bytes.slice(2, 6));
  // 2001::/32 Teredo tunnels.
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0 && bytes[3] === 0) return true;
  if ((b0 & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b0 === 0xfe && (b1 & 0xc0) >= 0x80) return true; // fe80::/10 link-local and fec0::/10 site-local
  return b0 === 0xff; // multicast
}

/** True for an IP address in a private, loopback, link-local, multicast or reserved range. */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '');
  const version = isIP(host);
  if (version === 4) return isPrivateIpv4Bytes(host.split('.').map(Number));
  if (version === 6) {
    const bytes = ipv6Bytes(host);
    return bytes === undefined || isPrivateIpv6Bytes(bytes);
  }
  return false;
}

/**
 * True for names and addresses that point at the local machine or a private network.
 * This looks at the written host only. The connection itself is guarded by the transport in
 * guarded-fetch.ts, which judges the address that a name resolves to.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return isPrivateAddress(host);
}
