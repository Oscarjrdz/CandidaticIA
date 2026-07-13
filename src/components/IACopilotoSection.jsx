import React, { useEffect, useState } from 'react';
import { Sparkles, LayoutDashboard, UserRound, Building2, GraduationCap } from 'lucide-react';
import ArchitectureMap from './brenda-training/ArchitectureMap';
import AgentsLibrary from './brenda-training/AgentsLibrary';
import SkillsLibrary from './brenda-training/SkillsLibrary';
import ComposePanel from './brenda-training/ComposePanel';
import ChatCandidatoPanel from './brenda-training/ChatCandidatoPanel';
import ChatTrainingPanel from './brenda-training/ChatTrainingPanel';
import PersonaPanel from './brenda-training/PersonaPanel';
import { apiFetch } from './brenda-training/api';

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN "Brenda IA" = workspace SKILLS CANDIDATIC.
//
// La casa "Skills Candidatic" donde viven los agentes. Modelo de 3 capas:
//   Brenda (cuenta WhatsApp/Meta, ya existe) → Agentes (reclutadores: estilo)
//   × Skills (clientes: hechos cerrados).  Ver api/utils/brenda-training.js.
//
// 4 pestañas:
//   • Arquitectura → el mapa visual + componer/probar (Agente × Skill).
//   • Agentes      → CRUD de reclutadores (Oscar Agent, Paty Agent…).
//   • Skills       → CRUD de clientes/vacantes (Skill Katcon, Skill Metalsa…).
//   • Entrenamiento→ las 3 herramientas originales (chat candidato, enseñar
//                    ejemplos, y editor/resync de la personalidad legada).
//
// El estado de agents/skills vive aquí (lifted) para que el mapa y el panel de
// composición reflejen lo que se crea en las otras pestañas sin recargar.
// NO toca a Brenda Extractora (api/ai/agent.js). Solo SuperAdmin.
// ════════════════════════════════════════════════════════════════════════════

const TABS = [
    { id: 'arquitectura', label: 'Arquitectura', icon: LayoutDashboard },
    { id: 'agentes', label: 'Agentes', icon: UserRound },
    { id: 'skills', label: 'Skills / Clientes', icon: Building2 },
    { id: 'entrenamiento', label: 'Entrenamiento', icon: GraduationCap }
];

const IACopilotoSection = () => {
    const [activeTab, setActiveTab] = useState('arquitectura');
    const [agents, setAgents] = useState([]);
    const [skills, setSkills] = useState([]);

    // Carga inicial para que el mapa y el panel de composición tengan datos
    // aunque el usuario aterrice en la pestaña Arquitectura (donde las librerías
    // CRUD no están montadas). Silencioso: si falla, las pestañas de CRUD
    // mostrarán su propio error al abrirlas.
    useEffect(() => {
        (async () => {
            try {
                const [a, s] = await Promise.all([
                    apiFetch('/api/brenda-training/agents'),
                    apiFetch('/api/brenda-training/skills')
                ]);
                setAgents(a.agents || []);
                setSkills(s.skills || []);
            } catch {
                /* las librerías CRUD reportan su propio error al abrir sus pestañas */
            }
        })();
    }, []);

    return (
        <div className="w-full max-w-6xl mx-auto space-y-5">
            {/* Encabezado */}
            <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Brenda IA · Skills Candidatic</h2>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
                            La casa donde viven los agentes reclutadores. Cada <strong>Agente</strong> (Oscar, Paty…) aporta el estilo;
                            cada <strong>Skill</strong> (Katcon, Metalsa…) aporta los hechos del cliente; <strong>Brenda</strong> (la cuenta de WhatsApp) es la cara que envía. Se componen en vivo.
                        </p>
                    </div>
                    <span className="hidden sm:inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">
                        Solo SuperAdmin
                    </span>
                </div>
            </section>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-gray-200 dark:border-gray-700">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = activeTab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
                                active
                                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                        >
                            <Icon className="w-4 h-4" /> {t.label}
                        </button>
                    );
                })}
            </div>

            {/* Contenido por pestaña */}
            {activeTab === 'arquitectura' && (
                <div className="space-y-5">
                    <ArchitectureMap agents={agents} skills={skills} />
                    <ComposePanel agents={agents} skills={skills} />
                </div>
            )}

            {activeTab === 'agentes' && (
                <AgentsLibrary onChange={setAgents} />
            )}

            {activeTab === 'skills' && (
                <SkillsLibrary onChange={setSkills} />
            )}

            {activeTab === 'entrenamiento' && (
                <div className="space-y-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Herramientas de entrenamiento: prueba la personalidad legada, enséñale ejemplos candidato→reclutador, y edita o
                        genera la guía de estilo desde tus chats reales. La propuesta que genera "Personalidad" puedes pegarla como
                        guía de estilo de un <strong>Agente</strong> en la pestaña Agentes.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                        <ChatCandidatoPanel />
                        <ChatTrainingPanel />
                        <PersonaPanel />
                    </div>
                </div>
            )}
        </div>
    );
};

export default IACopilotoSection;
