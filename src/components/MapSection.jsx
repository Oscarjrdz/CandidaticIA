import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, RefreshCw, Loader2, MessageSquare, Search, X, Plus, Trash2, Check, Tag } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';
import ChatWindow from './ChatWindow';
import ErrorBoundary from './ui/ErrorBoundary';

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

// ¿El valor es un dato real (no vacío ni placeholder de "aún no proporcionado")?
const hasVal = (v) => {
    if (Array.isArray(v)) return v.length > 0;
    const s = String(v ?? '').trim().toLowerCase();
    return s.length > 0 && !s.includes('proporcionad') && !['n/a', 'na', 'null', 'ninguno', 'ninguna', 'none', '-', 'desconocido', 'undefined'].includes(s);
};
const esc = (v) => String(v ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// Arma el bloque demográfico del popup a partir del candidato completo (de /api/candidates?id=).
// Marca "Completo/Incompleto" y muestra cada dato; los faltantes se ven en gris.
function renderDemographics(c) {
    const paso1ok = hasVal(c.nombreReal || c.nombre) && (hasVal(c.edad) || hasVal(c.fechaNacimiento))
        && hasVal(c.municipio) && hasVal(c.categoria) && hasVal(c.escolaridad);
    const completo = paso1ok && c.paso2Estado === 'completo';

    let exp = '';
    if (Array.isArray(c.experiencia)) exp = `${c.experiencia.length} empleo(s)`;
    else if (hasVal(c.experiencia)) {
        const s = String(c.experiencia).trim().toLowerCase();
        exp = (s === 'sí' || s === 'si') ? (hasVal(c.meses) ? `Sí · ${c.meses} meses` : 'Sí') : (s === 'no' ? 'No' : esc(c.experiencia));
    }

    const rows = [
        ['Edad', hasVal(c.edad) ? `${c.edad} años` : (hasVal(c.fechaNacimiento) ? esc(c.fechaNacimiento) : '')],
        ['Género', hasVal(c.genero) ? esc(c.genero) : ''],
        ['Municipio', esc(c.municipio)],
        ['Colonia', esc(c.colonia)],
        ['Escolaridad', esc(c.escolaridad)],
        ['Categoría', esc(c.categoria)],
        ['Experiencia', exp],
    ];
    const body = rows.map(([k, v]) => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid rgba(0,0,0,0.05)">
          <span style="color:#9ca3af;font-size:11px">${k}</span>
          <span style="font-size:11px;font-weight:600;text-align:right;${hasVal(v) ? 'color:#374151' : 'color:#d1d5db;font-weight:400'}">${hasVal(v) ? v : '—'}</span>
        </div>`).join('');

    const badge = completo
        ? '<span style="background:#dcfce7;color:#166534;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px">✓ Completo</span>'
        : '<span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px">Incompleto</span>';

    // Etiquetas del candidato (strings u objetos {name}).
    const tags = (Array.isArray(c.tags) ? c.tags : [])
        .map(t => typeof t === 'string' ? t : t?.name)
        .map(t => String(t || '').trim())
        .filter(Boolean);
    const tagChips = tags.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${tags.map(t =>
            `<span style="background:#e0e7ff;color:#3730a3;font-size:10px;font-weight:600;padding:2px 8px;border-radius:9999px">🏷️ ${esc(t)}</span>`).join('')}</div>`
        : '<div style="color:#d1d5db;font-size:10px;margin-top:5px">Sin etiquetas</div>';

    return `<div style="margin:4px 0 8px">
        <div style="margin-bottom:5px">${badge}</div>
        ${body}
        ${tagChips}
      </div>`;
}

export default function MapSection({ onOpenCandidate }) {
    const { user, setUser } = useAuthContext();
    const savedView = user?.preferences?.mapView || null;

    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const layerRef = useRef(null);
    const candMarkersRef = useRef(new Map()); // id de candidato → marker (para abrir su popup al buscarlo)
    const hadSavedView = useRef(!!savedView); // si el usuario ya tiene vista guardada, NO auto-encuadrar
    const didFit = useRef(false);
    const saveTimer = useRef(null);
    const onOpenRef = useRef(onOpenCandidate);
    useEffect(() => { onOpenRef.current = onOpenCandidate; });

    const [pins, setPins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const pinsRef = useRef(pins); // espejo para que el buscador (deps []) vea los candidatos actuales
    useEffect(() => { pinsRef.current = pins; }, [pins]);

    // 🏷️ Filtro por etiqueta: COLOREA/marca los pines que coinciden, sin ocultar los demás.
    const [allTags, setAllTags] = useState([]);            // [{name, color, count}]
    const [selectedTags, setSelectedTags] = useState([]);  // nombres (normalizados) seleccionados
    const [showTagFilter, setShowTagFilter] = useState(false);
    const [tagSearch, setTagSearch] = useState('');
    const tagFilterRef = useRef(null);

    // 🔵 Modo "Ver asistencias": colorea de azul las burbujas de candidatos con asistencia confirmada.
    const [showAsistencias, setShowAsistencias] = useState(false);
    const asistenciaCount = useMemo(() => pins.filter(p => p.asistencia === true).length, [pins]);
    const tagColorMap = useMemo(() => {
        const m = new Map();
        for (const t of allTags) m.set(String(t.name || '').trim().toLowerCase(), t.color || '#3b82f6');
        return m;
    }, [allTags]);
    const selectedTagsSet = useMemo(() => new Set(selectedTags), [selectedTags]);

    useEffect(() => {
        fetch('/api/tags')
            .then(r => r.json())
            .then(d => { if (Array.isArray(d?.tags)) setAllTags(d.tags); })
            .catch(() => {});
    }, []);

    // Cierra el dropdown de etiquetas al hacer clic fuera de él.
    useEffect(() => {
        if (!showTagFilter) return;
        const onDown = (e) => { if (tagFilterRef.current && !tagFilterRef.current.contains(e.target)) setShowTagFilter(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [showTagFilter]);

    const filteredTags = useMemo(() => {
        const q = tagSearch.trim().toLowerCase();
        if (!q) return allTags;
        return allTags.filter(t => String(t.name || '').toLowerCase().includes(q));
    }, [allTags, tagSearch]);

    // 💬 Chat embebido: al tocar "Ver chat" en un pin de candidato, abre la MISMA ventana de chat
    // de la sección Candidatos (ChatWindow) aquí, sin salir del mapa.
    const [chatCandidate, setChatCandidate] = useState(null);

    // Caché de candidatos completos ya traídos para el popup (evita re-fetch al reabrir el mismo pin).
    const candCacheRef = useRef(new Map());

    // Rellena el bloque demográfico del popup: usa caché o trae el candidato completo de la API.
    const enrichPopup = useCallback(async (el) => {
        const id = el?.dataset?.cand;
        if (!id) return;
        const cache = candCacheRef.current;
        if (cache.has(id)) { el.innerHTML = renderDemographics(cache.get(id)); return; }
        try {
            const res = await fetch(`/api/candidates?id=${encodeURIComponent(id)}`);
            const data = await res.json();
            if (!res.ok || !data?.candidate) throw new Error();
            cache.set(id, data.candidate);
            if (el.isConnected) el.innerHTML = renderDemographics(data.candidate);
        } catch {
            if (el.isConnected) el.innerHTML = '<div style="color:#ef4444;font-size:11px;padding:4px 0">No se pudo cargar la info</div>';
        }
    }, []);

    // 🔎 Buscador de lugares (geocodificación con Nominatim de OSM — gratis, mismo proveedor que las tiles).
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const searchMarkerRef = useRef(null);    // marcador temporal del lugar buscado
    const searchAbortRef = useRef(null);     // aborta la búsqueda anterior si el usuario sigue tecleando
    const suppressSearchRef = useRef(false); // salta la búsqueda que dispararía setQuery al elegir un resultado

    // 📍 Pines personalizados (creados a mano, guardados en Redis vía /api/system/map-pins).
    const [customPins, setCustomPins] = useState([]);
    const [addMode, setAddMode] = useState(false);     // al activarlo, el siguiente clic en el mapa crea un pin
    const [draft, setDraft] = useState(null);          // { lat, lng, label, note, color } del pin en edición
    const [savingPin, setSavingPin] = useState(false);
    const customLayerRef = useRef(null);               // capa aparte para no pisar los pins de candidatos
    const addModeRef = useRef(false);                  // espejo de addMode para el handler de clic del mapa
    useEffect(() => { addModeRef.current = addMode; }, [addMode]);

    // Paleta de colores de los pines manuales (clave Redis → hex para el ícono/UI). Debe coincidir
    // con el set COLORS de api/system/map-pins.js.
    const PIN_COLORS = {
        blue: '#2563eb', sky: '#0284c7', cyan: '#0891b2', teal: '#0d9488',
        emerald: '#059669', green: '#16a34a', lime: '#65a30d', amber: '#d97706',
        orange: '#ea580c', red: '#dc2626', rose: '#e11d48', pink: '#db2777',
        fuchsia: '#c026d3', violet: '#7c3aed', indigo: '#4f46e5', slate: '#475569'
    };

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const [resCand, resCustom] = await Promise.all([
                fetch('/api/system/candidate-locations'),
                fetch('/api/system/map-pins')
            ]);
            const data = await resCand.json();
            if (!resCand.ok) throw new Error(data.error || 'Error al cargar ubicaciones');
            setPins(Array.isArray(data.pins) ? data.pins : []);
            if (resCustom.ok) {
                const cd = await resCustom.json();
                setCustomPins(Array.isArray(cd.pins) ? cd.pins : []);
            }
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
        // zoomControl a la derecha para que los botones +/− no choquen con el buscador (arriba-izquierda).
        const map = L.map(containerRef.current, { center, zoom, preferCanvas: true, zoomControl: false });
        L.control.zoom({ position: 'topright' }).addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 19
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        customLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        // Al mover/zoom: guarda cómo quedó el mapa (debounced).
        map.on('moveend', () => {
            const c = map.getCenter();
            saveView({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), zoom: map.getZoom() });
        });
        // En modo "agregar pin", un clic en el mapa abre el formulario del nuevo pin en ese punto.
        map.on('click', (e) => {
            if (!addModeRef.current) return;
            setDraft({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), label: '', note: '', color: 'blue' });
            setAddMode(false);
        });
        // Al abrir cualquier popup: enriquece demográficos y cablea los botones (chat / borrar pin).
        map.on('popupopen', (e) => {
            const root = e.popup?.getElement?.();
            if (root) handlePopupOpenRef.current(root);
        });
        setTimeout(() => map.invalidateSize(), 150);
        return () => { map.remove(); mapRef.current = null; };
    }, []);

    // Dibuja un pin (circleMarker de canvas) con su popup. Reusado por la carga y por el SSE en vivo.
    // `style` permite resaltar/atenuar el pin según el filtro de etiquetas (sin ocultar ninguno).
    const drawPin = useCallback((p, canvas, style) => {
        const base = { renderer: canvas, radius: 6, weight: 2, color: '#059669', fillColor: '#10b981', fillOpacity: 0.85 };
        const m = L.circleMarker([p.lat, p.lng], { ...base, ...(style || {}) });
        const tel = p.whatsapp ? String(p.whatsapp).replace(/\D/g, '') : '';
        const nombre = (p.nombre || 'Sin nombre').replace(/</g, '&lt;');
        const nombreAttr = encodeURIComponent(p.nombre || '');
        m.bindPopup(
            `<div style="min-width:210px">
               <div style="font-weight:700;margin-bottom:1px">${nombre}</div>
               ${tel ? `<div style="color:#6b7280;font-size:12px;margin-bottom:4px">${tel}</div>` : ''}
               <div class="map-cand-demo" data-cand="${p.id}"><div style="color:#9ca3af;font-size:11px;padding:4px 0">Cargando datos…</div></div>
               <button data-cand="${p.id}" data-nombre="${nombreAttr}" data-tel="${tel}" class="map-open-chat" style="cursor:pointer;border:0;background:#10b981;color:#fff;font-weight:600;font-size:12px;padding:6px 12px;border-radius:8px;width:100%">💬 Abrir chat</button>
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
        candMarkersRef.current = new Map();
        if (!pins.length) return;
        const canvas = L.canvas({ padding: 0.5 });
        const latlngs = [];
        const filtering = selectedTagsSet.size > 0;
        for (const p of pins) {
            let style;
            if (showAsistencias && p.asistencia === true) {
                // Asistencia confirmada → burbuja azul (tiene prioridad sobre el filtro de etiquetas).
                style = { radius: 9, weight: 3, color: '#ffffff', fillColor: '#1d4ed8', fillOpacity: 1 };
            } else if (filtering) {
                // ¿Coincide con alguna etiqueta seleccionada? → resalta con el color de esa etiqueta.
                const pinTags = (p.tags || []).map(t => String(t || '').trim().toLowerCase());
                const matched = pinTags.find(t => selectedTagsSet.has(t));
                if (matched) {
                    const color = tagColorMap.get(matched) || '#f97316';
                    style = { radius: 9, weight: 3, color: '#ffffff', fillColor: color, fillOpacity: 1 };
                } else {
                    // No coincide: se queda visible pero atenuado (no desaparece).
                    style = { radius: 5, weight: 1, color: '#9ca3af', fillColor: '#9ca3af', fillOpacity: 0.25 };
                }
            }
            const mk = drawPin(p, canvas, style);
            mk.addTo(layer);
            candMarkersRef.current.set(p.id, mk);
            latlngs.push([p.lat, p.lng]);
        }
        if (!hadSavedView.current && !didFit.current) {
            try {
                if (latlngs.length === 1) map.setView(latlngs[0], 14);
                else map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 });
            } catch { /* bounds vacíos */ }
            didFit.current = true;
        }
    }, [pins, drawPin, selectedTagsSet, tagColorMap, showAsistencias]);

    // Redibuja los pines personalizados (capa aparte). Marcador tipo "gota" con color + popup con nota y botón borrar.
    useEffect(() => {
        const layer = customLayerRef.current;
        if (!layer) return;
        layer.clearLayers();
        for (const p of customPins) {
            const hex = PIN_COLORS[p.color] || PIN_COLORS.blue;
            const label = (p.label || 'Pin').replace(/</g, '&lt;');
            const note = (p.note || '').replace(/</g, '&lt;');
            let icon;
            if (p.logo) {
                // Insignia circular con el logo del cliente: anillo de color, borde blanco, sombra y pulso + punta.
                icon = L.divIcon({
                    className: 'map-custom-pin',
                    html: `<div class="cm-badge" style="--cm-color:${hex}">
                             <span class="cm-pulse"></span>
                             <div class="cm-badge-ring">
                               <img src="${p.logo}" alt="" class="cm-badge-img" draggable="false" />
                             </div>
                             <span class="cm-badge-tip"></span>
                           </div>`,
                    iconSize: [56, 68], iconAnchor: [28, 64], popupAnchor: [0, -58], tooltipAnchor: [0, 2]
                });
            } else {
                // Gota SVG grande: relleno de color, borde blanco grueso, centro blanco + anillo de pulso.
                icon = L.divIcon({
                    className: 'map-custom-pin',
                    html: `<div class="cm-pin" style="--cm-color:${hex}">
                             <span class="cm-pulse"></span>
                             <svg width="40" height="52" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                               <path d="M20 1.5C9.5 1.5 1.5 9.5 1.5 20 1.5 34 20 50.5 20 50.5S38.5 34 38.5 20C38.5 9.5 30.5 1.5 20 1.5Z" fill="${hex}" stroke="#fff" stroke-width="3"/>
                               <circle cx="20" cy="19.5" r="7" fill="#fff"/>
                             </svg>
                           </div>`,
                    iconSize: [40, 52], iconAnchor: [20, 50], popupAnchor: [0, -46], tooltipAnchor: [0, -4]
                });
            }
            const m = L.marker([p.lat, p.lng], { icon, riseOnHover: true });
            // Nombre del cliente siempre visible debajo del pin.
            m.bindTooltip(label, { permanent: true, direction: 'bottom', offset: [0, 4], className: 'map-client-label', opacity: 1 });
            m.bindPopup(
                `<div style="min-width:180px">
                   <div style="display:flex;align-items:center;gap:8px;margin-bottom:${note ? '6px' : '8px'}">
                     ${p.logo ? `<img src="${p.logo}" alt="" style="width:34px;height:34px;border-radius:8px;object-fit:cover;border:2px solid ${hex}" />` : ''}
                     <div style="font-weight:800;font-size:14px">${label}</div>
                   </div>
                   ${note ? `<div style="color:#4b5563;font-size:12px;margin-bottom:8px;white-space:pre-wrap">${note}</div>` : ''}
                   <button data-pin="${p.id}" class="map-del-pin" style="cursor:pointer;border:0;background:#ef4444;color:#fff;font-weight:600;font-size:12px;padding:6px 12px;border-radius:8px">Borrar pin</button>
                 </div>`
            );
            m.addTo(layer);
            // Pinta el borde de la etiqueta con el color del pin (el tooltip es un DOM aparte del pin).
            const ttEl = m.getTooltip()?.getElement?.();
            if (ttEl) ttEl.style.setProperty('--cm-color', hex);
        }
    }, [customPins]);

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
                const next = prev.slice(); next[i] = { ...pin, tags: prev[i].tags || [] }; return next; // conserva etiquetas ya cargadas
            });
        };
        window.addEventListener('sse:location:pin', onPin);
        return () => window.removeEventListener('sse:location:pin', onPin);
    }, []);

    // Borra un pin personalizado (Redis + mapa). Usado desde el popup.
    const deletePin = useCallback(async (id) => {
        if (!id) return;
        setCustomPins(prev => prev.filter(p => p.id !== id));   // optimista
        try {
            await fetch(`/api/system/map-pins?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch { /* el optimista ya lo quitó; un Actualizar lo reconcilia */ }
        mapRef.current?.closePopup();
    }, []);

    // Al abrir un popup: Leaflet DETIENE la propagación del clic hacia el contenedor, así que la
    // delegación global no funciona — hay que enganchar los botones directamente en el DOM del popup.
    // Enriquece demográficos y cablea "Abrir chat" / "Borrar pin".
    const handlePopupOpen = useCallback((root) => {
        if (!root) return;
        const demo = root.querySelector('.map-cand-demo');
        if (demo) enrichPopup(demo);
        const chatBtn = root.querySelector('.map-open-chat');
        if (chatBtn) chatBtn.onclick = () => {
            setChatCandidate({
                id: chatBtn.dataset.cand,
                nombre: decodeURIComponent(chatBtn.dataset.nombre || ''),
                whatsapp: chatBtn.dataset.tel || ''
            });
            mapRef.current?.closePopup();
        };
        const delBtn = root.querySelector('.map-del-pin');
        if (delBtn) delBtn.onclick = () => deletePin(delBtn.dataset.pin);
    }, [enrichPopup, deletePin]);
    const handlePopupOpenRef = useRef(handlePopupOpen);
    useEffect(() => { handlePopupOpenRef.current = handlePopupOpen; }, [handlePopupOpen]);

    // Geocodifica el texto con Nominatim. Sesga la búsqueda hacia Nuevo León / Monterrey (viewbox)
    // pero sin excluir el resto (bounded=0), para que "una calle en MTY" salga primero.
    const runSearch = useCallback(async (q) => {
        const term = q.trim();
        if (!term) { setResults([]); setShowResults(false); return; }

        // ¿Escribió coordenadas? "25.6866, -100.3161" o "25.6866 -100.3161" → salta directo al punto.
        const coord = term.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
        if (coord) {
            const lat = Number(coord[1]), lng = Number(coord[2]);
            if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                searchAbortRef.current?.abort();
                setSearching(false);
                setResults([{ place_id: 'coords', lat: String(lat), lon: String(lng), display_name: `📍 Ir a coordenadas ${lat}, ${lng}` }]);
                setShowResults(true);
                return;
            }
        }

        // 👤 Candidatos del mapa que coincidan por teléfono o por nombre.
        const digits = term.replace(/\D/g, '');
        const lower = term.toLowerCase();
        const candMatches = [];
        for (const p of pinsRef.current) {
            const pd = String(p.whatsapp || '').replace(/\D/g, '');
            const byPhone = digits.length >= 3 && pd.includes(digits);
            const byName = lower.length >= 2 && String(p.nombre || '').toLowerCase().includes(lower);
            if (byPhone || byName) {
                candMatches.push({
                    type: 'candidate', place_id: 'c_' + p.id, id: p.id,
                    lat: String(p.lat), lon: String(p.lng), nombre: p.nombre || 'Sin nombre', whatsapp: pd
                });
            }
            if (candMatches.length >= 8) break;
        }

        // Si el término es básicamente un teléfono (puros dígitos/símbolos), no geocodificamos lugares.
        const phoneOnly = digits.length >= 4 && /^[\d\s+()-]+$/.test(term);
        if (phoneOnly) {
            searchAbortRef.current?.abort();
            setSearching(false);
            setResults(candMatches);
            setShowResults(true);
            return;
        }

        searchAbortRef.current?.abort();
        const ctrl = new AbortController();
        searchAbortRef.current = ctrl;
        setSearching(true);
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6`
                + `&countrycodes=mx&accept-language=es`
                + `&viewbox=-100.7,25.95,-99.9,25.4&q=${encodeURIComponent(term)}`;
            const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            // Candidatos primero, luego lugares.
            setResults([...candMatches, ...(Array.isArray(data) ? data : [])]);
            setShowResults(true);
        } catch (e) {
            if (e.name !== 'AbortError') { setResults(candMatches); setShowResults(true); }
        } finally {
            if (searchAbortRef.current === ctrl) setSearching(false);
        }
    }, []);

    // Debounce de la búsqueda mientras el usuario teclea.
    useEffect(() => {
        if (suppressSearchRef.current) { suppressSearchRef.current = false; return; }
        const t = setTimeout(() => { runSearch(query); }, 350);
        return () => clearTimeout(t);
    }, [query, runSearch]);

    // Mueve el mapa al resultado elegido y deja un marcador temporal con etiqueta.
    const goToResult = useCallback((r) => {
        const map = mapRef.current;
        if (!map || !r) return;
        const lat = Number(r.lat), lng = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        // Candidato del mapa: vuela a su pin y abre su popup (con demográficos + chat).
        if (r.type === 'candidate') {
            map.setView([lat, lng], Math.max(map.getZoom(), 16));
            const mk = candMarkersRef.current.get(r.id);
            if (mk) setTimeout(() => mk.openPopup(), 250);
            setShowResults(false);
            suppressSearchRef.current = true;
            setQuery(r.nombre || '');
            return;
        }

        if (searchMarkerRef.current) { map.removeLayer(searchMarkerRef.current); searchMarkerRef.current = null; }
        const icon = L.divIcon({
            className: 'map-search-pin',
            html: '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:rotate(-45deg)"></div>',
            iconSize: [20, 20], iconAnchor: [10, 20]
        });
        const marker = L.marker([lat, lng], { icon }).addTo(map);
        marker.bindPopup(`<div style="max-width:220px;font-size:12px">${String(r.display_name || '').replace(/</g, '&lt;')}</div>`).openPopup();
        searchMarkerRef.current = marker;
        map.setView([lat, lng], Math.max(map.getZoom(), 16));
        setShowResults(false);
        suppressSearchRef.current = true;
        setQuery(r.display_name ? String(r.display_name).split(',').slice(0, 2).join(',') : '');
    }, []);

    const clearSearch = useCallback(() => {
        setQuery(''); setResults([]); setShowResults(false);
        const map = mapRef.current;
        if (map && searchMarkerRef.current) { map.removeLayer(searchMarkerRef.current); searchMarkerRef.current = null; }
    }, []);

    // Reduce la imagen elegida a una miniatura cuadrada (máx 96px) y la devuelve como data URI
    // webp/jpeg comprimido (~3-10KB) para no inflar Redis. Recorta centrado (object-fit: cover).
    const [logoBusy, setLogoBusy] = useState(false);
    const onPickLogo = useCallback((file) => {
        if (!file || !file.type?.startsWith('image/')) return;
        setLogoBusy(true);
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const SIZE = 96;
                const canvas = document.createElement('canvas');
                canvas.width = SIZE; canvas.height = SIZE;
                const ctx = canvas.getContext('2d');
                const side = Math.min(img.width, img.height);
                const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
                ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
                let data = '';
                try { data = canvas.toDataURL('image/webp', 0.82); } catch { /* sin webp */ }
                if (!data || data.length < 30 || !data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.82);
                setDraft(d => d ? { ...d, logo: data } : d);
                setLogoBusy(false);
            };
            img.onerror = () => setLogoBusy(false);
            img.src = reader.result;
        };
        reader.onerror = () => setLogoBusy(false);
        reader.readAsDataURL(file);
    }, []);

    // Guarda el pin en edición (draft) en Redis y lo agrega a la lista.
    const savePin = useCallback(async () => {
        if (!draft) return;
        setSavingPin(true);
        try {
            const res = await fetch('/api/system/map-pins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
            setCustomPins(prev => [data.pin, ...prev]);
            setDraft(null);
        } catch (e) {
            setError(e.message || 'No se pudo guardar el pin');
        } finally { setSavingPin(false); }
    }, [draft]);

    // Cursor de cruz cuando está activo el modo "agregar pin".
    useEffect(() => {
        const el = containerRef.current;
        if (el) el.style.cursor = addMode ? 'crosshair' : '';
    }, [addMode]);

    return (
        <div className="flex flex-col h-full min-h-0 p-3 sm:p-6">
            <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <MapPin className="w-4 h-4 text-emerald-500" />
                    {loading ? 'Cargando ubicaciones…' : error ? <span className="text-red-500">{error}</span> : (
                        <span>
                            <strong>{pins.length}</strong> {pins.length === 1 ? 'candidato con ubicación' : 'candidatos con ubicación'}
                            {customPins.length > 0 && <span className="text-gray-400"> · <strong className="text-blue-500">{customPins.length}</strong> {customPins.length === 1 ? 'pin propio' : 'pines propios'}</span>}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative" ref={tagFilterRef}>
                        <button onClick={() => setShowTagFilter(v => !v)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showTagFilter || selectedTags.length ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                            <Tag className="w-3.5 h-3.5" />
                            Etiquetas{selectedTags.length ? ` (${selectedTags.length})` : ''}
                        </button>
                        {showTagFilter && (
                            <div className="absolute right-0 mt-1.5 w-72 z-[1000] rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden">
                                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                        <input
                                            value={tagSearch}
                                            onChange={(e) => setTagSearch(e.target.value)}
                                            placeholder="Buscar etiqueta…"
                                            className="w-full pl-8 pr-2 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                    </div>
                                </div>
                                {/* ~10 filas visibles, luego scroll (cada fila ~36px) */}
                                <div className="max-h-[360px] overflow-y-auto custom-scrollbar py-1">
                                    {filteredTags.length === 0 ? (
                                        <div className="px-3 py-3 text-xs text-gray-400 text-center">Sin etiquetas</div>
                                    ) : filteredTags.map((t) => {
                                        const key = String(t.name || '').trim().toLowerCase();
                                        const on = selectedTagsSet.has(key);
                                        return (
                                            <button
                                                key={key}
                                                onClick={() => setSelectedTags(prev => on ? prev.filter(x => x !== key) : [...prev, key])}
                                                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                            >
                                                <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${on ? 'border-transparent' : 'border-gray-300 dark:border-gray-600'}`}
                                                    style={on ? { background: t.color || '#3b82f6' } : {}}>
                                                    {on && <Check className="w-3 h-3 text-white" />}
                                                </span>
                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color || '#3b82f6' }} />
                                                <span className="flex-1 min-w-0 text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{t.name}</span>
                                                {typeof t.count === 'number' && <span className="text-[10px] text-gray-400 shrink-0">{t.count}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                                {selectedTags.length > 0 && (
                                    <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                                        <span className="text-[11px] text-gray-500 dark:text-gray-400">{selectedTags.length} seleccionada{selectedTags.length === 1 ? '' : 's'}</span>
                                        <button onClick={() => setSelectedTags([])} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-red-500">
                                            <X className="w-3 h-3" /> Limpiar
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <button onClick={() => setShowAsistencias(v => !v)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showAsistencias ? 'bg-blue-700 border-blue-700 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${showAsistencias ? 'bg-white' : 'bg-blue-700'}`} />
                        Ver asistencias{asistenciaCount ? ` (${asistenciaCount})` : ''}
                    </button>
                    <button onClick={() => { setAddMode(m => !m); setDraft(null); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${addMode ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                        <Plus className="w-3.5 h-3.5" />
                        {addMode ? 'Clic en el mapa…' : 'Agregar pin'}
                    </button>
                    <button onClick={load} disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50">
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Actualizar
                    </button>
                </div>
            </div>


            <div className="relative isolate flex-1 min-h-0 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                <div ref={containerRef} className="map-section-canvas absolute inset-0" />

                {/* 🔎 Buscador de lugares (flota sobre el mapa, arriba a la izquierda) */}
                <div className="absolute top-3 left-3 z-[500] w-[min(320px,calc(100%-24px))]">
                    <div className="relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onFocus={() => { if (results.length) setShowResults(true); }}
                            placeholder="Buscar candidato (tel/nombre), lugar o coordenadas…"
                            className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-md text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center">
                            {searching ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                                : query ? (
                                    <button onClick={clearSearch} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="Limpiar">
                                        <X className="w-4 h-4" />
                                    </button>
                                ) : null}
                        </div>
                    </div>

                    {showResults && (
                        <div className="mt-1.5 rounded-xl bg-white/98 dark:bg-gray-800/98 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                            {results.length === 0 ? (
                                <div className="px-3.5 py-3 text-xs text-gray-400">Sin resultados</div>
                            ) : results.map((r) => r.type === 'candidate' ? (
                                <button
                                    key={r.place_id}
                                    onClick={() => goToResult(r)}
                                    className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 border-b border-gray-100 dark:border-gray-700/50 last:border-0 flex items-center gap-2.5"
                                >
                                    <span className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
                                        <MessageSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{r.nombre}</span>
                                        <span className="block text-[11px] text-gray-400">{r.whatsapp} · candidato</span>
                                    </span>
                                </button>
                            ) : (
                                <button
                                    key={r.place_id}
                                    onClick={() => goToResult(r)}
                                    className="w-full text-left px-3.5 py-2.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 border-b border-gray-100 dark:border-gray-700/50 last:border-0 flex items-start gap-2"
                                >
                                    <MapPin className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                                    <span className="leading-snug">{r.display_name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pista del modo "agregar pin" */}
                {addMode && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-blue-500 text-white text-xs font-semibold px-3.5 py-2 rounded-full shadow-lg flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5" /> Haz clic en el mapa para colocar el pin
                        <button onClick={() => setAddMode(false)} className="ml-1 hover:opacity-80"><X className="w-3.5 h-3.5" /></button>
                    </div>
                )}

                {/* Formulario del pin en edición */}
                {draft && (
                    <div className="absolute inset-0 z-[600] flex items-center justify-center bg-black/30 p-4" onClick={() => !savingPin && setDraft(null)}>
                        <div onClick={(e) => e.stopPropagation()}
                            className="w-[min(340px,100%)] rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-blue-500" /> Nuevo pin</h3>
                                <button onClick={() => setDraft(null)} disabled={savingPin} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"><X className="w-4 h-4" /></button>
                            </div>
                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Nombre</label>
                            <input autoFocus type="text" value={draft.label} maxLength={120}
                                onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))}
                                placeholder="Ej. Oficina, Punto de entrevista…"
                                className="w-full mb-3 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Nota (opcional)</label>
                            <textarea value={draft.note} maxLength={500} rows={2}
                                onChange={(e) => setDraft(d => ({ ...d, note: e.target.value }))}
                                placeholder="Detalles del lugar…"
                                className="w-full mb-3 px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />

                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Logo del cliente (opcional)</label>
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-14 h-14 rounded-full shrink-0 flex items-center justify-center overflow-hidden border-2"
                                    style={{ borderColor: PIN_COLORS[draft.color] || PIN_COLORS.blue, background: (PIN_COLORS[draft.color] || PIN_COLORS.blue) + '18' }}>
                                    {logoBusy ? <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                                        : draft.logo ? <img src={draft.logo} alt="logo" className="w-full h-full object-cover" />
                                            : <MapPin className="w-5 h-5 text-gray-300" />}
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                                        <Plus className="w-3.5 h-3.5" /> {draft.logo ? 'Cambiar logo' : 'Subir logo'}
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickLogo(e.target.files?.[0])} />
                                    </label>
                                    {draft.logo && (
                                        <button type="button" onClick={() => setDraft(d => ({ ...d, logo: '' }))}
                                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                                            <Trash2 className="w-3.5 h-3.5" /> Quitar
                                        </button>
                                    )}
                                </div>
                            </div>

                            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Color</label>
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                                {Object.entries(PIN_COLORS).map(([key, hex]) => (
                                    <button key={key} type="button" onClick={() => setDraft(d => ({ ...d, color: key }))}
                                        className={`w-6 h-6 rounded-full border-2 transition-transform ${draft.color === key ? 'scale-110' : ''}`}
                                        style={{ backgroundColor: hex, borderColor: hex, ...(draft.color === key ? { boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${hex}` } : {}) }}
                                        title={key} />
                                ))}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-gray-400">{draft.lat}, {draft.lng}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => setDraft(null)} disabled={savingPin}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50">Cancelar</button>
                                    <button onClick={savePin} disabled={savingPin}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                                        {savingPin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Guardar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {!loading && !error && pins.length === 0 && customPins.length === 0 && (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none">
                        <div className="bg-white/90 dark:bg-gray-800/90 rounded-xl px-5 py-4 text-center shadow-lg border border-gray-200 dark:border-gray-700 pointer-events-auto">
                            <MessageSquare className="w-6 h-6 text-gray-400 mx-auto mb-1.5" />
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Aún no hay ubicaciones</p>
                            <p className="text-xs text-gray-400 mt-0.5">Aparecerán aquí cuando un candidato comparta su ubicación por WhatsApp, o crea tus propios pines con “Agregar pin”.</p>
                        </div>
                    </div>
                )}
            </div>

            {/* 💬 Ventana de chat embebida (la misma de Candidatos) */}
            <ErrorBoundary>
                <ChatWindow
                    isOpen={!!chatCandidate}
                    onClose={() => setChatCandidate(null)}
                    candidate={chatCandidate}
                />
            </ErrorBoundary>
        </div>
    );
}
