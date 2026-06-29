# IA Copiloto Brenda

## Objetivo

Crear una asistente interna dentro de Candidatic IA llamada Brenda Copiloto.

Esta Brenda no reemplaza al Bot IA que conversa con candidatos. Su funcion es ayudar al equipo interno con dudas, tips, prompts, skills, ideas de automatizacion y mejoras operativas dentro de Candidatic.

## Deploy De Produccion

Nombre sugerido del commit/deploy visible en Vercel:

```txt
IA Copiloto Brenda SuperAdmin
```

Este nombre describe el alcance actual:

- Nueva seccion `IA Copiloto`.
- Chat flotante global de Brenda.
- Acceso limitado a `SuperAdmin`.
- MVP consultivo sin acciones de escritura.

## Estado Actual

Implementado para produccion como MVP seguro y ligero.

Archivos creados:

- `src/components/IACopilotoSection.jsx`
- `src/components/FloatingCopilot.jsx`
- `api/copilot/chat.js`

Archivos modificados:

- `src/App.jsx`
- `src/components/Sidebar.jsx`
- `docs/COPILOTO_BRENDA.md`

## Experiencia De Usuario

### Seccion IA Copiloto

Ruta interna por estado React:

```txt
activeSection === 'ia-copiloto'
```

La seccion aparece en el sidebar como:

```txt
IA Copiloto
```

Por ahora es un espacio base para prompts, skills y configuracion futura. La interaccion principal no vive ahi; vive en el chat flotante para que Brenda pueda acompanarte desde cualquier modulo.

### Chat Flotante

Archivo:

```txt
src/components/FloatingCopilot.jsx
```

Responsabilidades:

- Mostrar un boton flotante de Brenda abajo a la izquierda.
- Abrir/cerrar un chat compacto.
- Permitir preguntas desde cualquier modulo.
- Incluir prompts rapidos.
- Enviar mensajes a `/api/copilot/chat`.
- Mostrar consumo de tokens de la ultima respuesta cuando OpenAI lo devuelve.
- Mantener historial corto solo en memoria del navegador.

El chat se monta en `src/App.jsx` despues de `InternalChat`:

```jsx
{user?.role === 'SuperAdmin' && (
  <FloatingCopilot onOpenSection={() => setActiveSection('ia-copiloto')} />
)}
```

## Seguridad

El MVP esta bloqueado a SuperAdmin en dos capas.

### Frontend

En `src/App.jsx`:

```jsx
{user?.role === 'SuperAdmin' && (
  <FloatingCopilot onOpenSection={() => setActiveSection('ia-copiloto')} />
)}
```

En `src/components/Sidebar.jsx`:

```js
{ id: 'ia-copiloto', label: 'IA Copiloto', icon: Sparkles, position: 'top', superAdminOnly: true }
```

El filtro del menu oculta items `superAdminOnly` si el rol no es `SuperAdmin`.

### Backend

En `api/copilot/chat.js`:

1. Valida `sessionToken` con `validateAdminSession`.
2. Busca al usuario real con `getUsers`.
3. Rechaza si el usuario no existe o no tiene rol `SuperAdmin`.
4. Solo despues llama a OpenAI.

Esto evita gasto de tokens si alguien intenta llamar el endpoint sin permiso.

## Control De Tokens Y Ancho De Banda

El endpoint fue disenado para ser barato desde el primer deploy.

Limites actuales:

```js
const MAX_INPUT_CHARS = 900;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2400;
const MAX_REPLY_TOKENS = 360;
```

Decisiones de ahorro:

- Usa `gpt-4o-mini`.
- No manda candidatos, vacantes, mensajes, archivos ni datos pesados.
- No hace consultas de contexto real en esta fase.
- El frontend limita la entrada a 900 caracteres.
- El frontend manda historial compacto.
- El backend vuelve a recortar todo aunque el frontend sea manipulado.
- La respuesta se recorta antes de volver al cliente.
- No hay streaming, imagenes ni adjuntos.

Esto cuida:

- Tokens de entrada.
- Tokens de salida.
- Payload entre navegador y API.
- Payload entre API y OpenAI.
- Riesgo de exponer datos sensibles.

## Alcance Actual De Brenda

Brenda puede:

- Resolver dudas de uso general de Candidatic.
- Dar tips de reclutamiento.
- Ayudar a redactar mensajes.
- Proponer prompts.
- Sugerir skills.
- Sugerir automatizaciones.
- Explicar ideas o flujos.
- Preparar planes de accion.

Brenda no debe afirmar que ya:

- Edito candidatos.
- Mando mensajes.
- Creo reglas.
- Lanzo campanas.
- Modifico vacantes.
- Cambio configuracion.
- Consulto datos reales que no se le enviaron.

Si el usuario pide una accion con efecto en datos, Brenda debe preparar una propuesta y pedir confirmacion. En este MVP no ejecuta acciones.

## Backend

Endpoint:

```txt
POST /api/copilot/chat
```

Headers:

```txt
Authorization: Bearer <sessionToken>
Content-Type: application/json
```

Body:

```json
{
  "message": "Pregunta del usuario",
  "history": [
    {
      "role": "assistant",
      "content": "Mensaje anterior"
    },
    {
      "role": "user",
      "content": "Mensaje anterior"
    }
  ]
}
```

Respuesta exitosa:

```json
{
  "success": true,
  "reply": "Respuesta de Brenda",
  "model": "gpt-4o-mini",
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

Respuesta sin permiso:

```json
{
  "success": false,
  "error": "Solo SuperAdmin puede usar Brenda Copiloto"
}
```

## Validaciones Realizadas

Build de produccion:

```bash
npm run build
```

Resultado:

- Exitoso.
- Genera chunk de `IACopilotoSection`.
- Incluye el chat flotante dentro del bundle principal.

Lint focalizado:

```bash
npx eslint api/copilot/chat.js src/components/IACopilotoSection.jsx src/components/FloatingCopilot.jsx
```

Resultado:

- Sin errores.

Nota:

`npm run lint` global sigue fallando por deuda previa del repositorio en archivos no relacionados con este cambio. No se corrigio para no mezclar refactors con el MVP del copiloto.

## Requisitos En Produccion

Para que responda en produccion debe existir una API key de OpenAI disponible por una de estas vias:

- Variable de entorno `OPENAI_API_KEY`.
- Configuracion guardada en Redis desde Settings > GPT (`ai_config.openaiApiKey`).

Si no existe API key, el chat aparece pero el endpoint respondera error de conexion con OpenAI.

## Roadmap

### Fase 1: MVP Consultivo

Estado: implementado.

- Seccion `IA Copiloto`.
- Chat flotante.
- Endpoint seguro.
- Solo SuperAdmin.
- Sin lectura de datos reales.
- Sin acciones de escritura.
- Limites estrictos de tokens y payload.

### Fase 2: Prompts Y Skills

Guardar en la seccion `IA Copiloto`:

- Prompts base.
- Skills disponibles.
- Instrucciones por modulo.
- Plantillas de respuesta.

### Fase 3: Lectura Ligera De Datos

Agregar skills read-only con respuestas agregadas:

- Resumen de candidatos sin datos personales.
- Vacantes activas.
- Automatizaciones existentes.
- FAQs pendientes.
- Reportes diarios.

Regla: no enviar grandes listas al modelo. Calcular resumen en backend y mandar solo agregados.

### Fase 4: Borradores

Brenda prepara propuestas sin ejecutar:

- Mensajes de seguimiento.
- FAQs.
- Automatizaciones.
- Prompts del Bot IA.
- Descripciones de vacantes.

### Fase 5: Acciones Con Confirmacion

Permitir acciones reales solo con confirmacion humana:

- Crear automatizacion.
- Crear recordatorio.
- Actualizar vacante.
- Agregar nota.
- Preparar envio masivo.

Cada accion debe guardar auditoria:

- Usuario.
- Skill.
- Input.
- Preview.
- Confirmacion.
- Resultado.
- Timestamp.

## Notas De Implementacion

- No se agrego permiso editable para Admin o Recruiter.
- No se modificaron roles base en Redis.
- No se agrego `IA Copiloto` a Usuarios/Roles.
- El bloqueo principal es por rol `SuperAdmin`, no por permiso configurable.
- El historial del chat vive en memoria local del componente y se pierde al refrescar.
- El avatar usa `public/brenda/brenda-avatar.jpeg`.
