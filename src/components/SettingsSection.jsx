import React from 'react';
import CredentialsSection from './CredentialsSection';
import ConnectionStatus from './ConnectionStatus';
import WebhookConfig from './WebhookConfig';
import EventMonitor from './EventMonitor';
import QuickTest from './QuickTest';
import AISettings from './AISettings';

/**
 * Sección de Settings (configuración)
 * Contiene todos los componentes de configuración de BuilderBot
 */
const SettingsSection = ({ botId, apiKey, onCredentialsChange, showToast }) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Columna izquierda */}
            <div className="space-y-6">
                <CredentialsSection
                    onCredentialsChange={onCredentialsChange}
                    showToast={showToast}
                />

                <ConnectionStatus
                    botId={botId}
                    apiKey={apiKey}
                    showToast={showToast}
                />

                <WebhookConfig
                    botId={botId}
                    apiKey={apiKey}
                    showToast={showToast}
                />
            </div>

            {/* Columna derecha */}
            <div className="space-y-6">
                <EventMonitor showToast={showToast} />

                <AISettings showToast={showToast} />

                <QuickTest
                    botId={botId}
                    apiKey={apiKey}
                    showToast={showToast}
                />
            </div>
        </div>
    );
};

export default SettingsSection;
