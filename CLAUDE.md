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
          → /oauth/register (register client)
          → /oauth/authorize (start flow with PKCE)
          → /consent (user approves, uses CF Access identity)
          → /oauth/token (exchange code for tokens)
          → /mcp (access with Bearer token)
```

### OAuth 2.1 Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/.well-known/oauth-authorization-server` | Server metadata (discovery) |
| `/.well-known/oauth-protected-resource` | Resource metadata |
| `/oauth/authorize` | Authorization endpoint |
| `/oauth/token` | Token endpoint |
| `/oauth/register` | Dynamic client registration |
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
