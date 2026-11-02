# Nodo de Flujo: "Crear Ruta (Maps)" (`crear_ruta`)

Nodo del motor de flujos que le manda al candidato **cómo llegar a un destino fijo** (el punto de
la empresa), trazando la ruta **desde la ubicación que él compartió** hasta ese destino. Entrega
**botones nativos de enlace** (cta_url) de **Google Maps** y/o **Waze**; el candidato toca el que
prefiera y la app abre directo en modo "Cómo llegar / navegación". Opcionalmente, **primero le
pregunta cómo va a llegar** (🚗 carro / 🚌 transporte / 🏍️ moto) con botones, y luego da la ruta
con ese modo de transporte.

Implementado en noviembre 2026. Commits: `bca5a552` (base, links de texto), más tarde cambiado a
**botones nativos + menú de modo de transporte**.

---

## Qué hace, de punta a punta

1. Va conectado **después** de un nodo "Pedir Ubicación" (`accion_ubicacion`), a su salida **"Sí"**.
   Ese nodo previo deja en el candidato `ubicacionLat` / `ubicacionLng` con las coordenadas que
   compartió (las fija el webhook en el `case 'location'` y las arrastra el snapshot dentro de
   `runOneFlow`).
2. **Con menú de modo (`askMode`, default ON):** manda 3 botones de respuesta (🚗 Carro / 🚌
   Transporte / 🏍️ Moto) y **PAUSA**. Al tocar uno, se manda la ruta con ese `travelmode`.
   **Sin menú (`askMode` OFF):** manda la ruta directo (modo carro).
3. La ruta se entrega como **botones nativos `cta_url`**, uno por app elegida (cada uno en su
   burbuja). El primero lleva el mensaje del nodo; el segundo un cuerpo mínimo ("O ábrelo en …").
   - **Google Maps:** `https://www.google.com/maps/dir/?api=1&origin=OLAT,OLNG&destination=DLAT,DLNG&travelmode=MODE`
   - **Waze:** `https://waze.com/ul?ll=DLAT,DLNG&navigate=yes`

### travelmode según el modo elegido
| Botón | travelmode (Google) | Nota |
|-------|---------------------|------|
| 🚗 Carro | `driving` | — |
| 🚌 Transporte | `transit` | transporte público |
| 🏍️ Moto | `two-wheeler` | solo funciona por URL en ciertos países; si no, abre como carro |

### Detalles del trazo
- **Waze ignora el modo** — siempre navega en carro desde el GPS actual del candidato.
- **Si el candidato NO compartió ubicación** (no hay `ubicacionLat/Lng`), el link de Google Maps
  **omite el origen** y Google usa el GPS del teléfono del candidato.

---

## Arquitectura

- **Fase 1 (`case 'crear_ruta'`)** en `api/utils/flow-engine.js`: si `askMode`, manda los botones de
  modo (`interactiveType: 'button'`), registra la espera en `flow:waiting:v1:<id>` con
  `kind: 'interactive', routeMode: true` (cada opción trae `mode` = travelmode) y devuelve
  `{ __pause: true }`. Si no, llama `sendRouteButtons(...)` directo (carro) y continúa.
- **Fase 2 (reanudación):** el clic del candidato lo detecta el **webhook**
  (`hasLiveInteractiveMenuFor` reconoce `kind: 'interactive'`) y llama `resumeWaitingFlowIfMatch`.
  Ahí, la rama `st.routeMode` manda los botones de Maps/Waze con el `travelmode` de la opción tocada
  (`sendRouteButtons`) y continúa por la salida ÚNICA del nodo (handle `null`). **No requiere
  "Desactivar Bot"** — el webhook resuelve el clic antes de pasar nada a Brenda.
- **`sendRouteButtons(redis, node, candidate, flowId, travelmode, opts)`:** helper que arma y manda
  los botones `cta_url` (uno por app), guarda en historial (`saveFlowOutbound`, formato
  `[Botón: display → url]`) y respeta el pacing (`pacedSend`). Best-effort.
- **Origen de las coordenadas:** no toca el webhook ni Redis. Reusa `candidate.ubicacionLat/Lng`.
- **Salida en el editor:** salida única (`hasSource: true` en `nodeDefs.js`).

---

## Modelo de datos del nodo (`node.data`)

```js
{
  body: '📍 Te paso cómo llegar a {{destino}} desde donde estás 👇', // acompaña al botón "Abrir"
  destRaw: '',        // lo que pegó el reclutador (link de Maps o "lat, lng") — solo para mostrar
  destLat: 25.6866,   // destino: latitud (número) — lo extrae el parser del panel
  destLng: -100.3161, // destino: longitud (número)
  destName: 'Planta García', // nombre del destino → token {{destino}}
  appGoogle: true,    // botón "Abrir en Maps"
  appWaze: true,      // botón "Abrir en Waze"
  askMode: true,      // preguntar el modo de transporte antes de dar la ruta
  modeQuestion: '¿Cómo llegarás a tu entrevista? 🚗',
  mode_carro: true, mode_transporte: true, mode_moto: true, // qué botones de modo ofrecer (máx. 3)
  modeLabel_carro: '🚗 Carro', modeLabel_transporte: '🚌 Transporte', modeLabel_moto: '🏍️ Moto', // editables
  timeoutNever: true  // la espera del clic de modo no caduca (default)
}
```

- **`appGoogle` / `appWaze` / `askMode` / `mode_*`:** se evalúan como `!== false`, así que un nodo
  viejo sin el campo toma el default (ambas apps, pregunta modo, los 3 modos).
- **Compat:** un nodo `crear_ruta` creado antes del cambio a botones adopta el menú de modo y los
  botones nativos automáticamente (sin reconfigurar), por esos defaults.
- **Parser del destino** (`parseDestino` en `NodeConfigDrawer.jsx`): acepta, en orden, `"lat, lng"`
  directo; un link de Google Maps tipo "place" (`!3dLAT!4dLNG`, el pin exacto); `?q=`/`query=`/
  `destination=`/`ll=` con `lat,lng`; y como último recurso `@lat,lng` (centro del mapa). El panel
  muestra en vivo si detectó coordenadas (✓ verde) o no (✗ rojo).

---

## Tokens

| Token | De dónde sale | Qué es |
|-------|---------------|--------|
| `{{modo}}` | `name` de la opción tocada | Modo elegido en texto natural: `carro` / `transporte público` / `moto` |
| `{{destino}}` | `data.destName` del nodo | Nombre del destino configurado |

El cuerpo también pasa por `substituteVariables` ({{nombre}}, etc.). Rodea un token con `*asteriscos*`
para que WhatsApp lo muestre en **negritas** (ej. `en *{{modo}}* a {{destino}}`). Los **títulos de
los botones** (modo y "ABRIR EN MAPS/WAZE") NO admiten negritas — Meta los pinta en texto plano;
solo se puede jugar con MAYÚSCULAS y emojis (máx. 20 caracteres c/u).

---

## Cómo armarlo (reclutador)

1. En Flujos → **Agregar nodo → "Crear Ruta (Maps)"** (ícono de ruta, verde).
2. Conéctalo **después** de un **"Pedir Ubicación"**, a su salida **"Sí"**. Si ese nodo **no tiene
   paradas** configuradas (lo normal para este patrón — solo quieres el GPS, no validar cercanía),
   al compartir la ubicación **siempre sale por "Sí"** → llega a Crear Ruta. (Con paradas, "Sí" es
   solo si queda dentro del radio; en ese caso conéctalo donde tenga sentido.)
3. Abre el lugar de la empresa en Google Maps → **Compartir → copiar enlace** → pégalo en
   **Destino**. (O escribe `lat, lng` a mano.) Verifica el ✓ verde con las coordenadas.
4. Pon el **Nombre del destino** (ej. "Planta García") para el token `{{destino}}`.
5. (Opcional) deja prendido **"Preguntar cómo va a llegar"**, ajusta la pregunta y marca/edita los
   modos (🚗 Carro / 🚌 Transporte / 🏍️ Moto, máx. 3).
6. Marca las **apps** (Abrir en Google Maps / Abrir en Waze) y ajusta el **Mensaje**.

---

## Archivos tocados

| Archivo | Qué |
|---------|-----|
| `api/utils/flow-engine.js` | `ROUTE_MODES`, `sendRouteButtons`, `case 'crear_ruta'` (menú de modo + pausa), rama `routeMode` en `resumeWaitingFlowIfMatch` |
| `src/components/flows/nodeTypes/nodeDefs.js` | definición del nodo (icono `Route`, resumen) |
| `src/components/flows/NodeConfigDrawer.jsx` | `parseDestino` + `CrearRutaConfig` (destino, menú de modo, apps) |
| `src/components/flows/FlowEditor.jsx` | default data del nodo |

No se tocó el webhook: el clic de modo lo rutea la maquinaria interactiva existente
(`hasLiveInteractiveMenuFor` + `resumeWaitingFlowIfMatch`). El nodo reusa las coordenadas que ya
deja "Pedir Ubicación".

## Cómo auditar una prueba

1. `candidatic:phone_index` (HGET con el teléfono) → `candidateId`.
2. `candidate:<id>` → `ubicacionLat`/`ubicacionLng` (el origen que se usó).
3. `flow:waiting:v1:<id>` → mientras espera el clic de modo: `kind:'interactive', routeMode:true` con
   las opciones y su `mode`.
4. `messages:<id>` (LRANGE) → los botones de modo (`[Botones: …]`) y los botones de ruta
   (`[Botón: Abrir en Maps → …]`).
5. `flows:v1` → el nodo `crear_ruta` (`destLat`, `destLng`, `destName`, `appGoogle`, `appWaze`,
   `askMode`, `mode_*`) y a qué nodo va su salida.
