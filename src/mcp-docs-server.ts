#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "docs");

// ── Document registry ─────────────────────────────────────────────────
// Each entry maps to a .md file in src/docs/ and becomes an MCP tool.
const DOCUMENTS = [
  {
    id: "aviso_legal",
    file: "aviso-legal.md",
    title: "Aviso Legal",
    description:
      "Consulta el aviso legal de Vivetix: datos del titular, propiedad intelectual, hiperenlaces, exclusión de responsabilidad y legislación aplicable.",
  },
  {
    id: "politica_cookies",
    file: "politica-cookies.md",
    title: "Política de Cookies",
    description:
      "Consulta la política de cookies de Vivetix: tipos de cookies utilizadas, finalidades, cómo configurarlas o desactivarlas.",
  },
  {
    id: "politica_privacidad",
    file: "politica-privacidad.md",
    title: "Política de Privacidad",
    description:
      "Consulta la política de privacidad de Vivetix: tratamiento de datos personales, derechos ARCO, base legal y plazos de conservación.",
  },
  {
    id: "terminos_condiciones",
    file: "terminos-condiciones.md",
    title: "Términos y Condiciones",
    description:
      "Consulta los términos y condiciones de Vivetix: registro, publicación de eventos, compra de entradas, cambios y devoluciones, responsabilidad.",
  },
  {
    id: "que_es_vivetix",
    file: "sobre-nosotros-que-es-vivetix.md",
    title: "¿Qué es Vivetix?",
    description:
      "Descripción general de la plataforma Vivetix: qué es, a quién va dirigida y qué problema resuelve.",
  },
  {
    id: "como_funciona_vivetix",
    file: "sobre-nosotros-como-funciona-vivetix.md",
    title: "¿Cómo funciona Vivetix?",
    description:
      "Explicación paso a paso de cómo funciona Vivetix tanto para organizadores como para compradores de entradas.",
  },
  {
    id: "que_ofrece_vivetix_organizadores",
    file: "sobre-nosotros-que-ofrece-vivetix-organizadores.md",
    title: "¿Qué ofrece Vivetix para organizadores?",
    description:
      "Servicios y beneficios que Vivetix ofrece a los organizadores de eventos: herramientas, panel de control, gestión de pagos.",
  },
  {
    id: "precio",
    file: "sobre-nosotros-precio.md",
    title: "Precio de Vivetix",
    description:
      "Información sobre las tarifas, comisiones y gastos de gestión de Vivetix para organizadores y compradores.",
  },
  {
    id: "alternativa_venta_entradas",
    file: "sobre-nosotros-alternativa-venta-entradas-online.md",
    title: "Alternativa para vender entradas online",
    description:
      "Comparativa y ventajas de Vivetix como alternativa para la venta de entradas online frente a otras plataformas.",
  },
  {
    id: "beneficios_kit_digital",
    file: "sobre-nosotros-beneficios-kit-digital.md",
    title: "Beneficios del kit digital",
    description:
      "Ventajas y funcionamiento del kit digital, instrucciones y recomendaciones para organizadores.",
  },
  {
    id: "como_organizar_evento",
    file: "organiza-tu-evento-como-organizar-un-evento.md",
    title: "¿Cómo organizar un evento por internet?",
    description:
      "Guía completa para organizar un evento online: briefing, planificación, difusión y ejecución.",
  },
  {
    id: "como_promocionar_evento",
    file: "organiza-tu-evento-como-promocionar-un-evento.md",
    title: "¿Cómo promocionar tu evento online?",
    description:
      "Estrategias y consejos para promocionar eventos en línea: redes sociales, email marketing, SEO.",
  },
  {
    id: "promocionar_yoga_pilates",
    file: "organiza-tu-evento-promocionar-yoga-pilates.md",
    title: "Organizar y promocionar clases de yoga y pilates",
    description:
      "Recomendaciones específicas para organizar y promover eventos de yoga y pilates online.",
  },
  {
    id: "recaudar_fondos_ong",
    file: "organiza-tu-evento-recaudar-fondos-ong-fundacion.md",
    title: "Vender entradas para eventos benéficos",
    description:
      "Cómo usar Vivetix para organizar eventos solidarios y recaudar fondos para ONGs o fundaciones.",
  },
  {
    id: "organizar_promocionar_concierto",
    file: "organiza-tu-evento-como-organizar-promocionar-concierto.md",
    title: "Organizar y promocionar conciertos",
    description:
      "Pasos para crear, gestionar y promocionar conciertos de música a través de Vivetix.",
  },
  {
    id: "como_crear_evento_online",
    file: "atencion-al-cliente-como-crear-un-evento-online.md",
    title: "¿Cómo crear un evento online?",
    description:
      "Instrucciones detalladas para crear un evento en la plataforma Vivetix desde cero, cómo editar uno creado, agregar planos y demás configuraciones relacionadas con la creación de eventos.",
  },
  {
    id: "como_sacar_dinero_recaudado",
    file: "atencion-al-cliente-como-saco-el-dinero-recaudado.md",
    title: "¿Cómo se saca el dinero recaudado?",
    description:
      "Proceso y requisitos para retirar los fondos obtenidos por la venta de entradas en Vivetix.",
  },
  {
    id: "codigos_promocionales",
    file: "atencion-al-cliente-descuentos-codigos-promocionales.md",
    title: "¿Cómo funcionan los códigos promocionales?",
    description:
      "Creación, gestión y aplicación de códigos de descuento y promociones en Vivetix.",
  },
  {
    id: "recompensar_promotores",
    file: "atencion-al-cliente-como-recompensar-promotores.md",
    title: "¿Cómo recompensar a los que compartan mi evento?",
    description:
      "Opciones y mecanismos para premiar a quienes promuevan y compartan tus eventos en Vivetix.",
  },
  {
    id: "control_acceso_eventos",
    file: "atencion-al-cliente-control-de-acceso-a-eventos.md",
    title: "¿Cómo controlar el acceso a tu evento?",
    description:
      "Herramientas de control de acceso: validación QR, listas de asistentes, app de escaneo.",
  },
  {
    id: "contactar_vivetix",
    file: "atencion-al-cliente-contactar-vivetix.md",
    title: "Contactar con Vivetix",
    description:
      "Datos de contacto, email, dirección postal y canales de soporte de Vivetix.",
  },
] as const;

// ── Helper ────────────────────────────────────────────────────────────
function readDoc(filename: string): string {
  const filePath = resolve(DOCS_DIR, filename);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return `Error: no se pudo leer el archivo ${filename}`;
  }
}

// ── MCP Server ────────────────────────────────────────────────────────
const server = new McpServer({
  name: "vivetix-docs",
  version: "1.0.0",
});

// Register each document as a tool (no input parameters needed)
for (const doc of DOCUMENTS) {
  server.registerTool(
    doc.id,
    {
      title: doc.title,
      description: doc.description,
    },
    () => ({
      content: [
        {
          type: "text" as const,
          text: readDoc(doc.file),
        },
      ],
    }),
  );
}

// ── Start ─────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
