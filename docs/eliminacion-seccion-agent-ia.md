# Eliminación de la sección "Agent IA" (y motores Agent Candidatic / Agent Katcon)

**Fecha:** 2026-10-13
**Motivo:** La sección "Agent IA" era un intento de construir un agente propio con *skills*
(definición en `AGENTS.md` + memoria en `MEMORY.md`, tool use contra Redis). Se decidió
**abandonarlo** en favor de construir un **MCP** y conectarlo a "Grow Bot". Se eliminó todo el
clúster "como si nunca hubiera existido", documentando aquí qué era y qué se tocó para poder
revertir sin sorpresas.

> **Reversión:** todo el borrado está en git. `git revert`/`git checkout` del commit de esta
> limpieza restaura el código. Las llaves de Redis borradas (ver abajo) NO vuelven solas, pero
> eran estado del experimento (no datos de candidatos) y el código regenerado las recrearía vacías.

---

## Qué era (3 capas entrelazadas bajo el prefijo `agent-`)

### Capa 1 — La sección del dashboard (el "agente con skills")
Lo que el usuario veía como "Agent IA" (solo SuperAdmin): un chat con Claude (Haiku 4.5) que
podía leer datos vivos de Redis vía tool use, proponer ediciones al banco de respuestas, envíos
masivos con confirmación, y acumular memoria aprobada por humano.

- **UI:** `src/components/AgentIASection.jsx` + carpeta `src/components/agent-ia/`
  (`AgentChat.jsx`, `SkillsPanel.jsx`, `MemoryPanel.jsx`, `DocEditor.jsx`, `LiveAgentPanel.jsx`,
  `LiveChatViewer.jsx`, `api.js`). El transcript del chat vivía en **localStorage** del navegador
  (`candidatic:agent_ia_chat:<userId>`), nunca en Redis.
- **Endpoints:** carpeta `api/agent-ia/` (`chat.js`, `skills.js`, `memory.js`, `config.js`,
  `quick-reply.js`, `bulk-send.js`, `live-feed.js`, `live-agent.js`).
- **Infra base:** `api/utils/agent-ia.js` (~1,100 líneas: cliente Anthropic, assembleSystemPrompt,
  tools, lectura de candidatos/etiquetas/vacantes/stats).

### Capa 2 — El motor "Agent Candidatic" (atención automática en vivo)
Generalización por etiqueta del viejo Katcon: cuando un candidato con cierta etiqueta se completaba,
lo encolaba y un motor con Claude decidía qué mandarle automáticamente. **Apagado por default**
(gated por el flag Redis `candidatic:agent_live.on`, que solo se prendía desde `LiveAgentPanel` de la
sección borrada → inalcanzable sin la UI).

- `api/utils/agent-candidatic.js` (cola/estado/stats), `api/utils/agent-attend.js` (motor con Claude),
  `api/utils/agent-crm.js` (mover a proyecto), `api/utils/agent-send.js` (armado/envío de bundles),
  `api/utils/agent-live-feed.js` (feed de acciones).
- **Cron red de seguridad:** `api/cron/agent-candidatic.js` (cada 15 min).
- **Enganche en el núcleo:** `api/ai/agent.js`, en el bloque "candidato recién completo"
  (`maybeEnqueueForLiveAgent` + `attendLiveCandidate`).

### Capa 3 — El motor "Agent Katcon" (predecesor, cliente-específico)
El auto-envío del "PUNTO KATCON" (la cita) a candidatos con la etiqueta `KATCON ANUNCIO` al
completarse. Antecesor de la Capa 2, independiente. **El usuario confirmó que ya no se usa.**

- `api/utils/agent-katcon.js`, cron `api/cron/agent-katcon.js`.
- **Enganche en el núcleo:** `api/ai/agent.js` → `maybeSendKatconOnComplete`.
- Toggle histórico `agentMode` en el front (ya estaba hardcodeado en `false` y `ChatSection` lo
  ignoraba vía `_agentMode`) — también se retiró.

---

## Lo que SÍ se conservó (crítico — Flows depende de esto a nivel empresa)

`api/utils/agent-ia.js` exportaba funciones de utilidad que **Flows usa en producción viva**:
- `api/flows.js` → `getBotVacancies`, `buildDateKeys`, `getCapturesByAllTags`, `getCapturesTotal`.
- `api/utils/flow-engine.js` → `getBotVacancies`, `vacancyMessageText`.

Esas funciones **no se podían borrar**. Se extrajeron tal cual (comportamiento idéntico) a un
archivo neutral nuevo: **`api/utils/flows-data.js`** (más su dependencia interna `getTagCounts`,
ahora privada ahí). Se actualizaron los imports de `flows.js` y `flow-engine.js`.

> Verificado contra Redis real (2026-10-13): las 5 funciones devuelven datos correctos
> (10 vacantes activas, 1,049 altas del mes, 14 etiquetas con su desglose). `npm run build` OK,
> `node --check` OK en los 4 archivos backend, sin errores de lint nuevos (el único error,
> `setUser` sin usar en `App.jsx`, es preexistente).

(El motor Katcon — Capa 3 — NO se conservó: se eliminó también, por indicación del usuario.)

---

## Archivos tocados

### Borrados (20)
```
api/agent-ia/bulk-send.js   api/agent-ia/chat.js      api/agent-ia/config.js
api/agent-ia/live-agent.js  api/agent-ia/live-feed.js  api/agent-ia/memory.js
api/agent-ia/quick-reply.js api/agent-ia/skills.js
api/utils/agent-ia.js       api/utils/agent-candidatic.js  api/utils/agent-attend.js
api/utils/agent-crm.js      api/utils/agent-send.js        api/utils/agent-live-feed.js
api/utils/agent-katcon.js
api/cron/agent-candidatic.js  api/cron/agent-katcon.js
src/components/AgentIASection.jsx
src/components/agent-ia/  (carpeta completa: AgentChat, DocEditor, LiveAgentPanel,
                           LiveChatViewer, MemoryPanel, SkillsPanel, api.js)
```

### Creado (1)
- `api/utils/flows-data.js` — hogar neutral de las funciones compartidas que usa Flows.

### Modificados
- `api/ai/agent.js` — quitados los imports de katcon/live-agent y sus 2 bloques en "candidato recién
  completo"; el gancho ahora solo corre `runFlowsForCandidate`. Comentario del bloque actualizado.
- `api/flows.js` — import ahora desde `flows-data.js`.
- `api/utils/flow-engine.js` — import desde `flows-data.js`; 2 comentarios que apuntaban a
  `agent-katcon.js` hechos autosuficientes.
- `src/App.jsx` — quitado el lazy import de `AgentIASection`, las 2 ramas (título/subtítulo), la
  clase `p-0`, la rama de render, y el plumbing muerto de `agentMode`.
- `src/components/Sidebar.jsx` — quitado el icono `Sparkles` (import + mapeo de `agent-ia`).
- `src/constants/menuSections.js` — quitada la entrada `{ id: 'agent-ia' }`.
- `src/components/ChatSection.jsx` — quitado el bloque de comentario histórico de KATCON y el
  parámetro muerto `_agentMode`.
- `vercel.json` — quitadas la config de función de `api/agent-ia/chat.js` y los 2 crons
  (`agent-katcon`, `agent-candidatic`) con sus `maxDuration`.
- `.claude/settings.json` — quitada la entrada de permiso `node --check api/utils/agent-send.js`.

---

## Llaves de Redis borradas (2026-10-13) — por si hay un error después

Barrido con script desechable contra Redis de producción. **Existían y se borraron (7):**
```
agent-ia:memory_md          (string)  — contenido de MEMORY.md del agente
agent-ia:memory_pending     (string)  — propuestas de memoria sin aprobar
agent-ia:skills             (string)  — JSON de skills definidas
candidatic:agent_live       (string)  — estado del motor Agent Candidatic (on/off + etiquetas)
candidatic:agent_live:stats (string)  — contadores (atendidos, goles, duraciones)
candidatic:agent_live_feed  (string)  — feed de acciones del motor en vivo
agent:punto_sent:v1         (set)     — IDs de candidatos ya atendidos por Agent Katcon
```
**No existían (nada que borrar):** `agent-ia:agents_md`, `candidatic:agent_live:queue`,
`agent-ia:qr_edit:*` (TTL 1h), `agent-ia:attend_lock:*` (TTL corto).

> `agent:punto_sent:v1` era el set que evitaba doble-envío de KATCON. Irrelevante tras el borrado;
> si alguna vez se restaurara Katcon, arrancaría sin memoria de a quién ya atendió.
> Los transcripts del chat del agente vivían en **localStorage** del navegador de cada usuario,
> no en Redis — no hay nada que borrar ahí server-side (se limpian solos al no usarse la UI).
