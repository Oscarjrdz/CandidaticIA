import React, { useState } from 'react';
import { Send, Phone } from 'lucide-react';
import Card from './ui/Card';
import Input from './ui/Input';
import Button from './ui/Button';
import { validatePhoneNumber } from '../utils/validation';
import { sendTestMessage } from '../services/builderbot';

/**
 * Sección de Prueba Rápida
 */
const QuickTest = ({ botId, apiKey, showToast }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [message, setMessage] = useState('');
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState(null);

    const handleSend = async () => {
        if (!botId || !apiKey) {
            showToast('Por favor, configura tus credenciales primero', 'error');
            return;
        }

        setLoading(true);
        setErrors({});
        setResponse(null);

        // Validar número de teléfono
        const phoneValidation = validatePhoneNumber(phoneNumber);
        if (!phoneValidation.valid) {
            setErrors({ phone: phoneValidation.error });
            setLoading(false);
            return;
        }

        // Validar mensaje
        if (!message || message.trim().length === 0) {
            setErrors({ message: 'El mensaje no puede estar vacío' });
            setLoading(false);
            return;
        }

        // Enviar mensaje de prueba
        const result = await sendTestMessage(
            botId,
            apiKey,
            phoneValidation.cleaned,
            message.trim()
        );

        setLoading(false);

        if (result.success) {
            setResponse(result);
            showToast('Mensaje enviado correctamente', 'success');
            // Limpiar campos
            setPhoneNumber('');
            setMessage('');
        } else {
            setResponse(result);
            showToast(result.error, 'error');
        }
    };

    return (
        <Card
            title="Prueba Rápida"
            icon={Send}
        >
            <div className="space-y-4">
                <Input
                    label="Número de Teléfono"
                    placeholder="+52 123 456 7890"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    error={errors.phone}
                    helperText="Incluye código de país (ej: +52 para México)"
                    icon={Phone}
                />

                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Mensaje de Prueba
                    </label>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Escribe tu mensaje de prueba aquí..."
                        rows={4}
                        className={`
              w-full px-4 py-2.5 
              bg-white dark:bg-gray-800 
              border rounded-lg 
              text-gray-900 dark:text-gray-100
              placeholder-gray-400 dark:placeholder-gray-500
              smooth-transition
              focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:border-transparent
              resize-none
              ${errors.message ? 'border-error focus:ring-error' : 'border-gray-300 dark:border-gray-600'}
            `}
                    />
                    {errors.message && (
                        <p className="mt-1.5 text-sm text-error animate-fade-in">
                            {errors.message}
                        </p>
                    )}
                </div>

                <Button
                    onClick={handleSend}
                    loading={loading}
                    icon={Send}
                    variant="primary"
                    className="w-full"
                >
                    Enviar Mensaje de Prueba
                </Button>

                {/* Respuesta del servidor */}
                {response && (
                    <div className={`
            p-4 rounded-lg border animate-fade-in
            ${response.success
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                        }
          `}>
                        <div className="flex items-start space-x-2 mb-2">
                            <div className={`
                font-semibold text-sm
                ${response.success ? 'text-green-900 dark:text-green-300' : 'text-red-900 dark:text-red-300'}
              `}>
                                {response.success ? '✅ Éxito' : '❌ Error'}
                            </div>
                            <div className={`
                text-xs font-medium
                ${response.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}
              `}>
                                HTTP {response.status}
                            </div>
                        </div>

                        {response.message && (
                            <p className={`
                text-sm mb-2
                ${response.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}
              `}>
                                {response.message}
                            </p>
                        )}

                        {response.data && (
                            <details className="mt-2">
                                <summary className={`
                  text-xs cursor-pointer
                  ${response.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}
                `}>
                                    Ver respuesta completa
                                </summary>
                                <pre className={`
                  text-xs mt-2 p-2 rounded overflow-x-auto
                  ${response.success
                                        ? 'bg-white dark:bg-gray-900 text-green-800 dark:text-green-200'
                                        : 'bg-white dark:bg-gray-900 text-red-800 dark:text-red-200'
                                    }
                `}>
                                    {JSON.stringify(response.data, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                )}

                {/* Información adicional */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
                        💡 Consejos
                    </h4>
                    <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                        <li>Asegúrate de que el número incluya el código de país</li>
                        <li>El bot debe estar conectado para enviar mensajes</li>
                        <li>Verifica que el número esté registrado en WhatsApp</li>
                    </ul>
                </div>
            </div>
        </Card>
    );
};

export default QuickTest;
