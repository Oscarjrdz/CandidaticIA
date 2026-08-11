import { Play, Tag, CalendarRange, MapPin, Briefcase, GraduationCap, MessageCircle, Hash, UserRound, CircleMinus, BellRing, FolderKanban, FlaskConical } from 'lucide-react';

export const PROFILE_FILTER_LABELS = {
    active: 'Activos (no bloqueados)',
    completo: 'Perfil completo',
    incompleto: 'Perfil incompleto',
    todos: 'Todos'
};

export const GENEROS = ['Hombre', 'Mujer'];

export const ETIQUETA_MODE_LABELS = {
    todas: 'Todas',
    ninguna: 'Sin etiqueta',
    especifica: 'Etiqueta específica'
};

function formatMultiSummary(arr, allLabel = 'Todos') {
    if (!Array.isArray(arr) || !arr.length) return allLabel;
    if (arr.length === 1) return arr[0];
    return `${arr[0]}, +${arr.length - 1} más`;
}

// Paleta clara reusada del resto del dashboard: bg-{color}-50 + border-{color}-100,
// icono en bg-{color}-500. Un solo lugar para no divergir entre nodos.
export const COLOR_CLASSES = {
    indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-200 dark:border-indigo-800', icon: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', icon: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', icon: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', icon: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
    gray: { bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700', icon: 'bg-gray-500', text: 'text-gray-700 dark:text-gray-300' }
};

export const NODE_DEFS = {
    inicio: {
        label: 'Inicio',
        icon: Play,
        color: 'indigo',
        hasTarget: false,
        hasSource: true,
        summary: (data) => PROFILE_FILTER_LABELS[data.profileFilter] || PROFILE_FILTER_LABELS.todos
    },
    etiqueta: {
        label: 'Filtro: Etiqueta',
        icon: Tag,
        color: 'indigo',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.mode === 'especifica' ? (data.tag || 'Elige etiqueta') : (ETIQUETA_MODE_LABELS[data.mode] || ETIQUETA_MODE_LABELS.todas)
    },
    condicion_genero: {
        label: 'Condición: Género',
        icon: UserRound,
        color: 'blue',
        hasTarget: true,
        hasSource: true,
        summary: (data) => formatMultiSummary(data.generos)
    },
    condicion_edad: {
        label: 'Condición: Edad',
        icon: CalendarRange,
        color: 'blue',
        hasTarget: true,
        hasSource: true,
        summary: (data) => (data.min == null && data.max == null) ? 'Sin filtro' : `${data.min ?? '—'} a ${data.max ?? '—'} años`
    },
    condicion_municipio: {
        label: 'Condición: Municipio',
        icon: MapPin,
        color: 'blue',
        hasTarget: true,
        hasSource: true,
        summary: (data) => formatMultiSummary(data.municipios)
    },
    condicion_categoria: {
        label: 'Condición: Categoría',
        icon: Briefcase,
        color: 'blue',
        hasTarget: true,
        hasSource: true,
        summary: (data) => formatMultiSummary(data.categorias)
    },
    condicion_escolaridad: {
        label: 'Condición: Escolaridad',
        icon: GraduationCap,
        color: 'blue',
        hasTarget: true,
        hasSource: true,
        summary: (data) => formatMultiSummary(data.escolaridades)
    },
    accion_whatsapp: {
        label: 'Mandar WhatsApp',
        icon: MessageCircle,
        color: 'emerald',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.quickReplyName || 'Elige un mensaje del banco'
    },
    accion_etiqueta: {
        label: 'Agregar Etiqueta',
        icon: Tag,
        color: 'amber',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.tag || 'Elige una etiqueta'
    },
    accion_quitar_etiqueta: {
        label: 'Quitar Etiqueta',
        icon: CircleMinus,
        color: 'amber',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.tag ? `Quitar: ${data.tag}` : 'Elige una etiqueta'
    },
    accion_recordatorio: {
        label: 'Mandar Recordatorio',
        icon: BellRing,
        color: 'emerald',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.templateName || 'Elige una plantilla de recordatorio'
    },
    accion_proyecto: {
        label: 'Meter a Proyecto',
        icon: FolderKanban,
        color: 'amber',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.projectName || 'Elige un proyecto'
    },
    contador: {
        label: 'Contador',
        icon: Hash,
        color: 'gray',
        hasTarget: true,
        hasSource: true,
        summary: (data) => data.label || 'Cuenta candidatos que llegan aquí'
    },
    test: {
        label: 'Nodo Test',
        icon: FlaskConical,
        color: 'gray',
        hasTarget: false,
        hasSource: false,
        summary: () => 'Corre el flujo completo con un número real'
    }
};
