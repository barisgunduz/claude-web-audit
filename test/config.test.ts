import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  loadConfigFile,
  resolveSettings,
  validateConfig,
} from '../src/config/index.js';
import { ConfigError } from '../src/config/validate.js';
import { MODULE_NAMES } from '../src/modules/names.js';

describe('validateConfig', () => {
  it('accepts an empty object and a full example', () => {
    expect(validateConfig({})).toEqual({});
    const full = {
      domain: 'example.com',
      pages: 10,
      prepared_by: '',
      report_language: 'tr',
      engine: 'psi',
      strategy: 'mobile',
      runs: 1,
      delay: 0,
      concurrency: 8,
      thinContentWords: 150,
      email: { dkimSelectors: ['google', 'selector1'] },
      weights: { speed: 30 },
      modules: ['seo'],
      outputs: { card: false, social: true, pdf: true, fixPlan: false },
    };
    expect(validateConfig(full)).toEqual(full);
  });

  it.each([
    [null, 'JSON object'],
    [[], 'JSON object'],
    [{ domain: '' }, '"domain"'],
    [{ pages: 0 }, '"pages"'],
    [{ pages: 1.5 }, '"pages"'],
    [{ engine: 'chrome' }, '"engine"'],
    [{ strategy: 'tablet' }, '"strategy"'],
    [{ runs: 99 }, '"runs"'],
    [{ delay: -1 }, '"delay"'],
    [{ concurrency: 0 }, '"concurrency"'],
    [{ concurrency: 9 }, '"concurrency"'],
    [{ concurrency: 4.5 }, '"concurrency"'],
    [{ thinContentWords: 0 }, '"thinContentWords"'],
    [{ email: 'x' }, '"email" must be an object'],
    [{ email: { dkimSelectors: ['bad selector'] } }, 'dkimSelectors'],
    [{ email: { dkimSelectors: 'google' } }, 'dkimSelectors'],
    [{ email: { mx: true } }, 'Unknown field "mx"'],
    [{ report_language: 'english!' }, '"report_language"'],
    [{ weights: { speed: -1 } }, 'Weight for "speed"'],
    [{ weights: { colour: 1 } }, 'Unknown field "colour"'],
    [{ modules: [] }, '"modules"'],
    [{ modules: ['seo', 'nope'] }, '"modules"'],
    [{ outputs: { card: 'yes' } }, '"outputs.card"'],
    [{ outputs: { gif: true } }, 'Unknown field "gif"'],
    [{ unknown: 1 }, 'Unknown field "unknown"'],
  ])('rejects %j', (input, message) => {
    expect(() => validateConfig(input)).toThrow(ConfigError);
    expect(() => validateConfig(input)).toThrow(message);
  });

  it('points secrets to the environment', () => {
    expect(() => validateConfig({ psi_api_key: 'x' })).toThrow('PSI_API_KEY in the environment');
  });

  it('reports every problem at once', () => {
    try {
      validateConfig({ pages: 0, runs: 0 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toHaveLength(2);
    }
  });
});

describe('loadConfigFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cwa-config-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty config for a missing optional file', async () => {
    expect(await loadConfigFile(join(dir, 'none.json'), false)).toEqual({});
  });

  it('fails for a missing required file', async () => {
    await expect(loadConfigFile(join(dir, 'none.json'), true)).rejects.toThrow('not found');
  });

  it('fails for invalid JSON without echoing the content', async () => {
    const path = join(dir, 'bad.json');
    await writeFile(path, '{ "psi": "super-secret-value" ');
    const error = await loadConfigFile(path, true).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain('not valid JSON');
    expect((error as ConfigError).message).not.toContain('super-secret-value');
  });

  it('loads and validates a file', async () => {
    const path = join(dir, 'cwa.config.json');
    await writeFile(path, JSON.stringify({ domain: 'example.com', pages: 20 }));
    expect(await loadConfigFile(path, true)).toEqual({ domain: 'example.com', pages: 20 });
  });
});

describe('resolveSettings merge order', () => {
  it('uses built-in defaults when nothing else is given', () => {
    const settings = resolveSettings({}, {}, 'example.com');
    expect(settings).toMatchObject({
      domain: 'example.com',
      pages: 150,
      preparedBy: '',
      language: 'en',
      engine: 'auto',
      strategy: 'both',
      runs: 3,
      delay: 250,
      out: './audits',
    });
    expect(settings.modules).toEqual([...MODULE_NAMES]);
    expect(settings.weights).toEqual(DEFAULT_WEIGHTS);
    expect(settings.outputs).toEqual({ card: true, social: false, pdf: true, fixPlan: true });
  });

  it('defaults the new fields and takes them from the config file', () => {
    const defaults = resolveSettings({}, {}, 'example.com');
    expect([defaults.concurrency, defaults.thinContentWords, defaults.dkimSelectors]).toEqual([
      4,
      300,
      [],
    ]);
    const custom = resolveSettings(
      { concurrency: 2, thinContentWords: 120, email: { dkimSelectors: ['s1'] } },
      {},
      'example.com',
    );
    expect([custom.concurrency, custom.thinContentWords, custom.dkimSelectors]).toEqual([
      2,
      120,
      ['s1'],
    ]);
  });

  it('lets the config file override defaults', () => {
    const settings = resolveSettings(
      {
        pages: 40,
        prepared_by: 'From File',
        report_language: 'tr',
        runs: 1,
        weights: { speed: 50 },
        outputs: { card: false },
      },
      {},
      'example.com',
    );
    expect(settings).toMatchObject({ pages: 40, preparedBy: 'From File', language: 'tr', runs: 1 });
    expect(settings.weights.speed).toBe(50);
    expect(settings.weights.seo).toBe(DEFAULT_WEIGHTS.seo);
    expect(settings.outputs.card).toBe(false);
  });

  it('lets the command line override the config file', () => {
    const settings = resolveSettings(
      { domain: 'file.com', pages: 40, prepared_by: 'From File', outputs: { card: false } },
      { pages: 10, by: 'From CLI', card: true },
      'cli.com',
    );
    expect(settings).toMatchObject({ domain: 'cli.com', pages: 10, preparedBy: 'From CLI' });
    expect(settings.outputs.card).toBe(true);
  });

  it('lets an empty --by win over the config file', () => {
    const settings = resolveSettings({ prepared_by: 'From File' }, { by: '' }, 'example.com');
    expect(settings.preparedBy).toBe('');
  });

  it('falls back to the config domain', () => {
    expect(resolveSettings({ domain: 'file.com' }, {}).domain).toBe('file.com');
  });

  it('requires a domain from somewhere', () => {
    expect(() => resolveSettings({}, {})).toThrow('A domain is required');
  });

  it('applies --only over the config modules, then --skip', () => {
    const config = { modules: ['seo', 'ssl'] as const };
    expect(resolveSettings({ modules: [...config.modules] }, {}, 'a.com').modules).toEqual([
      'seo',
      'ssl',
    ]);
    expect(
      resolveSettings({ modules: ['seo'] }, { only: ['speed', 'ai'] }, 'a.com').modules,
    ).toEqual(['speed', 'ai']);
    expect(resolveSettings({}, { skip: ['email', 'ai'] }, 'a.com').modules).not.toContain('email');
  });

  it('fails when no module is left', () => {
    expect(() => resolveSettings({}, { only: ['seo'], skip: ['seo'] }, 'a.com')).toThrow(
      'No modules are left',
    );
  });
});
