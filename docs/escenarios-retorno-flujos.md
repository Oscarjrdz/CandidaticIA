# Escenarios de flujos — Completos e Incompletos (base de tests)

> Documenta TODOS los comportamientos construidos y verificados en producción (sesión 2026-11-07).
> Pensado para derivar tests. Cada escenario trae: **estado inicial**, **disparo**, **resultado esperado**
> y **variables que cambian el resultado**. Verificado en vivo salvo donde se marca *(no probado)*.

## Config base real (flujos activos)

- **COMPLETOS NUEVOS** — Inicio `al_completar` + `al_regresar`, perfil **completo**. Señal de regreso: solo **anuncio** (`returnOnAd`), frase/cualquier-texto **apagadas**. Cadencia: sin tope, sin cooldown. 7 ramas (Etiquetas en modo **"actual"**).
- **INCOMPLETOS NUEVOS** — Inicio `inicio_incompleto_silencio` (cron por silencio). 6 ramas (Etiquetas en modo **"actual"**).
- Cada rama (nodo Etiqueta) tiene 3 mensajes: **caducidad**, **re-clic misma campaña**, **fecha vencida**.

## Reglas transversales (aplican a los dos)

- **Ruteo por rama = Etiqueta modo "actual"**: entra SOLO a la rama de `vacanteActual` (el último anuncio clickeado). Las demás etiquetas del historial se caen aunque sigan en `tags`.
- **Candado de caducidad**: si una rama tiene menús con fecha y **TODOS** están vencidos → no entra, manda el mensaje de **caducidad**. (Ramas sin fechas nunca se cierran.)
- **Dedupe permanente** (`flow:executed`): un flujo `al_completar` corre **una sola vez** por candidato. Los flujos `al_regresar` corren en modo *ephemeral* → **ignoran el dedupe** (re-corren fresco, limitados por cadencia).
- **Fecha vencida de botón** (ver sección propia): se mide por un **snapshot** de la fecha guardado al enviar el menú — inmune a reciclar/borrar/reestructurar el botón.

---

# COMPLETOS

### CO-1 · Nuevo completa su registro (primer flujo)
- **Estado:** candidato nuevo, vino de anuncio (tag + `vacanteActual` seteados), cierra paso 1 **y** paso 2 en este turno.
- **Disparo:** gancho `al_completar` (flanco paso2 → `completo`).
- **Esperado:** entra a COMPLETOS, Etiqueta "actual" rutea a su `vacanteActual` → recibe el flujo de esa vacante (preámbulo + menú de días). Al terminar → entra a `flow:executed`.
- **Variables:**
  - Rama **cerrada** (todos los días vencidos) → mensaje de **caducidad**, no entra al menú.
  - `vacanteActual` **vacío** (orgánico que completó sin anuncio) → ninguna rama "actual" coincide → **no recibe flujo**.
  - Multi-etiqueta: entra solo a la de `vacanteActual`, no a las viejas.

### CO-2 · Completo que ya terminó el flujo y regresa **SIN anuncio** (orgánico)
- **Estado:** completo, en `flow:executed`, escribe sin clic de anuncio.
- **Disparo:** cualquier mensaje ("hola").
- **Esperado:** **NO re-entra al flujo.** Cae en **Sala de Espera**:
  - "gracias" → 👍 + cierre cálido rotado.
  - despedida ("adiós", "nos vemos", "buenas noches") → 👋, sin texto.
  - acuse ("ok", "va", solo emoji) → 👍, sin texto.
  - pregunta/plática → frase "ocupada" rotada ("dame unos minutitos").
  - Si regresó tras ≥2h (máx 1/día) → se antepone saludo por hora.
- **Variables:** Sala de Espera **apagada** (`gptHostEnabled` off) → **silencio**. Si `returnOnAnyText` estuviera **activo** → sí re-entraría al flujo (NO es la config actual).

### CO-3 · Completo re-clickea **OTRO** anuncio (campaña nueva)
- **Estado:** completo, ya tenía tag A; clickea anuncio B (tag nuevo).
- **Webhook:** agrega tag B (conserva A), `vacanteActual = B`, `reclick = false`.
- **Disparo:** `al_regresar` (ephemeral, ignora dedupe).
- **Esperado:** entra **SOLO a la rama de B**. Recibe el flujo de B completo (re-corre fresco). **NO** manda mensaje de re-clic (es vacante nueva).
- **Variables:** B cerrada → **caducidad**. Cadencia (si estuviera configurada) puede limitar.

### CO-4 · Completo re-clickea el **MISMO** anuncio (misma campaña)
- **Estado:** completo, ya tenía tag A; re-clickea anuncio A.
- **Webhook:** `vacanteActual = A`, `reclick = true`.
- **Disparo:** `al_regresar`.
- **Esperado:** entra a rama A. La Etiqueta manda **mensaje de re-clic** ("ya te postulaste a esta vacante antes, aquí va la info de nuevo") **antes** de descender; luego re-manda el flujo de A.
- **Variables:** A **cerrada** → **gana la caducidad** (el mensaje de re-clic NO se manda). Cadencia aplica.

### CO-5 · Completo clickea un **botón de fecha vencida** *(Punto 1)*
- **Estado:** completo esperando en un menú de días; toca un botón cuya fecha (snapshot) ya pasó. La ventana de espera sigue abierta.
- **Disparo:** clic del botón vencido.
- **Esperado:** **NO confirma el día muerto.** Re-envía el **mismo menú** con solo las fechas vivas, usando el **mensaje de fecha vencida como cuerpo** (sin el preámbulo del nodo) → elige una viva y **continúa desde ahí** (conserva su avance).
- **Variables:** si ese menú ya **no tiene ninguna fecha viva** → reinicia (ephemeral) → aplica **caducidad**. Inmune a reciclar/borrar el botón (snapshot).

### CO-6 · Completo eligió día válido, manda **ubicación** días después (fecha ya pasó) *(Punto 2)*
- **Estado:** eligió día válido; flujo pausado pidiendo ubicación; la fecha venció mientras esperaba su GPS.
- **Disparo:** comparte su ubicación.
- **Esperado:** no confirma el día muerto → re-manda el **menú de fechas** (mensaje de fecha vencida + fechas vivas). Al re-elegir, **re-pide la ubicación** (se re-corre lo posterior al menú).

### CO-7 · Completo eligió día válido, clickea **"Dame Pase Entrevista"** (fecha ya pasó) *(Punto 2)*
- **Estado:** eligió día válido; la fecha venció; clickea un botón de continuación (sin fecha propia).
- **Disparo:** clic de "Dame Pase Entrevista" (o cualquier botón de continuación).
- **Esperado:** en vez del pase a un día muerto → re-manda el **menú de fechas** con las vivas.

### CO-8 · Completo que **ya agendó** y re-clickea un anuncio
- **Esperado:** re-entra al **flujo completo** (toda la cascada). **Intencional** — no se detecta "ya agendó". (Decisión de diseño: un re-clic de anuncio = "muéstrame esta vacante".)

### CO-9 · Completo regresa con el **texto exacto del anuncio pero SIN `referral`** (post / página / vacante reenviada)
- **Estado:** completo que ya trae etiqueta (`vacanteActual` seteado); manda el texto **exacto** pre-llenado del anuncio — `"¡Hola! Quiero más información."` — pero el turno **NO** trae el objeto `referral` de Meta.
- **Por qué pasa:** no hay anuncio pagado vivo detrás del clic. Le **compartieron la vacante por WhatsApp**, le mandaron **el post**, o entró a la **página** y dio clic — en todos esos Meta no adjunta atribución (`referral`), aunque la intención es idéntica a un clic real. (Confirmado en prod 2026-11-09, candidato 8135538667: el mismo texto con `referral` el 11-07 disparó el flujo; sin `referral` el 11-09 caía a Sala de Espera.)
- **Webhook:** detecta el texto exacto (normalizado: minúsculas, sin acentos ni signos) en un candidato **existente** con `vacanteActual` y **sin `referral`** este turno → escribe la **misma** marca `return:adclick:v1` que un clic real, con `{ tag: vacanteActual, reclick: true, viaText: true }`.
- **Disparo:** `al_regresar` (idéntico a un re-clic con `referral`).
- **Esperado:** entra a la rama de su etiqueta (`vacanteActual`), con **`reclick: true`** → se comporta como **CO-4** (mensaje de re-clic "ya te postulaste…" + re-manda el flujo). Toda la demás política aplica sin cambios: ruteo "actual", caducidad (rama cerrada → gana la caducidad), cadencia.
- **Variables:**
  - Candidato **sin `vacanteActual`** (orgánico que nunca vino de anuncio) → no hay rama a la cual rutear → **no marca** → cae a Sala de Espera (CO-2).
  - Turno **con `referral`** → los bloques normales ya marcaron; este no se dispara (gate `!metaMsg.referral`).
  - Texto que **no es exacto** ("hola quiero info", "quiero más información de la vacante") → **no marca** (evita falsos positivos con mensajes orgánicos).
- **NO modifica** ninguna otra política: es solo una **fuente adicional** de la marca de clic. Gate estricto: texto exacto + existente + con `vacanteActual` + sin `referral`.

---

# INCOMPLETOS

### IN-1 · Incompleto se queda **callado** (silencio)
- **Estado:** incompleto, N horas sin responder.
- **Disparo:** cron `flow-incompletos` (por AUSENCIA de respuesta, no por mensaje).
- **Esperado:** entra al flujo de INCOMPLETOS de su **etiqueta más nueva** (Etiqueta "actual" = `vacanteActual`). Las etiquetas viejas del historial se caen.
- **Variables:** tope de pases del cron. Rama cerrada → **caducidad**.

### IN-2 · Incompleto **regresa** y escribe
- **Estado:** incompleto, escribe cualquier mensaje.
- **Esperado:** Brenda **continúa la extracción** (pide el siguiente dato faltante). **NO** entra al flujo de incompletos (ese es por cron). Sin saludo forzado — el GPT de extracción retoma natural.
- **Variables:** si tiene un menú vivo pendiente y su texto coincide con una opción → primero **reanuda ese menú** (no extracción).

### IN-3 · Incompleto re-clickea un anuncio (nuevo o mismo)
- **Webhook:** asigna/agrega la etiqueta + `vacanteActual` (nuevo → `reclick=false`; mismo → `reclick=true`).
- **Esperado:** sigue en **extracción**. El despachador de regreso **no** agarra INCOMPLETOS (es `inicio_incompleto_silencio`, no `al_regresar`), así que ni nuevo ni mismo anuncio lo meten al flujo — solo actualiza su etiqueta y continúa dando datos.

### IN-4 · Incompleto **TERMINA** su extracción
- **Disparo:** cierra paso 2 (flanco → `completo`).
- **Esperado:** se **gradúa a completo** → gancho `al_completar` → entra a **COMPLETOS**, rama de su **vacante más nueva** (idéntico a CO-1). El cron de incompletos deja de molestarlo (ya no es incompleto).
- **Variables:** rama de esa vacante cerrada → **caducidad** al graduarse.

### IN-5 · Fecha vencida dentro del flujo de incompletos
- Si el flujo de INCOMPLETOS tiene menús con fecha y el candidato clickea un botón vencido (o eligió válido y continúa días después) → **mismo trato que CO-5/6/7** (re-manda el menú con fechas vivas / caducidad si no quedan).

---

# Fecha vencida — detalle del mecanismo (aplica a los dos)

El trato es **idéntico** sin importar cómo toque una fecha muerta:

| Cómo llega a la fecha muerta | Punto | Resultado |
|---|---|---|
| Clickea un **botón de fecha** ya vencido | 1 | re-manda el menú con fechas vivas |
| Eligió válido → manda **ubicación** después (ya pasó) | 2 | re-manda el menú con fechas vivas |
| Eligió válido → clickea **pase / otro botón** (ya pasó) | 2 | re-manda el menú con fechas vivas |
| Al re-mandar, **no queda ninguna fecha viva** | — | reinicia → **caducidad** |

- El mensaje de **fecha vencida** se vuelve el **cuerpo del menú** re-enviado (sin el preámbulo del nodo): un solo mensaje = aviso + botones.
- La vigencia se mide por un **snapshot** (`flow:datechoice:v1` para la fecha ya elegida; snapshot en la espera para el clic del botón). Inmune a reciclar/borrar el botón.
- Al re-elegir, se re-corre **solo lo posterior** al menú (re-pide ubicación/pase); lo previo (preámbulo/vacante) **no** se re-envía.

---

# Pendientes (NO construidos/ probados esta sesión)

- **Responde a un Broadcast** (3er disparador `al_responder_broadcast`): existe el motor, pero no se cableó/probó aquí.
- **Bloqueado / silenciado que regresa**: comportamiento no definido/ajustado esta sesión.
- **Saludo determinístico al regresar un incompleto**: se evaluó y se **descartó** a propósito (no tocar la extracción de Brenda).
