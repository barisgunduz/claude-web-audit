import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { crawl, type CrawlOptions } from '../../src/crawler/crawl.js';
import { CrawlError } from '../../src/crawler/hosts.js';
import { BLOCKED_MESSAGE } from '../../src/crawler/http.js';
import { InputError } from '../../src/crawler/url.js';
import { goodTls, requestUrl } from '../support/builders.js';
import {
  canonicalSite,
  html,
  redirect,
  startTestSite,
  type Route,
  type TestSite,
} from '../support/test-site.js';

let site: TestSite | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});

async function run(
  routes: Record<string, Route>,
  options: Partial<CrawlOptions> = {},
  host = 'example.test',
) {
  site = await startTestSite(canonicalSite(routes, host));
  return crawl({
    input: 'example.test',
    pages: 50,
    delayMs: 0,
    concurrency: 2,
    version: '1.2.3',
    fetchImpl: site.fetchImpl,
    tlsProbe: () => Promise.resolve(goodTls()),
    ...options,
  });
}

const link = (href: string, text = 'link'): string => `<a href="${href}">${text}</a>`;

describe('host detection', () => {
  it('tests four variants and records the redirect chains', async () => {
    const result = await run({ '/': html('Home') });
    expect(result.host.canonicalHost).toBe('example.test');
    expect(result.host.canonicalOrigin).toBe('https://example.test');
    expect(result.host.variants.map((variant) => variant.variant).sort()).toEqual([
      'http://example.test/',
      'http://www.example.test/',
      'https://example.test/',
      'https://www.example.test/',
    ]);
    const wwwHttp = result.host.variants.find(
      (variant) => variant.variant === 'http://www.example.test/',
    );
    expect(wwwHttp?.chain.map((hop) => hop.status)).toEqual([301]);
    expect(wwwHttp?.finalUrl).toBe('https://example.test/');
    expect(result.host.consistent).toBe(true);
  });

  it('follows the redirect to a www canonical host', async () => {
    const result = await run({ '/': html('Home') }, {}, 'www.example.test');
    expect(result.host.canonicalHost).toBe('www.example.test');
    expect(result.startUrl).toBe('https://www.example.test/');
  });

  it('fails clearly when nothing answers', async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    await expect(
      crawl({
        input: 'example.test',
        pages: 5,
        delayMs: 0,
        concurrency: 1,
        version: '1',
        fetchImpl,
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(CrawlError);
  });

  it('rejects an input that is not a domain', async () => {
    await expect(
      crawl({ input: 'not a domain', pages: 5, delayMs: 0, concurrency: 1, version: '1' }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(
      crawl({ input: 'ftp://example.test', pages: 5, delayMs: 0, concurrency: 1, version: '1' }),
    ).rejects.toBeInstanceOf(InputError);
  });
});

describe('requests', () => {
  it('sends the documented user agent and no cookies or credentials', async () => {
    const seen: {
      agent: string | undefined;
      cookie: string | undefined;
      auth: string | undefined;
    }[] = [];
    await run({
      '/': (request) => {
        seen.push({
          agent: request.headers['user-agent'],
          cookie: request.headers.cookie,
          auth: request.headers.authorization,
        });
        return { ...html('Home'), headers: { 'content-type': 'text/html', 'set-cookie': 'a=1' } };
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const entry of seen) {
      expect(entry.agent).toBe(
        'claude-web-audit/1.2.3 (+https://github.com/barisgunduz/claude-web-audit)',
      );
      expect(entry.cookie).toBeUndefined();
      expect(entry.auth).toBeUndefined();
    }
  });
});

describe('robots.txt', () => {
  it('does not fetch blocked paths and records them', async () => {
    const result = await run({
      '/robots.txt': {
        headers: { 'content-type': 'text/plain' },
        body: 'User-agent: *\nDisallow: /private/',
      },
      '/': html(`${link('/private/a')}${link('/ok')}`),
      '/ok': html('ok'),
      '/private/a': html('secret'),
    });
    expect(site?.requests.some((request) => request.url.includes('/private/a'))).toBe(false);
    expect(result.blockedByRobots).toEqual(['https://example.test/private/a']);
    expect(result.pages.map((page) => page.url)).toContain('https://example.test/ok');
  });

  it('obeys a rule written for the crawler by name', async () => {
    const result = await run({
      '/robots.txt': { body: 'User-agent: claude-web-audit\nDisallow: /' },
      '/': html('Home'),
    });
    expect(result.pages).toHaveLength(0);
    expect(result.blockedByRobots).toEqual(['https://example.test/']);
  });

  it('records a missing robots.txt', async () => {
    const result = await run({ '/': html('Home') });
    expect(result.robots.found).toBe(false);
    expect(result.robots.status).toBe(404);
  });
});

describe('sitemaps', () => {
  it('reads an index with a gzip child and queues sitemap URLs', async () => {
    const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/a</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://example.test/b</loc></url></urlset>`;
    const result = await run({
      '/robots.txt': {
        body: 'User-agent: *\nDisallow:\nSitemap: https://example.test/sitemap_index.xml',
      },
      '/sitemap_index.xml': {
        body: '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.test/s1.xml.gz</loc></sitemap></sitemapindex>',
      },
      '/s1.xml.gz': { headers: { 'content-type': 'application/gzip' }, body: gzipSync(urlset) },
      '/': html('Home'),
      '/a': html('A'),
      '/b': html('B'),
    });
    expect(
      result.sitemaps.files
        .filter((file) => file.kind !== 'missing')
        .map((file) => [file.kind, file.gzip, file.urlCount]),
    ).toEqual([
      ['index', false, 0],
      ['urlset', true, 2],
    ]);
    expect(result.sitemaps.urls.map((entry) => entry.loc)).toEqual([
      'https://example.test/a',
      'https://example.test/b',
    ]);
    expect(result.pages.map((page) => page.url).sort()).toEqual([
      'https://example.test/',
      'https://example.test/a',
      'https://example.test/b',
    ]);
    expect(result.pages.find((page) => page.url.endsWith('/a'))?.inbound).toEqual([]);
  });

  it('records an invalid sitemap without failing', async () => {
    const result = await run({
      '/sitemap.xml': { body: '<html>not a sitemap</html>' },
      '/': html('Home'),
    });
    expect(result.sitemaps.files[0]?.kind).toBe('invalid');
  });

  it('lists the sitemap candidate in files even when it is missing', async () => {
    const result = await run({ '/': html('Home') });
    expect(result.sitemaps.files).toEqual([
      expect.objectContaining({ kind: 'missing', status: 404 }),
    ]);
  });
});

describe('page cap, click depth and inbound links', () => {
  const routes: Record<string, Route> = {
    '/': html(Array.from({ length: 10 }, (_, index) => link(`/p${index}`)).join('')),
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`/p${index}`, html(link('/deep'))]),
    ),
    '/deep': html(link('/deeper')),
    '/deeper': html('end'),
  };

  it('respects the page cap exactly', async () => {
    const result = await run(routes, { pages: 4 });
    expect(result.pages).toHaveLength(4);
    expect(result.limits.pagesCapReached).toBe(true);
  });

  it('crawls everything when the cap is higher', async () => {
    const result = await run(routes, { pages: 100 });
    expect(result.pages).toHaveLength(13);
    expect(result.limits.pagesCapReached).toBe(false);
    const depth = (path: string): number | undefined =>
      result.pages.find((page) => page.url === `https://example.test${path}`)?.clickDepth;
    expect([depth('/'), depth('/p0'), depth('/deep'), depth('/deeper')]).toEqual([0, 1, 2, 3]);
    expect(result.pages.find((page) => page.url.endsWith('/deep'))?.inbound).toHaveLength(10);
  });

  it('resolves www and http links to the canonical page', async () => {
    const result = await run({
      '/': html(`${link('http://example.test/a')}${link('https://www.example.test/a')}`),
      '/a': html('A'),
    });
    expect(result.pages.filter((page) => page.url.endsWith('/a'))).toHaveLength(1);
    expect(result.pages.find((page) => page.url.endsWith('/a'))?.inbound).toEqual([
      'https://example.test/',
    ]);
  });
});

describe('politeness', () => {
  it('waits the delay between requests to the same host', async () => {
    // A fake clock: sleeping moves time forward, so no real time passes.
    let clock = 0;
    const starts: number[] = [];
    site = await startTestSite(
      canonicalSite({
        '/': html([1, 2, 3, 4].map((n) => link(`/p${n}`)).join('')),
        ...Object.fromEntries([1, 2, 3, 4].map((n) => [`/p${n}`, html('x')])),
      }),
    );
    const real = site.fetchImpl;
    const fetchImpl: typeof fetch = (input, init) => {
      if (requestUrl(input).startsWith('https://example.test/')) starts.push(clock);
      return real(input, init);
    };
    const result = await crawl({
      input: 'example.test',
      pages: 50,
      delayMs: 60,
      concurrency: 4,
      version: '1',
      fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });
    expect(result.pages).toHaveLength(5);
    expect(starts.length).toBeGreaterThanOrEqual(5);
    const gaps = starts.slice(1).map((time, index) => time - (starts[index] ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60);
  });

  it('does not wait when the delay is zero', async () => {
    const waits: number[] = [];
    await run(
      { '/': html(link('/a')), '/a': html('A') },
      {
        delayMs: 0,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(waits).toEqual([]);
  });

  it('never runs more requests at once than the concurrency limit', async () => {
    const slow = (): { delayMs: number; headers: Record<string, string>; body: string } =>
      ({
        ...html('x'),
        delayMs: 40,
      }) as { delayMs: number; headers: Record<string, string>; body: string };
    await run(
      {
        '/': html(Array.from({ length: 8 }, (_, n) => link(`/s${n}`)).join('')),
        ...Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`/s${n}`, slow()])),
      },
      { concurrency: 3 },
    );
    expect(site?.maxInFlight()).toBeLessThanOrEqual(3);
    expect(site?.maxInFlight()).toBeGreaterThanOrEqual(2);
  });

  it('raises the delay to the Crawl-delay of robots.txt', async () => {
    const waits: number[] = [];
    await run(
      {
        '/robots.txt': { body: 'User-agent: *\nCrawl-delay: 2' },
        '/': html(link('/a')),
        '/a': html('A'),
      },
      {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(Math.max(...waits)).toBeGreaterThanOrEqual(1500);
  });
});

describe('failures and partial results', () => {
  it('keeps a timed out page as a record and carries on', async () => {
    const result = await run(
      {
        '/': html(`${link('/slow')}${link('/fast')}`),
        '/slow': { ...html('slow'), delayMs: 400 },
        '/fast': html('fast'),
      },
      { timeoutMs: 150 },
    );
    const slow = result.pages.find((page) => page.url.endsWith('/slow'));
    expect(slow?.status).toBe(0);
    expect(slow?.error).toBe('Timed out');
    expect(result.pages.find((page) => page.url.endsWith('/fast'))?.status).toBe(200);
  });

  it('retries once after a network error', async () => {
    let failures = 0;
    site = await startTestSite(canonicalSite({ '/': html(link('/flaky')), '/flaky': html('ok') }));
    const real = site.fetchImpl;
    const fetchImpl: typeof fetch = (input, init) => {
      if (requestUrl(input).endsWith('/flaky') && failures++ === 0)
        return Promise.reject(new TypeError('fetch failed'));
      return real(input, init);
    };
    const result = await crawl({
      input: 'example.test',
      pages: 10,
      delayMs: 0,
      concurrency: 1,
      version: '1',
      fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
    });
    expect(result.pages.find((page) => page.url.endsWith('/flaky'))?.status).toBe(200);
    expect(failures).toBe(2);
  });

  it('records a page that never answers as status 0', async () => {
    site = await startTestSite(canonicalSite({ '/': html(link('/dead')) }));
    const real = site.fetchImpl;
    const fetchImpl: typeof fetch = (input, init) =>
      requestUrl(input).endsWith('/dead')
        ? Promise.reject(new TypeError('fetch failed'))
        : real(input, init);
    const result = await crawl({
      input: 'example.test',
      pages: 10,
      delayMs: 0,
      concurrency: 1,
      version: '1',
      fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
    });
    expect(result.pages.find((page) => page.url.endsWith('/dead'))).toMatchObject({
      status: 0,
      error: 'fetch failed',
    });
  });

  it('stops on request and returns what it has', async () => {
    const controller = new AbortController();
    const result = await run(
      {
        '/': html([1, 2, 3].map((n) => link(`/a${n}`)).join('')),
        '/a1': () => {
          controller.abort();
          return html('A1');
        },
        '/a2': html('A2'),
        '/a3': html('A3'),
      },
      { signal: controller.signal, concurrency: 1 },
    );
    expect(result.limits.stopped).toBe(true);
    expect(result.pages.map((page) => page.url)).toContain('https://example.test/');
    expect(result.pages.length).toBeLessThan(4);
    expect(result.externalLinks).toEqual([]);
  });

  it('does not parse non-HTML responses', async () => {
    const result = await run({
      '/': html(link('/file.pdf')),
      '/file.pdf': {
        headers: { 'content-type': 'application/pdf' },
        body: '%PDF-1.4 <a href="/hidden">x</a>',
      },
      '/hidden': html('hidden'),
    });
    const pdf = result.pages.find((page) => page.url.endsWith('/file.pdf'));
    expect(pdf?.status).toBe(200);
    expect(pdf?.html).toBeUndefined();
    expect(result.pages.some((page) => page.url.endsWith('/hidden'))).toBe(false);
  });

  it('caps the size of a body', async () => {
    const huge = `<html><body>${'x'.repeat(6 * 1024 * 1024)}</body></html>`;
    const result = await run({ '/': { headers: { 'content-type': 'text/html' }, body: huge } });
    expect(result.pages[0]?.bodyTruncated).toBe(true);
    expect(result.pages[0]?.html?.length).toBe(5 * 1024 * 1024);
  });
});

describe('redirects', () => {
  it('records every hop, loops and long chains', async () => {
    const result = await run({
      '/': html(`${link('/chain')}${link('/loop-a')}`),
      '/chain': redirect('/c2'),
      '/c2': redirect('/c3'),
      '/c3': redirect('/c4'),
      '/c4': redirect('/end'),
      '/end': html('end'),
      '/loop-a': redirect('/loop-b'),
      '/loop-b': redirect('/loop-a'),
    });
    const chain = result.pages.find((page) => page.url.endsWith('/chain'));
    expect(chain?.redirectChain.map((hop) => hop.status)).toEqual([301, 301, 301, 301]);
    expect(chain?.finalUrl).toBe('https://example.test/end');
    expect(chain?.status).toBe(200);
    const loop = result.pages.find((page) => page.url.endsWith('/loop-a'));
    expect(loop?.redirectLoop).toBe(true);
  });
});

describe('external links', () => {
  it('uses HEAD, falls back to GET when HEAD is rejected, and caps the list', async () => {
    const external = (name: string): string => `https://ext.example.net/${name}`;
    site = await startTestSite((request) => {
      if (request.url.hostname === 'ext.example.net') {
        if (request.url.pathname === '/no-head')
          return request.method === 'HEAD' ? { status: 405 } : { status: 200 };
        if (request.url.pathname === '/gone') return { status: 404 };
        return { status: 200 };
      }
      return canonicalSite({
        '/': html(['ok', 'no-head', 'gone', 'extra'].map((name) => link(external(name))).join('')),
      })(request);
    });
    const result = await crawl({
      input: 'example.test',
      pages: 10,
      delayMs: 0,
      concurrency: 2,
      version: '1',
      fetchImpl: site.fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
      externalCap: 3,
    });
    expect(result.externalLinks.map((entry) => [entry.url.split('/').pop(), entry.status])).toEqual(
      [
        ['ok', 200],
        ['no-head', 200],
        ['gone', 404],
      ],
    );
    expect(result.limits.externalCapReached).toBe(true);
    expect(
      site.requests
        .filter((request) => request.url.endsWith('/no-head'))
        .map((request) => request.method),
    ).toEqual(['HEAD', 'GET']);
  });
});

describe('staying on the given domain', () => {
  it('refuses a canonical host on another site', async () => {
    site = await startTestSite((request) =>
      request.url.hostname.endsWith('example.test')
        ? redirect('https://other-site.test/')
        : html('Other'),
    );
    await expect(
      crawl({
        input: 'example.test',
        pages: 5,
        delayMs: 0,
        concurrency: 1,
        version: '1',
        fetchImpl: site.fetchImpl,
      }),
    ).rejects.toThrow('example.test redirects to other-site.test. Audit that domain instead.');
    expect(site.requests.every((request) => !request.url.includes('other-site.test/robots'))).toBe(
      true,
    );
  });

  it('refuses a canonical host on a non-default port', async () => {
    site = await startTestSite((request) =>
      redirect(`https://example.test:8443${request.url.pathname}`),
    );
    await expect(
      crawl({
        input: 'example.test',
        pages: 5,
        delayMs: 0,
        concurrency: 1,
        version: '1',
        fetchImpl: site.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(CrawlError);
  });

  it('uses a variant on the same site when the other variant leaves it', async () => {
    site = await startTestSite((request) =>
      request.url.hostname === 'example.test'
        ? redirect('https://other-site.test/')
        : html('Home on www'),
    );
    const result = await crawl({
      input: 'example.test',
      pages: 3,
      delayMs: 0,
      concurrency: 1,
      version: '1',
      fetchImpl: site.fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls()),
    });
    expect(result.host.canonicalHost).toBe('www.example.test');
    expect(result.host.consistent).toBe(false);
  });
});

describe('private addresses', () => {
  it('does not request external links to private addresses, and does not call them broken', async () => {
    const result = await run({
      '/': html(
        [
          'http://169.254.169.254/latest/meta-data',
          'http://127.0.0.1:9/admin',
          'http://10.0.0.5/',
          'http://intranet.local/',
          'https://ext.example.net/ok',
        ]
          .map((href) => link(href))
          .join(''),
      ),
    });
    const blocked = result.externalLinks.filter((entry) => entry.error === BLOCKED_MESSAGE);
    expect(blocked).toHaveLength(4);
    expect(
      site?.requests.some((request) =>
        /169\.254|127\.0\.0\.1|10\.0\.0\.5|intranet\.local/.test(request.url),
      ),
    ).toBe(false);
  });

  it('does not follow a redirect to a private address', async () => {
    const result = await run({
      '/': html(link('/jump')),
      '/jump': redirect('http://127.0.0.1/admin'),
    });
    const jump = result.pages.find((page) => page.url.endsWith('/jump'));
    expect(jump?.error).toBe(BLOCKED_MESSAGE);
    expect(jump?.status).toBe(0);
    expect(site?.requests.some((request) => request.url.includes('127.0.0.1'))).toBe(false);
  });

  it('allows private addresses when the audited site itself is private', async () => {
    site = await startTestSite(canonicalSite({ '/': html('Local site') }, 'localhost'));
    const result = await crawl({
      input: 'localhost',
      pages: 5,
      delayMs: 0,
      concurrency: 1,
      version: '1',
      fetchImpl: site.fetchImpl,
      tlsProbe: () => Promise.resolve(goodTls({ host: 'localhost' })),
    });
    expect(result.pages[0]?.status).toBe(200);
  });
});
