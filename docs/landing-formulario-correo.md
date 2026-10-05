# Formulario del landing → correo (Resend)

El landing (`candidatic.com`) tiene formularios de "solicitar información" que al enviarse
disparan un correo a `oscarjrdz@gmail.com` con los datos del prospecto.

## Flujo

```
Formulario (LandingPage.jsx / MobileLandingPage.jsx)
   → POST /api/public/info-request
      → Resend (servicio de correo transaccional, import { Resend } from 'resend')
         → correo a oscarjrdz@gmail.com
```

- **Plataforma de correo:** [Resend](https://resend.com). La cuenta está a nombre de `oscarjrdz@gmail.com`.
- **API key:** variable de entorno `RESEND_API_KEY` (empieza con `re_`). Vive en:
  - **Vercel → Settings → Environment Variables → `RESEND_API_KEY`** (entorno Production) — **esta es la que usa producción.**
  - `.env` local (solo para pruebas desde la máquina; está en `.gitignore`).
- **Remitente:** `onboarding@resend.dev` — dominio **compartido de pruebas** de Resend.
  Solo entrega al correo dueño de la cuenta (`oscarjrdz@gmail.com`). Para mandar a otros
  destinatarios o usar `hola@candidatic.com`, hay que **verificar el dominio candidatic.com**
  en Resend → Domains (pendiente, no hecho).
- **Endpoint:** [api/public/info-request.js](../api/public/info-request.js). Es público (sin auth),
  solo acepta POST. Campos requeridos: `nombre`, `wapp`. Opcionales: `empresa`, `correo`.

## Incidente oct 2026 — "no llegan los correos del formulario"

**Causa raíz:** la `RESEND_API_KEY` estaba **revocada/inválida** (daba `401 API key is invalid`).
Muy probablemente se invalidó durante la rotación de secretos de la auditoría de seguridad de
sep 2026 y nunca se repuso una válida. Se resolvió generando una key nueva en Resend y poniéndola
en Vercel (Production) + redeploy.

**Bug que lo ocultaba (ya corregido):** el SDK de Resend **NO lanza excepción** en errores de API;
devuelve `{ data, error }`. El endpoint hacía `await resend.emails.send(...)` sin revisar `error`,
así que tragaba el fallo en silencio y siempre respondía `success:true`. Los formularios del front
tampoco revisaban `success`, mostraban "enviado" aunque el correo se hubiera caído.

**Fix aplicado:**
- `info-request.js`: revisa `{ error }` de Resend → responde `502` real; valida que exista
  `RESEND_API_KEY` → `500` si falta. Nunca más falla en silencio.
- `LandingPage.jsx` (`handleInfoForm`, `handleCtaForm`) y `MobileLandingPage.jsx` (`handleForm`):
  leen `res.ok` + `data.success`; si no se envió, muestran estado `error` en vez de `success` falso.

## Cómo diagnosticar si vuelve a fallar

1. **¿Llega el correo?** Es la única prueba definitiva de entrega.
2. Probar la key directo (reemplaza `<KEY>`):
   ```bash
   node --input-type=module -e '
   import { Resend } from "resend";
   const r = new Resend("<KEY>");
   const { data, error } = await r.emails.send({
     from: "Candidatic IA <onboarding@resend.dev>",
     to: "oscarjrdz@gmail.com", subject: "test", html: "<p>test</p>" });
   console.log("DATA:", JSON.stringify(data), "ERROR:", JSON.stringify(error));'
   ```
   `error: null` = key buena. `401 API key is invalid` = key revocada → generar otra en Resend.
3. Con el fix desplegado, el endpoint de prod ya devuelve `502`/`500` cuando el correo no sale,
   así que el fallo deja de ser invisible.
