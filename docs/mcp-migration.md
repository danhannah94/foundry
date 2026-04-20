# MCP Migration — stdio bridge to HTTP

Foundry's MCP server moved from a local stdio subprocess to a single
Streamable HTTP endpoint at `POST /mcp`. All callers authenticate with an
OAuth 2.0 Bearer token. This page is the runbook for switching your client
over.

Production endpoint: `https://foundry-claymore.fly.dev/mcp`
Local dev endpoint: `http://localhost:4321/mcp`

## Claude Code CLI

The supported client is Claude Code **v2.1.64 or newer**. Older versions
cannot complete DCR + PKCE against Foundry.

### Quick path — `claude mcp add`

```bash
claude mcp add --transport http foundry https://foundry-claymore.fly.dev/mcp
```

Claude Code will open a browser tab the first time you invoke a Foundry
tool. Sign in to GitHub, grant the scopes, and you're done — tokens are
cached in `~/.claude.json`.

### Manual path — edit `~/.claude.json`

If you're migrating a hand-edited config, swap the stdio entry for an HTTP
entry:

```jsonc
// BEFORE (stdio bridge — no longer works)
{
  "mcpServers": {
    "foundry": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/foundry/packages/api/dist/mcp/stdio.js"],
      "env": { "FOUNDRY_WRITE_TOKEN": "..." }
    }
  }
}

// AFTER (HTTP)
{
  "mcpServers": {
    "foundry": {
      "type": "http",
      "url": "https://foundry-claymore.fly.dev/mcp"
    }
  }
}
```

No token goes in the config — OAuth handles auth transparently.

## Claude.ai Connectors

1. Claude.ai → Settings → Connectors → **Add custom connector**
2. URL: `https://foundry-claymore.fly.dev/mcp`
3. Save. Claude.ai kicks off the OAuth flow in-browser; approve the scopes.

No token or secret paste required. If you had an older stdio-style
connector registered, delete it first — Foundry no longer speaks stdio.

## Cowork-Claude

Cowork-Claude is configured on the Cowork side, not inside Foundry. Point
the Cowork connector config at `https://foundry-claymore.fly.dev/mcp` and
let DCR + PKCE complete automatically. See the Cowork repo for the exact
config file path and reload command.

## Troubleshooting

**`401 Unauthorized` on the first tool call.** Expected on a fresh client
— the 401 response carries a `WWW-Authenticate: Bearer resource_metadata=...`
header that kicks off discovery + DCR. If you keep getting 401s, the client
may not support OAuth 2.0 DCR. Upgrade to Claude Code 2.1.64+ or use
Claude.ai.

**`POST /oauth/register` returns 403.** Your client couldn't present the
DCR admin token. Check that the Foundry deployment has `FOUNDRY_DCR_TOKEN`
set and that your client was provisioned with the same value. First-party
clients (Claude Code, Claude.ai, Cowork-Claude) are provisioned
out-of-band.

**Old stdio entry still in the config and you see a "command not found" or
"ENOENT" error.** That's the stdio bridge the old config still points at.
Delete the `"command"` / `"args"` / `"env"` keys and replace with the HTTP
entry shape above.

**Token looks valid but tools return empty private results.** The consent
page only grants the scopes you approve. Private doc reads require
`docs:read:private`. Revoke the existing grant on the GitHub OAuth app and
re-authorize.

## Related

- [README → MCP server](../README.md#mcp-server)
- [DEPLOY → Security Model](../DEPLOY.md#security-model)
- RFC 7591 — Dynamic Client Registration
- RFC 8414 — OAuth 2.0 Authorization Server Metadata
- RFC 9728 — OAuth 2.0 Protected Resource Metadata
