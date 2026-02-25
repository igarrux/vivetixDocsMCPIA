import OpenAI from "openai";
import type { McpBridge } from "./mcp-bridge.js";

type Message = OpenAI.Chat.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.ChatCompletionTool;
type Choice = OpenAI.Chat.ChatCompletion.Choice;

const SYSTEM_PROMPT =
  "Eres un asistente de Vivetix. Tienes acceso a documentación oficial de Vivetix " +
  "(aviso legal, política de privacidad, cookies, términos y condiciones, guías para organizadores, " +
  "atención al cliente, etc.) a través de herramientas específicas. " +
  "Cuando el usuario pregunte sobre algún tema relacionado con Vivetix, usa la herramienta " +
  "adecuada para consultar el documento correspondiente y responde con la información exacta. " +
  "Si la pregunta no se relaciona con Vivetix, responde que solo puedes ayudar con temas relacionados con Vivetix." + 
  "Siempre busca la información en los documentos antes de responder, no hagas suposiciones ni inventes respuestas." +
  "Vivetix es una plataforma de venta de entradas para eventos, que ofrece servicios tanto a organizadores como a compradores de entradas.";
/**
 * Orchestrates the conversation between the user, OpenAI, and local MCP tools.
 */
export class ChatEngine {
  private openai: OpenAI;
  private model: string;
  private bridge: McpBridge;
  private tools: Tool[] = [];
  private messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];

  constructor(openai: OpenAI, model: string, bridge: McpBridge) {
    this.openai = openai;
    this.model = model;
    this.bridge = bridge;
  }

  /** Reset conversation history, keeping only the system prompt. */
  reset(): void {
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  /** Load tools from MCP and prepare the engine. */
  async init(): Promise<string[]> {
    this.tools = await this.bridge.listTools();
    return this.tools
      .filter((t): t is Tool & { type: "function" } => t.type === "function")
      .map((t) => t.function.name);
  }

  /** Send a user message and return the assistant's final text reply. */
  async send(userMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: userMessage });

    let choice = await this.complete();

    while (this.hasToolCalls(choice)) {
      this.messages.push(choice.message);
      await this.executeToolCalls(choice);
      choice = await this.complete();
    }

    const reply = choice.message.content?.trim() || "(sin respuesta)";
    this.messages.push({ role: "assistant", content: reply });
    return reply;
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async complete(): Promise<Choice> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: this.messages,
      tools: this.tools,
    });
    return response.choices[0];
  }

  private hasToolCalls(choice: Choice): boolean {
    return (
      choice.finish_reason === "tool_calls" &&
      !!choice.message.tool_calls?.length
    );
  }

  private async executeToolCalls(choice: Choice): Promise<void> {
    for (const call of choice.message.tool_calls ?? []) {
      if (call.type !== "function") continue;

      const { name } = call.function;
      const args = JSON.parse(call.function.arguments);

      console.log(`  ⚙ ${name}(${JSON.stringify(args).slice(0, 120)}…)`);

      const result = await this.bridge
        .callTool(name, args)
        .catch((err: Error) => `Error ejecutando ${name}: ${err.message}`);

      this.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }
}
