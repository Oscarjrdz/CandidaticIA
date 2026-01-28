import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Save } from 'lucide-react';
import Card from './ui/Card';
import Input from './ui/Input';
import Button from './ui/Button';
import { validateBotId, validateAnswerId, validateApiKey } from '../utils/validation';
import { saveCredentials, getCredentials } from '../utils/storage';

import { validateInstanceId, validateToken } from '../utils/validation';
import { saveCredentials, getCredentials } from '../utils/storage';

/**
 * Sección de Configuración de Credenciales (UltraMsg)
 */
const CredentialsSection = ({ onCredentialsChange, showToast }) => {
    const [instanceId, setInstanceId] = useState('');
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);

    // Cargar credenciales guardadas al montar
    useEffect(() => {
        const saved = getCredentials();
        if (saved) {
            setInstanceId(saved.instanceId || '');
            setToken(saved.token || '');
            if (onCredentialsChange) onCredentialsChange(saved.instanceId, saved.token);
        }
    }, []);

    const handleSave = async () => {
        setLoading(true);
        setErrors({});

        // Validar Instance ID
        const instanceIdValidation = validateInstanceId(instanceId);
        if (!instanceIdValidation.valid) {
            setErrors(prev => ({ ...prev, instanceId: instanceIdValidation.error }));
            setLoading(false);
            return;
        }

        // Validar Token
        const tokenValidation = validateToken(token);
        if (!tokenValidation.valid) {
            setErrors(prev => ({ ...prev, token: tokenValidation.error }));
            setLoading(false);
            return;
        }

        // Guardar en Redis + localStorage
        const result = await saveCredentials(instanceId, token);

        setLoading(false);

        if (result.success) {
            showToast('Credenciales de UltraMsg guardadas correctamente', 'success');
            if (onCredentialsChange) onCredentialsChange(instanceId, token);
        } else {
            showToast(result.error || 'Error al guardar credenciales', 'error');
        }
    };

    return (
        <Card
            title="Credenciales UltraMsg"
            icon={Key}
        >
            <div className="space-y-4">
                <Input
                    label="Instance ID"
                    placeholder="instance12345"
                    value={instanceId}
                    onChange={(e) => setInstanceId(e.target.value)}
                    error={errors.instanceId}
                    helperText="ID único de tu instancia en UltraMsg"
                />

                <div className="relative">
                    <Input
                        label="Token"
                        type={showToken ? 'text' : 'password'}
                        placeholder="token_abc123..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        error={errors.token}
                        helperText="Tu token de seguridad de UltraMsg (mantén seguro)"
                    />
                    <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3 top-9 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 smooth-transition"
                    >
                        {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                </div>

                <Button
                    onClick={handleSave}
                    loading={loading}
                    icon={Save}
                    variant="success"
                    className="w-full"
                >
                    Guardar Credenciales
                </Button>
            </div>
        </Card>
    );
};

export default CredentialsSection;
