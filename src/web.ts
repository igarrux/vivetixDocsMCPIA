try { process.loadEnvFile(); } catch {}

import OpenAI from "openai";
import { exit } from "node:process";
import { McpBridge } from "./mcp-bridge.js";
import { ChatEngine } from "./chat-engine.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PORT = parseInt(process.env.PORT || "3000", 10);
const WHATSAPP_MCP_PATH = process.env.WHATSAPP_MCP_PATH || "";
const REPORT_PHONE = process.env.ADVISOR_PHONE || "";
const UV_PATH = process.env.UV_PATH || "uv";
const N8N_API_KEY = process.env.N8N_API_KEY || ""; // optional auth for /api/n8n
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

if (!apiKey) {
  console.error("OPENAI_API_KEY is missing in .env");
  exit(1);
}

// ── Bootstrap ─────────────────────────────────────────────────────────
async function main() {
  console.log("Iniciando MCP servers…");

  // Always start docs bridge
  const docsBridge = await McpBridge.create("tsx", ["src/mcp-docs-server.ts"]);

  // Optionally start WhatsApp bridge (for sending reports)
  let whatsappBridge: McpBridge | null = null;
  if (WHATSAPP_MCP_PATH) {
    try {
      console.log("  📱 Conectando WhatsApp MCP (reportes)…");
      whatsappBridge = await McpBridge.create(UV_PATH, [
        "--directory",
        resolve(WHATSAPP_MCP_PATH, "whatsapp-mcp-server"),
        "run",
        "main.py",
      ]);
      const waTools = await whatsappBridge.toolNames();
      console.log(`  ✓ WhatsApp MCP conectado — herramientas: ${waTools.join(", ")}`);
    } catch (err: any) {
      console.warn(`  ⚠ WhatsApp MCP no disponible: ${err?.message ?? "error desconocido"}`);
      whatsappBridge = null;
    }
  } else {
    console.log("  ℹ WhatsApp MCP no configurado (WHATSAPP_MCP_PATH vacío)");
  }

  const bridge = whatsappBridge
    ? McpBridge.composite(docsBridge, whatsappBridge)
    : McpBridge.composite(docsBridge);

  // ── Session management ──────────────────────────────────────────
  const sessions = new Map<string, { engine: ChatEngine; lastActive: number }>();

  async function getEngine(sessionId: string): Promise<ChatEngine> {
    let session = sessions.get(sessionId);
    if (!session) {
      const engine = new ChatEngine(
        new OpenAI({ apiKey }),
        model,
        bridge,
        REPORT_PHONE,
      );
      await engine.init();
      session = { engine, lastActive: Date.now() };
      sessions.set(sessionId, session);
      console.log(`🆕 Nueva sesión: ${sessionId.slice(0, 8)}…`);
    }
    session.lastActive = Date.now();
    return session.engine;
  }

  function getSessionId(req: IncomingMessage): string {
    return (req.headers["x-session-id"] as string) || "default";
  }

  // Cleanup expired sessions every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActive > SESSION_TIMEOUT) {
        sessions.delete(id);
        console.log(`🗑 Sesión expirada: ${id.slice(0, 8)}…`);
      }
    }
  }, 5 * 60 * 1000);

  // Pre-verify tools work
  const testEngine = new ChatEngine(
    new OpenAI({ apiKey }),
    model,
    bridge,
    REPORT_PHONE,
  );
  const toolNames = await testEngine.init();
  console.log(`✓ MCP conectados — herramientas: ${toolNames.join(", ")}\n`);

  // ── HTTP Server ───────────────────────────────────────────────────
  const htmlPath = resolve(__dirname, "public", "index.html");
  const html = readFileSync(htmlPath, "utf-8");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve the UI
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // Chat API endpoint
    if (req.method === "POST" && req.url === "/api/chat") {
      try {
        const body = await readBody(req);
        const { message } = JSON.parse(body);
        const sessionId = getSessionId(req);
        const engine = await getEngine(sessionId);

        if (!message || typeof message !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing 'message' field" }));
          return;
        }

        console.log(`\n💬 [${sessionId.slice(0, 8)}] Usuario: ${message}`);
        const reply = await engine.send(message);
        console.log(`🤖 [${sessionId.slice(0, 8)}] IA: ${reply.slice(0, 120)}…`);

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      } catch (err: any) {
        console.error("Error en /api/chat:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "Error interno" }));
      }
      return;
    }

    // Reset conversation
    if (req.method === "POST" && req.url === "/api/reset") {
      const sessionId = getSessionId(req);
      sessions.delete(sessionId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── n8n / automation endpoint ───────────────────────────────────
    // POST /api/n8n  { "message": "...", "sessionId?": "...", "reset?": true }
    // Auth: header  Authorization: Bearer <N8N_API_KEY>  (only when N8N_API_KEY is set)
    if (req.method === "POST" && req.url === "/api/n8n") {
      // Auth check
      if (N8N_API_KEY) {
        const auth = req.headers["authorization"] ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (token !== N8N_API_KEY) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      try {
        const body = await readBody(req);
        const payload = JSON.parse(body);
        const sessionId = payload.sessionId || "n8n-default";

        // Optional reset
        if (payload.reset === true) {
          sessions.delete(sessionId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessionId }));
          return;
        }

        const message = payload.message;
        if (!message || typeof message !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing 'message' field (string)" }));
          return;
        }

        console.log(`\n🔗 [n8n:${sessionId.slice(0, 8)}] ${message}`);
        const engine = await getEngine(sessionId);
        const reply = await engine.send(message);
        console.log(`🤖 [n8n:${sessionId.slice(0, 8)}] ${reply.slice(0, 120)}…`);

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply, sessionId }));
      } catch (err: any) {
        console.error("Error en /api/n8n:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "Error interno" }));
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`🌐 Chat web disponible en http://localhost:${PORT}\n`);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nCerrando…");
    server.close();
    await bridge.close();
    if (whatsappBridge) await whatsappBridge.close();
    exit(0);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

main();
