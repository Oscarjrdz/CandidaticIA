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
| `DELETE` | `?candidateId=<id>&entryId=<id>`                                              | Quita del expediente                    |

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

## Verificación

- **Storage contra Redis real** (script desechable, candidato de prueba, limpieza al
  final): vacío inicial, add ×2 con orden correcto, remove existente/inexistente, y
  borrado de la llave al vaciar — 6/6 ✅.
- `npm run build` ✅ · `eslint` sin errores nuevos ✅.
- Lo visual (hover del botón, la columna, iconos, descarga) requiere prueba del usuario
  en pantalla — no hay navegador para verificarlo aquí.
