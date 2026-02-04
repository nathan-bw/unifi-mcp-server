# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

UniFi MCP Server - A Model Context Protocol server for managing UniFi networks with OAuth 2.1 authentication via Cloudflare Access for SaaS.

## Architecture

| Layer | Responsibility | Implementation |
|-------|----------------|----------------|
| 1. UniFi API | HTTPS to UDM/Controller | X-API-KEY header, dual API (v1 + classic) |
| 2. MCP Server | Streamable HTTP on `/mcp` | MCP 2025-11-25 compliant |
| 3. OAuth 2.1 | Token issuance, PKCE | Custom implementation with auto-registration |
| 4. Identity (IdP) | User login, SSO | Cloudflare Access for SaaS + Entra ID |
| 5. Edge Security | Tunnel, WAF | Cloudflare Tunnel |

## Commands

```bash
# Development
npm run dev

# Production (Docker on Raspberry Pi)
ssh pi@10.230.0.6
cd ~/unifi-mcp-server
git pull
docker compose build --no-cache && docker compose up -d
docker compose logs -f

# Test endpoints
curl https://unifi-mcp.thesacketts.org/health
curl https://unifi-mcp.thesacketts.org/.well-known/oauth-authorization-server
curl -X POST https://unifi-mcp.thesacketts.org/mcp -H "Accept: application/json"
```

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | Yes | Public URL (e.g., `https://unifi-mcp.thesacketts.org`) |
| `CF_ACCESS_TEAM` | Yes | Cloudflare team name (e.g., `breezywillow`) |
| `CF_CLIENT_ID` | Yes | From Access for SaaS app |
| `CF_CLIENT_SECRET` | Yes | From Access for SaaS app |
| `UNIFI_HOST` | Yes | UDM IP address |
| `UNIFI_PORT` | No | UDM port (default: 443) |
| `UNIFI_API_KEY` | Yes | API key from UDM (Settings → Control Plane → Integrations) |
| `UNIFI_SITE` | No | Site name (default: `default`) |

## OAuth Flow

```
MCP Client (Claude Desktop)
    ↓
/.well-known/oauth-authorization-server (discover endpoints)
    ↓
/authorize?client_id=xxx (auto-registers if unknown, requires PKCE)
    ↓
Cloudflare Access for SaaS → Entra ID login
    ↓
/callback (exchange CF token for user info)
    ↓
/token (exchange auth code for Bearer token)
    ↓
/mcp (access with Bearer token)
```

**Note:** MCP clients like Claude Desktop generate their own `client_id` and don't call `/register`. The server auto-registers unknown clients with localhost redirect URIs.

## MCP Tools (18 total)

### Client Management
- `list_clients` - List all connected clients
- `get_client` - Get client by MAC address
- `search_devices` - Search by hostname, IP, or MAC
- `block_client` / `unblock_client` - Block/unblock a client
- `reconnect_client` - Force client to reconnect
- `list_blocked_clients` - List blocked clients

### Device Management
- `list_devices` - List ALL UniFi devices (APs, switches, gateways)
- `list_access_points` - List access points only
- `restart_device` - Restart a device by MAC

### Network Configuration
- `list_networks` - List VLANs and subnets
- `list_wlans` - List wireless SSIDs
- `list_port_forwards` - List port forwarding rules

### Monitoring
- `get_network_health` - Overall network health
- `list_events` - Recent network events
- `list_alarms` - Active alarms

### Testing
- `echo` - Echo test message

## UniFi API

The server uses two API paths (both work with `X-API-KEY` header):

| API | Base Path | Used For |
|-----|-----------|----------|
| v1 Integrations | `/proxy/network/integrations/v1/` | Sites, clients, devices |
| Classic | `/proxy/network/api/` | Health, networks, WLANs, events, alarms |

## Key Files

- `server.js` - Single-file server with all logic
- `docker-compose.yml` - Docker configuration
- `.env` - Environment variables (not in git)
- `.env.example` - Template for .env

## Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/health` | None | Health check |
| `/.well-known/oauth-authorization-server` | None | OAuth discovery |
| `/.well-known/oauth-protected-resource/mcp` | None | Resource metadata (RFC 9728) |
| `/register` | None | Dynamic client registration |
| `/authorize` | None | Start OAuth flow |
| `/callback` | None | Cloudflare OAuth callback |
| `/token` | None | Exchange code for token |
| `/mcp` | Bearer | MCP protocol endpoint |
| `/` | None | Dashboard (consider protecting) |

## Security Considerations

OAuth endpoints must be publicly accessible for MCP clients. Consider:
1. **Cloudflare WAF** - Block non-MCP paths
2. **Rate Limiting** - Protect `/register`, `/authorize`, `/token`
3. **Cloudflare Access** - Protect `/` and `/health`

## Current Status (2026-02-04)

- ✅ OAuth 2.1 with PKCE working
- ✅ Cloudflare Access for SaaS + Entra ID integration
- ✅ Auto-registration for MCP clients (Claude Desktop compatible)
- ✅ API key authentication for UniFi
- ✅ MCP 2025-11-25 compliance
- ✅ 18 MCP tools available
- ✅ Dual API support (v1 + classic)
- ⏳ WAF rules for additional security (optional)

## Deployment

Server runs on Raspberry Pi at `10.230.0.6`, exposed via Cloudflare Tunnel at `unifi-mcp.thesacketts.org`.

```bash
# Deploy updates
ssh pi@10.230.0.6
cd ~/unifi-mcp-server && git pull
docker compose build --no-cache && docker compose up -d
```
