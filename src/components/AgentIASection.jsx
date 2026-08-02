import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import AgentChat from './agent-ia/AgentChat';
import AgentsDocEditor from './agent-ia/DocEditor';
import MemoryPanel from './agent-ia/MemoryPanel';
import SkillsPanel from './agent-ia/SkillsPanel';
import { agentIAFetch } from './agent-ia/api';

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN "Agent IA" — el agente propio de Oscar (Claude nativo).
//
// Panel dividido con el estilo de Candidatic:
//   Izquierda  → chat con el agente.
//   Derecha    → 3 módulos apilados: AGENTS.md (definición, editable por ti y por
//                el agente), MEMORY.md (memoria; el agente propone, tú apruebas),
//                y Skills de reclutamiento (playbooks por cliente; ver/editar/crear).
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
        <div className="flex flex-col md:flex-row h-full min-h-0 bg-gray-50 dark:bg-[#0b141a]">
            {/* Izquierda: chat */}
            <div className="w-full md:w-[46%] md:max-w-[560px] h-1/2 md:h-full border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 min-h-0">
                <AgentChat
                    hasApiKey={hasApiKey}
                    model={model}
                    onAgentsUpdated={refreshAgents}
                    onMemoryProposed={refreshMemory}
                    onSkillsUpdated={refreshSkills}
                />
            </div>

            {/* Derecha: 3 módulos apilados */}
            <div className="flex-1 h-1/2 md:h-full overflow-y-auto p-4 space-y-4 min-h-0">
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
        </div>
    );
};

export default AgentIASection;
