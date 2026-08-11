import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { X } from 'lucide-react';

// Botón "×" en el punto medio del conector, visible en hover — deja borrar una sola
// conexión sin tener que borrar el nodo completo (que se lleva todas sus conexiones).
// El path visible es delgado (2px, ver defaultEdgeOptions en FlowEditor.jsx), así que
// se dibuja un segundo path transparente y más ancho encima solo para detectar el
// hover/click con margen cómodo — mismo patrón que la franja ancha "interactionWidth"
// que React Flow ya usa internamente para sus edges por defecto.
const FlowEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data }) => {
    const [hovered, setHovered] = useState(false);
    const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

    return (
        <>
            <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={(e) => { e.stopPropagation(); data?.onDelete?.(id); }}
            />
            <EdgeLabelRenderer>
                <button
                    onClick={(e) => { e.stopPropagation(); data?.onDelete?.(id); }}
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                    className={`nodrag nopan absolute w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center hover:bg-red-600 transition-opacity z-10 ${hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
                    title="Eliminar conector"
                >
                    <X className="w-3 h-3" />
                </button>
            </EdgeLabelRenderer>
        </>
    );
};

export default FlowEdge;
