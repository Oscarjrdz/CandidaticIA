import React from 'react';
import AISettings from './AISettings';
import UltraMsgSettings from './UltraMsgSettings';

/**
 * Sección de Settings (configuración)
 */
const SettingsSection = ({ botId, apiKey, onCredentialsChange, showToast }) => {
    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Configuración del Sistema</h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <UltraMsgSettings showToast={showToast} />
                <AISettings showToast={showToast} />
            </div>
        </div>
    );
};

export default SettingsSection;
