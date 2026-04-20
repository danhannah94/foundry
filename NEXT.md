# Foundry — Ship Log

Rolling record of shipped epics. Newest first. For per-change detail,
see `git log` or the linked PRs; this file captures the "what did this
epic deliver and why it mattered" layer that would otherwise get lost.

---

## E12 — MCP Authorization (OAuth 2.0 + GitHub IdP) — 2026-04-20

**Headline.** Foundry's MCP surface now authenticates callers via the
standard OAuth 2.0 authorization code flow with PKCE, backed by GitHub
as the identity provider. The stdio bridge is gone; every MCP client —
Claude Code, Claude.ai Connectors, Cowork-Claude — talks to
`https://foundry-claymore.fly.dev/mcp` over Streamable HTTP with an
OAuth Bearer token.

### Why this mattered

Pre-E12, Foundry identified MCP callers by looking up an environment
variable (`FOUNDRY_MCP_USER`). Every agent action was attributed to
whatever string was configured at container boot. This was fine when
there was exactly one operator running exactly one MCP client, but it
failed the core Foundry contract — that annotations and reviews are
attributed to the human or agent that actually wrote them. E12 replaces
the env-var lie with real identity:

- Each MCP client registers dynamically and gets a `client_type`
  (`interactive` / `autonomous`).
- Each human authenticates against GitHub once per ~30-day refresh
  window.
- Every write lands with the right `user_id` (GitHub) + `author_type`
  (derived from the client_type, not the user account).

This is also what unlocks Claude.ai Connectors talking to Foundry at
all — they require the MCP Authorization spec as of 2025-06-18.

### What shipped

| Story | PR | Delivers |
|---|---|---|
| S1 | — | OAuth schema + DAOs (`users`, `oauth_clients`, `oauth_authorization_codes`, `oauth_tokens`) |
| S2 | — | GitHub OAuth callback — `GET /oauth/github/callback`, mints signed session cookie |
| S3 | — | `.well-known/oauth-authorization-server` + `.well-known/oauth-protected-resource` (RFC 8414 / 9728) |
| S4 | — | Dynamic Client Registration — `POST /oauth/register` gated by `FOUNDRY_DCR_TOKEN` (RFC 7591) |
| S5 | [#146](https://github.com/danhannah94/foundry/pull/146) | `/oauth/authorize` + consent page + auth-code mint; S5 hotfix `GET /oauth/consent` handler |
| S6 | [#147](https://github.com/danhannah94/foundry/pull/147) | Token endpoint + refresh rotation + confused-deputy check (RFC 6749 §4.1.3) |
| S7 | [#148](https://github.com/danhannah94/foundry/pull/148) | `requireAuth` / `requireScope` / `softAuth` middleware + RFC 6750 `WWW-Authenticate` |
| S8 | [#150](https://github.com/danhannah94/foundry/pull/150) | Identity propagation — `user_id` from `req.user.id`, `author_type` from `req.client.client_type` |
| S9 | [#149](https://github.com/danhannah94/foundry/pull/149) | Per-user `docs:read:private` on `/api/search` + `/api/pages` (closes most of #99) |
| S10a | [#152](https://github.com/danhannah94/foundry/pull/152) | Service-layer extraction — 6 domain modules, ~1700 LOC, +52 unit tests |
| S10b | [#153](https://github.com/danhannah94/foundry/pull/153) | MCP Streamable HTTP cutover — direct service calls, stdio + http-client deleted |
| S10c | [#154](https://github.com/danhannah94/foundry/pull/154) | Docs + config cleanup + `docs/mcp-migration.md` runbook |
| S12 A | [#158](https://github.com/danhannah94/foundry/pull/158) | In-repo OAuth E2E test suite + security AC gap coverage |
| S12 B | [#159](https://github.com/danhannah94/foundry/pull/159) | `scripts/oauth-conformance.mjs` probe + `docs/security-review.md` pen-test pass |
| S12 C | (this PR) | DEPLOY.md env gaps + DCR rotation runbook + this ship log |

Plus two follow-up hotfixes:

- [#155](https://github.com/danhannah94/foundry/pull/155) — `docs:read:private` on `GET /docs/:path` (closes remainder of #99)
- [#156](https://github.com/danhannah94/foundry/pull/156) — `npm audit fix` clears critical + high vulnerabilities (#140)

And a test-infra fix landed during S12 prep:

- [#157](https://github.com/danhannah94/foundry/pull/157) — fix OAuth test flakes (HMAC-tamper logic bug + cross-file `process.env` leak under vitest's threads pool)

### Issues closed

- [#99](https://github.com/danhannah94/foundry/issues/99) — per-user access control on private docs
- [#140](https://github.com/danhannah94/foundry/issues/140) — critical + high npm audit findings
- [#151](https://github.com/danhannah94/foundry/issues/151) — `docs:read:private` on GET `/docs/:path`

### Security posture

- Opaque tokens, SHA-256 at rest. No JWTs.
- Refresh rotation on every use with reuse detection (single-use refresh).
- Auth codes one-time-consumable via atomic DB update.
- PKCE required (S256 only); no `plain` downgrade path.
- `redirect_uri` exact string match — no query-param stripping.
- Client secrets bcrypt-hashed at rest.
- DCR bearer-gated via `FOUNDRY_DCR_TOKEN` — see [dcr-rotation.md](docs/dcr-rotation.md).
- Issuer URL sourced from `FOUNDRY_OAUTH_ISSUER`, never from `Host` header.
- Token material never appears in log output (intercept-tested).

Full threat matrix + accepted risks: [docs/security-review.md](docs/security-review.md).

### Non-obvious decisions

Captured at ship time because they're expensive to reverse and won't be
obvious from the code alone:

- **S10 was split into S10a/b/c mid-flight.** A pre-implementation grep
  discovered `mcp/http-client.ts` was consumed by both stdio AND the
  old `/mcp/sse` path — deleting the bridge directly would have broken
  the HTTP MCP endpoint mid-migration. Splitting into extract →
  Streamable HTTP cutover → cleanup let each step ship independently.
- **Chose Streamable HTTP over keeping SSE.** Research confirmed both
  Claude Code and Claude.ai Connectors prefer Streamable today; SSE is
  `@deprecated` in the MCP SDK. Near-zero incremental cost to cut over
  in the same epic.
- **Session cookies, not database sessions.** Signed HMAC-SHA256
  cookies keep the happy path DB-hit-free for a single-node deploy.
  Revisit if Foundry goes multi-node.
- **`author_type` derived from client, not user.** An agent using a
  human's OAuth session still writes as `ai` because the client
  registered as `autonomous`. Accurate audit trail.
- **Consent shown on every fresh auth flow in v1.** No
  `oauth_consents` table. At refresh-token lifetimes of ~30 days, a
  single human sees consent ~monthly — acceptable UX, ~zero
  implementation cost, deferred to v2 if a second human joins.

### Follow-ups outside E12

- **`FOUNDRY_WRITE_TOKEN` legacy path removal** — 30-day break-glass
  window opened at S10b ship (~2026-04-20). Earliest removal
  ~2026-05-20 in a follow-up PR.
- **Vitest residual flake rate ~2.5%** — tracked as a follow-up after
  #157 brought it down from ~8%. Not CI-blocking.
- **OAuth test-flake follow-up** — `oauth_consents` skip-consent,
  audit log for DCR use, multi-tenant rate limiting. All v2 concerns.

### Upstream dependencies

None introduced. E12 uses only existing deps (`bcryptjs`,
`better-sqlite3`, `express`, node's built-in `crypto`).
