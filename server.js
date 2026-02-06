/**
 * UniFi MCP Server
 *
 * A Model Context Protocol server for managing UniFi networks.
 * Uses Streamable HTTP transport for remote access.
 * OAuth 2.1 with Cloudflare Access for SaaS as the identity provider.
 */

import 'dotenv/config';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Cloudflare Access for SaaS (OIDC) configuration
const CF_ACCESS_TEAM = process.env.CF_ACCESS_TEAM; // e.g., 'breezywillow'
const CF_CLIENT_ID = process.env.CF_CLIENT_ID; // From Access for SaaS app
const CF_CLIENT_SECRET = process.env.CF_CLIENT_SECRET; // From Access for SaaS app

// Derived Cloudflare OIDC endpoints
const CF_ISSUER = CF_ACCESS_TEAM && CF_CLIENT_ID
  ? `https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/sso/oidc/${CF_CLIENT_ID}`
  : null;
const CF_AUTH_URL = CF_ISSUER ? `${CF_ISSUER}/authorization` : null;
const CF_TOKEN_URL = CF_ISSUER ? `${CF_ISSUER}/token` : null;
const CF_USERINFO_URL = CF_ISSUER ? `${CF_ISSUER}/userinfo` : null;

const OAUTH_ENABLED = Boolean(CF_ACCESS_TEAM && CF_CLIENT_ID && CF_CLIENT_SECRET);

// UniFi configuration (API key authentication only)
const UNIFI_HOST = process.env.UNIFI_HOST;
const UNIFI_PORT = parseInt(process.env.UNIFI_PORT || '443', 10);
const UNIFI_API_KEY = process.env.UNIFI_API_KEY;
const UNIFI_SITE = process.env.UNIFI_SITE || 'default';
const UNIFI_ENABLED = Boolean(UNIFI_HOST && UNIFI_API_KEY);

// Startup info
console.log('');
console.log('='.repeat(50));
console.log('  UniFi MCP Server - Starting');
console.log('='.repeat(50));
if (!OAUTH_ENABLED) {
  console.warn('⚠️  OAuth not configured. Set CF_ACCESS_TEAM, CF_CLIENT_ID, CF_CLIENT_SECRET.');
}
if (!UNIFI_ENABLED) {
  console.warn('⚠️  UniFi controller not configured. Set UNIFI_HOST and UNIFI_API_KEY.');
}


// =============================================================================
// UniFi Controller Class (API Key Authentication)
// =============================================================================

class UniFiController {
  constructor() {
    this.baseUrl = `https://${UNIFI_HOST}:${UNIFI_PORT}`;
    this.siteId = null;
  }

  // Make authenticated API request (v1 integrations API)
  async api(endpoint, options = {}) {
    if (!UNIFI_ENABLED) {
      throw new Error('UniFi controller not configured. Set UNIFI_HOST and UNIFI_API_KEY.');
    }

    const url = `${this.baseUrl}/proxy/network/integrations/v1${endpoint}`;
    console.log(`[UniFi] API v1: ${options.method || 'GET'} ${endpoint}`);

    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-KEY': UNIFI_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`UniFi API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  // Make request to the classic API (more endpoints available)
  async classicApi(endpoint, options = {}) {
    if (!UNIFI_ENABLED) {
      throw new Error('UniFi controller not configured. Set UNIFI_HOST and UNIFI_API_KEY.');
    }

    const url = `${this.baseUrl}/proxy/network/api${endpoint}`;
    console.log(`[UniFi] Classic API: ${options.method || 'GET'} ${endpoint}`);

    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-KEY': UNIFI_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`UniFi API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  // Get the site ID (cached after first call)
  async getSiteId() {
    if (this.siteId) return this.siteId;

    const data = await this.api('/sites');
    const sites = data.data || data;
    const site = sites.find(s => s.name === UNIFI_SITE || s.desc === UNIFI_SITE) || sites[0];
    if (!site) throw new Error('No UniFi site found');
    this.siteId = site._id || site.id;
    console.log(`[UniFi] Using site: ${site.name || site.desc} (${this.siteId})`);
    return this.siteId;
  }

  async getClients() {
    const siteId = await this.getSiteId();
    const data = await this.api(`/sites/${siteId}/clients`);
    const clients = data.data || data;
    return clients.map(c => ({
      mac: c.mac,
      hostname: c.hostname || c.name || c.display_name || 'Unknown',
      ip: c.ip || c.fixed_ip || 'N/A',
      oui: c.oui || '',
      isWired: c.is_wired || c.type === 'WIRED',
      network: c.network || c.network_name || '',
      experience: c.satisfaction || c.score || null,
      signalStrength: c.signal || c.rssi || null,
      uptime: c.uptime || 0,
      lastSeen: c.last_seen ? new Date(c.last_seen * 1000).toISOString() : (c.lastSeen || null),
      isBlocked: c.blocked || false,
      isGuest: c.is_guest || c.guest || false,
    }));
  }

  async getClient(mac) {
    const clients = await this.getClients();
    return clients.find(c => c.mac.toLowerCase() === mac.toLowerCase()) || null;
  }

  async getAccessPoints() {
    const siteId = await this.getSiteId();
    const data = await this.api(`/sites/${siteId}/devices`);
    const devices = data.data || data;
    // Filter for access points
    return devices
      .filter(d => d.type === 'uap' || d.model?.startsWith('U'))
      .map(d => ({
        mac: d.mac,
        name: d.name || d.display_name || 'Unnamed AP',
        model: d.model || 'Unknown',
        ip: d.ip || 'N/A',
        state: d.state === 1 || d.status === 'ONLINE' ? 'connected' : 'disconnected',
        adopted: d.adopted ?? true,
        version: d.version || d.firmware || '',
        uptime: d.uptime || 0,
        numClients: d.num_sta || d.client_count || 0,
      }));
  }

  async getHealth() {
    // Use classic API for health - more detailed data
    const data = await this.classicApi(`/s/${UNIFI_SITE}/stat/health`);
    return data.data || data;
  }

  async getSiteStats() {
    // Use classic API for full site stats
    const data = await this.classicApi('/stat/sites');
    const sites = data.data || data;
    return sites.find(s => s.name === UNIFI_SITE || s.desc === UNIFI_SITE) || sites[0];
  }

  async getAllDevices() {
    const siteId = await this.getSiteId();
    const data = await this.api(`/sites/${siteId}/devices`);
    const devices = data.data || data;
    return devices.map(d => ({
      mac: d.mac,
      name: d.name || d.display_name || 'Unnamed',
      model: d.model || 'Unknown',
      type: d.type || 'unknown',
      ip: d.ip || 'N/A',
      state: d.state === 1 || d.status === 'ONLINE' ? 'connected' : 'disconnected',
      adopted: d.adopted ?? true,
      version: d.version || d.firmware || '',
      uptime: d.uptime || 0,
      numClients: d.num_sta || d.client_count || 0,
    }));
  }

  async getNetworks() {
    const data = await this.classicApi(`/s/${UNIFI_SITE}/rest/networkconf`);
    const networks = data.data || data;
    return networks.map(n => ({
      id: n._id,
      name: n.name,
      purpose: n.purpose || 'corporate',
      vlan: n.vlan || null,
      subnet: n.ip_subnet || null,
      dhcpEnabled: n.dhcpd_enabled || false,
      dhcpStart: n.dhcpd_start || null,
      dhcpStop: n.dhcpd_stop || null,
      domainName: n.domain_name || null,
      enabled: n.enabled !== false,
    }));
  }

  async getWlans() {
    const data = await this.classicApi(`/s/${UNIFI_SITE}/rest/wlanconf`);
    const wlans = data.data || data;
    return wlans.map(w => ({
      id: w._id,
      name: w.name,
      ssid: w.name, // SSID is typically the name
      enabled: w.enabled !== false,
      security: w.security || 'open',
      wpaMode: w.wpa_mode || null,
      isGuest: w.is_guest || false,
      vlan: w.vlan || null,
      networkId: w.networkconf_id || null,
      hideSSID: w.hide_ssid || false,
    }));
  }

  async getEvents(limit = 50) {
    const data = await this.classicApi(`/s/${UNIFI_SITE}/stat/event?_limit=${limit}`);
    const events = data.data || data;
    return events.map(e => ({
      id: e._id,
      time: e.time ? new Date(e.time).toISOString() : null,
      datetime: e.datetime || null,
      key: e.key || 'unknown',
      message: e.msg || '',
      subsystem: e.subsystem || '',
      user: e.user || e.guest || null,
      hostname: e.hostname || null,
      mac: e.client || e.ap || null,
    }));
  }

  async getAlarms(limit = 50) {
    const data = await this.classicApi(`/s/${UNIFI_SITE}/stat/alarm?_limit=${limit}`);
    const alarms = data.data || data;
    return alarms.map(a => ({
      id: a._id,
      time: a.time ? new Date(a.time).toISOString() : null,
      key: a.key || 'unknown',
      message: a.msg || '',
      archived: a.archived || false,
      deviceMac: a.ap || a.gw || a.sw || null,
      deviceName: a.ap_name || a.gw_name || a.sw_name || null,
    }));
  }

  async getPortForwards() {
    const data = await this.classicApi(`/s/${UNIFI_SITE}/rest/portforward`);
    const rules = data.data || data;
    return rules.map(r => ({
      id: r._id,
      name: r.name,
      enabled: r.enabled !== false,
      proto: r.proto || 'tcp_udp',
      srcPort: r.src || r.dst_port,
      destPort: r.fwd_port || r.dst_port,
      destIp: r.fwd || null,
    }));
  }

  async blockClient(mac) {
    const siteId = await this.getSiteId();
    await this.api(`/sites/${siteId}/clients/${mac.toLowerCase()}/block`, { method: 'POST' });
    return { success: true, message: `Blocked client ${mac}` };
  }

  async unblockClient(mac) {
    const siteId = await this.getSiteId();
    await this.api(`/sites/${siteId}/clients/${mac.toLowerCase()}/unblock`, { method: 'POST' });
    return { success: true, message: `Unblocked client ${mac}` };
  }

  async reconnectClient(mac) {
    const siteId = await this.getSiteId();
    await this.api(`/sites/${siteId}/clients/${mac.toLowerCase()}/reconnect`, { method: 'POST' });
    return { success: true, message: `Reconnected client ${mac}` };
  }

  async restartDevice(mac) {
    const siteId = await this.getSiteId();
    await this.api(`/sites/${siteId}/devices/${mac.toLowerCase()}/restart`, { method: 'POST' });
    return { success: true, message: `Restart initiated for device ${mac}` };
  }

  async getBlockedClients() {
    const clients = await this.getClients();
    return clients.filter(c => c.isBlocked);
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

  // Tool: List All Devices
  server.registerTool('list_devices', {
    title: 'List All Devices',
    description: 'List all UniFi devices (APs, switches, gateways, etc.) with status.',
  }, async () => {
    try {
      const devices = await unifi.getAllDevices();
      return { content: [{ type: 'text', text: JSON.stringify({ count: devices.length, devices }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List Networks
  server.registerTool('list_networks', {
    title: 'List Networks',
    description: 'List all configured networks (VLANs, subnets) on the UniFi controller.',
  }, async () => {
    try {
      const networks = await unifi.getNetworks();
      return { content: [{ type: 'text', text: JSON.stringify({ count: networks.length, networks }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List WLANs
  server.registerTool('list_wlans', {
    title: 'List WLANs',
    description: 'List all wireless networks (SSIDs) configured on the UniFi controller.',
  }, async () => {
    try {
      const wlans = await unifi.getWlans();
      return { content: [{ type: 'text', text: JSON.stringify({ count: wlans.length, wlans }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List Events
  server.registerTool('list_events', {
    title: 'List Recent Events',
    description: 'List recent events from the UniFi controller (connections, disconnections, etc.).',
    inputSchema: { limit: z.number().optional().describe('Maximum number of events to return (default: 50)') },
  }, async ({ limit }) => {
    try {
      const events = await unifi.getEvents(limit || 50);
      return { content: [{ type: 'text', text: JSON.stringify({ count: events.length, events }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List Alarms
  server.registerTool('list_alarms', {
    title: 'List Alarms',
    description: 'List active and recent alarms from the UniFi controller.',
    inputSchema: { limit: z.number().optional().describe('Maximum number of alarms to return (default: 50)') },
  }, async ({ limit }) => {
    try {
      const alarms = await unifi.getAlarms(limit || 50);
      return { content: [{ type: 'text', text: JSON.stringify({ count: alarms.length, alarms }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Tool: List Port Forwards
  server.registerTool('list_port_forwards', {
    title: 'List Port Forwards',
    description: 'List all port forwarding rules configured on the UniFi gateway.',
  }, async () => {
    try {
      const rules = await unifi.getPortForwards();
      return { content: [{ type: 'text', text: JSON.stringify({ count: rules.length, portForwards: rules }, null, 2) }] };
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

// CORS middleware - required for Cloudflare MCP Portal browser requests
app.use((req, res, next) => {
  // Allow requests from Cloudflare domains and localhost
  const allowedOrigins = [
    'https://dash.cloudflare.com',
    'https://one.dash.cloudflare.com',
    'https://playground.ai.cloudflare.com',
    /\.cloudflare\.com$/,
    /\.cloudflareaccess\.com$/,
  ];

  const origin = req.headers.origin;
  if (origin) {
    const isAllowed = allowedOrigins.some(allowed =>
      typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
    );
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, MCP-Session-ID, MCP-Protocol-Version');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-ID');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Store for MCP transports, OAuth state
const transports = new Map();
const registeredClients = new Map(); // client_id -> { client_secret, redirect_uris }
const authCodes = new Map(); // code -> { client_id, user, redirect_uri, code_challenge, expires }
const accessTokens = new Map(); // token -> { client_id, user, expires }
const pendingAuth = new Map(); // state -> { client_id, redirect_uri, code_challenge, code_challenge_method }

// =============================================================================
// OAuth 2.0 Protected Resource Metadata (RFC 9728) - REQUIRED by MCP 2025-11-25
// =============================================================================

const RESOURCE_METADATA_URL = `${BASE_URL}/.well-known/oauth-protected-resource/mcp`;
const MCP_RESOURCE_URI = `${BASE_URL}/mcp`;

app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  res.json({
    resource: MCP_RESOURCE_URI,
    authorization_servers: [BASE_URL],
    scopes_supported: ['mcp:tools'],
    bearer_methods_supported: ['header'],
  });
});

// Also serve at root for compatibility
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: MCP_RESOURCE_URI,
    authorization_servers: [BASE_URL],
    scopes_supported: ['mcp:tools'],
    bearer_methods_supported: ['header'],
  });
});

// =============================================================================
// OAuth 2.1 Authorization Server Metadata (RFC 8414)
// =============================================================================

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['openid', 'profile', 'email', 'mcp:tools'],
  });
});

// =============================================================================
// OAuth 2.1 Dynamic Client Registration
// =============================================================================

app.post('/register', (req, res) => {
  const { redirect_uris, client_name } = req.body;

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uris required' });
  }

  const client_id = randomUUID();
  const client_secret = randomUUID();

  registeredClients.set(client_id, {
    client_secret,
    redirect_uris,
    client_name: client_name || 'Unknown Client',
    created: Date.now(),
  });

  console.log(`[OAuth] Registered client: ${client_name || client_id}`);

  res.status(201).json({
    client_id,
    client_secret,
    redirect_uris,
    client_name,
  });
});

// =============================================================================
// OAuth 2.1 Authorization Endpoint
// =============================================================================

app.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, response_type } = req.query;

  if (!client_id || !redirect_uri) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri required' });
  }

  // Auto-register unknown clients (MCP clients like Claude Desktop don't call /register first)
  let client = registeredClients.get(client_id);
  if (!client) {
    // Validate redirect_uri is localhost (safe for public clients)
    try {
      const redirectUrl = new URL(redirect_uri);
      if (redirectUrl.hostname !== 'localhost' && redirectUrl.hostname !== '127.0.0.1') {
        return res.status(400).json({ error: 'invalid_request', error_description: 'Only localhost redirect_uri allowed for auto-registration' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
    }

    // Auto-register as public client
    client = {
      client_secret: null, // Public client, no secret
      redirect_uris: [redirect_uri],
      client_name: 'Auto-registered MCP Client',
      created: Date.now(),
    };
    registeredClients.set(client_id, client);
    console.log(`[OAuth] Auto-registered client: ${client_id}`);
  }

  // Validate redirect_uri matches registered URIs (add new ones for existing clients)
  if (!client.redirect_uris.includes(redirect_uri)) {
    // For auto-registered clients, allow adding localhost URIs
    try {
      const redirectUrl = new URL(redirect_uri);
      if (redirectUrl.hostname === 'localhost' || redirectUrl.hostname === '127.0.0.1') {
        client.redirect_uris.push(redirect_uri);
        console.log(`[OAuth] Added redirect_uri for client ${client_id}: ${redirect_uri}`);
      } else {
        return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
    }
  }

  // Require PKCE
  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'PKCE with S256 required' });
  }

  if (!OAUTH_ENABLED) {
    return res.status(503).json({ error: 'server_error', error_description: 'OAuth not configured' });
  }

  // Store pending auth and redirect to Cloudflare
  const authState = randomUUID();
  pendingAuth.set(authState, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    original_state: state,
    expires: Date.now() + 10 * 60 * 1000,
  });

  // Redirect to Cloudflare Access
  const cfAuthUrl = new URL(CF_AUTH_URL);
  cfAuthUrl.searchParams.set('client_id', CF_CLIENT_ID);
  cfAuthUrl.searchParams.set('response_type', 'code');
  cfAuthUrl.searchParams.set('redirect_uri', `${BASE_URL}/callback`);
  cfAuthUrl.searchParams.set('scope', 'openid email profile');
  cfAuthUrl.searchParams.set('state', authState);

  console.log(`[OAuth] Redirecting to Cloudflare Access for auth`);
  res.redirect(cfAuthUrl.toString());
});

// =============================================================================
// OAuth 2.1 Callback (from Cloudflare Access)
// =============================================================================

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error(`[OAuth] Cloudflare returned error: ${error}`);
    return res.status(400).json({ error });
  }

  const pending = pendingAuth.get(state);
  if (!pending || pending.expires < Date.now()) {
    pendingAuth.delete(state);
    return res.status(400).json({ error: 'invalid_state', error_description: 'Invalid or expired state' });
  }
  pendingAuth.delete(state);

  try {
    // Exchange code with Cloudflare for tokens
    const tokenResponse = await fetch(CF_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CF_CLIENT_ID,
        client_secret: CF_CLIENT_SECRET,
        code,
        redirect_uri: `${BASE_URL}/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error(`[OAuth] Cloudflare token error: ${err}`);
      return res.status(400).json({ error: 'token_exchange_failed' });
    }

    const tokens = await tokenResponse.json();

    // Get user info from Cloudflare
    const userResponse = await fetch(CF_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = userResponse.ok ? await userResponse.json() : { email: 'unknown' };

    console.log(`[OAuth] Authenticated user: ${userInfo.email}`);

    // Generate our own auth code for the MCP client
    const mcpCode = randomUUID();
    authCodes.set(mcpCode, {
      client_id: pending.client_id,
      user: userInfo.email,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      expires: Date.now() + 10 * 60 * 1000,
    });

    // Redirect back to MCP client
    const redirectUrl = new URL(pending.redirect_uri);
    redirectUrl.searchParams.set('code', mcpCode);
    if (pending.original_state) redirectUrl.searchParams.set('state', pending.original_state);

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error(`[OAuth] Callback error: ${err.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// =============================================================================
// OAuth 2.1 Token Endpoint
// =============================================================================

app.post('/token', (req, res) => {
  const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier } = req.body;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // Validate auth code
  const authCode = authCodes.get(code);
  if (!authCode || authCode.expires < Date.now()) {
    authCodes.delete(code);
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired code' });
  }

  // Validate client
  if (authCode.client_id !== client_id) {
    return res.status(400).json({ error: 'invalid_client' });
  }

  // Validate PKCE
  const expectedChallenge = createHash('sha256').update(code_verifier).digest('base64url');
  if (expectedChallenge !== authCode.code_challenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid code_verifier' });
  }

  authCodes.delete(code);

  // Issue access token
  const access_token = randomUUID();
  accessTokens.set(access_token, {
    client_id,
    user: authCode.user,
    expires: Date.now() + 3600 * 1000, // 1 hour
  });

  console.log(`[OAuth] Issued token for user: ${authCode.user}`);

  res.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
  });
});

// =============================================================================
// Token Validation Middleware
// =============================================================================

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  // WWW-Authenticate header per RFC 9728 and MCP 2025-11-25 spec
  const wwwAuth = `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="mcp:tools"`;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', wwwAuth);
    return res.status(401).json({ error: 'invalid_token', error_description: 'Missing Authorization header' });
  }

  const token = authHeader.slice(7);
  const tokenData = accessTokens.get(token);

  if (!tokenData || tokenData.expires < Date.now()) {
    accessTokens.delete(token);
    res.set('WWW-Authenticate', wwwAuth);
    return res.status(401).json({ error: 'invalid_token', error_description: 'Invalid or expired token' });
  }

  req.user = tokenData.user;
  next();
}

// =============================================================================
// Health Endpoint (public)
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    unifiEnabled: UNIFI_ENABLED === true,
    oauthEnabled: OAUTH_ENABLED === true,
  });
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
// MCP Endpoint (Protected by OAuth 2.1) - MCP 2025-11-25 Compliant
// =============================================================================

// Origin validation middleware (required by MCP 2025-11-25 for DNS rebinding protection)
function validateOrigin(req, res, next) {
  const origin = req.headers.origin;

  // Allow requests without Origin (non-browser clients)
  if (!origin) {
    return next();
  }

  try {
    const originUrl = new URL(origin);

    // Allow localhost for development
    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
      return next();
    }

    // Allow requests from same origin
    const baseUrl = new URL(BASE_URL);
    if (originUrl.hostname === baseUrl.hostname) {
      return next();
    }

    // Allow Cloudflare domains (MCP Portal, Playground, Dashboard)
    if (originUrl.hostname.endsWith('.cloudflare.com') ||
        originUrl.hostname.endsWith('.cloudflareaccess.com')) {
      return next();
    }
  } catch (e) {
    // Invalid origin URL
  }

  // Reject other origins
  console.warn(`[MCP] Rejected request from origin: ${origin}`);
  return res.status(403).json({ error: 'forbidden', error_description: 'Invalid origin' });
}

app.all('/mcp', validateOrigin, requireAuth, async (req, res) => {
  const user = req.user || 'anonymous';
  console.log(`[MCP] ${req.method} request from ${user}`);

  const mcpSessionId = req.headers['mcp-session-id'];
  const protocolVersion = req.headers['mcp-protocol-version'];

  // DELETE - Session termination (MCP 2025-11-25)
  if (req.method === 'DELETE') {
    if (!mcpSessionId) {
      return res.status(400).json({ error: 'Missing mcp-session-id header' });
    }

    const transport = transports.get(mcpSessionId);
    if (transport) {
      console.log(`[MCP] Session terminated by client: ${mcpSessionId}`);
      transports.delete(mcpSessionId);
      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Session not found' });
  }

  // GET - SSE stream for server-to-client messages
  if (req.method === 'GET') {
    // Validate Accept header
    const accept = req.headers.accept || '';
    if (!accept.includes('text/event-stream')) {
      return res.status(406).json({ error: 'Not Acceptable', error_description: 'Accept header must include text/event-stream' });
    }

    if (!mcpSessionId || !transports.has(mcpSessionId)) {
      return res.status(400).json({ error: 'Session not found' });
    }
    await transports.get(mcpSessionId).handleRequest(req, res);
    return;
  }

  // POST - JSON-RPC messages
  if (req.method === 'POST') {
    // Validate Accept header
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') && !accept.includes('text/event-stream')) {
      return res.status(406).json({ error: 'Not Acceptable', error_description: 'Accept header must include application/json or text/event-stream' });
    }

    const body = req.body;

    if (body?.method === 'initialize') {
      const newSessionId = randomUUID();
      console.log(`[MCP] New session: ${newSessionId} for user: ${user}, protocol: ${protocolVersion || 'unknown'}`);

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
  console.log(`  Port:       ${PORT}`);
  console.log(`  Base URL:   ${BASE_URL}`);
  console.log(`  UniFi:      ${UNIFI_ENABLED ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`  OAuth:      ${OAUTH_ENABLED ? 'Cloudflare Access for SaaS' : 'NOT CONFIGURED (dev mode)'}`);
  console.log('');
  console.log(`  Endpoints:`);
  console.log(`    Health:     ${BASE_URL}/health`);
  console.log(`    OAuth Meta: ${BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`    MCP:        ${BASE_URL}/mcp`);
  console.log('='.repeat(50));
  console.log('');
});
