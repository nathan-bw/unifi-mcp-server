# UniFi MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for managing UniFi networks through Claude or other MCP clients.

## Features

- **Network Monitoring** - List clients, access points, and network health
- **Device Management** - Block/unblock devices, restart APs, force reconnections
- **Search** - Find devices by name, IP, or MAC address
- **Secure Access** - Google OAuth authentication with email allowlisting
- **Remote Ready** - Designed for access via Cloudflare Tunnel

## Quick Start

```bash
# 1. Clone and setup
cp .env.example .env
# Edit .env with your credentials (see SETUP.md)

# 2. Start with Docker
docker-compose up -d

# 3. Open http://localhost:3000 and login with Google
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

## Example Usage

Once connected to Claude:

```
"List all devices on my network"
"Find any devices with 'iPhone' in the name"
"Block the device with MAC aa:bb:cc:dd:ee:ff"
"Show me the status of all access points"
"Restart the living room AP"
```

## Architecture

```
Claude Desktop → Cloudflare Tunnel → Docker Container → UniFi Controller
                     (HTTPS)         (Google OAuth)      (Local API)
```

## Configuration

Required environment variables:

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Random secret for sessions |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated allowed emails |
| `UNIFI_HOST` | UniFi controller IP address |
| `UNIFI_USERNAME` | UniFi admin username |
| `UNIFI_PASSWORD` | UniFi admin password |

## Tech Stack

- Node.js 22 with ES Modules
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) v1.25+
- [node-unifi](https://github.com/jens-maus/node-unifi) v2.5+
- Express.js with Passport (Google OAuth)
- Docker with Alpine Linux

## License

MIT
