import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { X } from 'lucide-react';

// Botón "×" en el punto medio del conector, visible en hover — deja borrar una sola
// conexión sin tener que borrar el nodo completo (que se lleva todas sus conexiones).
// El path visible es delgado (2px, ver defaultEdgeOptions en FlowEditor.jsx), así que
// se dibuja un segundo path transparente y más ancho encima solo para detectar el
// hover/click con margen cómodo — mismo patrón que la franja ancha "interactionWidth"
// que React Flow ya usa internamente para sus edges por defecto.
//
// OJO con pointer-events: el contenedor `.react-flow__edgelabel-renderer` trae
// `pointer-events: none` en el CSS de @xyflow, y como la propiedad se HEREDA, cualquier
// hijo (el botón ×) queda sin poder recibir clics a menos que lo forcemos explícitamente
// a `pointer-events: all`. Quitar una clase `pointer-events-none` NO basta: restaura la
// herencia, y lo heredado sigue siendo `none`. Por eso el botón lleva pointerEvents:'all'.
const FlowEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data }) => {
    const [hovered, setHovered] = useState(false);
    const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

    const del = (e) => { e.stopPropagation(); e.preventDefault(); data?.onDelete?.(id); };

    return (
        <>
            <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
            {/* Franja ancha transparente: capta el hover y también borra al hacer clic
                directo sobre la línea (respaldo por si no atinas al botón ×). */}
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={24}
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={del}
            />
            <EdgeLabelRenderer>
                <button
                    onClick={del}
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                    className={`nodrag nopan absolute w-6 h-6 rounded-full bg-gray-700 text-white flex items-center justify-center shadow-md hover:bg-red-600 transition-opacity z-10 ${hovered ? 'opacity-100' : 'opacity-0'}`}
                    style={{
                        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                        // Sin esto el botón hereda pointer-events:none del edgelabel-renderer
                        // y, aunque se vea, no se puede clicar. Lo apagamos cuando está oculto
                        // para que no capte clics fantasma sobre el lienzo.
                        pointerEvents: hovered ? 'all' : 'none',
                    }}
                    title="Eliminar conector"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </EdgeLabelRenderer>
        </>
    );
};

export default FlowEdge;
