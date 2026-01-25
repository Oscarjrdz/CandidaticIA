
import React, { useState, useEffect } from 'react';
import { Smartphone, Check, Copy, RefreshCw, Save } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';

const UltraMsgSettings = ({ showToast }) => {
    const [instanceId, setInstanceId] = useState('');
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const res = await fetch('/api/bot-ia/settings');
                if (res.ok) {
                    const data = await res.json();
                    setInstanceId(data.instanceId || '');
                    setToken(data.token || '');
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
                body: JSON.stringify({ instanceId, token })
            });

            if (res.ok) {
                showToast('Configuración de UltraMsg guardada', 'success');
            } else {
                showToast('Error al guardar configuración', 'error');
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
        showToast('URL copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card title="Conexión WhatsApp (UltraMsg)" icon={Smartphone}>
            <div className="space-y-4">
                <Input
                    label="Instance ID"
                    placeholder="instance12345"
                    value={instanceId}
                    onChange={(e) => setInstanceId(e.target.value)}
                    helperText="Tu ID de instancia de UltraMsg"
                />
                <Input
                    label="Token"
                    type="password"
                    placeholder="token123..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    helperText="Tu token de seguridad de UltraMsg"
                />

                <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Webhook URL para UltraMsg:
                        </span>
                        <button
                            onClick={handleCopy}
                            className="text-[10px] text-blue-600 hover:text-blue-700 font-bold flex items-center space-x-1"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                            <span>{copied ? 'Copiado' : 'Copiar URL'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono break-all text-gray-700 dark:text-gray-300">
                        {window.location.origin}/api/whatsapp/webhook
                    </code>
                </div>

                <div className="pt-2 flex justify-end">
                    <Button onClick={handleSave} loading={loading} icon={Save} size="sm">
                        Guardar Conexión
                    </Button>
                </div>
            </div>
        </Card>
    );
};

export default UltraMsgSettings;
