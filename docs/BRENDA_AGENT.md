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

## 4. El disparador: EVENT-DRIVEN (server-side) + cron de respaldo

El toggle "Agente" vive en el **super header de Chat Web** (App.jsx, junto a "Hola, Oscar",
solo para el perfil de Oscar). Su estado **persiste** en `user.preferences.agentMode` (Redis,
vía `PUT /api/users`). Es el **candado maestro**: si está OFF, nada dispara.

Toda la lógica de envío está en un helper compartido: **`api/utils/agent-katcon.js`**
(`maybeSendKatconOnComplete`, `sendPuntoKatconTo`, `cumpleCandados`, `getToggleState`,
`getPuntoKatconBank`). Los dos disparadores lo reutilizan — cero duplicación.

### A) PRINCIPAL — event-driven en el extractor (`api/ai/agent.js`)
El disparo va **en el instante exacto en que Brenda termina la extracción**: cuando
`paso2Estado` pasa a `'completo'` EN ESE TURNO. El tag `KATCON ANUNCIO` ya viene puesto
**desde que el candidato entró por el anuncio de FB** (`webhook.js`); lo único que faltaba
era completar → por eso el disparo va justo donde se marca completo. Es una llamada
**fire-and-forget** (`.catch(()=>{})`, sin `await`) tras persistir al candidato: **nunca
bloquea ni rompe el extractor**.

- **No requiere el dashboard abierto.** Es 100% backend. Flujo de Oscar: *"prendo el toggle,
  me voy a comer, y a todos los que entren y completen que les mande la cita"* — exacto.
- **Latencia: segundos** (en cuanto completa), no 15 min.
- **Consumo: cero polling.** Solo corre cuando un candidato realmente completa. Recibe el
  snapshot ya mergeado del candidato → no re-lee de Redis.

### B) RESPALDO — cron (`api/cron/agent-katcon.js`)
Corre **cada 15 min** (registrado en `vercel.json` crons) como **red de seguridad** por si el
evento se perdió (deploy justo al completar, error puntual, toggle prendido después de que
alguien ya había completado). La mayoría de las veces no manda nada (el evento ya atendió a
todos y quedaron con el SADD puesto).

- **Consumo mínimo:** `zrevrangebyscore('candidates:list', '+inf', since)` trae SOLO los
  candidatos con actividad DESPUÉS del corte — no barre miles. Al prender el toggle
  (`since=ahora`) devuelve 0; solo crece conforme entran nuevos (≈39 tras 2h, 131 en 24h).
- Mismo helper de envío que el evento; imágenes por URL pública
  (`https://www.candidatic.com/api/media/<id>.jpg` — `/api/image` es público).
- **Tope por corrida `BATCH_CAP = 15`**: rampa suave.

**Candados de seguridad (compartidos por AMBOS disparadores, en `agent-katcon.js`):**
- **Toggle de Oscar** (`getToggleState`): OFF = nada dispara.
- **NO RETROACTIVO (corte):** al PRENDER el toggle se guarda `agentModeSince` (timestamp).
  Solo se atienden candidatos con **actividad DESPUÉS del corte**. El backlog viejo NO se
  toca — Oscar lo cita a mano; el agente cubre a los que **van entrando**.
- **Perfil completo** + **etiqueta KATCON ANUNCIO** + **humano nunca intervino** (`!blocked`).
- **Una sola vez por candidato:** claim atómico `SADD agent:punto_sent:v1 <id>` — **esto es lo
  que impide el doble envío entre el evento y el cron**. Si el envío falla, se libera con SREM.
- **No re-citar:** si ya tiene la invitación en su historial ("vengas a una"), se salta.
- Al enviar: `blocked=true` (modo manual) + el mensaje aparece en el chat vía SSE (auditable).

> Nota histórica: había un backlog de ~77 candidatos viejos (completos + KATCON ANUNCIO,
> jamás citados, actividad >72h) que el agente NO toca por el corte — Oscar los considera cerrados.

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
| `api/utils/agent-katcon.js` | **Helper compartido**: candados, envío, toggle, disparador event-driven |
| `api/ai/agent.js` | **Disparador PRINCIPAL** (event-driven): llama `maybeSendKatconOnComplete` al completar |
| `api/cron/agent-katcon.js` | **Disparador de RESPALDO** (cron 15 min, red de seguridad) |
| `src/components/IACopilotoSection.jsx` | Sección "Brenda IA": mapa, navegador de skills, chat de prueba |
| `src/components/brenda-agent/*` | UI: AgentChat, SkillsBrowser, api |
| `src/components/ChatSection.jsx` | (El disparador on-open se ELIMINÓ — ahora es server-side) |
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
- ~~Disparador instantáneo (latencia de segundos)~~ ✅ **HECHO**: event-driven en el extractor
  (`maybeSendKatconOnComplete` al marcar `paso2Estado='completo'`). El cron quedó como respaldo.
