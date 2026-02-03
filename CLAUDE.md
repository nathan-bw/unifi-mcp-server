# CLAUDE.md

## Project Overview

UniFi MCP Server with OAuth 2.1 authentication via Cloudflare Access for SaaS.

**Architecture:**

| Layer | Responsibility | Who |
|-------|----------------|-----|
| 1. UniFi API | Local HTTPS to UDM SE | This app |
| 2. MCP Server | Streamable HTTP on `/mcp` | This app |
| 3. OAuth 2.1 | Token issuance, PKCE validation | This app |
| 4. Identity (IdP) | User login, SSO | Cloudflare Access for SaaS |

## OAuth Flow

```
MCP Client → /register (get client_id)
          → /authorize (with PKCE)
          → Cloudflare Access login
          → /callback (receive CF token)
          → /token (exchange for MCP token)
          → /mcp (with Bearer token)
```

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | Yes | Public URL |
| `CF_ACCESS_TEAM` | Yes | Cloudflare team name (e.g., `breezywillow`) |
| `CF_CLIENT_ID` | Yes | From Access for SaaS app |
| `CF_CLIENT_SECRET` | Yes | From Access for SaaS app |
| `UNIFI_HOST` | Yes | UDM SE IP |
| `UNIFI_USERNAME` | Yes | UniFi admin |
| `UNIFI_PASSWORD` | Yes | UniFi password |

## Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/health` | None | Health check |
| `/.well-known/oauth-authorization-server` | None | OAuth discovery |
| `/register` | None | Dynamic client registration |
| `/authorize` | None | Start OAuth flow |
| `/callback` | None | Cloudflare callback |
| `/token` | None | Exchange code for token |
| `/mcp` | Bearer | MCP protocol |

## MCP Tools

- `list_clients` - List connected clients
- `get_client` - Get client by MAC
- `search_devices` - Search by name/MAC
- `list_access_points` - List APs
- `get_network_health` - Network health
- `block_client` / `unblock_client` - Block/unblock MAC
- `reconnect_client` - Force reconnect
- `restart_device` - Restart device
- `list_blocked_clients` - List blocked

## Verification Commands

```bash
# Health
curl https://unifi-mcp.thesacketts.org/health

# OAuth discovery
curl https://unifi-mcp.thesacketts.org/.well-known/oauth-authorization-server

# MCP without auth (should 401)
curl -X POST https://unifi-mcp.thesacketts.org/mcp
```

## Cloudflare Setup Required

1. **Access for SaaS Application:**
   - Zero Trust → Access → Applications → Add → SaaS
   - Protocol: OIDC
   - Redirect URL: `https://unifi-mcp.thesacketts.org/callback`
   - Copy: Client ID, Client Secret

2. **Add to .env:**
   ```
   CF_ACCESS_TEAM=breezywillow
   CF_CLIENT_ID=<from step 1>
   CF_CLIENT_SECRET=<from step 1>
   ```

3. **Rebuild Docker:**
   ```bash
   docker compose build --no-cache && docker compose up -d
   ```

## Current Status (2026-02-03)

- ✅ OAuth 2.1 with PKCE implemented
- ✅ Cloudflare Access for SaaS as IdP
- ✅ Dynamic client registration
- ✅ Token validation on /mcp
- ⏳ Needs CF_CLIENT_ID and CF_CLIENT_SECRET

## Resuming Work

1. OAuth 2.1 is implemented in server.js
2. Cloudflare Access for SaaS is the identity provider
3. MCP clients register → authorize → get token → access /mcp
4. Never expose secrets in logs or responses
