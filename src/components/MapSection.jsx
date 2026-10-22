import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, RefreshCw, Loader2, MessageSquare } from 'lucide-react';

// Sección Mapa: un pin por cada candidato que compartió su ubicación (la guarda el webhook en el
// índice candidatic:candidate_locations). Usa Leaflet directo (sin react-leaflet) con renderer de
// CANVAS + CircleMarkers → ligero y aguanta miles de puntos sin inflar el DOM. Tiles gratis de OSM.
// Se carga perezoso desde App (lazy) para no pesar en el bundle principal.

const MTY = [25.6866, -100.3161]; // centro por defecto (Monterrey) si no hay pins

export default function MapSection({ onOpenCandidate }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const layerRef = useRef(null);
    const [pins, setPins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const res = await fetch('/api/system/candidate-locations');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al cargar ubicaciones');
            setPins(Array.isArray(data.pins) ? data.pins : []);
        } catch (e) {
            setError(e.message || 'Error al cargar');
            setPins([]);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Inicializa el mapa una sola vez.
    useEffect(() => {
        if (mapRef.current || !containerRef.current) return;
        const map = L.map(containerRef.current, { center: MTY, zoom: 11, preferCanvas: true, zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        // Leaflet mide mal el contenedor si se montó oculto/animado: recalcula al siguiente frame.
        setTimeout(() => map.invalidateSize(), 150);
        return () => { map.remove(); mapRef.current = null; };
    }, []);

    // Redibuja los pins cuando cambia la lista.
    useEffect(() => {
        const map = mapRef.current, layer = layerRef.current;
        if (!map || !layer) return;
        layer.clearLayers();
        if (!pins.length) return;
        const canvas = L.canvas({ padding: 0.5 });
        const latlngs = [];
        for (const p of pins) {
            const m = L.circleMarker([p.lat, p.lng], {
                renderer: canvas, radius: 6, weight: 2,
                color: '#059669', fillColor: '#10b981', fillOpacity: 0.85
            });
            const tel = p.whatsapp ? String(p.whatsapp).replace(/\D/g, '') : '';
            const nombre = (p.nombre || 'Sin nombre').replace(/</g, '&lt;');
            m.bindPopup(
                `<div style="min-width:160px">
                   <div style="font-weight:700;margin-bottom:2px">${nombre}</div>
                   ${tel ? `<div style="color:#6b7280;font-size:12px;margin-bottom:6px">${tel}</div>` : ''}
                   <button data-cand="${p.id}" class="map-open-chat" style="cursor:pointer;border:0;background:#10b981;color:#fff;font-weight:600;font-size:12px;padding:5px 10px;border-radius:8px">Ver chat</button>
                 </div>`
            );
            m.addTo(layer);
            latlngs.push([p.lat, p.lng]);
        }
        // Encadra todos los pins (con un poco de margen). Si es uno solo, acerca a él.
        try {
            const b = L.latLngBounds(latlngs);
            if (latlngs.length === 1) map.setView(latlngs[0], 14);
            else map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
        } catch { /* bounds vacíos: deja el centro por defecto */ }
    }, [pins]);

    // Click en "Ver chat" dentro de un popup → abre el chat del candidato.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onClick = (e) => {
            const btn = e.target.closest?.('.map-open-chat');
            if (btn?.dataset?.cand && onOpenCandidate) onOpenCandidate(btn.dataset.cand);
        };
        el.addEventListener('click', onClick);
        return () => el.removeEventListener('click', onClick);
    }, [onOpenCandidate]);

    return (
        <div className="flex flex-col h-full min-h-0 p-3 sm:p-6">
            <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <MapPin className="w-4 h-4 text-emerald-500" />
                    {loading ? 'Cargando ubicaciones…' : error ? <span className="text-red-500">{error}</span> : <span><strong>{pins.length}</strong> {pins.length === 1 ? 'candidato con ubicación' : 'candidatos con ubicación'}</span>}
                </div>
                <button onClick={load} disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Actualizar
                </button>
            </div>

            <div className="relative flex-1 min-h-0 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                <div ref={containerRef} className="map-section-canvas absolute inset-0" />
                {!loading && !error && pins.length === 0 && (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none">
                        <div className="bg-white/90 dark:bg-gray-800/90 rounded-xl px-5 py-4 text-center shadow-lg border border-gray-200 dark:border-gray-700 pointer-events-auto">
                            <MessageSquare className="w-6 h-6 text-gray-400 mx-auto mb-1.5" />
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Aún no hay ubicaciones</p>
                            <p className="text-xs text-gray-400 mt-0.5">Aparecerán aquí cuando un candidato comparta su ubicación por WhatsApp.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
