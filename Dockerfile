# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTION DOCKERFILE — Audema Backend API
# Multi-stage build for optimized production image
# ═══════════════════════════════════════════════════════════════════════════════

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

# Install production dependencies only
COPY --from=builder /app/node_modules ./node_modules
COPY backend/ ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
