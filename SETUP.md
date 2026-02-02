# UniFi MCP Server - Setup Guide

This guide walks you through setting up the UniFi MCP Server with OAuth 2.1 and Cloudflare Access authentication.

## Prerequisites

- Docker and Docker Compose installed
- UniFi Dream Machine/Controller on your local network
- Cloudflare account with a domain
- Cloudflare Tunnel configured (or ability to create one)

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/nathan-bw/unifi-mcp-server.git
cd unifi-mcp-server
```

---

## Step 2: Configure UniFi Credentials

### 2.1 Create a UniFi Admin Account (Recommended)

Create a dedicated local admin account for the MCP server:

1. Log into your UniFi Controller
2. Go to **Settings** → **Admins**
3. Click **Add Admin**
4. Create a local account (not cloud/SSO):
   - Username: `mcp-server`
   - Password: (generate a strong password)
   - Role: Admin (or a limited role if you prefer)
5. Save the credentials

### 2.2 Create Environment File

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Server Settings
PORT=3000
BASE_URL=http://localhost:3000  # Change to your Cloudflare URL in production

# UniFi Controller Settings
UNIFI_HOST=192.168.1.1        # Your Dream Machine/Controller IP
UNIFI_PORT=443                # Usually 443
UNIFI_USERNAME=mcp-server     # The admin username you created
UNIFI_PASSWORD=your-password  # The admin password
UNIFI_SITE=default            # Usually "default"

# Optional: Cloudflare Access Settings
# CF_ACCESS_TEAM=myteam       # Your Cloudflare Access team name
# ALLOWED_EMAILS=             # Comma-separated list of allowed emails
```

---

## Step 3: Test Locally

Start the server to verify everything works:

```bash
docker compose up -d
docker compose logs -f
```

You should see:
```
  Port:       3000
  Base URL:   http://localhost:3000
  UniFi:      192.168.1.1
  OAuth:      Enabled (mcp-oauth-server)
```

Test the OAuth metadata endpoint:
```bash
curl http://localhost:3000/.well-known/oauth-authorization-server
```

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Visit `http://localhost:3000` to see the dashboard.

---

## Step 4: Set Up Cloudflare Tunnel

### 4.1 Create a Tunnel

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks** → **Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** connector
5. Name it (e.g., `unifi-mcp`)
6. Install cloudflared on your server:

```bash
# Download cloudflared for ARM64 (Raspberry Pi)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# Authenticate (follow the browser prompt)
cloudflared tunnel login

# Create and configure the tunnel
cloudflared tunnel create unifi-mcp
```

### 4.2 Configure the Tunnel

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: unifi-mcp.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 4.3 Run as a Service

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

---

## Step 5: Set Up Cloudflare Access

### 5.1 Create an Access Application

1. In Zero Trust Dashboard, go to **Access** → **Applications**
2. Click **Add an application**
3. Select **Self-hosted**
4. Configure:
   - **Application name**: UniFi MCP Server
   - **Session duration**: 24 hours (or your preference)
   - **Application domain**: `unifi-mcp.yourdomain.com`
5. Click **Next**

### 5.2 Create an Access Policy

1. **Policy name**: Allow authorized users
2. **Action**: Allow
3. **Include rules** - choose one or more:
   - **Emails**: specific email addresses
   - **Email domains**: `@yourdomain.com`
   - **Identity provider groups**: if using IdP groups
4. Click **Next** → **Add application**

### 5.3 How It Works

Cloudflare Access automatically adds the `Cf-Access-Authenticated-User-Email` header to requests that pass authentication. The MCP server uses this header on the consent page to identify users during the OAuth flow.

---

## Step 6: Configure Production Settings

Update your `.env` file with your Cloudflare URL:

```bash
# Production settings
BASE_URL=https://unifi-mcp.yourdomain.com

# Optional: Cloudflare Access team for validation
CF_ACCESS_TEAM=myteam

# Optional: Restrict to specific emails
ALLOWED_EMAILS=user1@example.com,user2@example.com
```

Restart the server:
```bash
docker compose down
docker compose up -d
```

---

## Step 7: Connect MCP Clients

### Cloudflare MCP Portal

1. Go to the [Cloudflare MCP Portal](https://developers.cloudflare.com/mcp)
2. Add your server URL: `https://unifi-mcp.yourdomain.com/mcp`
3. The portal will discover OAuth endpoints automatically
4. Follow the OAuth flow to authorize

### Claude Desktop (with OAuth)

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unifi": {
      "url": "https://unifi-mcp.yourdomain.com/mcp"
    }
  }
}
```

Claude will detect the OAuth requirement and guide you through authentication.

### Manual OAuth Flow

For testing or custom clients:

1. **Discover endpoints**:
   ```bash
   curl https://unifi-mcp.yourdomain.com/.well-known/oauth-authorization-server
   ```

2. **Register client** (if needed):
   ```bash
   curl -X POST https://unifi-mcp.yourdomain.com/oauth/register \
     -H "Content-Type: application/json" \
     -d '{"client_name": "My Client", "redirect_uris": ["http://localhost:8080/callback"]}'
   ```

3. **Start OAuth flow** - redirect user to:
   ```
   https://unifi-mcp.yourdomain.com/oauth/authorize?
     client_id=<client_id>&
     redirect_uri=<redirect_uri>&
     response_type=code&
     code_challenge=<challenge>&
     code_challenge_method=S256&
     scope=mcp:tools
   ```

4. **Exchange code for token**:
   ```bash
   curl -X POST https://unifi-mcp.yourdomain.com/oauth/token \
     -d "grant_type=authorization_code&code=<code>&redirect_uri=<uri>&code_verifier=<verifier>"
   ```

5. **Access MCP endpoint**:
   ```bash
   curl https://unifi-mcp.yourdomain.com/mcp \
     -H "Authorization: Bearer <access_token>"
   ```

---

## Troubleshooting

### "UniFi controller not configured"
- Verify `UNIFI_HOST`, `UNIFI_USERNAME`, `UNIFI_PASSWORD` are set in `.env`
- Ensure the server can reach the UniFi controller IP

### OAuth flow issues
- Verify `BASE_URL` matches your actual server URL (including https://)
- Check the OAuth metadata: `curl <BASE_URL>/.well-known/oauth-authorization-server`
- Check server logs: `docker compose logs -f`

### "Authentication Required" on consent page
- This appears when not behind Cloudflare Access
- For development, a "Continue without auth" button is available
- In production, ensure you're accessing via Cloudflare tunnel

### "Access Denied" on consent page
- Your email is not in the `ALLOWED_EMAILS` list
- Either add your email to the list or clear the variable to allow all

### Connection refused to UniFi
- Verify the UniFi controller IP is correct
- For Docker on Raspberry Pi, the container should be able to reach local IPs
- Test with: `docker exec unifi-mcp-server ping <UNIFI_IP>`

### Cloudflare Tunnel not connecting
- Check tunnel status: `cloudflared tunnel info <tunnel-name>`
- View logs: `sudo journalctl -u cloudflared -f`

---

## Security Architecture

This server implements two layers of security:

### Layer 1: Cloudflare Access (Edge)
- Authentication happens at Cloudflare's edge before reaching your server
- Supports multiple identity providers (Google, GitHub, Okta, SAML, etc.)
- DDoS protection and WAF included
- No direct exposure of your server to the internet

### Layer 2: OAuth 2.1 (MCP Protocol)
- Full OAuth 2.1 compliance for MCP client authorization
- PKCE (Proof Key for Code Exchange) required for all flows
- Dynamic client registration
- Token refresh support

### Recommendations

1. **Create dedicated UniFi account** - Don't use your main admin account
2. **Use Cloudflare Access policies** - Restrict by email, IP, or identity provider
3. **Enable email allowlist** - Set `ALLOWED_EMAILS` for additional server-side validation
4. **Monitor access logs** - Check `docker compose logs` regularly
5. **Keep tokens secure** - OAuth tokens provide full access to your UniFi network

---

## Quick Reference

| URL | Purpose | Auth Required |
|-----|---------|---------------|
| `/` | Dashboard | No (shows status) |
| `/health` | Health check | No |
| `/.well-known/oauth-authorization-server` | OAuth metadata | No |
| `/.well-known/oauth-protected-resource` | Resource metadata | No |
| `/oauth/authorize` | Start OAuth flow | Cloudflare Access |
| `/oauth/token` | Token exchange | No (uses client credentials) |
| `/oauth/register` | Client registration | No |
| `/consent` | User consent page | Cloudflare Access |
| `/mcp` | MCP endpoint | OAuth Bearer token |
