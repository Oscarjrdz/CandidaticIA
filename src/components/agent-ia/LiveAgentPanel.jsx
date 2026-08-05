import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Power, Search, Users, Tag as TagIcon, Check, X, Clock, CheckCircle2, HelpCircle, XCircle, Trash2 } from 'lucide-react';
import { agentIAFetch } from './api';

// ════════════════════════════════════════════════════════════════════════════
// LiveAgentPanel — 3ª columna de la sección Agent: control y monitor de
// "Agent Candidatic" (atención automática en vivo).
//
//   · Mascota (CSS puro) en 3 estados: dormida (OFF), despertando, atendiendo (ON).
//   · Toggle Agent ON/OFF. Al prender pregunta "¿a qué etiqueta(s) atiendo?".
//   · Cola viva: los candidatos COMPLETOS de las etiquetas activas (se sondea).
//
// El estado real vive en el servidor (Redis), así que sobrevive a que cierres el
// dashboard ("me voy a comer"). Este panel solo lo controla y lo monitorea.
// ════════════════════════════════════════════════════════════════════════════

// ─── Mascota de Claude (SVG + keyframes) ─────────────────────────────────────
const Mascot = ({ on, waking }) => (
    <div className="ac-mascot-wrap">
        <style>{`
            @keyframes ac-breathe { 0%,100% { transform: scale(1) translateY(0); } 50% { transform: scale(1.04) translateY(1px); } }
            @keyframes ac-float   { 0% { opacity:0; transform: translate(0,4px) scale(.7);} 30%{opacity:1;} 100% { opacity:0; transform: translate(6px,-14px) scale(1);} }
            @keyframes ac-bounce  { 0% { transform: translateY(0) scale(1);} 30% { transform: translateY(-8px) scale(1.06);} 60% { transform: translateY(0) scale(.98);} 100% { transform: translateY(0) scale(1);} }
            @keyframes ac-spin    { to { transform: rotate(360deg); } }
            @keyframes ac-pulse   { 0%,100% { opacity:.35; transform: scale(1);} 50% { opacity:.7; transform: scale(1.12);} }
            @keyframes ac-blink   { 0%,92%,100% { transform: scaleY(1);} 96% { transform: scaleY(.1);} }
            .ac-mascot-wrap { position: relative; width: 128px; height: 120px; display:flex; align-items:center; justify-content:center; }
            .ac-body { transform-origin: 50% 90%; animation: ac-breathe 3.6s ease-in-out infinite; }
            .ac-body.on { animation: ac-bounce .7s ease-out; }
            .ac-eye { transform-origin: center; }
            .ac-eye.on { animation: ac-blink 4s infinite; }
            .ac-ring { position:absolute; width:104px; height:104px; border-radius:9999px; border:2px dashed currentColor; opacity:.55; animation: ac-spin 6s linear infinite; }
            .ac-glow { position:absolute; width:96px; height:96px; border-radius:9999px; animation: ac-pulse 2.4s ease-in-out infinite; }
            .ac-z { position:absolute; font-weight:800; color:#9aa7b1; }
            .ac-z1 { top:14px; right:26px; font-size:12px; animation: ac-float 2.8s ease-in-out infinite; }
            .ac-z2 { top:8px;  right:16px; font-size:16px; animation: ac-float 2.8s ease-in-out .9s infinite; }
            .ac-z3 { top:0px;  right:4px;  font-size:20px; animation: ac-float 2.8s ease-in-out 1.8s infinite; }
        `}</style>

        {on && <div className="ac-glow" style={{ background: 'radial-gradient(circle, rgba(217,119,87,.35) 0%, rgba(217,119,87,0) 70%)' }} />}
        {on && <div className="ac-ring" style={{ color: '#d97757' }} />}

        {!on && (<>
            <span className="ac-z ac-z1">z</span>
            <span className="ac-z ac-z2">z</span>
            <span className="ac-z ac-z3">Z</span>
        </>)}

        <svg width="92" height="92" viewBox="0 0 92 92" fill="none" className={`ac-body ${on && waking ? 'on' : ''}`}>
            {/* cuerpo redondito color arcilla de Claude */}
            <path d="M46 8c19 0 34 14 34 33 0 12-6 21-15 27l3 11-13-6a38 38 0 0 1-9 1C27 84 12 70 12 51 12 22 27 8 46 8Z"
                  fill="#d97757" />
            <path d="M46 8c19 0 34 14 34 33 0 12-6 21-15 27l3 11-13-6a38 38 0 0 1-9 1C27 84 12 70 12 51 12 22 27 8 46 8Z"
                  fill="url(#acg)" fillOpacity=".25" />
            <defs>
                <linearGradient id="acg" x1="20" y1="10" x2="70" y2="80" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#ffffff" /><stop offset="1" stopColor="#000000" stopOpacity="0" />
                </linearGradient>
            </defs>

            {on ? (<>
                {/* ojos abiertos + brillo despierto */}
                <circle className="ac-eye on" cx="35" cy="44" r="4.6" fill="#3b2a22" />
                <circle className="ac-eye on" cx="57" cy="44" r="4.6" fill="#3b2a22" />
                <circle cx="36.5" cy="42.5" r="1.4" fill="#fff" />
                <circle cx="58.5" cy="42.5" r="1.4" fill="#fff" />
                {/* sonrisita */}
                <path d="M38 57c3 4 13 4 16 0" stroke="#3b2a22" strokeWidth="3" strokeLinecap="round" fill="none" />
            </>) : (<>
                {/* ojos cerrados (dormida) */}
                <path d="M30 45c3 3 7 3 10 0" stroke="#3b2a22" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M52 45c3 3 7 3 10 0" stroke="#3b2a22" strokeWidth="3" strokeLinecap="round" fill="none" />
                {/* boquita relajada */}
                <path d="M42 58c2 2 6 2 8 0" stroke="#3b2a22" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </>)}
        </svg>
    </div>
);

const POLL_MS = 4000;

// ms → "Xh Ym" (o "Ym" si dura menos de 1h). Usado para las métricas acumuladas.
function formatDuration(ms) {
    const totalMin = Math.floor((ms || 0) / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Status por candidato en la cola (lo va poniendo el motor de agent-attend.js).
const QUEUE_STATUS_META = {
    pending: { icon: Clock, className: 'text-gray-400', title: 'En espera' },
    attending: { icon: Loader2, className: 'text-orange-500 animate-spin', title: 'Atendiendo…' },
    done: { icon: CheckCircle2, className: 'text-emerald-500', title: 'Atendido' },
    waiting: { icon: HelpCircle, className: 'text-amber-500', title: 'Duda — revisa el chat del agente' },
    error: { icon: XCircle, className: 'text-red-500', title: 'Error — revisa el chat del agente' }
};

const EMPTY_STATS = { totalAttended: 0, totalGoals: 0, totalAttendingMs: 0, totalAwakeMs: 0 };

const LiveAgentPanel = ({ reloadKey = 0, onSelectCandidate, selectedId }) => {
    const [state, setState] = useState({ on: false, since: 0, tags: [] });
    const [queue, setQueue] = useState([]);
    const [stats, setStats] = useState(EMPTY_STATS);
    const [availableTags, setAvailableTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    const [selected, setSelected] = useState([]);
    const [tagSearch, setTagSearch] = useState('');
    const [err, setErr] = useState('');
    const [waking, setWaking] = useState(false);
    const [confirmClearAll, setConfirmClearAll] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const prevOnRef = useRef(false);

    const applyData = useCallback((data) => {
        if (data?.state) {
            setState(data.state);
            // Al pasar de OFF→ON, dispara la animación de "despertar".
            if (data.state.on && !prevOnRef.current) { setWaking(true); setTimeout(() => setWaking(false), 800); }
            prevOnRef.current = data.state.on;
        }
        if (Array.isArray(data?.queue)) setQueue(data.queue);
        if (data?.stats) setStats(data.stats);
        if (Array.isArray(data?.availableTags)) setAvailableTags(data.availableTags);
    }, []);

    const clearAll = async () => {
        setClearing(true); setErr('');
        try {
            const data = await agentIAFetch('/api/agent-ia/live-agent', { method: 'POST', body: { action: 'clear' } });
            if (Array.isArray(data.queue)) setQueue(data.queue);
            setConfirmClearAll(false);
            if (onSelectCandidate) onSelectCandidate(null); // por si apuntaba a algo que se acaba de vaciar
        } catch (e) { setErr(e.message); } finally { setClearing(false); }
    };

    const removeCandidate = async (candidateId) => {
        setRemovingId(candidateId); setErr('');
        try {
            const data = await agentIAFetch('/api/agent-ia/live-agent', { method: 'POST', body: { action: 'remove', candidateId } });
            if (Array.isArray(data.queue)) setQueue(data.queue);
            if (selectedId === candidateId && onSelectCandidate) onSelectCandidate(null);
        } catch (e) { setErr(e.message); } finally { setRemovingId(null); }
    };

    const fetchState = useCallback(async () => {
        try {
            const data = await agentIAFetch('/api/agent-ia/live-agent');
            applyData(data);
        } catch { /* deja el último estado */ } finally { setLoading(false); }
    }, [applyData]);

    // Carga inicial + refetch cuando el chat prende/apaga (reloadKey).
    useEffect(() => { fetchState(); }, [fetchState, reloadKey]);

    // Sondeo de la cola mientras está ON (la cola cambia conforme entran completos).
    useEffect(() => {
        if (!state.on) return;
        const t = setInterval(fetchState, POLL_MS);
        return () => clearInterval(t);
    }, [state.on, fetchState]);

    const turnOff = async () => {
        setBusy(true); setErr('');
        try {
            const data = await agentIAFetch('/api/agent-ia/live-agent', { method: 'POST', body: { action: 'off' } });
            applyData(data);
            setPicking(false);
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const turnOn = async () => {
        if (!selected.length) { setErr('Elige al menos una etiqueta.'); return; }
        setBusy(true); setErr('');
        try {
            const data = await agentIAFetch('/api/agent-ia/live-agent', { method: 'POST', body: { action: 'on', tags: selected } });
            applyData(data);
            setPicking(false);
            setSelected([]);
            setTagSearch('');
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const onToggle = () => {
        if (busy) return;
        if (state.on) { turnOff(); return; }
        // OFF → abrir selector de etiquetas (no prende hasta elegir)
        setErr('');
        setSelected([]);
        setPicking((p) => !p);
    };

    const toggleTag = (name) => setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
    const filteredTags = availableTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()));

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 bg-gradient-to-r from-orange-50 to-transparent dark:from-orange-900/10">
                <span className={`w-2 h-2 rounded-full ${state.on ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <span className="text-sm font-bold text-gray-900 dark:text-white">Agent Candidatic</span>
                <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${state.on ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {state.on ? 'ATENDIENDO' : 'EN PAUSA'}
                </span>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : (
                <div className="flex-1 overflow-y-auto min-h-0">
                    {/* Mascota + estado */}
                    <div className="flex flex-col items-center pt-4 pb-2">
                        <Mascot on={state.on} waking={waking} />
                        <p className={`mt-1 text-[13px] font-semibold ${state.on ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}>
                            {state.on ? 'Despierta y atendiendo en vivo' : 'Durmiendo… lista para trabajar'}
                        </p>
                    </div>

                    {/* Toggle */}
                    <div className="px-4">
                        <button
                            onClick={onToggle}
                            disabled={busy}
                            className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:opacity-60 ${
                                state.on
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                            }`}
                        >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                            {state.on ? 'Agent ON — apagar' : 'Prender Agent'}
                        </button>
                        {err && <p className="mt-1.5 text-[11px] text-red-500 dark:text-red-400 text-center">{err}</p>}
                    </div>

                    {/* Métricas acumuladas (sobreviven apagar/prender) */}
                    <div className="px-4 mt-3 grid grid-cols-2 gap-1.5">
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 px-2 py-1.5 text-center" title="Candidatos que el motor terminó de atender">
                            <div className="text-[15px] font-bold text-gray-800 dark:text-gray-100">{stats.totalAttended}</div>
                            <div className="text-[9px] text-gray-400 uppercase tracking-wide">Atendidos</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 px-2 py-1.5 text-center" title="Veces que el agente juzgó que cumplió el objetivo real de la skill">
                            <div className="text-[15px] font-bold text-gray-800 dark:text-gray-100">⚽ {stats.totalGoals}</div>
                            <div className="text-[9px] text-gray-400 uppercase tracking-wide">Goles</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 px-2 py-1.5 text-center" title="Tiempo real que el motor pasó procesando candidatos">
                            <div className="text-[13px] font-bold text-gray-800 dark:text-gray-100">{formatDuration(stats.totalAttendingMs)}</div>
                            <div className="text-[9px] text-gray-400 uppercase tracking-wide">Atendiendo</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 px-2 py-1.5 text-center" title="Tiempo acumulado con el toggle prendido">
                            <div className="text-[13px] font-bold text-gray-800 dark:text-gray-100">{formatDuration(stats.totalAwakeMs)}</div>
                            <div className="text-[9px] text-gray-400 uppercase tracking-wide">Despierto</div>
                        </div>
                    </div>

                    {/* Selector de etiquetas (al prender) */}
                    {picking && !state.on && (
                        <div className="mx-4 mt-3 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10 p-3">
                            <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 mb-2">¿A qué etiqueta(s) atiendo?</div>
                            <div className="relative mb-2">
                                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                                <input
                                    value={tagSearch}
                                    onChange={(e) => setTagSearch(e.target.value)}
                                    placeholder="Buscar etiqueta…"
                                    className="w-full text-[12px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 pl-7 pr-2 py-1.5 text-gray-900 dark:text-white outline-none focus:border-orange-500"
                                />
                            </div>
                            <div className="max-h-44 overflow-y-auto space-y-0.5 mb-2">
                                {filteredTags.length === 0 ? (
                                    <p className="text-[11px] text-gray-400 py-2 text-center">Sin etiquetas.</p>
                                ) : filteredTags.map((t) => {
                                    const active = selected.includes(t.name);
                                    return (
                                        <button
                                            key={t.name}
                                            onClick={() => toggleTag(t.name)}
                                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${active ? 'bg-orange-100 dark:bg-orange-900/30' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                                        >
                                            <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${active ? 'bg-orange-600 text-white' : 'border border-gray-300 dark:border-gray-600'}`}>
                                                {active && <Check className="w-3 h-3" />}
                                            </span>
                                            <TagIcon className="w-3 h-3 text-orange-500 shrink-0" />
                                            <span className="text-[12px] text-gray-800 dark:text-gray-100 truncate flex-1">{t.name}</span>
                                            <span className="text-[10px] text-gray-400 shrink-0">{t.count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={turnOn} disabled={busy || !selected.length} className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-[12px] font-bold">
                                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />} Prender ({selected.length})
                                </button>
                                <button onClick={() => { setPicking(false); setSelected([]); }} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Etiquetas activas (solo mientras está ON) */}
                    {state.on && (
                        <div className="px-4 mt-3 flex flex-wrap gap-1">
                            {state.tags.map((t) => (
                                <span key={t} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                                    <TagIcon className="w-2.5 h-2.5" /> {t}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Cola en vivo: event-driven, arranca vacía en cada activación y se llena
                        SOLO con quien se completa después de prender (nada retroactivo). Se
                        conserva al apagar, para poder revisar el último turno de atención. */}
                    {(state.on || queue.length > 0) && (
                        <div className="px-4 mt-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                <Users className="w-3.5 h-3.5" /> {state.on ? 'En cola de atención' : 'Último turno de atención'}
                                <span className="text-orange-600 dark:text-orange-400">{queue.length}</span>
                                {queue.length > 0 && (
                                    <div className="ml-auto">
                                        {confirmClearAll ? (
                                            <span className="inline-flex items-center gap-1.5 normal-case font-normal">
                                                <button onClick={clearAll} disabled={clearing} className="text-[10px] font-semibold text-red-500 hover:text-red-600 disabled:opacity-50">
                                                    {clearing ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Sí, vaciar'}
                                                </button>
                                                <button onClick={() => setConfirmClearAll(false)} disabled={clearing} className="text-[10px] text-gray-400 hover:text-gray-500">Cancelar</button>
                                            </span>
                                        ) : (
                                            <button onClick={() => setConfirmClearAll(true)} title="Vaciar toda la cola" className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/60 overflow-hidden">
                                {queue.length === 0 ? (
                                    <p className="text-[11px] text-gray-400 py-4 text-center">Nadie en cola todavía. Conforme se completen, aparecerán aquí.</p>
                                ) : queue.slice(0, 60).map((c, i) => {
                                    const meta = QUEUE_STATUS_META[c.status] || QUEUE_STATUS_META.pending;
                                    const StatusIcon = meta.icon;
                                    return (
                                        <div
                                            key={c.id || i}
                                            className={`flex items-center transition-colors ${selectedId === c.id ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}
                                        >
                                            <button
                                                onClick={() => onSelectCandidate && onSelectCandidate(c)}
                                                title={c.note ? `${meta.title}: ${c.note}` : meta.title}
                                                className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                            >
                                                <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                                                <span className="text-[12px] text-gray-800 dark:text-gray-100 truncate flex-1">{c.name}{c.goal ? ' ⚽' : ''}</span>
                                                <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${meta.className}`} />
                                            </button>
                                            <button
                                                onClick={() => removeCandidate(c.id)}
                                                disabled={removingId === c.id}
                                                title="Quitar de la cola"
                                                className="shrink-0 p-1.5 mr-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                                            >
                                                {removingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                            {state.on && (
                                <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
                                    ⚙️ El motor lee la skill de la etiqueta y actúa por su cuenta (sin pedirte confirmar cada envío). Si no hay skill clara, te pregunta en el chat del agente en vez de adivinar. Toca a un candidato para ver su chat.
                                </p>
                            )}
                        </div>
                    )}

                    {!state.on && !picking && queue.length === 0 && (
                        <p className="px-5 mt-3 text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                            Prende el agente (o dile por el chat "me voy a comer, atiende a los de «etiqueta»") y elige a qué etiqueta(s) atender. Los candidatos que se completen entrarán a la cola.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default LiveAgentPanel;
