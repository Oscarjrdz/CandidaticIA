# Parámetro `{{texto ultimo boton}}` (texto del último botón clicado)

Token de plantilla que se sustituye por el **título literal del último botón / opción de lista
interactiva que clicó el candidato** (ej. su horario de cita elegido). Sirve para responder de
forma personalizada: *"Perfecto Oscar, tu cita será el MIÉRCOLES 30 de Septiembre a las 9:00"*.

Creado 2026-09-29. Es **independiente** de la "frase dinámica" — no la toca ni la reemplaza.

---

## Cómo se usa

Escribe `{{texto ultimo boton}}` **dondequiera que se resuelvan variables** (lo hace
`substituteVariables()`):

- **Banco de respuestas** del Chat Web (mensaje, caption de PDF, o el campo "frase dinámica").
- **Envíos masivos**.
- **Flujos** (nodos "Mandar WhatsApp" / "WhatsApp Personalizado", y respuestas del banco disparadas
  desde un nodo).
- **Recordatorios** (plantillas de la campanita).

Es **tolerante** a mayúsculas, acentos, guion bajo y espacios extra:
`{{texto ultimo boton}}`, `{{Texto_Último_Botón}}`, `{{TEXTO ULTIMO BOTON}}`, `{{ texto  ultimo  boton }}`
— todos valen. Si el candidato **nunca** ha clicado un botón, el token se sustituye por **cadena
vacía** (nunca sale el literal `{{...}}`).

### Dos formas equivalentes

1. **Directo en el mensaje:**
   `Perfecto {{nombre}}, tu cita será el {{texto ultimo boton}}`

2. **Vía el campo "frase dinámica"** (el mensaje se queda genérico, el campo lo llena):
   - Mensaje: `Tenemos proceso de entrevista {{frase dinamica}}. Te espero.`
   - Campo frase dinámica: `*{{TEXTO ULTIMO BOTON}} de la mañana*`
   - Sale: `Tenemos proceso de entrevista *MIÉRCOLES 30 de Septiembre a las 9:00 de la mañana*. Te espero.`

---

## Cómo funciona por dentro

1. **Captura (webhook).** Cuando entra un mensaje interactivo (clic en botón o fila de lista), el
   webhook ya guardaba su título como `content` del mensaje (con la bandera `interactiveReply: true`).
   Ahora, además, guarda ese título en el candidato: `candidate.ultimoBotonTexto`.
   - Solo se sobreescribe con un **clic real**; el texto escrito a mano nunca lo pisa.
   - Es siempre el **último** clic: si el candidato clica horario A y luego B, queda B. Si después
     clica un botón de otro menú (ej. "Sí"/"No"), el token pasa a valer "Sí". → **Manda la respuesta
     con el token justo después del clic que te interesa.**
   - Es un string corto → no afecta el peso de la lista de candidatos, y solo escribe en clics (raros).
   - Ubicación: `api/whatsapp/webhook.js` (bloque `updatedCandidate`, condicionado a `isInteractiveReply`).

2. **Resolución (`substituteVariables`).** `api/utils/shortcuts.js` normaliza la llave del token
   (minúsculas, sin acentos, colapsa espacios/guiones bajos) y si es `texto ultimo boton` devuelve
   `candidate.ultimoBotonTexto || ''`. Como esta función corre en **todas** las vías de envío (front
   y back), el token funciona en todas automáticamente.

3. **El campo "frase dinámica" también resuelve tokens.** Antes su valor se insertaba **literal** en
   el hueco `{{frase dinamica}}`. Ahora ese valor también pasa por `substituteVariables()` antes de
   insertarse, así puede contener `{{texto ultimo boton}}` (o `{{nombre}}`, etc.). Cubierto en las 6
   vías: 3 en `src/components/ChatSection.jsx` (documento, inyección al input, envío directo) y 3 en
   `api/utils/flow-engine.js` (`opts._dynamicPhrase`, para consistencia en flujos).

---

## Archivos tocados

| Archivo | Cambio |
|---------|--------|
| `api/whatsapp/webhook.js` | Guarda `candidate.ultimoBotonTexto` al recibir un clic interactivo. |
| `api/utils/shortcuts.js` | `substituteVariables()` resuelve `{{texto ultimo boton}}` (tolerante). |
| `src/components/ChatSection.jsx` | Pista del token en el formulario del banco + el campo frase dinámica resuelve tokens (3 vías). |
| `api/utils/flow-engine.js` | El campo frase dinámica resuelve tokens también en flujos (3 vías). |

Commits: `921f199a` (token + captura), `5ba1f043` (frase dinámica resuelve tokens).

---

## Verificado

- Prueba contra **Redis real** (candidato desechable): guardado/lectura de `ultimoBotonTexto` con
  acentos intactos, inyección end-to-end, y sobreescritura al último clic.
- Prueba de la lógica del campo frase dinámica con el caso real de producción (mensaje +
  `*{{TEXTO ULTIMO BOTON}} de la mañana*`).
- `node --check`, `npm run build`, `eslint` limpios.

Relacionado: [nodo-botones-interactivos.md](./nodo-botones-interactivos.md) (de dónde salen los clics),
[motor-flujos-ruteo-menus.md](./motor-flujos-ruteo-menus.md) (cómo se rutean).
