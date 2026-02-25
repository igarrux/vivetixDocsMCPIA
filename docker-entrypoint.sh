#!/bin/sh
set -e

# ── Shared store directory ────────────────────────────────────────────
# Both the Go bridge (whatsapp-bridge) and the Python MCP server need
# access to the same SQLite databases under /app/store.
mkdir -p /app/store
rm -rf /app/whatsapp-mcp/whatsapp-bridge/store
ln -sf /app/store /app/whatsapp-mcp/whatsapp-bridge/store

# ── Start the WhatsApp Go bridge in background ───────────────────────
echo "🔌 Iniciando WhatsApp Bridge…"
cd /app/whatsapp-mcp/whatsapp-bridge
./whatsapp-bridge &
BRIDGE_PID=$!

# Give bridge a moment to initialize and print QR
sleep 3

# ── Start the Node.js web server ─────────────────────────────────────
cd /app
echo "🚀 Iniciando Chat Vivetix…"
exec node --import tsx src/web.ts
