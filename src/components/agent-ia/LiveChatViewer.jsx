import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Loader2, RefreshCw, Eye, MapPin, Tag as TagIcon } from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════════
// LiveChatViewer — 4ª columna de la sección Agent: visor de SOLO LECTURA de la
// conversación de WhatsApp de un candidato (el que se seleccione en la cola de
// Agent Candidatic, 3ª columna). No envía mensajes — es un monitor, no un chat
// paralelo (para escribirle al candidato de verdad, se usa el Chat Web normal).
//
// Reutiliza GET /api/chat?candidateId=X (mismo endpoint que ChatSection) — el
// interceptor global de fetch (main.jsx) ya agrega el Authorization Bearer.
// ════════════════════════════════════════════════════════════════════════════

const POLL_MS = 4000;

const isOutgoing = (m = {}) => m.from === 'me' || m.from === 'bot';

const Bubble = ({ m }) => {
    const out = isOutgoing(m);
    const kind = m.type || m.tipo || (m.mediaUrl ? 'image' : 'text');
    return (
        <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
                out ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef]' : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef]'
            }`}>
                {kind === 'image' && m.mediaUrl && (
                    <img src={m.mediaUrl} alt="" className="rounded-md mb-1 max-h-56 object-contain" loading="lazy" />
                )}
                {kind === 'audio' && m.mediaUrl && (
                    <audio src={m.mediaUrl} controls className="h-8 max-w-[220px]" />
                )}
                {kind === 'location' && (
                    <span className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300"><MapPin className="w-3.5 h-3.5" /> Ubicación</span>
                )}
                {m.content && kind !== 'location' && <span>{m.content}</span>}
                {!m.content && kind === 'location' && m.content !== '' && null}
            </div>
        </div>
    );
};

const LiveChatViewer = ({ candidate }) => {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const endRef = useRef(null);
    const candId = candidate?.id;

    const load = useCallback(async (silent = false) => {
        if (!candId) return;
        if (!silent) setLoading(true);
        setErr('');
        try {
            const res = await fetch(`/api/chat?candidateId=${encodeURIComponent(candId)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) throw new Error(data.error || 'No se pudo cargar el chat');
            setMessages(Array.isArray(data.messages) ? data.messages : []);
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }, [candId]);

    useEffect(() => { load(false); }, [load]);

    useEffect(() => {
        if (!candId) return;
        const t = setInterval(() => load(true), POLL_MS);
        return () => clearInterval(t);
    }, [candId, load]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [messages]);

    const sorted = [...messages].sort((a, b) => {
        const ta = new Date(a.timestamp || a.fecha || 0).getTime();
        const tb = new Date(b.timestamp || b.fecha || 0).getTime();
        return ta - tb;
    });

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 bg-gray-50 dark:bg-gray-900/20">
                <MessageSquare className="w-4 h-4 text-gray-400 shrink-0" />
                {candidate ? (
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{candidate.name}</div>
                        <div className="text-[10px] text-gray-400 font-mono truncate">{candidate.phone}</div>
                    </div>
                ) : (
                    <span className="text-sm font-bold text-gray-900 dark:text-white">Chat del candidato</span>
                )}
                {candidate && (
                    <button onClick={() => load(false)} disabled={loading} title="Refrescar" className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    </button>
                )}
            </div>
            {candidate?.tag && (
                <div className="shrink-0 px-4 py-1.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                        <TagIcon className="w-2.5 h-2.5" /> {candidate.tag}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400"><Eye className="w-3 h-3" /> Solo lectura</span>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0 bg-[#efeae2] dark:bg-[#0b141a]">
                {!candidate ? (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 text-center pt-10 px-4 leading-relaxed">
                        Selecciona un candidato de la cola (columna "Agent Candidatic") para ver su conversación aquí.
                    </p>
                ) : loading && messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
                ) : err ? (
                    <p className="text-[12px] text-red-500 dark:text-red-400 text-center pt-10">{err}</p>
                ) : sorted.length === 0 ? (
                    <p className="text-[12px] text-gray-400 text-center pt-10">Sin mensajes todavía.</p>
                ) : (
                    <>
                        {sorted.map((m, i) => <Bubble key={m.id || i} m={m} />)}
                        <div ref={endRef} />
                    </>
                )}
            </div>
        </div>
    );
};

export default LiveChatViewer;
