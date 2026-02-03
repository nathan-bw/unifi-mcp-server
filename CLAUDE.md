# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

A self-hosted MCP server for managing UniFi networks. Runs behind Cloudflare Tunnel + Access.

**Architecture (3 Layers):**

| Layer | Responsibility | Who |
|-------|----------------|-----|
| 1. UniFi API | Local HTTPS connection to UDM SE | This app |
| 2. MCP Server | Streamable HTTP on `/mcp` | This app |
| 3. Auth/Security | OAuth, SSO, Zero Trust | Cloudflare |

## Commands

```bash
# Development
npm run dev

# Production
npm start

# Docker
docker compose up -d
docker compose logs -f
docker compose down
docker compose build --no-cache
```

## Verification Commands

```bash
# Health check (local)
curl http://localhost:3000/health

# Health check (public)
curl https://unifi-mcp.thesacketts.org/health

# MCP endpoint (should work when authenticated via CF Access)
curl -X POST https://unifi-mcp.thesacketts.org/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'
```

## MCP Tools Exposed

| Tool | Description |
|------|-------------|
| `list_clients` | List all connected clients |
| `get_client` | Get details for a specific client |
| `search_devices` | Search devices by name/MAC |
| `list_access_points` | List all access points |
| `get_network_health` | Get network health status |
| `block_client` | Block a client by MAC |
| `unblock_client` | Unblock a client |
| `reconnect_client` | Force client reconnection |
| `restart_device` | Restart a UniFi device |
| `list_blocked_clients` | List all blocked clients |
| `echo` | Test tool |

## File Structure

```
server.js          # Single-file server (all logic)
.env               # Environment config (secrets)
docker-compose.yml # Docker deployment
Dockerfile         # Container build
```

## Key Sections in server.js

1. **Configuration** - Environment variables
2. **UniFiController class** - Wrapper around `node-unifi`
3. **createMcpServer()** - Registers all MCP tools
4. **Express routes** - `/health`, `/`, `/mcp`
5. **MCP endpoint** - Streamable HTTP transport

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | Yes | Public URL (e.g., https://unifi-mcp.thesacketts.org) |
| `UNIFI_HOST` | Yes | UDM SE IP address |
| `UNIFI_USERNAME` | Yes | UniFi local admin username |
| `UNIFI_PASSWORD` | Yes | UniFi local admin password |
| `UNIFI_SITE` | No | Site name (default: default) |
| `CF_ACCESS_TEAM` | No | Cloudflare team name (for JWT validation) |
| `CF_ACCESS_AUD` | No | Cloudflare AUD tag (for JWT validation) |

## Current Status (2026-02-03)

- ✅ OAuth removed - Cloudflare Access handles all auth
- ✅ `/health` returns safe booleans only
- ✅ `/mcp` endpoint uses Streamable HTTP
- ✅ UniFi API client functional
- ✅ 11 MCP tools registered

## Cloudflare Setup Required

1. **Cloudflare Tunnel** - Expose localhost:3000
2. **Cloudflare Access Application** - Protect the hostname
3. **Access Policy** - Define who can access
4. **MCP Portal** (optional) - Register as MCP server

## Next Steps

- [ ] Deploy updated code to Raspberry Pi
- [ ] Verify `/health` works through CF Tunnel
- [ ] Test `/mcp` endpoint with MCP client
- [ ] Register with Cloudflare MCP Portal

## Resuming Work

If starting a new session:
1. The OAuth layer has been REMOVED - do not add it back
2. Auth is handled by Cloudflare Access at the edge
3. This server just exposes `/health` and `/mcp`
4. Never log or expose secrets
