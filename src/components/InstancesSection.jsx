import React, { useState, useEffect } from 'react';
import { Smartphone, Check, RefreshCw, Save, Server, Shield, Hash, Tag, Activity, Copy } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';

const InstancesSection = ({ showToast }) => {
    const [instanceId, setInstanceId] = useState('');
    const [token, setToken] = useState('');
    const [name, setName] = useState('');
    const [identifier, setIdentifier] = useState('');
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await fetch('/api/bot-ia/settings');
                if (res.ok) {
                    const data = await res.json();
                    setInstanceId(data.instanceId || '');
                    setToken(data.token || '');
                    setName(data.name || 'Instancia Principal');
                    setIdentifier(data.identifier || 'CAND-01');
                }
            } catch (error) {
                console.error('Error loading UltraMsg settings:', error);
            }
        };
        loadSettings();
    }, []);

    const handleSave = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/bot-ia/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instanceId, token, name, identifier })
            });

            if (res.ok) {
                showToast('Instancia guardada exitosamente', 'success');
                setIsEditing(false);
            } else {
                showToast('Error al guardar instancia', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        const url = `${window.location.origin}/api/whatsapp/webhook`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        showToast('Webhook URL copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
                        <Server className="w-6 h-6 text-blue-500" />
                        Instancias de Envío
                    </h2>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                        Gestiona tus conexiones de WhatsApp. Actualmente Candidatic procesa 1 instancia activa.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {!isEditing ? (
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl p-1 relative overflow-hidden shadow-2xl shadow-blue-500/20 group transition-all duration-300 hover:shadow-blue-500/40">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                        <div className="bg-white dark:bg-slate-900 rounded-[22px] p-6 lg:p-8 relative z-10 h-full flex flex-col justify-between">
                            
                            {/* Card Header */}
                            <div className="flex justify-between items-start mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center border border-blue-100 dark:border-blue-800">
                                        <Smartphone className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
                                                {name || 'Instancia Sin Nombre'}
                                            </h3>
                                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-emerald-200 dark:border-emerald-800/50">
                                                <Activity className="w-3 h-3" />
                                                Conectada
                                            </span>
                                        </div>
                                        <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5">
                                            <Tag className="w-3.5 h-3.5" /> Valor de Identificador: <strong className="text-blue-600 dark:text-blue-400 font-bold">{identifier || 'N/A'}</strong>
                                        </span>
                                    </div>
                                </div>
                                <Button onClick={() => setIsEditing(true)} variant="secondary" size="sm" className="font-bold">
                                    Editar Instancia
                                </Button>
                            </div>

                            {/* Info Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                                        <Hash className="w-4 h-4" />
                                        <span className="text-xs font-bold uppercase tracking-widest">Instance ID</span>
                                    </div>
                                    <code className="text-sm font-bold text-slate-800 dark:text-slate-200 break-all select-all">
                                        {instanceId || 'No configurado'}
                                    </code>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
                                        <Shield className="w-4 h-4" />
                                        <span className="text-xs font-bold uppercase tracking-widest">Token de Seguridad</span>
                                    </div>
                                    <code className="text-sm font-bold text-slate-800 dark:text-slate-200 break-all select-all">
                                        {token ? '••••••••••••••••' + token.substring(token.length - 4) : 'No configurado'}
                                    </code>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <Card title="Modificar Datos de la Instancia" icon={Server}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-100 dark:border-slate-800">
                            <Input
                                label="Nombre de la Instancia"
                                placeholder="Ej: Línea Corporativa MTY"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                helperText="Un nombre descriptivo para identificar rápidamente esta línea, ej: Reclutamiento Operativo."
                            />
                            <Input
                                label="Identificador Corto (Referencia)"
                                placeholder="Ej: NL-01"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                helperText="Este valor puede ser inyectado en tus flujos para saber de qué instancia proviene el candidato."
                            />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                            <Input
                                label="UltraMsg Instance ID"
                                placeholder="instance12345"
                                value={instanceId}
                                onChange={(e) => setInstanceId(e.target.value)}
                                helperText="Tu ID de instancia generada en el panel de UltraMsg."
                            />
                            <Input
                                label="UltraMsg Token"
                                type="password"
                                placeholder="token123..."
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                helperText="Tu UUID o Token de seguridad para esta conexión."
                            />
                        </div>

                        <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={() => setIsEditing(false)}
                                className="px-6 py-2.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-bold text-sm uppercase tracking-widest transition-colors"
                            >
                                Cancelar
                            </button>
                            <Button onClick={handleSave} loading={loading} icon={Save} className="bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-widest uppercase">
                                Guardar Cambios
                            </Button>
                        </div>
                    </Card>
                )}
                
                {/* Webhook Card */}
                <Card title="Webhook de Retorno" icon={RefreshCw}>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">
                        Copia esta URL de Webhook y pégala en las configuraciones de UltraMsg para que los mensajes de tus candidatos puedan entrar a Candidatic de forma automática.
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
        </div>
    );
};

export default InstancesSection;
