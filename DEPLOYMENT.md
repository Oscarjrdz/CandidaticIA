# Guía de Deployment - Candidatic Webhook Integration

Esta guía te llevará paso a paso para desplegar tu aplicación en Vercel con funciones serverless para recibir webhooks de BuilderBot.

---

## 📋 Pre-requisitos

- ✅ Cuenta en [Vercel](https://vercel.com) (gratis)
- ✅ Node.js instalado (v18 o superior)
- ✅ Git configurado
- ✅ Cuenta de BuilderBot activa

---

## 🚀 Opción 1: Deployment Rápido (Recomendado)

### 1. Conectar con GitHub

```bash
# Si aún no has inicializado git
cd /Users/oscar/Candidatic_IA
git init
git add .
git commit -m "Initial commit with Vercel serverless functions"

# Crear repositorio en GitHub y conectar
git remote add origin https://github.com/TU_USUARIO/candidatic-ia.git
git push -u origin main
```

### 2. Desplegar en Vercel

1. Ve a [vercel.com](https://vercel.com) e inicia sesión
2. Click en **"Add New Project"**
3. Importa tu repositorio de GitHub
4. Vercel detectará automáticamente que es un proyecto Vite
5. Click en **"Deploy"**

¡Listo! Tu aplicación estará en línea en ~2 minutos.

---

## 🛠️ Opción 2: Deployment con Vercel CLI

### 1. Instalar Vercel CLI

```bash
npm install -g vercel
```

### 2. Login en Vercel

```bash
vercel login
```

### 3. Desplegar

```bash
cd /Users/oscar/Candidatic_IA

# Primera vez (desarrollo)
vercel

# Producción
vercel --prod
```

La CLI te guiará por el proceso y te dará una URL al finalizar.

---

## ⚙️ Configuración de Variables de Entorno

### En Vercel Dashboard:

1. Ve a tu proyecto en Vercel
2. Click en **"Settings"** → **"Environment Variables"**
3. Agrega las siguientes variables:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `WEBHOOK_SECRET` | `candidatic-webhook-secret-2024` | Secret para validar webhooks |
| `NODE_ENV` | `production` | Ambiente de producción |

### (Opcional) Configurar Vercel KV para persistencia:

1. En tu proyecto Vercel, ve a **"Storage"** → **"Create Database"**
2. Selecciona **"KV (Redis)"**
3. Crea el store (gratis hasta 256MB)
4. Vercel agregará automáticamente las variables:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

---

## 🧪 Testing Local con Vercel Dev

Para probar las funciones serverless localmente:

```bash
# Instalar dependencias si no lo has hecho
npm install

# Ejecutar con Vercel Dev (simula el ambiente de producción)
vercel dev
```

Esto iniciará el servidor en `http://localhost:3000`

### Probar el webhook localmente:

```bash
# En otra terminal, envía un evento de prueba
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: candidatic-webhook-secret-2024" \
  -d '{
    "event": "status.ready",
    "timestamp": "2024-01-16T12:00:00Z",
    "botId": "test-bot-id",
    "status": "ready"
  }'
```

Deberías ver una respuesta exitosa y el evento aparecerá en el monitor.

---

## 🔗 Configurar Webhook en BuilderBot

Una vez desplegado:

### 1. Obtener tu URL de Webhook

Tu URL será algo como:
```
https://tu-proyecto.vercel.app/api/webhook
```

### 2. Configurar en BuilderBot

1. Inicia sesión en [BuilderBot](https://app.builderbot.cloud)
2. Ve a tu bot → **Configuración** → **Webhooks**
3. Pega la URL: `https://tu-proyecto.vercel.app/api/webhook`
4. (Opcional) Agrega header personalizado:
   - Key: `x-webhook-secret`
   - Value: `candidatic-webhook-secret-2024`
5. Guarda los cambios

### 3. Probar la Conexión

1. En BuilderBot, envía un evento de prueba
2. Ve a tu aplicación → **Monitor de Eventos**
3. Deberías ver el evento aparecer en tiempo real

---

## 📊 Monitoreo y Logs

### Ver logs en Vercel:

1. Ve a tu proyecto en Vercel
2. Click en **"Deployments"**
3. Click en el deployment activo
4. Ve a **"Functions"** para ver logs de las serverless functions

### Logs en tiempo real:

```bash
vercel logs --follow
```

---

## 🔄 Actualizaciones Automáticas

Con GitHub conectado:

1. Haz cambios en tu código
2. Commit y push:
   ```bash
   git add .
   git commit -m "Actualización de funcionalidad"
   git push
   ```
3. Vercel desplegará automáticamente

---

## 🛠 Troubleshooting BuilderBot Cloud

Si los mensajes no llegan a tu aplicación:

### 1. Verificar URL del Webhook
Asegúrate de que la URL en BuilderBot Cloud sea exactamente:
`https://candidatic-ia.vercel.app/api/webhook`
- Sin espacios al final
- Con `https://`
- Sin barras duplicadas al final

### 2. Probar conectividad con Webhook.site
1. Ve a [Webhook.site](https://webhook.site)
2. Copia la URL temporal que te dan.
3. Ponla en BuilderBot Cloud.
4. Envía un mensaje a tu bot.
5. Si llega a Webhook.site, BuilderBot funciona bien. El problema podría ser la conexión con Vercel.

### 3. Revisar Configuración en Vercel
- Asegúrate de que las variables de entorno están configuradas (Redis).
- Revisa los logs en tiempo real en el dashboard de Vercel cuando envíes un mensaje.

### 4. Estructura del Payload
BuilderBot Cloud v6 usa esta estructura:
```json
{
  "eventName": "message.incoming",
  "data": {
    "from": "521...",
    "body": "Mensaje...",
    "name": "Usuario"
  }
}
```
Nuestra aplicación ya está configurada para manejar este formato automáticamente.

## 🐛 Troubleshooting

### Problema: "Webhook no recibe eventos"

**Solución:**
- Verifica que la URL en BuilderBot sea correcta
- Revisa los logs en Vercel para ver si llegan peticiones
- Confirma que el secret coincida

### Problema: "Error 401 Unauthorized"

**Solución:**
- Verifica que el header `x-webhook-secret` esté configurado
- Confirma que el valor coincida con la variable de entorno

### Problema: "Eventos no se guardan"

**Solución:**
- Si no configuraste Vercel KV, los eventos se guardan en memoria (se pierden al reiniciar)
- Para persistencia, configura Vercel KV como se explicó arriba

### Problema: "CORS errors en desarrollo"

**Solución:**
- Usa `vercel dev` en lugar de `npm run dev` para probar las API functions
- Las funciones serverless solo funcionan con Vercel Dev o en producción

---

## 📱 URLs Importantes

Después del deployment, tendrás:

| Endpoint | URL | Descripción |
|----------|-----|-------------|
| **App** | `https://tu-proyecto.vercel.app` | Tu aplicación web |
| **Webhook** | `https://tu-proyecto.vercel.app/api/webhook` | Endpoint para BuilderBot |
| **Events** | `https://tu-proyecto.vercel.app/api/events` | Consultar eventos |
| **Config** | `https://tu-proyecto.vercel.app/api/config` | Obtener configuración |

---

## ✅ Checklist Post-Deployment

- [ ] Aplicación desplegada exitosamente
- [ ] Variables de entorno configuradas
- [ ] Webhook configurado en BuilderBot
- [ ] Evento de prueba recibido correctamente
- [ ] Monitor de eventos mostrando datos reales
- [ ] (Opcional) Vercel KV configurado para persistencia

---

## 🎉 ¡Listo!

Tu aplicación está ahora en producción y lista para recibir webhooks de BuilderBot en tiempo real.

Para cualquier duda, revisa:
- [Documentación de Vercel](https://vercel.com/docs)
- [Documentación de BuilderBot](https://docs.builderbot.app)
