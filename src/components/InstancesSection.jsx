import React, { useState, useEffect } from 'react';
import { Smartphone, Check, RefreshCw, Save, Server, Shield, Hash, Tag, Activity, Copy, AlertCircle, QrCode, X } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';

const InstancesSection = ({ showToast }) => {
    const [instances, setInstances] = useState([]);
    const [statuses, setStatuses] = useState({});
    const [loading, setLoading] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null); // null means no edit, -1 means new, else index
    const [formData, setFormData] = useState({ name: '', identifier: '', instanceId: '', token: '' });
    const [copied, setCopied] = useState(false);
    
    // QR Code Check State
    const [qrData, setQrData] = useState(null);
    const [qrLoading, setQrLoading] = useState(false);

    useEffect(() => {
        loadInstances();
    }, []);

    const fetchStatuses = async (instList) => {
        const newStatuses = {};
        for (let i = 0; i < instList.length; i++) {
            const inst = instList[i];
            try {
                const res = await fetch(`https://gatewaywapp-production.up.railway.app/${inst.instanceId}/status?token=${inst.token}`);
                if (res.ok) {
                    const data = await res.json();
                    newStatuses[i] = data.status; // 'open', 'close', 'connecting'
                } else {
                    newStatuses[i] = 'error';
                }
            } catch (err) {
                newStatuses[i] = 'error';
            }
        }
        setStatuses(newStatuses);
    };

    const loadInstances = async () => {
        try {
            const res = await fetch('/api/bot-ia/instances');
            if (res.ok) {
                const data = await res.json();
                const arrayData = Array.isArray(data) ? data : [];
                setInstances(arrayData);
                fetchStatuses(arrayData);
            }
        } catch (error) {
            console.error('Error loading instances:', error);
        }
    };

    const handleSave = async () => {
        if (!formData.instanceId || !formData.token || !formData.identifier || !formData.name) {
            showToast('Todos los campos son obligatorios', 'error');
            return;
        }

        setLoading(true);
        try {
            let updatedInstances = [...instances];
            if (editingIndex === -1) {
                updatedInstances.push({ id: Date.now().toString(), ...formData });
            } else {
                updatedInstances[editingIndex] = { ...updatedInstances[editingIndex], ...formData };
            }

            const res = await fetch('/api/bot-ia/instances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instances: updatedInstances })
            });

            if (res.ok) {
                showToast('Instancia guardada exitosamente', 'success');
                setInstances(updatedInstances);
                setEditingIndex(null);
                fetchStatuses(updatedInstances);
            } else {
                showToast('Error al guardar instancia', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (index) => {
        if (!confirm('¿Estás seguro de que deseas eliminar esta instancia? No podrás recuperarla.')) return;
        
        const updatedInstances = instances.filter((_, i) => i !== index);
        try {
            const res = await fetch('/api/bot-ia/instances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instances: updatedInstances })
            });
            if (res.ok) {
                showToast('Instancia eliminada exitosamente', 'success');
                setInstances(updatedInstances);
                fetchStatuses(updatedInstances);
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        }
    };

    const openEdit = (index) => {
        const inst = instances[index];
        setFormData({ name: inst.name, identifier: inst.identifier, instanceId: inst.instanceId, token: inst.token });
        setEditingIndex(index);
    };

    const openNew = () => {
        setFormData({ name: '', identifier: '', instanceId: '', token: '' });
        setEditingIndex(-1);
    };

    const handleCopy = () => {
        const url = `${window.location.origin}/api/whatsapp/webhook`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        showToast('Webhook URL copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    const showQR = async (inst) => {
        setQrData(null);
        setQrLoading(true);
        try {
            const res = await fetch(`https://gatewaywapp-production.up.railway.app/${inst.instanceId}/qr?token=${inst.token}`);
            if (res.ok) {
                const data = await res.json();
                if (data.qr) {
                    setQrData(data.qr);
                } else {
                    showToast('QR no disponible o instancia ya conectada', 'error');
                }
            } else {
                showToast('Error al obtener QR, verifica tus credenciales.', 'error');
            }
        } catch (e) {
            showToast('Falla de red', 'error');
        } finally {
            setQrLoading(false);
        }
    };

    const renderStatusBadge = (index, inst) => {
        const status = statuses[index];
        if (status === 'authenticated' || status === 'open') {
            return (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-emerald-200 dark:border-emerald-800/50">
                    <Activity className="w-3 h-3" /> Conectada
                </span>
            );
        }
        if (status === 'qr' || status === 'disconnected' || status === 'error' || status === 'close') {
            return (
                <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-amber-200 dark:border-amber-800/50">
                        <AlertCircle className="w-3 h-3" /> Desconectada
                    </span>
                    <Button size="sm" onClick={() => showQR(inst)} variant="primary" icon={QrCode} className="text-[10px] py-1 h-7">Vincular QR</Button>
                </div>
            );
        }
        return (
            <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-slate-200 dark:border-slate-700">
                <RefreshCw className="w-3 h-3 animate-spin" /> {status === 'loading' ? 'Iniciando...' : 'Verificando'}
            </span>
        );
    };

    return (
        <div className="space-y-4 w-full pb-8">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px]">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/20 flex items-center justify-center transition-all">
                        <Server className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">Instancias de Envío</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            <p className="text-[10px] font-black tracking-widest uppercase text-blue-600 dark:text-blue-400">
                                GATEWAY WAPP
                            </p>
                        </div>
                    </div>
                </div>
                {editingIndex === null && (
                    <div className="flex items-center gap-3">
                        <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-widest uppercase text-sm rounded-2xl shadow-lg shadow-blue-500/20 hover:scale-105 transition-all duration-300">
                            + Nueva Instancia
                        </Button>
                    </div>
                )}
            </div>

            {editingIndex !== null ? (
                <Card title={editingIndex === -1 ? "Crear Nueva Instancia" : "Modificar Instancia"} icon={Server}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-100 dark:border-slate-800">
                        <Input
                            label="Nombre de la Instancia"
                            placeholder="Ej: Línea Corporativa MTY"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            helperText="Un nombre descriptivo para identificar rápidamente esta línea."
                        />
                        <Input
                            label="Identificador Corto (Origen)"
                            placeholder="Ej: NL-01"
                            value={formData.identifier}
                            onChange={(e) => setFormData({...formData, identifier: e.target.value})}
                            helperText="Se inyectará en candidatos para saber de qué teléfono provienen."
                        />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 relative">
                        {editingIndex === -1 && (
                            <div className="md:col-span-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div>
                                    <h4 className="text-sm font-bold text-blue-800 dark:text-blue-300">Generador Automático</h4>
                                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Crea una instancia fresca en tu servidor GatewayWapp y configura el webhook al instante.</p>
                                </div>
                                <Button 
                                    onClick={async (e) => {
                                        e.preventDefault();
                                        setLoading(true);
                                        try {
                                            const res = await fetch('https://gatewaywapp-production.up.railway.app/instances', { method: 'POST' });
                                            if (res.ok) {
                                                const data = await res.json();
                                                const newId = data.instance_id;
                                                const newToken = data.token;
                                                setFormData({...formData, instanceId: newId, token: newToken});
                                                showToast('Credenciales generadas con éxito', 'success');
                                                
                                                // Setup webhook automatically!
                                                await fetch(`https://gatewaywapp-production.up.railway.app/${newId}/settings/webhook?token=${newToken}`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        webhook_url: `${window.location.origin}/api/whatsapp/webhook`,
                                                        webhook_message_received: true,
                                                        webhook_message_ack: true
                                                    })
                                                });
                                                showToast('Webhook enlazado exitosamente', 'success');
                                            } else {
                                                showToast('Error contactando al generador', 'error');
                                            }
                                        } catch (err) {
                                            showToast('Falla de red al generar', 'error');
                                        } finally {
                                            setLoading(false);
                                        }
                                    }}
                                    className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
                                    size="sm"
                                    icon={RefreshCw}
                                >
                                    Auto-Generar
                                </Button>
                            </div>
                        )}
                        <Input
                            label="ID de Instancia (Gateway)"
                            placeholder="Ej: instance12345"
                            value={formData.instanceId}
                            onChange={(e) => setFormData({...formData, instanceId: e.target.value})}
                            helperText="Tu ID de instancia generada en el panel de GatewayWapp."
                        />
                        <Input
                            label="Token de API"
                            type="password"
                            placeholder="Ej: token123..."
                            value={formData.token}
                            onChange={(e) => setFormData({...formData, token: e.target.value})}
                            helperText="Tu Token de seguridad para esta conexión."
                        />
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                        <button
                            onClick={() => setEditingIndex(null)}
                            className="px-6 py-2.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-bold text-sm uppercase tracking-widest transition-colors"
                        >
                            Cancelar
                        </button>
                        <Button onClick={handleSave} loading={loading} icon={Save} className="bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-widest uppercase">
                            Guardar Instancia
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-6">
                    {instances.length === 0 ? (
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700">
                            <Server className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">Sin instancias configuradas</h3>
                            <p className="text-slate-500 max-w-sm mx-auto mb-6">Agrega tu primera conexión de WhatsApp para empezar a operar con Candidatic.</p>
                            <Button onClick={openNew}>+ Agregar Instancia</Button>
                        </div>
                    ) : (
                        instances.map((inst, index) => (
                            <div key={index} className="bg-gradient-to-br from-indigo-500 to-blue-600 rounded-3xl p-1 relative overflow-hidden shadow-2xl shadow-blue-500/10 group transition-all duration-300 hover:shadow-blue-500/30">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                                <div className="bg-white dark:bg-slate-900 rounded-[22px] p-6 lg:p-8 relative z-10 flex flex-col justify-between">
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center border border-blue-100 dark:border-blue-800">
                                                <Smartphone className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
                                                        {inst.name}
                                                    </h3>
                                                    {renderStatusBadge(index, inst)}
                                                </div>
                                                <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5">
                                                    <Tag className="w-3.5 h-3.5" /> Origen ID: <strong className="text-blue-600 dark:text-blue-400 font-bold">{inst.identifier}</strong>
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button onClick={() => openEdit(index)} variant="secondary" size="sm" className="font-bold">
                                                Editar
                                            </Button>
                                            <button onClick={() => handleDelete(index)} className="px-3 py-2 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-lg text-sm font-bold hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                                                Eliminar
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                                                <Hash className="w-4 h-4" />
                                                <span className="text-xs font-bold uppercase tracking-widest">Instance ID</span>
                                            </div>
                                            <code className="text-sm font-bold text-slate-800 dark:text-slate-200 break-all select-all">
                                                {inst.instanceId}
                                            </code>
                                        </div>
                                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                                                <Shield className="w-4 h-4" />
                                                <span className="text-xs font-bold uppercase tracking-widest">Token Auth</span>
                                            </div>
                                            <code className="text-sm font-bold text-slate-800 dark:text-slate-200 break-all select-all">
                                                ••••••••••••••••{inst.token.substring(inst.token.length - 4)}
                                            </code>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    
                    {/* Webhook Card */}
                    <Card title="Webhook de Retorno (Universal)" icon={RefreshCw}>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">
                            Usa la <strong>misma URL</strong> en todas las configuraciones de tu Gateway para que los mensajes de todas tus instancias sean ruteados correctamente por el multi-motor de Candidatic.
                        </p>
                        <div className="flex items-center gap-3">
                            <code className="flex-1 block p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-700 dark:text-slate-300">
                                {window.location.origin}/api/whatsapp/webhook
                            </code>
                            <Button
                                onClick={handleCopy}
                                variant={copied ? 'primary' : 'secondary'}
                                icon={copied ? Check : Copy}
                                className={`min-w-[140px] ${copied ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : ''}`}
                            >
                                {copied ? '¡Copiado!' : 'Copiar URL'}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* QR Modal Overlay */}
            {(qrData || qrLoading) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm duration-300">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative shadow-blue-500/20">
                        <button 
                            onClick={() => { setQrData(null); setQrLoading(false); }}
                            className="absolute top-6 right-6 p-2 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 mx-auto bg-blue-50 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
                                <QrCode className="w-8 h-8" />
                            </div>
                            <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Vincular WhatsApp</h3>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2">
                                Abre WhatsApp en tu celular y escanea este código para conectar la instancia.
                            </p>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 border border-slate-100 dark:border-slate-800 flex justify-center items-center min-h-[250px]">
                            {qrLoading && !qrData ? (
                                <div className="flex flex-col items-center gap-3">
                                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                                    <span className="text-sm font-bold text-slate-500 tracking-widest uppercase">Generando QR...</span>
                                </div>
                            ) : (
                                <img src={qrData} alt="WhatsApp QR Code" className="w-[200px] h-[200px] rounded-xl object-contain bg-white p-2 shadow-sm" />
                            )}
                        </div>
                        
                        <div className="mt-6 flex justify-center">
                             <Button onClick={() => { setQrData(null); setQrLoading(false); loadInstances(); }} variant="secondary" className="w-full">
                                Ya lo escaneé (Cerrar)
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InstancesSection;
