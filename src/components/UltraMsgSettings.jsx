
import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Plus, Trash2, Check, Copy, Save, Wifi, WifiOff, QrCode, RefreshCw, Users, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';

const GATEWAY_BASE_URL = 'https://gatewaywapp-production.up.railway.app';

/**
 * InstanceCard — individual expandable card for each WhatsApp line
 */
const InstanceCard = ({ instance, index, onUpdate, onDelete, onStatusCheck, showToast }) => {
    const [expanded, setExpanded] = useState(false);
    const [checking, setChecking] = useState(false);
    const [status, setStatus] = useState(null);
    const [qrImage, setQrImage] = useState(null);
    const [loadingQr, setLoadingQr] = useState(false);

    const checkStatus = useCallback(async () => {
        if (!instance.instanceId || !instance.token) return;
        setChecking(true);
        try {
            const res = await fetch(`${GATEWAY_BASE_URL}/${instance.instanceId}/status?token=${instance.token}`);
            if (res.ok) {
                const data = await res.json();
                setStatus(data.status);
                onStatusCheck?.(index, data.status);
            } else {
                setStatus('error');
            }
        } catch (e) {
            setStatus('unreachable');
        } finally {
            setChecking(false);
        }
    }, [instance.instanceId, instance.token, index, onStatusCheck]);

    const fetchQr = async () => {
        if (!instance.instanceId || !instance.token) return;
        setLoadingQr(true);
        try {
            const res = await fetch(`${GATEWAY_BASE_URL}/${instance.instanceId}/qr?token=${instance.token}`);
            if (res.ok) {
                const data = await res.json();
                if (data.qr) {
                    setQrImage(data.qr);
                } else {
                    showToast('No hay QR disponible — la sesión ya está autenticada', 'success');
                }
            }
        } catch (e) {
            showToast('Error obteniendo QR', 'error');
        } finally {
            setLoadingQr(false);
        }
    };

    useEffect(() => {
        if (instance.instanceId && instance.token) {
            checkStatus();
        }
    }, [instance.instanceId, instance.token, checkStatus]);

    const statusConfig = {
        authenticated: { color: 'bg-emerald-500', text: 'Conectada', icon: Wifi },
        qr: { color: 'bg-amber-500', text: 'Esperando QR', icon: QrCode },
        loading: { color: 'bg-blue-500 animate-pulse', text: 'Conectando...', icon: RefreshCw },
        disconnected: { color: 'bg-red-500', text: 'Desconectada', icon: WifiOff },
        error: { color: 'bg-red-500', text: 'Error', icon: WifiOff },
        unreachable: { color: 'bg-gray-400', text: 'Sin acceso', icon: WifiOff },
    };

    const st = statusConfig[status] || statusConfig.disconnected;
    const StIcon = st.icon;

    return (
        <div className={`
            border rounded-xl overflow-hidden smooth-transition
            ${status === 'authenticated' 
                ? 'border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-gray-800' 
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}
        `}>
            {/* Header Row */}
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 smooth-transition"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${st.color}`} />
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                {instance.name || `Línea ${index + 1}`}
                            </span>
                            {instance.identifier && (
                                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                    {instance.identifier}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <StIcon className="w-3 h-3 text-gray-400" />
                            <span className="text-[11px] text-gray-500 dark:text-gray-400">{st.text}</span>
                            {instance.candidateCount > 0 && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                    <Users className="w-3 h-3" /> {instance.candidateCount}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {checking && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    {expanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                </div>
            </div>

            {/* Expandable Details */}
            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3 animate-fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                            label="Nombre"
                            placeholder="Línea Principal"
                            value={instance.name || ''}
                            onChange={(e) => onUpdate(index, 'name', e.target.value)}
                        />
                        <Input
                            label="Identificador"
                            placeholder="CAND-01"
                            value={instance.identifier || ''}
                            onChange={(e) => onUpdate(index, 'identifier', e.target.value)}
                        />
                    </div>
                    <Input
                        label="Instance ID"
                        placeholder="instance12345"
                        value={instance.instanceId || ''}
                        onChange={(e) => onUpdate(index, 'instanceId', e.target.value)}
                        helperText="Tu ID de instancia generada en el Gateway"
                    />
                    <Input
                        label="Token"
                        type="password"
                        placeholder="token123..."
                        value={instance.token || ''}
                        onChange={(e) => onUpdate(index, 'token', e.target.value)}
                        helperText="UUID de seguridad del Gateway"
                    />

                    <div className="flex items-center gap-2 pt-1">
                        <button
                            onClick={checkStatus}
                            disabled={checking}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                            <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
                            Verificar Estado
                        </button>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <button
                            onClick={fetchQr}
                            disabled={loadingQr}
                            className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                        >
                            <QrCode className={`w-3 h-3 ${loadingQr ? 'animate-pulse' : ''}`} />
                            Obtener QR
                        </button>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <button
                            onClick={() => onDelete(index)}
                            className="text-xs text-red-500 hover:underline flex items-center gap-1"
                        >
                            <Trash2 className="w-3 h-3" />
                            Eliminar
                        </button>
                    </div>

                    {/* QR Code Display */}
                    {qrImage && (
                        <div className="flex flex-col items-center p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                            <p className="text-xs text-gray-500 mb-2">Escanea con WhatsApp para vincular:</p>
                            <img src={qrImage} alt="QR Code" className="w-48 h-48 rounded" />
                            <button
                                onClick={() => setQrImage(null)}
                                className="mt-2 text-[10px] text-gray-400 hover:text-gray-600"
                            >
                                Cerrar QR
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * UltraMsgSettings — Multi-Instance WhatsApp Management
 */
const UltraMsgSettings = ({ showToast }) => {
    const [instances, setInstances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    const [creatingNew, setCreatingNew] = useState(false);

    // Load instances from Redis (multi-instance array)
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/bot-ia/instances');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        setInstances(data);
                    } else {
                        // Fallback: try loading from legacy single-instance settings
                        const legacyRes = await fetch('/api/bot-ia/settings');
                        if (legacyRes.ok) {
                            const legacy = await legacyRes.json();
                            if (legacy.instanceId) {
                                setInstances([{
                                    id: Date.now().toString(),
                                    name: legacy.name || 'Línea WhatsApp Principal',
                                    identifier: legacy.identifier || 'CAND-01',
                                    instanceId: legacy.instanceId,
                                    token: legacy.token,
                                    status: 'active'
                                }]);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error loading instances:', e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleUpdate = (index, field, value) => {
        setInstances(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    const handleDelete = (index) => {
        if (!confirm('¿Eliminar esta línea WhatsApp? Los candidatos asignados quedarán sin instancia.')) return;
        setInstances(prev => prev.filter((_, i) => i !== index));
        showToast('Línea eliminada. Guarda para aplicar cambios.', 'success');
    };

    const handleAddManual = () => {
        setInstances(prev => [...prev, {
            id: Date.now().toString(),
            name: `Línea ${prev.length + 1}`,
            identifier: `CAND-${String(prev.length + 1).padStart(2, '0')}`,
            instanceId: '',
            token: '',
            status: 'active'
        }]);
        showToast('Nueva línea agregada. Completa los datos y guarda.', 'success');
    };

    const handleCreateFromGateway = async () => {
        setCreatingNew(true);
        try {
            const res = await fetch(`${GATEWAY_BASE_URL}/instances`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                // data = { instance_id: 'instanceABC', token: 'xyz...' }

                const newInstance = {
                    id: Date.now().toString(),
                    name: `Línea ${instances.length + 1}`,
                    identifier: `CAND-${String(instances.length + 1).padStart(2, '0')}`,
                    instanceId: data.instance_id,
                    token: data.token,
                    status: 'active'
                };
                setInstances(prev => [...prev, newInstance]);
                showToast(`Instancia ${data.instance_id} creada en el Gateway. ¡Guarda y escanea el QR!`, 'success');
            } else {
                showToast('Error creando instancia en el Gateway', 'error');
            }
        } catch (e) {
            showToast('No se pudo conectar al Gateway. ¿Está corriendo?', 'error');
        } finally {
            setCreatingNew(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // 1. Save multi-instance array to Redis
            const res = await fetch('/api/bot-ia/instances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instances })
            });

            // 2. Also sync first instance to legacy ultramsg_credentials for backward compatibility
            if (instances.length > 0) {
                await fetch('/api/bot-ia/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instanceId: instances[0].instanceId,
                        token: instances[0].token,
                        name: instances[0].name,
                        identifier: instances[0].identifier
                    })
                });
            }

            // 3. Configure webhooks on the Gateway for each instance
            for (const inst of instances) {
                if (inst.instanceId && inst.token) {
                    try {
                        await fetch(`${GATEWAY_BASE_URL}/${inst.instanceId}/settings/webhook`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                token: inst.token,
                                webhook_url: `${window.location.origin}/api/whatsapp/webhook`,
                                webhook_message_received: true,
                                webhook_message_ack: true,
                                instance_name: inst.name || ''
                            })
                        });
                    } catch (e) {
                        console.warn(`Could not configure webhook for ${inst.instanceId}:`, e.message);
                    }
                }
            }

            if (res.ok) {
                showToast('Líneas WhatsApp guardadas exitosamente', 'success');
            } else {
                showToast('Error al guardar', 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = () => {
        const url = `${window.location.origin}/api/whatsapp/webhook`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        showToast('URL copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card
            title="Conexión WhatsApp API"
            icon={Smartphone}
            actions={
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                        {instances.length} {instances.length === 1 ? 'línea' : 'líneas'}
                    </span>
                </div>
            }
        >
            <div className="space-y-4">
                {/* Instance List */}
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                        <span className="ml-2 text-sm text-gray-400">Cargando instancias...</span>
                    </div>
                ) : instances.length === 0 ? (
                    <div className="text-center py-6 text-gray-400">
                        <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No hay líneas configuradas</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {instances.map((inst, i) => (
                            <InstanceCard
                                key={inst.id || i}
                                instance={inst}
                                index={i}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                                showToast={showToast}
                            />
                        ))}
                    </div>
                )}

                {/* Add New Instance Buttons */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <button
                        onClick={handleCreateFromGateway}
                        disabled={creatingNew}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 smooth-transition text-sm font-medium disabled:opacity-50"
                    >
                        {creatingNew ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Plus className="w-4 h-4" />
                        )}
                        {creatingNew ? 'Creando en Gateway...' : 'Crear Nueva Instancia'}
                    </button>
                    <button
                        onClick={handleAddManual}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/30 smooth-transition text-sm font-medium"
                    >
                        <Plus className="w-4 h-4" />
                        Agregar Manualmente
                    </button>
                </div>

                {/* Webhook URL */}
                <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Webhook URL (se configura automáticamente al guardar):
                        </span>
                        <button
                            onClick={handleCopy}
                            className="text-[10px] text-blue-600 hover:text-blue-700 font-bold flex items-center space-x-1"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copied ? 'Copiado' : 'Copiar URL'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono break-all text-gray-700 dark:text-gray-300">
                        {window.location.origin}/api/whatsapp/webhook
                    </code>
                </div>

                {/* Save Button */}
                <div className="pt-2 flex justify-end">
                    <Button onClick={handleSave} loading={saving} icon={Save} size="sm">
                        Guardar Conexiones
                    </Button>
                </div>
            </div>
        </Card>
    );
};

export default UltraMsgSettings;
