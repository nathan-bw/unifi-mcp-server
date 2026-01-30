/**
 * UniFi MCP Server
 *
 * A Model Context Protocol server for managing UniFi networks.
 * Uses Streamable HTTP transport for remote access.
 * Protected with Google OAuth authentication.
 */

import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import Unifi from 'node-unifi';

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const OAUTH_CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || '/auth/google/callback';
const OAUTH_ENABLED = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET;

// UniFi configuration
const UNIFI_HOST = process.env.UNIFI_HOST;
const UNIFI_PORT = parseInt(process.env.UNIFI_PORT || '443', 10);
const UNIFI_USERNAME = process.env.UNIFI_USERNAME;
const UNIFI_PASSWORD = process.env.UNIFI_PASSWORD;
const UNIFI_SITE = process.env.UNIFI_SITE || 'default';
const UNIFI_ENABLED = UNIFI_HOST && UNIFI_USERNAME && UNIFI_PASSWORD;

// Startup warnings
if (!OAUTH_ENABLED) {
  console.warn('⚠️  Google OAuth not configured. Server will run without authentication.');
}
if (!UNIFI_ENABLED) {
  console.warn('⚠️  UniFi controller not configured. UniFi tools will return errors.');
}

// =============================================================================
// UniFi Controller Class
// =============================================================================

class UniFiController {
  constructor() {
    this.controller = null;
    this.connected = false;
  }

  /**
   * Connect to the UniFi controller
   */
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

  /**
   * Ensure connected before making API calls
   */
  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  /**
   * Get all connected clients
   */
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

  /**
   * Get a specific client by MAC
   */
  async getClient(mac) {
    await this.ensureConnected();
    const clients = await this.controller.getClientDevices(UNIFI_SITE, mac);
    return clients[0] || null;
  }

  /**
   * Get all access points
   */
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

  /**
   * Get network health/dashboard
   */
  async getHealth() {
    await this.ensureConnected();
    const health = await this.controller.getHealth(UNIFI_SITE);
    return health;
  }

  /**
   * Get site statistics
   */
  async getSiteStats() {
    await this.ensureConnected();
    const stats = await this.controller.getSitesStats();
    return stats.find(s => s.name === UNIFI_SITE) || stats[0];
  }

  /**
   * Block a client
   */
  async blockClient(mac) {
    await this.ensureConnected();
    await this.controller.blockClient(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Blocked client ${mac}` };
  }

  /**
   * Unblock a client
   */
  async unblockClient(mac) {
    await this.ensureConnected();
    await this.controller.unblockClient(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Unblocked client ${mac}` };
  }

  /**
   * Force reconnect a client
   */
  async reconnectClient(mac) {
    await this.ensureConnected();
    await this.controller.reconnectClient(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Reconnected client ${mac}` };
  }

  /**
   * Restart a device (AP, switch, etc.)
   */
  async restartDevice(mac) {
    await this.ensureConnected();
    await this.controller.restartDevice(UNIFI_SITE, mac.toLowerCase());
    return { success: true, message: `Restart initiated for device ${mac}` };
  }

  /**
   * Get blocked users
   */
  async getBlockedClients() {
    await this.ensureConnected();
    const blocked = await this.controller.getBlockedUsers(UNIFI_SITE);
    return blocked;
  }
}

// Global UniFi controller instance
const unifi = new UniFiController();

// =============================================================================
// Passport Configuration (Google OAuth)
// =============================================================================

passport.serializeUser((user, done) => done(null, { email: user.email, name: user.name }));
passport.deserializeUser((user, done) => done(null, user));

if (OAUTH_ENABLED) {
  passport.use(new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: OAUTH_CALLBACK_URL,
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) {
        return done(null, false, { message: 'No email found in Google profile' });
      }
      if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
        console.log(`[Auth] Rejected login attempt from: ${email}`);
        return done(null, false, { message: 'Email not authorized' });
      }
      console.log(`[Auth] Successful login: ${email}`);
      return done(null, { email, name: profile.displayName || email });
    }
  ));
}

// =============================================================================
// MCP Server Setup
// =============================================================================

function createMcpServer() {
  const server = new McpServer({
    name: 'unifi-mcp-server',
    version: '1.0.0',
  });

  // ---------------------------------------------------------------------------
  // Tool: List Clients
  // ---------------------------------------------------------------------------
  server.registerTool(
    'list_clients',
    {
      title: 'List Network Clients',
      description: 'List all devices currently connected to the UniFi network. Returns hostname, IP, MAC, connection type, and more.',
    },
    async () => {
      try {
        const clients = await unifi.getClients();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: clients.length,
              clients: clients,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Get Client Details
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_client',
    {
      title: 'Get Client Details',
      description: 'Get detailed information about a specific client by MAC address.',
      inputSchema: {
        mac: z.string().describe('MAC address of the client (format: aa:bb:cc:dd:ee:ff)'),
      },
    },
    async ({ mac }) => {
      try {
        const client = await unifi.getClient(mac);
        if (!client) {
          return { content: [{ type: 'text', text: `No client found with MAC: ${mac}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(client, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Search Devices
  // ---------------------------------------------------------------------------
  server.registerTool(
    'search_devices',
    {
      title: 'Search Devices',
      description: 'Search for devices by hostname, IP address, or MAC address (partial matches supported).',
      inputSchema: {
        query: z.string().describe('Search query (hostname, IP, or MAC)'),
      },
    },
    async ({ query }) => {
      try {
        const clients = await unifi.getClients();
        const q = query.toLowerCase();
        const results = clients.filter(c =>
          c.hostname.toLowerCase().includes(q) ||
          c.ip.toLowerCase().includes(q) ||
          c.mac.toLowerCase().includes(q)
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query,
              count: results.length,
              results,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: List Access Points
  // ---------------------------------------------------------------------------
  server.registerTool(
    'list_access_points',
    {
      title: 'List Access Points',
      description: 'List all UniFi access points with their status, client count, and performance metrics.',
    },
    async () => {
      try {
        const aps = await unifi.getAccessPoints();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: aps.length,
              accessPoints: aps,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Get Network Health
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_network_health',
    {
      title: 'Get Network Health',
      description: 'Get overall network health statistics including WAN, LAN, and WLAN status.',
    },
    async () => {
      try {
        const health = await unifi.getHealth();
        const stats = await unifi.getSiteStats();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              health,
              siteStats: stats,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Block Client
  // ---------------------------------------------------------------------------
  server.registerTool(
    'block_client',
    {
      title: 'Block Client',
      description: 'Block a client device from the network by MAC address. The device will be disconnected and prevented from reconnecting.',
      inputSchema: {
        mac: z.string().describe('MAC address of the client to block (format: aa:bb:cc:dd:ee:ff)'),
      },
    },
    async ({ mac }) => {
      try {
        const result = await unifi.blockClient(mac);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Unblock Client
  // ---------------------------------------------------------------------------
  server.registerTool(
    'unblock_client',
    {
      title: 'Unblock Client',
      description: 'Unblock a previously blocked client device, allowing it to reconnect to the network.',
      inputSchema: {
        mac: z.string().describe('MAC address of the client to unblock (format: aa:bb:cc:dd:ee:ff)'),
      },
    },
    async ({ mac }) => {
      try {
        const result = await unifi.unblockClient(mac);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Disconnect/Reconnect Client
  // ---------------------------------------------------------------------------
  server.registerTool(
    'reconnect_client',
    {
      title: 'Reconnect Client',
      description: 'Force a client to disconnect and reconnect. Useful for troubleshooting connection issues.',
      inputSchema: {
        mac: z.string().describe('MAC address of the client to reconnect (format: aa:bb:cc:dd:ee:ff)'),
      },
    },
    async ({ mac }) => {
      try {
        const result = await unifi.reconnectClient(mac);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Restart Device
  // ---------------------------------------------------------------------------
  server.registerTool(
    'restart_device',
    {
      title: 'Restart Device',
      description: 'Restart a UniFi device (access point, switch, etc.) by MAC address.',
      inputSchema: {
        mac: z.string().describe('MAC address of the device to restart (format: aa:bb:cc:dd:ee:ff)'),
      },
    },
    async ({ mac }) => {
      try {
        const result = await unifi.restartDevice(mac);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: List Blocked Clients
  // ---------------------------------------------------------------------------
  server.registerTool(
    'list_blocked_clients',
    {
      title: 'List Blocked Clients',
      description: 'List all clients that are currently blocked from the network.',
    },
    async () => {
      try {
        const blocked = await unifi.getBlockedClients();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: blocked.length,
              blockedClients: blocked,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: Echo (for testing)
  // ---------------------------------------------------------------------------
  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echoes back the provided message. Use this to test connectivity.',
      inputSchema: {
        message: z.string().describe('The message to echo back'),
      },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: `Echo: ${message}` }],
    })
  );

  return server;
}

// =============================================================================
// Express App Setup
// =============================================================================

const app = express();
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

const transports = new Map();

// =============================================================================
// Authentication Middleware
// =============================================================================

function requireAuth(req, res, next) {
  if (!OAUTH_ENABLED) return next();
  if (req.isAuthenticated()) return next();
  if (req.headers.accept?.includes('application/json') || req.path === '/mcp') {
    return res.status(401).json({ error: 'Authentication required', loginUrl: '/auth/google' });
  }
  res.redirect('/auth/google');
}

// =============================================================================
// Routes: Authentication
// =============================================================================

app.get('/auth/google', (req, res, next) => {
  if (!OAUTH_ENABLED) return res.status(503).send('OAuth not configured');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!OAUTH_ENABLED) return res.status(503).send('OAuth not configured');
  passport.authenticate('google', { failureRedirect: '/auth/failed', successRedirect: '/' })(req, res, next);
});

app.get('/auth/failed', (req, res) => {
  res.status(403).send(`
    <!DOCTYPE html><html><head><title>Access Denied</title>
    <style>body{font-family:system-ui;max-width:500px;margin:100px auto;text-align:center;}h1{color:#c62828;}a{color:#1976d2;}</style>
    </head><body><h1>Access Denied</h1><p>Your email is not authorized.</p><a href="/auth/google">Try another account</a></body></html>
  `);
});

app.get('/logout', (req, res) => {
  req.logout((err) => res.redirect('/'));
});

// =============================================================================
// Routes: Health & Dashboard
// =============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), authEnabled: OAUTH_ENABLED, unifiEnabled: UNIFI_ENABLED });
});

app.get('/', (req, res) => {
  const user = req.user;
  const isAuth = req.isAuthenticated();

  res.send(`
    <!DOCTYPE html><html><head><title>UniFi MCP Server</title>
    <style>
      body{font-family:system-ui;max-width:700px;margin:50px auto;padding:20px;line-height:1.6;}
      h1{color:#333;border-bottom:2px solid #1976d2;padding-bottom:10px;}
      .box{padding:15px;border-radius:6px;margin:15px 0;}
      .ok{background:#e8f5e9;border-left:4px solid #4caf50;}
      .warn{background:#fff3e0;border-left:4px solid #ff9800;}
      .info{background:#e3f2fd;border-left:4px solid #2196f3;}
      code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:13px;}
      .btn{display:inline-block;padding:8px 16px;background:#1976d2;color:white;text-decoration:none;border-radius:4px;margin:5px 5px 5px 0;}
      .btn.secondary{background:#757575;}
      pre{background:#263238;color:#aed581;padding:15px;border-radius:6px;overflow-x:auto;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin:15px 0;}
      th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;}
      th{background:#f5f5f5;}
    </style></head>
    <body>
      <h1>UniFi MCP Server</h1>

      ${OAUTH_ENABLED ? (isAuth ? `
        <div class="box info"><strong>Logged in as:</strong> ${user.email} <a href="/logout" class="btn secondary">Logout</a></div>
      ` : `
        <div class="box warn"><strong>Authentication required</strong> <a href="/auth/google" class="btn">Login with Google</a></div>
      `) : `
        <div class="box warn"><strong>Auth disabled</strong> - Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET</div>
      `}

      <div class="box ${UNIFI_ENABLED ? 'ok' : 'warn'}">
        <strong>UniFi Controller:</strong> ${UNIFI_ENABLED ? `${UNIFI_HOST}:${UNIFI_PORT}` : 'Not configured'}
      </div>

      <h2>MCP Connection</h2>
      <p>Add to your Claude Desktop config (<code>~/.claude/claude_desktop_config.json</code>):</p>
      <pre>{
  "mcpServers": {
    "unifi": {
      "url": "http://localhost:${PORT}/mcp"
    }
  }
}</pre>

      <h2>Available Tools</h2>
      <table>
        <tr><th>Tool</th><th>Description</th></tr>
        <tr><td><code>list_clients</code></td><td>List all connected devices</td></tr>
        <tr><td><code>get_client</code></td><td>Get details for a specific client by MAC</td></tr>
        <tr><td><code>search_devices</code></td><td>Search devices by name, IP, or MAC</td></tr>
        <tr><td><code>list_access_points</code></td><td>List all access points with status</td></tr>
        <tr><td><code>get_network_health</code></td><td>Get network health stats</td></tr>
        <tr><td><code>block_client</code></td><td>Block a device from the network</td></tr>
        <tr><td><code>unblock_client</code></td><td>Unblock a device</td></tr>
        <tr><td><code>reconnect_client</code></td><td>Force a client to reconnect</td></tr>
        <tr><td><code>restart_device</code></td><td>Restart an AP or switch</td></tr>
        <tr><td><code>list_blocked_clients</code></td><td>List all blocked devices</td></tr>
      </table>
    </body></html>
  `);
});

// =============================================================================
// Routes: MCP Endpoint
// =============================================================================

app.all('/mcp', requireAuth, async (req, res) => {
  console.log(`[MCP] ${req.method} request from ${req.user?.email || 'anonymous'}`);

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
      console.log(`[MCP] New session: ${newSessionId}`);

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
});

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
  console.log('');
  console.log('='.repeat(50));
  console.log('  UniFi MCP Server');
  console.log('='.repeat(50));
  console.log(`  Port:       ${PORT}`);
  console.log(`  Auth:       ${OAUTH_ENABLED ? 'Google OAuth' : 'DISABLED'}`);
  console.log(`  UniFi:      ${UNIFI_ENABLED ? UNIFI_HOST : 'NOT CONFIGURED'}`);
  if (OAUTH_ENABLED && ALLOWED_EMAILS.length > 0) {
    console.log(`  Allowed:    ${ALLOWED_EMAILS.join(', ')}`);
  }
  console.log('');
  console.log(`  Dashboard:  http://localhost:${PORT}/`);
  console.log(`  MCP URL:    http://localhost:${PORT}/mcp`);
  console.log('='.repeat(50));
  console.log('');
});
