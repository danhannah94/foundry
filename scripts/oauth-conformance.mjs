#!/usr/bin/env node
/**
 * FND-E12-S12 — OAuth conformance probe.
 *
 * Runs against a deployed Foundry instance (staging or prod) and
 * validates that the OAuth surface behaves the way a third-party
 * client would expect per RFC 8414, 7591, 6749, 7636, and 9728. Meant
 * for the S12 pre-deploy checklist — the in-repo E2E suite already
 * catches wiring regressions every CI push, but that suite validates
 * our server against *our own* understanding. This script validates
 * against the specs directly.
 *
 * Usage:
 *
 *   FOUNDRY_BASE_URL=https://foundry-claymore.fly.dev \
 *   FOUNDRY_DCR_TOKEN=<value> \
 *   node scripts/oauth-conformance.mjs
 *
 * Exits 0 on full pass, 1 on any failure. Each check prints a single
 * PASS/FAIL line with the RFC citation.
 */

import crypto from 'node:crypto';

const BASE_URL = (process.env.FOUNDRY_BASE_URL ?? '').replace(/\/$/, '');
const DCR_TOKEN = process.env.FOUNDRY_DCR_TOKEN ?? '';

if (!BASE_URL) {
  console.error('FOUNDRY_BASE_URL is required (e.g. https://foundry-claymore.fly.dev).');
  process.exit(2);
}
if (!DCR_TOKEN) {
  console.error('FOUNDRY_DCR_TOKEN is required to exercise the DCR endpoint.');
  process.exit(2);
}

// ─── Minimal assertion plumbing ─────────────────────────────────────────────

let failures = 0;

function pass(label) {
  console.log(`  \u001b[32mPASS\u001b[0m  ${label}`);
}

function fail(label, detail) {
  failures++;
  console.log(`  \u001b[31mFAIL\u001b[0m  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function skip(label, reason) {
  console.log(`  \u001b[33mSKIP\u001b[0m  ${label}`);
  if (reason) console.log(`        ${reason}`);
}

function section(name) {
  console.log(`\n\u001b[1m${name}\u001b[0m`);
}

function expect(cond, label, detail) {
  if (cond) pass(label);
  else fail(label, detail);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getJson(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, headers: res.headers, body: json, raw: text };
}

function form(body) {
  return new URLSearchParams(body).toString();
}

// ─── 1. AS metadata discovery (RFC 8414) ────────────────────────────────────

async function checkDiscovery() {
  section('RFC 8414 — Authorization Server Metadata');

  const r = await getJson('/.well-known/oauth-authorization-server');
  expect(r.status === 200, 'metadata endpoint returns 200', `got ${r.status}`);
  if (r.status !== 200) return null;

  const md = r.body ?? {};
  expect(md.issuer === BASE_URL, `issuer equals FOUNDRY_OAUTH_ISSUER (${BASE_URL})`, `got ${md.issuer}`);
  expect(typeof md.authorization_endpoint === 'string', 'authorization_endpoint is present');
  expect(typeof md.token_endpoint === 'string', 'token_endpoint is present');
  expect(typeof md.registration_endpoint === 'string', 'registration_endpoint is present (DCR support)');
  expect(
    Array.isArray(md.response_types_supported) && md.response_types_supported.includes('code'),
    'response_types_supported includes "code"'
  );
  expect(
    Array.isArray(md.grant_types_supported) &&
      md.grant_types_supported.includes('authorization_code') &&
      md.grant_types_supported.includes('refresh_token'),
    'grant_types_supported includes authorization_code + refresh_token'
  );
  expect(
    Array.isArray(md.code_challenge_methods_supported) &&
      md.code_challenge_methods_supported.includes('S256'),
    'code_challenge_methods_supported includes S256 (RFC 7636 §4.3)'
  );

  // RFC 9728 OAuth Protected Resource metadata — optional but nice to have
  const pr = await getJson('/.well-known/oauth-protected-resource');
  expect(
    pr.status === 200 || pr.status === 404,
    'protected-resource metadata responds (200 or 404)',
    `got ${pr.status}`
  );
  if (pr.status === 200 && pr.body) {
    expect(pr.body.resource === BASE_URL, 'protected-resource.resource matches issuer');
  }

  // Host-header independence — attacker-controlled Host must not change issuer.
  const hostile = await getJson('/.well-known/oauth-authorization-server', {
    headers: { Host: 'evil.attacker.example' },
  });
  expect(
    hostile.body?.issuer === BASE_URL,
    'issuer unchanged when Host header is spoofed (AC9)',
    `got ${hostile.body?.issuer}`
  );

  return md;
}

// ─── 2. Dynamic Client Registration (RFC 7591) ──────────────────────────────

async function checkDcr(metadata) {
  section('RFC 7591 — Dynamic Client Registration');

  if (!metadata?.registration_endpoint) {
    fail('registration_endpoint advertised in metadata');
    return null;
  }

  const validBody = {
    client_name: 'Conformance Probe',
    redirect_uris: ['https://claude.ai/oauth/callback'],
    client_type: 'autonomous',
  };

  // No bearer → 401 invalid_token
  const noBearer = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody),
  });
  expect(noBearer.status === 401, 'DCR without bearer → 401 (AC8)', `got ${noBearer.status}`);

  // Wrong bearer → 401
  const wrongBearer = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer wrong-token-value',
    },
    body: JSON.stringify(validBody),
  });
  expect(wrongBearer.status === 401, 'DCR with wrong bearer → 401');

  // Happy path
  const okRes = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DCR_TOKEN}`,
    },
    body: JSON.stringify(validBody),
  });
  const ok = await okRes.json().catch(() => null);
  expect(okRes.status === 201, 'DCR with valid bearer → 201', `got ${okRes.status}`);
  expect(typeof ok?.client_id === 'string', 'client_id returned');
  expect(typeof ok?.client_secret === 'string', 'client_secret returned');
  expect(ok?.client_name === validBody.client_name, 'client_name echoed');
  expect(
    Array.isArray(ok?.redirect_uris) && ok.redirect_uris[0] === validBody.redirect_uris[0],
    'redirect_uris echoed'
  );

  // Invalid redirect_uri (plain http, non-localhost)
  const badRedirect = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DCR_TOKEN}`,
    },
    body: JSON.stringify({ ...validBody, redirect_uris: ['http://not-localhost.example.com/cb'] }),
  });
  const badRedirectBody = await badRedirect.json().catch(() => null);
  expect(badRedirect.status === 400, 'DCR rejects plain http non-localhost redirect_uri');
  expect(
    badRedirectBody?.error === 'invalid_redirect_uri',
    'error code is "invalid_redirect_uri" (RFC 7591 §3.2.2)',
    `got ${badRedirectBody?.error}`
  );

  return ok;
}

// ─── 3. Authorize input validation (RFC 6749 §4.1 + RFC 7636) ──────────────

async function checkAuthorize(client) {
  section('RFC 6749 §4.1 + RFC 7636 — Authorization endpoint');

  if (!client?.client_id) {
    skip('authorize checks', 'no client_id from DCR — upstream DCR failure already reported');
    return;
  }

  const redirect_uri = client.redirect_uris[0];
  const baseParams = {
    client_id: client.client_id,
    redirect_uri,
    response_type: 'code',
    scope: 'docs:read',
    state: 'conformance-state',
    code_challenge: crypto.randomBytes(32).toString('base64url'),
    code_challenge_method: 'S256',
  };

  // Missing code_challenge → 400 (PKCE required per AC1)
  const { code_challenge: _, ...noPkce } = baseParams;
  const r1 = await fetch(`${BASE_URL}/oauth/authorize?${new URLSearchParams(noPkce).toString()}`, {
    redirect: 'manual',
  });
  expect(r1.status === 400, 'authorize without code_challenge → 400 (PKCE required, AC1)', `got ${r1.status}`);

  // code_challenge_method=plain → 400 (S256-only per AC1)
  const r2 = await fetch(
    `${BASE_URL}/oauth/authorize?${new URLSearchParams({ ...baseParams, code_challenge_method: 'plain' }).toString()}`,
    { redirect: 'manual' }
  );
  expect(r2.status === 400, 'authorize with code_challenge_method=plain → 400 (S256 only, AC1)');

  // redirect_uri variant — extra query param must NOT match (AC3)
  const r3 = await fetch(
    `${BASE_URL}/oauth/authorize?${new URLSearchParams({
      ...baseParams,
      redirect_uri: `${redirect_uri}?extra=1`,
    }).toString()}`,
    { redirect: 'manual' }
  );
  expect(
    r3.status === 400,
    'authorize with redirect_uri+query variant → 400 (exact match, AC3)',
    `got ${r3.status}`
  );

  // Unknown client_id → 400
  const r4 = await fetch(
    `${BASE_URL}/oauth/authorize?${new URLSearchParams({
      ...baseParams,
      client_id: 'definitely-not-a-real-client-id',
    }).toString()}`,
    { redirect: 'manual' }
  );
  expect(r4.status === 400, 'authorize with unknown client_id → 400');
}

// ─── 4. Token endpoint — error contract (RFC 6749 §5.2) ─────────────────────

async function checkTokenErrors() {
  section('RFC 6749 §5.2 — Token endpoint error contract');

  // Empty body → 400 invalid_request
  const empty = await getJson('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  expect(empty.status === 400, 'empty token request → 400', `got ${empty.status}`);
  expect(empty.body?.error === 'invalid_request', 'error=invalid_request');
  expect(
    (empty.headers.get('cache-control') ?? '').includes('no-store'),
    'Cache-Control: no-store on error (RFC 6749 §5.1)'
  );

  // Unknown grant → 400 unsupported_grant_type
  const unknown = await getJson('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' }),
  });
  expect(unknown.body?.error === 'unsupported_grant_type', 'unknown grant → unsupported_grant_type');

  // Fake refresh token → 400 invalid_grant
  const fakeRefresh = await getJson('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'refresh_token',
      refresh_token: 'not-a-real-token',
      client_id: 'x',
      client_secret: 'y',
    }),
  });
  expect(
    fakeRefresh.body?.error === 'invalid_grant' || fakeRefresh.body?.error === 'invalid_client',
    'fake refresh + fake client → invalid_grant or invalid_client',
    `got ${fakeRefresh.body?.error}`
  );
}

// ─── 5. MCP endpoint auth (AC1/AC8) ────────────────────────────────────────

async function checkMcpAuth() {
  section('MCP endpoint — auth gate');

  const noAuth = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  });
  expect(noAuth.status === 401, 'POST /mcp without bearer → 401', `got ${noAuth.status}`);

  const www = noAuth.headers.get('www-authenticate') ?? '';
  expect(www.startsWith('Bearer'), 'WWW-Authenticate: Bearer (RFC 6750 §3)', `got "${www}"`);
  expect(
    www.includes(`resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`),
    'WWW-Authenticate advertises resource_metadata URL (RFC 9728)'
  );

  const badAuth = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer clearly-not-a-real-token',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  });
  expect(badAuth.status === 401, 'POST /mcp with bogus bearer → 401');
}

// ─── Runner ─────────────────────────────────────────────────────────────────

console.log(`Foundry OAuth conformance probe → ${BASE_URL}`);

const metadata = await checkDiscovery();
const client = await checkDcr(metadata);
await checkAuthorize(client);
await checkTokenErrors();
await checkMcpAuth();

console.log();
if (failures > 0) {
  console.log(`\u001b[31m${failures} check(s) failed.\u001b[0m`);
  process.exit(1);
}
console.log('\u001b[32mAll conformance checks passed.\u001b[0m');
