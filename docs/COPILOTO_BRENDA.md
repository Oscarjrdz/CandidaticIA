# Brenda IA

## Objetivo

Crear una asistente interna dentro de Candidatic IA llamada Brenda IA.

Esta Brenda no reemplaza al Bot IA que conversa con candidatos. Su funcion es ayudar al equipo interno con dudas, busqueda web, prompts, skills, ideas de automatizacion y mejoras operativas dentro de Candidatic.

## Deploy De Produccion

Nombre sugerido del commit/deploy visible en Vercel:

```txt
Brenda IA Web Skills SuperAdmin
```

Este nombre describe el alcance actual:

- Nueva seccion `Brenda IA`.
- Chat flotante global de Brenda IA.
- Acceso limitado a `SuperAdmin`.
- Primeras skills: contexto de pantalla, hora real de Monterrey y busqueda web con comando.

## Estado Actual

Implementado para produccion con alcance seguro, controlado y optimizado para tokens.

Archivos creados:

- `src/components/IACopilotoSection.jsx`
- `src/components/FloatingCopilot.jsx`
- `api/copilot/chat.js`

Archivos modificados:

- `src/App.jsx`
- `src/components/Sidebar.jsx`
- `docs/COPILOTO_BRENDA.md`

## Experiencia De Usuario

### Seccion Brenda IA

Ruta interna por estado React:

```txt
activeSection === 'ia-copiloto'
```

La seccion aparece en el sidebar como:

```txt
Brenda IA
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
- Enviar mensajes a `/api/copilot/chat`.
- Mostrar consumo de tokens de la ultima respuesta cuando OpenAI lo devuelve.
- Mantener historial corto solo en memoria del navegador.
- Saludar de forma personalizada solo cuando tiene sentido.

El chat se monta en `src/App.jsx` despues de `InternalChat`:

```jsx
{user?.role === 'SuperAdmin' && (
  <FloatingCopilot activeSection={activeSection} onOpenSection={() => setActiveSection('ia-copiloto')} />
)}
```

### Saludo Personalizado

El saludo inicial es deterministico y no consume GPT.

Ejemplo:

```txt
Hola Oscar, buenos dias. Estoy en Candidatos.
```

Reglas:

- Usa el primer nombre del usuario autenticado.
- Calcula buenos dias/tardes/noches con hora real de `America/Monterrey`.
- Incluye la seccion actual.
- Guarda el ultimo saludo por usuario en `localStorage`.
- No vuelve a saludar si el chat se cierra y abre dentro de 15 minutos.
- Si ya hay mensajes en el chat, no inserta otro saludo.

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
{ id: 'ia-copiloto', label: 'Brenda IA', icon: Sparkles, position: 'top', superAdminOnly: true }
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
- Resuelve hora y ubicacion de pantalla sin llamar GPT.
- La busqueda web solo se activa por comando o por intencion clara.
- La busqueda web manda solo resultados compactos al modelo.
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
- Ayudar a redactar mensajes.
- Proponer prompts.
- Sugerir skills.
- Sugerir automatizaciones.
- Explicar ideas o flujos.
- Preparar planes de accion.
- Saber en que seccion de Candidatic estas.
- Saber la hora real de Monterrey.
- Buscar en internet cuando se lo pides.

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
  "error": "Solo SuperAdmin puede usar Brenda IA"
}
```

## Skills Actuales

### 1. Contexto De Pantalla

No consume GPT cuando la pregunta es directa.

Ejemplos:

```txt
Donde estoy?
En que modulo estoy?
```

Respuesta:

```txt
Estas en Chat Web.
```

### 2. Hora Real De Monterrey

No consume GPT cuando la pregunta es directa.

Ejemplos:

```txt
Que hora es?
Que hora real es en Monterrey?
```

Respuesta:

```txt
En Monterrey es lunes, 29 de junio de 2026, 10:42 a.m.
```

### 3. Busqueda Web

Comando recomendado:

```txt
Oye Brenda <lo que quieres buscar>
```

Ejemplos:

```txt
Oye Brenda busca el salario promedio de almacenista en Monterrey
Oye Brenda que noticias hay de la NOM laboral
Oye Brenda clima de Monterrey manana
```

Funcionamiento:

- El comando `Oye Brenda` fuerza la busqueda web.
- Tambien existe deteccion automatica para temas que cambian, como clima, precios, noticias o leyes.
- Usa `api/utils/web-search.js`.
- Lee `SERPER_API_KEY` o `ai_config.serperApiKey`.
- Limita resultados a 3 para controlar tokens.
- Si no hay API key de busqueda, responde sin llamar OpenAI.

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

### Fase 1: Brenda IA Interna

Estado: implementado.

- Seccion `Brenda IA`.
- Chat flotante.
- Endpoint seguro.
- Solo SuperAdmin.
- Contexto de pantalla.
- Hora real de Monterrey.
- Busqueda web por comando `Oye Brenda`.
- Sin acciones de escritura.
- Limites estrictos de tokens y payload.

### Fase 2: Prompts Y Skills

Guardar en la seccion `Brenda IA`:

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
- No se agrego `Brenda IA` a Usuarios/Roles.
- El bloqueo principal es por rol `SuperAdmin`, no por permiso configurable.
- El historial del chat vive en memoria local del componente y se pierde al refrescar.
- El avatar usa `public/brenda/brenda-avatar.jpeg`.
