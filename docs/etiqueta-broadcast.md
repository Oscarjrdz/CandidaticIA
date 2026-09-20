# Etiqueta Broadcast — módulo de marcado de campañas masivas

**Fecha:** 2026-09-19
**Estado:** Parte 1 implementada (marcado). Parte 2 (motor de respuesta determinístico) **pendiente**.

## Qué es

Al lanzar un envío masivo (Envíos Masivos), además del *Nombre de la Campaña* se puede
definir una **Etiqueta Broadcast**. Cada candidato al que se le entrega la campaña queda
**marcado** con esa etiqueta.

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

### Creación de campaña — `POST /api/bulks?action=start`
- Nuevo campo opcional `broadcastTag` en el body. Se normaliza: `trim()` + máx 60 chars,
  vacío → `null`.
- Se guarda en el estado de la campaña (`state.broadcastTag`) y en el historial.
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
- Estado `broadcastTag` + `broadcastTagOptions`.
- Input "Etiqueta Broadcast (Opcional)" debajo de "Nombre de la Campaña", con `datalist`
  para reusar etiquetas ya creadas.
- Se envía `broadcastTag` en el `action=start`.
- Al iniciar con éxito, la etiqueta recién usada se agrega a las opciones locales.

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
