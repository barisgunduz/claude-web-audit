import { canonicalSite, html, redirect, type Route, type TestHandler } from './test-site.js';

const GOOD_HEAD = (path: string, withCanonical = true, title?: string): string =>
  [
    `<title>${title ?? `Example page ${path === '/' ? 'home' : path.slice(1)} with a good title`}</title>`,
    '<meta name="description" content="A description of this page that is long enough to be useful in search results and short enough to fit.">',
    ...(withCanonical ? [`<link rel="canonical" href="https://example.test${path}">`] : []),
    ...['title', 'description', 'image', 'url'].map(
      (tag) => `<meta property="og:${tag}" content="x">`,
    ),
    '<meta name="twitter:card" content="summary">',
    '<link rel="icon" href="/favicon.ico">',
  ].join('');

const SHARED_TITLE = 'Shared title for two pages in the test';

const filler = (seed: string): string =>
  `<p>${Array.from({ length: 320 }, (_, index) => `${seed}${index}`).join(' ')}</p>`;

function page(
  path: string,
  body: string,
  extraHead = '',
  withCanonical = true,
  title?: string,
): Route {
  return html(
    `<main><h1>${path}</h1>${body}${filler(path.replace(/\W/g, ''))}</main>`,
    GOOD_HEAD(path, withCanonical, title) + extraHead,
  );
}

export interface DefectOptions {
  soft404?: boolean;
  llmsTxt?: string | undefined;
}

/** A small site with known defects. The integration test asserts the exact findings. */
export function defectSite(options: DefectOptions = {}): TestHandler {
  const routes: Record<string, Route> = {
    '/': page(
      '/',
      [
        '<a href="/about">Click here</a>',
        '<a href="/old-page">Old</a>',
        '<a href="/broken">Broken</a>',
        '<a href="/chain-a">Chain</a>',
        '<a href="/loop-a">Loop</a>',
        '<a href="/duplicate-1">One</a>',
        '<a href="/duplicate-2">Two</a>',
        '<a href="/mixed">Mixed</a>',
        '<a href="/jsonld-bad">Structured</a>',
        '<a href="/private/page">Private</a>',
        '<a href="http://example.test/about">About over http</a>',
        '<a href="mailto:not-an-address">Mail</a>',
        '<a href="#">Hash</a>',
        '<a href="javascript:void(0)">Script</a>',
        '<a href="https://ext.example.net/ok">External</a>',
        '<a href="https://ext.example.net/missing">Missing external</a>',
      ].join(''),
    ),
    '/about': page('/about', '<a href="/">Home</a>', '', false), // no canonical on purpose
    '/old-page': redirect('https://example.test/about'),
    '/chain-a': redirect('https://example.test/chain-b'),
    '/chain-b': redirect('https://example.test/chain-c'),
    '/chain-c': redirect('https://example.test/chain-d'),
    '/chain-d': redirect('https://example.test/final'),
    '/final': page('/final', '<a href="/">Home</a>'),
    '/loop-a': redirect('https://example.test/loop-b'),
    '/loop-b': redirect('https://example.test/loop-a'),
    '/duplicate-1': page('/duplicate-1', '<a href="/">Home</a>', '', true, SHARED_TITLE),
    '/duplicate-2': page('/duplicate-2', '<a href="/">Home</a>', '', true, SHARED_TITLE),
    '/mixed': page(
      '/mixed',
      '<a href="/">Home</a><script src="http://example.test/app.js"></script><img src="http://example.test/a.png" alt="a" width="1" height="1">',
    ),
    '/jsonld-bad': page(
      '/jsonld-bad',
      '<a href="/">Home</a>',
      '<script type="application/ld+json">{ not json</script>',
    ),
    '/orphan': page('/orphan', ''),
    '/robots.txt': {
      headers: { 'content-type': 'text/plain' },
      body: [
        'User-agent: *',
        'Disallow: /private/',
        'Content-Signal: search=yes, ai-train=no',
        '',
        'User-agent: GPTBot',
        'Disallow: /',
        '',
        'User-agent: OAI-SearchBot',
        'Disallow: /',
        '',
        'Sitemap: https://example.test/sitemap.xml',
      ].join('\n'),
    },
    '/sitemap.xml': {
      headers: { 'content-type': 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
        '/',
        '/about',
        '/orphan',
        '/gone',
        '/old-page',
      ]
        .map(
          (path) =>
            `<url><loc>https://example.test${path}</loc><lastmod>2026-11-01</lastmod></url>`,
        )
        .join('')}</urlset>`,
    },
  };
  if (options.llmsTxt !== undefined) {
    routes['/llms.txt'] = { headers: { 'content-type': 'text/plain' }, body: options.llmsTxt };
  }
  const site = canonicalSite(routes);
  return async (request) => {
    const { url } = request;
    if (url.hostname === 'ext.example.net')
      return { status: url.pathname === '/missing' ? 404 : 200 };
    if (options.soft404 && url.pathname.startsWith('/cwa-404-')) return html('<p>Home</p>');
    return site(request);
  };
}
