/**
 * Utilidades para almacenamiento local (localStorage)
 */

const STORAGE_KEYS = {
    CREDENTIALS: 'builderbot_credentials',
    WEBHOOK_CONFIG: 'builderbot_webhook_config',
    CONNECTION_HISTORY: 'builderbot_connection_history',
    EVENT_SETTINGS: 'builderbot_event_settings',
    THEME: 'builderbot_theme',
};

/**
 * Guardar credenciales
 */
export const saveCredentials = (botId, answerId, apiKey) => {
    try {
        const credentials = { botId, answerId, apiKey };
        localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error al guardar credenciales' };
    }
};

/**
 * Obtener credenciales
 */
export const getCredentials = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.CREDENTIALS);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        return null;
    }
};

/**
 * Guardar configuración de webhook
 */
export const saveWebhookConfig = (config) => {
    try {
        localStorage.setItem(STORAGE_KEYS.WEBHOOK_CONFIG, JSON.stringify(config));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error al guardar configuración' };
    }
};

/**
 * Obtener configuración de webhook
 */
export const getWebhookConfig = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.WEBHOOK_CONFIG);
        return data ? JSON.parse(data) : { url: '', headers: [] };
    } catch (error) {
        return { url: '', headers: [] };
    }
};

/**
 * Guardar entrada en historial de conexiones
 */
export const saveConnectionHistory = (entry) => {
    try {
        const history = getConnectionHistory();
        const newHistory = [entry, ...history].slice(0, 5); // Mantener solo las últimas 5
        localStorage.setItem(STORAGE_KEYS.CONNECTION_HISTORY, JSON.stringify(newHistory));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error al guardar historial' };
    }
};

/**
 * Obtener historial de conexiones
 */
export const getConnectionHistory = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.CONNECTION_HISTORY);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        return [];
    }
};

/**
 * Guardar configuración de eventos
 */
export const saveEventSettings = (settings) => {
    try {
        localStorage.setItem(STORAGE_KEYS.EVENT_SETTINGS, JSON.stringify(settings));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error al guardar configuración de eventos' };
    }
};

/**
 * Obtener configuración de eventos
 */
export const getEventSettings = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.EVENT_SETTINGS);
        return data ? JSON.parse(data) : {};
    } catch (error) {
        return {};
    }
};

/**
 * Guardar tema (dark/light)
 */
export const saveTheme = (theme) => {
    try {
        localStorage.setItem(STORAGE_KEYS.THEME, theme);
        return { success: true };
    } catch (error) {
        return { success: false };
    }
};

/**
 * Obtener tema
 */
export const getTheme = () => {
    try {
        return localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    } catch (error) {
        return 'light';
    }
};

/**
 * Exportar toda la configuración como JSON
 */
export const exportConfig = () => {
    try {
        const config = {
            credentials: getCredentials(),
            webhookConfig: getWebhookConfig(),
            connectionHistory: getConnectionHistory(),
            eventSettings: getEventSettings(),
            theme: getTheme(),
            exportedAt: new Date().toISOString(),
        };
        return { success: true, data: config };
    } catch (error) {
        return { success: false, error: 'Error al exportar configuración' };
    }
};

/**
 * Importar configuración desde JSON
 */
export const importConfig = (jsonString) => {
    try {
        const config = JSON.parse(jsonString);

        if (config.credentials) {
            saveCredentials(config.credentials.botId, config.credentials.answerId, config.credentials.apiKey);
        }
        if (config.webhookConfig) {
            saveWebhookConfig(config.webhookConfig);
        }
        if (config.connectionHistory) {
            localStorage.setItem(STORAGE_KEYS.CONNECTION_HISTORY, JSON.stringify(config.connectionHistory));
        }
        if (config.eventSettings) {
            saveEventSettings(config.eventSettings);
        }
        if (config.theme) {
            saveTheme(config.theme);
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error al importar configuración: formato JSON inválido' };
    }
};

/**
 * Limpiar todo el almacenamiento
 */
export const clearAllStorage = () => {
    try {
        Object.values(STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error al limpiar almacenamiento' };
    }
};
