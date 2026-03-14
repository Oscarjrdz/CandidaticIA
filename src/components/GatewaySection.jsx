import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Wifi, WifiOff, Plus, Trash2, RefreshCw, Copy, CheckCircle,
    AlertCircle, Clock, MessageSquare, ArrowDownCircle, ArrowUpCircle,
    Smartphone, Globe, Eye, EyeOff, ChevronDown, ChevronUp, QrCode, Pencil, Save, X
} from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────
const STATE_CONFIG = {
    CONNECTED:    { label: 'Conectado',        icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
    QR_PENDING:   { label: 'Esperando QR',     icon: QrCode,      color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',     border: 'border-amber-200 dark:border-amber-800',     dot: 'bg-amber-500 animate-pulse' },
    DISCONNECTED: { label: 'Desconectado',     icon: WifiOff,     color: 'text-gray-400',    bg: 'bg-gray-50 dark:bg-gray-800/50',       border: 'border-gray-200 dark:border-gray-700',       dot: 'bg-gray-400' },
    ERROR:        { label: 'Error',            icon: AlertCircle, color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',         border: 'border-red-200 dark:border-red-800',         dot: 'bg-red-500 animate-pulse' }
};

// ─── API Helpers ───────────────────────────────────────────────────────────────
const GW = import.meta.env.VITE_GATEWAY_URL || 'https://candidaticia-production.up.railway.app';

const api = {
    listInstances: () => fetch(`${GW}/instances`).then(r => r.json()),
    createInstance: (body) => fetch(`${GW}/instances`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()),
    deleteInstance: (instanceId) => fetch(`${GW}/instances/${instanceId}`, {
        method: 'DELETE'
    }).then(r => r.json()),
    connectInstance: (instanceId) => fetch(`${GW}/connect/${instanceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId })
    }).then(r => r.json()),
    getQR: (instanceId) => fetch(`${GW}/qr/${instanceId}`).then(r => r.json()),
    getStatus: (instanceId) => fetch(`${GW}/status/${instanceId}`).then(r => r.json()),
    getHistory: (instanceId, token) => fetch(`${GW}/history/${instanceId}?token=${token}&limit=50`).then(r => r.json()),
    updateInstance: (instanceId, body) => fetch(`${GW}/instances/${instanceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()),
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const StatBadge = ({ icon: Icon, value, label, color }) => (
    <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{value}</span>
        <span className="text-xs text-gray-400">{label}</span>
    </div>
);

const CopyField = ({ label, value, masked }) => {
    const [copied, setCopied] = useState(false);
    const [show, setShow] = useState(false);

    const copy = () => {
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <code className="text-xs flex-1 text-gray-700 dark:text-gray-300 font-mono truncate">
                    {masked && !show ? '••••••••••••••••••••••••••••••••' : value}
                </code>
                {masked && (
                    <button onClick={() => setShow(!show)} className="text-gray-400 hover:text-gray-600 transition-colors">
                        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                )}
                <button onClick={copy} className="text-gray-400 hover:text-blue-500 transition-colors">
                    {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
            </div>
        </div>
    );
};

const QRModal = ({ instanceId, onClose }) => {
    const [qrData, setQrData] = useState(null);
    const [state, setState] = useState('CONNECTING');
    const [phone, setPhone] = useState(null);
    const [error, setError] = useState(null);
    const pollRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        // 1. Fire POST to start Baileys — keeps socket alive up to 55s in background
        api.connectInstance(instanceId)
            .then(res => {
                if (!mountedRef.current) return;
                if (res.state === 'CONNECTED') {
                    setState('CONNECTED');
                    setPhone(res.phone);
                    clearInterval(pollRef.current);
                } else if (res.error && !qrData) {
                    // Only show error if we never got a QR
                    setError(res.error);
                    setState('ERROR');
                    clearInterval(pollRef.current);
                }
            })
            .catch(() => { /* POST errors are handled by GET polling */ });

        // 2. Simultaneously poll GET /connect every 3s for QR image and state
        const poll = async () => {
            try {
                const res = await api.getQR(instanceId);
                if (!mountedRef.current) return;
                if (res.state === 'CONNECTED') {
                    setState('CONNECTED');
                    setPhone(res.phone);
                    clearInterval(pollRef.current);
                } else if (res.qr) {
                    setState('QR_PENDING');
                    setQrData(res.qr);
                }
            } catch {}
        };

        poll(); // Immediate first check
        pollRef.current = setInterval(poll, 3000);

        return () => {
            mountedRef.current = false;
            clearInterval(pollRef.current);
        };
    }, [instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center animate-in fade-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {state === 'CONNECTED' ? (
                    <div className="space-y-4">
                        <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto">
                            <CheckCircle className="w-10 h-10 text-emerald-500" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">¡Número vinculado! 🎉</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Número: <span className="font-mono font-bold text-emerald-600">{phone}</span>
                        </p>
                        <button onClick={onClose} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold transition-colors">
                            Listo
                        </button>
                    </div>
                ) : state === 'ERROR' ? (
                    <div className="space-y-4">
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Error de conexión</h3>
                        <p className="text-sm text-red-500">{error}</p>
                        <button onClick={onClose} className="w-full py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 rounded-xl text-sm transition-colors hover:bg-gray-50">
                            Cerrar
                        </button>
                    </div>
                ) : (
                    <div className="space-y-5">
                        <div>
                            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                                <QrCode className="w-7 h-7 text-white" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Escanea el QR</h3>
                            <p className="text-xs text-gray-500 mt-1">Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
                        </div>

                        <div className="relative mx-auto w-56 h-56 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center overflow-hidden">
                            {qrData ? (
                                <img src={qrData} alt="QR Code" className="w-full h-full object-cover rounded-2xl" />
                            ) : (
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-xs text-gray-400">{state === 'CONNECTING' ? 'Conectando...' : 'Generando QR...'}</span>
                                </div>
                            )}
                        </div>

                        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
                            ⏱ Puede tardar hasta 30 segundos en aparecer
                        </p>

                        <button onClick={onClose} className="w-full py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                            Cancelar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const HistoryDrawer = ({ instanceId, token, onClose }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getHistory(instanceId, token)
            .then(r => setHistory(r.history || []))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [instanceId, token]);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-blue-500" />
                        Historial de mensajes
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl">×</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {loading ? (
                        <div className="flex items-center justify-center h-32">
                            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">Sin mensajes aún</p>
                        </div>
                    ) : history.map((msg, i) => (
                        <div key={i} className={`flex gap-3 p-3 rounded-xl ${msg.direction === 'in' ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
                            {msg.direction === 'in'
                                ? <ArrowDownCircle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                                : <ArrowUpCircle className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                            }
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                    {msg.direction === 'in' ? `De: ${msg.from}` : `Para: ${msg.to}`}
                                </p>
                                <p className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 break-words">{msg.body}</p>
                                <p className="text-xs text-gray-400 mt-1">{new Date(msg.timestamp).toLocaleString('es-MX')}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ─── Instance Card ────────────────────────────────────────────────────────────
const InstanceCard = ({ instance, fullToken, onDelete, onRefresh, showToast }) => {
    const [showQR, setShowQR] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [editingWebhook, setEditingWebhook] = useState(false);
    const [webhookDraft, setWebhookDraft] = useState(instance.webhookUrl || '');
    const [savingWebhook, setSavingWebhook] = useState(false);
    const [liveStatus, setLiveStatus] = useState({
        state: instance.state,
        messagesIn: instance.messagesIn || 0,
        messagesOut: instance.messagesOut || 0,
        phone: instance.phone
    });

    const stateConf = STATE_CONFIG[liveStatus.state] || STATE_CONFIG.DISCONNECTED;
    const StateIcon = stateConf.icon;

    // ⚠️ NO auto-polling — was causing cascading re-renders across the whole app.
    // Status refreshes when user clicks "Actualizar" manually or when QR modal closes.


    const handleSaveWebhook = async () => {
        setSavingWebhook(true);
        try {
            const res = await fetch(`/api/gateway/instances?instanceId=${instance.instanceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ webhookUrl: webhookDraft.trim() })
            }).then(r => r.json());
            if (res.success) {
                showToast('Webhook actualizado ✅', 'success');
                instance.webhookUrl = webhookDraft.trim();
                setEditingWebhook(false);
            } else {
                showToast(res.error || 'Error al guardar', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setSavingWebhook(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm(`¿Eliminar la instancia "${instance.name}"? Esta acción no se puede deshacer.`)) return;
        setDeleting(true);
        try {
            const res = await onDelete(instance.instanceId);
            if (res.success) showToast('Instancia eliminada', 'success');
            else showToast(res.error || 'Error al eliminar', 'error');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className={`rounded-2xl border ${stateConf.border} ${stateConf.bg} transition-all duration-300 overflow-hidden shadow-sm hover:shadow-md`}>
            {/* Card Header */}
            <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                            <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                                <Smartphone className="w-5 h-5 text-white" />
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${stateConf.dot}`} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-bold text-gray-900 dark:text-white text-sm truncate">{instance.name}</h3>
                            <p className={`text-xs font-medium flex items-center gap-1 ${stateConf.color}`}>
                                <StateIcon className="w-3 h-3" />
                                {stateConf.label}
                                {liveStatus.phone && <span className="text-gray-400 font-normal ml-1">· {liveStatus.phone}</span>}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {liveStatus.state !== 'CONNECTED' && (
                            <button
                                onClick={() => setShowQR(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                            >
                                <QrCode className="w-3.5 h-3.5" />
                                {liveStatus.state === 'QR_PENDING' ? 'Ver QR' : 'Conectar'}
                            </button>
                        )}
                        <button
                            onClick={() => setShowHistory(true)}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                            title="Historial"
                        >
                            <MessageSquare className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                            title="Eliminar"
                        >
                            {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
                        >
                            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {/* Stats Row */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-black/5 dark:border-white/5">
                    <StatBadge icon={ArrowDownCircle} value={liveStatus.messagesIn} label="recibidos" color="text-blue-500" />
                    <StatBadge icon={ArrowUpCircle} value={liveStatus.messagesOut} label="enviados" color="text-purple-500" />
                    {instance.webhookUrl && (
                        <div className="flex items-center gap-1 ml-auto">
                            <Globe className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-400 truncate max-w-[120px]">{instance.webhookUrl.replace(/https?:\/\//, '')}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Expanded Details */}
            {expanded && (
                <div className="px-5 pb-5 space-y-3 border-t border-black/5 dark:border-white/5 pt-4">
                    <CopyField label="Instance ID" value={instance.instanceId} />
                    <CopyField label="Token" value={fullToken || instance.token} masked={true} />

                    {/* Webhook URL — editable */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Webhook URL</label>
                            {!editingWebhook ? (
                                <button
                                    onClick={() => { setWebhookDraft(instance.webhookUrl || ''); setEditingWebhook(true); }}
                                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
                                >
                                    <Pencil className="w-3 h-3" /> Editar
                                </button>
                            ) : (
                                <button
                                    onClick={() => setEditingWebhook(false)}
                                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <X className="w-3 h-3" /> Cancelar
                                </button>
                            )}
                        </div>
                        {editingWebhook ? (
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={webhookDraft}
                                    onChange={e => setWebhookDraft(e.target.value)}
                                    placeholder="https://tu-servidor.com/api/webhook"
                                    className="flex-1 px-3 py-2 text-xs bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                    onClick={handleSaveWebhook}
                                    disabled={savingWebhook}
                                    className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                                >
                                    {savingWebhook ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                    Guardar
                                </button>
                            </div>
                        ) : (
                            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate block">
                                    {instance.webhookUrl || <span className="italic text-gray-400">Sin webhook configurado</span>}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modals */}
            {showQR && (
                <QRModal
                    instanceId={instance.instanceId}
                    onClose={() => { setShowQR(false); onRefresh(); }}
                />
            )}
            {showHistory && (
                <HistoryDrawer
                    instanceId={instance.instanceId}
                    token={fullToken || instance.token}
                    onClose={() => setShowHistory(false)}
                />
            )}
        </div>
    );
};

// ─── Create Instance Form ──────────────────────────────────────────────────────
const CreateInstanceForm = ({ onCreated, showToast }) => {
    const [name, setName] = useState('');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [show, setShow] = useState(false);

    const handleCreate = async () => {
        if (!name.trim()) { showToast('El nombre es requerido', 'error'); return; }
        setLoading(true);
        try {
            const res = await api.createInstance({ name, webhookUrl });
            if (res.success) {
                showToast(`Instancia "${name}" creada ✅`, 'success');
                setName('');
                setWebhookUrl('');
                setShow(false);
                onCreated(res.instance);
            } else {
                showToast(res.error || 'Error al crear instancia', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!show) {
        return (
            <button
                onClick={() => setShow(true)}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
                <Plus className="w-4 h-4" />
                Nueva Instancia
            </button>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800/50 rounded-2xl p-5 shadow-lg animate-in slide-in-from-top-2 duration-200">
            <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <Plus className="w-3.5 h-3.5 text-blue-600" />
                </div>
                Nueva Instancia Gateway
            </h3>
            <div className="space-y-3">
                <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                        Nombre de la instancia <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="ej. brenda-monterrey-01"
                        className="w-full px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                        Webhook URL <span className="text-gray-400 font-normal">(opcional)</span>
                    </label>
                    <input
                        type="url"
                        value={webhookUrl}
                        onChange={e => setWebhookUrl(e.target.value)}
                        placeholder="https://tu-servidor.com/api/webhook"
                        className="w-full px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                    <p className="text-xs text-gray-400 mt-1">Los mensajes entrantes se reenviarán a esta URL</p>
                </div>
                <div className="flex gap-2 pt-1">
                    <button
                        onClick={() => setShow(false)}
                        className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={loading || !name.trim()}
                        className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {loading ? 'Creando...' : 'Crear instancia'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Main Section ─────────────────────────────────────────────────────────────

// Token storage — persists across page refreshes
const GW_TOKENS_KEY = 'gw_tokens';
const loadStoredTokens = () => { try { return JSON.parse(localStorage.getItem(GW_TOKENS_KEY) || '{}'); } catch { return {}; } };
const saveStoredTokens = (tokens) => { try { localStorage.setItem(GW_TOKENS_KEY, JSON.stringify(tokens)); } catch {} };

export default function GatewaySection({ showToast }) {
    const [instances, setInstances] = useState([]);
    // Full tokens: loaded from localStorage, updated on new instance creation
    const [instanceTokens, setInstanceTokens] = useState(loadStoredTokens);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadInstances = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);
        try {
            const res = await api.listInstances();
            if (res.success) setInstances(res.instances || []);
        } catch {
            if (!silent) showToast('Error al cargar instancias', 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [showToast]);

    useEffect(() => { loadInstances(); }, [loadInstances]);

    const handleCreated = (newInstance) => {
        // Store full token in localStorage — survives page refresh
        const updated = { ...loadStoredTokens(), [newInstance.instanceId]: newInstance.token };
        saveStoredTokens(updated);
        setInstanceTokens(updated);
        setInstances(prev => [newInstance, ...prev]);
    };

    const handleDelete = async (instanceId) => {
        const res = await api.deleteInstance(instanceId);
        if (res.success) {
            setInstances(prev => prev.filter(i => i.instanceId !== instanceId));
            const updated = { ...loadStoredTokens() };
            delete updated[instanceId];
            saveStoredTokens(updated);
            setInstanceTokens(updated);
        }
        return res;
    };

    const connectedCount = instances.filter(i => i.state === 'CONNECTED').length;
    const totalMessages = instances.reduce((a, i) => a + (i.messagesIn || 0) + (i.messagesOut || 0), 0);

    return (
        <div className="space-y-6 pb-8 max-w-3xl mx-auto">

            {/* Header Banner */}
            <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-purple-700 rounded-2xl p-6 shadow-xl">
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-300 rounded-full translate-y-1/2 -translate-x-1/2" />
                </div>
                <div className="relative flex items-center justify-between gap-4">
                    <div className="text-white">
                        <div className="flex items-center gap-2 mb-1">
                            <Wifi className="w-5 h-5 text-blue-200" />
                            <span className="text-blue-200 text-xs font-bold uppercase tracking-widest">Candidatic Gateway</span>
                        </div>
                        <h2 className="text-2xl font-extrabold">WhatsApp Gateway</h2>
                        <p className="text-blue-200 text-sm mt-1 max-w-sm">
                            Tu propio servicio de instancias WhatsApp. Crea, conecta y gestiona números de forma independiente.
                        </p>
                    </div>
                    <div className="hidden sm:grid grid-cols-2 gap-3 shrink-0">
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center border border-white/20">
                            <p className="text-2xl font-bold text-white">{instances.length}</p>
                            <p className="text-xs text-blue-200">Instancias</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center border border-white/20">
                            <p className="text-2xl font-bold text-white">{connectedCount}</p>
                            <p className="text-xs text-blue-200">Conectadas</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center border border-white/20 col-span-2">
                            <p className="text-2xl font-bold text-white">{totalMessages.toLocaleString()}</p>
                            <p className="text-xs text-blue-200">Mensajes totales</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Create Form */}
            <CreateInstanceForm onCreated={handleCreated} showToast={showToast} />

            {/* Instances List */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">
                        {instances.length === 0 ? 'Sin instancias' : `${instances.length} instancia${instances.length !== 1 ? 's' : ''}`}
                    </h3>
                    <button
                        onClick={() => loadInstances(true)}
                        disabled={refreshing}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-500 transition-colors"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                        Actualizar
                    </button>
                </div>

                {loading ? (
                    <div className="space-y-3">
                        {[...Array(2)].map((_, i) => (
                            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : instances.length === 0 ? (
                    <div className="text-center py-16 space-y-3">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto">
                            <Wifi className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                        </div>
                        <p className="text-gray-500 dark:text-gray-400 font-medium">Sin instancias Gateway</p>
                        <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                            Crea tu primera instancia, escanea el QR con WhatsApp y empieza a enviar mensajes.
                        </p>
                    </div>
                ) : (
                    instances.map(instance => (
                        <InstanceCard
                            key={instance.instanceId}
                            instance={instance}
                            fullToken={instanceTokens[instance.instanceId]}
                            onDelete={handleDelete}
                            onRefresh={() => loadInstances(true)}
                            showToast={showToast}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
