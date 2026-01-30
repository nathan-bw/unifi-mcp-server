# UniFi MCP Server - Setup Guide

This guide walks you through setting up the UniFi MCP Server with Google OAuth authentication and Cloudflare Tunnel access.

## Prerequisites

- [ ] Docker and Docker Compose installed
- [ ] UniFi Dream Machine/Controller on your local network
- [ ] Google Cloud account (for OAuth)
- [ ] Existing Cloudflare Tunnel (you mentioned you have this already)

---

## Step 1: Create Environment File

```bash
cp .env.example .env
```

Open `.env` in your editor and fill in the values (see sections below).

---

## Step 2: Generate Session Secret

Generate a secure random secret:

```bash
openssl rand -hex 32
```

Copy the output to `SESSION_SECRET` in your `.env` file.

---

## Step 3: Configure UniFi Controller

In your `.env` file, set:

```bash
UNIFI_HOST=192.168.1.1        # Your Dream Machine IP
UNIFI_PORT=443                # Usually 443 for UDM
UNIFI_USERNAME=your-admin     # UniFi admin username
UNIFI_PASSWORD=your-password  # UniFi admin password
UNIFI_SITE=default            # Usually "default"
```

**Note:** Create a dedicated local admin account on your UniFi controller for this server.

---

## Step 4: Set Up Google OAuth

### 4.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., "UniFi MCP Server")
3. Select the project

### 4.2 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (or Internal if using Google Workspace)
3. Fill in required fields:
   - App name: "UniFi MCP Server"
   - User support email: your email
   - Developer contact: your email
4. Click **Save and Continue**
5. Skip Scopes (we only need email/profile which are default)
6. Add your email as a test user if using External
7. **Save and Continue** until complete

### 4.3 Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Application type: **Web application**
4. Name: "UniFi MCP Server"
5. **Authorized redirect URIs** - Add BOTH:
   - `http://localhost:3000/auth/google/callback` (for local testing)
   - `https://YOUR-TUNNEL-DOMAIN.com/auth/google/callback` (for production)
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### 4.4 Update .env

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_CALLBACK_URL=https://YOUR-TUNNEL-DOMAIN.com/auth/google/callback
ALLOWED_EMAILS=your-email@gmail.com
```

**Important:** The `OAUTH_CALLBACK_URL` must match exactly what you added in Google Console.

---

## Step 5: Configure Cloudflare Tunnel

Since you already have a Cloudflare Tunnel, add a public hostname:

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks** → **Tunnels**
3. Select your tunnel → **Configure**
4. Add a **Public Hostname**:
   - **Subdomain**: e.g., `unifi-mcp`
   - **Domain**: your domain
   - **Service**: `http://localhost:3000` (or your Docker host IP)

The MCP server will be accessible at: `https://unifi-mcp.yourdomain.com`

---

## Step 6: Start the Server

### Option A: Docker Compose (Recommended)

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Option B: Local Development

```bash
# Install dependencies
npm install

# Start server
npm start

# Or with hot-reload
npm run dev
```

---

## Step 7: Test the Setup

### 7.1 Test Health Endpoint

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok",...,"authEnabled":true,"unifiEnabled":true}`

### 7.2 Test OAuth Flow

1. Open `http://localhost:3000` in browser
2. Click "Login with Google"
3. Complete Google sign-in
4. Should redirect to dashboard showing your email

### 7.3 Test via Cloudflare Tunnel

1. Open `https://unifi-mcp.yourdomain.com`
2. Complete OAuth flow
3. Verify dashboard loads

### 7.4 Test MCP Connection

After OAuth login, test the MCP endpoint:

```bash
curl -X POST https://unifi-mcp.yourdomain.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

---

## Step 8: Configure Claude Desktop

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "unifi": {
      "url": "https://unifi-mcp.yourdomain.com/mcp"
    }
  }
}
```

**Note:** Claude Desktop will need to handle the OAuth flow. You may need to authenticate in a browser first and ensure your session cookie is valid.

---

## Troubleshooting

### "Authentication required" error
- Ensure you've completed the Google OAuth flow in a browser
- Check that your email is in `ALLOWED_EMAILS`

### "UniFi controller not configured"
- Verify `UNIFI_HOST`, `UNIFI_USERNAME`, `UNIFI_PASSWORD` are set
- Ensure the Docker container can reach your UniFi controller IP

### OAuth redirect errors
- Verify `OAUTH_CALLBACK_URL` matches exactly in both `.env` and Google Console
- Check both `http://` and `https://` variants are added if testing locally

### Connection refused to UniFi
- UniFi controller must be reachable from Docker network
- Try: `docker exec unifi-mcp-server ping YOUR_UNIFI_IP`
- For Docker Desktop on Mac, use host.docker.internal or the actual IP

### Docker networking issues on Mac
If the container can't reach your UniFi controller:

```yaml
# In docker-compose.yml, add:
services:
  unifi-mcp-server:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then use `host.docker.internal` as `UNIFI_HOST` if your controller is on the same machine.

---

## Security Recommendations

1. **Use strong session secret** - Generate with `openssl rand -hex 32`
2. **Limit allowed emails** - Only add trusted emails to `ALLOWED_EMAILS`
3. **Create dedicated UniFi account** - Don't use your main admin account
4. **Use Cloudflare Access** - Add additional layer of protection via Cloudflare Access policies
5. **Monitor access logs** - Check `docker-compose logs` regularly

---

## Quick Reference

| URL | Purpose |
|-----|---------|
| `/` | Dashboard |
| `/health` | Health check (no auth) |
| `/auth/google` | Start OAuth flow |
| `/logout` | End session |
| `/mcp` | MCP endpoint (requires auth) |
