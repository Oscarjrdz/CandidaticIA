# Auditoria Brenda Reclutadora - Flujo de Extraccion

Fecha: 2026-06-30

## Objetivo

Auditar el flujo principal de Brenda Reclutadora para blindar dos puntos:

- Que no se quede muda ante errores internos.
- Reducir latencia sin sacrificar funcionalidad ni calidad de extraccion.

## Flujo Auditado

1. `api/whatsapp/webhook.js` recibe mensaje de WhatsApp Cloud API.
2. Guarda candidato y mensaje entrante antes de correr logica de negocio.
3. Agrega el mensaje a waitlist por candidato.
4. `api/workers/process-message.js` toma lock por candidato y drena mensajes acumulados.
5. `api/ai/agent.js` audita perfil, extrae datos, genera respuesta, normaliza valores y envia burbujas.
6. `api/whatsapp/utils.js` envia a Meta Cloud API.

## Hallazgos

### 1. Riesgo raro pero real de silencio en fallback fatal

En `api/ai/agent.js`, `candidateData` estaba declarado dentro del `try`, pero el `catch` fatal lo usaba para mandar fallback. Si ocurria una excepcion fatal, el fallback podia fallar por alcance de variable y Brenda podia quedarse sin respuesta.

Cambio aplicado:

- `candidateData` ahora vive en el scope completo de `processMessage`.
- El fallback fatal manda mensaje si hay candidato disponible.
- Si el fallback se manda correctamente, tambien se guarda en historial.

### 2. Envio final podia ocultar errores de Meta

En el envio final de burbujas, algunas llamadas usaban `.catch(() => {})`. Eso evitaba romper el flujo, pero tambien podia ocultar fallas reales de entrega.

Cambio aplicado:

- Se agrego `sendBotMessageWithRetry`.
- Reintenta una vez mensajes de texto si Meta o red responden error.
- Registra telemetria `brenda_delivery_failed` cuando no se logra enviar.
- Se mantiene envio secuencial para respetar orden de burbujas.

### 3. Clasificador de intencion agregaba latencia innecesaria

En proyectos con multiples vacantes, el clasificador de intencion podia correr en mensajes normales donde no habia senales de rechazo o cambio de vacante. Eso agregaba una llamada extra a GPT antes del flujo reclutador.

Cambio aplicado:

- Ahora solo se llama al clasificador si el texto parece rechazo o solicitud de otra vacante.
- Mensajes normales pasan directo al flujo reclutador.
- Si el texto no parece rechazo/pivote, `intent` queda como `UNKNOWN` y el comportamiento base se conserva.

### 4. Escolaridad usaba IA aunque el valor fuera obvio

`cleanEscolaridadWithAI` mandaba a GPT valores que se pueden resolver localmente, como `secu`, `prepa`, `lic`, `tecnica`.

Cambio aplicado:

- Se agrego fast path deterministico local.
- Solo cae a GPT si la escolaridad no coincide con catalogo o abreviaturas comunes.

### 5. Falta medicion de latencia total del turno

Ya existia telemetria por llamadas IA, pero no una medicion completa del turno de Brenda.

Cambio aplicado:

- Se registra `brenda_turn_complete` con:
  - latencia total del turno.
  - modo (`capturista`, `recruiter`, `host`).
  - numero de burbujas.
  - si incluyo media.

## Evaluacion

El flujo de extraccion esta bien estructurado:

- Guarda mensaje antes de IA.
- Usa lock por candidato.
- Drena waitlist para mensajes rapidos.
- Tiene fallback cuando GPT devuelve vacio.
- Usa reglas deterministicas para varios casos comunes.
- Ya limita historial para reducir tokens.
- Ya usa `gpt-4o-mini` para captura principal.

El area con mas oportunidad estaba en latencia por llamadas auxiliares y observabilidad de envio. Los cambios aplicados reducen llamadas GPT innecesarias y hacen visibles fallas de entrega que antes podian quedar silenciosas.

## Pendientes Recomendados

- Revisar telemetria despues de 24 horas para identificar percentiles reales de latencia.
- Separar metricas por etapa: webhook, waitlist, GPT, normalizadores, Meta send.
- Evaluar si el timeout de OpenAI para captura puede bajar de 25s a 15-18s con fallback inmediato.
- Auditar rutas especiales de reclutador que envian mensajes directos antes del delivery final.

## Validacion

Ejecutado correctamente:

- `node --check api/ai/agent.js`
- `node --check api/utils/ai.js`
- `npm run build`

## Deploy

Deploy unico de produccion ejecutado el 2026-06-30:

- URL: `https://candidatic-hpazqvagx-proyectos-de-oscar.vercel.app`
- Alias principal: `https://candidatic.mx`
- Vercel deployment id: `dpl_Gzwnc2W4bqKRa2AVJxNRnxq1wWZT`
- Metadata:
  - `release=brenda-zero-silence-speed-audit-2026-06-30`
  - `summary=brenda-recruiter-no-silence-latency`

## Ajuste Posterior - Bienvenida Fija Para Candidato Nuevo

Solicitud aplicada el 2026-06-30:

- Todo candidato nuevo recibe una bienvenida deterministica:
  - `¡Hola! 😇 Soy Brenda Rodríguez, reclutadora de Candidatic.`
  - `¿Me puedes compartir tu Nombre y Apellidos completos? 🌟`
- Si el candidato viene de un anuncio Meta Ads y el `adId` tiene empresa configurada, se inserta la burbuja dinamica de empresa entre esas dos burbujas.
- Para mensajes no genericos de candidato nuevo, el sistema puede seguir usando GPT para extraer datos del texto entrante, pero la respuesta visible se fuerza al formato fijo anterior.

Deploy unico de produccion para este ajuste:

- URL: `https://candidatic-e3s22yjzx-proyectos-de-oscar.vercel.app`
- Alias principal: `https://candidatic.mx`
- Vercel deployment id: `dpl_8CfuJAX7w5BN9DKVQXGjLNY9Sn7q`
- Metadata:
  - `release=brenda-fixed-new-candidate-welcome-2026-06-30`
  - `summary=fixed-new-candidate-greeting-ad-company-middle`
