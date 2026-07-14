# Brenda Agent — Sistema de Agente Nativo de Anthropic (Claude)

Documentación completa del sistema de agente reclutador construido sobre el estándar
**nativo de Anthropic Agent Skills**. Reemplazó por completo al sistema casero anterior
(GPT-4o-mini + JSON en Redis), que fue **borrado**. Última actualización: 2026-07-13.

> Solo el perfil de **Oscar** (`user_1768974645880` / WhatsApp `5218116038195`) ve el
> toggle del agente y la burbuja Brenda Copiloto. NO por rol (Paty también es SuperAdmin).

---

## 1. Arquitectura de 3 capas

```
Brenda   = LA CUENTA DE WHATSAPP / META (el canal). Ya existe; el envío sale por aquí.
           El candidato SIEMPRE ve "Brenda" porque es la cuenta que envía.

recruiter-*  = el AGENTE (reclutador): estilo y persuasión. Agnóstico del cliente.
               Va al system prompt del agente Claude. Ej: recruiter-oscar.

client-*     = el CLIENTE / vacante: hechos cerrados (sueldo, turno, ubicación, reglas).
               El agente los consulta vía la herramienta `consultar_vacante`
               (progressive disclosure). Ej: client-katcon.
```

Una conversación viva = **Brenda (canal) + un recruiter-\* (estilo) + un client-\* (hechos)**.
Escala en dos ejes (agente × cliente): entra `recruiter-paty` y compone con cualquier
cliente; entra `client-metalsa` y funciona con cualquier reclutador.

---

## 2. Implementación nativa (Claude)

- **SDK oficial:** `@anthropic-ai/sdk` (^0.111.0).
- **Modelo:** `claude-opus-4-8` (constante `AGENT_MODEL` en `api/utils/brenda-agent.js`).
  Para alto volumen se puede bajar a `claude-sonnet-5` (más económico) — decisión de costo.
- **Adaptive thinking**, `effort: low` para chat conversacional.
- **Tool use real** (loop manual): 2 herramientas —
  - `consultar_vacante` → devuelve los hechos del skill del cliente (el LLM PIENSA con ellos).
  - `enviar_mensaje_banco(nombre)` → manda un mensaje EXACTO del banco de respuestas.
- **Requiere `ANTHROPIC_API_KEY`** en las variables de entorno de Vercel. Sin ella, los
  endpoints responden un aviso claro (no rompen).

### Skills (formato SKILL.md nativo)
Carpetas en `/skills`, versionadas en git. Cada una es un `SKILL.md` con frontmatter YAML
(`name` + `description`) y cuerpo markdown. Convención de nombres (regla de Anthropic):
minúsculas-con-guiones, sin "claude"/"anthropic".

- `skills/brenda-recruiter-base/` — base común: comportamiento de Brenda, en qué punto
  entra (el candidato YA vio el anuncio de FB y ya completó su perfil → su trabajo es
  CITAR, no re-explicar), y la regla banco-vs-LLM.
- `skills/recruiter-oscar/` — estilo real de Oscar, sintetizado de ~434 mensajes reales.
- `skills/client-katcon/` — hechos reales de Katcon (Ayudante General $3,953.04/sem, turnos,
  ubicación, variantes montacargas/soldador, punto de encuentro, PUNTO KATCON).
- `vercel.json` → `includeFiles: "skills/**"` para que las funciones serverless los lean.

### La regla banco vs LLM (principio de Oscar)
> **Cuando toca mandar un mensaje de plantilla → mándalo del banco, EXACTO** (no lo
> reescribas: la logística —punto de encuentro, mapa, INE— sale intacta del banco).
> **Cuando toca pensar/contestar dudas → el LLM redacta.**

`getBankMessage(name, candidate)` en `api/utils/brenda-agent.js` jala el mensaje EXACTO del
banco real (`candidatic:quick_replies` en Redis, el mismo que usa el reclutador humano) y
sustituye `{{nombre}}` con `substituteVariables`. El texto NO lo genera el LLM.

---

## 3. Reglas de entrada del agente (CANDADOS)

El agente actúa **solo y siempre solo** para candidatos que cumplen los 3 candados:

1. **Perfil completo** → `isProfileComplete(c)`.
2. **Etiqueta `KATCON ANUNCIO`** (nombre EXACTO del tag) → `tags` incluye el tag.
3. **Humano NUNCA intervino** → `!c.blocked` (el flag `blocked` lo pone la intervención
   manual vía `autoSilenceBot`; `blocked=true` ⇒ un humano ya tomó el chat).

\+ candado interno: **una sola vez por candidato**.

**Paso 1 (determinista):** manda el mensaje de banco **`PUNTO KATCON`** (texto + 3 imágenes,
exacto). Al enviarse, deja la IA en **modo manual** (`blocked=true`) — el mismo efecto que
la intervención humana. Oscar audita el mensaje ya enviado.

---

## 4. Dos disparadores (ambos gateados por el toggle de Oscar)

El toggle "Agente" vive en el **super header de Chat Web** (App.jsx, junto a "Hola, Oscar",
solo para el perfil de Oscar). Su estado **persiste** en `user.preferences.agentMode` (Redis,
vía `PUT /api/users`). Es el **candado maestro**: si está OFF, nada dispara.

### A) On-open (Chat Web) — `ChatSection.jsx`
Con el toggle ON, al **abrir el chat** de un candidato elegible, el agente manda el PUNTO
KATCON en ese momento. Latencia = cuando Oscar abre ese chat. Es el modo de auditar
uno por uno. Implementado en un `useEffect` (deps: agentMode, chat id, tags.length, blocked,
quickReplies). Envía vía `handleSend(msg, imgs)` con imágenes explícitas.

### B) Automático (cron) — `api/cron/agent-katcon.js`
Corre **cada 15 min** (registrado en `vercel.json` crons). NO requiere abrir el chat. Cuando
el toggle de Oscar está ON, escanea candidatos, filtra por los 3 candados, y manda PUNTO
KATCON a los elegibles. Envía por el backend (`sendUltraMsgMessage`); imágenes por URL
absoluta pública (`https://www.candidatic.com/api/media/<id>.jpg` — `/api/image` es público).

**Candados de seguridad del cron:**
- Gateado por el toggle de Oscar (OFF = no hace nada).
- **Tope por corrida `BATCH_CAP = 15`**: rampa suave, no bombardea de golpe.
- Claim atómico `SADD agent:punto_sent:v1 <id>` (evita doble envío entre corridas; si falla
  el envío, se libera con SREM para reintentar).
- Al enviar: `blocked=true` (modo manual) + el mensaje aparece en el chat vía SSE (auditable).

> ⚠️ **Al 2026-07-13 había 77 candidatos elegibles.** Con el toggle ON, el cron los procesa
> a 15 por corrida (~1.5 h para los 77). Es envío real a personas reales — el toggle lo controla.

---

## 5. Visibilidad (solo Oscar)

`isOscar = user.id === 'user_1768974645880' || user.whatsapp === '5218116038195'`.
- Toggle del agente: solo lo ve Oscar (no por rol — Paty también es SuperAdmin).
- Burbuja FloatingCopilot (Brenda Copiloto): antes la veían todos los SuperAdmin; ahora solo Oscar.

---

## 6. Mapa de archivos

| Archivo | Qué es |
|---|---|
| `skills/*/SKILL.md` | Los skills nativos (base, recruiter-oscar, client-katcon) + README |
| `api/utils/brenda-agent.js` | Loader de SKILL.md, cliente Anthropic, `assembleSystemPrompt`, `getBankMessage`, auth |
| `api/brenda-agent/chat.js` | Agente conversacional (SDK, tool use) — usado por el chat de prueba en Brenda IA |
| `api/brenda-agent/skills.js` | Lista/lee los SKILL.md para la UI |
| `api/cron/agent-katcon.js` | **Disparador automático** (cron 15 min) |
| `src/components/IACopilotoSection.jsx` | Sección "Brenda IA": mapa, navegador de skills, chat de prueba |
| `src/components/brenda-agent/*` | UI: AgentChat, SkillsBrowser, api |
| `src/components/ChatSection.jsx` | Efecto del disparador **on-open** + `handleSend(msg, imgs)` |
| `src/App.jsx` | Toggle en super header + persistencia + gating `isOscar` |
| `vercel.json` | `includeFiles` de skills + cron `agent-katcon` |

---

## 7. Cómo operar

- **Prender/apagar el agente:** toggle "Agente ON/OFF" en el super header de Chat Web (solo Oscar). Persiste.
- **Agregar un reclutador:** crear `skills/recruiter-<nombre>/SKILL.md` (estilo). Commit + deploy.
- **Agregar un cliente:** crear `skills/client-<nombre>/SKILL.md` (hechos + nombre del mensaje de banco de cita). Commit + deploy.
- **Editar el mensaje de cita:** se edita en el banco de respuestas (Chat Web) — el agente jala el actualizado automáticamente. (Los candados actuales son solo para Katcon; extender el cron/efecto para otros clientes es trabajo pendiente.)
- **Probar sin enviar a reales:** sección Brenda IA → chat de prueba (recruiter × client).

---

## 8. Pendiente / siguiente

- Editor de skills en la UI (para crear reclutadores/clientes sin tocar archivos).
- Generalizar los candados a otros clientes (hoy el disparador está fijo a KATCON ANUNCIO / PUNTO KATCON).
- Pasos 2+ de la conversación (donde el LLM sí piensa y responde dudas), no solo el Paso 1 determinista.
- Disparador instantáneo en el webhook (latencia de segundos) como alternativa al cron de 15 min.
