# Sala de Espera determinista (Brenda post-registro)

> Bitácora de la sesión del **2026-10-08**. Todos los cambios viven en
> `api/ai/agent.js` (salvo el fix de reacciones, en `api/whatsapp/utils.js` +
> `api/utils/orchestrator.js`, y la UI en `src/components/BotIASection.jsx`).

## Qué es la Sala de Espera

Es el modo de Brenda cuando un candidato **ya completó su registro** (paso 1 `COMPLETO`
**y** `paso2Estado === 'completo'`). Su misión de extracción terminó; solo recibe mensajes
mientras un reclutador humano le da seguimiento.

**Antes:** llamaba a OpenAI con un prompt y "seguía la corriente" — el candidato creía que
estaba disponible y seguía preguntando.

**Ahora:** es **100% determinista** (sin IA). Se activa con el toggle de Configuración →
Bot IA → tarjeta "Sala de Espera" (`gptHostEnabled`). Toggle OFF = silencio total.

## Clasificación del mensaje entrante (4 buckets)

Al llegar un mensaje de un candidato completo, Brenda lo clasifica en orden:

| # | Bucket | Qué lo activa | Respuesta |
|---|--------|---------------|-----------|
| 1 | **Agradecimiento** | gracias, grax, agradezco, thanks (tolerante a faltas: grasias, garcias, graxias, graciasss) | reacción 👍 + cierre cálido corto rotado |
| 2 | **Despedida** | adiós, bye, nos vemos, cuídate, bendiciones, hasta luego, buenas noches | reacción 👋 + **silencio** (sin texto) |
| 3 | **Acuse corto** | ok, va, sale, vale, listo, perfecto, o **solo un emoji** | reacción 👍 + **silencio** (sin texto) |
| 4 | **Pregunta / insistencia / plática** | "?", vacante, sueldo, cuándo, dónde, horario, "hola", "oye", o cualquier otra cosa | frase de "ocupada" rotada (dame unos minutitos…) |

- **Rotaciones (no repiten seguido al mismo candidato):** 8 cierres cálidos
  (`SALA_ESPERA_CIERRE`, índice `salaEsperaCierreIdx`) y 20 frases de "ocupada"
  (`SALA_ESPERA_BUSY`, índice `salaEsperaPhraseIdx`). Avanzan solo cuando se usan.
- Nunca ofrece vacante/cita/sueldo ni pide datos nuevos (esos ya los tiene).

## Saludo por hora

Cuando la respuesta lleva texto (buckets 1 y 4; en despedida/acuse no, son silencio) se
antepone un saludo **solo si**:

1. El candidato **regresa tras ≥ 2 h** sin actividad de Brenda (`minSinceLastBot >= 120`,
   const `SALA_ESPERA_RETURN_MIN`). A media charla **no** re-saluda.
2. **No lo ha saludado hoy** (`salaEsperaGreetDate`, zona Monterrey, sin cron).

Franjas (hora Monterrey): **buenos días** 5–11, **buenas tardes** 12–18, **buenas noches**
19–4. Ej.: `Hola Oscar, buenas tardes 😊`.

## + Desactivar bot 24h (pasa a humano)

Tras responder en **cualquier** bucket, Brenda se **desactiva 24 h** (mismo patch que el
nodo "Desactivar Bot" / intervención humana: `blocked` + `blockedAt` + `blockedExpiresAt`
= ahora + `HUMAN_INTERVENTION_SILENCE_MS` + `blockedReason: 'sala_espera'`), para que un
reclutador siga la plática.

- La respuesta y su reacción de **ese turno sí salen**: el flag solo afecta lecturas futuras.
- Durante las 24 h el **BLOCK SHIELD** (`agent.js` ~1138) calla a Brenda ante cualquier mensaje.
- Se reactiva **sola** al vencer (lazy en `getCandidateById` → `normalizeCandidateSilence`)
  o con un nodo "Reactivar Bot".
- Consecuencia aceptada (decisión del usuario, "Opción A"): como cada turno queda aislado
  ≥ 24 h, el saludo "Hola …, buenas tardes" entra en **cada vuelta** de los buckets con
  texto. La lógica de "1 vez al día / no a media charla" quedó redundante pero se conserva.
- **No** se implementó aviso al reclutador (unread/etiqueta/cola) — se dejó para después.

## Fix: el silencio ya no lo pisa el fallback

El `FINAL DELIVERY SAFEGUARD` (`agent.js` ~2716) rellenaba `responseTextVal=''` con
"¡Ay! Me distraje un segundo… ¿Qué me decías?" sin checar `isHostMode`. Eso pisaba el
silencio intencional (despedida, acuse, toggle OFF, flujo al-regresar): una despedida
mandaba el 👋 **y además** ese texto. Se arregló excluyendo `isHostMode` de ese safeguard.

## Fix: la reacción 👍/👋 no llegaba (multi-número)

`sendUltraMsgReaction` fallaba la entrega por **dos** razones:
1. No se le pasaba el teléfono → `sendMetaMessage` recibía `to:'N/A'` y Meta la rechazaba.
2. No pasaba `phoneNumberId`, así que usaba el **número default** (`META_PHONE_NUMBER_ID`).
   Si el candidato entró por **otro número del WABA** (ej. `incomingPhoneNumberId` 1249… vs
   default 1061…), Meta respondía `success` pero la reacción caía en la conversación del
   número equivocado y el candidato **no la veía**.

Fix: pasar `candidateData.whatsapp` como `toPhone` **y** derivar `phoneNumberId` del
`_instanceId` dentro de `sendUltraMsgReaction` (mismo patrón que `sendUltraMsgMessage`).
También se corrigió `orchestrator.js` (🎉 de handover iba sin teléfono). **Ojo:**
`[REACCIÓN: 👍]` se guarda en Redis aunque el envío falle — no es prueba de entrega.

## Fix: candidato legado sin paso 2 → extracción, no Sala de Espera

Contactos creados **antes** de que existiera el paso 2 tienen `paso2Estado` y
`paso2Requerido` en `undefined` y ya están `congratulated`. El flag `_paso2Listo`
(`agent.js` ~1553) interpreta `paso2Requerido` falsy como "paso 2 no requerido" → los
trataba como completos → Sala de Espera, sin capturar colonia/experiencia.

Nuevo branch (antes de Sala de Espera): si **paso 1 completo + `congratulated` + sin
`paso2Estado` + sin `colonia`** → manda un **puente determinista**
(`Hola {nombre}, antes de cualquier cosa 😊 veo en mi sistema que me falta un poco de
información tuya…` + pide la colonia) y arranca el paso 2 (`paso2Estado =
'esperando_colonia'`, `paso2Requerido = true`). Los turnos siguientes caen directo en el
extractor normal del paso 2 (con reglas de evasión). Dispara **solo la primera vez**.

> No dispara en completaciones nuevas: un candidato que termina paso 1 este turno tiene
> `isProfileComplete=false` en el gate (el audit es pre-turno) y lo maneja el bloque de
> felicitación, que ya arranca el paso 2.

## UI

La tarjeta "Sala de Espera" (`BotIASection.jsx`) dejó de mostrar el textarea de prompt y
el selector de modelo (ya no aplican: `selectedModel` está hardcodeado a `gpt-4o-mini`).
Ahora muestra un panel explicativo con el comportamiento determinista. Se conserva el toggle.

## Commits de la sesión (2026-10-08)

- `fe6a5b6a` — Sala de Espera determinista (saludo 1×/día + 20 frases + 👍), fuera OpenAI.
- `07f291d7` — clasifica entrante (gracias/acuse), saludo solo-al-regresar, 1er intento fix 👍.
- `8bbf0c60` — bucket despedida → 👋 + silencio.
- `c228df4c` — el silencio ya no lo pisa el fallback (excluye `isHostMode`).
- `f03c3093` — reacción 👍/👋 por el número correcto (multi-número) + 🎉 de orchestrator.
- `b967ec84` — + desactivar bot 24h tras responder (pasa a humano).
- `76cb8c84` — candidato legado sin paso 2 → extracción (puente + arranca paso 2).
