import OpenAI from "openai";
import type { McpBridge } from "./mcp-bridge.js";

type Message = OpenAI.Chat.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.ChatCompletionTool;
type Choice = OpenAI.Chat.ChatCompletion.Choice;

const BASE_PROMPT =
  "Eres un asistente de Vivetix. Tienes acceso a documentación oficial de Vivetix " +
  "(aviso legal, política de privacidad, cookies, términos y condiciones, guías para organizadores, " +
  "atención al cliente, etc.) a través de herramientas específicas. " +
  "Cuando el usuario pregunte sobre algún tema relacionado con Vivetix, usa la herramienta " +
  "adecuada para consultar el documento correspondiente y responde con la información exacta. " +
  "Si la pregunta no se relaciona con Vivetix, responde que solo puedes ayudar con temas relacionados con Vivetix. " +
  "Siempre busca la información en los documentos antes de responder, no hagas suposiciones ni inventes respuestas. " +
  "Vivetix es una plataforma de venta de entradas para eventos, que ofrece servicios tanto a organizadores como a compradores de entradas." +
  "\n\nBÚSQUEDA DE EVENTOS:\n" +
  "Tienes la herramienta buscar_eventos para buscar eventos disponibles en Vivetix. Úsala cuando el usuario quiera encontrar eventos. " +
  "Estrategia de búsqueda:\n" +
  "- Si el usuario busca algo específico (ej: 'K-pop', 'Bad Bunny', 'festival de jazz'), usa el parámetro search con ese término, sin categoría.\n" +
  "- Si el usuario busca por tipo genérico (ej: 'eventos de música', 'fiestas', 'deportes'), usa la categoría correspondiente sin search.\n" +
  "- Si no encuentra resultados, intenta variaciones: sin acentos, en inglés, con sinónimos, o ampliando la búsqueda quitando la categoría.\n" +
  "- Si la primera búsqueda no da resultados, intenta al menos una variación más antes de decir que no hay eventos.\n" +
  "- Presenta los resultados de forma clara con título, fecha, lugar, precio y enlace.\n" +
  "- Nunca inventes eventos. Solo muestra los que devuelva la herramienta.";

function buildSystemPrompt(reportPhone: string): string {
  if (!reportPhone) return BASE_PROMPT;

  // Si es un JID de grupo (contiene @g.us), usarlo tal cual; si es un número, limpiar
  const recipient = reportPhone.includes("@")
    ? reportPhone.trim()
    : reportPhone.replace(/[^\d]/g, "");

  return (
    BASE_PROMPT +
    "\n\nREPORTE DE INCIDENCIAS TÉCNICAS:\n" +
    "Cuando un usuario reporte un problema técnico grave (errores HTTP como 400/500, funcionalidades que no cargan, " +
    "compras que se procesan sin pago, datos que no se guardan, problemas de rendimiento severos, etc.), " +
    "debes seguir este protocolo:\n" +
    "1. Pide al usuario la información necesaria: qué estaba haciendo, qué error vio, en qué dispositivo/navegador, " +
    "si puede reproducirlo. NO pidas capturas de pantalla (no hay forma de subirlas en este chat). " +
    "Pide un número de teléfono o correo electrónico de contacto para que el equipo técnico pueda comunicarse si necesita más detalles.\n" +
    "2. NO generes el reporte hasta tener suficiente información. Pregunta lo que falte.\n" +
    "3. Una vez tengas suficiente información, usa la herramienta send_message para enviar el reporte al equipo técnico. " +
    `Usa recipient="${recipient}" y como message envía un reporte estructurado con este formato:\n\n` +
    "🚨 *REPORTE DE INCIDENCIA — Chat Vivetix*\n\n" +
    "📋 REPORTE DE INCIDENCIA TÉCNICA\n" +
    "Fecha: (fecha actual)\n" +
    "Severidad: (Crítica/Alta/Media/Baja)\n" +
    "Categoría: (Error de pago/Error de carga/Error de datos/Error de autenticación/Otro)\n" +
    "Resumen: (descripción breve del problema)\n" +
    "Descripción detallada: (explicación completa)\n" +
    "Pasos para reproducir:\n1. ...\n2. ...\n" +
    "Dispositivo/Navegador: (si se proporcionó)\n" +
    "Contacto del usuario: (teléfono o correo proporcionado, si lo dio)\n" +
    "Impacto: (a quién y cómo afecta)\n\n" +
    "4. Después de enviar el reporte con send_message, responde al usuario confirmando brevemente que el problema fue reportado. " +
    "Si proporcionó datos de contacto, dile que es posible que el equipo técnico le contacte para más detalles. " +
    "NO muestres el contenido del reporte al usuario.\n" +
    "5. NUNCA ofrezcas transferir con un asesor humano. Tú eres el único punto de contacto."
  );
}

/**
 * Orchestrates the conversation between the user, OpenAI, and local MCP tools.
 * Detects technical issues and sends reports to WhatsApp.
 */
export class ChatEngine {
  private openai: OpenAI;
  private model: string;
  private bridge: McpBridge;
  private tools: Tool[] = [];
  private systemPrompt: string;
  private messages: Message[];

  constructor(
    openai: OpenAI,
    model: string,
    bridge: McpBridge,
    reportPhone: string = "",
  ) {
    this.openai = openai;
    this.model = model;
    this.bridge = bridge;
    this.systemPrompt = buildSystemPrompt(reportPhone);
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  /** Reset conversation history, keeping only the system prompt. */
  reset(): void {
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  /** Load tools from MCP and prepare the engine. */
  async init(): Promise<string[]> {
    this.tools = await this.bridge.listTools();
    return this.tools
      .filter((t): t is Tool & { type: "function" } => t.type === "function")
      .map((t) => t.function.name);
  }

  /**
   * Send a user message through OpenAI and return the reply.
   * The AI may autonomously call send_message to deliver reports to WhatsApp.
   */
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
      store: true,
      metadata: {
        source: "vivetix-chat",
      },
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

      console.log(`  ⚙ ${name}(${JSON.stringify(args).slice(0, 200)})`);

      let result: string;
      try {
        result = await this.bridge.callTool(name, args);
        console.log(`  ✓ ${name} → ${result.slice(0, 200)}`);
      } catch (err: any) {
        result = `Error ejecutando ${name}: ${err.message}`;
        console.error(`  ✗ ${name} falló:`, err.message);
      }

      this.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }
}
