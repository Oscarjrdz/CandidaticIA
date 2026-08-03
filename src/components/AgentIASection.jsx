import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
// Panel dividido con el estilo de Candidatic, 4 columnas:
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

const AgentIASection = () => {
    const [loading, setLoading] = useState(true);
    const [agentsMd, setAgentsMd] = useState('');
    const [memoryMd, setMemoryMd] = useState('');
    const [pendingMemory, setPendingMemory] = useState([]);
    const [skills, setSkills] = useState([]);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [model, setModel] = useState('claude-opus-4-8');
    const [liveReload, setLiveReload] = useState(0); // bump → LiveAgentPanel refetch (el chat prendió/apagó)
    const [selectedLiveCandidate, setSelectedLiveCandidate] = useState(null); // candidato elegido en la cola → 4ª columna

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

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row h-full min-h-0 overflow-y-auto lg:overflow-x-auto lg:overflow-y-hidden bg-gray-50 dark:bg-[#0b141a]">
            {/* 1) Chat con el agente */}
            <div className="w-full lg:w-[320px] lg:shrink-0 h-[70vh] shrink-0 lg:h-full border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 min-h-0">
                <AgentChat
                    hasApiKey={hasApiKey}
                    model={model}
                    onAgentsUpdated={refreshAgents}
                    onMemoryProposed={refreshMemory}
                    onSkillsUpdated={refreshSkills}
                    onAgentLiveUpdated={() => setLiveReload((k) => k + 1)}
                />
            </div>

            {/* 2) Módulos: AGENTS.md, MEMORY.md, Skills */}
            <div className="w-full lg:flex-1 lg:min-w-[300px] h-[70vh] shrink-0 lg:h-full overflow-y-auto p-4 space-y-4 min-h-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700">
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

            {/* 3) Agent Candidatic: control/monitor de la atención automática en vivo */}
            <div className="w-full lg:w-[280px] lg:shrink-0 h-[70vh] shrink-0 lg:h-full p-4 min-h-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700">
                <LiveAgentPanel
                    reloadKey={liveReload}
                    selectedId={selectedLiveCandidate?.id}
                    onSelectCandidate={setSelectedLiveCandidate}
                />
            </div>

            {/* 4) Chat del candidato seleccionado en la cola (solo lectura) */}
            <div className="w-full lg:w-[300px] lg:shrink-0 h-[70vh] shrink-0 lg:h-full p-4 min-h-0">
                <LiveChatViewer candidate={selectedLiveCandidate} />
            </div>
        </div>
    );
};

export default AgentIASection;
