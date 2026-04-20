# DCR Bearer Token Rotation

`FOUNDRY_DCR_TOKEN` gates `POST /oauth/register`. Without it, anyone on
the internet could register a new OAuth client against Foundry. Treat
it like a deploy key — rotate on a schedule, rotate immediately if
leaked.

## When to rotate

- **Leaked / suspected leak** — rotate within the hour. Preceding and
  subsequent rotations are effectively free; the cost is one shared-secret
  re-broadcast to each authorized registrant.
- **Personnel changes** — when someone who had access to the token
  leaves the project.
- **Scheduled hygiene** — every 6–12 months. Add a reminder to your
  calendar tied to the date it was last set.

## Rotation procedure

```bash
# 1. Generate a new token locally. Don't reuse; always fresh.
NEW_TOKEN=$(openssl rand -hex 32)
echo "$NEW_TOKEN"
# Capture this somewhere transient — you'll need it to test and to
# hand off to registrants. DO NOT commit, paste into Slack, or email.
# Use a proper secret channel (1Password share link, signal, etc.).

# 2. Set the new value on Fly. This rolls the machine automatically.
fly secrets set FOUNDRY_DCR_TOKEN="$NEW_TOKEN" --app foundry-claymore

# 3. Wait for the new machine to be healthy.
fly status --app foundry-claymore
# Look for "1/1 passing" under Checks before continuing.

# 4. Verify the new token works against the deployed instance.
FOUNDRY_BASE_URL=https://foundry-claymore.fly.dev \
FOUNDRY_DCR_TOKEN="$NEW_TOKEN" \
node scripts/oauth-conformance.mjs
# All DCR checks should PASS. If any FAIL, roll back before proceeding
# (fly secrets set FOUNDRY_DCR_TOKEN=<old-value>) and debug.

# 5. Broadcast the new token out-of-band to each authorized registrant
# — currently Claude.ai Connectors administrator (Dan) and Cowork-Claude
# config. Use a proper secret channel.

# 6. Confirm the old token is rejected. The conformance probe's
# "DCR with wrong bearer → 401" assertion already covers this; verifying
# with the real old value is belt-and-suspenders.
```

## Who needs the token

As of E12 ship (2026-04-20):

| Registrant | Mechanism | How to deliver |
|---|---|---|
| Claude.ai Connectors (Dan) | Paste into the Connectors admin UI at connection time | 1Password share |
| Cowork-Claude | Baked into the MCP config at setup time | 1Password share |

If a new client joins the authorized set, document it in this table so
the next rotation has an accurate distribution list.

## What breaks during rotation

- In-flight `POST /oauth/register` requests that arrive after the new
  secret has been set but before the requestor has the new token will
  receive 401. Retry with the new token resolves.
- Already-registered clients are unaffected. The DCR token gates
  *registration*, not ongoing auth — existing `client_id` / `client_secret`
  pairs continue to work against `/oauth/token` regardless of DCR state.
- No user-facing disruption. Consent flows, MCP calls, token refreshes
  all continue uninterrupted.

## Rollback

If a rotation is broken (e.g. the new token has shell-escaping issues
that corrupt the stored value):

```bash
fly secrets set FOUNDRY_DCR_TOKEN=<previous-value> --app foundry-claymore
```

Fly keeps one prior secret value internally, but do not rely on that —
always have the old value cached locally for the duration of the
rotation window. Discard within 1 hour of confirming the new value
works.

## Audit

There is intentionally no audit log of DCR token use in v1. The token
is a single shared secret; attributing a registration to a specific
holder isn't possible without per-registrant tokens (planned for v2,
not scoped to E12). Treat every `POST /oauth/register` event in the
server log as "authorized DCR holder or someone with a leaked secret"
— and rotate on suspicion.
