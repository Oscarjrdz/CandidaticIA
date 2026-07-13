import React, { useEffect, useState } from 'react';
import { Sparkles, MessageCircle, UserRound, Building2, X, ShieldCheck, ShieldAlert } from 'lucide-react';
import SkillsBrowser from './brenda-agent/SkillsBrowser';
import AgentChat from './brenda-agent/AgentChat';
import { agentFetch } from './brenda-agent/api';

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN "Brenda IA" = SKILLS CANDIDATIC, agente NATIVO de Anthropic (Claude).
//
// Reescrito desde cero sobre el estándar de Anthropic (borrado el sistema casero
// anterior que corría en GPT + JSON de Redis). Ahora:
//   - Skills = carpetas SKILL.md en /skills (formato oficial, versionadas en git).
//   - Agente = SDK oficial @anthropic-ai/sdk, claude-opus-4-8, adaptive thinking,
//     tool use real (herramienta consultar_vacante).
//
// Modelo de 3 capas: Brenda (canal WhatsApp/Meta, ya existe) + recruiter-* (estilo)
// × client-* (hechos del cliente). Solo SuperAdmin.
//
// Para ir en vivo falta configurar ANTHROPIC_API_KEY en Vercel (se avisa en la UI).
// ════════════════════════════════════════════════════════════════════════════

const AGENT_COLOR = '#2563eb';
const CLIENT_COLOR = '#d97706';
const BRENDA_COLOR = '#16a34a';

const ArchitectureMap = ({ recruiters, clients }) => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Arquitectura nativa</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                <strong>Brenda</strong> (canal) conduce a un <strong>reclutador</strong> (estilo) que se compone con un <strong>cliente</strong> (hechos). Todo corre sobre el agente nativo de Claude.
            </p>
        </div>

        {/* Brenda = canal */}
        <div className="flex flex-col items-center">
            <div className="flex items-center gap-3 rounded-2xl border-2 px-5 py-3 shadow-sm" style={{ borderColor: `${BRENDA_COLOR}66`, backgroundColor: `${BRENDA_COLOR}0f` }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${BRENDA_COLOR}22` }}>
                    <MessageCircle className="w-5 h-5" style={{ color: BRENDA_COLOR }} />
                </div>
                <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">Brenda</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">Cuenta de WhatsApp / Meta · el candidato siempre la ve · ya existe</div>
                </div>
            </div>
            <div className="w-px h-6" style={{ backgroundColor: `${BRENDA_COLOR}66` }} />
            <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">agente nativo de Claude →</div>
        </div>

        {/* recruiter × client */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2 mb-2">
                    <UserRound className="w-4 h-4" style={{ color: AGENT_COLOR }} />
                    <span className="text-xs font-bold" style={{ color: AGENT_COLOR }}>Reclutadores (estilo) · recruiter-*</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {recruiters.length === 0
                        ? <span className="text-[11px] text-gray-400">Sin skills recruiter-* aún</span>
                        : recruiters.map((r) => (
                            <span key={r.folder} className="text-xs font-semibold px-2.5 py-1 rounded-lg border bg-white dark:bg-gray-800" style={{ borderColor: `${AGENT_COLOR}55`, color: AGENT_COLOR }}>{r.name || r.folder}</span>
                        ))}
                </div>
            </div>
            <div className="flex items-center justify-center">
                <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center"><X className="w-5 h-5 text-gray-400 dark:text-gray-300" /></div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2 mb-2">
                    <Building2 className="w-4 h-4" style={{ color: CLIENT_COLOR }} />
                    <span className="text-xs font-bold" style={{ color: CLIENT_COLOR }}>Clientes (hechos) · client-*</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {clients.length === 0
                        ? <span className="text-[11px] text-gray-400">Sin skills client-* aún</span>
                        : clients.map((c) => (
                            <span key={c.folder} className="text-xs font-semibold px-2.5 py-1 rounded-lg border bg-white dark:bg-gray-800" style={{ borderColor: `${CLIENT_COLOR}55`, color: CLIENT_COLOR }}>{c.name || c.folder}</span>
                        ))}
                </div>
            </div>
        </div>
    </div>
);

const IACopilotoSection = () => {
    const [skills, setSkills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [model, setModel] = useState('claude-opus-4-8');

    useEffect(() => {
        (async () => {
            try {
                const data = await agentFetch('/api/brenda-agent/skills');
                setSkills(data.skills || []);
                setHasApiKey(Boolean(data.hasApiKey));
                if (data.model) setModel(data.model);
            } catch {
                /* la UI muestra estado vacío si falla */
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const recruiters = skills.filter((s) => s.kind === 'recruiter');
    const clients = skills.filter((s) => s.kind === 'client');

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
                            Agente <strong>nativo de Anthropic (Claude)</strong>. Los skills son carpetas <code className="text-xs">SKILL.md</code> versionadas en git;
                            el agente corre sobre el SDK oficial con tool use. Cada <strong>reclutador</strong> aporta el estilo, cada <strong>cliente</strong> los hechos, y <strong>Brenda</strong> (WhatsApp) es la cara que envía.
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className="hidden sm:inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">
                            Solo SuperAdmin
                        </span>
                        {!loading && (
                            hasApiKey ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><ShieldCheck className="w-3.5 h-3.5" /> Claude conectado</span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400" title="Falta ANTHROPIC_API_KEY en Vercel"><ShieldAlert className="w-3.5 h-3.5" /> Falta API key</span>
                            )
                        )}
                    </div>
                </div>
            </section>

            <ArchitectureMap recruiters={recruiters} clients={clients} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                <AgentChat skills={skills} hasApiKey={hasApiKey} model={model} />
                <SkillsBrowser skills={skills} loading={loading} />
            </div>
        </div>
    );
};

export default IACopilotoSection;
