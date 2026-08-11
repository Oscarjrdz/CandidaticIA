import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { X, Play, Loader2 } from 'lucide-react';
import { NODE_DEFS, COLOR_CLASSES } from './nodeDefs';

const InicioToggle = ({ active, onToggle }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
        className={`nodrag mt-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
            active
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700'
                : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
        }`}
    >
        <span className={`w-7 h-3.5 rounded-full flex items-center px-0.5 transition-colors ${active ? 'bg-emerald-500 justify-end' : 'bg-gray-300 dark:bg-gray-500 justify-start'}`}>
            <span className="w-2.5 h-2.5 rounded-full bg-white shadow" />
        </span>
        {active ? 'Flujo activo' : 'Flujo inactivo'}
    </button>
);

const TestNodeBody = ({ id, data, colors }) => {
    const status = data.testStatus || 'idle';
    return (
        <div className="px-3 pb-3 pt-1.5 space-y-2">
            <input
                type="tel"
                value={data.testPhone || ''}
                onChange={(e) => data.onTestPhoneChange?.(id, e.target.value)}
                placeholder="Ej. 8181234567"
                className="nodrag w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
                onClick={(e) => { e.stopPropagation(); data.onTestRun?.(id, data.testPhone); }}
                disabled={status === 'running' || !data.testPhone}
                className={`nodrag w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50 ${colors.icon}`}
            >
                {status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {status === 'running' ? 'Corriendo...' : 'Run'}
            </button>
            {data.testMessage && (
                <p className={`text-xs ${status === 'error' ? 'text-red-500' : status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                    {data.testMessage}
                </p>
            )}
        </div>
    );
};

// Un único componente renderiza todos los tipos de nodo — la diferencia visual (ícono,
// color, texto resumen) sale de NODE_DEFS. La configuración real vive en el drawer
// lateral (NodeConfigDrawer), salvo "inicio" (toggle inline) y "test" (input+run inline).
const FlowNode = ({ id, type, data, selected }) => {
    const def = NODE_DEFS[type] || NODE_DEFS.contador;
    const colors = COLOR_CLASSES[def.color] || COLOR_CLASSES.gray;
    const Icon = def.icon;
    const isTest = type === 'test';

    return (
        <div
            className={`group relative w-60 rounded-2xl border-2 shadow-sm transition-shadow ${colors.bg} ${isTest ? '' : 'cursor-pointer'} ${selected ? 'border-gray-900 dark:border-white shadow-md' : colors.border}`}
            onClick={isTest ? undefined : () => data.onConfigure?.(id)}
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

            {isTest ? (
                <TestNodeBody id={id} data={data} colors={colors} />
            ) : (
                <div className="px-3 pb-3 pt-1.5">
                    <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{def.summary(data)}</p>
                    {type === 'contador' && (
                        <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${colors.icon} text-white`}>
                            {data.liveCount ?? '—'}
                        </span>
                    )}
                    {type === 'inicio' && (
                        <InicioToggle active={!!data.active} onToggle={data.onToggleActive} />
                    )}
                </div>
            )}

            {def.hasSource && (
                <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white dark:!border-gray-900" />
            )}
        </div>
    );
};

export default FlowNode;
