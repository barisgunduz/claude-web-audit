import { describe, expect, it } from 'vitest';
import {
  contentSignalsFor,
  groupsFor,
  isAllowed,
  matchesPattern,
  MAX_PATTERN_LENGTH,
  parseRobots,
} from '../../src/crawler/robots.js';

describe('parseRobots', () => {
  it('groups consecutive user-agent lines and reads rules and sitemaps', () => {
    const parsed = parseRobots(
      [
        'User-agent: a',
        'User-agent: b',
        'Disallow: /x',
        'Allow: /x/y',
        '',
        'User-agent: *',
        'Disallow:',
        'Sitemap: https://e.test/s.xml',
      ].join('\n'),
    );
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0]?.agents).toEqual(['a', 'b']);
    expect(parsed.groups[0]?.rules).toEqual([
      { type: 'disallow', path: '/x' },
      { type: 'allow', path: '/x/y' },
    ]);
    expect(parsed.sitemaps).toEqual(['https://e.test/s.xml']);
    expect(parsed.issues).toEqual([]);
  });

  it('reports syntax problems', () => {
    const parsed = parseRobots(
      [
        'Disallow: /early',
        'User-agent: *',
        'this is not a directive',
        'Colour: red',
        'Crawl-delay: soon',
      ].join('\n'),
    );
    expect(parsed.issues.map((issue) => issue.reason)).toEqual([
      'Rule before any user-agent line',
      'Not a "field: value" line',
      'Unknown directive "colour"',
      'Crawl-delay is not a number',
    ]);
  });

  it('ignores comments, a byte order mark and Windows line endings', () => {
    const parsed = parseRobots('﻿User-agent: * # everyone\r\nDisallow: /a # no\r\n');
    expect(parsed.groups[0]?.rules).toEqual([{ type: 'disallow', path: '/a' }]);
  });

  it('parses Content-Signal inside a group and at file level', () => {
    const parsed = parseRobots(
      [
        'Content-Signal: search=yes',
        'User-agent: *',
        'Content-Signal: ai-train=no, ai-input=yes',
      ].join('\n'),
    );
    expect(parsed.fileContentSignals).toEqual({ search: 'yes' });
    expect(parsed.groups[0]?.contentSignals).toEqual({ 'ai-train': 'no', 'ai-input': 'yes' });
    expect(contentSignalsFor(parsed)).toEqual({
      search: 'yes',
      'ai-train': 'no',
      'ai-input': 'yes',
    });
  });

  it('reads Crawl-delay', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 5').groups[0]?.crawlDelay).toBe(5);
  });
});

describe('isAllowed', () => {
  const parsed = parseRobots(
    [
      'User-agent: *',
      'Disallow: /private/',
      'Disallow: /*.pdf$',
      'Allow: /private/public',
      '',
      'User-agent: GPTBot',
      'Disallow: /',
    ].join('\n'),
  );

  it('uses the specific group for a named bot and the star group for others', () => {
    expect(isAllowed(parsed, 'GPTBot', '/')).toBe(false);
    expect(isAllowed(parsed, 'gptbot', '/page')).toBe(false);
    expect(isAllowed(parsed, 'claude-web-audit', '/page')).toBe(true);
    expect(groupsFor(parsed, 'other')[0]?.agents).toEqual(['*']);
  });

  it('applies the longest matching rule, and Allow wins a tie', () => {
    expect(isAllowed(parsed, 'x', '/private/secret')).toBe(false);
    expect(isAllowed(parsed, 'x', '/private/public/page')).toBe(true);
    const tie = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a');
    expect(isAllowed(tie, 'x', '/a')).toBe(true);
  });

  it('supports wildcards and the end anchor', () => {
    expect(isAllowed(parsed, 'x', '/files/report.pdf')).toBe(false);
    expect(isAllowed(parsed, 'x', '/files/report.pdf?download=1')).toBe(true);
  });

  it('allows everything for an empty Disallow and for a missing file', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:'), 'x', '/a')).toBe(true);
    expect(isAllowed(parseRobots(''), 'x', '/a')).toBe(true);
  });

  it('does not treat regular expression characters in a rule as special', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a+b(1)');
    expect(isAllowed(rules, 'x', '/a+b(1)')).toBe(false);
    expect(isAllowed(rules, 'x', '/aab')).toBe(true);
  });
});

describe('matchesPattern', () => {
  it.each([
    ['/a', '/a', true],
    ['/a', '/ab/c', true],
    ['/a', '/b', false],
    ['/a$', '/a', true],
    ['/a$', '/ab', false],
    ['/*.pdf', '/x/y.pdf', true],
    ['/*.pdf$', '/x/y.pdf?x=1', false],
    ['/a*b*c', '/a1b2c3', true],
    ['/a*b*c', '/a1c2b3', false],
    ['*', '/anything', true],
    ['/a+b(1)', '/a+b(1)', true],
    ['/a.b', '/aXb', false],
    ['/a*', '/a', true],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected);
  });

  it('does not slow down on a hostile pattern with many wildcards', () => {
    const hostile = `/${'a*'.repeat(200)}b`;
    const text = `/${'a'.repeat(4000)}`;
    const started = performance.now();
    expect(matchesPattern(hostile, text)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('collapses repeated stars and ignores rules that are too long', () => {
    const parsed = parseRobots(
      `User-agent: *\nDisallow: /a***b\nDisallow: /${'x'.repeat(MAX_PATTERN_LENGTH + 1)}`,
    );
    expect(parsed.groups[0]?.rules).toEqual([{ type: 'disallow', path: '/a*b' }]);
    expect(parsed.issues[0]?.reason).toContain('too long');
  });

  it('stays fast when a robots.txt is built to hurt', () => {
    const text = `User-agent: *\n${Array.from({ length: 2000 }, () => `Disallow: /${'a*'.repeat(60)}b`).join('\n')}`;
    const parsed = parseRobots(text);
    const started = performance.now();
    expect(isAllowed(parsed, 'x', `/${'a'.repeat(1500)}`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
