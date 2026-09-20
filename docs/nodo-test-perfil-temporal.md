# Nodo Test — Perfil temporal configurable

El nodo **Test** del editor de flujos ahora deja **elegir con qué perfil entras** para probar
cualquier ruta, **sin tocar ni persistir un candidato real**. Creado 2026-09-20.

## Config (menú lateral del nodo)
Al hacer clic en el nodo Test se abre el drawer con:
- **Perfil**: Completo / Incompleto → arma un candidato temporal completo (nombre, género,
  fecha, municipio, categoría, escolaridad, `paso2Estado='completo'`) o incompleto. Así el
  mismo número sirve para probar el flujo "re-click completo" Y el "incompleto" (el nodo Inicio
  filtra por esto).
- **Etiqueta(s)**: las que tendrá el candidato temporal → rutea los nodos **Filtro: Etiqueta**
  en modo "específica".
- **Vacante actual**: para **Filtro: Etiqueta** en modo "es su etiqueta actual".
- **Check points "ya pasados"**: multi-select de todos los checkpoints → las **Condición: Check
  Point** que apunten a esos toman la rama **Sí** (los demás, la **No**).
- **Opción de menú a simular**: título del botón/fila (o `timeout`). Dos modos de prueba de menús:
  - **CON opción a simular** → la prueba NO pausa: sigue SOLO esa opción y previsualiza toda la
    ruta en un Run (sin clic físico). Sin esto se dispararían TODAS las ramas del menú.
  - **SIN opción a simular** → la prueba registra una espera REAL (como producción) para que tu
    **clic físico** en el WhatsApp enrute de verdad por la maquinaria real (BLOCK SHIELD →
    resumeWaitingFlowIfMatch), sin re-enviar lo anterior (ledger). La espera se guarda con el id
    del candidato real, así el clic que llega por webhook coincide. Ojo: la reanudación tras el
    clic corre con el candidato REAL (no el perfil temporal) y marca execKey — inofensivo en
    flujos "al regresar" (ephemeral los ignora).

  **Nada de esto afecta producción**: el gate es `opts.skipClaim` (solo modo prueba). Verificado:
  en producción el menú manda 1 solo mensaje, pausa, ninguna rama corre hasta el clic → sin spam.

El **número** y el botón **Run** siguen en el cuerpo del nodo. Los mensajes de prueba SÍ se
envían a ese número (y se guardan en su chat), pero el **perfil elegido NO se persiste**: solo
vive en el snapshot en memoria de esa corrida.

## Cómo funciona (backend)
- `api/flows.js` (acción `test`): toma el candidato real por su número (para `whatsapp` +
  `phoneNumberId`) y **sobreescribe en memoria** los campos según el perfil temporal
  (`perfil`, `tags`, `vacanteActual`). Nunca hace `saveCandidate`.
- `condicion_checkpoint`: en modo prueba (`opts.skipClaim`) lee `opts.simulatedCheckpoints`
  (`[{flowId,nodeId}]`) en vez de Redis → decide Sí/No por lo que elegiste, sin sembrar marcas.
- `runFlowTest(flow, snapshot, { simulatedCheckpoints })` pasa eso al motor. Como corre con
  `skipCounters`, los checkpoints/contadores NO escriben Redis; el nodo de botones/esperando
  respuesta no pausan (no hay clic real en una prueba).

## Verificado (2026-09-20, contra el motor real, sin envíos ni escrituras)
- Completo + etiqueta correcta + checkpoint marcado → recorre todo el flujo.
- Etiqueta equivocada → se cae en Filtro Etiqueta.
- Sin el checkpoint → se cae en Condición Check Point.
- Incompleto → se cae en el Inicio (filtro "completo").

## Archivos
- `api/utils/flow-engine.js` — override de checkpoints simulados en `condicion_checkpoint`;
  `runFlowTest` acepta `simulatedCheckpoints`.
- `api/flows.js` — la acción `test` arma el snapshot del perfil temporal.
- `src/components/flows/NodeConfigDrawer.jsx` — `TestNodeConfig` (perfil/etiquetas/vacante/checkpoints).
- `src/components/flows/nodeTypes/FlowNode.jsx` — el nodo Test ahora abre el drawer al clic.
- `src/components/flows/FlowEditor.jsx` — default data + `handleTestRun` pasa la config.
- `src/services/flowsService.js` — `testFlow(flowId, whatsapp, testProfile)`.
