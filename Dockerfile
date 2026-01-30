# UniFi MCP Server Dockerfile
# Multi-stage build for smaller image size

# =============================================================================
# Stage 1: Install dependencies
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# =============================================================================
# Stage 2: Production image
# =============================================================================
FROM node:22-alpine

# Set environment
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcpserver -u 1001 -G nodejs

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY --chown=mcpserver:nodejs server.js ./
COPY --chown=mcpserver:nodejs package.json ./

# Switch to non-root user
USER mcpserver

# Expose the default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "server.js"]
