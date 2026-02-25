process.loadEnvFile();

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

if (!apiKey) {
  console.error("OPENAI_API_KEY is missing in .env");
  exit(1);
}

// ── Bootstrap ─────────────────────────────────────────────────────────
async function main() {
  console.log("Iniciando MCP servers…");
  const [docsBridge] = await Promise.all([
    McpBridge.create("tsx", ["src/mcp-docs-server.ts"]),
  ]);

  const bridge = McpBridge.composite(docsBridge);
  const engine = new ChatEngine(new OpenAI({ apiKey }), model, bridge);

  const toolNames = await engine.init();
  console.log(`✓ MCP conectados — herramientas: ${toolNames.join(", ")}\n`);

  // ── HTTP Server ───────────────────────────────────────────────────
  const htmlPath = resolve(__dirname, "public", "index.html");
  const html = readFileSync(htmlPath, "utf-8");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

        if (!message || typeof message !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing 'message' field" }));
          return;
        }

        console.log(`\n💬 Usuario: ${message}`);
        const reply = await engine.send(message);
        console.log(`🤖 IA: ${reply.slice(0, 120)}…`);

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
      engine.reset();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
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
