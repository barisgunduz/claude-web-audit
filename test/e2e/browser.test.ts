import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChrome, launchChrome } from '../../src/engines/chrome.js';
import { LocalLighthouseEngine } from '../../src/engines/lighthouse.js';
import { measureLab } from '../../src/engines/measure.js';
import { createAxeRunner } from '../../src/modules/a11y/axe-runner.js';

/**
 * These tests start a real Chrome and run Lighthouse and axe-core against a local page.
 * They are skipped unless CWA_E2E=1 is set, and they need Chrome on this machine.
 */
const enabled = process.env.CWA_E2E === '1';

const DEFECT_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Defects</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<main>
  <h1>Page with known accessibility problems</h1>
  <img src="/pixel.png">
  <p style="color:#ccc;background:#fff">Pale text that has too little contrast against its background.</p>
  <button></button>
</main>
</body>
</html>`;

const CLEAN_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Clean page</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Clean page</h1><p style="color:#111;background:#fff">Text with strong contrast.</p><button>Save</button></main></body>
</html>`;

let server: Server;
let base = '';
const hits: string[] = [];

async function chromeProfiles(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('cwa-chrome-'));
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

describe.skipIf(!enabled)('browser tests (CWA_E2E=1)', () => {
  let chromePath = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits.push(request.url ?? '');
      if (request.url === '/pixel.png') {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            'base64',
          ),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(request.url === '/clean' ? CLEAN_PAGE : DEFECT_PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const lookup = await findChrome({ env: process.env });
    if (!lookup.path)
      throw new Error('CWA_E2E=1 needs Chrome. Set CHROME_PATH or install Google Chrome.');
    chromePath = lookup.path;
  }, 90_000);

  afterAll(async () => {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  it('runs local Lighthouse on mobile and desktop with its own presets', async () => {
    const before = await chromeProfiles();
    const engine = new LocalLighthouseEngine({ chromePath });
    const mobile = await engine.measure(`${base}/clean`, 'mobile');
    const desktop = await engine.measure(`${base}/clean`, 'desktop');
    expect(mobile).toMatchObject({ engine: 'lighthouse', formFactor: 'mobile' });
    expect(desktop).toMatchObject({ engine: 'lighthouse', formFactor: 'desktop' });
    expect(mobile.throttling).toContain('simulate');
    expect(mobile.throttling).toContain('CPU slowdown 4x');
    expect(mobile.lighthouseVersion).toMatch(/^\d+\.\d+\.\d+/);
    for (const result of [mobile, desktop]) {
      expect(result.categories.performance).toBeGreaterThan(0);
      expect(result.categories.accessibility).not.toBeNull();
      expect(result.metrics.lcp?.value).toBeGreaterThan(0);
      expect(result.metrics.cls).not.toBeNull();
      expect(result.transferBytes).toBeGreaterThan(0);
    }
    // Every run closed its Chrome and deleted its temporary profile.
    expect(await chromeProfiles()).toEqual(before);
  }, 180_000);

  it('measures through the same code path as an audit, with the median of several runs', async () => {
    const outcome = await measureLab({
      urls: [`${base}/clean`],
      strategies: ['mobile'],
      runs: 2,
      setting: 'lighthouse',
      hasKey: false,
      hasChrome: true,
      local: new LocalLighthouseEngine({ chromePath }),
    });
    expect(outcome.status).toBe('measured');
    expect(outcome.pages[0]?.runs.scores).toHaveLength(2);
    expect(outcome.method).toMatchObject({
      enginesUsed: ['lighthouse'],
      fallbacks: 0,
      runsPerPage: 2,
    });
  }, 240_000);

  it('finds the planted problems with axe-core and leaves the clean page alone', async () => {
    const before = await chromeProfiles();
    const runner = createAxeRunner({
      chromePath,
      userAgent: 'claude-web-audit/test',
      delayMs: 0,
      allowPrivate: true,
      settleMs: 200,
    });
    const run = await runner.run([`${base}/`, `${base}/clean`]);
    expect(run.axeVersion).toMatch(/^\d+\.\d+/);
    const [defects, clean] = run.pages;
    const ids = defects?.violations.map((violation) => violation.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(['image-alt', 'button-name', 'html-has-lang']));
    const alt = defects?.violations.find((violation) => violation.id === 'image-alt');
    expect(alt?.impact).toBe('critical');
    expect(alt?.helpUrl).toContain('dequeuniversity.com');
    expect(alt?.selectors[0]).toContain('img');
    expect(clean?.error).toBeUndefined();
    expect(clean?.violations).toEqual([]);
    expect(await chromeProfiles()).toEqual(before);
  }, 120_000);

  it('blocks requests to private addresses unless the audited site is private', async () => {
    hits.length = 0;
    const runner = createAxeRunner({
      chromePath,
      userAgent: 'claude-web-audit/test',
      delayMs: 0,
      allowPrivate: false,
      settleMs: 100,
    });
    const run = await runner.run([`${base}/`]);
    expect(run.pages[0]?.error).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(hits).toEqual([]);
  }, 120_000);

  it('closes Chrome when the signal is aborted', async () => {
    const controller = new AbortController();
    const chrome = await launchChrome({ chromePath, signal: controller.signal });
    expect(await portOpen(chrome.port)).toBe(true);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await portOpen(chrome.port)).toBe(false);
    await chrome.close();
  }, 60_000);
});
