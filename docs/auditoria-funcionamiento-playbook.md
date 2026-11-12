# Auditoría de funcionamiento del sistema — playbook repetible

> Objetivo: revisar **todos los chats que entraron** en una ventana de tiempo, de inicio a fin
> (hayan terminado o no), en los 3 ejes del sistema, hasta que Candidatic funcione al 100%.
> Esto se corre a diario (idea de Oscar, 2026-11-10). Lee Redis de producción en modo **solo
> lectura** — nunca escribe nada, es seguro de correr cuando sea.

## Cómo correr

```bash
# Una ventana explícita (horas en zona Monterrey):
node scripts/auditoria/auditar-ventana.mjs "2026-11-11 00:00" "2026-11-11 14:30"

# Desde una hora hasta AHORA:
node scripts/auditoria/auditar-ventana.mjs "2026-11-11 14:30"

# Todo el día de hoy hasta ahora:
node scripts/auditoria/auditar-ventana.mjs hoy

# Deep-dive de una anomalía (conversación completa de un candidato):
node scripts/auditoria/ver-chat.mjs 521XXXXXXXXXX          # por teléfono
node scripts/auditoria/ver-chat.mjs cand_1794320190795_...  # por id

# Auditoría ENFOCADA a la extracción (garantiza: Brenda contestó + guardó + coherente):
node scripts/auditoria/auditar-extraccion.mjs "2026-11-11 00:00" "2026-11-11 14:30"
```

`auditar-extraccion.mjs` verifica 3 garantías por chat en extracción: **A** no muda (todo
turno de texto tuvo respuesta ≤120s, solo cuenta en extracción), **B** guardó lo que dieron
(fecha/escolaridad/categoría reconocible → campo no vacío), **C** coherente (no re-preguntó un
dato ya dado ni entró en bucle de la MISMA pregunta real ≥3×). Ojo al interpretar: un "bucle de
nombre" suele ser Brenda **re-preguntando bien** a un candidato evasivo que no da el dato (no es
bug); una "categoría no guardada" suele ser un **clic de botón del flujo** (p.ej. "MONTACARGAS"
→ "vacante cerrada") que no persiste el campo. El bug real de "no guardó" es la familia
**edad-en-años** (ya con fix) y los turnos perdidos (muda).

`auditar-ventana.mjs` imprime el resumen y escribe el detalle por chat en
`scripts/auditoria/out/` (gitignored — **tiene PII**, no commitear). `REDIS_URL` se toma del
entorno o de `.env.production`.

## Qué mide (los 3 ejes)

- **EJE 1 — Escenario:** ¿entró a donde debía? Nuevos → saludo determinista de Brenda;
  recurrentes → ruteados a su flujo (`al_regresar`) o extracción. Métrica: *nuevos saludados
  correctamente = 100%*.
- **EJE 2 — Extracción de Brenda:** paso 1 (nombre→fecha→municipio→escolaridad→categoría) y
  paso 2 (colonia→experiencia→meses). Señales de falla: **bucle de fecha** (bot pide fecha
  ≥3×), **edad-en-años** (fechas `01/01/aaaa` = las sintetiza el fix del bucle).
- **EJE 3 — Flujos:** completos → flujo COMPLETOS con vacante asignada; incompletos en silencio
  → flujo INCOMPLETOS. Señal: **completó pero SIN vacante** (el filtro del flujo lo descartó).

## Cómo interpretar las anomalías

| Anomalía | Qué es | ¿Bug? |
|---|---|---|
| **Silencio sin handoff** | Entrante sin respuesta del bot y sin `blocked` | Casi siempre benigno (cierre natural "✌/gracias" o conversación concluida). Revisar con `ver-chat` solo si el último entrante del candidato era una pregunta o un dato real sin contestar. |
| **Flujo DOBLE** | Recibió COMPLETOS **y** INCOMPLETOS | 🔴 Bug. Debe ser **0** con el fix desplegado 2026-11-10 (marca `flow:reengaged:v1`). Si aparece >0 **con `reengaged` presente**, el fix falló. |
| **Incompletos atascados** | ≥5 entrantes y sigue incompleto | Mezcla: fuera de zona, cierres ("gracias"), o atasco real de extracción. Revisar los que tengan `falta:[...]` de datos core con `ver-chat`. |
| **Completó SIN vacante** | Perfil completo, flujo ejecutó, `vac:-` | El filtro del flujo lo descartó (menor de edad, fuera de rango de edad, categoría sin vacante, fuera de zona). Hoy **no se le da cierre** → P1 pendiente. |

## Estado de fixes

**Desplegados (commit `c035c05d`, 2026-11-10 ~20:55 MTY):**
- 🔴 **Bucle de fecha:** Brenda acepta edad en años → sintetiza `01/01/(año−edad)`. Verificar en
  próximas auditorías que los `01/01/aaaa` de candidatos **nuevos** completen sin bucle.
- 🔴 **Flujo doble:** `flow:reengaged:v1` suprime COMPLETOS si INCOMPLETOS ya mandó vacante.
  Verificar que "Flujo DOBLE" baje a 0.

**Pendientes (P1, no implementados):**
- Validación geográfica **adelantada** (hoy la exclusión por km del nodo de ubicación funciona
  pero llega tarde y depende de GPS; 10+/ventana fuera-de-zona nunca la activan).
- **Cierre** para completos filtrados (`vac:-`): mensaje "guardé tu perfil, te avisamos" +
  etiqueta `sin_vacante_match`; y que el nodo de km, al rechazar, limpie `vacanteActual`.

## Log de resultados

| Fecha | Ventana (MTY) | Chats | Nuevos | Escenario OK | Perfil completo | Con vacante | Bucle fecha | Flujo DOBLE | Drops reales |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | 00:00–14:30 | 153 | 110 | 110/110 ✅ | 99 | 89/99 | 6 (1 perdido) | 3 | 0 |
| 2026-11-10 | 14:30–20:56 | 179 | 119 | 119/119 ✅ | 115 | 98/115 | 6 | 7 | 0 (1 a vigilar) |
| 2026-11-11 | 00:00–13:30 | 195 | 116 | 116/116 ✅ | 139 | 108/139 | 6 | **0** ✅ | 0 |

**2026-11-11 — fixes validados en producción:** Flujo DOBLE pasó de 3+7 a **0**. Edad-en-años:
**11 fechas `01/01` sintetizadas (8 de candidatos nuevos que completaron)** — confirmado en vivo
(Juan Méndez: "39 años" → "Registré tu edad" → avanzó sin bucle). Extracción del día: **192/193
limpias (99.5%), 0 "no guardó", 0 bucle** (ayer 92.6% con la familia edad-en-años). Pendiente que
CRECE: completos filtrados sin vacante = **31/139 (22%)**, incluye categorías fuera del catálogo
(Almacenista, Chofer Vendedor) y Mantenimiento saturado → siempre caen sin vacante ni cierre (P1).

**Lectura de hoy:** arquitectura sana (escenarios 100%, 0 drops reales). Los dos bugs
confirmados a escala (bucle de fecha ~6/ventana, flujo doble ~0.5–1/hora) — por eso se
desplegaron los fixes. Pendientes P1 (geo + cierre de filtrados) sin tocar aún. Detalle por
chat de cada ventana en `docs/auditoria-chats-<fecha>.md` (local, con PII).
