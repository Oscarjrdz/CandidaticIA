# Vox — Cerebro de voz de Brenda

Sección nueva del dashboard (`id: vox`, `superAdminOnly`) para dar a Brenda **voz en tiempo real**
con la Realtime API de OpenAI. Objetivo del proyecto: que Brenda pueda **hablar por teléfono**
con candidatos, con un tope de costo de **1 peso por minuto**.

## Objetivo de Brenda Vox (NO es extractora)

La extracción de datos la hace Brenda por **WhatsApp**. Brenda **Vox** tiene otro trabajo:
**solo llama a candidatos COMPLETOS** para (1) presentarles una **vacante** y (2) **citarlos a
entrevista** (confirmar interés + disponibilidad; la cita se confirma por WhatsApp). Por eso:

- Se elige una **vacante** de un dropdown conectado a la sección Vacantes (`/api/vacancies`). Es
  **obligatoria**: Brenda habla de la vacante usando SOLO esa info (no inventa sueldo/horario).
- Se elige un **candidato completo** (busca por nombre/teléfono). `session.js` valida con
  `isProfileComplete(cand)`; si no está completo responde **403** y la llamada no arranca.
- **Modo prueba** (`testMode`): ensaya la llamada sin candidato real (candidato ficticio completo),
  pero igual requiere una vacante.

## Etapas

1. **Etapa 1 (implementada):** hablar con Brenda desde la compu (micrófono + bocina del navegador)
   para entrenar/probar su inteligencia hablada.
2. **Etapa 2 (pendiente):** conectar el mismo cerebro a llamadas telefónicas reales vía un
   **multipuerto WCH** (gateway de líneas → SIP/RTP).

## Decisión de arquitectura: Realtime voz-a-voz

Se eligió el **Realtime API** (voz-a-voz, interrumpible, lo más humano) sobre la cascada
STT→LLM→TTS, porque el requisito fue "poder interrumpir y que suene lo más humano posible".

- **Modelo:** `gpt-realtime-mini` (interrumpible y humano como el full, ~⅓ del costo → cabe en
  el peso/minuto). El `gpt-realtime` full se saldría del presupuesto (~1.5–2.7 pesos/min); queda
  seleccionable en la UI pero no es el default.
- **Disciplina de costo:** caché de prompt, respuestas breves (turnos cortos en el prompt),
  server VAD para cortar silencios.

## Principio: el cerebro vive en el SERVIDOR, no en el front

Requisito explícito: "no depender tanto del frontend". Por eso:

- La persona, voz, modelo, VAD y tarifas viven en **Redis `vox:config`** (no en React).
- El frontend es un **cliente delgado**: pide un token efímero y conecta mic/bocina. No decide nada.
- En la Etapa 2 (teléfono) **no hay navegador**: se reusará el MISMO cerebro server-side; solo
  cambia el transporte (WebRTC del navegador → puente del servidor al gateway WCH/SIP).

## ¿Pesa / afecta al resto de Candidatic?

No. Es prácticamente aislado:

- **Bundle:** sección *lazy* — solo se descarga al abrir Vox. Cero peso para el resto.
- **Ancho de banda:** el audio va **navegador ↔ OpenAI directo** por WebRTC. **No pasa por Vercel.**
  Cero bytes en nuestro medidor de Redis, cero carga en el webhook.
- **Redis:** solo lee `vox:config` al iniciar sesión y escribe el costo acumulado. No toca datos
  de candidatos en el hot-path de mensajes.
- **Costo OpenAI:** línea aparte, aditiva solo cuando alguien usa Vox. No encarece el bot de texto.

## Flujo técnico (WebRTC, doc oficial OpenAI 2026)

```
1. Navegador → POST /api/vox/session        (nuestra, con Bearer de sesión del reclutador)
      ↳ servidor lee vox:config + (opcional) contexto del candidato
      ↳ servidor → POST https://api.openai.com/v1/realtime/client_secrets  (Bearer OPENAI_API_KEY)
      ↳ devuelve SOLO el token efímero (la API key real nunca sale del backend)
2. Navegador abre RTCPeerConnection, agrega el micrófono, crea data channel "oai-events"
3. Navegador → POST https://api.openai.com/v1/realtime/calls  (Bearer token efímero, SDP offer)
      ↳ setRemoteDescription(answer)  → audio fluye directo navegador↔OpenAI
4. Eventos por el data channel: transcripciones + uso de tokens (response.done)
5. Navegador → POST /api/vox/usage  (deltas de tokens) → costo recalculado y persistido en Redis
```

## Archivos

| Archivo | Rol |
|---|---|
| `api/vox/config.js` | GET/PUT del cerebro en Redis `vox:config`. Exporta `buildInstructions()` (compone el prompt final con estructura OpenAI) y los defaults. |
| `api/vox/session.js` | Acuña el token efímero. Lee `vox:config`, inyecta contexto del candidato (si se manda `candidateId`), arma la sesión Realtime. |
| `api/vox/usage.js` | Persiste tokens/costo por día (`vox:cost:YYYY-MM-DD`, zona Monterrey) y por sesión (`vox:session:<id>`, TTL 7d). Recalcula el costo con las tarifas server-side (autoritativo). |
| `api/vox/transcript.js` | Guarda el transcript por llamada (`vox:transcript:<id>` lista + `:meta` hash, TTL 30d) para revisar la calidad. El cliente reporta cada utterance fire-and-forget. |
| `api/vox/calls.js` | `GET` historial consolidado: por llamada, config (modelo/voz/VAD/vacante/candidato/cita) + costo (MXN, peso/min), con `spike:true` si el peso/min supera el límite. Lee `vox:calls` (sorted set) + `vox:session:<id>`. |

## Record interno de llamadas (auditar picos)

Cada llamada deja un **record consolidado** en el hash `vox:session:<id>`: la **config** la escribe
`session.js` al iniciar (modelo, voz, VAD, vacante, candidato/prueba, mensaje de cita, fxRate,
límite) y el **costo** lo acumula `usage.js` (tokens, costUsd, segundos). Se indexa por tiempo en el
sorted set `vox:calls` (últimas 500, TTL 30d). `GET /api/vox/calls` lo expone y marca `spike` cuando
el peso/min pasa el límite. En la UI: panel **"Historial de llamadas"** con tabla y resaltado rojo de
picos. El cliente genera el `sessionId` ANTES de pedir el token para que config y costo caigan en el
mismo record.
| `src/components/VoxSection.jsx` | Cliente delgado: orbe reactivo (Web Audio), transcript, calculador de costo en vivo, selector de candidato, editor del cerebro. |

Registro de la sección: `src/constants/menuSections.js` (id `vox`, `superAdminOnly`),
`src/components/Sidebar.jsx` (ícono `Mic`), `src/App.jsx` (lazy import + render gateado a SuperAdmin + título/subtítulo).

## El prompt (mejores prácticas de OpenAI para voz)

Se edita en **dos espacios** (Personalidad y tono / Objetivo y guion). El servidor los compone en
`buildInstructions()` siguiendo la estructura recomendada por OpenAI para agentes de voz:

```
# Rol y objetivo         ← objective (presentar vacante + citar a entrevista)
# Personalidad y tono    ← personality
# Idioma y pronunciación
# Información de la vacante ← inyectada desde la vacante elegida (name/company/category/description)
# Contexto del candidato ← datos del completo elegido (en modo prueba: candidato ficticio)
# Reglas de conversación (turnos breves, interrumpible, varía frases)
# Seguridad y límites    (habla SOLO con la info de la vacante dada; no inventa sueldo/horario)
```

## Contexto del candidato

En la UI eliges a quién llamar: un **candidato completo** del listado (busca por nombre/teléfono
vía `/api/candidates?search=`) o **modo prueba**. `session.js` carga el perfil con
`getCandidateById`, valida `isProfileComplete` (403 si no) y arma el bloque "Contexto del candidato"
con los datos que YA tenemos (Brenda no los re-pregunta; su trabajo es ofrecer la vacante y citar).

## Calculador de costo (desde v1)

- El navegador recibe el uso de tokens en cada `response.done` (audio in/out, cacheado, texto) y
  lo acumula; el panel "Costo en vivo" muestra MXN, USD, tokens y el **ritmo peso/min** (verde si
  está bajo el límite, rojo si se pasa).
- Cada delta se reporta a `/api/vox/usage`, que **recalcula el costo con las tarifas de `vox:config`**
  (fuente de verdad) y lo acumula en Redis por día y por sesión. Si cierras la pestaña, lo ya
  reportado queda registrado.
- Tarifas por defecto (`gpt-realtime-mini`, USD/1M tokens): audio in $10, audio in cacheado $0.30,
  audio out $20, texto in $0.60, texto in cacheado $0.06, texto out $2.40. Tipo de cambio 18.5
  MXN/USD. Todo editable en el editor del cerebro.

## UI

Inspirada en el modo voz de ChatGPT (orbe central reactivo al audio, estados calmados) pero con el
lenguaje visual de Candidatic (tarjetas `rounded-2xl`, acento naranja, dark-mode). El orbe reacciona
al audio real vía Web Audio `AnalyserNode`: naranja cuando habla el candidato, teal cuando habla
Brenda; la escala la maneja un `requestAnimationFrame` por ref (sin re-render por frame — respeta la
regla de alto tráfico del dashboard). Respeta `prefers-reduced-motion`.

## Pendientes / Etapa 2

- Puente servidor ↔ gateway WCH/SIP (RTP ↔ Realtime) reusando `vox:config` y `buildInstructions`.
- Escritura de los datos extraídos de vuelta al candidato (hoy Etapa 1 solo conversa; no persiste
  cambios al perfil).
- Tablero de costo histórico (leer `vox:cost:*`), posible integración con la tarjeta de consumo.
