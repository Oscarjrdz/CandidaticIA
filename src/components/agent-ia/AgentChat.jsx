import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Bot, Wrench, FileText, BrainCircuit, Trash2 } from 'lucide-react';
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

const AgentChat = ({ hasApiKey, model, onAgentsUpdated, onMemoryProposed }) => {
    const [messages, setMessages] = useState(loadStoredMessages);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const endRef = useRef(null);

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

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
                memoryProposed: data.memoryProposed
            }]);
            if (data.agentsUpdated && onAgentsUpdated) onAgentsUpdated();
            if (data.memoryProposed && onMemoryProposed) onMemoryProposed();
        } catch (e) {
            setMessages((prev) => [...prev, { role: 'assistant', content: `No pude responder: ${e.message}` }]);
        } finally {
            setSending(false);
        }
    };

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
                    <div key={i} className="space-y-1">
                        <Bubble role={m.role}>{m.content}</Bubble>
                        {m.role === 'assistant' && (m.toolCalls > 0 || m.agentsUpdated || m.memoryProposed > 0) && (
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 pl-1">
                                {m.agentsUpdated && <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400"><FileText className="w-3 h-3" /> editó AGENTS.md</span>}
                                {m.memoryProposed > 0 && <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400"><BrainCircuit className="w-3 h-3" /> propuso {m.memoryProposed} memoria(s)</span>}
                                {m.toolCalls > 0 && <span className="inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> {m.toolCalls} herramienta(s)</span>}
                            </div>
                        )}
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
