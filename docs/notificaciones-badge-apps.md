# Notificaciones push: dedupe, burbuja/badge y pantalla de historial

Bitácora de la sesión 2026-08-09. Cubre tres repos: `Candidatic_IA` (backend + dashboard),
`Candidatic_App` (app de candidatos) y `Candidatic_Recruiter` (app de reclutadores).

## Qué se arregló y qué se agregó

### 1. Push duplicado al mismo dispositivo (bug real, reportado por Oscar)
Una notificación de prueba a "reclutadores" llegaba dos veces al mismo celular.

- **Causa:** `POST /api/push-token` dedupeaba solo por `phone`. Si un registro llegaba
  con `phone` vacío/malformado (pasó al menos una vez en producción), no encontraba la
  entrada existente del mismo dispositivo y creaba una segunda con el mismo Expo token.
  Al enviar a un `target`, ambas entradas calificaban → mismo celular, dos pushes.
- **Fix:** `api/push-token.js` — rechaza `phone` inválido (menos de 10 dígitos tras
  limpiar), y dedupea por `token` O por `(phone + type)`. `api/notificaciones.js` —
  dedupe defensivo de tokens antes de enviar (`[...new Set(...)]`), y nuevo `DELETE`
  para poder quitar un dispositivo puntual desde la UI.
- **Bug relacionado encontrado después:** el match por `phone` sin exigir `type` hacía
  que un reclutador que también probaba la app de candidato con el mismo número
  perdiera su registro de candidato (la entrada de reclutador lo sobreescribía). Corregido
  exigiendo `phone + type` juntos en el match — commit `c52c1299`.
- **UI:** nueva tarjeta "Dispositivos registrados" en `NotificacionesSection.jsx`
  (dashboard web) — lista candidatos/reclutadores registrados, marca duplicados en rojo,
  botón para eliminar uno.

Commits en `Candidatic_IA`: `49535ed1`, `c52c1299`.

### 2. Burbuja con número (badge), en ambas apps y ambas plataformas
Pedido: que las apps tengan la burbuja roja con número tipo WhatsApp/Facebook, tanto en
el ícono de la app (nivel OS) como dentro de la app.

- **Backend:** cada entrada de `candidatic_push_tokens` ahora lleva `unreadCount`
  (se incrementa en cada envío) y un `badge: <unreadCount>` va en el payload de Expo Push
  → actualiza el número sobre el ícono de la app automáticamente. Nuevo endpoint
  `GET/POST /api/push-unread` (contador + reset). Commit `58169255`.
- **Apps (candidato y reclutador):** `Notifications.setBadgeCountAsync()` sincroniza el
  ícono al abrir la app y al recibir un push en foreground (`syncBadgeCount` /
  `markNotificationsRead` en `utils/notifications.ts`, ambas apps).
- **Limitación de plataforma a tener presente:** en iOS el número siempre se ve. En
  Android depende del launcher del fabricante — Samsung/Pixel lo muestran, otros
  launchers solo muestran un punto sin número o nada. Esto es una limitación del OS/
  fabricante, no del código.

### 3. Historial real de notificaciones (para que la burbuja tenga a dónde llevar)
- **Backend:** cada entrada de `candidatic_push_tokens` ahora también guarda `inbox`
  (últimas 30 notificaciones recibidas). `GET /api/push-unread` regresa `items`.
  Commit `e4bea377`.
- **App candidato:** el item "Notificaciones" del drawer **apuntaba a una pantalla que
  nunca se creó** (crasheaba al tocarlo — bug preexistente, no de esta sesión). Se creó
  `app/(candidate_tabs)/notifications.tsx` con el historial real; la burbuja se movió del
  header al ícono de este mismo item del drawer (antes había una campana duplicada en el
  header, quitada). Commit `4dcbeb4` en `Candidatic_App`.
- **App reclutador:** no tiene pantalla de historial — el bell del header solo marca como
  leído y limpia la burbuja al tocarlo. No se construyó una pantalla de lista ahí porque
  no fue parte de lo pedido (solo "burbuja y número"); si se quiere paridad con la app de
  candidato, es un pendiente aparte.

### Pendiente detectado, no relacionado con esta sesión
- El item "Postulaciones" del drawer de la app de candidato (`applications.tsx`) **también
  apunta a una pantalla que no existe**, mismo problema que tenía "Notificaciones". No se
  tocó porque no fue parte de lo pedido — mencionar antes de publicar, para decidir si se
  arregla junto con esto o después.

## Estado de deploy — qué ya está en producción y qué falta

| Repo | Deploy | Estado |
|---|---|---|
| `Candidatic_IA` (backend + dashboard web) | Vercel, auto-deploy en push | ✅ **Ya en producción** — todos los commits de esta sesión están pusheados a `main` y desplegados. |
| `Candidatic_App` (candidatos) | Build + submit manual (EAS / App Store / Play Store) | ⏳ **Solo commiteado localmente, NO publicado.** Repo sin remoto configurado (no hay GitHub) — el commit vive solo en este Mac. Versión actual en `app.json`: `1.0.2` (buildNumber/versionCode `1`), la misma que ya está publicada — **hay que subir buildNumber/versionCode antes de correr `eas build`**, si no las tiendas van a rechazar el build por número repetido. |
| `Candidatic_Recruiter` (reclutadores) | Build + submit manual (EAS / App Store / Play Store) | ⏳ **Solo commiteado localmente, NO publicado.** Mismo caso: sin remoto, versión `1.0.2` build `1` ya publicada — sube el número de build antes de compilar. |

**En resumen:** el backend ya está sirviendo `badge`, `unreadCount` e `inbox` en
producción ahora mismo, así que aunque las apps instaladas todavía no tengan el código
nuevo, ya dejaron de duplicarse las notificaciones (eso lo resuelve el backend solo). Lo
que falta para que la gente VEA la burbuja y el historial es: subir el build number en
ambos `app.json`, correr `eas build` + submit de las dos apps, y esperar la revisión de
cada tienda.
