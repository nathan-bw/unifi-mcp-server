# UniFi MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for managing UniFi networks through Claude Desktop or other MCP clients.

## Features

- **18 MCP Tools** - Comprehensive network management capabilities
- **OAuth 2.1 + PKCE** - Secure authentication with Cloudflare Access
- **API Key Authentication** - Uses official UniFi API with X-API-KEY
- **MCP 2025-11-25 Compliant** - Full specification compliance
- **Remote Ready** - Designed for access via Cloudflare Tunnel

## Quick Start

### 1. Generate UniFi API Key

In your UniFi Controller/UDM:
- Go to **Settings → Control Plane → Integrations**
- Click **Generate API Key**
- Copy the key

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
# Server
BASE_URL=https://your-domain.com

# Cloudflare Access for SaaS (OAuth identity provider)
CF_ACCESS_TEAM=your-team-name
CF_CLIENT_ID=your-client-id
CF_CLIENT_SECRET=your-client-secret

# UniFi Controller
UNIFI_HOST=192.168.1.1
UNIFI_API_KEY=your-api-key-from-step-1
```

### 3. Start with Docker

```bash
docker compose up -d
```

### 4. Configure Cloudflare

1. Create a **Cloudflare Tunnel** pointing to your server
2. Create an **Access for SaaS** application in Zero Trust:
   - Protocol: OIDC
   - Redirect URL: `https://your-domain.com/callback`
3. Connect with Claude Desktop using your tunnel URL

## Available Tools

### Client Management
| Tool | Description |
|------|-------------|
| `list_clients` | List all connected devices |
| `get_client` | Get details for a specific client by MAC |
| `search_devices` | Search by name, IP, or MAC |
| `block_client` | Block a device from the network |
| `unblock_client` | Unblock a device |
| `reconnect_client` | Force a client to reconnect |
| `list_blocked_clients` | List blocked devices |

### Device Management
| Tool | Description |
|------|-------------|
| `list_devices` | List all UniFi devices (APs, switches, gateways) |
| `list_access_points` | List access points with status |
| `restart_device` | Restart an AP or switch |

### Network Configuration
| Tool | Description |
|------|-------------|
| `list_networks` | List VLANs and subnets |
| `list_wlans` | List wireless SSIDs |
| `list_port_forwards` | List port forwarding rules |

### Monitoring
| Tool | Description |
|------|-------------|
| `get_network_health` | Network health statistics |
| `list_events` | Recent network events |
| `list_alarms` | Active and recent alarms |

## Architecture

```
Claude Desktop
      ↓
Cloudflare Tunnel (secure tunnel)
      ↓
UniFi MCP Server (OAuth 2.1 + MCP)
      ↓
UniFi Controller/UDM (X-API-KEY)
```

## Authentication Flow

This server implements OAuth 2.1 with Cloudflare Access as the identity provider:

1. MCP client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`
2. Client initiates OAuth flow to `/authorize` with PKCE
3. User authenticates via Cloudflare Access (supports Entra ID, Google, etc.)
4. Upon approval, client exchanges code for tokens at `/token`
5. Client accesses `/mcp` with Bearer token

### OAuth Endpoints

| Endpoint | Description |
|----------|-------------|
| `/.well-known/oauth-authorization-server` | Authorization server metadata |
| `/.well-known/oauth-protected-resource/mcp` | Protected resource metadata (RFC 9728) |
| `/authorize` | Authorization endpoint (auto-registers clients) |
| `/token` | Token endpoint |
| `/register` | Dynamic client registration |
| `/callback` | Cloudflare OAuth callback |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | Yes | Public URL for OAuth redirects |
| `CF_ACCESS_TEAM` | Yes | Cloudflare Access team name |
| `CF_CLIENT_ID` | Yes | From Access for SaaS app |
| `CF_CLIENT_SECRET` | Yes | From Access for SaaS app |
| `UNIFI_HOST` | Yes | UniFi controller IP |
| `UNIFI_PORT` | No | Controller port (default: 443) |
| `UNIFI_API_KEY` | Yes | API key from UniFi |
| `UNIFI_SITE` | No | Site name (default: "default") |

## Security

- **OAuth 2.1 + PKCE** - Secure token exchange
- **Cloudflare Tunnel** - No direct IP exposure
- **Cloudflare Access** - Identity verification at the edge
- **API Key Auth** - No passwords stored, scoped access

### Recommended WAF Rules

Consider blocking non-essential paths:
- Allow: `/.well-known/*`, `/register`, `/authorize`, `/callback`, `/token`, `/mcp`
- Block or protect: `/`, `/health`

## Tech Stack

- Node.js 22 with ES Modules
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- Express.js
- Docker with Alpine Linux

## Development

```bash
# Install dependencies
npm install

# Run with hot-reload
npm run dev

# Check syntax
node --check server.js
```

## License

MIT
