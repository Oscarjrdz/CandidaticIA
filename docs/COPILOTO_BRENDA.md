# Copiloto Brenda Rodriguez

## Objetivo

Crear un copiloto interno dentro de Candidatic IA llamado Brenda Rodriguez.

La idea no es reemplazar al Bot IA que conversa con candidatos, sino darle a Brenda un segundo modo: asistente operativo interno para el equipo. En esta primera etapa, Brenda ayuda a entender la plataforma, proponer automatizaciones, explicar flujos y diseñar futuras skills sin ejecutar cambios peligrosos.

## Estado Actual Del MVP

Ya se agrego una primera version funcional del copiloto con alcance consultivo.

Archivos creados:

- `src/components/CopilotSection.jsx`
- `src/components/FloatingCopilot.jsx`
- `api/copilot/chat.js`
- `api/copilot/candidate-knowledge.js`
- `api/utils/copilot-candidate-knowledge.js`
- `docs/COPILOTO_BRENDA.md`
- `public/brenda/brenda-reference.jpeg`

Archivos modificados para integrarlo a la app:

- `src/App.jsx`
- `src/components/Sidebar.jsx`
- `src/components/UsersSection.jsx`
- `api/utils/storage.js`

## Que Hace Esta Primera Version

El copiloto permite abrir una nueva seccion en la plataforma llamada `Copiloto Brenda`.

Desde ahi el usuario puede preguntarle a Brenda cosas como:

- Que modulos tiene Candidatic IA.
- Para que sirve cada modulo.
- Que skills conviene crear primero.
- Como disenar una automatizacion.
- Como funciona Brenda dentro del flujo de candidatos.
- Como ordenar tareas de reclutamiento.

Tambien existe una version lite como chat flotante, pensada para que Brenda se sienta como copiloto siempre disponible y no solo como una seccion tradicional.

Brenda responde usando:

- El prompt actual del Bot IA guardado en Redis como `bot_ia_prompt`, cuando existe.
- Un fallback de personalidad si no hay prompt guardado.
- Una base de conocimiento inicial escrita en el endpoint.
- La configuracion de modelo guardada como `bot_ia_model`, con fallback a `gpt-4o-mini`.
- La API key de OpenAI ya soportada por `api/utils/openai.js`.

## Alcance De Seguridad

El MVP esta disenado para no ejecutar acciones con efectos secundarios.

Brenda puede:

- Explicar.
- Proponer.
- Resumir ideas.
- Sugerir skills.
- Ayudar a disenar automatizaciones.
- Dar pasos de uso del sistema.

Brenda no debe afirmar que ya:

- Edito candidatos.
- Mando mensajes.
- Creo reglas.
- Lanzo campanas.
- Modifico vacantes.
- Cambio configuracion.

Si el usuario pide una accion que modifica datos, Brenda debe responder que puede prepararla o proponerla, pero que necesita confirmacion antes de ejecutar.

## Integracion Frontend

### Nueva seccion

Archivo:

`src/components/CopilotSection.jsx`

Responsabilidades:

- Renderiza una interfaz de chat interno.
- Muestra mensaje inicial de Brenda.
- Incluye prompts sugeridos para probar el sistema.
- Envia mensajes al endpoint `/api/copilot/chat`.
- Mantiene historial corto en estado local.
- Muestra estado de carga cuando Brenda esta pensando.
- Muestra errores si OpenAI no esta configurado.

### Chat flotante lite

Archivo:

`src/components/FloatingCopilot.jsx`

Responsabilidades:

- Renderiza un widget flotante global.
- Usa un avatar de Brenda basado en la foto de referencia guardada en `public/brenda/brenda-reference.jpeg`.
- Vive abajo a la izquierda para no chocar con `InternalChat`, que ya usa abajo a la derecha.
- Permite abrir/cerrar un chat compacto.
- Incluye prompts rapidos.
- Usa el mismo endpoint `/api/copilot/chat`.
- Incluye boton para abrir la seccion completa `Copiloto Brenda`.

El componente se monta desde `src/App.jsx` despues de `InternalChat`:

```jsx
<InternalChat onlineUsers={onlineUsers} />
{activeSection !== 'copilot' && (
  <FloatingCopilot onOpenFull={() => setActiveSection('copilot')} />
)}
```

Nota: se oculta cuando el usuario ya esta en la seccion completa para evitar duplicar dos chats de Brenda en pantalla.

### Registro en App

Archivo:

`src/App.jsx`

Cambios principales:

- Se agrego lazy import:

```js
const CopilotSection = lazyWithRetry(() => import('./components/CopilotSection'), 'CopilotSection');
```

- Se agrego titulo para `activeSection === 'copilot'`.
- Se agrego descripcion de top bar.
- Se agrego render condicional:

```jsx
) : activeSection === 'copilot' ? (
  <CopilotSection />
)
```

- Se agrego `copilot` al fallback de permisos.

### Registro en Sidebar

Archivo:

`src/components/Sidebar.jsx`

Cambios principales:

- Se importo `Sparkles` desde `lucide-react`.
- Se agrego item:

```js
{ id: 'copilot', label: 'Copiloto Brenda', icon: Sparkles, position: 'top' }
```

Esto hace que la seccion aparezca en el menu cuando el rol tenga permiso.

### Registro en Usuarios y Permisos

Archivo:

`src/components/UsersSection.jsx`

Se agrego:

```js
{ id: 'copilot', name: 'Copiloto Brenda' }
```

Esto permite administrar el permiso del copiloto desde la seccion de usuarios/roles.

### Permisos Por Defecto

Archivo:

`api/utils/storage.js`

Se agrego `copilot: true` a los roles base:

- SuperAdmin
- Admin
- Recruiter

Nota importante: esto aplica automaticamente cuando se inicializan roles por primera vez. Si en produccion ya existen roles guardados en Redis, puede que haya que activar manualmente el permiso `copilot` desde Usuarios/Roles o hacer una migracion pequena.

## Integracion Backend

### Endpoint

Archivo:

`api/copilot/chat.js`

Ruta:

`POST /api/copilot/chat`

Body esperado:

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
  "model": "gpt-4o-mini"
}
```

Respuesta con error:

```json
{
  "success": false,
  "error": "No pude responder como copiloto en este momento.",
  "detail": "Detalle tecnico"
}
```

### Funcionamiento Interno

El endpoint:

1. Valida que el metodo sea `POST`.
2. Lee `message` e `history`.
3. Normaliza el historial para evitar contexto excesivo.
4. Lee Redis:
   - `bot_ia_prompt`
   - `bot_ia_model`
5. Construye un system prompt interno para Brenda.
6. Agrega conocimiento base de Candidatic IA.
7. Llama a `getOpenAIResponse`.
8. Devuelve la respuesta al frontend.

### Base De Conocimiento Inicial

La constante `SYSTEM_KNOWLEDGE` dentro de `api/copilot/chat.js` describe los modulos actuales:

- Candidatos
- Chat Web
- Envios Masivos
- Estadisticas de Ads
- Bot IA
- Automatizaciones
- Vacantes
- Bolsa de Empleo
- ByPass
- Proyectos
- Post Maker
- Usuarios
- Settings

Tambien declara capacidades tecnicas:

- OpenAI configurable.
- Redis.
- Endpoints serverless.
- Webhooks WhatsApp/UltraMsg y Messenger.
- Extraccion inteligente.
- Recordatorios.
- Reactivacion.
- Procesos cron.

## Personalidad De Brenda

El endpoint intenta usar primero el prompt real guardado para Brenda en Redis:

`bot_ia_prompt`

Si no existe, usa este fallback:

```txt
Brenda Rodriguez es una asistente de reclutamiento calida, clara, profesional y practica.
Habla en espanol natural, con tono humano, directo y servicial.
Evita sonar robotica, exagerada o demasiado tecnica.
Prioriza ayudar al equipo a avanzar con orden, criterio y buena comunicacion.
```

Recomendacion futura: separar personalidad de Brenda para candidatos y personalidad de Brenda copiloto. Hoy el copiloto reutiliza el prompt del Bot IA como referencia, pero a largo plazo conviene tener una llave propia:

`copilot_brenda_prompt`

## Validaciones Realizadas

Se ejecuto build:

```bash
npm run build
```

Resultado:

- Build exitoso.
- Se genero chunk de `CopilotSection`.

Se valido sintaxis backend:

```bash
node --check api/copilot/chat.js
```

Resultado:

- Sin errores de sintaxis.

Se ejecuto lint aislado de archivos nuevos:

```bash
npx eslint src/components/CopilotSection.jsx api/copilot/chat.js
```

Resultado:

- Sin errores.

Nota: `npm run lint` global falla por deuda previa del repositorio en muchos archivos no relacionados con este cambio. No se corrigio para evitar mezclar refactors con el MVP del copiloto.

## Pendientes Tecnicos

### 1. Probar En Navegador

Se intento levantar Vite con:

```bash
npm run dev -- --host 127.0.0.1
```

El sandbox bloqueo el puerto con:

```txt
listen EPERM: operation not permitted 127.0.0.1:5173
```

Se pidio permiso para levantar el servidor fuera del sandbox, pero fue rechazado/interrumpido. Por eso falta prueba visual en navegador.

### 2. Permisos En Produccion

Si los roles ya existen en Redis, revisar que tengan:

```js
copilot: true
```

Si no aparece el menu, ir a Usuarios/Roles y activar `Copiloto Brenda` para el rol correspondiente.

### 3. Persistencia De Conversaciones

Actualmente el historial vive solo en memoria del componente React. Al cambiar de modulo o refrescar, se pierde.

Opciones futuras:

- Guardar conversaciones por usuario en Redis.
- Crear endpoint `/api/copilot/history`.
- Permitir borrar historial.
- Permitir fijar conversaciones utiles.

### 4. Skills Reales

Esta version solo conversa. El siguiente gran paso es crear un registro de skills.

Propuesta de archivos futuros:

- `api/copilot/skills.js`
- `api/utils/copilot-skill-registry.js`
- `api/utils/copilot-skill-runner.js`
- `api/copilot/runs.js`

Estructura sugerida de una skill:

```js
{
  id: 'summarize_candidate',
  name: 'Resumir candidato',
  description: 'Resume datos, historial y siguiente accion sugerida.',
  permission: 'copilot',
  mode: 'read',
  requiresConfirmation: false,
  inputSchema: {
    candidateId: 'string'
  },
  run: async ({ candidateId, user }) => {
    // Leer candidato, mensajes y devolver resumen
  }
}
```

Tipos de skill recomendados:

- `read`: solo consulta.
- `draft`: prepara una accion sin ejecutarla.
- `write`: modifica datos, siempre con confirmacion.
- `send`: manda mensajes, siempre con confirmacion.

### 5. Confirmaciones

Antes de permitir acciones, agregar flujo:

1. Brenda detecta intencion.
2. Prepara plan.
3. Muestra preview.
4. Usuario confirma.
5. Backend ejecuta.
6. Se guarda log.

Ejemplo:

```txt
Usuario: Crea una regla para extraer disponibilidad.
Brenda: Puedo crear esta regla:
- Campo: disponibilidad
- Prompt: Extrae disponibilidad horaria...
¿Confirmas?
```

### 6. Logs Y Auditoria

Para confianza operativa, cada ejecucion futura debe guardar:

- Usuario que pidio la accion.
- Skill ejecutada.
- Input.
- Resultado.
- Timestamp.
- Si requirio confirmacion.
- Estado: success/error.

Llave sugerida en Redis:

`copilot:runs`

## Roadmap Recomendado

### Fase 1: Copiloto Informativo

Estado: iniciado.

Incluye:

- UI de chat.
- Endpoint.
- Personalidad de Brenda.
- Conocimiento general del sistema.
- Sin acciones de escritura.

### Fase 2: Lectura De Datos Reales

Crear skills de solo lectura:

- Resumir candidato.
- Revisar datos faltantes.
- Explicar historial de conversacion.
- Resumir vacante.
- Revisar automatizaciones existentes.
- Generar reporte diario.

Estas skills no requieren confirmacion porque no modifican datos.

### Fase 3: Borradores

Crear skills que preparen contenido:

- Redactar mensaje de seguimiento.
- Generar post para vacante.
- Proponer FAQ.
- Proponer regla de automatizacion.
- Proponer criterios de busqueda.

No ejecutan nada. Solo devuelven preview.

### Fase 4: Acciones Con Confirmacion

Permitir acciones reales:

- Crear regla de automatizacion.
- Editar campo de candidato.
- Crear recordatorio.
- Agregar candidato a proyecto.
- Programar reactivacion.

Siempre con confirmacion humana.

### Fase 5: Automatizaciones Proactivas

Brenda puede sugerir tareas sin que el usuario pregunte:

- "Hay 18 candidatos sin municipio."
- "Esta vacante no tiene FAQ."
- "Hay 6 candidatos calientes sin seguimiento."
- "Tu campana genero candidatos pero faltan respuestas."

## Primeras Skills Recomendadas

### 1. `candidate_knowledge`

Estado: implementada como primera skill real de lectura.

Objetivo:

Permitir que Brenda responda preguntas sobre la base de candidatos con datos reales agregados.

Ejemplos de preguntas:

- "Brenda, cuantos candidatos nuevos hubo hoy?"
- "Cuantos candidatos nuevos hubo ayer?"
- "Que dia hemos tenido mas candidatos nuevos?"
- "Como viene la tendencia de candidatos esta semana?"
- "De donde vienen mas candidatos?"
- "Que municipios aparecen mas?"
- "Cuantos perfiles completos e incompletos hay?"

Archivos:

- `api/utils/copilot-candidate-knowledge.js`
- `api/copilot/candidate-knowledge.js`
- Integracion en `api/copilot/chat.js`

Datos que calcula:

- Total de candidatos.
- Candidatos nuevos hoy.
- Candidatos nuevos ayer.
- Mejor dia historico por candidatos nuevos.
- Serie de ultimos 7 dias.
- Serie de ultimos 30 dias.
- Promedio diario de ultimos 7 y 30 dias.
- Distribucion por origen.
- Distribucion por categoria.
- Distribucion por municipio.
- Distribucion por escolaridad.
- Distribucion por genero.
- Distribucion por estado completo/pendiente.
- Distribucion por dia de semana.

Reglas de seguridad:

- No expone telefonos.
- No expone datos personales individuales.
- Solo devuelve analitica agregada.
- Usa zona horaria `America/Monterrey`.
- Usa fecha de creacion desde `primerContacto`, luego `createdAt`, luego `fecha`, luego `ultimoMensaje`, y como respaldo timestamp dentro del id `cand_...`.

Endpoint de diagnostico:

```bash
GET /api/copilot/candidate-knowledge
```

Devuelve el snapshot agregado.

Endpoint para pregunta directa:

```bash
POST /api/copilot/candidate-knowledge
```

Body:

```json
{
  "message": "Cuantos candidatos nuevos hubo hoy y ayer?"
}
```

Respuesta:

```json
{
  "success": true,
  "skill": "candidate_knowledge",
  "reply": "Respuesta de Brenda",
  "snapshot": {}
}
```

### 2. `system_overview`

Explica modulos, permisos y flujos.

Prioridad: alta.

Riesgo: bajo.

### 3. `candidate_summary`

Resume un candidato usando perfil e historial.

Prioridad: alta.

Riesgo: bajo.

### 4. `missing_data_report`

Detecta campos faltantes en candidatos.

Prioridad: alta.

Riesgo: bajo.

### 5. `draft_followup_message`

Genera mensaje sugerido para seguimiento o reactivacion.

Prioridad: alta.

Riesgo: medio si luego se automatiza envio.

### 6. `automation_rule_drafter`

Propone una regla de extraccion inteligente.

Prioridad: media-alta.

Riesgo: bajo mientras sea borrador.

### 7. `vacancy_assistant`

Revisa vacante y propone FAQ, copy y criterios.

Prioridad: media.

Riesgo: bajo.

## Consideraciones Para Antigravity

Cuando se retome este trabajo en Antigravity, revisar primero:

1. Que el repo tenga estos archivos:
   - `src/components/CopilotSection.jsx`
   - `api/copilot/chat.js`
2. Que `src/App.jsx` registre `CopilotSection`.
3. Que `src/components/Sidebar.jsx` tenga el menu `copilot`.
4. Que los roles incluyan permiso `copilot`.
5. Que OpenAI este configurado en Settings o en variable `OPENAI_API_KEY`.
6. Que Redis este disponible.

Orden sugerido para continuar:

1. Probar visualmente la seccion.
2. Activar permiso `copilot` en roles existentes.
3. Crear endpoint de `GET /api/copilot/context` para mostrar estado del sistema.
4. Crear skill registry.
5. Implementar primera skill real de lectura: `system_overview`.
6. Implementar segunda skill: `candidate_summary`.

## Notas De Producto

Brenda como copiloto debe sentirse como una companera operativa:

- Clara.
- Practica.
- Con criterio.
- Cuidada con datos sensibles.
- Honesta cuando no sabe algo.
- Proactiva para convertir ideas en flujos.

La vision es que Brenda pueda pasar de "responder preguntas" a "ayudar a operar reclutamiento", pero de forma gradual y segura.
