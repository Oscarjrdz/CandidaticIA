import React, { useState, useEffect, useCallback } from 'react';
import { MessageCirclePlus, Clock, RefreshCw, ChevronDown, ChevronUp, SkipForward, Zap, Send, Users, CheckCircle, XCircle, AlertCircle, SlidersHorizontal, ListTodo } from 'lucide-react';
import { useToastContext } from '../../contexts/ToastContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
function humanSilence(ms) {
    if (!ms || ms <= 0) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function humanDate(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('es-MX', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Monterrey',
    }).format(new Date(iso));
}

const SILENCE_OPTIONS = [
    { label: '5 min',    value: 5 / 60 },
    { label: '15 min',   value: 15 / 60 },
    { label: '30 min',   value: 30 / 60 },
    { label: '1 hora',   value: 1 },
    { label: '2 horas',  value: 2 },
    { label: '4 horas',  value: 4 },
    { label: '8 horas',  value: 8 },
    { label: '24 horas', value: 24 },
];
const INTERVAL_OPTIONS = [
    { label: '5 min',    value: 5 / 60 },
    { label: '15 min',   value: 15 / 60 },
    { label: '30 min',   value: 30 / 60 },
    { label: '12 horas', value: 12 },
    { label: '24 horas', value: 24 },
    { label: '48 horas', value: 48 },
];
const MAX_SILENCE_OPTIONS = [
    { label: '3 días', value: 3 },
    { label: '7 días', value: 7 },
    { label: '15 días', value: 15 },
];
const ATTEMPT_OPTIONS = [1, 2, 3];
const PANEL_CLASS = 'h-auto xl:h-[520px] bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden min-w-0 flex flex-col';
const PANEL_HEADER_CLASS = 'h-16 px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 shrink-0';
const PANEL_BODY_CLASS = 'flex-1 min-h-0 overflow-y-auto';

const PanelTitle = ({ icon: Icon, title }) => (
    <div className="flex items-center space-x-3 min-w-0">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0">
            <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white truncate">
            {title}
        </h2>
    </div>
);

// ── Tab badge ─────────────────────────────────────────────────────────────────
const Badge = ({ count, color = 'blue' }) => {
    if (!count) return null;
    const colors = {
        blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        gray: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    };
    return (
        <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${colors[color]}`}>
            {count}
        </span>
    );
};

// ── Candidate row in queue ────────────────────────────────────────────────────
const CandidateRow = React.memo(({ cand, onSkip, onSendNow, isSent, isSkipped }) => {
    const [skipping, setSkipping] = useState(false);
    const [sending, setSending] = useState(false);
    const { showToast } = useToastContext();

    const handleSkip = async () => {
        setSkipping(true);
        try {
            const res = await fetch('/api/reengagement-skip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId: cand.id, skip: !isSkipped }),
            });
            if (res.ok) {
                showToast(isSkipped ? 'Candidato reactivado' : 'Candidato saltado', 'success');
                onSkip?.();
            }
        } catch {
            showToast('Error al actualizar', 'error');
        } finally {
            setSkipping(false);
        }
    };

    const handleSendNow = async () => {
        setSending(true);
        try {
            const res = await fetch('/api/cron/reengagement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forceCandidateId: cand.id }),
            });
            if (res.ok) {
                showToast(`Mensaje enviado a ${cand.nombre}`, 'success');
                onSendNow?.();
            } else {
                showToast('No se pudo enviar', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className={`flex items-center justify-between py-3 px-4 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors ${isSkipped ? 'opacity-50' : ''}`}>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                    {cand.nombre}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {cand.whatsapp}
                </p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                    {(cand.missingFields || []).map(f => (
                        <span key={f} className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-medium">
                            {f}
                        </span>
                    ))}
                </div>
            </div>

            <div className="ml-4 flex flex-col items-end gap-1.5 shrink-0">
                {!isSent && !isSkipped && (
                    <>
                        <div className="text-right">
                            <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                                Intento {(cand.attempts || 0) + 1}
                            </p>
                            {cand.etaMs > 0 ? (
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    <Clock className="inline w-3 h-3 mr-0.5" />
                                    en {cand.etaHuman}
                                </p>
                            ) : (
                                <p className="text-[11px] font-bold text-green-600 dark:text-green-400">
                                    ● Listo para enviar
                                </p>
                            )}
                        </div>
                        <p className="text-[10px] text-gray-400">
                            Silencio: {humanSilence(cand.silenceMs)}
                        </p>
                    </>
                )}
                {isSent && (
                    <div className="text-right">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            Intento {cand.attempts}/{3}
                        </p>
                        <p className="text-[11px] text-gray-400">{humanDate(cand.lastSent)}</p>
                    </div>
                )}

                <div className="flex gap-1.5">
                    {!isSent && !isSkipped && cand.etaMs === 0 && (
                        <button
                            onClick={handleSendNow}
                            disabled={sending}
                            className="flex items-center gap-1 px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg text-[10px] font-bold transition-colors disabled:opacity-50"
                            title="Enviar ahora"
                        >
                            {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            Enviar
                        </button>
                    )}
                    <button
                        onClick={handleSkip}
                        disabled={skipping}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-50 ${
                            isSkipped
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                        title={isSkipped ? 'Reactivar' : 'Saltar'}
                    >
                        {skipping ? <RefreshCw className="w-3 h-3 animate-spin" /> : <SkipForward className="w-3 h-3" />}
                        {isSkipped ? 'Reactivar' : 'Saltar'}
                    </button>
                </div>
            </div>
        </div>
    );
});

// ── Main Panel ────────────────────────────────────────────────────────────────
const ReengagementPanel = ({ templatesPanel = null }) => {
    const { showToast } = useToastContext();

    const [settings, setSettings] = useState(null);
    const [queue, setQueue]       = useState({ pending: [], sent: [], skipped: [], stats: {} });
    const [loading, setLoading]   = useState(true);
    const [saving, setSaving]     = useState(false);
    const [queueLoading, setQueueLoading] = useState(false);
    const [showConfig, setShowConfig]     = useState(true);
    const [activeTab, setActiveTab]       = useState('pending');

    // Editable local settings (to avoid saving on every keystroke)
    const [draft, setDraft] = useState(null);

    const loadAll = useCallback(async () => {
        try {
            const [sRes, qRes] = await Promise.all([
                fetch('/api/reengagement-settings'),
                fetch('/api/reengagement-queue'),
            ]);
            const [sData, qData] = await Promise.all([sRes.json(), qRes.json()]);
            if (sData.success) { setSettings(sData.settings); setDraft(sData.settings); }
            if (qData.success) setQueue(qData);
        } catch (e) {
            console.error('[Reengagement] load error', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    const refreshQueue = useCallback(async () => {
        setQueueLoading(true);
        try {
            const res = await fetch('/api/reengagement-queue');
            const data = await res.json();
            if (data.success) setQueue(data);
        } catch {}
        finally { setQueueLoading(false); }
    }, []);

    const handleToggle = async () => {
        const newEnabled = !settings?.enabled;
        setSaving(true);
        try {
            const res = await fetch('/api/reengagement-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: newEnabled }),
            });
            const data = await res.json();
            if (data.success) {
                setSettings(data.settings);
                setDraft(data.settings);
                showToast(newEnabled ? 'Re-engagement activado' : 'Re-engagement desactivado', newEnabled ? 'success' : 'info');
                if (newEnabled) await refreshQueue();
            }
        } catch { showToast('Error al guardar', 'error'); }
        finally { setSaving(false); }
    };

    const handleSaveConfig = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const res = await fetch('/api/reengagement-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
            });
            const data = await res.json();
            if (data.success) {
                setSettings(data.settings);
                showToast('Reglas guardadas', 'success');
                await refreshQueue();
            }
        } catch { showToast('Error al guardar', 'error'); }
        finally { setSaving(false); }
    };

    if (loading) {
        return (
            <div className="animate-pulse space-y-3">
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl" />
                <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-2xl" />
            </div>
        );
    }

    const isEnabled = settings?.enabled ?? false;
    const { pendingCount = 0, sentToday = 0, skippedCount = 0 } = queue.stats || {};
    const readyCount = queue.pending?.filter(c => c.readyToSend).length || 0;

    return (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-stretch">

            {/* ── Header con toggle ─────────────────────────────────────────── */}
            <div className={PANEL_CLASS}>
                <div className={PANEL_HEADER_CLASS}>
                    <PanelTitle icon={MessageCirclePlus} title="Re-engagement Proactivo" />
                    <button
                        onClick={handleToggle}
                        disabled={saving}
                        className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none flex items-center shrink-0 ${
                            isEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                        } ${saving ? 'opacity-60' : ''}`}
                    >
                        <div className={`absolute w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${isEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                </div>

                <div className={`${PANEL_BODY_CLASS} p-5`}>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: 'Pendientes', value: pendingCount, icon: Clock },
                            { label: 'Listos ahora', value: readyCount, icon: Zap },
                            { label: 'Enviados hoy', value: sentToday, icon: CheckCircle },
                        ].map(({ label, value, icon: Icon }) => (
                            <div key={label} className="rounded-xl p-3 text-center bg-gray-50 dark:bg-gray-800/70 border border-gray-100 dark:border-gray-800">
                                <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400 mx-auto mb-1" />
                                <p className="text-lg font-black text-gray-900 dark:text-white">{value}</p>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">{label}</p>
                            </div>
                        ))}
                    </div>
                    <div className="mt-5 rounded-xl bg-gray-50 dark:bg-gray-800/70 border border-gray-100 dark:border-gray-800 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Estado</p>
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-blue-600' : 'bg-gray-400'}`} />
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                {isEnabled ? 'Automatización activa' : 'Automatización pausada'}
                            </p>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            {isEnabled
                                ? `Activo desde ${new Date(settings.activeFrom).toLocaleDateString('es-MX')}`
                                : 'Brenda retoma candidatos con perfil incompleto'}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Reglas de configuración ───────────────────────────────────── */}
            <div className={PANEL_CLASS}>
                <button
                    onClick={() => setShowConfig(v => !v)}
                    className={`${PANEL_HEADER_CLASS} w-full hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left`}
                >
                    <PanelTitle icon={SlidersHorizontal} title="Reglas de configuración" />
                    {showConfig ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {showConfig && draft && (
                    <div className={`${PANEL_BODY_CLASS} px-5 pb-5 space-y-5 pt-4`}>

                        {/* Row: silencio + intentos */}
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                                    Silencio antes del 1er mensaje
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {SILENCE_OPTIONS.map(o => (
                                        <button
                                            key={o.value}
                                            onClick={() => setDraft(d => ({ ...d, silenceHours: o.value }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                draft.silenceHours === o.value
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                            }`}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                                    Máximo de intentos
                                </label>
                                <div className="flex gap-2">
                                    {ATTEMPT_OPTIONS.map(n => (
                                        <button
                                            key={n}
                                            onClick={() => setDraft(d => ({ ...d, maxAttempts: n }))}
                                            className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${
                                                draft.maxAttempts === n
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                            }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Row: intervalo + caducidad */}
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                                    Intervalo entre mensajes
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {INTERVAL_OPTIONS.map(o => (
                                        <button
                                            key={o.value}
                                            onClick={() => setDraft(d => ({ ...d, intervalHours: o.value }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                draft.intervalHours === o.value
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                            }`}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">
                                    No contactar si lleva más de
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {MAX_SILENCE_OPTIONS.map(o => (
                                        <button
                                            key={o.value}
                                            onClick={() => setDraft(d => ({ ...d, maxSilenceDays: o.value }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                draft.maxSilenceDays === o.value
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                            }`}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Preview de templates */}
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-4 border border-gray-100 dark:border-gray-800">
                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Preview de mensajes — 3 variantes por intento (campo ejemplo: escolaridad)
                            </p>
                            {[
                                {
                                    n: 1, tone: 'Cálido · directo',
                                    variants: [
                                        '¡Hola Oscar! 😊 Solo me falta saber *tu nivel de escolaridad* para encontrarte la vacante ideal. ¿Me lo compartes?',
                                        'Hola Oscar 👋 Tu registro quedó casi completo, solo falta *tu nivel de escolaridad*. ¿Me lo dices para poder buscarte opciones?',
                                        'Oscar, me quedé a medias con tu registro 🙌 Necesito que me digas *tu nivel de escolaridad* para poder buscarte trabajo. ¿Me ayudas?',
                                    ],
                                },
                                {
                                    n: 2, tone: 'Urgencia · competencia',
                                    variants: [
                                        'Oscar, esta semana estamos recibiendo muchos candidatos 📋 Para considerarte necesito que me confirmes *tu nivel de escolaridad*. ¿Puedes?',
                                        'Ey Oscar 👀 Tengo candidatos con un perfil similar al tuyo avanzando en el proceso. Solo me falta *tu nivel de escolaridad* de tu parte. ¿Seguimos?',
                                        'Oscar, no quiero que pierdas una buena oportunidad por un dato 🙏 Solo me falta *tu nivel de escolaridad*. ¿Me lo compartes?',
                                    ],
                                },
                                {
                                    n: 3, tone: 'FOMO · cierre',
                                    variants: [
                                        'Oscar, voy a cerrar tu expediente si no me confirmas *tu nivel de escolaridad* 📁 ¿Me lo dices antes de que lo archive?',
                                        'Oscar 🎯 Tengo una vacante que podría ser para ti pero necesito confirmar *tu nivel de escolaridad* antes de incluirte. ¿Me lo dices?',
                                        'Oscar, solo para cerrar: necesito *tu nivel de escolaridad* para tenerte en cuenta en futuras vacantes. ¿Me lo puedes decir? 🙌',
                                    ],
                                },
                            ].slice(0, draft.maxAttempts).map(({ n, tone, variants }) => (
                                <div key={n}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-black flex items-center justify-center">{n}</span>
                                        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{tone}</span>
                                    </div>
                                    <div className="space-y-1.5 pl-7">
                                        {variants.map((msg, i) => (
                                            <p key={i} className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                                <span className="text-[9px] font-bold text-gray-300 dark:text-gray-600 mr-1.5">V{i + 1}</span>
                                                {msg}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-1">
                                La variante (V1/V2/V3) se elige automáticamente por candidato y no cambia entre intentos.
                            </p>
                        </div>

                        <button
                            onClick={handleSaveConfig}
                            disabled={saving}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-60"
                        >
                            {saving ? 'Guardando...' : 'Guardar reglas'}
                        </button>
                    </div>
                )}
                {(!showConfig || !draft) && (
                    <div className={`${PANEL_BODY_CLASS} p-5 flex items-center justify-center text-center`}>
                        <div>
                            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
                                <ChevronDown className="w-5 h-5 text-gray-400" />
                            </div>
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Reglas contraídas</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Abre el panel para ajustar tiempos e intentos.</p>
                        </div>
                    </div>
                )}
            </div>

            {templatesPanel}

            {/* ── Cola de candidatos ────────────────────────────────────────── */}
            <div className={PANEL_CLASS}>
                <div className={PANEL_HEADER_CLASS}>
                    <PanelTitle icon={ListTodo} title="Listas de pendientes" />
                    <button
                        onClick={refreshQueue}
                        disabled={queueLoading}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        title="Refrescar"
                    >
                        <RefreshCw className={`w-4 h-4 ${queueLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* List */}
                <div className={PANEL_BODY_CLASS}>
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex flex-wrap gap-1">
                            {[
                                { id: 'pending', label: 'Pendientes', count: pendingCount, color: 'amber' },
                                { id: 'sent',    label: 'Enviados hoy', count: sentToday, color: 'blue' },
                                { id: 'skipped', label: 'Saltados',   count: skippedCount, color: 'gray' },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                        activeTab === tab.id
                                            ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                                            : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                                    }`}
                                >
                                    {tab.label}<Badge count={tab.count} color={tab.color} />
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                    {activeTab === 'pending' && (
                        queue.pending?.length > 0 ? (
                            queue.pending.map(c => (
                                <CandidateRow key={c.id} cand={c} onSkip={refreshQueue} onSendNow={refreshQueue} />
                            ))
                        ) : (
                            <EmptyState icon={Clock} text="No hay candidatos pendientes" />
                        )
                    )}
                    {activeTab === 'sent' && (
                        queue.sent?.length > 0 ? (
                            queue.sent.map(c => (
                                <CandidateRow key={c.id} cand={c} isSent onSkip={refreshQueue} />
                            ))
                        ) : (
                            <EmptyState icon={CheckCircle} text="Aún no se han enviado mensajes hoy" />
                        )
                    )}
                    {activeTab === 'skipped' && (
                        queue.skipped?.length > 0 ? (
                            queue.skipped.map(c => (
                                <CandidateRow key={c.id} cand={c} isSkipped onSkip={refreshQueue} />
                            ))
                        ) : (
                            <EmptyState icon={XCircle} text="No hay candidatos saltados" />
                        )
                    )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const EmptyState = ({ icon: Icon, text }) => (
    <div className="py-10 flex flex-col items-center gap-2 text-gray-400">
        <Icon className="w-8 h-8 opacity-30" />
        <p className="text-sm">{text}</p>
    </div>
);

export default ReengagementPanel;
