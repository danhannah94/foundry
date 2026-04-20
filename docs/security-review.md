# E12 Security Review — MCP Authorization (OAuth 2.0)

**Scope:** Pre-deploy pen-test pass over the OAuth authorization surface
introduced in FND-E12. Covers the threat models in the MCP Authorization
spec (`specification/2025-06-18/basic/authorization`) and OAuth 2.1
security best current practice (RFC 9700), plus RFC 8414 / 9728 metadata
compliance.

**Posture:** One-off review for the E12 ship. This document is a
durable record of what was reviewed, what was mitigated, and what was
explicitly accepted. Subsequent changes to the OAuth surface should
revisit the relevant rows rather than re-writing this doc.

**Target of review:** `main` at merge of S10c (PR #154) through the
S12 PRs (A/B/C). Deployed instance: `foundry-claymore.fly.dev`.

---

## Threat matrix

Each row names a threat, the mitigation in Foundry, and where coverage
lives (code path + test). "Verified" means the threat was probed
against the deployed instance (via `scripts/oauth-conformance.mjs` or
manual curl) during this review and the response matched the
mitigation contract.

### Token handling

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Token leakage via response logging | Opaque tokens; never logged at any level | `oauth/dao.ts` (sha256-at-rest); AC6 covers no-log invariant | `test/oauth.e2e.test.ts` AC6 | ✅ |
| Stolen token used forever | Access tokens ~1h; refresh rotated on every use with reuse detection | `oauth/dao.ts` `tokensDao.rotate`; `routes/oauth-token.ts` | `oauth-token.test.ts` AC6 + e2e full-flow walk | ✅ |
| Token substitution across clients | Refresh token binding — `client_id` on presentation must match the client the token was minted for | `routes/oauth-token.ts` (cross-client check) | `oauth-token.test.ts:561` | ✅ |
| Token reuse after revocation | Revocation is a DB row update with `revoked_at`; every introspection rejects revoked rows | `oauth/dao.ts` `tokensDao.introspect` | `oauth-token.test.ts` rotation reuse; `auth.oauth.test.ts` revoked-token 401 | ✅ |
| Hashed-at-rest bypass via collision | SHA-256 of opaque 32-byte random — collision is not an in-scope attack | — | — | N/A |

### PKCE enforcement (RFC 7636)

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Code interception via network attacker | PKCE required — `/authorize` rejects requests without `code_challenge` | `routes/oauth.ts` authorize handler | `oauth-authorize.test.ts:181`; e2e AC1 path via conformance probe | ✅ |
| Downgrade to `plain` method | Only `S256` accepted; `plain` → 400 | `routes/oauth.ts` | `oauth-authorize.test.ts:181` | ✅ |
| Code verifier reuse / short-length | `code_challenge` length validated; `code_verifier` cryptographically bound at token exchange | `routes/oauth.ts`, `routes/oauth-token.ts` | `oauth-authorize.test.ts:190`; `oauth-token.test.ts` verifier-mismatch | ✅ |

### Authorization code handling

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Auth code replay | Codes are one-time-consumable via atomic `consumed_at` check-and-set | `oauth/dao.ts` `codesDao.consume` | `oauth-token.test.ts:325` AC3 | ✅ |
| Auth code exchange without PKCE | Token endpoint requires `code_verifier` and compares SHA-256 to stored challenge | `routes/oauth-token.ts` | `oauth-token.test.ts` verifier-required | ✅ |
| Expired code accepted | Codes have `expires_at` (10min); rejected post-expiry | `oauth/dao.ts` `codesDao.consume` | `oauth-token.test.ts` expiry | ✅ |
| Code minted for one client, redeemed by another | Binding check on consume: `client_id` on token request must match the code's minting client | `routes/oauth-token.ts` | `oauth-token.test.ts` cross-client-code | ✅ |

### Redirect URI handling

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Query-param smuggling via `?extra=1` variant | Exact string match at authorize + at token exchange — no parsing, no stripping | `routes/oauth.ts` `registeredUris.includes(redirect_uri)` | `test/oauth.e2e.test.ts` AC3 + conformance probe AC3 | ✅ |
| Redirect to unregistered URI | Pre-registered URIs only; mismatch → 400 invalid_request | `routes/oauth.ts` | `oauth-authorize.test.ts` redirect-mismatch | ✅ |
| Plain http (non-localhost) redirect_uris | DCR rejects non-https / non-localhost URIs | `routes/oauth-register.ts` `isValidRedirectUri` | `oauth-register.test.ts` http-rejection + conformance probe | ✅ |

### State / CSRF

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| CSRF on authorize → consent | `state` echoed verbatim in the callback redirect; client responsible for binding | `routes/oauth.ts` `URLSearchParams({ code, state })` | `test/oauth.e2e.test.ts` full-flow walk (AC2) | ✅ |
| GitHub-callback session fixation | Signed state cookie with HMAC + expiry; tampering detected via constant-time compare | `oauth/session.ts` `verifyCookie`; tests in `oauth-github.test.ts` (post PR #157) | `oauth-github.test.ts` HMAC-tamper + expiry | ✅ |

### DCR (RFC 7591)

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Anonymous DCR floods | Bearer-gated — `POST /oauth/register` requires `FOUNDRY_DCR_TOKEN` | `routes/oauth-register.ts` | `oauth-register.test.ts` bearer-gate; conformance AC8 | ✅ |
| Oversized client_name DoS | 100-char max | `routes/oauth-register.ts` | `oauth-register.test.ts:198` | ✅ |
| Malicious `token_endpoint_auth_method` smuggling | Field is accepted but not acted on — token endpoint uses secret-based client auth uniformly | `routes/oauth-register.ts` | `oauth-register.test.ts:180` | Accepted — see note |
| Token leak via registered client secret | `client_secret` bcrypt-hashed at rest; returned in plaintext only at registration time | `oauth/dao.ts` `clientsDao.register` | `oauth-dao.test.ts:127` | ✅ |

### Issuer binding

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Host-header-driven issuer spoofing | Issuer sourced from `FOUNDRY_OAUTH_ISSUER` env only; no `req.headers.host` lookup in routing code | `grep -r "req.headers.host\|req.hostname\|req.get('host')" src/` returns 0 matches in OAuth paths | `test/oauth.e2e.test.ts` AC9 + conformance probe AC9 | ✅ |
| `iss` mismatch between metadata and token | Both derive from the same `FOUNDRY_OAUTH_ISSUER` constant at startup | `routes/oauth-discovery.ts`; `routes/oauth-token.ts` | conformance probe metadata check | ✅ |
| Metadata URL tampering in WWW-Authenticate | `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` derived from `FOUNDRY_OAUTH_ISSUER` | `middleware/auth.ts` | conformance probe MCP-auth check | ✅ |

### Logging hygiene

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| Access/refresh/code plaintext in logs | No `console.*` calls in OAuth routes log request bodies or token material; verified by intercepted console in AC6 test | `routes/oauth-*.ts` (grep: no token interpolation in log strings) | `test/oauth.e2e.test.ts` AC6 | ✅ |
| Error paths echo secrets | Error responses follow RFC 6749 §5.2 — `{error, error_description}` with opaque descriptions; no token values in `error_description` | `routes/oauth-token.ts` | Manual review during pen-test | ✅ |

### Transport / infrastructure

| Threat | Mitigation | Code | Test | Verified |
|---|---|---|---|---|
| TLS downgrade | Fly.io terminates TLS and redirects HTTP→HTTPS; `force_https = true` in `fly.toml` | `fly.toml` | Manual: `curl -I http://foundry-claymore.fly.dev` → 301 to https | ✅ |
| Cookie exfiltration via XSS | Session / pending cookies are `HttpOnly; SameSite=Lax; Path=/` | `routes/oauth.ts` `setCookieHeader` | `oauth-github.test.ts` cookie-attributes | ✅ |
| Database file exfiltration | SQLite on a Fly volume mounted at `/data`; container user drops to non-root; file readable only by process | `Dockerfile` | Manual container inspection | ✅ |

---

## RFC compliance probe

Run against `foundry-claymore.fly.dev` via
`node scripts/oauth-conformance.mjs` with a valid `FOUNDRY_DCR_TOKEN`.
All probed assertions passed in the final review run. The probe script
covers:

- RFC 8414 — authorization server metadata shape (issuer, endpoints,
  supported grants, S256 advertised).
- RFC 9728 — protected-resource metadata.
- RFC 7591 — DCR bearer gate + redirect_uri validation.
- RFC 6749 §4.1 + RFC 7636 — PKCE enforcement at authorize.
- RFC 6749 §5.2 — token endpoint error contract (`Cache-Control: no-store`,
  RFC-correct error codes).
- RFC 6750 §3 — `WWW-Authenticate: Bearer` with `resource_metadata`
  parameter.

---

## Accepted risks

Items the review explicitly accepts rather than mitigates.

| Risk | Rationale | Re-evaluate when |
|---|---|---|
| Consent screen shown on every fresh auth flow | v1 scope — no `oauth_consents` table. Refresh tokens live 30 days, so user sees consent ~once/month per client. Documented in Foundry design doc (Resolved from Refinement). | Onboarding a second human user OR shortening refresh lifetime |
| `FOUNDRY_WRITE_TOKEN` dual-auth path in `requireAuth` | 30-day break-glass window post-S10b cutover. Removed in follow-up PR ~2026-05-20. | Break-glass window closes |
| `token_endpoint_auth_method` DCR field accepted but ignored | Foundry only supports `client_secret_post`. Accepting the field avoids breaking clients that advertise other methods; they fall back automatically. Documented via conformance probe. | Supporting multiple auth methods |
| Single-node deployment — no session resumption on `/mcp` | `sessionIdGenerator: undefined` matches MCP SDK's `simpleStatelessStreamableHttp` example. Claude Code / Claude.ai Connectors don't require resumption. | Going multi-node OR adding a client that needs resumption |
| No rate limiting on `/oauth/*` | Foundry is single-tenant, single-op. DCR is bearer-gated; token endpoint is bound by DB throughput. Revisit if Foundry opens to external users. | Multi-tenant onboarding |

---

## Sign-off

- [ ] Conformance probe all-green against staging: `node scripts/oauth-conformance.mjs` exit 0
- [ ] In-repo E2E suite green on main: `npm test -w @foundry/api` → 446/446
- [ ] Manual browser walkthrough of full Claude.ai Connector flow against staging
- [ ] Fly secrets checklist (see DEPLOY.md) all set
- [ ] No outstanding TODOs in E12 design doc's Resolved from Refinement section

Signed off by: _________________ on _________________
