// Fuente ÚNICA de verdad de las secciones del dashboard.
//
// La consumen dos lugares que ANTES vivían desacoplados y se salían de sync:
//   1. Sidebar.jsx        → el menú lateral (construye DEFAULT_MENU_ITEMS con estos ids/labels).
//   2. UsersSection.jsx   → modal "Editar Rol" → bloque "Permisos de Secciones".
//
// El `id` es la LLAVE DE PERMISO que se guarda en el rol: el Sidebar muestra la sección
// solo si rolePermissions[id] === true (o el usuario es SuperAdmin). Por eso la lista del
// modal DEBE coincidir 1:1 con el menú — si no, aparecen toggles muertos (que no controlan
// nada) o secciones sin toggle (imposibles de conceder a un rol normal).
//
// ⚠️ Para agregar/quitar/renombrar una sección del menú: hazlo AQUÍ y en ningún otro lado.
//    Ambos lugares quedan en sync automáticamente.
//
// El ORDEN de este arreglo define el orden por defecto del menú lateral (para usuarios que
// aún no han arrastrado sus items). No lo reordenes a la ligera: cambia el layout default.
//
// `superAdminOnly: true` → la sección solo la ve el SuperAdmin, sin importar el rol. En el
// editor de permisos se muestra bloqueada (no es asignable a un rol normal).

export const MENU_SECTIONS = [
    { id: 'candidates', label: 'Candidatos', position: 'top' },
    { id: 'chat', label: 'Chat Web', position: 'top' },
    { id: 'bulks', label: 'Envíos Masivos', position: 'top' },
    { id: 'ads-stats', label: 'Estadísticas de Ads', position: 'top' },
    { id: 'stats', label: 'Estadísticas', position: 'top' },
    { id: 'bot-ia', label: 'Bot IA (2.0)', position: 'top' },
    { id: 'flows', label: 'Flows', position: 'top' },
    { id: 'vacancies', label: 'Vacantes', position: 'top' },
    { id: 'bolsa', label: 'Bolsa (App)', position: 'top' },
    { id: 'notificaciones', label: 'Notificaciones', position: 'top' },
    { id: 'agent-ia', label: 'Agent IA', position: 'top', superAdminOnly: true },
    { id: 'projects', label: 'Proyectos', position: 'top' },
    { id: 'settings', label: 'Settings', position: 'bottom' },
];

// Secciones que SÍ se pueden conceder a un rol (las superAdminOnly no son asignables).
export const GATEABLE_SECTIONS = MENU_SECTIONS.filter(s => !s.superAdminOnly);
