# Feature: Estatus de Empresas (Bolsa App) — 2026-07-25

Control de aprobación de empresas reclutadoras y sus vacantes desde el admin de candidatic.com.

## Objetivo

Cuando una empresa se registra desde la **app de reclutador**, ya no queda pública automáticamente.
Nace **pausada**, puede crear vacantes (que también nacen pausadas), y **el admin la activa manualmente**
desde candidatic.com → sección **Bolsa App → Empresas**.

## Modelo

Cada empresa en Redis (`candidatic_empresas`) tiene un campo `status`:

- `'pausado'` → sus vacantes NO se muestran a los candidatos.
- `'activo'` → sus vacantes se muestran (si la vacante también está activa).
- **Sin campo `status`** (empresas viejas) → se tratan como **activas** (no se afectan).

La visibilidad real para el candidato la sigue determinando el campo `active` de cada vacante
(la app pide `/api/bolsa?public=true`, que filtra `active !== false`). El estatus de la empresa
solo controla **el valor por defecto de `active` al crear vacantes** y el **cascade** al cambiar estatus.

## Reglas de comportamiento

| Acción | Resultado |
|---|---|
| Empresa se registra desde la app | Nace `status: 'pausado'` |
| Empresa creada por el admin (web) | Nace `status: 'activo'` |
| Crear vacante con empresa **pausada** | La vacante nace `active: false` (pausada) |
| Crear vacante con empresa **activa** | La vacante nace `active: true` (activa) |
| Admin cambia empresa a **activo** | Cascade: TODAS sus vacantes → `active: true` |
| Admin cambia empresa a **pausado** | Cascade: TODAS sus vacantes → `active: false` |
| Admin pausa/activa una vacante individual | Independiente; puede hacerlo cuando quiera |

## Archivos modificados

### Backend

- **`api/recruiter/register.js`**
  La empresa creada al registrarse desde la app incluye `status: 'pausado'`.

- **`api/empresas.js`**
  - `POST` (crear empresa desde admin): default `status: 'activo'`.
  - `PUT` (editar empresa): al cambiar `status`, hace **cascade** — activa o pausa TODAS las
    vacantes de esa empresa en `candidatic_bolsa_empleo` (match por `recruiterPhone` vs `telefono`/`wapp`, últimos 10 dígitos).
  - `GET`: enriquece cada empresa con `lastLogin` leído de `recruiter:<tel10>`.

- **`api/bolsa.js`**
  Al crear una vacante (`POST` default), busca la empresa del reclutador en `candidatic_empresas`
  (por `telefono`/`wapp`) y setea `active: !empresaPausada`. Empresas sin `status` → vacante activa.

### Frontend (admin)

- **`src/components/BolsaSection.jsx`** → Tab **Empresas**:
  - **Dropdown Activa/Pausada** por empresa (`PUT /api/empresas { id, status }`), con borde ámbar si está pausada.
  - Botón **"Ver info"** → modal con: número de registro (`telefono`), WhatsApp de candidatos (`wapp`),
    fecha de creación (`createdAt`) y último acceso (`lastLogin`).

## Lo que NO se tocó

- ❌ Flujo del PIN / login (`auth.js`, `candidato/request-pin`, `recruiter/request-pin`, `*/verify`).
- ❌ Integración WhatsApp Meta Cloud API (`whatsapp/utils.js`, `sendMetaMessage`).
- ❌ Notificaciones de postulación/solicitud por WhatsApp en `bolsa.js` (intactas).
- ❌ La app móvil del candidato — **no requiere actualización**; ya filtra por `active`.

## Cómo usarlo (admin)

1. candidatic.com → **Bolsa App → Empresas**.
2. Las empresas nuevas aparecen con badge **Pausada** (borde ámbar).
3. **"Ver info"** para revisar sus datos (registro, WhatsApp, fechas).
4. Cambiar el dropdown a **Activa** → sus vacantes se publican.
5. Se puede pausar/activar empresas o vacantes individuales en cualquier momento.
