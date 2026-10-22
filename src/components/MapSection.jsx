import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, RefreshCw, Loader2, MessageSquare } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';

// Sección Mapa: un pin por cada candidato que compartió su ubicación (la guarda el webhook en el
// índice candidatic:candidate_locations). Usa Leaflet directo (sin react-leaflet) con renderer de
// CANVAS + CircleMarkers → ligero y aguanta miles de puntos sin inflar el DOM. Tiles gratis de OSM.
// Se carga perezoso desde App (lazy) para no pesar en el bundle principal.
//
// • Pins EN VIVO: escucha el evento SSE 'sse:location:pin' (mismo canal singleton del dashboard)
//   y agrega el pin del candidato que acaba de llegar, sin re-jalar todo.
// • La VISTA (centro + zoom) se guarda en las preferencias del usuario (preferences.mapView) para
//   retomar el mapa donde lo dejaste.

const MTY = [25.6866, -100.3161]; // centro por defecto (Monterrey) si no hay vista guardada ni pins

export default function MapSection({ onOpenCandidate }) {
    const { user, setUser } = useAuthContext();
    const savedView = user?.preferences?.mapView || null;

    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const layerRef = useRef(null);
    const hadSavedView = useRef(!!savedView); // si el usuario ya tiene vista guardada, NO auto-encuadrar
    const didFit = useRef(false);
    const saveTimer = useRef(null);
    const onOpenRef = useRef(onOpenCandidate);
    useEffect(() => { onOpenRef.current = onOpenCandidate; });

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

    // Guarda la vista (centro + zoom) en las preferencias del usuario, con debounce para no
    // spamear PUT /api/users al arrastrar/zoom. saveUser mergea preferences un nivel.
    const saveView = useCallback((view) => {
        if (!user?.id) return;
        setUser(prev => prev ? { ...prev, preferences: { ...(prev.preferences || {}), mapView: view } } : prev);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, preferences: { mapView: view } })
            }).catch(() => {});
        }, 800);
    }, [user?.id, setUser]);

    // Inicializa el mapa una sola vez (centro/zoom desde la vista guardada si existe).
    useEffect(() => {
        if (mapRef.current || !containerRef.current) return;
        const center = savedView ? [savedView.lat, savedView.lng] : MTY;
        const zoom = savedView?.zoom || 11;
        const map = L.map(containerRef.current, { center, zoom, preferCanvas: true, zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 19
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        // Al mover/zoom: guarda cómo quedó el mapa (debounced).
        map.on('moveend', () => {
            const c = map.getCenter();
            saveView({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), zoom: map.getZoom() });
        });
        setTimeout(() => map.invalidateSize(), 150);
        return () => { map.remove(); mapRef.current = null; };
    }, []);

    // Dibuja un pin (circleMarker de canvas) con su popup. Reusado por la carga y por el SSE en vivo.
    const drawPin = useCallback((p, canvas) => {
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
        return m;
    }, []);

    // Redibuja todos los pins cuando cambia la lista. Encuadra SOLO la primera vez que hay pins y
    // si el usuario NO tiene una vista guardada (para no pisar "cómo dejó el mapa").
    useEffect(() => {
        const map = mapRef.current, layer = layerRef.current;
        if (!map || !layer) return;
        layer.clearLayers();
        if (!pins.length) return;
        const canvas = L.canvas({ padding: 0.5 });
        const latlngs = [];
        for (const p of pins) { drawPin(p, canvas).addTo(layer); latlngs.push([p.lat, p.lng]); }
        if (!hadSavedView.current && !didFit.current) {
            try {
                if (latlngs.length === 1) map.setView(latlngs[0], 14);
                else map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 });
            } catch { /* bounds vacíos */ }
            didFit.current = true;
        }
    }, [pins, drawPin]);

    // 📡 Pin EN VIVO (SSE): un candidato acaba de compartir su ubicación → upsert en la lista
    // (el efecto de arriba lo dibuja; no re-encuadra, respeta tu vista).
    useEffect(() => {
        const onPin = (e) => {
            const p = e.detail;
            if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return;
            setPins(prev => {
                const i = prev.findIndex(x => x.id === p.id);
                const pin = { id: p.id, lat: Number(p.lat), lng: Number(p.lng), nombre: p.nombre || '', whatsapp: p.whatsapp || '', ts: p.ts || Date.now() };
                if (i === -1) return [...prev, pin];
                const next = prev.slice(); next[i] = pin; return next;
            });
        };
        window.addEventListener('sse:location:pin', onPin);
        return () => window.removeEventListener('sse:location:pin', onPin);
    }, []);

    // Click en "Ver chat" dentro de un popup → abre el chat del candidato.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onClick = (e) => {
            const btn = e.target.closest?.('.map-open-chat');
            if (btn?.dataset?.cand && onOpenRef.current) onOpenRef.current(btn.dataset.cand);
        };
        el.addEventListener('click', onClick);
        return () => el.removeEventListener('click', onClick);
    }, []);

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
