# Guía de Deployment - Candidatic UltraMsg Integration

Esta guía te llevará paso a paso para desplegar tu aplicación en Vercel con integración a UltraMsg.

---

## 📋 Pre-requisitos

- ✅ Cuenta en [Vercel](https://vercel.com)
- ✅ Node.js instalado (v18+)
- ✅ Cuenta en [UltraMsg](https://ultramsg.com)
- ✅ Base de datos Redis (Vercel KV o Upstash)

---

## 🚀 Deployment en Vercel

### 1. Conectar con GitHub

```bash
git add .
git commit -m "Migration to UltraMsg final"
git push origin main
```

### 2. Configuración de Variables de Entorno

En el Dashboard de Vercel, agrega:

| Variable | Descripción |
|----------|-------------|
| `ULTRAMSG_INSTANCE_ID` | Tu Instance ID de UltraMsg |
| `ULTRAMSG_TOKEN` | Tu Token de API de UltraMsg |
| `REDIS_URL` | URL de conexión a Redis |
| `GEMINI_API_KEY` | Key de Google Gemini para la IA |
| `CRON_SECRET` | Secret para proteger los cron jobs |

---

## 🔗 Configurar Webhook en UltraMsg

Una vez desplegado:

1. Ve a tu panel de **UltraMsg**.
2. En la sección de **Webhook**, ingresa la URL de tu proyecto:
   `https://tu-proyecto.vercel.app/api/whatsapp/webhook`
3. Asegúrate de activar los eventos de:
   - `Document message`
   - `Media message`
   - `Text message`
   - `Message Acknowledgments` (opcional)

---

## 🧪 Testing Local

```bash
# Ejecutar localmente con variables de entorno
vercel dev
```

---

## 📊 Monitoreo y Logs

Puedes ver los logs en tiempo real desde el dashboard de Vercel en la pestaña "Logs" de tu deployment, o usando la CLI:

```bash
vercel logs --follow
```

---

## 🎉 ¡Listo!

Tu aplicación está ahora en producción y lista para gestionar candidatos vía WhatsApp con UltraMsg.
