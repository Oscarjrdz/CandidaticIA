import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, Bot, Wrench } from 'lucide-react';
import { agentFetch } from './api';

// ════════════════════════════════════════════════════════════════════════════
// AgentChat — prueba el AGENTE NATIVO de Claude en vivo.
// Eliges un reclutador (recruiter-*) × un cliente (client-*) y chateas como
// candidato. El backend corre Claude (SDK oficial) con tool use: el agente puede
// llamar `consultar_vacante` para leer los hechos del cliente. El "toolCalls" que
// se muestra confirma cuándo el agente usó la herramienta.
// ════════════════════════════════════════════════════════════════════════════

const MAX_INPUT = 1500;
const MAX_HISTORY = 10;

const Bubble = ({ role, children }) => (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed border whitespace-pre-wrap ${
            role === 'user'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-700'
        }`}>{children}</div>
    </div>
);

const AgentChat = ({ skills = [], hasApiKey, model }) => {
    const recruiters = useMemo(() => skills.filter((s) => s.kind === 'recruiter'), [skills]);
    const clients = useMemo(() => skills.filter((s) => s.kind === 'client'), [skills]);

    const [recruiter, setRecruiter] = useState('');
    const [client, setClient] = useState('');
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const endRef = useRef(null);

    useEffect(() => { if (!recruiter && recruiters[0]) setRecruiter(recruiters[0].folder); }, [recruiters, recruiter]);
    useEffect(() => { if (!client && clients[0]) setClient(clients[0].folder); }, [clients, client]);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

    const send = async () => {
        const clean = input.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT);
        if (!clean || sending) return;
        setInput('');
        setSending(true);
        setMessages((prev) => [...prev, { role: 'user', content: clean }]);
        try {
            const history = messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
            const data = await agentFetch('/api/brenda-agent/chat', {
                method: 'POST',
                body: { message: clean, history, recruiter, client }
            });
            setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, toolCalls: data.toolCalls, usageTokens: data.usageTokens, model: data.model }]);
        } catch (e) {
            setMessages((prev) => [...prev, { role: 'assistant', content: `No pude responder: ${e.message}` }]);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
                <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">Probar el agente Claude</h3>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Reclutador × cliente. Escribe como candidato; responde Claude ({model || 'claude-opus-4-8'}) con tool use real.</p>
                </div>
            </div>

            {!hasApiKey && (
                <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    ⚠️ Falta <code className="font-mono">ANTHROPIC_API_KEY</code> en las variables de entorno de Vercel. El agente responderá un aviso hasta que se configure.
                </div>
            )}

            {/* Selectores reclutador × cliente */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-3">
                <select value={recruiter} onChange={(e) => setRecruiter(e.target.value)} className="text-sm rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10 px-3 py-2 text-gray-900 dark:text-white outline-none">
                    <option value="">— Reclutador —</option>
                    {recruiters.map((r) => <option key={r.folder} value={r.folder}>{r.name || r.folder}</option>)}
                </select>
                <span className="text-center text-gray-400 font-bold">×</span>
                <select value={client} onChange={(e) => setClient(e.target.value)} className="text-sm rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 px-3 py-2 text-gray-900 dark:text-white outline-none">
                    <option value="">— Cliente / vacante —</option>
                    {clients.map((c) => <option key={c.folder} value={c.folder}>{c.name || c.folder}</option>)}
                </select>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="h-72 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50 dark:bg-gray-950">
                    {messages.length === 0 && (
                        <p className="text-[11px] text-gray-400 text-center pt-8">Escribe como si fueras el candidato. El agente usará el estilo del reclutador y consultará los datos del cliente cuando los necesite.</p>
                    )}
                    {messages.map((m, i) => (
                        <div key={i} className="space-y-1">
                            <Bubble role={m.role}>{m.content}</Bubble>
                            {m.role === 'assistant' && (m.toolCalls > 0 || m.usageTokens) && (
                                <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500 pl-1">
                                    {m.toolCalls > 0 && <span className="inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> consultó la vacante ({m.toolCalls})</span>}
                                    {m.usageTokens ? <span>· {m.usageTokens} tokens</span> : null}
                                </div>
                            )}
                        </div>
                    ))}
                    {sending && (
                        <Bubble role="assistant"><span className="flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Pensando…</span></Bubble>
                    )}
                    <div ref={endRef} />
                </div>
                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder="Escribe como candidato…"
                        rows={1}
                        className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-purple-500"
                    />
                    <button onClick={send} disabled={sending || !input.trim()} className="w-9 h-9 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white flex items-center justify-center transition-colors">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AgentChat;
