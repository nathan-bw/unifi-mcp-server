/**
 * UniFi MCP Server
 *
 * A Model Context Protocol server for managing UniFi networks.
 * Uses Streamable HTTP transport for remote access.
 * Implements OAuth 2.1 with Cloudflare Access as the identity provider.
 */

import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import Unifi from 'node-unifi';
import { OAuthServer, mcpAuthRouter, authenticateHandler, requireBearerAuth } from 'mcp-oauth-server';

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Cloudflare Access configuration
const CF_ACCESS_TEAM = process.env.CF_ACCESS_TEAM; // e.g., 'myteam' for myteam.cloudflareaccess.com
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD; // Application Audience (AUD) tag
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// UniFi configuration
const UNIFI_HOST = process.env.UNIFI_HOST;
const UNIFI_PORT = parseInt(process.env.UNIFI_PORT || '443', 10);
const UNIFI_USERNAME = process.env.UNIFI_USERNAME;
const UNIFI_PASSWORD = process.env.UNIFI_PASSWORD;
const UNIFI_SITE = process.env.UNIFI_SITE || 'default';
// SECURITY: Must use !! to coerce to boolean - otherwise && returns the password string
const UNIFI_ENABLED = Boolean(UNIFI_HOST && UNIFI_USERNAME && UNIFI_PASSWORD);

// Startup info
console.log('');
console.log('='.repeat(50));
console.log('  UniFi MCP Server - Starting');
console.log('='.repeat(50));
if (!CF_ACCESS_TEAM) {
  console.warn('⚠️  CF_ACCESS_TEAM not set. Cloudflare Access integration disabled.');
}
if (!UNIFI_ENABLED) {
  console.warn('⚠️  UniFi controller not configured. UniFi tools will return errors.');
}

// =============================================================================
// OAuth 2.1 Server Setup
// =============================================================================

const oauthServer = new OAuthServer({
  authorizationUrl: new URL(`${BASE_URL}/consent`),
  scopesSupported: ['mcp:tools', 'mcp:read', 'mcp:write'],
  accessTokenLifetime: 3600, // 1 hour
  refreshTokenLifetime: 86400 * 7, // 7 days
});

// =============================================================================
// UniFi Controller Class
// =============================================================================

class UniFiController {
  constructor() {
    this.controller = null;
    this.connected = false;
  }

  async connect() {
    if (!UNIFI_ENABLED) {
      throw new Error('UniFi controller not configured. Set UNIFI_HOST, UNIFI_USERNAME, and UNIFI_PASSWORD.');
    }

    if (this.connected) {
      return;
    }

    this.controller = new Unifi.Controller({
      host: UNIFI_HOST,
      port: UNIFI_PORT,
      sslverify: false,
    });

    await this.controller.login(UNIFI_USERNAME, UNIFI_PASSWORD);
    this.connected = true;
    console.log('[UniFi] Connected to controller');
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  async getClients() {
    await this.ensureConnected();
    const clients = await this.controller.getClientDevices(UNIFI_SITE);
    return clients.map(c => ({
      mac: c.mac,
      hostname: c.hostname || c.name || 'Unknown',
      ip: c.ip || 'N/A',
      oui: c.oui || '',
      isWired: c.is_wired || false,
      network: c.network || '',
      experience: c.satisfaction || null,
      signalStrength: c.signal || null,
      txRate: c.tx_rate || null,
      rxRate: c.rx_rate || null,
      uptime: c.uptime || 0,
      lastSeen: c.last_seen ? new Date(c.last_seen * 1000).toISOString() : null,
      txBytes: c.tx_bytes || 0,
      rxBytes: c.rx_bytes || 0,
      apMac: c.ap_mac || null,
      isBlocked: c.blocked || false,
      isGuest: c.is_guest || false,
    }));
  }

  async getClient(mac) {
    await this.ensureConnected();
    const clients = await this.controller.getClientDevices(UNIFI_SITE, mac);
    return clients[0] || null;
  }

  async getAccessPoints() {
    await this.ensureConnected();
    const devices = await this.controller.getAccessDevices(UNIFI_SITE);
    return devices.map(d => ({
      mac: d.mac,
      name: d.name || 'Unnamed AP',
      model: d.model || 'Unknown',
      ip: d.ip || 'N/A',
      state: d.state === 1 ? 'connected' : 'disconnected',
      adopted: d.adopted || false,
      version: d.version || '',
      uptime: d.uptime || 0,
      numClients: d.num_sta || 0,
      experience: d.satisfaction || null,
      channel2g: d['ng-channel'] || null,
      channel5g: d['na-channel'] || null,
      txPower2g: d['ng-tx_power'] || null,
      txPower5g: d['na-tx_power'] || null,
    }));
  }

  async getHealth() {
    await this.ensureConnected();
    const health = await this.controller.getHealth(UNIFI_SITE);
    return health;
  }

  async getSiteStats() {
    await this.ensureConnected();
    const stats = await this.controller.getSitesStats();
    return stats.find(s => s.name === UNIFI_SITE) || stats[0];
  }

  async blockClient(mac) {
    await this.ensureConnected();
    await this.controller.blockClient(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Blocked client ${mac}` };
  }

  async unblockClient(mac) {
    await this.ensureConnected();
    await this.controller.unblockClient(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Unblocked client ${mac}` };
  }

  async reconnectClient(mac) {
    await this.ensureConnected();
    await this.controller.reconnectClient(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Reconnected client ${mac}` };
  }

  async restartDevice(mac) {
    await this.ensureConnected();
    await this.controller.restartDevice(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Restart initiated for device ${mac}` };
  }

  async getBlockedClients() {
    await this.ensureConnected();
    const blocked = await this.controller.getBlockedUsers(UNIFI_SITE);
    return blocked;
  }
}

const unifi = new UniFiController();

// =============================================================================
// MCP Server Setup
// =============================================================================

function createMcpServer() {
  const server = new McpServer({
    name: 'unifi-mcp-server',
    version: '1.0.0',
  });

  // Tool: List Clients
  server.registerTool('list_clients', {
    title: 'List Network Clients',
    description: 'List all devices currently connected to the UniFi network.',
  }, async () => {
    try {
      const clients = await unifi.getClients();
      return { content: [{ type: 'text', text: JSON.stringify({ count: clients.length, clients }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Get Client
  server.registerTool('get_client', {
    title: 'Get Client Details',
    description: 'Get detailed information about a specific client by MAC address.',
    inputSchema: { mac: z.string().describe('MAC address (format: aa:bb:cc:dd:ee:ff)') },
  }, async ({ mac }) => {
    try {
      const client = await unifi.getClient(mac);
      if (!client) return { content: [{ type: 'text', text: `No client found with MAC: ${mac}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(client, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Search Devices
  server.registerTool('search_devices', {
    title: 'Search Devices',
    description: 'Search for devices by hostname, IP, or MAC address.',
    inputSchema: { query: z.string().describe('Search query') },
  }, async ({ query }) => {
    try {
      const clients = await unifi.getClients();
      const q = query.toLowerCase();
      const results = clients.filter(c =>
        c.hostname.toLowerCase().includes(q) ||
        c.ip.toLowerCase().includes(q) ||
        c.mac.toLowerCase().includes(q)
      );
      return { content: [{ type: 'text', text: JSON.stringify({ query, count: results.length, results }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List Access Points
  server.registerTool('list_access_points', {
    title: 'List Access Points',
    description: 'List all UniFi access points with status and metrics.',
  }, async () => {
    try {
      const aps = await unifi.getAccessPoints();
      return { content: [{ type: 'text', text: JSON.stringify({ count: aps.length, accessPoints: aps }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Get Network Health
  server.registerTool('get_network_health', {
    title: 'Get Network Health',
    description: 'Get overall network health statistics.',
  }, async () => {
    try {
      const health = await unifi.getHealth();
      const stats = await unifi.getSiteStats();
      return { content: [{ type: 'text', text: JSON.stringify({ health, siteStats: stats }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Block Client
  server.registerTool('block_client', {
    title: 'Block Client',
    description: 'Block a client device from the network by MAC address.',
    inputSchema: { mac: z.string().describe('MAC address to block') },
  }, async ({ mac }) => {
    try {
      const result = await unifi.blockClient(mac);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Unblock Client
  server.registerTool('unblock_client', {
    title: 'Unblock Client',
    description: 'Unblock a previously blocked client device.',
    inputSchema: { mac: z.string().describe('MAC address to unblock') },
  }, async ({ mac }) => {
    try {
      const result = await unifi.unblockClient(mac);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Reconnect Client
  server.registerTool('reconnect_client', {
    title: 'Reconnect Client',
    description: 'Force a client to disconnect and reconnect.',
    inputSchema: { mac: z.string().describe('MAC address to reconnect') },
  }, async ({ mac }) => {
    try {
      const result = await unifi.reconnectClient(mac);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Restart Device
  server.registerTool('restart_device', {
    title: 'Restart Device',
    description: 'Restart a UniFi device (AP, switch, etc.) by MAC address.',
    inputSchema: { mac: z.string().describe('MAC address of device to restart') },
  }, async ({ mac }) => {
    try {
      const result = await unifi.restartDevice(mac);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List Blocked Clients
  server.registerTool('list_blocked_clients', {
    title: 'List Blocked Clients',
    description: 'List all clients currently blocked from the network.',
  }, async () => {
    try {
      const blocked = await unifi.getBlockedClients();
      return { content: [{ type: 'text', text: JSON.stringify({ count: blocked.length, blockedClients: blocked }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: Echo (testing)
  server.registerTool('echo', {
    title: 'Echo',
    description: 'Echoes back the provided message for testing.',
    inputSchema: { message: z.string().describe('Message to echo') },
  }, async ({ message }) => ({
    content: [{ type: 'text', text: `Echo: ${message}` }],
  }));

  return server;
}

// =============================================================================
// Express App Setup
// =============================================================================

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store for pending authorizations and MCP transports
const pendingAuth = new Map();
const transports = new Map();

// =============================================================================
// OAuth 2.1 Routes (via mcp-oauth-server)
// =============================================================================

// Mount OAuth router at root (provides /.well-known/oauth-*, /authorize, /token, etc.)
app.use(mcpAuthRouter({
  provider: oauthServer,
  issuerUrl: new URL(BASE_URL),
  resourceServerUrl: new URL(`${BASE_URL}/mcp`),
  scopesSupported: ['mcp:tools', 'mcp:read', 'mcp:write'],
  clientRegistrationOptions: {
    clientIdGeneration: true,
  },
}));

// =============================================================================
// Consent Page - Integrates with Cloudflare Access
// =============================================================================

/**
 * GET /consent - Shows consent page or redirects to Cloudflare Access
 *
 * The OAuth flow redirects here. We check for Cloudflare Access headers.
 * If not authenticated via CF Access, we show a login prompt.
 * If authenticated, we show the consent form.
 */
app.get('/consent', (req, res) => {
  // Store OAuth params
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, response_type } = req.query;

  // Check for Cloudflare Access authentication
  const cfEmail = req.headers['cf-access-authenticated-user-email'];

  // Store the auth request
  const authId = randomUUID();
  pendingAuth.set(authId, {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope,
    response_type,
    email: cfEmail,
    created: Date.now(),
  });

  // Clean up old pending auths (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [id, auth] of pendingAuth.entries()) {
    if (auth.created < tenMinutesAgo) pendingAuth.delete(id);
  }

  if (cfEmail) {
    // User is authenticated via Cloudflare Access
    // Check email allowlist if configured
    if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(cfEmail.toLowerCase())) {
      return res.status(403).send(`
        <!DOCTYPE html><html><head><title>Access Denied</title>
        <style>body{font-family:system-ui;max-width:500px;margin:100px auto;text-align:center;}h1{color:#c62828;}</style>
        </head><body><h1>Access Denied</h1><p>Your email (${cfEmail}) is not authorized.</p></body></html>
      `);
    }

    // Show consent page
    res.send(`
      <!DOCTYPE html><html><head><title>Authorize - UniFi MCP Server</title>
      <style>
        body{font-family:system-ui;max-width:500px;margin:50px auto;padding:20px;}
        h1{color:#333;border-bottom:2px solid #f48120;padding-bottom:10px;}
        .box{padding:20px;background:#f5f5f5;border-radius:8px;margin:20px 0;}
        .email{font-weight:bold;color:#1976d2;}
        .scopes{margin:15px 0;}
        .scope{display:inline-block;background:#e3f2fd;padding:4px 12px;border-radius:4px;margin:4px;}
        .buttons{margin-top:20px;}
        button{padding:12px 24px;font-size:16px;border:none;border-radius:6px;cursor:pointer;margin-right:10px;}
        .approve{background:#4caf50;color:white;}
        .deny{background:#757575;color:white;}
      </style>
      </head><body>
        <h1>Authorize Application</h1>
        <div class="box">
          <p>Signed in as: <span class="email">${cfEmail}</span></p>
          <p><strong>${client_id || 'An application'}</strong> is requesting access to your UniFi MCP Server.</p>
          <div class="scopes">
            <p>Requested permissions:</p>
            ${(scope || 'mcp:tools').split(' ').map(s => `<span class="scope">${s}</span>`).join('')}
          </div>
        </div>
        <form method="POST" action="/consent/approve">
          <input type="hidden" name="auth_id" value="${authId}">
          <div class="buttons">
            <button type="submit" class="approve">Approve</button>
            <button type="submit" formaction="/consent/deny" class="deny">Deny</button>
          </div>
        </form>
      </body></html>
    `);
  } else {
    // Not authenticated via Cloudflare Access
    // In production behind CF Tunnel + Access, this shouldn't happen
    // Show a message about needing Cloudflare Access
    res.send(`
      <!DOCTYPE html><html><head><title>Authentication Required - UniFi MCP Server</title>
      <style>
        body{font-family:system-ui;max-width:500px;margin:100px auto;padding:20px;text-align:center;}
        h1{color:#333;}
        .box{padding:20px;background:#fff3e0;border-radius:8px;margin:20px 0;border-left:4px solid #ff9800;}
        code{background:#f5f5f5;padding:2px 8px;border-radius:4px;}
      </style>
      </head><body>
        <h1>Authentication Required</h1>
        <div class="box">
          <p>This server requires Cloudflare Access authentication.</p>
          <p>Please access this server through your Cloudflare Access URL.</p>
        </div>
        <p><small>Auth ID: ${authId}</small></p>
        <form method="POST" action="/consent/approve">
          <input type="hidden" name="auth_id" value="${authId}">
          <p style="color:#666;margin-top:30px;">Development mode: <button type="submit">Continue without auth</button></p>
        </form>
      </body></html>
    `);
  }
});

/**
 * POST /consent/approve - User approved the authorization
 */
app.post('/consent/approve', authenticateHandler({
  provider: oauthServer,
  getUser: (req) => {
    const authId = req.body.auth_id;
    const auth = pendingAuth.get(authId);
    if (!auth) return null;

    // Use email from Cloudflare Access or fallback
    const email = auth.email || 'dev@localhost';
    pendingAuth.delete(authId);

    console.log(`[OAuth] Approved authorization for: ${email}`);
    return email;
  },
}));

/**
 * POST /consent/deny - User denied the authorization
 */
app.post('/consent/deny', (req, res) => {
  const authId = req.body.auth_id;
  const auth = pendingAuth.get(authId);

  if (auth && auth.redirect_uri) {
    pendingAuth.delete(authId);
    const redirectUrl = new URL(auth.redirect_uri);
    redirectUrl.searchParams.set('error', 'access_denied');
    redirectUrl.searchParams.set('error_description', 'User denied the authorization request');
    if (auth.state) redirectUrl.searchParams.set('state', auth.state);
    return res.redirect(redirectUrl.toString());
  }

  res.status(400).send('Invalid request');
});

// =============================================================================
// Health & Dashboard Routes
// =============================================================================

app.get('/health', (req, res) => {
  // SECURITY: Explicitly coerce to booleans to prevent accidental secret leakage
  const response = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    unifiEnabled: UNIFI_ENABLED === true,
    oauthEnabled: true,
  };
  // Runtime assertion: fail if any value is a string (potential secret leak)
  for (const [key, value] of Object.entries(response)) {
    if (typeof value === 'string' && key !== 'status' && key !== 'timestamp') {
      console.error(`SECURITY: Health endpoint would leak string value for '${key}'`);
      return res.status(500).json({ status: 'error', message: 'Internal configuration error' });
    }
  }
  res.json(response);
});

app.get('/', (req, res) => {
  const cfEmail = req.headers['cf-access-authenticated-user-email'];

  res.send(`
    <!DOCTYPE html><html><head><title>UniFi MCP Server</title>
    <style>
      body{font-family:system-ui;max-width:700px;margin:50px auto;padding:20px;line-height:1.6;}
      h1{color:#333;border-bottom:2px solid #f48120;padding-bottom:10px;}
      .box{padding:15px;border-radius:6px;margin:15px 0;}
      .ok{background:#e8f5e9;border-left:4px solid #4caf50;}
      .warn{background:#fff3e0;border-left:4px solid #ff9800;}
      .info{background:#e3f2fd;border-left:4px solid #2196f3;}
      code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:13px;}
      pre{background:#263238;color:#aed581;padding:15px;border-radius:6px;overflow-x:auto;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin:15px 0;}
      th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;}
      th{background:#f5f5f5;}
    </style></head>
    <body>
      <h1>UniFi MCP Server</h1>

      ${cfEmail ? `
        <div class="box info"><strong>Authenticated via Cloudflare Access:</strong> ${cfEmail}</div>
      ` : `
        <div class="box warn"><strong>Not authenticated via Cloudflare Access</strong><br>Access through your Cloudflare tunnel URL for authentication.</div>
      `}

      <div class="box ${UNIFI_ENABLED ? 'ok' : 'warn'}">
        <strong>UniFi Controller:</strong> ${UNIFI_ENABLED ? `${UNIFI_HOST}:${UNIFI_PORT}` : 'Not configured'}
      </div>

      <h2>OAuth 2.1 Endpoints</h2>
      <table>
        <tr><td><code>/.well-known/oauth-authorization-server</code></td><td>Authorization server metadata</td></tr>
        <tr><td><code>/.well-known/oauth-protected-resource/mcp</code></td><td>Protected resource metadata</td></tr>
        <tr><td><code>/authorize</code></td><td>Authorization endpoint</td></tr>
        <tr><td><code>/token</code></td><td>Token endpoint</td></tr>
        <tr><td><code>/register</code></td><td>Dynamic client registration</td></tr>
      </table>

      <h2>MCP Endpoint</h2>
      <p><code>/mcp</code> - Requires OAuth 2.1 Bearer token</p>

      <h2>Available Tools</h2>
      <table>
        <tr><th>Tool</th><th>Description</th></tr>
        <tr><td><code>list_clients</code></td><td>List all connected devices</td></tr>
        <tr><td><code>get_client</code></td><td>Get details for a specific client</td></tr>
        <tr><td><code>search_devices</code></td><td>Search devices by name, IP, or MAC</td></tr>
        <tr><td><code>list_access_points</code></td><td>List all access points</td></tr>
        <tr><td><code>get_network_health</code></td><td>Get network health stats</td></tr>
        <tr><td><code>block_client</code></td><td>Block a device</td></tr>
        <tr><td><code>unblock_client</code></td><td>Unblock a device</td></tr>
        <tr><td><code>reconnect_client</code></td><td>Force client reconnect</td></tr>
        <tr><td><code>restart_device</code></td><td>Restart an AP or switch</td></tr>
        <tr><td><code>list_blocked_clients</code></td><td>List blocked devices</td></tr>
      </table>
    </body></html>
  `);
});

// =============================================================================
// MCP Endpoint (Protected by OAuth)
// =============================================================================

app.all('/mcp',
  requireBearerAuth({
    verifier: oauthServer,
    requiredScopes: ['mcp:tools'],
  }),
  async (req, res) => {
    const userId = req.auth?.userId || 'anonymous';
    console.log(`[MCP] ${req.method} request from ${userId}`);

    const mcpSessionId = req.headers['mcp-session-id'];

    if (req.method === 'GET') {
      if (!mcpSessionId || !transports.has(mcpSessionId)) {
        return res.status(400).json({ error: 'Session not found' });
      }
      await transports.get(mcpSessionId).handleRequest(req, res);
      return;
    }

    if (req.method === 'POST') {
      const body = req.body;

      if (body?.method === 'initialize') {
        const newSessionId = randomUUID();
        console.log(`[MCP] New session: ${newSessionId} for user: ${userId}`);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
        });

        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);

        transports.set(newSessionId, transport);
        transport.onclose = () => {
          console.log(`[MCP] Session closed: ${newSessionId}`);
          transports.delete(newSessionId);
        };

        await transport.handleRequest(req, res, body);
        return;
      }

      if (!mcpSessionId) {
        return res.status(400).json({ error: 'Missing mcp-session-id header' });
      }

      const transport = transports.get(mcpSessionId);
      if (!transport) {
        return res.status(404).json({ error: 'Session not found' });
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  }
);

// =============================================================================
// Error Handler
// =============================================================================

app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`  Port:       ${PORT}`);
  console.log(`  Base URL:   ${BASE_URL}`);
  console.log(`  UniFi:      ${UNIFI_ENABLED ? UNIFI_HOST : 'NOT CONFIGURED'}`);
  console.log(`  OAuth:      Enabled (mcp-oauth-server)`);
  if (CF_ACCESS_TEAM) {
    console.log(`  CF Access:  ${CF_ACCESS_TEAM}.cloudflareaccess.com`);
  }
  if (ALLOWED_EMAILS.length > 0) {
    console.log(`  Allowed:    ${ALLOWED_EMAILS.join(', ')}`);
  }
  console.log('');
  console.log(`  Dashboard:  ${BASE_URL}/`);
  console.log(`  MCP URL:    ${BASE_URL}/mcp`);
  console.log(`  OAuth Meta: ${BASE_URL}/.well-known/oauth-authorization-server`);
  console.log('='.repeat(50));
  console.log('');
});
