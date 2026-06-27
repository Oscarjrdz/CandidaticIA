# Auditoria de limpieza del proyecto

Fecha: 2026-06-26
Proyecto: Candidatic IA / candidatic.com

## Regla de trabajo

No se borro ningun archivo en esta auditoria. La unica modificacion fue crear este documento para dejar evidencia antes de tocar el proyecto.

## Estado observado

- `npm run build` termina correctamente.
- `vercel.json` ya tenia cambios locales antes de esta limpieza: agrega redirects de `candidatic.mx` y `candidatic.com.mx` hacia `https://candidatic.com/:path*`.
- `dist/` existe localmente y esta ignorado por Git. Es salida de build, no debe versionarse.
- `node_modules/` existe localmente y esta ignorado por Git.
- Tamano local aproximado:
  - repo completo: `311M`
  - `.git`: `50M`
  - `node_modules`: `245M`
  - `dist`: `5.0M`
  - `public`: `3.5M`
  - `dev_inbox`: `1.1M`
- Tamano versionado aproximado: `9440K`.

## Hallazgos criticos

### Secretos versionados

Estos archivos estan trackeados por Git y contienen valores configurados. No se imprimieron valores secretos en consola ni en este documento.

- `.env.production`
- `.env.vercel.prod`
- `token.txt`

Riesgo: alto. Si el repositorio fue subido a remoto o compartido, hay que asumir que esos secretos pueden estar expuestos.

Recomendacion:

1. Mover los secretos a Vercel Environment Variables o al gestor de secretos usado en produccion.
2. Eliminar estos archivos del repo en un commit posterior.
3. Rotar credenciales/tokens sensibles: Redis, Meta, cron/webhook secrets y cualquier token suelto.
4. Mantener solo `.env.example` sin valores reales.

## Borrado seguro propuesto

Estos archivos parecen artefactos locales, logs vacios, capturas antiguas o triggers viejos de redeploy. Recomendacion: borrar del repo si no hay una razon historica para conservarlos.

### Logs y salidas vacias

- `cita.log`
- `grep_logs.txt`
- `tmp_logs.txt`
- `vercel_debug_logs.txt`
- `vercel_logs.txt`
- `titan_out.txt`

### Triggers viejos de Vercel

- `.vercel-force-deploy-final`
- `.vercel-force-rebuild`
- `.vercel-rebuild-2`
- `.vercel-rebuild-v1.6`

### Capturas y archivos de prueba pesados

- `dev_inbox/` completo, 11 capturas de marzo 2026, aprox. `1.1M`
- `oscar_screen.jpg`
- `oscar_screen2.jpg`
- `oscar_screen3.jpg`
- `oscar_screen4.jpg`
- `oscar_screen5.jpg`
- `oscar_screen6.jpg`
- `oscar_screen7.jpg`
- `large_test.jpg`
- `test_doc.pdf`
- `test_cand.json`
- `test_db.sqlite`

### Patch suelto

- `chat_diff.patch`

## Codigo o scripts que parecen herramientas temporales

Estos archivos podrian ser utiles para mantenimiento, migraciones o debug. No recomiendo borrarlos sin confirmacion del flujo operativo.

- `clear_all_media.js`
- `clear_redis_media.js`
- `count_dupes.js`
- `count_dupes.py`
- `fix_bulks.js`
- `get_candidate.js`
- `inject_advanced.cjs`
- `inject_vcard.cjs`
- `inspect_webhooks.js`
- `normalize_dates.js`
- `parseTemplate.js`
- `patch_ui.cjs`
- `scratch.js`
- `script_refactor.js`
- `test-*.js`
- `test_*.js`
- `test_*.cjs`
- `api/scripts/test_*.js`
- `api/scripts/dump_users_id.js`

Recomendacion: mover los utiles a `scripts/` o `scripts-local/` con nombres descriptivos, y borrar los que ya no se usen.

## Componentes frontend aparentemente desconectados

Busqueda estatica: no aparecen importados desde `src/App.jsx`, `src/components`, `src/hooks`, `src/services` o `src/utils`.

- `src/components/CandidateADNCard.jsx`
- `src/components/SimulatorSection.jsx`
- `src/components/InteractiveCalendar.jsx`
- `src/components/InteractiveConfirmationMap.jsx`
- `src/components/LoginPage.jsx`
- `src/components/ui/PhraseTagInput.jsx`

Nota: `ChatHistoryModal.jsx` si usa `chatExportService.js`, pero el modal completo tampoco aparece conectado por import estatico. Requiere revisar si se carga dinamicamente o si quedo como funcionalidad pendiente.

Recomendacion: confirmar con producto antes de borrar. Si no estan en rutas ni imports dinamicos, eliminarlos reduce bundle futuro y ruido mental, aunque Vite no los incluye si no se importan.

## Dependencias

Uso directo confirmado:

- `@vercel/speed-insights` se usa en `src/main.jsx`.
- `@dnd-kit/*`, `axios`, `dotenv`, `emoji-picker-react`, `form-data`, `formidable`, `ioredis`, `lucide-react`, `react`, `react-dom`, `react-virtuoso`, `resend`, `vite-plugin-pwa` tienen referencias directas.

Posible dependencia directa no usada:

- `mime-types`: no aparecio uso directo fuera de `package.json` y `package-lock.json`.

Recomendacion: antes de quitarla, confirmar que ningun import dinamico o paquete interno la usa como dependencia directa del proyecto.

## Consola y debug en runtime

Hay muchos `console.log`, `console.warn` y `console.error` en `api/` y algunos en `src/`. No todos son basura: en serverless pueden ser observabilidad necesaria.

Casos especialmente sospechosos:

- `api/read_bypass.js`
- `api/read_traces.js`
- `api/read_new_traces.js`
- `api/read_cand.js`
- `api/read_cand_status.js`
- `src/hooks/useCandidatesSSE.js`

Recomendacion: reemplazar logs de debug por un logger condicionado por `NODE_ENV` o `DEBUG`, y dejar errores operativos importantes.

## No tocar por ahora

- `public/robots.txt`: aparecio en busquedas por extension `.txt`, pero es archivo valido.
- `public/sitemap.xml`: archivo valido para SEO.
- `public/og-image.png`, `public/whatsapp-bg.png`, `public/brenda/*`, `public/lp/*`: assets publicos reales.
- `dist/`: borrar localmente es seguro, pero no cambia el repo porque esta ignorado; se regenera con `npm run build`.
- `vercel.json`: tiene el cambio de redirects pedido para dominios `.mx` y `.com.mx`; no tocar sin revisar deploy.

## Plan recomendado por fases

### Fase 1: seguridad

1. Crear `.env.example`.
2. Sacar `.env.production`, `.env.vercel.prod` y `token.txt` del repo.
3. Rotar secretos si el repo estuvo remoto.

### Fase 2: limpieza segura

1. Borrar logs vacios.
2. Borrar triggers viejos `.vercel-*`.
3. Borrar capturas `dev_inbox/`, `oscar_screen*.jpg`, `large_test.jpg`, `test_doc.pdf` y archivos de prueba vacios.

### Fase 3: limpieza con confirmacion

1. Clasificar scripts temporales: conservar, mover a `scripts/`, o borrar.
2. Confirmar si los componentes frontend desconectados son funcionalidad pendiente.
3. Quitar dependencias directas no usadas, empezando por `mime-types`, si no hay uso oculto.

## Comandos utiles para la siguiente fase

Solo ejecutar despues de confirmar:

```bash
git rm cita.log grep_logs.txt tmp_logs.txt vercel_debug_logs.txt vercel_logs.txt titan_out.txt
git rm .vercel-force-deploy-final .vercel-force-rebuild .vercel-rebuild-2 .vercel-rebuild-v1.6
git rm -r dev_inbox
git rm oscar_screen*.jpg large_test.jpg test_doc.pdf test_cand.json test_db.sqlite chat_diff.patch
```

Para secretos, primero crear respaldo local fuera del repo o verificar que ya existan en Vercel:

```bash
git rm --cached .env.production .env.vercel.prod token.txt
```

Despues de eso, agregar `.env.example` y rotar credenciales si aplica.
