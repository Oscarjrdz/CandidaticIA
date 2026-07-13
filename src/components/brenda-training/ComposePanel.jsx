import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, Send, Loader2, Eye, MessageCircle } from 'lucide-react';
import TrainingBubble from './TrainingBubble';
import { apiFetch } from './api';
import { getSessionToken } from './session';
import { useToastContext } from '../../contexts/ToastContext';

// ════════════════════════════════════════════════════════════════════════════
// ComposePanel — el "arma la receta y pruébala".
// 1) Eliges un Agente (estilo) × una Skill (cliente).
// 2) Ves el system prompt ENSAMBLADO (Brenda + Agente + Skill) — lo mismo que
//    consumiría el agente conversacional. Puro texto, no gasta tokens.
// 3) Pruebas un chat actuando como candidato: usa esa composición real (via GPT
//    hoy; mañana este mismo ensamblado alimenta el agente Claude).
// ════════════════════════════════════════════════════════════════════════════

const MAX_INPUT = 900;
const MAX_HISTORY = 8;

const ComposePanel = ({ agents = [], skills = [] }) => {
    const { showToast } = useToastContext();
    const [agentId, setAgentId] = useState('');
    const [skillId, setSkillId] = useState('');
    const [prompt, setPrompt] = useState('');
    const [showPrompt, setShowPrompt] = useState(false);
    const [loadingPrompt, setLoadingPrompt] = useState(false);

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const endRef = useRef(null);

    // Autoselección: si hay agentes/skills y aún no hay uno elegido, toma el primero.
    useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);
    useEffect(() => { if (!skillId && skills[0]) setSkillId(skills[0].id); }, [skills, skillId]);

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

    const compactHistory = useMemo(
        () => messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 700) })),
        [messages]
    );

    const loadPrompt = async () => {
        setLoadingPrompt(true);
        try {
            const qs = new URLSearchParams();
            if (agentId) qs.set('agentId', agentId);
            if (skillId) qs.set('skillId', skillId);
            const data = await apiFetch(`/api/brenda-training/compose?${qs.toString()}`);
            setPrompt(data.systemPrompt || '');
            setShowPrompt(true);
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setLoadingPrompt(false);
        }
    };

    const sendMessage = async () => {
        const clean = input.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT);
        if (!clean || sending) return;
        setInput('');
        setSending(true);
        setMessages((prev) => [...prev, { role: 'user', content: clean }]);
        try {
            const res = await fetch('/api/brenda-training/chat-candidato', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` },
                body: JSON.stringify({ message: clean, history: compactHistory, agentId, skillId })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo contactar a Brenda');
            setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
        } catch (e) {
            setMessages((prev) => [...prev, { role: 'assistant', content: `No pude responder: ${e.message}` }]);
        } finally {
            setSending(false);
        }
    };

    const noData = agents.length === 0 || skills.length === 0;

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
                <Wand2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">Componer y probar</h3>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Brenda + un agente + una skill. Mira el prompt ensamblado y pruébalo como candidato.</p>
                </div>
            </div>

            {noData && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg px-3 py-2">
                    Necesitas al menos un agente y una skill para componer. Créalos en las pestañas de Agentes y Skills.
                </p>
            )}

            {/* Selectores Agente × Skill */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-3">
                <select
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="text-sm rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10 px-3 py-2 text-gray-900 dark:text-white outline-none"
                >
                    <option value="">— Agente —</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <span className="text-center text-gray-400 font-bold">×</span>
                <select
                    value={skillId}
                    onChange={(e) => setSkillId(e.target.value)}
                    className="text-sm rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 px-3 py-2 text-gray-900 dark:text-white outline-none"
                >
                    <option value="">— Skill / cliente —</option>
                    {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
            </div>

            <button
                onClick={loadPrompt}
                disabled={loadingPrompt || (!agentId && !skillId)}
                className="w-full mb-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-700 dark:text-gray-200 text-xs font-semibold px-3 py-2 transition-colors disabled:opacity-50"
            >
                {loadingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Ver prompt ensamblado
            </button>

            {showPrompt && (
                <pre className="mb-3 max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                    {prompt}
                </pre>
            )}

            {/* Mini chat de prueba */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Prueba: escribe como candidato</span>
                </div>
                <div className="h-52 overflow-y-auto px-3 py-3 space-y-2 bg-white dark:bg-gray-950">
                    {messages.length === 0 && (
                        <p className="text-[11px] text-gray-400 text-center pt-6">Manda un mensaje como si fueras el candidato para ver cómo responde esta composición.</p>
                    )}
                    {messages.map((m, i) => <TrainingBubble key={i} role={m.role}>{m.content}</TrainingBubble>)}
                    {sending && <TrainingBubble role="assistant"><span className="flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Pensando</span></TrainingBubble>}
                    <div ref={endRef} />
                </div>
                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                        placeholder="Escribe como candidato…"
                        rows={1}
                        className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                    />
                    <button
                        onClick={sendMessage}
                        disabled={sending || !input.trim()}
                        className="w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center justify-center transition-colors"
                    >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ComposePanel;
