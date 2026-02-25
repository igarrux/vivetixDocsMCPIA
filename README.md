# Vivetix Chat

Asistente de IA para Vivetix con acceso a documentación oficial y reporte automático de incidencias técnicas vía WhatsApp.

## Requisitos

- **Docker** (con Docker Compose)

## Instalación

### Opción A: Usar imagen pre-construida (recomendado)

```bash
docker pull ghcr.io/igarrux/vivetix-chat:latest
```

Luego ejecuta directamente:

```bash
docker run -d --name vivetix-chat \
  -p 3000:3000 \
  -e OPENAI_API_KEY="sk-proj-..." \
  -e OPENAI_MODEL=gpt-4o \
  -e ADVISOR_PHONE="+573001234567" \
  -v vivetix-data:/app/store \
  -t ghcr.io/igarrux/vivetix-chat:latest
```

### Opción B: Compilar desde el código fuente

#### 1. Clonar el repositorio

```bash
git clone https://github.com/igarrux/vivetixDocsMCPIA.git
cd vivetixDocsMCPIA
```
docker pull ghcr.io/igarrux/vivetix-chat:latest



#### 2. Configurar variables de entorno

Copia el archivo de ejemplo y edítalo con tus valores:

```bash
cp .env.example .env
```

Edita `.env`:

```dotenv
# Obligatorio — tu API key de OpenAI
OPENAI_API_KEY=sk-proj-...

# Opcional
OPENAI_MODEL=gpt-4o            # Modelo de OpenAI a usar
ADVISOR_PHONE=+573001234567    # Teléfono que recibe reportes técnicos por WhatsApp
PORT=3000                       # Puerto del servidor web
```

#### 3. Construir la imagen

```bash
docker-compose build
```

#### 4. Iniciar el contenedor

```bash
docker-compose up -d
```

### Vincular WhatsApp (primera vez)

Al iniciar por primera vez, el bridge de WhatsApp genera un código QR que debes escanear con tu teléfono:

```bash
docker-compose logs -f
```

Cuando veas el QR en la terminal:

1. Abre WhatsApp en tu teléfono
2. Ve a **Configuración → Dispositivos vinculados → Vincular dispositivo**
3. Escanea el código QR

Una vez vinculado, el servidor arranca automáticamente. La sesión se guarda en un volumen persistente, así que **no necesitas volver a escanear** al reiniciar el contenedor.

### Acceder al chat

Abre en tu navegador:

```
http://localhost:3000
```

## Comandos útiles

```bash
# Iniciar
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f

# Detener
docker-compose down

# Reconstruir (después de cambios en el código)
docker-compose up -d --build

# Reiniciar sesión de WhatsApp (escanear QR de nuevo)
docker volume rm chatmcp_whatsapp-data
docker-compose up -d
docker-compose logs -f
```

## Sin Docker Compose

También puedes usar `docker run` directamente:

```bash
docker build -t vivetix-chat .

docker run -d --name vivetix-chat \
  -p 3000:3000 \
  -e OPENAI_API_KEY="sk-proj-..." \
  -e OPENAI_MODEL=gpt-4o \
  -e ADVISOR_PHONE="+573001234567" \
  -v vivetix-data:/app/store \
  -t vivetix-chat

# Ver QR
docker logs -f vivetix-chat
```

## Arquitectura

```
┌──────────────────────────────────────────────┐
│  Contenedor Docker                           │
│                                              │
│  ┌────────────────┐   ┌──────────────────┐   │
│  │  Node.js (tsx)  │   │  Go Bridge       │   │
│  │  Web Server     │   │  WhatsApp API    │   │
│  │  :3000          │   │  :8080           │   │
│  └───────┬────────┘   └────────▲─────────┘   │
│          │                     │              │
│          │  MCP (stdio)        │  HTTP        │
│          ▼                     │              │
│  ┌────────────────┐   ┌───────┴──────────┐   │
│  │  MCP Docs      │   │  Python MCP      │   │
│  │  Server (tsx)   │   │  Server (uv)     │   │
│  └────────────────┘   └──────────────────┘   │
│                                              │
│  📁 /app/store (volumen persistente)         │
│     ├── whatsapp.db  (sesión WhatsApp)       │
│     └── messages.db  (mensajes)              │
└──────────────────────────────────────────────┘
```

## Variables de entorno

| Variable | Obligatorio | Default | Descripción |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | API key de OpenAI |
| `OPENAI_MODEL` | — | `gpt-4o` | Modelo de chat |
| `ADVISOR_PHONE` | — | — | Teléfono para recibir reportes técnicos (formato internacional con `+`) |
| `PORT` | — | `3000` | Puerto del servidor web |
