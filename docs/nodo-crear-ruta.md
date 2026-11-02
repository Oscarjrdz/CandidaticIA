# Nodo de Flujo: "Crear Ruta (Maps)" (`crear_ruta`)

Nodo del motor de flujos que le manda al candidato **cómo llegar a un destino fijo** (el punto de
la empresa), trazando la ruta **desde la ubicación que él compartió** hasta ese destino. Entrega
enlaces tappables de **Google Maps** y/o **Waze** en un solo mensaje; el candidato toca el que
prefiera y la app abre directo en modo "Cómo llegar / navegación".

Implementado en noviembre 2026. Commit: `bca5a552`.

---

## Qué hace, de punta a punta

1. Va conectado **después** de un nodo "Pedir Ubicación" (`accion_ubicacion`). Ese nodo previo deja
   en el candidato `ubicacionLat` / `ubicacionLng` con las coordenadas que compartió (las fija el
   webhook en el `case 'location'` y las arrastra el snapshot dentro de `runOneFlow`).
2. Al llegar a este nodo, el motor usa esas coordenadas como **ORIGEN** y el destino configurado en
   el nodo (`destLat` / `destLng`) como **DESTINO**, y arma los enlaces:
   - **Google Maps:** `https://www.google.com/maps/dir/?api=1&origin=OLAT,OLNG&destination=DLAT,DLNG&travelmode=driving`
   - **Waze:** `https://waze.com/ul?ll=DLAT,DLNG&navigate=yes`
3. Manda **un solo mensaje** de texto (tipo `chat`) con tu cuerpo arriba y debajo los enlaces de las
   apps elegidas. WhatsApp vuelve los links tappables → eso son las "opciones a seleccionar".

### Detalles del trazo
- **Waze no acepta origen en el deep link** — siempre navega desde el GPS actual del candidato. Da
  igual: el candidato está en el origen, así que la ruta sale bien.
- **Si el candidato NO compartió ubicación** (no hay `ubicacionLat/Lng`), el link de Google Maps
  **omite el origen** y Google usa el GPS del teléfono del candidato. Sigue funcionando; solo deja
  de ser "desde el punto exacto que mandó".
- El nodo **no pausa ni rutea por condición**: tiene **una sola salida** y el flujo continúa.

---

## Arquitectura

- **Ejecución:** `case 'crear_ruta'` en `api/utils/flow-engine.js` (`evaluateOrExecute`). Lee
  `data.destLat/destLng` (si no son finitos, `return true` sin romper la cadena), compone los links
  según `data.appGoogle` / `data.appWaze`, sustituye `{{destino}}` por `data.destName` y el resto de
  tokens con `substituteVariables`, y manda con `sendUltraMsgMessageWithRetry(..., 'chat', ...)`
  envuelto en `pacedSend` (respeta el ritmo del resto del flujo). Guarda en el historial con
  `saveFlowOutbound`. Todo best-effort: si algo falla, loggea y `return true`.
- **Origen de las coordenadas:** no toca el webhook ni Redis. Reusa `candidate.ubicacionLat/Lng` que
  ya deja el nodo "Pedir Ubicación" (ver [`nodo-pedir-ubicacion.md`](nodo-pedir-ubicacion.md)).
- **Salida en el editor:** salida única (`hasSource: true` en `nodeDefs.js`), dibujada por el
  `FlowNode` genérico — no tiene handles custom.

---

## Modelo de datos del nodo (`node.data`)

```js
{
  body: '📍 Te paso cómo llegar a {{destino}} desde donde estás 👇', // mensaje arriba de los links
  destRaw: '',        // lo que pegó el reclutador (link de Maps o "lat, lng") — solo para mostrar
  destLat: 25.6866,   // destino: latitud (número) — lo extrae el parser del panel
  destLng: -100.3161, // destino: longitud (número)
  destName: 'Planta García', // nombre del destino → token {{destino}}
  appGoogle: true,    // ofrecer link de Google Maps
  appWaze: true       // ofrecer link de Waze
}
```

- **`appGoogle` / `appWaze`:** se evalúan como `!== false`, así que un flujo viejo sin el campo
  muestra ambas apps por default.
- **Parser del destino** (`parseDestino` en `NodeConfigDrawer.jsx`): acepta, en orden, `"lat, lng"`
  directo; un link de Google Maps tipo "place" (`!3dLAT!4dLNG`, el pin exacto); `?q=`/`query=`/
  `destination=`/`ll=` con `lat,lng`; y como último recurso `@lat,lng` (centro del mapa). El panel
  muestra en vivo si detectó coordenadas (✓ verde) o no (✗ rojo).

---

## Tokens

| Token | De dónde sale | Qué es |
|-------|---------------|--------|
| `{{destino}}` | `data.destName` del nodo | Nombre del destino configurado (se sustituye antes de `substituteVariables`) |

El cuerpo también pasa por `substituteVariables`, así que admite los tokens normales
(`{{nombre}}`, etc.).

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
5. Ajusta el **Mensaje** y marca las **apps** (Google Maps / Waze).

---

## Archivos tocados

| Archivo | Qué |
|---------|-----|
| `api/utils/flow-engine.js` | `case 'crear_ruta'` (arma links y manda el mensaje) |
| `src/components/flows/nodeTypes/nodeDefs.js` | definición del nodo (icono `Route`, resumen) |
| `src/components/flows/NodeConfigDrawer.jsx` | `parseDestino` + `CrearRutaConfig` (panel de config) |
| `src/components/flows/FlowEditor.jsx` | default data del nodo |

No se tocó webhook ni Redis: el nodo reusa las coordenadas que ya deja "Pedir Ubicación".

## Cómo auditar una prueba

1. `candidatic:phone_index` (HGET con el teléfono) → `candidateId`.
2. `candidate:<id>` → `ubicacionLat`/`ubicacionLng` (el origen que se usó).
3. `messages:<id>` (LRANGE) → el mensaje saliente con los links de Maps/Waze.
4. `flows:v1` → el nodo `crear_ruta` (`destLat`, `destLng`, `destName`, `appGoogle`, `appWaze`) y a
   qué nodo va su salida.
