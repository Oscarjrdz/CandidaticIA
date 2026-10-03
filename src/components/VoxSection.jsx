import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Mic, MicOff, Phone, PhoneOff, Loader2, Save, Brain, DollarSign,
    AlertCircle, ChevronDown, ChevronRight, Search, User, X, MessageSquare, History, AlertTriangle,
} from 'lucide-react';

/**
 * Vox — Etapa 1: hablar con el "cerebro de voz" (Brenda) desde la compu.
 *
 * CLIENTE DELGADO a propósito: la inteligencia (persona, voz, VAD, modelo, tarifas) vive
 * server-side en Redis `vox:config` y se reusará igual en la Etapa 2 (gateway WCH/SIP).
 * Aquí solo: 1) token efímero (/api/vox/session), 2) WebRTC DIRECTO navegador↔OpenAI
 * (el audio no pasa por Vercel), 3) transcript + costo en vivo (persistido en /api/vox/usage).
 *
 * UI inspirada en el modo voz de ChatGPT (orbe central reactivo al audio) pero con el
 * lenguaje visual de Candidatic (tarjetas rounded-2xl, acento naranja, dark-mode).
 */

const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
const MODELS = ['gpt-realtime-mini', 'gpt-realtime'];

// Lee el desglose de tokens de un evento response.done (defensivo ante cambios de shape).
function parseUsage(usage) {
    if (!usage) return null;
    const inD = usage.input_token_details || {};
    const outD = usage.output_token_details || {};
    const cached = inD.cached_tokens_details || {};
    const inAudio = Number(inD.audio_tokens) || 0;
    const inText = Number(inD.text_tokens) || 0;
    const cachedAudio = Number(cached.audio_tokens) || 0;
    const cachedText = Number(cached.text_tokens) || 0;
    return {
        audioInput: Math.max(0, inAudio - cachedAudio),
        audioInputCached: cachedAudio,
        audioOutput: Number(outD.audio_tokens) || 0,
        textInput: Math.max(0, inText - cachedText),
        textInputCached: cachedText,
        textOutput: Number(outD.text_tokens) || 0,
    };
}

const ZERO_TOK = { audioInput: 0, audioInputCached: 0, audioOutput: 0, textInput: 0, textInputCached: 0, textOutput: 0 };

function costUsdFrom(tok, pricing) {
    const per = (c, r) => (Number(c) || 0) * (Number(r) || 0) / 1_000_000;
    return (
        per(tok.audioInput, pricing.audioInput) +
        per(tok.audioInputCached, pricing.audioInputCached) +
        per(tok.audioOutput, pricing.audioOutput) +
        per(tok.textInput, pricing.textInput) +
        per(tok.textInputCached, pricing.textInputCached) +
        per(tok.textOutput, pricing.textOutput)
    );
}

function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
}
function fmtDur(s) {
    s = Number(s) || 0;
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// RMS (0..1) de un AnalyserNode (dominio de tiempo).
function rmsLevel(analyser, buf) {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.2); // *3.2 = ganancia visual
}

export default function VoxSection() {
    const [config, setConfig] = useState(null);
    const [status, setStatus] = useState('idle'); // idle | connecting | live | error
    const [mode, setMode] = useState('idle');      // idle | listening | speaking (discreto, cambia poco)
    const [error, setError] = useState('');
    const [transcript, setTranscript] = useState([]);
    const [tokens, setTokens] = useState(ZERO_TOK);
    const [elapsed, setElapsed] = useState(0);
    const [muted, setMuted] = useState(false);
    const [showBrain, setShowBrain] = useState(false);
    const [showTranscript, setShowTranscript] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [calls, setCalls] = useState([]);
    const [savingCfg, setSavingCfg] = useState(false);
    const [target, setTarget] = useState(null); // {id, name, phone} | null
    const [vacancies, setVacancies] = useState([]);
    const [vacancyId, setVacancyId] = useState('');
    const [replies, setReplies] = useState([]);     // banco de respuestas (mensajes de WhatsApp)
    const [citaReplyId, setCitaReplyId] = useState('');
    const [testMode, setTestMode] = useState(false); // probar sin candidato real

    const pcRef = useRef(null);
    const dcRef = useRef(null);
    const streamRef = useRef(null);
    const audioRef = useRef(null);
    const timerRef = useRef(null);
    const sessionIdRef = useRef(null);
    const startedAtRef = useRef(0);

    // Web Audio (visualización del orbe)
    const audioCtxRef = useRef(null);
    const micAnalyserRef = useRef(null);
    const outAnalyserRef = useRef(null);
    const rafRef = useRef(null);
    const orbRef = useRef(null);
    const modeRef = useRef('idle');

    // --- Carga del cerebro (config) ---
    useEffect(() => {
        let alive = true;
        fetch('/api/vox/config')
            .then(r => r.json())
            .then(d => { if (alive && d?.config) setConfig(d.config); })
            .catch(() => { if (alive) setError('No se pudo cargar la config de Vox.'); });
        fetch('/api/vacancies')
            .then(r => r.json())
            .then(d => { if (alive && Array.isArray(d?.data)) setVacancies(d.data); })
            .catch(() => { /* sin vacantes, el usuario verá el aviso */ });
        fetch('/api/quick_replies')
            .then(r => r.json())
            .then(d => { if (alive && Array.isArray(d?.replies)) setReplies(d.replies); })
            .catch(() => { /* sin banco, el dropdown queda vacío */ });
        return () => { alive = false; };
    }, []);

    useEffect(() => () => { teardown(); }, []);

    const loadCalls = useCallback(() => {
        fetch('/api/vox/calls?limit=30')
            .then(r => r.json())
            .then(d => { if (Array.isArray(d?.calls)) setCalls(d.calls); })
            .catch(() => { /* historial opcional */ });
    }, []);

    useEffect(() => { loadCalls(); }, [loadCalls]);

    const reportUsage = useCallback((deltaTok, isFinal) => {
        const durationSec = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
        fetch('/api/vox/usage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionIdRef.current, durationSec: isFinal ? durationSec : 0, isFinal: !!isFinal, ...deltaTok }),
        }).catch(() => { /* fire-and-forget */ });
    }, []);

    function teardown() {
        // Anula los refs ANTES de cerrar: cerrar el pc dispara onconnectionstatechange='closed',
        // que llamaría hangup() de nuevo (y reportaría costo doble) si pcRef siguiera vivo.
        const pc = pcRef.current, dc = dcRef.current, stream = streamRef.current, ctx = audioCtxRef.current;
        dcRef.current = null; pcRef.current = null; streamRef.current = null;
        audioCtxRef.current = null; micAnalyserRef.current = null; outAnalyserRef.current = null;
        modeRef.current = 'idle';
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        try { dc?.close(); } catch { /* noop */ }
        try { stream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
        try { pc?.close(); } catch { /* noop */ }
        try { ctx?.close(); } catch { /* noop */ }
    }

    // Bucle de animación del orbe: escala continua por ref (sin re-render); modo discreto por estado.
    function startVisualizer() {
        const micBuf = new Uint8Array(1024);
        const outBuf = new Uint8Array(1024);
        const loop = () => {
            const inLvl = rmsLevel(micAnalyserRef.current, micBuf);
            const outLvl = rmsLevel(outAnalyserRef.current, outBuf);
            const lvl = Math.max(inLvl, outLvl);
            let nextMode = 'listening';
            if (outLvl > 0.06 && outLvl >= inLvl) nextMode = 'speaking';
            else if (inLvl > 0.06) nextMode = 'listening';
            else nextMode = modeRef.current === 'speaking' && outLvl > 0.03 ? 'speaking' : 'listening';

            if (orbRef.current) {
                orbRef.current.style.setProperty('--vox-scale', (1 + lvl * 0.4).toFixed(3));
                orbRef.current.style.setProperty('--vox-user', inLvl.toFixed(3));
                orbRef.current.style.setProperty('--vox-bot', outLvl.toFixed(3));
            }
            if (nextMode !== modeRef.current) { modeRef.current = nextMode; setMode(nextMode); }
            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
    }

    const logTranscript = useCallback((role, text) => {
        if (!sessionIdRef.current || !text) return;
        fetch('/api/vox/transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionIdRef.current, role, text }),
        }).catch(() => { /* fire-and-forget */ });
    }, []);

    const handleEvent = useCallback((evt) => {
        const type = evt?.type || '';
        if (type === 'conversation.item.input_audio_transcription.completed') {
            const text = (evt.transcript || '').trim();
            if (text) { setTranscript(prev => [...prev, { role: 'user', text }]); logTranscript('user', text); }
            return;
        }
        if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
            const text = (evt.transcript || '').trim();
            if (text) { setTranscript(prev => [...prev, { role: 'assistant', text }]); logTranscript('assistant', text); }
            return;
        }
        if (type === 'response.done') {
            const parsed = parseUsage(evt.response?.usage);
            if (parsed) {
                setTokens(prev => ({
                    audioInput: prev.audioInput + parsed.audioInput,
                    audioInputCached: prev.audioInputCached + parsed.audioInputCached,
                    audioOutput: prev.audioOutput + parsed.audioOutput,
                    textInput: prev.textInput + parsed.textInput,
                    textInputCached: prev.textInputCached + parsed.textInputCached,
                    textOutput: prev.textOutput + parsed.textOutput,
                }));
                reportUsage(parsed, false);
            }
        }
    }, [reportUsage, logTranscript]);

    async function connect() {
        setError(''); setTranscript([]); setTokens(ZERO_TOK); setElapsed(0); setMuted(false);
        setStatus('connecting'); setMode('idle');
        try {
            // El sessionId se genera ANTES para que el servidor lo use en el record consolidado.
            sessionIdRef.current = `vox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            const sResp = await fetch('/api/vox/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sessionIdRef.current, candidateId: target?.id || null, vacancyId: vacancyId || null, citaReplyId: citaReplyId || null, testMode }),
            });
            const sData = await sResp.json();
            if (!sResp.ok || !sData.token) throw new Error(sData.error || 'No se pudo iniciar sesión Vox');

            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            // AudioContext para visualizar.
            const AC = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AC();
            audioCtxRef.current = audioCtx;

            pc.ontrack = (e) => {
                if (audioRef.current) audioRef.current.srcObject = e.streams[0];
                try {
                    const outSrc = audioCtx.createMediaStreamSource(e.streams[0]);
                    const outAn = audioCtx.createAnalyser();
                    outAn.fftSize = 2048;
                    outSrc.connect(outAn); // solo análisis; el <audio> reproduce
                    outAnalyserRef.current = outAn;
                } catch { /* noop */ }
            };

            // echoCancellation evita que la voz de Brenda (por las bocinas) entre al micrófono
            // y la haga auto-interrumpirse ("se corta y repite"). Con audífonos es aún mejor.
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            streamRef.current = stream;
            stream.getTracks().forEach(t => pc.addTrack(t, stream));
            try {
                const micSrc = audioCtx.createMediaStreamSource(stream);
                const micAn = audioCtx.createAnalyser();
                micAn.fftSize = 2048;
                micSrc.connect(micAn);
                micAnalyserRef.current = micAn;
            } catch { /* noop */ }

            const dc = pc.createDataChannel('oai-events');
            dcRef.current = dc;
            dc.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch { /* no-JSON */ } };

            pc.onconnectionstatechange = () => {
                const st = pc.connectionState;
                if ((st === 'failed' || st === 'disconnected' || st === 'closed') && pcRef.current) {
                    hangup();
                }
            };

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const sdpResp = await fetch(sData.callsUrl, {
                method: 'POST',
                body: offer.sdp,
                headers: { Authorization: `Bearer ${sData.token}`, 'Content-Type': 'application/sdp' },
            });
            if (!sdpResp.ok) throw new Error('Falló el intercambio SDP con OpenAI');
            await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResp.text() });

            startedAtRef.current = Date.now();
            timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)), 1000);
            startVisualizer();
            setStatus('live');

            // Meta del transcript (una vez), para revisar la llamada después.
            fetch('/api/vox/transcript', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sessionIdRef.current,
                    meta: {
                        candidateName: sData.candidateName || (target?.name || ''),
                        vacancyName: sData.vacancyName || '',
                        model: sData.model || '', voice: sData.voice || '',
                        startedAt: new Date().toISOString(),
                    },
                }),
            }).catch(() => { /* fire-and-forget */ });
        } catch (e) {
            console.error('[Vox] connect error:', e);
            setError(e.message || 'Error al conectar');
            teardown();
            setStatus('error');
        }
    }

    function hangup() {
        if (!pcRef.current) { setStatus('idle'); setMode('idle'); return; } // ya colgado
        reportUsage(ZERO_TOK, true);
        teardown();
        setStatus('idle'); setMode('idle');
        setTimeout(loadCalls, 1500); // deja aterrizar el costo final antes de refrescar el historial
    }

    function toggleMute() {
        const s = streamRef.current;
        if (!s) return;
        const next = !muted;
        s.getAudioTracks().forEach(t => { t.enabled = !next; });
        setMuted(next);
    }

    async function saveConfig(patch) {
        setSavingCfg(true);
        try {
            const r = await fetch('/api/vox/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const d = await r.json();
            if (d?.config) setConfig(d.config);
        } catch { setError('No se pudo guardar la config.'); }
        finally { setSavingCfg(false); }
    }

    // --- Costo en vivo ---
    const pricing = config?.pricing || {};
    const fxRate = Number(config?.fxRate) || 0;
    const budget = Number(config?.budgetMxnPerMin) || 1;
    const costUsd = costUsdFrom(tokens, pricing);
    const costMxn = costUsd * fxRate;
    const mins = elapsed / 60;
    const mxnPerMin = mins > 0 ? costMxn / mins : 0;
    const overBudget = mxnPerMin > budget;
    const totalTokens = Object.values(tokens).reduce((a, b) => a + b, 0);
    const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    const isLive = status === 'live';
    const isConnecting = status === 'connecting';

    const statusLabel = isConnecting ? 'Conectando…'
        : isLive && muted ? 'Micrófono silenciado'
        : isLive && mode === 'speaking' ? 'Brenda está hablando…'
        : isLive ? 'Escuchando…'
        : status === 'error' ? 'Error de conexión'
        : target ? `Listo para llamar a ${target.name}`
        : testMode ? 'Modo prueba — listo para ensayar'
        : 'Elige vacante y candidato';

    return (
        <div className="max-w-6xl mx-auto w-full">
            <style>{VOX_CSS}</style>
            <audio ref={audioRef} autoPlay className="hidden" />

            {error && (
                <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 rounded-lg">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Escenario: orbe reactivo + controles */}
                <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 flex flex-col items-center justify-between min-h-[440px]">
                    {/* Configuración de la llamada: vacante + candidato completo */}
                    <div className="w-full space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Vacante a ofrecer:</span>
                            <select
                                value={vacancyId}
                                onChange={e => setVacancyId(e.target.value)}
                                disabled={isLive || isConnecting}
                                className="flex-1 max-w-[65%] text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2.5 py-1.5 disabled:opacity-60"
                            >
                                <option value="">{vacancies.length ? '— Elige una vacante —' : 'No hay vacantes creadas'}</option>
                                {vacancies.map(v => <option key={v.id} value={v.id}>{v.name}{v.company ? ` · ${v.company}` : ''}</option>)}
                            </select>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Info de cita (WhatsApp):</span>
                            <select
                                value={citaReplyId}
                                onChange={e => setCitaReplyId(e.target.value)}
                                disabled={isLive || isConnecting}
                                title="Mensaje del banco de respuestas que se enviará por WhatsApp y del que Brenda saca los datos de la cita"
                                className="flex-1 max-w-[65%] text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2.5 py-1.5 disabled:opacity-60"
                            >
                                <option value="">{replies.length ? '— Sin mensaje de cita —' : 'Banco de respuestas vacío'}</option>
                                {replies.map(r => <option key={r.id} value={r.id}>{r.name || r.shortcut || (r.message || '').slice(0, 40)}</option>)}
                            </select>
                        </div>
                        <TargetPicker
                            target={target}
                            testMode={testMode}
                            disabled={isLive || isConnecting}
                            onPick={(c) => { setTarget(c); if (c) setTestMode(false); }}
                            onToggleTest={() => setTestMode(v => { const n = !v; if (n) setTarget(null); return n; })}
                        />
                    </div>

                    {/* Orbe */}
                    <div className="flex flex-col items-center gap-5 py-4">
                        <div
                            ref={orbRef}
                            className={`vox-orb ${isLive ? `vox-${mode}` : 'vox-idle'}`}
                            data-live={isLive}
                        >
                            <div className="vox-orb-glow-user" />
                            <div className="vox-orb-glow-bot" />
                            <div className="vox-orb-core">
                                <Mic className="w-7 h-7 text-white/90" />
                            </div>
                        </div>
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-300 h-5">
                            {isLive && mode === 'speaking'
                                ? <span className="text-teal-600 dark:text-teal-400">{statusLabel}</span>
                                : isLive
                                    ? <span className="text-orange-600 dark:text-orange-400">{statusLabel}</span>
                                    : statusLabel}
                            {isLive && <span className="ml-2 text-gray-400 tabular-nums">{fmtTime(elapsed)}</span>}
                        </p>
                    </div>

                    {/* Controles */}
                    <div className="flex items-center gap-3">
                        {!isLive ? (
                            <button
                                onClick={connect}
                                disabled={isConnecting || !config || !vacancyId || (!target && !testMode)}
                                title={!vacancyId ? 'Elige una vacante' : (!target && !testMode) ? 'Elige un candidato completo o activa el modo prueba' : ''}
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50 transition-colors shadow-sm"
                            >
                                {isConnecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Phone className="w-5 h-5" />}
                                {isConnecting ? 'Conectando…' : 'Iniciar llamada'}
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={toggleMute}
                                    className={`inline-flex items-center justify-center w-12 h-12 rounded-full border transition-colors ${muted ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200' : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}
                                    title={muted ? 'Reactivar micrófono' : 'Silenciar micrófono'}
                                >
                                    {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={hangup}
                                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-red-600 hover:bg-red-700 text-white font-medium transition-colors shadow-sm"
                                >
                                    <PhoneOff className="w-5 h-5" /> Colgar
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Costo en vivo */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                        <DollarSign className="w-4 h-4" /> Costo en vivo
                    </div>
                    <div className={`rounded-xl p-3 mb-3 ${overBudget ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Ritmo (objetivo: {budget.toFixed(2)} peso/min)</div>
                        <div className={`text-2xl font-bold ${overBudget ? 'text-red-600' : 'text-green-600'}`}>
                            {mxnPerMin.toFixed(3)} <span className="text-sm font-medium">peso/min</span>
                        </div>
                    </div>
                    <dl className="space-y-1.5 text-sm">
                        <Row label="Costo total (MXN)" value={`$${costMxn.toFixed(4)}`} />
                        <Row label="Costo total (USD)" value={`$${costUsd.toFixed(5)}`} />
                        <Row label="Duración" value={fmtTime(elapsed)} />
                        <Row label="Tokens totales" value={totalTokens.toLocaleString()} />
                        <div className="border-t border-gray-100 dark:border-gray-700 my-2" />
                        <Row label="Audio in / cacheado" value={`${tokens.audioInput.toLocaleString()} / ${tokens.audioInputCached.toLocaleString()}`} small />
                        <Row label="Audio out" value={tokens.audioOutput.toLocaleString()} small />
                        <Row label="Texto in / out" value={`${tokens.textInput.toLocaleString()} / ${tokens.textOutput.toLocaleString()}`} small />
                    </dl>
                    <p className="mt-3 text-[11px] text-gray-400 leading-snug">
                        {config?.model || '—'} · voz {config?.voice || '—'}. El audio va directo del navegador a OpenAI; no pasa por Candidatic.
                    </p>
                </div>
            </div>

            {/* Transcript */}
            <div className="mt-5 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
                <button onClick={() => setShowTranscript(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Transcripción {transcript.length > 0 && <span className="text-xs text-gray-400">({transcript.length})</span>}</span>
                    {showTranscript ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {showTranscript && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 max-h-80 overflow-y-auto space-y-3">
                        {transcript.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-6">La transcripción aparece aquí mientras conversas.</p>
                        ) : transcript.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm ${m.role === 'user' ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-sm'}`}>
                                    <span className="block text-[10px] opacity-60 mb-0.5">{m.role === 'user' ? 'Tú' : 'Brenda'}</span>
                                    {m.text}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Historial de llamadas (record interno: config + costo, para cazar picos) */}
            <div className="mt-5 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
                <button onClick={() => { setShowHistory(v => !v); if (!showHistory) loadCalls(); }} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <span className="flex items-center gap-2">
                        <History className="w-4 h-4" /> Historial de llamadas {calls.length > 0 && <span className="text-xs text-gray-400">({calls.length})</span>}
                        {calls.some(c => c.spike) && <span className="inline-flex items-center gap-1 text-[11px] text-red-500"><AlertTriangle className="w-3 h-3" /> picos</span>}
                    </span>
                    {showHistory ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {showHistory && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 overflow-x-auto">
                        {calls.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-6">Aún no hay llamadas registradas.</p>
                        ) : (
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-gray-400 text-left border-b border-gray-100 dark:border-gray-700">
                                        <th className="py-1.5 pr-2 font-medium">Fecha</th>
                                        <th className="py-1.5 pr-2 font-medium">Candidato</th>
                                        <th className="py-1.5 pr-2 font-medium">Vacante</th>
                                        <th className="py-1.5 pr-2 font-medium">Modelo / voz</th>
                                        <th className="py-1.5 pr-2 font-medium text-right">Dur.</th>
                                        <th className="py-1.5 pr-2 font-medium text-right">MXN</th>
                                        <th className="py-1.5 pr-2 font-medium text-right">peso/min</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {calls.map(c => (
                                        <tr key={c.sessionId} className={`border-b border-gray-50 dark:border-gray-700/50 ${c.spike ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                                            <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(c.startedAt)}</td>
                                            <td className="py-1.5 pr-2 text-gray-700 dark:text-gray-200 truncate max-w-[110px]">{c.isTest ? '🧪 Prueba' : (c.candidateName || '—')}</td>
                                            <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400 truncate max-w-[110px]">{c.vacancyName || '—'}</td>
                                            <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{(c.model || '').replace('gpt-realtime', 'rt')}{c.voice ? ` · ${c.voice}` : ''}</td>
                                            <td className="py-1.5 pr-2 text-right text-gray-600 dark:text-gray-300 tabular-nums">{fmtDur(c.seconds)}</td>
                                            <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-200 tabular-nums">${c.costMxn.toFixed(2)}</td>
                                            <td className={`py-1.5 pr-2 text-right tabular-nums font-medium ${c.spike ? 'text-red-600' : 'text-green-600'}`}>
                                                {c.mxnPerMin.toFixed(2)}{c.spike && ' ⚠️'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        <p className="mt-2 text-[11px] text-gray-400">Pico = peso/min por encima del límite. Se guarda modelo, voz, VAD, vacante y mensaje de cita de cada llamada (30 días).</p>
                    </div>
                )}
            </div>

            {/* Editor del cerebro */}
            <div className="mt-5 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
                <button onClick={() => setShowBrain(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <span className="flex items-center gap-2"><Brain className="w-4 h-4" /> Cerebro de Brenda — personalidad, objetivo, voz y tarifas · server-side</span>
                    {showBrain ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {showBrain && config && (
                    <BrainEditor config={config} saving={savingCfg} disabled={isLive} onSave={saveConfig} />
                )}
            </div>
        </div>
    );
}

function Row({ label, value, small }) {
    return (
        <div className="flex items-center justify-between">
            <dt className={small ? 'text-xs text-gray-400' : 'text-gray-500 dark:text-gray-400'}>{label}</dt>
            <dd className={`font-medium ${small ? 'text-xs text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>{value}</dd>
        </div>
    );
}

/**
 * Selector de a quién llamamos. Brenda Vox SOLO llama a completos: busca por nombre/teléfono
 * (el servidor bloquea con 403 si el elegido no está completo). "Modo prueba" ensaya sin
 * candidato real (candidato ficticio completo).
 */
function TargetPicker({ target, testMode, onPick, onToggleTest, disabled }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || q.trim().length < 2) { setResults([]); return; }
        let alive = true;
        setLoading(true);
        const t = setTimeout(() => {
            fetch(`/api/candidates?search=${encodeURIComponent(q.trim())}&limit=8`)
                .then(r => r.json())
                .then(d => { if (alive) setResults(Array.isArray(d?.candidates) ? d.candidates : []); })
                .catch(() => { if (alive) setResults([]); })
                .finally(() => { if (alive) setLoading(false); });
        }, 300);
        return () => { alive = false; clearTimeout(t); };
    }, [q, open]);

    const pick = (c) => {
        onPick(c ? { id: c.id, name: c.nombreReal || c.nombre || c.whatsapp || 'Candidato', phone: c.whatsapp || c.phone || '' } : null);
        setOpen(false); setQ(''); setResults([]);
    };

    return (
        <div className="relative">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Llamar a:</span>
                <div className="flex items-center gap-2">
                    {target ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-medium">
                            <User className="w-3 h-3" /> {target.name}{target.phone ? ` · ${target.phone}` : ''}
                            {!disabled && <button onClick={() => pick(null)} className="ml-0.5 hover:text-orange-900"><X className="w-3 h-3" /></button>}
                        </span>
                    ) : testMode ? (
                        <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">Candidato de prueba</span>
                    ) : (
                        <span className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs font-medium">Sin elegir</span>
                    )}
                    {!disabled && (
                        <>
                            <button onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                                <Search className="w-3 h-3" /> Elegir completo
                            </button>
                            <button onClick={onToggleTest} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs ${testMode ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                                Prueba
                            </button>
                        </>
                    )}
                </div>
            </div>

            {open && (
                <div className="absolute right-0 top-9 z-20 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-900 rounded-lg mb-1.5">
                        <Search className="w-3.5 h-3.5 text-gray-400" />
                        <input
                            autoFocus value={q} onChange={e => setQ(e.target.value)}
                            placeholder="Nombre o teléfono…"
                            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100 outline-none"
                        />
                    </div>
                    <p className="text-[10px] text-gray-400 px-2 pb-1.5">Solo candidatos completos. Si eliges uno incompleto, la llamada se bloquea.</p>
                    <div className="max-h-56 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-4 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
                        ) : results.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-4">{q.trim().length < 2 ? 'Escribe al menos 2 caracteres.' : 'Sin resultados.'}</p>
                        ) : results.map(c => (
                            <button key={c.id} onClick={() => pick(c)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-left">
                                <div className="w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 text-xs font-semibold shrink-0">
                                    {(c.nombreReal || c.nombre || '?').charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm text-gray-800 dark:text-gray-100 truncate">{c.nombreReal || c.nombre || 'Sin nombre'}</div>
                                    <div className="text-[11px] text-gray-400 truncate">{c.whatsapp || c.phone || ''}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function BrainEditor({ config, saving, disabled, onSave }) {
    const [personality, setPersonality] = useState(config.personality || '');
    const [objective, setObjective] = useState(config.objective || '');
    const [voice, setVoice] = useState(config.voice);
    const [model, setModel] = useState(config.model);
    const [fxRate, setFxRate] = useState(config.fxRate);
    const [budget, setBudget] = useState(config.budgetMxnPerMin);
    const [pricing, setPricing] = useState(config.pricing || {});
    const setP = (k, v) => setPricing(p => ({ ...p, [k]: parseFloat(v) || 0 }));

    return (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
            {disabled && <p className="text-xs text-amber-600">Cuelga la llamada para editar el cerebro.</p>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Personalidad y tono</label>
                    <textarea value={personality} onChange={e => setPersonality(e.target.value)} disabled={disabled} rows={9}
                        className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-3 font-mono leading-relaxed disabled:opacity-60" />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Objetivo y guion de la entrevista</label>
                    <textarea value={objective} onChange={e => setObjective(e.target.value)} disabled={disabled} rows={9}
                        className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-3 font-mono leading-relaxed disabled:opacity-60" />
                </div>
            </div>
            <p className="text-[11px] text-gray-400 -mt-2">El prompt final se arma en el servidor con estructura de OpenAI (rol → personalidad → idioma → contexto del candidato → reglas → seguridad).</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Modelo"><select value={model} onChange={e => setModel(e.target.value)} disabled={disabled} className={selectCls}>{MODELS.map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
                <Field label="Voz"><select value={voice} onChange={e => setVoice(e.target.value)} disabled={disabled} className={selectCls}>{VOICES.map(v => <option key={v} value={v}>{v}</option>)}</select></Field>
                <Field label="Tipo de cambio (MXN/USD)"><input type="number" step="0.1" value={fxRate} onChange={e => setFxRate(parseFloat(e.target.value) || 0)} disabled={disabled} className={inputCls} /></Field>
                <Field label="Límite (peso/min)"><input type="number" step="0.1" value={budget} onChange={e => setBudget(parseFloat(e.target.value) || 0)} disabled={disabled} className={inputCls} /></Field>
            </div>

            <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Tarifas OpenAI (USD por 1M tokens)</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[['audioInput', 'Audio in'], ['audioInputCached', 'Audio in cacheado'], ['audioOutput', 'Audio out'], ['textInput', 'Texto in'], ['textInputCached', 'Texto in cacheado'], ['textOutput', 'Texto out']].map(([k, lbl]) => (
                        <Field key={k} label={lbl}><input type="number" step="0.01" value={pricing[k] ?? 0} onChange={e => setP(k, e.target.value)} disabled={disabled} className={inputCls} /></Field>
                    ))}
                </div>
            </div>

            <div className="flex justify-end">
                <button onClick={() => onSave({ personality, objective, voice, model, fxRate, budgetMxnPerMin: budget, pricing })} disabled={disabled || saving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar cerebro
                </button>
            </div>
        </div>
    );
}

const selectCls = 'w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2.5 py-2 disabled:opacity-60';
const inputCls = selectCls;
function Field({ label, children }) {
    return (<div><label className="block text-[11px] font-medium text-gray-400 mb-1">{label}</label>{children}</div>);
}

// Orbe reactivo (estilo modo-voz, pintado en acento Candidatic). La escala la maneja el rAF via --vox-scale.
const VOX_CSS = `
.vox-orb{position:relative;width:148px;height:148px;display:flex;align-items:center;justify-content:center;transform:scale(var(--vox-scale,1));transition:transform .08s linear}
.vox-orb-core{position:relative;z-index:2;width:96px;height:96px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 30%, #fb923c, #ea580c);box-shadow:0 10px 30px -8px rgba(234,88,12,.5)}
.vox-orb-glow-user,.vox-orb-glow-bot{position:absolute;inset:-6px;border-radius:9999px;filter:blur(14px);opacity:0;transition:opacity .15s ease}
.vox-orb-glow-user{background:radial-gradient(circle, rgba(249,115,22,.8), transparent 65%);opacity:calc(var(--vox-user,0) * .95)}
.vox-orb-glow-bot{background:radial-gradient(circle, rgba(20,184,166,.85), transparent 65%);opacity:calc(var(--vox-bot,0) * .95)}
.vox-speaking .vox-orb-core{background:radial-gradient(circle at 30% 30%, #2dd4bf, #0d9488);box-shadow:0 10px 34px -8px rgba(13,148,136,.55)}
.vox-idle .vox-orb-core{animation:voxBreath 3.6s ease-in-out infinite}
@keyframes voxBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@media (prefers-reduced-motion: reduce){.vox-idle .vox-orb-core{animation:none}.vox-orb{transition:none}}
`;
