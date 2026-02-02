# UniFi MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for managing UniFi networks through Claude or other MCP clients.

## Features

- **Network Monitoring** - List clients, access points, and network health
- **Device Management** - Block/unblock devices, restart APs, force reconnections
- **Search** - Find devices by name, IP, or MAC address
- **OAuth 2.1 Authentication** - Full MCP OAuth 2.1 compliance with PKCE
- **Cloudflare Access Integration** - Uses Cloudflare Access as the identity provider
- **Remote Ready** - Designed for access via Cloudflare Tunnel

## Quick Start

```bash
# 1. Clone and setup
cp .env.example .env
# Edit .env with your UniFi credentials and BASE_URL

# 2. Start with Docker
docker compose up -d

# 3. Configure Cloudflare Tunnel + Access (see SETUP.md)
```

See [SETUP.md](SETUP.md) for detailed configuration instructions.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_clients` | List all connected devices |
| `get_client` | Get details for a specific client |
| `search_devices` | Search by name, IP, or MAC |
| `list_access_points` | List all APs with status |
| `get_network_health` | Network health statistics |
| `block_client` | Block a device from the network |
| `unblock_client` | Unblock a device |
| `reconnect_client` | Force a client to reconnect |
| `restart_device` | Restart an AP or switch |
| `list_blocked_clients` | List blocked devices |

## Architecture

```
MCP Client → Cloudflare Access → Cloudflare Tunnel → MCP Server → UniFi Controller
              (Edge Auth)         (Secure tunnel)     (OAuth 2.1)    (Local API)
```

## Authentication

This server implements a **two-layer authentication** approach:

### Layer 1: Cloudflare Access (Edge)
- All requests must pass through Cloudflare Access before reaching your server
- Supports any identity provider (Google, GitHub, Okta, SAML, etc.)
- Adds `Cf-Access-Authenticated-User-Email` header to authenticated requests

### Layer 2: OAuth 2.1 (MCP Protocol)
- Implements the MCP OAuth 2.1 specification for client authorization
- Full PKCE support for secure token exchange
- Dynamic client registration for MCP clients
- The consent page uses the Cloudflare Access identity

### OAuth 2.1 Endpoints

| Endpoint | Description |
|----------|-------------|
| `/.well-known/oauth-authorization-server` | Authorization server metadata |
| `/.well-known/oauth-protected-resource` | Protected resource metadata |
| `/oauth/authorize` | Authorization endpoint |
| `/oauth/token` | Token endpoint |
| `/oauth/register` | Dynamic client registration |
| `/consent` | User consent page (uses CF Access identity) |

### How It Works

1. MCP client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`
2. Client registers dynamically via `/oauth/register`
3. Client initiates OAuth flow to `/oauth/authorize` with PKCE
4. User is redirected to `/consent` where Cloudflare Access identity is used
5. Upon approval, client exchanges code for tokens at `/oauth/token`
6. Client accesses `/mcp` with Bearer token

## Configuration

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `BASE_URL` | Public URL of the server (for OAuth redirects) |
| `CF_ACCESS_TEAM` | Cloudflare Access team name (optional, for validation) |
| `CF_ACCESS_AUD` | Application Audience tag for JWT validation (optional) |
| `ALLOWED_EMAILS` | Comma-separated list of allowed emails (optional) |
| `UNIFI_HOST` | UniFi controller IP address |
| `UNIFI_PORT` | UniFi controller port (default: 443) |
| `UNIFI_USERNAME` | UniFi admin username |
| `UNIFI_PASSWORD` | UniFi admin password |
| `UNIFI_SITE` | UniFi site name (default: "default") |

## Using with Cloudflare MCP Portal

This server is designed to work with the [Cloudflare MCP Portal](https://developers.cloudflare.com/mcp):

1. Deploy behind Cloudflare Tunnel with Access
2. Set `BASE_URL` to your public Cloudflare URL
3. Add to Cloudflare MCP Portal using your tunnel URL

The Portal will discover OAuth endpoints and guide users through authentication.

## Tech Stack

- Node.js 22 with ES Modules
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) v1.25+
- [mcp-oauth-server](https://www.npmjs.com/package/mcp-oauth-server) v0.0.3+
- [node-unifi](https://github.com/jens-maus/node-unifi) v2.5+
- Express.js
- Docker with Alpine Linux

## License

MIT
