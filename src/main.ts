try { process.loadEnvFile(); } catch {}

import OpenAI from "openai";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, exit } from "node:process";
import { McpBridge } from "./mcp-bridge.js";
import { ChatEngine } from "./chat-engine.js";

// ── Config ────────────────────────────────────────────────────────────
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!apiKey) {
  console.error("OPENAI_API_KEY is missing in .env");
  exit(1);
}

// ── Bootstrap ─────────────────────────────────────────────────────────
async function main() {
  console.log("Iniciando MCP servers…");
  const [docsBridge] = await Promise.all([
    // McpBridge.create("npx", ["@playwright/mcp@latest"]),
    McpBridge.create("tsx", ["src/mcp-docs-server.ts"]),
  ]);

  const bridge = McpBridge.composite(docsBridge);
  const engine = new ChatEngine(new OpenAI({ apiKey }), model, bridge);

  const toolNames = await engine.init();
  console.log(`✓ MCP conectados — herramientas: ${toolNames.join(", ")}\n`);
  console.log("Chat listo. Escribe /salir para terminar.\n");

  const rl = createInterface({ input, output });

  while (true) {
    const text = (await rl.question("Tú: ")).trim();
    if (!text) continue;
    if (text.toLowerCase() === "/salir" || text.toLowerCase() === "/exit")
      break;

    try {
      const reply = await engine.send(text);
      console.log(`IA: ${reply}\n`);
    } catch (err: any) {
      console.error(`Error: ${err?.message ?? "sin detalle"}\n`);
    }
  }

  rl.close();
  await bridge.close();
  console.log("Sesión cerrada.");
}

main();
