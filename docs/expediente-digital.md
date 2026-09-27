# Expediente Digital

**Fecha:** 2026-09-27
**Estado:** Implementado. Capa de storage verificada contra Redis real; build y lint OK. Falta prueba visual en pantalla.

## Qué es

Una **columna lateral del Chat Web**, por candidato, donde el reclutador guarda los
archivos que importan de esa persona: INE, CV, comprobante de domicilio, notas de voz,
etc. Se abre desde un botón nuevo en el toolbar del chat y sigue **las mismas reglas que
las otras columnas** (Banco de Respuestas, CRM Manual): se abre/cierra, se queda fija
mientras la dejes abierta, cierra con la X o con `Escape`.

Dos formas de llenar el expediente:

1. **Desde el chat:** cuando el candidato manda una foto/PDF/audio/video (llega normal,
   como siempre), al **pasar el cursor sobre el archivo** aparece un ícono de guardar
   📁. Un clic lo guarda en su expediente.
2. **Desde el desktop:** una zona de **arrastrar y soltar** (o botón de subir) dentro de
   la columna, para archivos que te llegaron por otro medio (ej. un CV por correo).

La columna muestra los archivos con **iconos grandes por tipo** y **dos vistas**
(cuadrícula / lista), con **descargar** y **quitar** por archivo.

## Persistencia — copia permanente propia

Los archivos entrantes de WhatsApp se guardan con TTL corto en Redis (24h el base64) y
un respaldo en Blob permanente que _puede_ fallar (fire-and-forget). Para que el
expediente **nunca quede con enlaces rotos**, al guardar-desde-chat el backend hace una
**copia PERMANENTE propia**, independiente del ciclo de vida del mensaje original:

1. Lee los bytes del media por su id, con el mismo fallback que `/api/image`:
   Redis `image:<id>` → Blob `media/<id>` → Meta (`metaMediaId`).
2. Los re-sube a un objeto Blob nuevo `media/exp_<...>` (privado, permanente).
3. Registra su `meta:image:<newId>` **SIN TTL**.
4. Guarda en el expediente una URL `/api/image?id=exp_<...>` — servida por el CDN igual
   que cualquier media, pero que no caduca.

La **subida-desde-desktop** ya pasó por `/api/media/upload` (Blob permanente), así que
solo se **referencia** su URL: no se recopia.

> Es la única copia que el expediente necesita: no depende de que el mensaje siga
> existiendo ni de que el respaldo original haya cuajado.

### Permanencia y borrado profundo

- **Se guarda perpetuamente:** la copia (`media/exp_*`) y su `meta:image:*` no tienen
  TTL. Un archivo guardado vive para siempre hasta que se quite a propósito.
- **Quitar borra de verdad (profundo):** el `DELETE` no solo quita la referencia del
  array; borra el **archivo físico** — el objeto en Blob (`del('media/<id>')`) y su
  registro en Redis (`meta:image:*` + `image:*`). No quedan huérfanos.
- **Excepción de seguridad:** solo se borra el archivo físico cuando es una copia PROPIA
  del expediente (`exp_*` copiado desde chat, `med_*` subido desde desktop). En el raro
  caso de que una entrada apunte a la media ORIGINAL del mensaje del chat (`in_*`, cuando
  no se pudieron leer los bytes para copiar), se conserva ese archivo — quitarlo del
  expediente no borra el media del chat.

## Modelo de datos (Redis)

Un array JSON pequeño por candidato, **sin TTL** (volumen bajo: pocos documentos por
persona → un solo `GET` pinta toda la columna):

```
candidate:expediente:<candidateId>  =  [ entry, entry, ... ]   // más reciente primero
```

Cada `entry`:

```jsonc
{
  "id": "exp_1790545245337_ua4bay",
  "type": "image" | "document" | "audio" | "video",
  "url": "/api/image?id=exp_...",   // copia permanente
  "filename": "ine.jpg",
  "mime": "image/jpeg",
  "note": "INE frente",             // opcional
  "sizeBytes": 1234,
  "sourceMsgId": "<id del mensaje del chat, si vino de ahí>",
  "savedAt": "2026-09-27T...Z",
  "savedBy": "<userId del reclutador>"
}
```

Al quitar el último archivo, la llave se **borra** (no queda un `[]` colgando).

Funciones en `api/utils/storage.js`: `getExpediente`, `addExpedienteEntry`,
`removeExpedienteEntry`.

## Endpoint

`api/candidates/expediente.js` — protegido con `validateAdminSession` (patrón estándar
de endpoints que mutan datos; el interceptor global de `main.jsx` ya manda el Bearer).

| Método   | Ruta / body                                                                 | Efecto                                  |
|----------|------------------------------------------------------------------------------|-----------------------------------------|
| `GET`    | `?candidateId=<id>`                                                           | `{ success, entries[] }`                |
| `POST`   | `{ candidateId, mediaUrl, type, filename, mime, note, sourceMsgId, source }` | Guarda un archivo (ver `source` abajo)  |
| `DELETE` | `?candidateId=<id>&entryId=<id>`                                              | Quita del expediente + borra el archivo |

- `source: 'chat'`   → copia los bytes a un Blob permanente propio (ver arriba).
- `source: 'upload'` → el archivo ya está persistido por `/api/media/upload`: solo referencia.

## Frontend

- **Toolbar** (`src/components/ChatSection.jsx`): icono `expediente`
  (`FolderArchive`, ámbar) en `TOOLBAR_ICON_IDS`, junto al Banco de Respuestas. Se bumpó
  la versión del orden guardado a `candidatic:toolbar_order_v5` para que aparezca por
  defecto en su lugar.
- **Botón guardar sobre el media** (`src/components/chat/MessageBubble.jsx`): prop
  `onSaveToExpediente`; el botón 📁 aparece en `group-hover` sobre cualquier media
  (image/sticker/video/audio/ptt/voice/document).
- **Handler** (`ChatSection.jsx` → `handleSaveToExpediente`): hace el `POST source:'chat'`,
  muestra toast, abre la columna e incrementa un `refreshToken` para que el panel
  refetchee.
- **La columna** (`src/components/chat/ExpedienteSidepanel.jsx`): vista lista/cuadrícula
  (recordada en `localStorage: candidatic:expediente_view`), thumbnail en imágenes,
  descarga vía `fetch → blob → download` (respeta el `filename`), quitar con
  `ConfirmModal`, y zona de subida drag & drop que reusa `/api/media/upload`.

## Estado abierto/cerrado recordado por reclutador

Las columnas del Chat Web recuerdan si las dejaste abiertas, **por usuario**, en su perfil
de Redis (`PUT /api/users` con `preferences`, merge superficial — mismo patrón que
`quickRepliesOpen` del Banco):

- `crmManualOpen`  → CRM de Proyectos (default: abierto salvo que lo cierres).
- `expedienteOpen` → Expediente Digital (default: cerrado).
- `quickRepliesOpen` → Banco de Respuestas (ya existía).

Al reabrir el Chat Web (remonta la sección), cada columna se **siembra** desde esa
preferencia con el inicializador perezoso de `useState`, así que quedan como las dejaste.
Setters genéricos en `ChatSection.jsx`: `savePanelPreference` + `setRightPanelOpen` /
`setExpedientePanelOpen`.

## Consistencia de iconos y nombres (toolbar ↔ columna)

Cada columna usa **el mismo icono** que su botón del toolbar, y el `title` (alt) del botón
usa **el mismo nombre** que el encabezado de la columna:

| Columna              | Icono         | Nombre               |
|----------------------|---------------|----------------------|
| Banco de Respuestas  | `BookOpen`    | Banco de Respuestas  |
| CRM de Proyectos     | `Kanban`      | CRM de Proyectos     |
| Expediente Digital   | `FolderArchive` | Expediente Digital |

(El CRM usaba antes `Box` + alt "CRM Manual"; se alineó a `Kanban` + "CRM de Proyectos".)

## Verificación

- **Storage contra Redis real** (script desechable, candidato de prueba, limpieza al
  final): vacío inicial, add ×2 con orden correcto, remove existente/inexistente, y
  borrado de la llave al vaciar — 6/6 ✅.
- `npm run build` ✅ · `eslint` sin errores nuevos ✅.
- Lo visual (hover del botón, la columna, iconos, descarga) requiere prueba del usuario
  en pantalla — no hay navegador para verificarlo aquí.
