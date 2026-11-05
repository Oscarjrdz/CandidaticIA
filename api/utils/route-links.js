/**
 * route-links.js — Motor compartido de "Crear Ruta (Maps)".
 *
 * Fuente ÚNICA de verdad para los modos de viaje y el formato de la URL de Google Maps que arma la
 * ruta desde la ubicación del candidato hasta un destino. Lo usan:
 *   - El nodo de Flujos "Crear Ruta" (api/utils/flow-engine.js → sendRouteButtons).
 *   - El botón manual del Chat Web (api/candidates/send-route.js).
 *
 * No duplicar el formato de URL ni la tabla de modos en otro lado: importar de aquí.
 */

// 🧭 Modos de viaje. `travelmode` = valor que entiende Google Maps. Moto (two-wheeler) solo funciona
// por URL en ciertos países; si no, Maps lo abre como carro. Transporte = transit. Los tres caben en
// los 3 botones de respuesta que admite Meta.
export const ROUTE_MODES = {
    carro:      { handle: 'carro',      defaultLabel: '🚗 CARRO',        travelmode: 'driving',     name: 'carro' },
    transporte: { handle: 'transporte', defaultLabel: '🚌 TRANSPORTE',    travelmode: 'transit',     name: 'Transporte Público' },
    moto:       { handle: 'moto',       defaultLabel: '🏍️ MOTO',         travelmode: 'two-wheeler', name: 'moto' }
};

// Arma la URL de direcciones de Google Maps. Incluye `origin` solo si hay coords de origen válidas
// (si no, Maps usa el GPS del teléfono). `travelmode` por defecto 'driving'. Devuelve null si el
// destino no es válido.
export function buildMapsDirUrl({ destLat, destLng, originLat, originLng, travelmode } = {}) {
    const dLat = Number(destLat);
    const dLng = Number(destLng);
    if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return null;
    const dest = `${dLat},${dLng}`;
    const oLat = Number(originLat);
    const oLng = Number(originLng);
    const hasOrigin = Number.isFinite(oLat) && Number.isFinite(oLng);
    const tm = travelmode || 'driving';
    return hasOrigin
        ? `https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLng}&destination=${dest}&travelmode=${tm}`
        : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${tm}`;
}
