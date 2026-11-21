import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_IMPLEMENTED_MESSAGE } from '../src/cli/commands/context.js';
import type { Io } from '../src/cli/io.js';
import { COMMANDS, PARAMS } from '../src/cli/params.js';
import { run } from '../src/cli/run.js';

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

describe('run', () => {
  it('prints help and exits 0', async () => {
    const output = capture();
    expect(await run(['--help'], output.io, NO_ENV)).toBe(0);
    expect(output.out()).toContain('Usage:');
    expect(output.err()).toBe('');
  });

  it('prints the package version', async () => {
    const output = capture();
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(await run(['--version'], output.io, NO_ENV)).toBe(0);
    expect(output.out().trim()).toBe(manifest.version);
  });

  it.each([
    [['example.com']],
    [['example.com', '--pages', '10', '--only', 'seo']],
    [['init']],
    [['doctor']],
    [['fix']],
    [['verify', 'T-014']],
    [['recheck']],
    [['compare', 'a', 'b']],
    [['list']],
  ])('exits 2 with the not implemented message for %j', async (argv) => {
    const output = capture();
    expect(await run(argv, output.io, NO_ENV)).toBe(2);
    expect(output.err()).toBe(`${NOT_IMPLEMENTED_MESSAGE}\n`);
  });

  it('exits 1 on invalid input without running the command', async () => {
    const output = capture();
    expect(await run(['example.com', '--pages', 'x'], output.io, NO_ENV)).toBe(1);
    expect(output.err()).toContain('Error: --pages expects a whole number');
    expect(output.err()).not.toContain(NOT_IMPLEMENTED_MESSAGE);
  });

  it('exits 1 when no domain is given', async () => {
    const output = capture();
    expect(await run([], output.io, NO_ENV)).toBe(1);
    expect(output.err()).toContain('A domain is required');
  });

  it('exits 1 when an explicit config file is missing', async () => {
    const output = capture();
    expect(await run(['example.com', '--config', 'missing.json'], output.io, NO_ENV)).toBe(1);
    expect(output.err()).toContain('Config file not found');
  });
});

describe('PSI_API_KEY', () => {
  const secret = 'AIzaSy-test-secret-0123456789';
  const env: NodeJS.ProcessEnv = { PSI_API_KEY: secret };

  it.each([
    [['--help']],
    [['--version']],
    [['example.com']],
    [['doctor']],
    [['example.com', '--verbose']],
    [['example.com', '--engine', secret]],
    [['example.com', `--${secret}`]],
    [['example.com', '--lang', secret]],
    [['example.com', '--config', secret]],
    [['verify']],
  ])('is never printed for %j', async (argv) => {
    const output = capture();
    await run(argv, output.io, env);
    expect(output.out()).not.toContain(secret);
    expect(output.err()).not.toContain(secret);
  });

  it('redacts the key when a user passes it by mistake', async () => {
    const output = capture();
    await run(['example.com', '--engine', secret], output.io, env);
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
