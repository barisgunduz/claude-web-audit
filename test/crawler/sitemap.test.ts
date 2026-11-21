import { describe, expect, it } from 'vitest';
import { parseSitemapXml } from '../../src/crawler/sitemap.js';

const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

describe('parseSitemapXml', () => {
  it('reads a urlset with lastmod', () => {
    const parsed = parseSitemapXml(
      `<?xml version="1.0"?><urlset ${NS}><url><loc>https://e.test/a</loc><lastmod>2026-01-01</lastmod></url><url><loc> https://e.test/b </loc></url></urlset>`,
    );
    expect(parsed).toEqual({
      kind: 'urlset',
      entries: [{ loc: 'https://e.test/a', lastmod: '2026-01-01' }, { loc: 'https://e.test/b' }],
    });
  });

  it('reads an index', () => {
    const parsed = parseSitemapXml(
      `<sitemapindex ${NS}><sitemap><loc>https://e.test/s1.xml</loc></sitemap></sitemapindex>`,
    );
    expect(parsed.kind).toBe('index');
    expect(parsed.entries).toEqual([{ loc: 'https://e.test/s1.xml' }]);
  });

  it('accepts a stylesheet instruction, comments and a byte order mark before the root, as sitemap plugins write them', () => {
    const header =
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="//e.test/main-sitemap.xsl"?>\n<!-- generated -->\n';
    expect(
      parseSitemapXml(
        `${header}<sitemapindex ${NS}><sitemap><loc>https://e.test/p.xml</loc></sitemap></sitemapindex>`,
      ).kind,
    ).toBe('index');
    expect(parseSitemapXml(`${header}<urlset ${NS}></urlset>`).kind).toBe('urlset');
  });

  it.each([
    ['html', '<html><body>nope</body></html>'],
    ['empty', ''],
    ['text', 'just words'],
    ['an unclosed instruction', '<?xml version="1.0"'],
    ['an unclosed comment', '<!-- <urlset></urlset>'],
    ['another root', '<rss><channel/></rss>'],
  ])('rejects %s', (_name, xml) => {
    expect(parseSitemapXml(xml)).toMatchObject({ kind: 'invalid', entries: [] });
  });

  it('skips entries without a loc', () => {
    expect(
      parseSitemapXml(
        `<urlset ${NS}><url><lastmod>2026-01-01</lastmod></url><url><loc/></url></urlset>`,
      ).entries,
    ).toEqual([]);
  });

  it('stays fast on a hostile file with thousands of unclosed comments', () => {
    const started = performance.now();
    expect(parseSitemapXml(`${'<!-- '.repeat(200_000)}<urlset>`).kind).toBe('invalid');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
