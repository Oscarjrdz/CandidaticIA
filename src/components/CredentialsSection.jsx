import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Save } from 'lucide-react';
import Card from './ui/Card';
import Input from './ui/Input';
import Button from './ui/Button';
import { validateBotId, validateAnswerId, validateApiKey } from '../utils/validation';
import { saveCredentials, getCredentials } from '../utils/storage';

/**
 * Sección de Configuración de Credenciales
 */
const CredentialsSection = ({ onCredentialsChange, showToast }) => {
    const [botId, setBotId] = useState('');
    const [answerId, setAnswerId] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);

    // Cargar credenciales guardadas al montar
    useEffect(() => {
        const saved = getCredentials();
        if (saved) {
            setBotId(saved.botId || '');
            setAnswerId(saved.answerId || '');
            setApiKey(saved.apiKey || '');
            onCredentialsChange(saved.botId, saved.answerId, saved.apiKey);
        }
    }, []);

    const handleSave = async () => {
        setLoading(true);
        setErrors({});

        // Validar Bot ID
        const botIdValidation = validateBotId(botId);
        if (!botIdValidation.valid) {
            setErrors(prev => ({ ...prev, botId: botIdValidation.error }));
            setLoading(false);
            return;
        }

        // Validar Answer ID
        const answerIdValidation = validateAnswerId(answerId);
        if (!answerIdValidation.valid) {
            setErrors(prev => ({ ...prev, answerId: answerIdValidation.error }));
            setLoading(false);
            return;
        }

        // Validar API Key
        const apiKeyValidation = validateApiKey(apiKey);
        if (!apiKeyValidation.valid) {
            setErrors(prev => ({ ...prev, apiKey: apiKeyValidation.error }));
            setLoading(false);
            return;
        }

        // Guardar en Redis + localStorage
        const result = await saveCredentials(botId, answerId, apiKey);

        setLoading(false);

        if (result.success) {
            showToast('Credenciales guardadas correctamente', 'success');
            onCredentialsChange(botId, answerId, apiKey);
        } else {
            showToast(result.error || 'Error al guardar credenciales', 'error');
        }
    };

    return (
        <Card
            title="Credenciales de BuilderBot"
            icon={Key}
        >
            <div className="space-y-4">
                <Input
                    label="Bot ID"
                    placeholder="bc080642-8cc1-4de8-9771-73c16fe5c5da"
                    value={botId}
                    onChange={(e) => setBotId(e.target.value)}
                    error={errors.botId}
                    helperText="ID único de tu bot en BuilderBot"
                />

                <Input
                    label="Answer ID"
                    placeholder="a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6"
                    value={answerId}
                    onChange={(e) => setAnswerId(e.target.value)}
                    error={errors.answerId}
                    helperText="ID de respuesta de tu bot en BuilderBot"
                />

                <div className="relative">
                    <Input
                        label="API Key"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="bb-c3818227-e17a-455c-b3b1-484b3512e055"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        error={errors.apiKey}
                        helperText="Tu API key de BuilderBot (mantén segura)"
                    />
                    <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-9 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 smooth-transition"
                    >
                        {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
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
