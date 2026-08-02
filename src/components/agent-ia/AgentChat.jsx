import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, Loader2, Bot, Wrench, FileText, BrainCircuit, Trash2, ThumbsUp, Puzzle, Coins, Rocket, Users, CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { agentIAFetch } from './api';

// ════════════════════════════════════════════════════════════════════════════
// AgentChat — chat con el agente propio (Claude nativo). El agente responde con
// su definición (AGENTS.md) + memoria (MEMORY.md), y puede editar AGENTS.md o
// proponer memoria en vivo. Al detectar esos cambios, avisa al padre para
// refrescar los paneles de la derecha.
//
// El transcript se persiste en localStorage por usuario para que un refresh NO
// borre la conversación (el backend es stateless: solo recibe el historial que
// le manda el front, así que sin esto se perdería todo al recargar).
// ════════════════════════════════════════════════════════════════════════════

const MAX_INPUT = 4000;
const MAX_HISTORY = 12;
const MAX_STORED = 60; // últimos N mensajes que se guardan (evita inflar localStorage)

function storageKey() {
    try {
        const raw = localStorage.getItem('candidatic_user_session');
        const user = raw ? JSON.parse(raw) : null;
        return `candidatic:agent_ia_chat:${user?.id || 'anon'}`;
    } catch {
        return 'candidatic:agent_ia_chat:anon';
    }
}

function loadStoredMessages() {
    try {
        const raw = localStorage.getItem(storageKey());
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

const Bubble = ({ role, children }) => (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] border border-gray-200 dark:border-gray-700 shadow-sm'
        }`}>{children}</div>
    </div>
);

const AgentChat = ({ hasApiKey, model, onAgentsUpdated, onMemoryProposed, onSkillsUpdated, onAgentLiveUpdated }) => {
    const [messages, setMessages] = useState(loadStoredMessages);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const endRef = useRef(null);
    const scrolledOnceRef = useRef(false);

    // Al ABRIR el chat: salto instantáneo al fondo (sin animación desde arriba).
    // En mensajes nuevos: scroll suave. useLayoutEffect corre antes del pintado,
    // así que el primer salto no se ve como un scroll animado.
    useLayoutEffect(() => {
        endRef.current?.scrollIntoView({ behavior: scrolledOnceRef.current ? 'smooth' : 'auto', block: 'end' });
        scrolledOnceRef.current = true;
    }, [messages, sending]);

    // Persiste el transcript (últimos MAX_STORED) para sobrevivir recargas.
    useEffect(() => {
        try {
            localStorage.setItem(storageKey(), JSON.stringify(messages.slice(-MAX_STORED)));
        } catch { /* cuota llena u otro: ignorar, no es crítico */ }
    }, [messages]);

    const clearChat = () => {
        setMessages([]);
        try { localStorage.removeItem(storageKey()); } catch { /* noop */ }
    };

    const send = async () => {
        const clean = input.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT);
        if (!clean || sending) return;
        setInput('');
        setSending(true);
        setMessages((prev) => [...prev, { role: 'user', content: clean }]);
        try {
            const history = messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
            const data = await agentIAFetch('/api/agent-ia/chat', {
                method: 'POST',
                body: { message: clean, history }
            });
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: data.reply || '(sin respuesta)',
                toolCalls: data.toolCalls,
                usageTokens: data.usageTokens,
                agentsUpdated: data.agentsUpdated,
                skillsUpdated: data.skillsUpdated,
                // tarjetas de aprobación en el chat; status por tarjeta: pending|busy|saved|discarded
                memoryProposals: Array.isArray(data.memoryProposals)
                    ? data.memoryProposals.map((p) => ({ ...p, status: 'pending' }))
                    : [],
                // tarjeta de envío masivo; bulkStatus: pending|sending|completed|canceled|error
                bulkProposal: data.bulkProposal || null,
                bulkStatus: data.bulkProposal ? 'pending' : null,
                bulkProgress: null,
                // tarjeta de edición de respuesta del banco; status: pending|busy|saved|discarded
                bankEditProposal: data.bankEditProposal ? { ...data.bankEditProposal, status: 'pending' } : null
            }]);
            if (data.agentsUpdated && onAgentsUpdated) onAgentsUpdated();
            if (data.skillsUpdated && onSkillsUpdated) onSkillsUpdated();
            if (data.memoryProposals?.length && onMemoryProposed) onMemoryProposed();
            if (data.agentLiveUpdated && onAgentLiveUpdated) onAgentLiveUpdated();
        } catch (e) {
            setMessages((prev) => [...prev, { role: 'assistant', content: `No pude responder: ${e.message}` }]);
        } finally {
            setSending(false);
        }
    };

    // Aprobar/descartar una propuesta de memoria DESDE el chat. Actualiza el status de la
    // tarjeta (persistido con el transcript) y refresca el panel derecho.
    const resolveInlineMemory = async (msgIdx, proposalId, action) => {
        const patch = (fields) => setMessages((prev) => prev.map((m, i) => (
            i !== msgIdx ? m : { ...m, memoryProposals: (m.memoryProposals || []).map((p) => (p.id === proposalId ? { ...p, ...fields } : p)) }
        )));
        patch({ status: 'busy', error: null });
        try {
            await agentIAFetch('/api/agent-ia/memory', { method: 'POST', body: { action, id: proposalId } });
            patch({ status: action === 'approve' ? 'saved' : 'discarded' });
            if (onMemoryProposed) onMemoryProposed(); // refresca MEMORY.md + pendientes del panel
        } catch (e) {
            // Error inline en la tarjeta (sin alert bloqueante); se puede reintentar.
            patch({ status: 'pending', error: `No se pudo ${action === 'approve' ? 'guardar' : 'descartar'}: ${e.message}` });
        }
    };

    // Aprobar/descartar una edición de respuesta del banco DESDE el chat (sin alert).
    const resolveInlineBankEdit = async (msgIdx, proposalId, action) => {
        const setStatus = (status) => setMessages((prev) => prev.map((m, i) => (
            i !== msgIdx ? m : { ...m, bankEditProposal: m.bankEditProposal ? { ...m.bankEditProposal, status } : m.bankEditProposal }
        )));
        setStatus('busy');
        try {
            await agentIAFetch('/api/agent-ia/quick-reply', { method: 'POST', body: { action, proposalId } });
            setStatus(action === 'approve' ? 'saved' : 'discarded');
        } catch (e) {
            setStatus('error');
            setMessages((prev) => prev.map((m, i) => (
                i !== msgIdx ? m : { ...m, bankEditProposal: m.bankEditProposal ? { ...m.bankEditProposal, error: e.message } : m.bankEditProposal }
            )));
        }
    };

    // ─── Envío masivo desde el chat ──────────────────────────────────────────
    // El envío corre en el SERVIDOR (bulk-send.js) y persiste su progreso en Redis,
    // así que NO depende de que la UI siga abierta. Aquí solo lo disparamos y
    // sondeamos el estado para pintar la barra de avance.
    const patchMsg = (msgIdx, patch) => setMessages((prev) => prev.map((m, i) => (i === msgIdx ? { ...m, ...patch } : m)));

    const activePolls = useRef(new Set());

    const pollBulk = async (msgIdx, proposalId) => {
        if (activePolls.current.has(proposalId)) return; // ya lo estamos sondeando
        activePolls.current.add(proposalId);
        try {
            // hasta ~5 min de sondeo (200ms/candidato + margen); se corta en estado terminal
            for (let i = 0; i < 300; i++) {
                let data;
                try {
                    data = await agentIAFetch(`/api/agent-ia/bulk-send?proposalId=${encodeURIComponent(proposalId)}`);
                } catch {
                    await new Promise((r) => setTimeout(r, 1500));
                    continue;
                }
                const st = data.state || {};
                const status = st.status === 'sending' || st.status === 'pending'
                    ? 'sending'
                    : (st.status === 'completed' ? 'completed' : (st.status === 'canceled' ? 'canceled' : 'sending'));
                patchMsg(msgIdx, {
                    bulkStatus: status,
                    bulkProgress: { sent: st.sent || 0, failed: st.failed || 0, total: st.total || 0, logs: (st.logs || []).slice(0, 6) }
                });
                if (st.status === 'completed' || st.status === 'canceled') break;
                await new Promise((r) => setTimeout(r, 1500));
            }
        } finally {
            activePolls.current.delete(proposalId);
        }
    };

    const confirmBulk = async (msgIdx, proposalId) => {
        patchMsg(msgIdx, { bulkStatus: 'sending', bulkError: null, bulkProgress: { sent: 0, failed: 0, total: 0, logs: [] } });
        try {
            await agentIAFetch('/api/agent-ia/bulk-send', { method: 'POST', body: { action: 'execute', proposalId } });
            pollBulk(msgIdx, proposalId);
        } catch (e) {
            // Error inline en la tarjeta (sin alert bloqueante); se puede reintentar.
            patchMsg(msgIdx, { bulkStatus: 'error', bulkError: e.message || 'Error de red' });
        }
    };

    const cancelBulk = async (msgIdx, proposalId, wasSending) => {
        if (!wasSending) { patchMsg(msgIdx, { bulkStatus: 'canceled' }); return; }
        try {
            await agentIAFetch('/api/agent-ia/bulk-send', { method: 'POST', body: { action: 'cancel', proposalId } });
            // el polling recogerá el estado 'canceled' del servidor
        } catch (e) {
            patchMsg(msgIdx, { bulkError: `No se pudo cancelar: ${e.message}` });
        }
    };

    // Al montar (o tras un refresh): reanuda el sondeo de cualquier envío que
    // quedara 'sending'. El envío sigue vivo en el servidor aunque se recargue.
    useEffect(() => {
        messages.forEach((m, i) => {
            if (m.bulkStatus === 'sending' && m.bulkProposal?.id) pollBulk(i, m.bulkProposal.id);
        });
    }, []);

    return (
        <div className="flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a]">
            {/* Header */}
            <div className="shrink-0 px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-sm">
                    <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Agente</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {hasApiKey ? `Claude · ${model || 'claude-opus-4-8'}` : 'Falta ANTHROPIC_API_KEY'}
                    </div>
                </div>
                {messages.length > 0 && (
                    <button onClick={clearChat} title="Limpiar conversación" className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>

            {!hasApiKey && (
                <div className="shrink-0 mx-3 mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    ⚠️ Falta <code className="font-mono">ANTHROPIC_API_KEY</code> en Vercel. El agente responderá un aviso hasta que se configure.
                </div>
            )}

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 min-h-0">
                {messages.length === 0 && (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 text-center pt-10 px-6">
                        Habla con tu agente. Responde según su definición (AGENTS.md) y su memoria (MEMORY.md), y puede editar su propia definición o proponer memoria cuando se lo pidas.
                    </p>
                )}
                {messages.map((m, i) => (
                    <div key={i} className="space-y-1.5">
                        <Bubble role={m.role}>{m.content}</Bubble>

                        {m.role === 'assistant' && (m.toolCalls > 0 || m.agentsUpdated || m.skillsUpdated || m.usageTokens > 0) && (
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 pl-1">
                                {m.agentsUpdated && <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400"><FileText className="w-3 h-3" /> editó AGENTS.md</span>}
                                {m.skillsUpdated && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><Puzzle className="w-3 h-3" /> guardó una skill</span>}
                                {m.toolCalls > 0 && <span className="inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> {m.toolCalls} herramienta(s)</span>}
                                {m.usageTokens > 0 && <span className="inline-flex items-center gap-1"><Coins className="w-3 h-3" /> {m.usageTokens.toLocaleString('es-MX')} tokens</span>}
                            </div>
                        )}

                        {/* Tarjetas de memoria propuesta: aprobar/descartar SIN salir del chat */}
                        {m.role === 'assistant' && Array.isArray(m.memoryProposals) && m.memoryProposals.map((p) => (
                            <div key={p.id} className="flex items-start gap-2 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/15 px-3 py-2 max-w-[92%]">
                                <BrainCircuit className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-0.5">¿Guardar en memoria?</div>
                                    <p className="text-[13px] text-gray-700 dark:text-gray-200 leading-snug break-words">{p.text}</p>
                                    {(p.status === 'pending' || p.status === 'busy') ? (
                                        <div className="flex items-center gap-2 mt-2">
                                            <button onClick={() => resolveInlineMemory(i, p.id, 'approve')} disabled={p.status === 'busy'} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors">
                                                {p.status === 'busy' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />} Guardar
                                            </button>
                                            <button onClick={() => resolveInlineMemory(i, p.id, 'reject')} disabled={p.status === 'busy'} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
                                                Descartar
                                            </button>
                                            {p.error && <span className="text-[11px] text-red-500">{p.error}</span>}
                                        </div>
                                    ) : (
                                        <div className={`mt-1.5 text-[11px] font-semibold inline-flex items-center gap-1 ${p.status === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                            {p.status === 'saved' ? <><ThumbsUp className="w-3 h-3" /> Guardado en MEMORY.md</> : 'Descartado'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Tarjeta de edición de respuesta del banco: antes/después + Aprobar/Descartar */}
                        {m.role === 'assistant' && m.bankEditProposal && (() => {
                            const e = m.bankEditProposal;
                            return (
                                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/15 px-3 py-2.5 max-w-[92%]">
                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide mb-1.5">
                                        <Pencil className="w-3.5 h-3.5" /> Editar respuesta del banco: "{e.name}"
                                    </div>
                                    <div className="space-y-1.5 mb-2">
                                        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 px-2.5 py-1.5">
                                            <div className="text-[9px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-0.5">Actual</div>
                                            <p className="text-[12px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words line-through decoration-red-300/60">{e.before || '(sin texto)'}</p>
                                        </div>
                                        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/50 px-2.5 py-1.5">
                                            <div className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-0.5">Nuevo</div>
                                            <p className="text-[12px] text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">{e.after}</p>
                                        </div>
                                    </div>
                                    {(e.status === 'pending' || e.status === 'busy' || e.status === 'error') ? (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => resolveInlineBankEdit(i, e.id, 'approve')} disabled={e.status === 'busy'} className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors">
                                                {e.status === 'busy' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Aprobar cambio
                                            </button>
                                            <button onClick={() => resolveInlineBankEdit(i, e.id, 'reject')} disabled={e.status === 'busy'} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
                                                Descartar
                                            </button>
                                            {e.status === 'error' && <span className="text-[11px] text-red-500">{e.error || 'No se pudo aplicar.'}</span>}
                                        </div>
                                    ) : (
                                        <div className={`text-[11px] font-semibold inline-flex items-center gap-1 ${e.status === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                            {e.status === 'saved' ? <><CheckCircle2 className="w-3.5 h-3.5" /> Guardado en el banco</> : 'Descartado'}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Tarjeta de envío masivo: destinatarios + Confirmar/Cancelar + progreso en vivo */}
                        {m.role === 'assistant' && m.bulkProposal && (() => {
                            const p = m.bulkProposal;
                            const prog = m.bulkProgress || { sent: 0, failed: 0, total: p.candidateCount || 0, logs: [] };
                            const total = prog.total || p.candidateCount || 0;
                            const done = (prog.sent || 0) + (prog.failed || 0);
                            const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
                            return (
                                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2.5 max-w-[92%]">
                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">
                                        <Rocket className="w-3.5 h-3.5" /> Envío del banco: "{p.templateName}"
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[12px] text-gray-700 dark:text-gray-200 mb-0.5">
                                        <Users className="w-3.5 h-3.5 shrink-0" /> {p.candidateCount} destinatario(s)
                                    </div>
                                    {p.mixSummary && (
                                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5 pl-5">
                                            Cada uno recibe: <span className="font-medium text-gray-700 dark:text-gray-300">{p.mixSummary}</span>
                                        </div>
                                    )}

                                    {/* Lista de destinatarios (scroll si son muchos) */}
                                    <div className="max-h-40 overflow-y-auto rounded-lg bg-white/70 dark:bg-black/20 border border-emerald-100 dark:border-emerald-900 divide-y divide-emerald-100 dark:divide-emerald-900/50 mb-2">
                                        {(p.candidates || []).map((c, ci) => (
                                            <div key={c.id || ci} className="flex items-center justify-between gap-2 px-2.5 py-1 text-[11px]">
                                                <span className="truncate text-gray-700 dark:text-gray-200">{ci + 1}. {c.name}</span>
                                                <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">{c.phone}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Error inline (sin alert bloqueante) + reintentar */}
                                    {m.bulkStatus === 'error' && (
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                                                <XCircle className="w-3.5 h-3.5" /> {m.bulkError || 'No se pudo iniciar el envío.'}
                                            </span>
                                            <button onClick={() => confirmBulk(i, p.id)} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                                                Reintentar
                                            </button>
                                        </div>
                                    )}

                                    {/* Estado / progreso */}
                                    {m.bulkStatus === 'pending' && (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => confirmBulk(i, p.id)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                                                <Rocket className="w-3.5 h-3.5" /> Confirmar envíos
                                            </button>
                                            <button onClick={() => cancelBulk(i, p.id, false)} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                                Cancelar
                                            </button>
                                        </div>
                                    )}

                                    {(m.bulkStatus === 'sending' || m.bulkStatus === 'completed' || m.bulkStatus === 'canceled') && (
                                        <div className="space-y-1.5">
                                            <div className="h-2 rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all duration-300 ${m.bulkStatus === 'canceled' ? 'bg-gray-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                                            </div>
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span className="inline-flex items-center gap-1 font-semibold">
                                                    {m.bulkStatus === 'sending' && <><Loader2 className="w-3 h-3 animate-spin text-emerald-600" /> Enviando…</>}
                                                    {m.bulkStatus === 'completed' && <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Completado</>}
                                                    {m.bulkStatus === 'canceled' && <><XCircle className="w-3.5 h-3.5 text-gray-400" /> Cancelado</>}
                                                </span>
                                                <span className="text-gray-600 dark:text-gray-300">
                                                    {prog.sent} enviados{prog.failed ? ` · ${prog.failed} fallidos` : ''} / {total}
                                                </span>
                                            </div>
                                            {m.bulkStatus === 'sending' && (
                                                <button onClick={() => cancelBulk(i, p.id, true)} className="text-[10px] font-semibold text-red-500 hover:underline">
                                                    Detener envío
                                                </button>
                                            )}
                                            {prog.logs?.length > 0 && (
                                                <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto font-mono text-[10px] text-gray-500 dark:text-gray-400">
                                                    {prog.logs.map((l, li) => <div key={li} className="truncate">{l}</div>)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                ))}
                {sending && (
                    <Bubble role="assistant"><span className="flex items-center gap-2 text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Pensando…</span></Bubble>
                )}
                <div ref={endRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 px-3 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-gray-200 dark:border-gray-700 flex items-end gap-2">
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="Escribe un mensaje…"
                    rows={1}
                    className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a3942] px-3 py-2 text-sm text-[#111b21] dark:text-white outline-none focus:border-purple-500 max-h-32"
                />
                <button onClick={send} disabled={sending || !input.trim()} className="w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white flex items-center justify-center transition-colors shrink-0">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
            </div>
        </div>
    );
};

export default AgentChat;
