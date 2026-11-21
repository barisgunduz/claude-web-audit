import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestResponse {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
  /** Wait before answering, to test timeouts and concurrency. */
  delayMs?: number;
}

export interface TestRequest {
  /** The URL the crawler asked for, for example https://example.test/about. */
  url: URL;
  method: string;
  headers: IncomingMessage['headers'];
}

export type TestHandler = (request: TestRequest) => TestResponse | Promise<TestResponse>;

export interface LoggedRequest {
  url: string;
  method: string;
  at: number;
}

export interface TestSite {
  /** Pass this as fetchImpl. It sends every request to the local server. */
  fetchImpl: typeof fetch;
  requests: LoggedRequest[];
  maxInFlight(): number;
  close(): Promise<void>;
}

/**
 * A local http server that plays any host and scheme. The fetch wrapper keeps the original URL
 * in a header, so handlers can serve http://, https://, www and non-www from one socket.
 */
export async function startTestSite(handler: TestHandler): Promise<TestSite> {
  const requests: LoggedRequest[] = [];
  let inFlight = 0;
  let peak = 0;

  const server: Server = createServer((req, res) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    const original = String(req.headers['x-test-url'] ?? `http://example.test${req.url ?? '/'}`);
    requests.push({ url: original, method: req.method ?? 'GET', at: Date.now() });
    void (async () => {
      try {
        const response = await handler({
          url: new URL(original),
          method: req.method ?? 'GET',
          headers: req.headers,
        });
        if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        res.writeHead(response.status ?? 200, response.headers);
        res.end(req.method === 'HEAD' ? undefined : response.body);
      } catch {
        res.writeHead(500).end();
      } finally {
        inFlight--;
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const fetchImpl: typeof fetch = (input, init) => {
    const original = input instanceof Request ? input.url : String(input);
    const target = new URL(original);
    const headers = new Headers(init?.headers);
    headers.set('x-test-url', original);
    return fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, {
      ...init,
      headers,
    });
  };

  return {
    fetchImpl,
    requests,
    maxInFlight: () => peak,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

export const HTML = { 'content-type': 'text/html; charset=utf-8' };

export function html(body: string, head = ''): TestResponse {
  return {
    headers: HTML,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${body}</body></html>`,
  };
}

export function redirect(to: string, status = 301): TestResponse {
  return { status, headers: { location: to } };
}

export type Route = TestResponse | ((request: TestRequest) => TestResponse | Promise<TestResponse>);

/**
 * A site on https://example.test. http and www addresses redirect with a 301 to the canonical
 * address, and every other path is looked up in `routes`. Unknown paths answer 404.
 */
export function canonicalSite(
  routes: Record<string, Route>,
  canonicalHost = 'example.test',
): TestHandler {
  return async (request) => {
    const { url } = request;
    if (url.protocol === 'http:' || url.hostname !== canonicalHost) {
      return redirect(`https://${canonicalHost}${url.pathname}${url.search}`);
    }
    const route = routes[url.pathname];
    if (route === undefined)
      return { status: 404, headers: HTML, body: '<html><body>Not found</body></html>' };
    return typeof route === 'function' ? route(request) : route;
  };
}
