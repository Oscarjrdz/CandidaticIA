# Etiqueta Broadcast — módulo de marcado de campañas masivas

**Fecha:** 2026-09-19
**Estado:** Parte 1 implementada (marcado). Parte 2 (motor de respuesta determinístico) **pendiente**.

## Qué es

La **Etiqueta Broadcast** se define **a nivel PÚBLICO** (audiencia guardada), no por envío.
Cada candidato al que se le entrega una campaña que usa ese público queda **marcado** con
la etiqueta del público.

> **Decisión de diseño (2026-09-19):** la etiqueta NO se escribe por envío. El renglón
> "Etiqueta Broadcast" del panel de envío se **eliminó**; vive solo en el público. Por lo
> tanto, envíos **directos** o de **segmento ad-hoc** (sin público guardado) **no** se
> etiquetan. El backend hereda la etiqueta del público seleccionado en `action=start`.

También en esta fecha: **el Nombre de la Campaña pasó a ser OBLIGATORIO** (antes opcional).
El botón "Iniciar Campaña" se deshabilita sin nombre y el backend rechaza `start` sin
`campaignName` (400).

El objetivo final (Parte 2) es construir un **motor de respuesta determinístico**: cuando
un candidato marcado con una etiqueta Broadcast responda, Brenda podrá reaccionar de forma
específica según de qué broadcast venía. La Parte 1 (este documento) solo crea el marcado.

## Principio de diseño: espacio TOTALMENTE independiente

La etiqueta Broadcast **NO se mezcla** con ningún sistema de etiquetas existente:

- ❌ No toca `candidate.tags` (las etiquetas del Chat Web).
- ❌ No toca el índice de etiquetas de anuncios (`adId` / `adIndexKey`).
- ❌ No aparece en `candidatic:tag_counts`, ni en el widget "Altas por Etiqueta", ni en
  ningún contador del tablero de Flujos.
- ❌ No se guarda en el blob del candidato → **cero impacto en el ancho de banda** de cada
  lectura de `candidate:*` (misma disciplina que `ctwa_clid`, que también vive en side-key).

Vive en su **propio espacio** de llaves en Redis.

## Estructura en Redis (side-keys, sin TTL, nunca se borran)

| Llave                          | Tipo | Contenido                                                  |
|--------------------------------|------|------------------------------------------------------------|
| `broadcast:tag:<etiqueta>`     | set  | IDs de candidatos que recibieron ese broadcast             |
| `broadcast:candidate:<id>`     | set  | Etiquetas Broadcast que recibió ese candidato              |
| `broadcast:tags:all`           | set  | Registro de todos los nombres de etiqueta (para reusarlos) |

Ninguna tiene TTL — el requerimiento explícito es que **la información de campañas no se
borre nunca** (a diferencia de `campaign:reply_await:*`, que es efímero de 90 días y solo
sirve para la estadística de "respondidos").

## Flujo

### Definición — a nivel público (`audience_create` / `audience_update`)
- El objeto del público lleva un campo `broadcastTag` (normalizado: `trim()` + máx 60, vacío
  → `null`). Se edita en el modal de crear público y en el banner de edición.
- Al guardar, el nombre se registra en `broadcast:tags:all` (`SADD`) para reusarlo.
- Se muestra como badge 🏷️ en la tarjeta del público.
- `duplicateAudience` hereda la etiqueta.

### Creación de campaña — `POST /api/bulks?action=start`
- `campaignName` es **obligatorio** (400 si falta).
- La etiqueta efectiva = `broadcastTag` del body (hoy el frontend no lo manda) **o** la del
  público seleccionado (`audience.broadcastTag`). Se guarda en `state.broadcastTag` y en el
  historial.
- Se registra el nombre en `broadcast:tags:all` (`SADD`).

### Envío por candidato — loop de `tickEngine` en `api/bulks.js`
- Solo cuando el envío es **exitoso**, y solo si hay `state.broadcastTag`:
  - `SADD broadcast:tag:<etiqueta> <candidateId>`
  - `SADD broadcast:candidate:<candidateId> <etiqueta>`
- Es un pipeline **fire-and-forget** (`.catch(() => {})`), sin `await` que bloquee el envío.
- Idempotente: reenviar al mismo candidato no duplica (son sets).

### Reuso de etiquetas — `GET /api/bulks?action=broadcast_tags`
- Devuelve `broadcast:tags:all` ordenado alfabético (`localeCompare` es).
- El frontend lo carga al montar y lo usa como `<datalist>` (autocompletado) en el input.

## Frontend — `src/components/BulksSection.jsx`
- Estado `newAudienceBroadcastTag` (modal crear), `editingAudienceBroadcastTag` (banner
  edición), `broadcastTagOptions` (registro para `datalist` de reuso).
- Input de etiqueta en el modal de crear público y en el banner de edición del público.
- Badge 🏷️ en la tarjeta del público cuando tiene etiqueta.
- Nombre de campaña obligatorio: `handleStartClick` valida, botón deshabilitado sin nombre,
  label con asterisco rojo.
- El panel de envío ya **no** tiene input de etiqueta Broadcast.

## Verificación (2026-09-19)
Probado contra Redis real con script desechable (candidato/etiqueta de prueba únicos,
limpieza total al final). 15/15 checks OK, incluyendo:
- Escritura y lectura de las 3 side-keys.
- Ausencia de TTL en las 3.
- Idempotencia del `SADD`.
- **No** aparece en `candidatic:tag_counts` ni crea índice de etiqueta del Chat Web.
- Normalización (trim, tope 60, vacío → null).

## Parte 2 — pendiente (motor de respuesta determinístico)
Se apoyará en `broadcast:candidate:<id>` para saber de qué broadcast(s) viene un candidato
cuando responda, e inyectar una instrucción específica al comportamiento de la respuesta.
Diseño aún no definido (por campaña / por etiqueta / global — decidir al construirlo).
