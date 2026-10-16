# MCP de Candidatic para Grok — Plan y Especificación

> **Estado:** **Fase 1 (lectura) EN PRODUCCIÓN y verificada con Grok real.** **Fase 2 (escritura) desplegada 2026-10-15** — 5 tools: marcar_leido, enviar_mensaje, enviar_banco_respuesta, toggle_bot, etiquetar. Fase 3 pendiente.
>
> **Fase 3 + plantillas desplegadas (2026-10-15):** `enviar_plantilla` (plantilla oficial Meta — resuelve la ventana de 24h), `crear_recordatorio` (campanita), `bloquear` (Meta block real). `enviar_mensaje` verificado en vivo con Grok.
>
> **Proyectos (CRM Manual) desplegado (2026-10-15):** 8 tools — `listar_proyectos`, `ver_candidatos_proyecto`, `meter_en_proyecto`, `sacar_de_proyecto`, `mover_en_proyecto`, `crear_proyecto`, `agregar_paso`, `eliminar_proyecto` (destructivo). Reusan `/api/manual_projects`. **RBAC:** crear/eliminar proyectos y editar pasos exigen SuperAdmin → la sesión de sistema efímera de `callInternal` ahora se identifica como un SuperAdmin real (`getSystemUserId`, cacheado). **Total: 30 tools.**
>
> **Cómo funciona la escritura (Fase 2):** las tools NO reimplementan la lógica del Chat Web. Llaman internamente (fetch a la misma URL pública) a los endpoints ya probados (`/api/chat`, `/api/candidates/block`, `/api/candidates/bulk-tag`) usando una **sesión de reclutador de SISTEMA efímera** (`session:admin:mcpsys_<rand>`, userId `mcp-grok`, TTL 120s) que valida `validateAdminSession`. Así reusa el pipeline completo (media multi-número, reintentos, stats, SSE, silencio de la IA). Lección del 403: era el kill switch en OFF, NO firewall.
> **Fecha:** 2026-10-14.
>
> **Archivos creados en Fase 1:**
> - `api/mcp/index.js` — el MCP server (JSON-RPC stateless, Bearer `mcp:token`, kill switch `mcp:enabled`) con las **14 tools de lectura**.
> - `api/mcp/config.js` — panel del dashboard (`GET`/`PUT`): prende/apaga y muestra/rota el token.
> - `src/components/WhatsAppSettings.jsx` — se quitó el recuadro azul de Meta y en su lugar quedó la tarjeta MCP (switch + URL + token).
>
> **Verificado:** `node --check`, `eslint` (limpio), `npm run build` (OK). **NO verificado aún** (requiere deploy + switch ON): la conexión real desde Grok y las lecturas contra Redis de producción.
>
> **Para activarlo:** desplegar → Configuración → WhatsApp → encender el switch MCP → copiar URL + token → pegarlos en `grok.com/connectors` (Custom).
> **Objetivo:** que el bot **Grok (de xAI)** pueda operar la sección **Chat Web** de Candidatic como si fuera un reclutador humano, conectándose a un **MCP server** propio de Candidatic.

Este documento reemplaza al clúster `agent-*` eliminado el 2026-10-13 (ver `docs/eliminacion-seccion-agent-ia.md`). La idea del agente propio con skills se abandonó; en su lugar, Candidatic **expone un MCP server** y **Grok es el cerebro** que se conecta a él.

> ⚠️ **Nota de nombre:** en notas viejas aparece como "Grow Bot". Es un typo. El producto real es **Grok (xAI)**, que soporta "Bring Your Own MCP".

---

## 1. Qué es (arquitectura en una línea)

Candidatic levanta un **endpoint HTTP** (`api/mcp/`) que habla el protocolo **MCP**. Ese endpoint expone *tools* (leer chats, enviar mensajes, etiquetar, etc.). **Grok se conecta a ese endpoint**, descubre las tools solas, y las usa para operar el Chat Web.

```
Grok (grok.com / API xAI)  ──HTTP(S) + token──►  api/mcp/ (Vercel)  ──►  storage.js / endpoints existentes  ──►  Redis / WhatsApp Cloud API
```

**El MCP server NO tiene UI propia.** Es máquina-a-máquina. La única UI es una tarjetita de control (switch ON/OFF) dentro de Configuración → WhatsApp (ver §6).

---

## 2. Cómo se conecta Grok (documentación oficial de xAI)

Dos caminos (el usuario elige uno):

- **Web app (más fácil):** `grok.com/connectors` → "New Connector" → "Custom" → pegar la **URL del MCP** + autenticación.
- **API de xAI (Remote MCP Tools):** en la llamada se manda
  ```json
  { "tools": [{ "type": "mcp", "server_url": "https://www.candidatic.com/api/mcp", "server_label": "candidatic", "authorization": "Bearer <TOKEN>" }] }
  ```

**Requisitos duros de xAI:**
- Transporte: **Streamable HTTP o SSE** (NO stdio). → Implementar el endpoint como HTTP/SSE.
- El servidor debe ser **público con HTTPS**. → Vercel lo cumple (`candidatic.com`).
- Auth: header `Authorization: Bearer <token>` (+ headers custom opcionales).
- `server_label` identifica las tools en las llamadas.

Fuentes oficiales:
- https://docs.x.ai/developers/tools/remote-mcp
- https://docs.x.ai/build/features/mcp-servers
- https://docs.x.ai/grok/connectors

---

## 3. Lista COMPLETA de funciones (tools) que podrá hacer el bot

La lista fue acordada con el usuario. Divididas por grupo. En cada una se anota a qué lógica/endpoint/llave de Redis existente se conecta por dentro (para no reinventar nada).

### Leer (cero riesgo — Fase 1)
| # | Tool | Qué hace | Se apoya en |
|---|------|----------|-------------|
| 1 | `listar_chats` | Lista de chats (último mensaje, no leídos, etiquetas) | `GET /api/chat`, `chat-unread-count.js` |
| 2 | `leer_chat` | Historial completo de un chat | `GET /api/chat` / `storage.js` |
| 3 | `buscar_candidato` | Busca un candidato | `storage.js` (índices) |
| 4 | `ver_perfil_candidato` | Datos: nombre, edad, municipio, escolaridad, categoría, colonia, experiencia, vacante actual | `getCandidateById` |
| 5 | `listar_banco_respuestas` | Banco de respuestas disponibles (name, shortcut, texto, media) | Redis `candidatic:quick_replies` |
| 6 | `listar_etiquetas` | Todas las etiquetas disponibles | `api/tags.js` / `candidatic:chat_tags` |
| 7 | `ver_etiquetas_candidato` | Etiquetas de un candidato específico | `storage.js` / `candidatic:chat_tags` |
| 8 | `ver_estado_bot` | Si el bot (Brenda) está activo o silenciado en ese chat | `api/bot-ia/…` / flag en candidato |
| 9 | `ver_estado_crm` | Estado/columna del candidato en el CRM | `api/candidates.js` |
| 10 | `ver_recordatorios` | Recordatorios (campanita) de un candidato | `candidate-reminders.js` |
| 11 | `ver_expediente` | Archivos guardados del expediente digital | `candidates/expediente.js`, `candidate:expediente:<id>` |
| 12 | `listar_plantillas` | Plantillas oficiales de Meta disponibles | `reminder-templates.js` / settings |
| 13 | `listar_vacantes` | Vacantes disponibles | `api/vacancies.js` / `flows-data.js` (`getBotVacancies`) |
| 14 | `ver_presencia` | Quién está atendiendo un chat (presencia / lock) | `api/presence.js`, `api/chat.js` (lock) |

### Responder (Fase 2)
| # | Tool | Qué hace | Se apoya en |
|---|------|----------|-------------|
| 15 | `enviar_mensaje` | Envía un mensaje de texto al candidato | `POST /api/chat` (type text) |
| 16 | `enviar_banco_respuesta` | Envía una respuesta del banco (variables + frase dinámica + media **resueltas en el server**) | `candidatic:quick_replies` + `POST /api/chat` |

### Gestionar el chat (Fase 2/3)
| # | Tool | Qué hace | Se apoya en |
|---|------|----------|-------------|
| 17 | `marcar_leido` | Marca chat leído / no leído | `PUT /api/chat` (mark_read / mark_unread) |
| 18 | `toggle_bot` | Desactiva o activa a Brenda en ese chat | `api/bot-ia/…` |
| 19 | `etiquetar` | Pone o quita etiquetas | `api/tags.js`, `candidates/bulk-tag.js` |
| 20 | `mover_crm` | Mueve al candidato de columna / cambia estado | `api/candidates.js` |

### Acciones avanzadas (Fase 3)
| # | Tool | Qué hace | Se apoya en |
|---|------|----------|-------------|
| 21 | `bloquear` | Bloqueo interno (silencia IA) o real en Meta | `candidates/block.js`, `candidates/meta-block.js` |
| 22 | `crear_recordatorio` | Crea un recordatorio (campanita) | `candidate-reminders.js` |

---

## 4. Banco de respuestas — detalle importante

- Vive en UNA sola llave Redis: `candidatic:quick_replies` (array JSON).
- Cada respuesta: `{ id, name, shortcut, message, dynamicPhrase, imageUrl, imageUrl2..4, type (text/image/audio/document/location), locName/locAddress/locLat/locLng, audioUrl/audioMime/audioVoice/audioDurationMs, documentUrl/documentName }`.
- **Regla de oro:** Grok solo elige CUÁL respuesta mandar (por `name` o `shortcut`). **El servidor resuelve el contenido**, usando `substituteVariables()` (de `api/utils/shortcuts.js`) + `substituteDynamicPhrase()`, igual que el Chat Web en `ChatSection.jsx` (~línea 2122). NUNCA dejar que Grok arme el texto a mano ni reimplementar variables (CLAUDE.md lo prohíbe explícitamente — ya causó un bug una vez).

**Decisión pendiente:** cuando una respuesta trae `{{frase dinamica}}`, ¿Grok puede inyectar un valor (ej. vacante específica) o se usa siempre el valor fijo guardado? (Por definir — default propuesto: valor fijo, más predecible.)

---

## 5. Seguridad / auth

- El endpoint `api/mcp/` valida un **token Bearer dedicado** (`MCP_TOKEN` en env de Vercel), NO la sesión de reclutador normal. Grok manda ese token en `Authorization`.
- Las tools que MUTAN datos deben respetar el patrón del repo: por dentro llaman la misma lógica que ya pasa por `validateAdminSession` (ver `feedback_patron_auth_endpoints`). El MCP actúa como un "reclutador de sistema".
- **Kill switch:** flag Redis `mcp:enabled`. Si está OFF, el endpoint rechaza TODO (incluso lectura). Es la red de seguridad #1.

---

## 6. UI — tarjeta de control (sin sección nueva)

Decisión del usuario: **NO crear sección nueva** para no agrandar Configuración. En su lugar, **reutilizar el espacio** del recuadro azul "API Oficial de Meta WhatsApp Cloud".

- Archivo: `src/components/WhatsAppSettings.jsx`, líneas ~280-290 (el `{/* Info footer */}` azul con el `Shield`).
- **Quitar** ese recuadro y poner en su lugar la **tarjeta del MCP** con:
  - **Switch ON/OFF del MCP** (lo principal — escribe `mcp:enabled` en Redis).
  - **URL del MCP** (`{origin}/api/mcp`) con botón copiar (mismo patrón que el Webhook URL de arriba).
  - **Token** con copiar / rotar.
- Resultado: la tarjeta de WhatsApp queda del mismo tamaño, sin crecer.

---

## 7. Fases de implementación

1. **Fase 1 — MCP de solo lectura.** Endpoint `api/mcp/` (HTTP/SSE + token + kill switch) con las tools de LECTURA (#1–14). + tarjeta UI con switch/URL/token. Conectar en `grok.com/connectors` y confirmar que Grok descubre y llama las tools. Cero riesgo (no escribe nada).
2. **Fase 2 — Responder + gestión básica.** Agregar #15–20 (`enviar_mensaje`, `enviar_banco_respuesta`, `marcar_leido`, `toggle_bot`, `etiquetar`, `mover_crm`). Considerar un "modo supervisado" al inicio (loguear todo lo que hace el bot).
3. **Fase 3 — Avanzadas.** #21–22 (`bloquear`, `crear_recordatorio`).

---

## 8. Reglas del repo a respetar (de CLAUDE.md)

- Variables de plantilla: SIEMPRE `substituteVariables()` de `api/utils/shortcuts.js`. Nunca regex propio.
- Fire-and-forget (`.catch(()=>{})` sin await) para telemetría/logs/SSE; pipeline de Redis para 2+ ops.
- Zona horaria `America/Monterrey` para cualquier agregado por día.
- Deploy: `git push origin main` ya despliega; NUNCA correr `vercel --prod` después.
- Verificar: `node --check`, `npx eslint` (comparar con errores preexistentes), `npm run build`, y si toca Redis probar contra Redis real con un candidato de prueba desechable.
- No hay navegador en el entorno: cambios visuales los confirma el usuario.

---

## 9. Decisiones pendientes (para cerrar antes/durante implementación)

1. Frase dinámica en banco de respuestas: ¿Grok inyecta valor o valor fijo? (default propuesto: fijo.)
2. ¿"Modo supervisado" en Fase 2 (aprobar cada mensaje) o Grok responde directo con el kill switch como única red?
3. ¿Conexión por `grok.com/connectors` (web) o por la API de xAI? (ambas funcionan con el mismo endpoint.)
