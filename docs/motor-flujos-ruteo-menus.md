# Motor de Flujos — ruteo de menús interactivos y reanudación (resume)

Referencia de cómo el motor (`api/utils/flow-engine.js`) ejecuta, PAUSA y REANUDA flujos con
menús interactivos (nodo "Mandar Botones/Opciones"), y de los bugs de producción corregidos en
sep 2026. Complementa `docs/nodo-botones-interactivos.md` y `docs/nodo-test-perfil-temporal.md`.

## Piezas clave

- **`runOneFlow(redis, flow, candidateId, snapshot, opts)`** — corre el grafo en orden topológico.
  - `opts.skipClaim` = modo test (nodo Test). `opts.ephemeral` = flujos "al regresar" (re-ejecutables).
  - `opts.resumeWait = { nodeId, handle }` = está REANUDANDO tras un clic/frase.
  - `useClaim = !testMode && !ephemeral` → gobierna el ledger de progreso y el dedupe `execKey`.
- **Ledger de progreso** (`flow:progress:v1:<flowId>:<candId>`, hash nodeId→valor): qué nodos ya
  se hicieron, para RETOMAR sin re-enviar. Valores: `'1'` (pass), `'0'` (fail), `'H:<handle>'`
  (menú resuelto: rama tomada — ver bug #1).
- **Espera de menú** (`flow:waiting:v1:<candId>`, hash flowId→JSON): `{nodeId, kind:'interactive',
  options:[{handle,match}], reaskCount, expiresAt}`. La registra el nodo de botones al pausar
  (`__pause`); la consume `resumeWaitingFlowIfMatch` cuando el candidato responde.
- **`resumeWaitingFlowIfMatch(candId, snapshot, texto)`** — matchea el texto (título del botón) a
  una opción y reanuda por su handle (o `timeout` si expiró). Lo llaman DOS sitios:
  - el **webhook de WhatsApp** para CLICS interactivos (`interactiveReply`) — ver "Ruteo de clics"
    abajo. NO requiere `blocked`.
  - el **BLOCK SHIELD de `agent.js`** para respuestas ESCRITAS a un nodo "Esperando Respuesta"
    legacy (grupos de frases), solo si el candidato está `blocked` (Desactivar Bot antes).
- **`hasLiveInteractiveMenuFor(candId, título)`** — SOLO consulta (no consume): ¿hay un menú
  interactivo vivo (no expirado) cuyas opciones incluyan ese título? Espeja el match de
  `resumeWaitingFlowIfMatch`. Lo usa el webhook para distinguir clic vivo (rutea) de clic muerto.

## Ruteo de clics interactivos (webhook) — no depende de "Desactivar Bot"

Un mensaje `interactiveReply` (clic en botón/lista) SIEMPRE es respuesta a un menú de flujo (Brenda
nunca manda menús). El webhook de WhatsApp lo intercepta ANTES de la IA y lo resuelve él mismo —
NUNCA se lo pasa a Brenda:
- **Menú vivo que matchee la opción** (`hasLiveInteractiveMenuFor` = true) → `resumeWaitingFlowIfMatch`
  rutea por su rama. No requiere que el candidato esté `blocked`.
- **Lista vieja ya usada / expirada / sin menú vivo** → sin acción (solo telemetría
  `interactive_stale_click_ignored`). Cubre el bug real de prod: el candidato scrollea, toca una
  opción de una lista que ya contestó, y Brenda (viva porque el menú no traía Desactivar Bot antes)
  respondía alucinando. Ahora el clic muerto simplemente no hace nada.

Esto reemplaza el requisito viejo de poner "Desactivar Bot" ANTES de cada menú para que el clic
ruteara: los clics interactivos ya no dependen de `blocked`. (Desactivar Bot sigue siendo válido si
además quieres silenciar a Brenda para lo ESCRITO, y sigue siendo necesario para el nodo legacy
"Esperando Respuesta" por frases.)

## Elegibilidad de un nodo (isEligible)

Un nodo se ejecuta según sus aristas ENTRANTES:
- **Normales** ("Sí"/sin handle): corre si **al menos una** rama ALCANZADA pasó (`'pass'`) y
  **ninguna** rama alcanzada falló (`'fail'`). Las ramas `'unreached'` (nunca recorridas) se
  IGNORAN. → Cubre "varias condiciones deben cumplirse" (AND real entre las evaluadas) Y "varias
  ramas convergen en un nodo final compartido" (join). Ver bug #4.
- **"No cumple"** (`handle === 'no'`): OR — basta que una rama traiga un origen que falló.
- **Rama reanudada** (`branchTaken`): solo la arista cuyo handle coincide con la rama tomada.

## Bugs de producción corregidos (sep 2026) — verificados con el camino real

1. **Menús encadenados re-disparaban ramas del menú anterior** (commit `4dd09950`). Al reanudar
   por un 2º menú, el 1º se releía como `'1'` y sus aristas de opción se trataban como normales
   desde un nodo pass → se disparaban TODAS. Fix: al tomar una rama en un resume se guarda
   `H:<handle>` en el ledger; un resume posterior restaura SOLO esa rama.

2. **Re-click nuevo heredaba el ledger de un viaje anterior incompleto** (commit `06e6b37c`). Un
   flujo ephemeral reusaba el ledger viejo → el clic rutéaba por ramas de la corrida pasada
   ("cliqueé la 1ª opción y me dio otra info"). Fix: en un viaje FRESCO ephemeral/test (sin
   `resumeWait`) se borra el ledger al arrancar.

3. **La reanudación se bloqueaba por "ya completado" (execKey)** (commit `09b125d0`). Un candidato
   que ya completó el flujo (en `execKey`) recibía el menú en un re-click nuevo (ephemeral ignora
   execKey) pero al tocar un botón NO rutéaba ("no se disparó ningún botón"): la reanudación corre
   no-ephemeral y el chequeo de execKey la cortaba. Fix: una reanudación (`opts.resumeWait`) nunca
   se bloquea por execKey — es continuación de un viaje en curso, no un arranque.

4. **Nodo final compartido (join) nunca se activaba** (commit `58460ab9`). Un nodo con varias
   aristas entrantes (ej. 4 subárboles que convergen en un "Nos vemos"→checkpoint) exigía que
   TODAS las ramas pasaran (AND). Como el candidato recorre UNA, las otras quedaban `'unreached'`
   y el nodo final nunca corría. Fix: la convergencia normal ignora las ramas `'unreached'` (ver
   isEligible arriba). Preserva el AND real entre condiciones evaluadas (regresión verificada).

## Requisitos para que el ruteo por clic funcione en producción

1. **Cada opción/fila conectada a su rama** (una salida por botón + Timeout).
2. Los flujos "al regresar" (ephemeral) re-disparan en cada regreso (gobernado por cadencia
   `maxReturns`/cooldown, no por execKey).

> **Ya NO se requiere "Desactivar Bot" antes del menú** para que el clic rutee — el webhook
> resuelve el clic sin depender de `blocked` (ver "Ruteo de clics interactivos" arriba). Antes, sin
> Desactivar Bot el candidato quedaba con `blocked=false` y Brenda respondía el clic en vez de
> rutear (bug de prod confirmado sep 2026 en los flujos "RE-CLICK", cuyos menús no traían Desactivar
> Bot cableado). Desactivar Bot sigue sirviendo para silenciar a Brenda ante mensajes ESCRITOS.

## Arranque limpio para pruebas

`resetFlowCandidateState(flowId, candidateId)` borra ledger, espera, execKey, cadencia y lock del
candidato para ESE flujo. Lo llama el nodo Test en cada Run (arranque fresco). No toca `blocked`
ni las marcas de checkpoint. Útil también para limpiar a mano un candidato de prueba embarrado.
