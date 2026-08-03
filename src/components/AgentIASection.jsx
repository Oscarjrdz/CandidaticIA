import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, GripVertical } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuthContext } from '../contexts/AuthContext';
import AgentChat from './agent-ia/AgentChat';
import AgentsDocEditor from './agent-ia/DocEditor';
import MemoryPanel from './agent-ia/MemoryPanel';
import SkillsPanel from './agent-ia/SkillsPanel';
import LiveAgentPanel from './agent-ia/LiveAgentPanel';
import LiveChatViewer from './agent-ia/LiveChatViewer';
import { agentIAFetch } from './agent-ia/api';

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN "Agent IA" — el agente propio de Oscar (Claude nativo).
//
// 4 columnas, cada una al 25% de ancho, y REORDENABLES por drag & drop (arrastra
// desde el grip de cada encabezado). El orden se guarda en el perfil del usuario
// (preferences.agentColumnsOrder, mismo patrón que el orden de la Sidebar y del
// Banco de Respuestas) — persiste entre sesiones.
//
//   1) Chat con el agente.
//   2) Módulos: AGENTS.md (definición, editable por ti y por el agente), MEMORY.md
//      (memoria; el agente propone, tú apruebas), Skills (playbooks por cliente).
//   3) Agent Candidatic: control/monitor de la atención automática en vivo (mascota,
//      toggle, selector de etiquetas, cola de candidatos que se van completando).
//   4) Chat del candidato seleccionado en la cola (solo lectura, monitor).
//
// Los documentos viven en Redis (no en archivos de git) porque el agente los edita
// en vivo y el filesystem de Vercel es de solo lectura en producción. Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_ORDER = ['agent-chat', 'agent-modules', 'agent-live', 'agent-live-chat'];
const COLUMN_TITLES = {
    'agent-chat': 'Chat del agente',
    'agent-modules': 'Definición · Memoria · Skills',
    'agent-live': 'Agent Candidatic',
    'agent-live-chat': 'Chat del candidato'
};

// Columna arrastrable: el grip es el ÚNICO punto de agarre (no la tarjeta completa),
// para no interferir con clics/tecleo dentro del contenido (textarea del chat, etc.).
const SortableColumn = ({ id, isLast, children }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 40 : 'auto',
        opacity: isDragging ? 0.5 : 1
    };
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`w-full lg:w-1/4 lg:min-w-0 h-[70vh] lg:h-full shrink-0 flex flex-col ${!isLast ? 'border-b lg:border-b-0 lg:border-r' : ''} border-gray-200 dark:border-gray-700`}
        >
            <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 bg-gray-100/80 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <div
                    {...attributes}
                    {...listeners}
                    title="Arrastrar para reordenar"
                    className="cursor-grab active:cursor-grabbing p-1 -m-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors touch-none"
                >
                    <GripVertical className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">
                    {COLUMN_TITLES[id]}
                </span>
            </div>
            <div className="flex-1 min-h-0 min-w-0 p-2">
                {children}
            </div>
        </div>
    );
};

const AgentIASection = () => {
    const { user, setUser } = useAuthContext();
    const [loading, setLoading] = useState(true);
    const [agentsMd, setAgentsMd] = useState('');
    const [memoryMd, setMemoryMd] = useState('');
    const [pendingMemory, setPendingMemory] = useState([]);
    const [skills, setSkills] = useState([]);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [model, setModel] = useState('claude-opus-4-8');
    const [liveReload, setLiveReload] = useState(0); // bump → LiveAgentPanel refetch (el chat prendió/apagó)
    const [selectedLiveCandidate, setSelectedLiveCandidate] = useState(null); // candidato elegido en la cola → 4ª columna

    // ── Orden de columnas (drag & drop), guardado por reclutador ──────────────
    const [order, setOrder] = useState(() => {
        const saved = Array.isArray(user?.preferences?.agentColumnsOrder) ? user.preferences.agentColumnsOrder : [];
        const valid = saved.filter((id) => DEFAULT_ORDER.includes(id));
        const missing = DEFAULT_ORDER.filter((id) => !valid.includes(id)); // columnas nuevas a futuro → al final
        return valid.length ? [...valid, ...missing] : DEFAULT_ORDER;
    });

    const saveOrder = useCallback((nextOrder) => {
        setOrder(nextOrder);
        if (!user?.id) return;
        const nextPreferences = { ...(user.preferences || {}), agentColumnsOrder: nextOrder };
        setUser((prev) => (prev ? { ...prev, preferences: nextPreferences } : prev));
        fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, preferences: nextPreferences })
        }).catch(() => {});
    }, [user?.id, user?.preferences, setUser]);

    // Orientación del drag: horizontal en escritorio (columnas lado a lado),
    // vertical cuando se apilan en pantallas angostas.
    const [isWide, setIsWide] = useState(() => (typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true));
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const handler = (e) => setIsWide(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = order.indexOf(active.id);
            const newIndex = order.indexOf(over.id);
            saveOrder(arrayMove(order, oldIndex, newIndex));
        }
    };

    const load = useCallback(async () => {
        try {
            const [cfg, skillsData] = await Promise.all([
                agentIAFetch('/api/agent-ia/config'),
                agentIAFetch('/api/agent-ia/skills').catch(() => ({ skills: [] }))
            ]);
            setAgentsMd(cfg.agentsMd || '');
            setMemoryMd(cfg.memoryMd || '');
            setPendingMemory(Array.isArray(cfg.pendingMemory) ? cfg.pendingMemory : []);
            setHasApiKey(Boolean(cfg.hasApiKey));
            if (cfg.model) setModel(cfg.model);
            setSkills(Array.isArray(skillsData.skills) ? skillsData.skills : []);
        } catch {
            /* la UI muestra estado vacío si falla */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // El agente editó AGENTS.md (o propuso memoria) durante el chat → recargar del server.
    const refreshAgents = useCallback(async () => {
        try {
            const data = await agentIAFetch('/api/agent-ia/config');
            setAgentsMd(data.agentsMd || '');
        } catch { /* noop */ }
    }, []);

    const refreshMemory = useCallback(async () => {
        try {
            const data = await agentIAFetch('/api/agent-ia/config');
            setMemoryMd(data.memoryMd || '');
            setPendingMemory(Array.isArray(data.pendingMemory) ? data.pendingMemory : []);
        } catch { /* noop */ }
    }, []);

    // El agente creó/editó una skill durante el chat → recargar el listado.
    const refreshSkills = useCallback(async () => {
        try {
            const data = await agentIAFetch('/api/agent-ia/skills');
            setSkills(Array.isArray(data.skills) ? data.skills : []);
        } catch { /* noop */ }
    }, []);

    // Contenido de cada columna, por id — separado del orden en que se pintan.
    const columnContent = useMemo(() => ({
        'agent-chat': (
            <AgentChat
                hasApiKey={hasApiKey}
                model={model}
                onAgentsUpdated={refreshAgents}
                onMemoryProposed={refreshMemory}
                onSkillsUpdated={refreshSkills}
                onAgentLiveUpdated={() => setLiveReload((k) => k + 1)}
            />
        ),
        'agent-modules': (
            <div className="h-full overflow-y-auto space-y-4">
                <AgentsDocEditor value={agentsMd} onSaved={setAgentsMd} />
                <MemoryPanel
                    value={memoryMd}
                    pending={pendingMemory}
                    onSaved={setMemoryMd}
                    onResolved={(data) => {
                        if (typeof data.memoryMd === 'string') setMemoryMd(data.memoryMd);
                        if (Array.isArray(data.pendingMemory)) setPendingMemory(data.pendingMemory);
                    }}
                />
                <SkillsPanel skills={skills} onChange={(list) => setSkills(Array.isArray(list) ? list : [])} />
            </div>
        ),
        'agent-live': (
            <LiveAgentPanel
                reloadKey={liveReload}
                selectedId={selectedLiveCandidate?.id}
                onSelectCandidate={setSelectedLiveCandidate}
            />
        ),
        'agent-live-chat': <LiveChatViewer candidate={selectedLiveCandidate} />
    }), [hasApiKey, model, refreshAgents, refreshMemory, refreshSkills, agentsMd, memoryMd, pendingMemory, skills, liveReload, selectedLiveCandidate]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={isWide ? horizontalListSortingStrategy : verticalListSortingStrategy}>
                <div className="flex flex-col lg:flex-row h-full min-h-0 overflow-y-auto lg:overflow-hidden bg-gray-50 dark:bg-[#0b141a]">
                    {order.map((id, idx) => (
                        <SortableColumn key={id} id={id} isLast={idx === order.length - 1}>
                            {columnContent[id]}
                        </SortableColumn>
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    );
};

export default AgentIASection;
