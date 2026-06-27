# Auditoría de Limpieza — Candidatic IA
**Fecha:** 2026-06-27  
**Ejecutado por:** Oscar + Claude  
**Estado:** En progreso

---

## HALLAZGOS DE SEGURIDAD (acción inmediata)

| Archivo | Problema | Acción |
|---------|----------|--------|
| `token.txt` | Token Meta API en texto plano en el repo | Eliminar + rotar token |
| `app.js` | Credenciales Redis hardcodeadas (URL completa con password) | Eliminar |

---

## CATEGORÍA A — Eliminados (bajo riesgo, verificado)

Verificación previa: ninguno de estos archivos es importado por `api/` ni `src/`. Confirmado con grep exhaustivo.

### Scripts de raíz (debug/test/scratch)

| Archivo | Propósito original |
|---------|-------------------|
| `scratch.js` | Exploración Redis |
| `scratch_check_8115846365.js` | Verificación candidato específico |
| `scratch_check_8115846365.mjs` | Duplicado .mjs |
| `scratch_check_large_keys.js` | Análisis keys Redis |
| `scratch_fix_empty_unread.mjs` | Fix puntual Redis |
| `scratch_get_redis_stats.js` | Stats Redis dev |
| `scratch_inspect_candidate.js` | Inspección candidato |
| `scratch_inspect_media_access.js` | Inspección media |
| `debug_red.js` | Debug webhook payload |
| `debug_leads.js` | Debug leads |
| `check_large_keys.js` | Check tamaño keys Redis |
| `check_redis.js` | Check conexión Redis |
| `check_redis_mem.js` | Check memoria Redis |
| `audit_redis.mjs` | Auditoría Redis manual |
| `audit_redis_server.mjs` | Auditoría servidor Redis |
| `redis-monitor.mjs` | Monitor Redis interactivo |
| `clear_all_media.js` | Limpieza media Redis |
| `clear_redis_media.js` | Limpiar Redis media |
| `count_dupes.js` | Contar duplicados |
| `count_dupes.py` | Python version |
| `fix_bulks.js` | Fix bulks puntual |
| `get_candidate.js` | Obtener candidato |
| `inspect_webhooks.js` | Inspeccionar webhooks |
| `normalize_dates.js` | Normalizar fechas |
| `parseTemplate.js` | Parse plantillas |
| `inject_advanced.cjs` | Inyección avanzada (dev) |
| `inject_vcard.cjs` | Inyección vCard (dev) |
| `patch_ui.cjs` | Patch UI (dev) |
| `script_refactor.js` | Script de refactorización |
| `test-cross.js` | Test cross-origin |
| `test-db.js` | Test DB Redis |
| `test-hour.js` | Test lógica de hora |
| `test-json-filter.js` | Test JSON filter |
| `test-meta.js` | Test Meta API |
| `test-templates.js` | Test templates |
| `test-webhooks.js` | Test webhooks |
| `test_accounts.cjs` | Test cuentas Meta |
| `test_ad_page.cjs` | Test ad page |
| `test_ads_comments.cjs` | Test ads comments |
| `test_ads_comments.js` | Duplicado .js |
| `test_ads_stats.cjs` | Test ads stats |
| `test_candidates.js` | Test candidates |
| `test_page_token.cjs` | Test page token |
| `test_public_page.cjs` | Test public page |
| `test_redis.js` | Test Redis |
| `test_token_scopes.cjs` | Test token scopes |
| `test_upload.js` | Test upload |
| `test_vercel_upload.js` | Test Vercel upload |
| `test_vercel_upload2.js` | Variante 2 |
| `test_vercel_upload3.js` | Variante 3 |
| `app.js` | Script scratch con credenciales Redis hardcodeadas ⚠️ |

### Archivos vacíos o residuales de raíz

| Archivo | Estado |
|---------|--------|
| `cita.log` | Vacío (0 bytes) |
| `grep_logs.txt` | Vacío (0 bytes) |
| `titan_out.txt` | Vacío (0 bytes) |
| `tmp_logs.txt` | Vacío (0 bytes) |
| `vercel_debug_logs.txt` | Vacío (0 bytes) |
| `vercel_logs.txt` | Vacío (0 bytes) |
| `test_cand.json` | Vacío (0 bytes) |
| `test_db.sqlite` | Vacío (0 bytes) |
| `test_doc.pdf` | Archivo test (471 bytes) |
| `chat_diff.patch` | Patch antiguo de ChatSection.jsx (ya mergeado) |
| `GOLDEN_STATE_EXTRACTION_100.md` | Checkpoint de Feb 2026, info superada |
| `token.txt` | Token Meta API en texto plano ⚠️ SEGURIDAD |
| `.vercel-force-deploy-final` | Flag CI/CD obsoleto |
| `.vercel-force-rebuild` | Flag CI/CD obsoleto |
| `.vercel-rebuild-2` | Flag CI/CD obsoleto |
| `.vercel-rebuild-v1.6` | Flag CI/CD obsoleto |

### Imágenes de debug en raíz (763 KB)

| Archivo | Nota |
|---------|------|
| `large_test.jpg` | Test de upload de imagen |
| `oscar_screen.jpg` | Screenshot debug Mar 2026 |
| `oscar_screen2.jpg` | Screenshot debug |
| `oscar_screen3.jpg` | Screenshot debug |
| `oscar_screen4.jpg` | Screenshot debug |
| `oscar_screen5.jpg` | Screenshot debug |
| `oscar_screen6.jpg` | Screenshot debug |
| `oscar_screen7.jpg` | Screenshot debug |

### Directorio `dev_inbox/` (~1.1 MB)

Screenshots descargados por `api/utils/pull-screenshot.js` durante desarrollo.  
`image-downloader.js` solo corre cuando `NODE_ENV !== 'production'`, y nadie lo importa actualmente.

---

## CATEGORÍA B — Pendiente revisión (api/ — riesgo medio)

No se tocan sin confirmación explícita.

### `api/admin/` — 14 endpoints nunca accesibles públicamente

Son migraciones y scripts de mantenimiento que se corren manualmente. Evaluar si aún son necesarios o si ya cumplieron su propósito.

| Archivo | Última utilidad |
|---------|----------------|
| `backfill-daily-stats.js` | Backfill histórico |
| `candidate-history.js` | Historial candidatos |
| `clean-employment.js` | Limpieza datos empleo |
| `clean-names.js` | Limpieza nombres |
| `debug-candidates.js` | Debug candidatos |
| `debug-chat.js` | Debug chat |
| `fix-ages.js` | Fix edades |
| `load-env.js` | Carga env |
| `migrate-default-steps.js` | Migración steps |
| `migrate-v5.js` | Migración v5 |
| `migrate_standalone.js` | Migración standalone |
| `sync-categories.js` | Sync categorías |
| `telemetry.js` | Telemetría admin |
| `update-genders.js` | Update géneros |

### `api/scripts/` — 11 scripts internos, no son HTTP endpoints

| Archivo |
|---------|
| `check-logs.js` |
| `check_brenda_perms.js` |
| `check_redis_db.js` |
| `check_ttl.js` |
| `check_upstash.js` |
| `check_users.js` |
| `dump_users_id.js` |
| `redis-bandwidth-audit.js` |
| `test_bot_stats.js` |
| `test_json.js` |
| `test_tags_endpoint.js` |

### `api/read_*.js` — Scripts de inspección Redis (no son HTTP endpoints)

Todos tienen `async function main()` — se corrían directamente con `node`, no son rutas web.

| Archivo | Qué inspecciona |
|---------|----------------|
| `read_bypass.js` | Estado de bypass en Redis |
| `read_cand.js` | Config admin en Redis |
| `read_cand_status.js` | Estado candidato |
| `read_handover.js` | Traces de handover |
| `read_new_traces.js` | Traces nuevos |
| `read_project.js` | Datos de proyecto |
| `read_rules.js` | Reglas configuradas |
| `read_traces.js` | Traces de candidato por teléfono |

### Endpoints debug expuestos (accesibles vía HTTP pero sin uso)

| Archivo | Riesgo |
|---------|--------|
| `api/debug.js` | Medio |
| `api/debug-payloads.js` | Medio |
| `api/debug-sse.js` | Medio |
| `api/debug-template.js` | Medio |
| `api/dev/debug-door.js` | Medio |
| `api/dev/screenshot.js` | Medio |
| `api/whatsapp/debug.js` | Medio |

### Otros endpoints a revisar

| Archivo | Duda |
|---------|------|
| `api/purge_media_oom.js` | ¿Se usa en algún cron o manualmente? |
| `api/test-message.js` | ¿Aún se necesita? |
| `api/redis-audit.js` | ¿Equivalente a scripts/redis-bandwidth-audit? |
| `api/utils/pull-screenshot.js` | Script standalone, no es utilidad importable |
| `api/utils/image-downloader.js` | Exporta función pero nadie la importa |

---

## CATEGORÍA C — Deuda de código (largo plazo)

### Rewrites redundantes en `vercel.json` (source == destination, no hacen nada)

```json
{ "source": "/api/media/upload",  "destination": "/api/media/upload" }
{ "source": "/api/media/list",    "destination": "/api/media/list" }
{ "source": "/api/media/delete",  "destination": "/api/media/delete" }
{ "source": "/api/:path*",        "destination": "/api/:path*" }
```

### Console.log en producción

| Archivo | Cantidad |
|---------|----------|
| `api/ai/agent.js` | 56 |
| `api/utils/storage.js` | 34 |
| `src/components/ChatSection.jsx` | 26 |
| `api/workers/process-message.js` | 16 |
| `api/admin/migrate_standalone.js` | 16 |
| `api/whatsapp/webhook.js` | 15 |
| `api/utils/orchestrator.js` | 13 |
| `api/cron/send-reminders.js` | 10 |
| `api/chat.js` | 10 |

### Archivos grandes candidatos a dividir

| Archivo | Líneas |
|---------|--------|
| `src/components/ChatSection.jsx` | ~3,948 |

---

## CATEGORÍA A+ — Pendiente confirmación (directorios de utilidades)

### `dev_utils/` — 5 scripts de inspección de API (no importados por nada)

| Archivo | Propósito |
|---------|-----------|
| `dump-graphql.cjs` | Dump de GraphQL API |
| `dump-proj.cjs` | Dump de proyecto |
| `dump-proj.js` | Idem .js |
| `dump-rest.cjs` | Dump REST |
| `fetch_logs.cjs` | Fetch de logs |

### `scripts-local/` — 4 scripts locales de inspección

| Archivo | Propósito |
|---------|-----------|
| `dump_miguel.js` | Dump de candidato "Miguel" |
| `find_tags.js` | Buscar tags en Redis |
| `inspect_candidate.js` | Inspección candidato |
| `update-genders.js` | Fix géneros (posible duplicado de api/admin) |

---

## NO TOCAR

| Archivo | Razón |
|---------|-------|
| `railway.json` | Config activa de Railway (aunque gateway-server.js no existe, es referencia) |
| `scripts/` | Migraciones reales de datos (colonias, municipios, géneros) — NO eliminar |
| `CRON_SETUP.md` | Documentación de variables de entorno |
| `DEPLOYMENT.md` | Guía de deployment (referencia) |
| `README.md` | Documentación principal |
| `eslint.config.js` | Config activa |
| `tailwind.config.js` | Config activa |
| `postcss.config.js` | Config activa |
| `vite.config.js` | Config activa |
| `package.json` | Config activa |
| `vercel.json` | Config activa |

---

## RESUMEN DE ELIMINACIONES

| Categoría | Archivos | Peso aprox |
|-----------|----------|------------|
| Scripts raíz (test/debug/scratch) | 50 archivos | ~200 KB |
| Archivos vacíos/residuales raíz | 16 archivos | ~2 KB |
| Imágenes debug raíz | 9 archivos | ~863 KB |
| `dev_inbox/` | ~11 archivos | ~1.1 MB |
| **Total** | **~86 archivos** | **~2.2 MB** |
