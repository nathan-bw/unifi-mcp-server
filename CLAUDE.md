# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that provides tools for managing UniFi networks. It implements OAuth 2.1 for authentication (using `mcp-oauth-server`) and integrates with Cloudflare Access as the identity provider.

## Commands

```bash
# Development with hot-reload
npm run dev

# Production
npm start

# Docker
docker compose up -d        # Start
docker compose logs -f      # View logs
docker compose down         # Stop
docker build -t unifi-mcp-server .  # Build image

# Test OAuth metadata
curl http://localhost:3000/.well-known/oauth-authorization-server
```

## Architecture

### Single-file Server (`server.js`)

The entire server is in one file with clearly marked sections:

1. **Configuration** - Environment variables loaded via dotenv
2. **OAuth 2.1 Server Setup** - `OAuthServer` from `mcp-oauth-server`
3. **UniFiController class** - Wrapper around `node-unifi` library with lazy connection
4. **MCP Server setup** - `createMcpServer()` registers all tools using `@modelcontextprotocol/sdk`
5. **OAuth Routes** - Mounted via `mcpAuthRouter()` middleware
6. **Consent Page** - Custom `/consent` endpoint that uses Cloudflare Access identity
7. **Express routes** - Dashboard, health check
8. **MCP endpoint** - `/mcp` protected by `requireBearerAuth()` middleware

### Authentication Flow (Two Layers)

```
Layer 1 - Cloudflare Access (Edge):
Request → Cloudflare Access → CF Tunnel → Server
          (adds Cf-Access-Authenticated-User-Email header)

Layer 2 - OAuth 2.1 (MCP Protocol):
MCP Client → /.well-known/oauth-authorization-server (discover)
          → /register (register client)
          → /authorize (start flow with PKCE)
          → /consent (user approves, uses CF Access identity)
          → /token (exchange code for tokens)
          → /mcp (access with Bearer token)
```

### OAuth 2.1 Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/.well-known/oauth-authorization-server` | Server metadata (discovery) |
| `/.well-known/oauth-protected-resource/mcp` | Resource metadata |
| `/authorize` | Authorization endpoint |
| `/token` | Token endpoint |
| `/register` | Dynamic client registration |
| `/consent` | Custom consent page (uses CF Access) |

### Key Patterns

- **Lazy UniFi connection**: `UniFiController.ensureConnected()` connects on first API call
- **Session-based MCP**: Each MCP client gets a unique session ID; transports stored in `Map`
- **Pending auth storage**: Authorization requests stored in `pendingAuth` Map with 10-minute TTL
- **Bearer token validation**: `requireBearerAuth()` middleware validates tokens on `/mcp`
- **Graceful degradation**: Server runs in dev mode without CF Access, UniFi returns errors when not configured

### MCP Tools

Tools are registered in `createMcpServer()` using `server.registerTool()`. Each tool:
- Has a Zod schema for input validation (when inputs needed)
- Returns `{ content: [{ type: 'text', text: '...' }] }` format
- Catches errors and returns `{ isError: true }` on failure

## Environment Variables

Required for full functionality (see `.env.example`):
- `PORT` - Server port (default: 3000)
- `BASE_URL` - Public URL for OAuth redirects (required in production)
- `UNIFI_HOST`, `UNIFI_USERNAME`, `UNIFI_PASSWORD` - UniFi controller
- `CF_ACCESS_TEAM` - Cloudflare Access team name (optional)
- `ALLOWED_EMAILS` - Optional email allowlist

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation (Streamable HTTP transport)
- `mcp-oauth-server` - OAuth 2.1 Authorization Server for MCP
- `node-unifi` - UniFi controller API client
- `express` - Web server
- `zod` - Tool input schema validation

## Current Status (2026-02-02)

### Security Fixes Applied

1. **Password leak fixed** - `UNIFI_ENABLED` now uses `Boolean()` to ensure only booleans are returned
2. **Health endpoint hardened** - Runtime assertion prevents any string values (except status/timestamp) from being returned

### OAuth 2.1 Endpoints (MCP Spec Compliant)

Per [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization):

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/.well-known/oauth-authorization-server` | AS metadata (RFC 8414) | ✅ Exposed at root |
| `/.well-known/oauth-protected-resource/mcp` | Resource metadata (RFC 9728) | ✅ Exposed |
| `/authorize` | Authorization endpoint | ✅ Root path |
| `/token` | Token endpoint | ✅ Root path |
| `/register` | Dynamic client registration | ✅ Root path |
| `/consent` | Custom consent (uses CF Access identity) | ✅ Custom |

### Verification Commands

```bash
# Rebuild and restart Docker container (REQUIRED after code changes)
docker compose down && docker compose build --no-cache && docker compose up -d

# Wait for startup
sleep 3

# 1. Health check - must return booleans only, NO secrets
curl -s http://localhost:3000/health | jq .
# Expected: {"status":"ok","timestamp":"...","unifiEnabled":true,"oauthEnabled":true}

# 2. OAuth discovery - must return metadata JSON
curl -s http://localhost:3000/.well-known/oauth-authorization-server | jq .
# Expected: JSON with issuer, authorization_endpoint, token_endpoint, etc.

# 3. Protected resource metadata
curl -s http://localhost:3000/.well-known/oauth-protected-resource/mcp | jq .

# 4. Check logs for errors
docker compose logs --tail=50
```

### Cloudflare Access for SaaS Integration

This server implements the **Third-Party Authorization Flow** from the MCP spec:

1. MCP client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`
2. Client registers via `/register` (Dynamic Client Registration)
3. Client initiates OAuth with PKCE at `/authorize`
4. Server redirects to `/consent` which checks `Cf-Access-Authenticated-User-Email` header
5. If user passes Cloudflare Access policy, consent is granted
6. Client exchanges code for token at `/token`
7. Client accesses `/mcp` with `Authorization: Bearer <token>`

**Required Cloudflare Setup:**
- Cloudflare Tunnel exposing this server
- Access Application protecting the tunnel
- Identity provider configured in Cloudflare Access

### Next Steps Checklist

- [ ] Rebuild Docker image: `docker compose build --no-cache`
- [ ] Restart container: `docker compose up -d`
- [ ] Verify `/health` returns booleans only
- [ ] Verify `/.well-known/oauth-authorization-server` returns JSON
- [ ] Test full OAuth flow via MCP client
- [ ] Verify Cloudflare Access headers are received at `/consent`
