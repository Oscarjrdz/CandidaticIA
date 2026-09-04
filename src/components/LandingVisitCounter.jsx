import { useEffect, useState } from 'react';

/**
 * Contador de visitas para el footer de la landing. Muestra UN solo número:
 * el total de visitas (nuevas + revisitas). Lee /api/lp/visit (endpoint público,
 * cacheado 60s). Estilo Candidatic (naranja). Ver docs/contador-visitas-landing.md
 */
export default function LandingVisitCounter({ className = '' }) {
    const [total, setTotal] = useState(null);

    useEffect(() => {
        let alive = true;
        fetch('/api/lp/visit')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (alive && d && typeof d.total === 'number') setTotal(d.total); })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    if (total === null) return null; // sin parpadeo mientras carga

    return (
        <span className={`inline-flex items-center gap-1.5 text-xs text-gray-500 ${className}`}>
            <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
            </span>
            <span className="font-semibold text-orange-500 tabular-nums">
                {total.toLocaleString('es-MX')}
            </span>
            <span>visitas</span>
        </span>
    );
}
