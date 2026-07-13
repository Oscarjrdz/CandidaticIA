# Skills Candidatic — librería nativa de Agent Skills (Anthropic)

Esta carpeta es la **fuente de verdad** de la librería de skills de reclutamiento,
en el **formato nativo de Anthropic Agent Skills**: cada skill es una carpeta con un
archivo `SKILL.md` (frontmatter YAML `name` + `description`, cuerpo en markdown).
Versionada en git. Referencia: https://github.com/anthropics/skills

## Modelo de 3 capas

```
Brenda          = la cuenta de WhatsApp/Meta (el canal). Ya existe; el envío vive fuera.
                  El candidato SIEMPRE ve a "Brenda" porque es la cuenta que envía.

recruiter-*     = el AGENTE (reclutador): su estilo y persuasión. Agnóstico del cliente.
                  Va al system prompt del agente Claude.
                  Ej: recruiter-oscar, (futuro) recruiter-paty, recruiter-sam.

client-*        = el CLIENTE/vacante: hechos cerrados (sueldo, turno, ubicación, reglas).
                  El agente los consulta vía la herramienta `consultar_vacante`
                  (progressive disclosure: solo entran al contexto cuando se necesitan).
                  Ej: client-katcon, (futuro) client-metalsa, client-yageo.
```

Una conversación viva = **Brenda (canal) + un recruiter-\* (estilo) + un client-\* (hechos)**.
Ej: `Brenda + recruiter-oscar + client-katcon`. Escala en dos ejes (agente × cliente):
entra `recruiter-paty` y compone con cualquier cliente; entra `client-metalsa` y funciona
con cualquier reclutador. El matching es de rendimiento: quién convierte mejor en qué vacante.

## Cómo lo consume el sistema

- `brenda-recruiter-base/SKILL.md` — base común: cómo se comporta Brenda, ética, cuándo escalar.
- El backend nativo (`api/brenda-agent/`) corre sobre el **SDK oficial de Anthropic**
  (`@anthropic-ai/sdk`), modelo `claude-opus-4-8`, adaptive thinking, con **tool use** real.
- `assembleSystemPrompt()` junta base + recruiter en el system prompt; los hechos del
  client llegan por la herramienta `consultar_vacante`.

## Para ir en vivo

Falta un único paso operativo: configurar **`ANTHROPIC_API_KEY`** en las variables de
entorno de Vercel. Sin ella, el agente responde un aviso claro (no se rompe).

Nota de costo: `claude-opus-4-8` es el modelo más capaz; para alto volumen de WhatsApp
se puede cambiar a `claude-sonnet-5` (mucho más económico) en `api/utils/brenda-agent.js`
(`AGENT_MODEL`). Es decisión de costo del negocio.

## Convención de nombres (regla de Anthropic)

`name` en el frontmatter: minúsculas y guiones, máx. 64 chars, sin "claude"/"anthropic".
Por eso "Skill Katcon" → `client-katcon`, "Oscar Agent" → `recruiter-oscar`.
