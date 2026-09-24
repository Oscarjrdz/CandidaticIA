# Brenda extractora NUNCA agenda entrevistas — limpieza sep 2026

## Regla de producto (no negociable)

Brenda **extractora** no está hecha ni pensada para agendar ni ofrecer entrevistas —
**ni ahora ni nunca**. Hace exactamente esto y nada más:

1. **Recibe** a candidatos nuevos.
2. **Extrae** sus datos (nombre → fecha nac./edad → municipio → escolaridad → categoría →
   colonia → experiencia → meses).
3. **Guarda** el perfil.
4. Cuando termina, entra a **Sala de Espera**: solo los recibe y **calma**, diciendo que
   estamos buscando lo mejor para ellos. Nunca sigue la plática, nunca ofrece ni agenda
   entrevistas.

Hace meses se intentó que Brenda citara a entrevista (el "cerebro de reclutador"). Ese
experimento se descartó y el cerebro se removió (ver memoria `cerebro_reclutador_removido`,
commit 759aace8), pero **quedó residuo** de la maquinaria de citas regado en `agent.js`.
Este documento registra el incidente que lo destapó y la limpieza aplicada.

## El incidente (2026-09-24)

Candidata **Magdalena Zúñiga** (tel 8182006649), perfil completo, en Sala de Espera.
Preguntó por turnos de 8 horas / lunes a jueves. Brenda respondió:

> ¡Hola Magdalena! 😊 Estoy revisando las opciones disponibles y validando turnos. Te
> agradezco tu paciencia mientras busco la mejor vacante para ti. ¡Hablamos pronto! 🌸✨
> **[MSG_SPLIT]😄 ¿Avanzamos con tu cita de entrevista? ¡Estás muy cerca! 🌟🙌**

La **primera** burbuja (Sala de Espera) estaba perfecta. La **segunda** — la pregunta
proactiva de entrevista — la pegó el CÓDIGO, no el LLM. Ocurrió en dos turnos seguidos
(otra vez con "¿Quieres que te programe la entrevista hoy mismo? 📅🔥").

## Causa raíz

En `api/ai/agent.js`, la función `formatRecruiterMessage()` (formateador de última milla que
corre sobre TODA respuesta antes de enviarla) tenía dos bloques que **inyectaban** un CTA de
entrevista al final del texto:

1. **"INICIO PASO CTA GUARANTEE"** — dependía de `stepContext.isInicio`, un flag del cerebro
   de reclutador. Como ese cerebro se removió, `isInicio` **nunca** se asigna → código muerto.
2. **"FAQ CLOSING QUESTION SAFETY NET"** (`isJobFaqAnswer` → array `_faqClosings`) — **este sí
   corría.** Si el perfil estaba completo y el texto mencionaba turno/sueldo/horario/etc. y
   medía >80 caracteres, le concatenaba `[MSG_SPLIT]` + una frase aleatoria tipo *"¿Avanzamos
   con tu cita de entrevista?"*. La respuesta de Sala de Espera cumple todas esas condiciones
   (perfil completo + menciona "turno/vacante"), así que **siempre** le pegaba la cita.

## Qué se eliminó (commit de esta limpieza)

Todo en `api/ai/agent.js`:

| Elemento | Ubicación previa | Por qué se borró |
|---|---|---|
| Bloque inyector "INICIO PASO CTA GUARANTEE" | `formatRecruiterMessage` | Código muerto (`isInicio` nunca se activa) |
| Bloque inyector "FAQ CLOSING QUESTION SAFETY NET" (`_faqClosings`) | `formatRecruiterMessage` | **Era el que citaba en Sala de Espera** |
| `_CTA_VARIANTS` (12 frases de cita) | top del archivo | Solo lo usaba el bloque INICIO muerto |
| `_SINGLE_HOUR_CTAS` (10 frases) | top del archivo | Sin uso (ya era huérfano) |
| `_AMBIGUITY_VARIANTS` (5 frases) | top del archivo | Sin uso |
| `_PIVOT_B2_VARIANTS` (5 frases) | top del archivo | Sin uso |
| `incrCTAIndex()` + contador `cta_idx:*` | top + "CAPA 6" | Solo lo llamaba código en `isRecruiterMode` (siempre false) |
| `setCitaPendingFlag()` + `CITA_PENDING_TTL` + flag `cita_pending:*` | top + "CAPA 6" | Mismo: solo `isRecruiterMode`, ya muerto |
| Bloque "CAPA 6" (marcaba `cita_pending` al detectar CTA en el batch) | dentro del envío | `isRecruiterMode` siempre false |

En cada sitio se dejó un comentario `❌ [... ELIMINADO — sep 2026]` explicando qué vivía ahí.

### Refuerzo complementario en el prompt de Sala de Espera

Se agregó una **regla 0 crítica** al `salaDeEsperaPrompt`: prohibición absoluta de ofrecer,
proponer, sugerir, preguntar o agendar entrevistas/citas/horarios de forma proactiva. Es la
red a nivel LLM por si el modelo lo intentara por su cuenta; el borrado de código es la red
determinista.

## Verificación

- `node --check api/ai/agent.js` → OK.
- `npx eslint api/ai/agent.js` → sin errores (ni nuevos ni preexistentes en este archivo).
- Ninguna referencia viva a los símbolos borrados (solo comentarios).
- El comportamiento real solo se puede confirmar en conversación / simulador — un cambio de
  prompt + borrado de formateo no se verifica desde el entorno de Claude.

## Residuo PASIVO que quedó (pendiente, NO urgente)

En `formatRecruiterMessage` siguen viviendo reformateadores de fechas/horarios de entrevista
(~líneas 377-712 aprox.): "COMBINED DAYS+HORARIO", "CONFIRMATION MESSAGE: Ok [name], entonces
agendamos...", el parser de listas de fechas, etc.

- **Son pasivos:** solo se activan `if` el texto YA contiene "Tengo entrevistas los días",
  "entonces agendamos tu entrevista", slots de hora, etc. Ningún prompt de la extractora
  (extracción / Sala de Espera / capturista) produce ese texto, así que **nunca disparan**.
- **No se removieron en este pase** porque están entrelazados con formateo general que SÍ se
  usa (guard de emojis, split de burbujas, lista de escolaridad, captura de categoría), y
  rebanar ~335 líneas intercaladas sin prueba en runtime es riesgoso (este repo ya tuvo casos
  de "parecía correcto pero fallaba").
- **Recomendación:** removerlos en un pase dedicado, bloque por bloque, si se quiere dejar
  `agent.js` 100% libre de maquinaria de citas. Decisión pendiente de Oscar.

## Referencias

- Memoria: [[project_cerebro_reclutador_removido]], [[project_sala_espera_nunca_cita]]
- Chat del incidente: candidato `cand_1787550360999_yltfpn43p` (tel 8182006649).
