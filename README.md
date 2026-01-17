# Candidatic IA - BuilderBot Integration

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Oscarjrdz/CandidaticIA)

Aplicación web moderna para gestionar la integración con BuilderBot, incluyendo configuración de webhooks, monitoreo de eventos en tiempo real y pruebas de API.

## 🚀 Características

- ✅ **Gestión de Credenciales**: Configuración segura de Bot ID y API Key
- ✅ **Verificación de Conexión**: Prueba la conexión con BuilderBot
- ✅ **Configuración de Webhooks**: URL dinámica para recibir eventos
- ✅ **Monitor de Eventos**: Visualización en tiempo real de eventos recibidos
- ✅ **Funciones Serverless**: API endpoints desplegados en Vercel
- ✅ **Pruebas Rápidas**: Envío de mensajes de prueba
- ✅ **Dark Mode**: Interfaz moderna con soporte para modo oscuro

## 🛠️ Tecnologías

- **Frontend**: React 19 + Vite
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Backend**: Vercel Serverless Functions
- **Storage**: Vercel KV (Redis) - opcional
- **Deployment**: Vercel

## 📁 Estructura del Proyecto

```
Candidatic_IA/
├── api/                          # Funciones serverless
│   ├── webhook.js               # Endpoint principal para webhooks
│   ├── events.js                # Consulta de eventos almacenados
│   ├── config.js                # Configuración dinámica
│   └── utils/
│       ├── validation.js        # Validaciones de seguridad
│       └── storage.js           # Almacenamiento de eventos
├── src/
│   ├── components/
│   │   ├── CredentialsSection.jsx
│   │   ├── WebhookConfig.jsx
│   │   ├── EventMonitor.jsx
│   │   ├── QuickTest.jsx
│   │   └── ui/                  # Componentes reutilizables
│   ├── services/
│   │   ├── builderbot.js        # Cliente API BuilderBot
│   │   └── webhookService.js    # Cliente API webhooks
│   └── utils/
│       └── storage.js           # LocalStorage helpers
├── vercel.json                  # Configuración de Vercel
├── .env.local                   # Variables de entorno (local)
└── DEPLOYMENT.md                # Guía de deployment

```

## 🏃‍♂️ Inicio Rápido

### Desarrollo Local

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo (solo frontend)
npm run dev

# Ejecutar con Vercel Dev (frontend + API functions)
vercel dev
```

### Deployment a Producción

Ver [DEPLOYMENT.md](./DEPLOYMENT.md) para instrucciones detalladas.

```bash
# Opción 1: Vercel CLI
vercel --prod

# Opción 2: GitHub + Vercel (automático)
git push origin main
```

## 🔧 Configuración

### Variables de Entorno

Crea un archivo `.env.local` con:

```env
WEBHOOK_SECRET=tu-secret-key-aqui
NODE_ENV=development

# Opcional: Vercel KV (se configura automáticamente en Vercel)
# KV_REST_API_URL=
# KV_REST_API_TOKEN=
```

### BuilderBot

1. Obtén tus credenciales en [BuilderBot](https://app.builderbot.cloud)
2. Configura el webhook en BuilderBot con tu URL de Vercel
3. Prueba la conexión desde la aplicación

## 📡 API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/webhook` | POST | Recibe eventos de BuilderBot |
| `/api/events` | GET | Consulta eventos almacenados |
| `/api/config` | GET | Obtiene configuración del webhook |

### Ejemplo de uso:

```bash
# Enviar evento de prueba
curl -X POST https://tu-app.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: tu-secret" \
  -d '{"event":"status.ready","botId":"test"}'

# Obtener eventos
curl https://tu-app.vercel.app/api/events?limit=10
```

## 🎨 Capturas de Pantalla

La aplicación incluye:
- Panel de credenciales con validación en tiempo real
- Monitor de eventos con actualización automática cada 5 segundos
- Configuración de webhook con URL dinámica
- Pruebas rápidas de envío de mensajes

## 🔒 Seguridad

- ✅ Validación de webhook secret
- ✅ Rate limiting (100 req/min por IP)
- ✅ Validación de payloads
- ✅ CORS configurado
- ✅ Variables de entorno seguras

## 📚 Documentación Adicional

- [BuilderBot API Docs](https://docs.builderbot.app)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv)

## 🤝 Contribuir

Este es un proyecto privado para Candidatic. Para sugerencias o mejoras, contacta al equipo de desarrollo.

## 📄 Licencia

Privado - Candidatic © 2024

---

**Desarrollado con ❤️ para Candidatic**
