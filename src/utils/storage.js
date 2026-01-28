/**
 * Utilidades para almacenamiento local (localStorage)
 */

const STORAGE_KEYS = {
    CREDENTIALS: 'ultramsg_credentials',
    WEBHOOK_CONFIG: 'ultramsg_webhook_config',
    CONNECTION_HISTORY: 'ultramsg_connection_history',
    EVENT_SETTINGS: 'ultramsg_event_settings',
    THEME: 'ultramsg_theme',
};

/**
 * Guardar credenciales (Redis + localStorage)
 */
export const saveCredentials = async (instanceId, token) => {
    try {
        const credentials = { instanceId, token };

        // Save to Redis via API (for backend cron access)
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'credentials',
                    data: credentials
                })
            });

            if (!response.ok) {
                console.warn('⚠️ Failed to save credentials to Redis, using localStorage only');
            } else {
            }
        } catch (error) {
            console.warn('⚠️ Failed to save credentials to Redis:', error);
        }

        // Also save to localStorage as backup
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
            saveCredentials(config.credentials.instanceId, config.credentials.token);
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
// --- Export Settings (Redis-backed with localStorage fallback) ---
export const saveExportSettings = async (minutes) => {
    try {
        // Save to Redis via API
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'timer',
                data: minutes
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save to Redis');
        }

        // Also save to localStorage as backup
        localStorage.setItem('export_timer', minutes.toString());

    } catch (error) {
        console.warn('⚠️ Failed to save to Redis, using localStorage only:', error);
        localStorage.setItem('export_timer', minutes.toString());
    }
};

export const getExportSettings = async () => {
    try {
        // Try to get from Redis first
        const response = await fetch('/api/settings?type=timer');

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.data !== null) {
                // Update localStorage cache
                localStorage.setItem('export_timer', result.data.toString());
                return result.data;
            }
        }

        // Fallback to localStorage
        const saved = localStorage.getItem('export_timer');
        return saved ? parseInt(saved, 10) : 0;

    } catch (error) {
        console.warn('⚠️ Failed to get from Redis, using localStorage:', error);
        const saved = localStorage.getItem('export_timer');
        return saved ? parseInt(saved, 10) : 0;
    }
};

// --- Exported Chats Tracking ---
// Guardamos timestamp de ultima exportación y ID del ultimo mensaje para saber si hay cambios
export const saveExportStatus = (candidateId, stats) => {
    const current = getExportStatus();
    current[candidateId] = stats; // { lastExport: timestamp, lastMessageId: id }
    localStorage.setItem('exported_chats_status', JSON.stringify(current));
};

export const getExportStatus = () => {
    const saved = localStorage.getItem('exported_chats_status');
    return saved ? JSON.parse(saved) : {};
};

// --- Chat File IDs Management ---
/**
 * Get all chat file IDs
 * @returns {Object} Map of whatsapp number to file ID
 */
export const getChatFileIds = () => {
    try {
        const saved = localStorage.getItem('chat_file_ids');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        return {};
    }
};

/**
 * Save chat file ID for a candidate
 * @param {string} whatsapp - WhatsApp number
 * @param {string} fileId - File ID
 */
export const saveChatFileId = (whatsapp, fileId) => {
    try {
        const fileIds = getChatFileIds();
        fileIds[whatsapp] = fileId;
        localStorage.setItem('chat_file_ids', JSON.stringify(fileIds));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error saving file ID' };
    }
};

/**
 * Delete chat file ID for a candidate
 * @param {string} whatsapp - WhatsApp number
 */
export const deleteChatFileId = (whatsapp) => {
    try {
        const fileIds = getChatFileIds();
        delete fileIds[whatsapp];
        localStorage.setItem('chat_file_ids', JSON.stringify(fileIds));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error deleting file ID' };
    }
};

/**
 * Get chat file ID for a specific candidate
 * @param {string} whatsapp - WhatsApp number
 * @returns {string|null} File ID or null
 */
export const getChatFileId = (whatsapp) => {
    const fileIds = getChatFileIds();
    return fileIds[whatsapp] || null;
};

// --- Local Chat History Files ---
/**
 * Save chat history file content locally
 * @param {string} whatsapp - WhatsApp number
 * @param {string} content - Text content of the chat history
 * @returns {Object} Success status
 */
export const saveLocalChatFile = (whatsapp, content) => {
    try {
        const files = getLocalChatFiles();
        files[whatsapp] = {
            content,
            createdAt: new Date().toISOString(),
            filename: `${whatsapp}.txt`
        };
        localStorage.setItem('local_chat_files', JSON.stringify(files));
        return { success: true };
    } catch (error) {
        console.error('Error saving local chat file:', error);
        return { success: false, error: 'Error guardando archivo local' };
    }
};

/**
 * Get all local chat files
 * @returns {Object} Map of whatsapp number to file data
 */
export const getLocalChatFiles = () => {
    try {
        const saved = localStorage.getItem('local_chat_files');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        return {};
    }
};

/**
 * Get local chat file for a specific candidate
 * @param {string} whatsapp - WhatsApp number
 * @returns {Object|null} File data or null
 */
export const getLocalChatFile = (whatsapp) => {
    const files = getLocalChatFiles();
    return files[whatsapp] || null;
};

// --- Timer States (Redis-backed with localStorage fallback) ---
export const setTimerState = async (whatsapp, state) => {
    try {
        const response = await fetch('/api/timer-states', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ whatsapp, state })
        });

        if (!response.ok) {
            throw new Error('Failed to save timer state to Redis');
        }

        // Also save to localStorage as backup
        const states = JSON.parse(localStorage.getItem('timer_states') || '{}');
        states[whatsapp] = (state === 'green');
        localStorage.setItem('timer_states', JSON.stringify(states));

    } catch (error) {
        console.warn('⚠️ Failed to save timer state to Redis, using localStorage only:', error);
        const states = JSON.parse(localStorage.getItem('timer_states') || '{}');
        states[whatsapp] = (state === 'green');
        localStorage.setItem('timer_states', JSON.stringify(states));
    }
};

export const getTimerState = async (whatsapp) => {
    try {
        const response = await fetch(`/api/timer-states?whatsapp=${whatsapp}`);

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                return result.isGreen;
            }
        }

        // Fallback to localStorage
        const states = JSON.parse(localStorage.getItem('timer_states') || '{}');
        return states[whatsapp] || false;

    } catch (error) {
        console.warn('⚠️ Failed to get timer state from Redis, using localStorage:', error);
        const states = JSON.parse(localStorage.getItem('timer_states') || '{}');
        return states[whatsapp] || false;
    }
};

/**
 * Delete local chat file for a candidate
 * @param {string} whatsapp - WhatsApp number
 * @returns {Object} Success status
 */
export const deleteLocalChatFile = (whatsapp) => {
    try {
        const files = getLocalChatFiles();
        delete files[whatsapp];
        localStorage.setItem('local_chat_files', JSON.stringify(files));
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Error eliminando archivo local' };
    }
};

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
