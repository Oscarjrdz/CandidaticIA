# Candidatic IA - UltraMsg Integration

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Oscarjrdz/CandidaticIA)

Aplicación web moderna para gestionar la integración con UltraMsg (WhatsApp), incluyendo gestión de candidatos, automatizaciones, monitoreo de eventos en tiempo real y pruebas de API.

## 🚀 Características

- ✅ **Gestión de Credenciales**: Configuración segura de Instance ID y Token de UltraMsg
- ✅ **Verificación de Conexión**: Prueba la conexión con UltraMsg en tiempo real
- ✅ **Gestión de Candidatos**: Panel centralizado para interactuar con candidatos vía WhatsApp
- ✅ **Automatizaciones**: Reglas de respuesta automática y recordatorios inteligentes
- ✅ **Monitor de Eventos**: Visualización en tiempo real de eventos recibidos por Webhook
- ✅ **Funciones Serverless**: API endpoints desplegados en Vercel
- ✅ **Pruebas Rápidas**: Envío de mensajes de prueba directos
- ✅ **Dark Mode**: Interfaz moderna con soporte para modo oscuro

## 🛠️ Tecnologías

- **Frontend**: React 19 + Vite
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Backend**: Vercel Serverless Functions
- **Storage**: Redis (Vercel KV / Upstash)
- **Deployment**: Vercel

## 📁 Estructura del Proyecto

```bash
Candidatic_IA/
├── api/                          # Funciones serverless
│   ├── whatsapp/
│   │   ├── webhook.js           # Endpoint principal para webhooks UltraMsg
│   │   └── utils.js             # Utilidades de API UltraMsg
│   ├── chat.js                  # Lógica de mensajería
│   ├── candidates.js            # Gestión de base de datos de candidatos
│   └── utils/
│       ├── validation.js        # Validaciones de seguridad
│       └── storage.js           # Capa de datos (Redis)
├── src/
│   ├── components/
│   │   ├── CandidatesSection.jsx
│   │   ├── AutomationsSection.jsx
│   │   ├── EventMonitor.jsx
│   │   └── ui/                  # Componentes reutilizables
│   ├── services/
│   │   ├── whatsappService.js   # Cliente API UltraMsg
│   │   └── webhookService.js    # Cliente API webhooks
│   └── utils/
│       └── storage.js           # LocalStorage helpers
├── vercel.json                  # Configuración de Vercel
└── DEPLOYMENT.md                # Guía de deployment
```

## 🏃‍♂️ Inicio Rápido

### Desarrollo Local

```bash
# Instalar dependencias
npm install

# Ejecutar con Vercel Dev (frontend + API functions)
vercel dev
```

## 🔧 Configuración

### Variables de Entorno

Crea un archivo `.env.local` con:

```env
ULTRAMSG_INSTANCE_ID=tu-instance-id
ULTRAMSG_TOKEN=tu-token
REDIS_URL=tu-redis-url
GEMINI_API_KEY=tu-api-key-gemini
```

### UltraMsg

1. Obtén tu Instance ID y Token en [UltraMsg](https://ultramsg.com)
2. Configura el webhook en UltraMsg apuntando a tu URL de Vercel (`/api/whatsapp/webhook`)
3. Prueba la conexión desde la aplicación

## 📚 Documentación Adicional

- [UltraMsg API Docs](https://docs.ultramsg.com)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv)

---

**Desarrollado con ❤️ para Candidatic**
