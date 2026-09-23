# Limpieza "Brenda Copiloto" — registro

**Fecha:** 2026-09-22

## Qué se pidió

Oscar pidió eliminar el **"Brenda Copiloto"** — la burbuja flotante del dashboard ("Brenda IA",
sistema de respuestas por palabras clave, NO un agente real con LLM). Aclaró que la **sección
"Agent IA" SÍ existe y SE QUEDA** (esa es el agente real sobre Claude; no se toca).

## Estado encontrado (verificado contra el código y git)

**El "Brenda Copiloto" YA estaba borrado por completo.** Historial de git:
- `938b742a feat: eliminar Brenda Copiloto completamente`
- `59788c98 feat(agent): nueva sección Agent IA; elimina Brenda IA (skills) y Brenda Copiloto`

Ya no existen `src/components/FloatingCopilot.jsx` ni `api/utils/copilot-platform-stats.js`.
Solo quedaba **residuo inofensivo**: una variable muerta y comentarios viejos.

## Qué se limpió en esta pasada

1. **`src/App.jsx`** — se eliminó la variable muerta `isOscar` (y su comentario) que solo servía
   para gatear el toggle del agente y la burbuja Copiloto, ambos ya inexistentes. Ya no se usaba
   en ningún lado.
2. **`api/flows.js`** — comentario que mencionaba "el copiloto" reescrito (la fuente de datos
   `contar_altas_etiqueta` sigue existiendo; solo se quitó la referencia al copiloto muerto).
3. **`api/utils/openai.js`** — comentario del timeout: "for copilot + search calls" → "for
   search calls".

## Lo que NO se tocó (a propósito)

- **Sección "Agent IA"** (`src/components/AgentIASection.jsx`, `src/components/agent-ia/`,
  `api/agent-ia/`, `api/utils/agent-ia.js` + motor `agent-candidatic`/`agent-attend`, crons,
  `@anthropic-ai/sdk`): es el agente real en vivo. **Se queda.**
- **`InternalChat.jsx`**: es el chat interno del equipo (reclutadores), no el copiloto. Se queda.
- Copy de marketing "Brenda IA captura los datos por ti" en las landings: se refiere a la Brenda
  extractora de WhatsApp, no al copiloto. Se queda.

## Verificación

- `grep` de `copilot`/`isOscar` en `src/` y `api/` → cero referencias.
- `node --check` de los `.js` tocados → OK.
- `npm run build` → verde (2.57s); `AgentIASection` sigue empaquetado (Agent IA intacto).

## Memoria

Se borró el archivo de memoria stale `project_brenda_training.md` (describía la versión vieja de
skills, ya eliminada) y sus links colgantes. La sección "Agent IA" viva no tenía memoria propia;
si se requiere, se documenta aparte y con datos verificados.
