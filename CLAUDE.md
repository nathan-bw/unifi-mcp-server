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

---

## Update 2026-02-03 (Session 2)

### Changes Made
- Removed dev mode auth bypass (was auto-approving without Cloudflare)
- OAuth now requires `OAUTH_ENABLED=true` (CF credentials configured)

### Cloudflare Access Configuration (Multiple Apps)

Per [Application Paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), create separate Access Applications:

| Access App | Domain/Path | Policy | Purpose |
|------------|-------------|--------|---------|
| `UniFi MCP - OAuth Discovery` | `unifi-mcp.thesacketts.org/.well-known/*` | Bypass | MCP client discovery |
| `UniFi MCP - Register` | `unifi-mcp.thesacketts.org/register` | Bypass | Client registration |
| `UniFi MCP - Authorize` | `unifi-mcp.thesacketts.org/authorize` | Bypass | Start OAuth |
| `UniFi MCP - Callback` | `unifi-mcp.thesacketts.org/callback` | Bypass | CF redirect target |
| `UniFi MCP - Token` | `unifi-mcp.thesacketts.org/token` | Bypass | Token exchange |
| `UniFi MCP - Health` | `unifi-mcp.thesacketts.org/health` | Bypass | Health check |
| `UniFi MCP - Root` | `unifi-mcp.thesacketts.org` | Allow (your users) | Protect dashboard |

**Note:** More specific paths override broader ones. `/mcp` is protected by Bearer tokens (app-level), not CF Access edge policy.

### Verification Commands

```bash
# 1. OAuth discovery (should return JSON)
curl -s https://unifi-mcp.thesacketts.org/.well-known/oauth-authorization-server

# 2. Health (should return JSON)
curl -s https://unifi-mcp.thesacketts.org/health

# 3. MCP without token (should return 401)
curl -s https://unifi-mcp.thesacketts.org/mcp

# 4. Root (should redirect to CF login if protected)
curl -s -I https://unifi-mcp.thesacketts.org/
```

### Next Steps

- [ ] Create Access Applications per table above
- [ ] Deploy updated code: `git pull && docker compose build --no-cache && docker compose up -d`
- [ ] Verify OAuth discovery returns JSON
- [ ] Test MCP Portal connection

---

## Update 2026-02-03 (Session 3) - MCP 2025-11-25 Compliance

### Changes Made

**RFC 9728 Protected Resource Metadata:**
- Added `/.well-known/oauth-protected-resource/mcp` endpoint
- Added `/.well-known/oauth-protected-resource` (root fallback)
- Returns `resource`, `authorization_servers`, `scopes_supported`

**WWW-Authenticate Header (401 responses):**
- Now includes `resource_metadata` URL per spec
- Includes `scope="mcp:tools"` guidance

**Origin Validation (DNS rebinding protection):**
- Validates Origin header on all /mcp requests
- Allows localhost, 127.0.0.1, and same-origin
- Returns 403 Forbidden for invalid origins

**DELETE Method (session termination):**
- Clients can explicitly terminate sessions via DELETE /mcp

**Accept Header Validation:**
- GET requires `text/event-stream`
- POST requires `application/json` or `text/event-stream`

**MCP-Protocol-Version Header:**
- Logged during session initialization

### Verification Commands

```bash
# Protected Resource Metadata (RFC 9728)
curl -s https://unifi-mcp.thesacketts.org/.well-known/oauth-protected-resource/mcp

# Authorization Server Metadata
curl -s https://unifi-mcp.thesacketts.org/.well-known/oauth-authorization-server

# 401 with WWW-Authenticate header
curl -s -I https://unifi-mcp.thesacketts.org/mcp

# Health
curl -s https://unifi-mcp.thesacketts.org/health
```

### MCP 2025-11-25 Compliance Status

| Requirement | Status |
|-------------|--------|
| Streamable HTTP POST/GET/DELETE | ✅ |
| `/.well-known/oauth-protected-resource` (RFC 9728) | ✅ |
| `WWW-Authenticate` with `resource_metadata` | ✅ |
| Origin header validation | ✅ |
| Accept header validation | ✅ |
| MCP-Protocol-Version handling | ✅ |
| PKCE S256 | ✅ |
| Dynamic Client Registration | ✅ |

### Next Steps

- [ ] Deploy: `git pull && docker compose build --no-cache && docker compose up -d`
- [ ] Test all new endpoints
- [ ] Register with Cloudflare MCP Portal
