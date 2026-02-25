# ═══════════════════════════════════════════════════════════════════════
#  Vivetix Chat — Multi-stage Dockerfile
#  Components: Node.js app + WhatsApp Go bridge + Python MCP server
# ═══════════════════════════════════════════════════════════════════════

# ── Stage 1: Build the Go WhatsApp bridge ────────────────────────────
FROM golang:1.24-alpine AS go-builder

RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /build
COPY whatsapp-mcp/whatsapp-bridge/go.mod whatsapp-mcp/whatsapp-bridge/go.sum ./
ENV GOFLAGS="-mod=mod"
RUN GOTOOLCHAIN=auto go mod download

COPY whatsapp-mcp/whatsapp-bridge/*.go ./
RUN GOTOOLCHAIN=auto CGO_ENABLED=1 go build -o whatsapp-bridge .

# ── Stage 2: Install Node.js dependencies ───────────────────────────
FROM node:22-alpine AS node-builder

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 3: Final runtime image ────────────────────────────────────
FROM node:22-alpine

# Install runtime dependencies:
#   - python3 + pip: for the WhatsApp MCP server
#   - sqlite-libs: for the Go bridge (CGO SQLite)
#   - curl: for healthchecks
RUN apk add --no-cache python3 py3-pip sqlite-libs curl

# Install uv (Python package manager) and pnpm
RUN pip3 install --break-system-packages uv \
 && corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# ── Node.js app ──────────────────────────────────────────────────────
COPY package.json pnpm-lock.yaml ./
COPY --from=node-builder /build/node_modules ./node_modules
COPY src/ ./src/

# tsx must be globally available (spawned as subprocess by MCP bridge)
RUN npm install -g tsx

# ── WhatsApp Go bridge (compiled binary) ─────────────────────────────
COPY --from=go-builder /build/whatsapp-bridge ./whatsapp-mcp/whatsapp-bridge/whatsapp-bridge

# ── WhatsApp Python MCP server ───────────────────────────────────────
COPY whatsapp-mcp/whatsapp-mcp-server/pyproject.toml \
     whatsapp-mcp/whatsapp-mcp-server/uv.lock \
     whatsapp-mcp/whatsapp-mcp-server/.python-version \
     ./whatsapp-mcp/whatsapp-mcp-server/

# Install Python deps
RUN cd whatsapp-mcp/whatsapp-mcp-server && uv sync

COPY whatsapp-mcp/whatsapp-mcp-server/*.py ./whatsapp-mcp/whatsapp-mcp-server/

# ── Entrypoint ───────────────────────────────────────────────────────
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Environment defaults (override at runtime)
ENV PORT=3000 \
    OPENAI_MODEL=gpt-4o \
    WHATSAPP_MCP_PATH=/app/whatsapp-mcp \
    UV_PATH=uv

EXPOSE 3000

VOLUME /app/store

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -sf http://localhost:3000/ || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
