import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { X } from 'lucide-react';
import { NODE_DEFS, COLOR_CLASSES } from './nodeDefs';

// Un único componente renderiza los 9 tipos de nodo — la diferencia visual (ícono,
// color, texto resumen) sale de NODE_DEFS. La configuración real vive en el drawer
// lateral (NodeConfigDrawer), aquí solo se muestra un resumen legible.
const FlowNode = ({ id, type, data, selected }) => {
    const def = NODE_DEFS[type] || NODE_DEFS.contador;
    const colors = COLOR_CLASSES[def.color] || COLOR_CLASSES.gray;
    const Icon = def.icon;

    return (
        <div
            className={`group relative w-60 rounded-2xl border-2 shadow-sm cursor-pointer transition-shadow ${colors.bg} ${selected ? 'border-gray-900 dark:border-white shadow-md' : colors.border}`}
            onClick={() => data.onConfigure?.(id)}
        >
            {def.hasTarget && (
                <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white dark:!border-gray-900" />
            )}

            {data.onDelete && type !== 'inicio' && (
                <button
                    onClick={(e) => { e.stopPropagation(); data.onDelete(id); }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    title="Eliminar nodo"
                >
                    <X className="w-3 h-3" />
                </button>
            )}

            <div className="flex items-center gap-2 px-3 pt-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colors.icon}`}>
                    <Icon className="w-4 h-4 text-white" />
                </div>
                <span className={`text-xs font-semibold ${colors.text}`}>{def.label}</span>
            </div>

            <div className="px-3 pb-3 pt-1.5">
                <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{def.summary(data)}</p>
                {type === 'contador' && (
                    <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${colors.icon} text-white`}>
                        {data.liveCount ?? '—'}
                    </span>
                )}
            </div>

            {def.hasSource && (
                <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white dark:!border-gray-900" />
            )}
        </div>
    );
};

export default FlowNode;
