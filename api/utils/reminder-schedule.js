/**
 * Fuente ÚNICA del cálculo "próximo día hábil" (con hora de corte opcional).
 *
 * Antes este cálculo estaba replicado a mano en tres lugares que "DEBEN quedar
 * idénticos" (flow-engine.js, CandidateReminderModal.jsx, ChatSection.jsx) — cada
 * vez que uno cambiaba había que acordarse de tocar los otros (bug de drift ya
 * confirmado). Ahora los tres importan de aquí.
 *
 * Regla de día hábil: Lun–Jue → mañana, Vie → lunes, Sáb → lunes, Dom → lunes
 * (nunca cae en fin de semana).
 *
 * Hora de corte (cutoffTime, "HH:MM"): si el momento en que se aplica la plantilla
 * ya pasó esa hora (en Monterrey), se brinca UN día hábil más — "ya es demasiado
 * tarde para agendar cita para mañana". Ej: lunes 10:30pm con corte 22:00 → en vez
 * de martes, cae en miércoles. Vacío/ausente = sin corte (comportamiento clásico).
 */

const NEXT_BUSINESS_DAY_ADD = { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 3, Sat: 2, Sun: 1 };
const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Normaliza cualquier forma de día ("Mon", "Mon.", "Monday", "lun.") a la llave de 3
// letras que usan los mapas de arriba. Distintos locales de Intl formatean distinto.
function normalizeWeekday(w) {
    return String(w || '').replace(/[^A-Za-z]/g, '').slice(0, 3);
}

// "HH:MM" → minutos desde medianoche; null si vacío o inválido.
export function parseTimeToMinutes(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

// ¿La hora actual (en minutos desde medianoche) ya alcanzó la hora de corte?
export function isPastCutoff(nowMinutes, cutoffTime) {
    const cutoff = parseTimeToMinutes(cutoffTime);
    if (cutoff === null) return false;
    return nowMinutes >= cutoff;
}

// Días de calendario a sumar desde `weekdayShort` para llegar al próximo día hábil.
// Si `pastCutoff`, brinca un día hábil más (el "landed" siempre es hábil, así que su
// propio salto ya respeta viernes→lunes).
export function businessDayOffset(weekdayShort, pastCutoff = false) {
    const key = normalizeWeekday(weekdayShort);
    let add = NEXT_BUSINESS_DAY_ADD[key] ?? 1;
    if (pastCutoff) {
        const landedIdx = (WEEKDAY_ORDER.indexOf(key) + add) % 7;
        const landed = WEEKDAY_ORDER[landedIdx];
        add += NEXT_BUSINESS_DAY_ADD[landed] ?? 1;
    }
    return add;
}
