# Fix: cascada de flujos ("se detonan los botones") — pausa mal apuntada en el ledger

**Fecha:** 2026-10-29 · **Archivo tocado:** `api/utils/flow-engine.js`

## Síntoma reportado

Candidatos a los que, al completar su perfil (o al disparar un flujo "sin extracción"),
Brenda les mandaba **el flujo entero de un jalón en ~15 segundos** en vez de ir paso a paso:
las dos vacantes, las dos rutas de transporte, todos los días de entrevista, el "sí quiero"
y el "no quiero" juntos, etc. Los reclutadores lo describieron como **"se detonan los botones"**.

Chats donde se confirmó (28–29 oct 2026):

| Candidato | Tel | Flujo | Disparador | Etiquetas |
|---|---|---|---|---|
| Jose Fernando Moreno | 8110234738 | COMPLETOS NUEVOS (OCTUBRE) | al_completar | METALSA + STUCKI |
| Jack Ramón Contreras | 8123842999 | COMPLETOS NUEVOS (OCTUBRE) | al_completar | STUCKI |
| L.G.M. | 8135738604 | SIN EXTRACCION OCTUBRE | sin_extraccion | DELTA |

El número de etiquetas **no** era el factor (falló con 1 y con 2). Candidatos que contestaron
paso a paso (p.ej. 8116038195) funcionaron bien.

## Causa raíz

El motor de flujos lleva un **ledger de progreso por candidato+flujo**
(`flow:progress:v1:<flowId>:<candidateId>`), un hash `nodeId → estado`, para no re-enviar lo
que ya mandó y poder reanudar. Los valores eran:

- `'1'` = nodo ejecutado (pasó) · `'0'` = nodo evaluado que falló · `'H:<handle>'` = menú/espera
  ya **resuelto** por el candidato (guarda QUÉ rama tomó).

**El bug:** cuando un nodo interactivo (`accion_botones`, `accion_ubicacion`,
`esperando_respuesta`) **pausaba** esperando la respuesta del candidato, se apuntaba en el
ledger como **`'1'` (ejecutado)** — indistinguible de un nodo normal ya terminado.

Si ese flujo **volvía a correr leyendo el ledger** antes de que el candidato resolviera el nodo,
el bloque de reutilización lo trataba como `pass` y — como estos nodos tienen **varias salidas**
(`si` / `no` / `nocasa`, todas aristas "normales" para `isEligible`) — **encendía TODAS las ramas
a la vez**. Cada rama llevaba a más nodos interactivos igual de mal apuntados → **cascada en
dominó de todo el grafo**.

Verificado con el `isEligible` real del motor (sin enviar nada):

| Estado del nodo en el ledger | rama `si` | rama `nocasa` | resultado |
|---|---|---|---|
| `'1'` (pausó, reusado como pass) | ✅ elegible | ✅ elegible | **CASCADA** |
| `'H:si'` (resuelto por clic/GPS real) | ✅ elegible | ❌ | correcto |

La reanudación REAL (clic o GPS) guarda `'H:<handle>'` y toma solo esa rama — por eso los
candidatos que contestaban paso a paso nunca cascadeaban.

## El detonador: los deploys

Lo que **creaba la condición** (una corrida que dejó una pausa apuntada como `'1'` y luego se
re-corre) eran los **deploys**:

1. Un candidato completa → arranca el flujo → envía mensajes con pausa de ~1 s y va apuntando
   cada nodo en el ledger (incluido el nodo de botón al pausar).
2. Un **`git push` (deploy) mata la función serverless a media corrida** → queda el nodo de
   botón apuntado como `'1'` pero el flujo nunca terminó ni se resolvió el botón; y como la
   función murió sin responderle 200 a WhatsApp…
3. **Meta reintenta el mismo mensaje** → el flujo se vuelve a correr, lee el ledger, ve el
   botón como `'1'` → **cascada**.

Encaja con todo: la reproducción en candidato limpio (sin interrupción) **pausa bien**; solo
cascadean los candidatos cortados a media corrida; y pasó mucho el 28 oct porque hubo **muchos
deploys ese día**. El deploy no es el bug — es el gatillo que expone el bug de fondo.

## El fix

Distinguir "pausó, esperando respuesta" de "ejecutado" con un centinela propio:

- Al **pausar** (bloque `__pause` en `runOneFlow`), el nodo se apunta como **`'W'`** (waiting),
  no `'1'`.
- En el **bloque de reutilización**, si un nodo reusado vale `'W'` (y NO es la reanudación real
  de ese nodo — esa se intercepta antes y lo vuelve `'H:<handle>'`), la corrida **se detiene ahí
  sin tomar ninguna rama ni re-enviar nada**: sigue esperando, como debe.

Así, aunque un deploy corte la corrida y WhatsApp reintente, el flujo ve `'W'`, se queda
quieto y **no detona las ramas**. Vuelve el motor inmune a la interrupción por deploy.

### Verificación (A/B contra un candidato real clonado, sin enviar a nadie real)

- Ledger sembrado con el nodo de ubicación en `'1'` (estilo viejo): reusa como pass y dispara la
  rama `si` (reproduce el bug). *Nota: ahora queda amortiguado porque el siguiente botón ya pausa
  con `'W'` y detiene la corrida.*
- Ledger sembrado con el nodo en `'W'` (el fix): **se detiene en el nodo pendiente, no dispara
  ninguna rama.** ✅

## Notas / pendientes

- **Ledgers viejos ya corruptos:** candidatos que AL MOMENTO del deploy ya estaban pausados con
  `'1'` podrían cascadear una vez más si se re-disparan, pero **amortiguado** (la cascada se corta
  en el primer nodo interactivo siguiente, que ya pausa con `'W'`). Se auto-sana al resolver o
  caducar (TTL). Opcional: limpieza puntual de `flow:progress:v1:*` de candidatos pausados.
- **Recomendación operativa:** evitar deployar mientras haya tráfico activo de candidatos en
  flujos (un deploy puede cortar corridas a media pausa). El fix lo vuelve seguro, pero menos
  interrupciones = menos reintentos.
