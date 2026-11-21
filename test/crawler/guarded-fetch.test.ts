import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransport, type TransportOptions } from '../../src/crawler/guarded-fetch.js';
import { BLOCKED_MESSAGE, HttpClient } from '../../src/crawler/http.js';

let server: Server | undefined;
let hits = 0;
let port = 0;
afterEach(async () => {
  const open = server;
  server = undefined;
  hits = 0;
  if (open) {
    await new Promise<void>((resolve) => {
      open.close(() => {
        resolve();
      });
    });
  }
});

async function listen(): Promise<void> {
  server = createServer((_request, response) => {
    hits++;
    response.end('hello');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
}

const answer =
  (...addresses: string[]): TransportOptions['lookup'] =>
  (_name, _options, callback) => {
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
const client = (transport: ReturnType<typeof createTransport>): HttpClient =>
  new HttpClient({
    userAgent: 'test',
    timeoutMs: 2000,
    maxBodyBytes: 1000,
    delayMs: 0,
    fetchImpl: transport.fetch,
    allowPrivateHosts: true,
  });

describe('createTransport', () => {
  it('connects to the address that the guarded lookup returned', async () => {
    await listen();
    // The test treats 127.0.0.1 as public, to prove that the connection really uses the checked address.
    const transport = createTransport({
      allowPrivate: false,
      lookup: answer('127.0.0.1'),
      isBlocked: (address) => address === '10.0.0.9',
    });
    const response = await client(transport).request(`http://public.test:${port}/`, {
      body: 'text',
    });
    expect(response.text).toBe('hello');
    expect(hits).toBe(1);
    await transport.close();
  });

  it('refuses a name that resolves to a private address, and never connects', async () => {
    await listen();
    const transport = createTransport({ allowPrivate: false, lookup: answer('127.0.0.1') });
    await expect(client(transport).request(`http://rebind.test:${port}/`)).rejects.toMatchObject({
      kind: 'blocked',
      message: BLOCKED_MESSAGE,
    });
    expect(hits).toBe(0);
    await transport.close();
  });

  it('refuses a name when only one of its addresses is private', async () => {
    await listen();
    const transport = createTransport({
      allowPrivate: false,
      lookup: answer('93.184.216.34', '::ffff:7f00:1'),
    });
    await expect(client(transport).request(`http://mixed.test:${port}/`)).rejects.toMatchObject({
      kind: 'blocked',
    });
    expect(hits).toBe(0);
    await transport.close();
  });

  it('checks every new connection, so a name that changes its answer is caught', async () => {
    await listen();
    let calls = 0;
    const lookup: TransportOptions['lookup'] = (_name, _options, callback) => {
      calls++;
      callback(null, [{ address: calls === 1 ? '127.0.0.1' : '10.0.0.9', family: 4 }]);
    };
    const transport = createTransport({
      allowPrivate: false,
      lookup,
      isBlocked: (address) => address === '10.0.0.9',
    });
    // Two different hosts force two connections, and the second answer is private.
    await expect(client(transport).request(`http://first.test:${port}/`)).resolves.toBeDefined();
    await expect(client(transport).request(`http://second.test:${port}/`)).rejects.toMatchObject({
      kind: 'blocked',
    });
    expect(hits).toBe(1);
    await transport.close();
  });

  it('passes a lookup failure on as a network error', async () => {
    const lookup: TransportOptions['lookup'] = (_name, _options, callback) => {
      callback(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), []);
    };
    const transport = createTransport({ allowPrivate: false, lookup });
    await expect(client(transport).request('http://nowhere.test/')).rejects.toMatchObject({
      kind: 'network',
      message: 'ENOTFOUND',
    });
    await transport.close();
  });

  it('does not guard when the audited site is private', async () => {
    await listen();
    const transport = createTransport({ allowPrivate: true });
    const response = await client(transport).request(`http://127.0.0.1:${port}/`, { body: 'text' });
    expect(response.text).toBe('hello');
    await transport.close();
  });

  it('refuses a private literal address before any lookup', async () => {
    await listen();
    const transport = createTransport({ allowPrivate: false });
    const guarded = new HttpClient({
      userAgent: 'test',
      timeoutMs: 2000,
      maxBodyBytes: 1000,
      delayMs: 0,
      fetchImpl: transport.fetch,
    });
    await expect(guarded.request(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({
      kind: 'blocked',
    });
    expect(hits).toBe(0);
    await transport.close();
  });
});
