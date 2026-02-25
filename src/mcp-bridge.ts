import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type OpenAI from "openai";

type OpenAITool = OpenAI.Chat.ChatCompletionTool;

interface McpTextContent {
  type: "text";
  text: string;
}

/**
 * Wraps an MCP server (via stdio) and exposes its tools
 * in the format OpenAI's Chat Completions API expects.
 */
export class McpBridge {
  private client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  /** Launch the MCP subprocess and return a ready-to-use bridge. */
  static async create(command: string, args: string[]): Promise<McpBridge> {
    const transport = new StdioClientTransport({ command, args });
    const client = new Client({ name: "chatmcp", version: "1.0.0" });
    await client.connect(transport);
    return new McpBridge(client);
  }

  /** List available tools formatted as OpenAI function tools. */
  async listTools(): Promise<OpenAITool[]> {
    const { tools } = await this.client.listTools();

    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      },
    }));
  }

  /** Execute a tool by name and return its text output. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });

    return (result.content as McpTextContent[])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  /** Get the names of all available tools. */
  async toolNames(): Promise<string[]> {
    const tools = await this.listTools();
    return tools
      .filter((t): t is OpenAI.Chat.ChatCompletionTool & { type: "function" } => t.type === "function")
      .map((t) => t.function.name);
  }

  /** Gracefully close the MCP connection. */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Create a composite bridge that merges tools from multiple bridges.
   * Tool calls are routed to the bridge that owns the tool.
   */
  static composite(...bridges: McpBridge[]): McpBridge {
    // We create a thin proxy that delegates to the correct bridge per tool.
    const toolOwnership = new Map<string, McpBridge>();

    const proxy = new McpBridge(bridges[0].client); // client unused in proxy

    proxy.listTools = async () => {
      const all: OpenAITool[] = [];
      for (const b of bridges) {
        const tools = await b.listTools();
        for (const t of tools) {
          if (t.type === "function") toolOwnership.set(t.function.name, b);
          all.push(t);
        }
      }
      return all;
    };

    proxy.callTool = async (name, args) => {
      const owner = toolOwnership.get(name);
      if (!owner) throw new Error(`Tool "${name}" not found in any bridge`);
      return owner.callTool(name, args);
    };

    proxy.toolNames = async () => {
      const tools = await proxy.listTools();
      return tools
        .filter((t): t is OpenAITool & { type: "function" } => t.type === "function")
        .map((t) => t.function.name);
    };

    proxy.close = async () => {
      await Promise.all(bridges.map((b) => b.close()));
    };

    return proxy;
  }
}
