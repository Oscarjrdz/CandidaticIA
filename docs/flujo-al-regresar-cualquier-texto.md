# Disparador "al regresar" — opción "Escribe cualquier cosa" (solo completos)

**Commit:** `13f1c26c` · **Fecha:** 2026-09-29

## Qué resuelve

El nodo **Inicio** con disparador **"Cuando regresa y pide info"** (`al_regresar`) ya
tenía dos señales para completos:

1. **Volvió a clickear un anuncio** (`returnOnAd`, default `true`).
2. **Escribió una frase** (`returnOnPhrase` + `returnGrupos` + `returnMatchMode`).

Faltaba una tercera: que un **completo dispare el flujo con cualquier mensaje que
escriba**, sin depender de un click de anuncio ni de una frase específica.

## Por qué "es posible" (ya era la arquitectura)

Para un candidato **completo**, `agent.js` ya corre los flujos "al regresar" **ANTES**
de la Sala de Espera:

- [agent.js:1861-1872](../api/ai/agent.js#L1861) → `runReturningFlowsForCandidate(...)`.
  Si algún flujo dispara → `_returnHandled = true`, Brenda-extractora calla, habla el flujo.
- [agent.js:1874](../api/ai/agent.js#L1874) → la Sala de Espera solo entra si `!_returnHandled`.

O sea el orden **"valida primero si entra a un flujo; si no, entra a Sala de Espera"** ya
existía. Lo único que faltaba era la **señal** "cualquier texto". Esta feature solo la agrega.

## Implementación

### Motor — `returnFlowSignalMatches` ([flow-engine.js](../api/utils/flow-engine.js))

Nuevo flag `returnOnAnyText`. La regla, en OR con anuncio/frase:

```js
if (d.returnOnAnyText && complete && String(incomingText || '').trim()) return true;
```

- **Solo completos** (`complete`) — un incompleto a media captura nunca se engancha por esto.
- **Texto no vacío** — un completo que manda solo sticker/imagen/emoji-vacío/espacios NO
  dispara → cae a Sala de Espera.
- **Sin reja de inactividad** (a diferencia del "orgánico" de incompletos): un completo ya
  no está en captura, así que no hay captura viva que proteger. La **cadencia** existente
  (`returnCooldownDays` / `maxReturns` / `minReturnDays`) es lo que evita reenviarle la info
  en cada mensaje.

### UI — checkbox ([NodeConfigDrawer.jsx](../src/components/flows/NodeConfigDrawer.jsx))

Tercer checkbox **"Escribe cualquier cosa (solo completos)"** debajo de "Escribió una
frase". Visible cuando el filtro de perfil **no** es `incompleto` (cubre `completo` —default—
y `todos`). Incluye el tip de poner un cooldown.

## Comportamiento

| Caso | Resultado |
|------|-----------|
| Completo escribe cualquier texto, hay flujo elegible | Dispara el flujo; Brenda calla |
| Completo escribe texto, ningún flujo cae | Sala de Espera |
| Completo manda solo sticker/imagen/emoji/espacios (texto vacío) | No dispara → Sala de Espera |
| Incompleto (aunque el flag esté ON) | No dispara por esta señal (gate `complete`) |
| Nodo existente sin tocar (flag `undefined`) | Igual que antes (opt-in) |
| `profileFilter='todos'` | Rama completo usa `returnOnAnyText`; rama incompleto sigue con `returnOnOrganic` |

## Riesgo conocido / cómo acotarlo

Con `cooldown = 0` y `maxReturns = 0`, un completo que platique en la Sala de Espera
disparará el flujo en **cada** mensaje (por diseño: el flujo tiene prioridad sobre la Sala).
Para no reenviarle la info de su vacante en cada turno, configurar un **cooldown** (días)
en el nodo Inicio.

## Verificación

31 casos de la función pura `returnFlowSignalMatches` (sin Redis), 2 rondas, todos verdes:
señal nueva, regresiones de anuncio/frase/orgánico, bordes de texto (vacío/null/espacios/
saltos/emoji), combinaciones OR y `profileFilter='todos'`. `npm run build` limpio.

**No verificado end-to-end por WhatsApp real** — falta armar un flujo real en el editor
(Inicio "al regresar" + "Escribe cualquier cosa" → Etiqueta "actual" → mandar info) y
probarlo con un completo escribiendo en vivo.

Ver también el doc base del feature en la memoria `project_flujo_al_regresar`.
