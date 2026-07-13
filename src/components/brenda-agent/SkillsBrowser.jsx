import React, { useState } from 'react';
import { UserRound, Building2, BookOpen, FileCode2, Loader2, ChevronRight } from 'lucide-react';
import { agentFetch } from './api';
import { useToastContext } from '../../contexts/ToastContext';

// ════════════════════════════════════════════════════════════════════════════
// SkillsBrowser — muestra los skills NATIVOS (carpetas SKILL.md) de la librería.
// Solo lectura: la fuente de verdad son los archivos en /skills versionados en git.
// Clasifica por tipo: base / recruiter (agente) / client (cliente).
// ════════════════════════════════════════════════════════════════════════════

const KIND_META = {
    base: { label: 'Base', icon: BookOpen, color: '#16a34a' },
    recruiter: { label: 'Agente · reclutador', icon: UserRound, color: '#2563eb' },
    client: { label: 'Cliente · vacante', icon: Building2, color: '#d97706' }
};

const SkillsBrowser = ({ skills = [], loading }) => {
    const { showToast } = useToastContext();
    const [openFolder, setOpenFolder] = useState(null);
    const [body, setBody] = useState('');
    const [loadingBody, setLoadingBody] = useState(false);

    const openSkill = async (folder) => {
        if (openFolder === folder) { setOpenFolder(null); return; }
        setOpenFolder(folder);
        setLoadingBody(true);
        setBody('');
        try {
            const data = await agentFetch(`/api/brenda-agent/skills?folder=${encodeURIComponent(folder)}`);
            setBody(data.skill?.body || '(vacío)');
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setLoadingBody(false);
        }
    };

    const groups = ['base', 'recruiter', 'client'];

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
                <FileCode2 className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">Librería de skills nativos</h3>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Carpetas <code className="text-[10px]">SKILL.md</code> en <code className="text-[10px]">/skills</code> — formato oficial de Anthropic, versionadas en git.</p>
                </div>
            </div>

            {loading ? (
                <p className="text-xs text-gray-400 text-center py-6">Cargando skills…</p>
            ) : skills.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No se encontraron skills en /skills.</p>
            ) : (
                <div className="space-y-4">
                    {groups.map((g) => {
                        const items = skills.filter((s) => s.kind === g);
                        if (items.length === 0) return null;
                        const meta = KIND_META[g];
                        const Icon = meta.icon;
                        return (
                            <div key={g}>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
                                </div>
                                <div className="space-y-1.5">
                                    {items.map((s) => (
                                        <div key={s.folder} className="rounded-lg border border-gray-200 dark:border-gray-700" style={{ borderLeftWidth: 3, borderLeftColor: meta.color }}>
                                            <button onClick={() => openSkill(s.folder)} className="w-full flex items-start gap-2 px-3 py-2 text-left">
                                                <ChevronRight className={`w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0 transition-transform ${openFolder === s.folder ? 'rotate-90' : ''}`} />
                                                <div className="min-w-0">
                                                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{s.name || s.folder}</div>
                                                    <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{s.folder}/SKILL.md</div>
                                                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{s.description}</div>
                                                </div>
                                            </button>
                                            {openFolder === s.folder && (
                                                <div className="px-3 pb-3">
                                                    {loadingBody ? (
                                                        <div className="flex items-center gap-2 text-[11px] text-gray-400 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</div>
                                                    ) : (
                                                        <pre className="max-h-64 overflow-y-auto rounded-lg bg-gray-50 dark:bg-gray-900/50 p-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono border border-gray-100 dark:border-gray-700">{body}</pre>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SkillsBrowser;
