import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const serverEntry = fileURLToPath(new URL('../../bin/crucible-mcp.mjs', import.meta.url));

const STATIC_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Crucible integration target</title></head>
  <body style="margin:0;background:#0e1117;color:#fafafa;font-family:sans-serif;">
    <main style="padding:48px;">
      <h1 style="margin:0 0 24px 0;">Crucible — integration target</h1>
      <p style="font-size:18px;line-height:1.5;max-width:520px;">
        This page exists only so the MCP integration test has a deterministic pixel target.
        If you can read this, the Playwright driver navigated successfully.
      </p>
      <div style="width:320px;height:80px;background:#ff5a5f;"></div>
    </main>
  </body>
</html>`;

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(STATIC_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function parseResult(result) {
  expect(result.content?.[0]?.type).toBe('text');
  return JSON.parse(result.content[0].text);
}

describe('crucible MCP server — stdio integration', () => {
  let httpServer;
  let targetUrl;
  let tmpRoot;
  let client;
  let transport;

  beforeAll(async () => {
    const started = await startStaticServer();
    httpServer = started.server;
    targetUrl = started.url;

    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'crucible-it-'));

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
        CRUCIBLE_BASELINE_ROOT: tmpRoot,
      },
      stderr: 'pipe',
    });

    client = new Client(
      { name: 'crucible-integration-test', version: '0.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    try { await client?.close(); } catch {}
    try { await transport?.close(); } catch {}
    await new Promise((resolve) => httpServer.close(() => resolve()));
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists all four tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['approve_baseline', 'compare_screenshots', 'navigate', 'screenshot_page']);
  });

  it('drives the full eyes flow: navigate → screenshot → compare (needs_review) → approve → compare (pass)', async () => {
    const navRes = parseResult(
      await client.callTool({
        name: 'navigate',
        arguments: { url: targetUrl, waitUntil: 'load' },
      }),
    );
    expect(navRes.ok).toBe(true);
    expect(navRes.status).toBe(200);

    const shotRes = parseResult(
      await client.callTool({
        name: 'screenshot_page',
        arguments: { fullPage: true },
      }),
    );
    expect(shotRes.ok).toBe(true);
    expect(shotRes.bytes).toBeGreaterThan(0);
    expect(typeof shotRes.pngBase64).toBe('string');
    expect(shotRes.pngBase64.length).toBeGreaterThan(100);

    const preCompare = parseResult(
      await client.callTool({
        name: 'compare_screenshots',
        arguments: { project: 'it', spec: 'target-page' },
      }),
    );
    expect(preCompare.verdict).toBe('needs_review');
    expect(preCompare.reason).toBe('no_baseline');

    const approveRes = parseResult(
      await client.callTool({
        name: 'approve_baseline',
        arguments: { project: 'it', spec: 'target-page', note: 'initial' },
      }),
    );
    expect(approveRes.ok).toBe(true);
    expect(approveRes.pngPath).toContain(tmpRoot);
    expect(approveRes.meta.note).toBe('initial');

    const postCompare = parseResult(
      await client.callTool({
        name: 'compare_screenshots',
        arguments: { project: 'it', spec: 'target-page' },
      }),
    );
    expect(postCompare.verdict).toBe('pass');
    expect(postCompare.matchScore).toBe(1);
    expect(postCompare.diffPixels).toBe(0);
  }, 60_000);

  it('rejects path-traversal project names at the baseline boundary', async () => {
    const result = await client.callTool({
      name: 'approve_baseline',
      arguments: { project: '..', spec: 'x', pngBase64: Buffer.from([1, 2, 3]).toString('base64') },
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text || '').toMatch(/project/i);
  });
});
