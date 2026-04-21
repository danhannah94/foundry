# Claude.ai Custom Connector — Setup Guide

How to connect Foundry's MCP surface to Claude.ai (web + Desktop + mobile).
The steps below are what the Foundry operator does *once per Foundry
deploy*. After setup, any Claude.ai conversation can call Foundry
tools under the connected account.

## Why manual setup is required

Claude.ai's "Add Custom Connector" dialog does not carry an OAuth
initial access token (RFC 7591 §3), so it cannot complete Dynamic
Client Registration against Foundry's bearer-gated `/oauth/register`
endpoint. Instead, we pre-register Claude.ai as a named OAuth client
using the operator's `FOUNDRY_DCR_TOKEN`, and paste the resulting
`client_id` + `client_secret` into the Advanced Settings fields.

See [`docs/dcr-rotation.md`](dcr-rotation.md) if you need to rotate the
DCR token (e.g., after a leak). The client you register here is
independent of the DCR token — rotating it does not affect
already-registered clients.

## Prerequisites

- `FOUNDRY_DCR_TOKEN` — from 1Password (or wherever you stored it when
  the current value was minted).
- Foundry deployed and healthy (`curl https://foundry-claymore.fly.dev/api/health`
  returns `{"status":"ok"}`).
- You're a member of `FOUNDRY_PRIVATE_DOC_USERS` if you want
  private-doc access via tool calls (otherwise you'll only see
  `access: public` content).

## One-time registration

Run once per Foundry deploy (not per Claude.ai user — Claude.ai
maintains one shared client registration, and each user's OAuth
authorization is per-user on top of that).

```bash
# Paste your DCR token from 1Password into this variable
DCR_TOKEN="<paste-from-1password>"

curl -sS -X POST https://foundry-claymore.fly.dev/oauth/register \
  -H "Authorization: Bearer $DCR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Claude.ai Connector",
    "redirect_uris": [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback"
    ],
    "client_type": "autonomous"
  }' | python3 -m json.tool
```

### Why both redirect URIs

Anthropic operates on both `claude.ai` and `claude.com`. Enterprise
tenants and some regions route through `claude.com`. Register both so
every user works regardless of which surface they come from; our
authorize endpoint requires an exact-string match against the
registered list (AC3).

### Why `client_type: "autonomous"`

Claude.ai makes MCP tool calls on behalf of a user during a chat —
the user doesn't click each call. Per the E12 design, that's an
`autonomous` client, which means writes from Claude.ai land with
`author_type='ai'`. If you want writes tagged `human` (because *you*
prompted them), re-register as `interactive` instead.

### Expected response

```json
{
  "client_id": "32-char-hex-string",
  "client_secret": "long-random-string",
  "client_name": "Claude.ai Connector",
  "redirect_uris": [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback"
  ],
  "client_type": "autonomous",
  "registration_access_token": null
}
```

**Stash `client_id` and `client_secret` in 1Password** alongside the DCR
token — you'll need them if another human wants to set up their own
Claude.ai Connector against the same Foundry, and if you ever have to
re-paste them (e.g. reconnecting after revoke).

## Connect Claude.ai

1. In Claude.ai → Settings → Connectors → **Add custom connector**.
2. Fill in:
   - **Name:** `Foundry` (or whatever you prefer)
   - **Remote MCP server URL:** `https://foundry-claymore.fly.dev/mcp`
   - **Advanced settings → OAuth Client ID:** the `client_id` from the
     curl response
   - **Advanced settings → OAuth Client Secret:** the `client_secret`
     from the curl response
3. Click **Add**.
4. A popup opens showing Foundry's consent screen. Click **Approve**.
5. The dialog should close and the connector moves to **Connected**.

## Smoke-test

In a fresh Claude.ai chat:

- *"List all Foundry doc pages."* — should return both public and
  private pages (if your login is in `FOUNDRY_PRIVATE_DOC_USERS`).
- *"Search Foundry for 'dynamic client registration DCR'."* —
  should return the E12 design doc as a top result. (If you only see
  public hits for a query you know matches private content, check your
  GitHub login is in `FOUNDRY_PRIVATE_DOC_USERS`. Semantic search
  filters at score ≥ 0.5, so some phrasings just won't match strongly
  — try a more content-rich query before concluding there's a scope
  bug.)

## Troubleshooting

### "Couldn't reach the MCP server" on Add

Three causes we've seen:

1. **CORS allowlist missing `https://claude.ai`.** Our prod deploy
   allows claude.ai explicitly. If you've forked Foundry, check
   `packages/api/src/index.ts` — the cors `origin` array must include
   `'https://claude.ai'` (and `credentials: true` requires a specific
   origin, not `*`).
2. **Server unhealthy.** `fly status --app foundry-claymore` should
   show `1/1 passing`. If the machine is mid-roll (just after a
   `fly secrets set`), wait 30–60s and retry.
3. **`client_id` / `client_secret` typo.** Regenerate the curl
   response if you're unsure; registering twice is fine and produces
   a new independent client row.

### DCR curl returns `{"error":"invalid_token"}` with the right token

Suspect a whitespace/newline mismatch between what's stored on Fly
and what's in 1Password. Verify:

```bash
printf '%s' "$DCR_TOKEN" | wc -c                       # expect 64
printf '%s' "$DCR_TOKEN" | grep -qE '^[a-f0-9]{64}$' \
  && echo CLEAN || echo DIRTY
```

If both pass and curl still 401s, re-set the Fly secret using
`printf` to strip any trailing newline the shell might have preserved
when you ran `fly secrets set` the first time:

```bash
fly secrets set \
  FOUNDRY_DCR_TOKEN="$(printf '%s' '<paste-from-1p>')" \
  --app foundry-claymore
```

Wait for `fly status` → `1/1 passing`, retry the DCR curl.

### Consent screen never appears / 400 from `/oauth/authorize`

Claude.ai is sending a `redirect_uri` that isn't in the registered
list. Compare the `redirect_uri=` query param in the popup URL against
the two URIs you registered. If Claude.ai is using a third variant
you didn't register, add it to the client:

```bash
# (Delete + recreate the client — Foundry doesn't expose an in-place
# update endpoint. Or just register a second client with all three
# URIs and use its creds.)
```

### Need to start over

Just re-run the curl registration and paste the new `client_id` /
`client_secret` into Claude.ai. Old registrations will accumulate
harmlessly in the `oauth_clients` table; they're only usable by
whoever still holds the secret.
