import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditDeps } from '../src/audit/deps.js';
import { NOT_IMPLEMENTED_MESSAGE } from '../src/cli/commands/context.js';
import type { Io } from '../src/cli/io.js';
import { COMMANDS, PARAMS } from '../src/cli/params.js';
import { run } from '../src/cli/run.js';
import { readFileSync } from 'node:fs';
import { fakeDns, goodTls, NOW } from './support/builders.js';
import { defectSite } from './support/defect-site.js';
import { startTestSite, type TestSite } from './support/test-site.js';

function capture(): { io: Io; out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
    },
    out: () => out,
    err: () => err,
  };
}

const NO_ENV: NodeJS.ProcessEnv = {};
let site: TestSite;
let folder: string;

beforeEach(async () => {
  site = await startTestSite(defectSite());
  folder = await mkdtemp(join(tmpdir(), 'cwa-cli-'));
});
afterEach(async () => {
  await site.close();
  await rm(folder, { recursive: true, force: true });
});

function deps(overrides: Partial<AuditDeps> = {}): AuditDeps {
  return {
    fetchImpl: site.fetchImpl,
    tlsProbe: () => Promise.resolve(goodTls()),
    dns: fakeDns({}),
    now: () => NOW,
    cwd: folder,
    ...overrides,
  };
}

describe('run', () => {
  it('prints help and exits 0', async () => {
    const output = capture();
    expect(await run(['--help'], output.io, NO_ENV, deps())).toBe(0);
    expect(output.out()).toContain('Usage:');
    expect(output.err()).toBe('');
  });

  it('prints the package version', async () => {
    const output = capture();
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(await run(['--version'], output.io, NO_ENV, deps())).toBe(0);
    expect(output.out().trim()).toBe(manifest.version);
  });

  it.each([
    [['init']],
    [['doctor']],
    [['fix']],
    [['verify', 'T-014']],
    [['recheck']],
    [['compare', 'a', 'b']],
    [['list']],
  ])('exits 2 with the not implemented message for %j', async (argv) => {
    const output = capture();
    expect(await run(argv, output.io, NO_ENV, deps())).toBe(2);
    expect(output.err()).toBe(`${NOT_IMPLEMENTED_MESSAGE}\n`);
    expect(site.requests).toEqual([]);
  });

  it('exits 1 on invalid input before it touches the network', async () => {
    const output = capture();
    expect(await run(['example.test', '--pages', 'x'], output.io, NO_ENV, deps())).toBe(1);
    expect(output.err()).toContain('Error: --pages expects a whole number');
    expect(site.requests).toEqual([]);
  });

  it('exits 1 when no domain is given', async () => {
    const output = capture();
    expect(await run([], output.io, NO_ENV, deps())).toBe(1);
    expect(output.err()).toContain('A domain is required');
  });

  it('exits 1 when an explicit config file is missing', async () => {
    const output = capture();
    expect(
      await run(
        ['example.test', '--config', join(folder, 'missing.json')],
        output.io,
        NO_ENV,
        deps(),
      ),
    ).toBe(1);
    expect(output.err()).toContain('Config file not found');
  });

  it('exits 1 with a clear message for an input that is not a domain', async () => {
    const output = capture();
    expect(await run(['not a domain'], output.io, NO_ENV, deps())).toBe(1);
    expect(output.err()).toContain('Not a valid domain');
  });
});

describe('audit command', () => {
  const read = async (path: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const file = (): string => join(folder, 'audits', 'example.test', '2026-11-21', 'audit.json');

  it('crawls, writes audit.json and prints a short summary', async () => {
    const output = capture();
    expect(await run(['example.test', '--delay', '0'], output.io, NO_ENV, deps())).toBe(0);
    const lines = output.out().trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines[0]).toMatch(/^Audit of example\.test: \d+ pages crawled/);
    expect(lines.at(-1)).toBe(`Output: ${file()}`);
    expect(output.out()).toMatch(/Findings: \d+ critical, \d+ important, \d+ improvement/);
    expect(output.out()).toContain('Not measured: speed, a11y');

    const audit = await read(file());
    expect(audit).toMatchObject({
      schemaVersion: '0-interim',
      domain: 'example.test',
      tool: { name: 'claude-web-audit' },
    });
    const modules = audit.modules as {
      module: string;
      findings: { code: string; message: string }[];
    }[];
    expect(modules.map((entry) => entry.module)).toEqual([
      'links',
      'ssl',
      'headers',
      'seo',
      'content',
      'speed',
      'a11y',
      'email',
      'ai',
    ]);
    const first = modules[0]?.findings[0];
    expect(first?.message).not.toMatch(/\{\w+\}/);
  });

  it('keeps page bodies, headers and cookies out of audit.json', async () => {
    await run(['example.test', '--delay', '0'], capture().io, NO_ENV, deps());
    const text = await readFile(file(), 'utf8');
    expect(text).not.toContain('<html');
    expect(text).not.toContain('set-cookie');
  });

  it('respects --only, --skip and --pages', async () => {
    await run(
      ['example.test', '--only', 'seo,links', '--skip', 'links', '--pages', '3'],
      capture().io,
      NO_ENV,
      deps(),
    );
    const audit = await read(file());
    expect((audit.modules as { module: string }[]).map((entry) => entry.module)).toEqual(['seo']);
    expect((audit.crawl as { pages: unknown[] }).pages).toHaveLength(3);
  });

  it('respects --out and --delay', async () => {
    const waits: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    };
    expect(
      await run(
        ['example.test', '--out', 'reports', '--delay', '500', '--pages', '2'],
        capture().io,
        NO_ENV,
        deps({ sleep }),
      ),
    ).toBe(0);
    await expect(
      read(join(folder, 'reports', 'example.test', '2026-11-21', 'audit.json')),
    ).resolves.toBeDefined();
    expect(waits.length).toBeGreaterThan(0);
  });

  it('reads --config and lets the command line win', async () => {
    const config = join(folder, 'custom.json');
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        config,
        JSON.stringify({
          domain: 'example.test',
          pages: 2,
          concurrency: 1,
          modules: ['seo', 'ssl'],
        }),
      ),
    );
    await run(['--config', config, '--delay', '0'], capture().io, NO_ENV, deps());
    const fromConfig = await read(file());
    expect((fromConfig.settings as { modules: string[]; pages: number }).modules).toEqual([
      'seo',
      'ssl',
    ]);
    expect((fromConfig.crawl as { pages: unknown[] }).pages).toHaveLength(2);

    await run(
      ['--config', config, '--pages', '4', '--only', 'ssl', '--delay', '0'],
      capture().io,
      NO_ENV,
      deps(),
    );
    const overridden = await read(file());
    expect((overridden.settings as { modules: string[]; pages: number }).modules).toEqual(['ssl']);
    expect((overridden.crawl as { pages: unknown[] }).pages).toHaveLength(4);
  });

  it('prints progress only with --verbose', async () => {
    const quiet = capture();
    await run(['example.test', '--pages', '2', '--delay', '0'], quiet.io, NO_ENV, deps());
    expect(quiet.err()).toBe('');
    const verbose = capture();
    await run(
      ['example.test', '--pages', '2', '--delay', '0', '--verbose'],
      verbose.io,
      NO_ENV,
      deps(),
    );
    expect(verbose.err()).toContain('Running module links');
  });

  it('exits 1 and says why when the site cannot be reached', async () => {
    const output = capture();
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(
      await run(['example.test'], output.io, NO_ENV, deps({ fetchImpl, timeoutMs: 200 })),
    ).toBe(1);
    expect(output.err()).toContain('Could not reach example.test');
  });
});

describe('PSI_API_KEY', () => {
  const secret = 'TEST_FAKE_PSI_KEY_0123456789';
  const env: NodeJS.ProcessEnv = { PSI_API_KEY: secret };

  it.each([
    [['--help']],
    [['--version']],
    [['doctor']],
    [['verify']],
    [['example.test', '--verbose', '--pages', '2', '--delay', '0']],
    [['example.test', '--engine', secret]],
    [['example.test', `--${secret}`]],
    [['example.test', '--lang', secret]],
    [['example.test', '--config', secret]],
  ])('is never printed or written for %j', async (argv) => {
    const output = capture();
    await run(argv, output.io, env, deps());
    expect(output.out()).not.toContain(secret);
    expect(output.err()).not.toContain(secret);
  });

  it('does not read the key and does not write it to audit.json', async () => {
    await run(['example.test', '--pages', '2', '--delay', '0'], capture().io, env, deps());
    const text = await readFile(
      join(folder, 'audits', 'example.test', '2026-11-21', 'audit.json'),
      'utf8',
    );
    expect(text).not.toContain(secret);
  });

  it('redacts the key when a user passes it by mistake', async () => {
    const output = capture();
    await run(['example.test', '--engine', secret], output.io, env, deps());
    expect(output.err()).toContain('[redacted]');
  });
});

describe('docs/parameters.md', () => {
  const docs = readFileSync('docs/parameters.md', 'utf8');

  it('documents every flag', () => {
    for (const spec of PARAMS) expect(docs).toContain(`--${spec.flag}`);
  });

  it('documents every subcommand', () => {
    for (const command of COMMANDS) expect(docs).toContain(command.usage);
  });
});
