import React from 'react';
import AISettings from './AISettings';

/**
 * Sección de Settings (configuración)
 * Contiene todos los componentes de configuración de BuilderBot
 */
const SettingsSection = ({ botId, apiKey, onCredentialsChange, showToast }) => {
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Configuración del Sistema</h2>

            <div className="grid grid-cols-1 gap-6">
                <AISettings showToast={showToast} />
            </div>

            <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/20">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                    Las configuraciones de conexión y el monitor de eventos antiguos han sido removidos.
                    Toda la configuración del nuevo Bot IA (UltraMsg + Gemini) se gestiona desde la sección
                    <strong> Bot IA (2.0)</strong> en el menú lateral.
                </p>
            </div>
        </div>
    );
};

export default SettingsSection;
