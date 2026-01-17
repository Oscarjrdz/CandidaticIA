/**
 * Servicio para gestionar archivos y prompt del Asistente
 */

// Helper para construir headers con credenciales
const getHeaders = (apiKey) => ({
    'x-api-builderbot': apiKey
});

// Helper para construir params
const getParams = (credentials, type, extra = {}) => {
    return new URLSearchParams({
        botId: credentials.botId,
        answerId: credentials.answerId,
        apiKey: credentials.apiKey,
        type,
        ...extra
    });
};

/**
 * Obtener lista de archivos
 */
export const getFiles = async (credentials) => {
    try {
        const params = getParams(credentials, 'files');
        const res = await fetch(`/api/assistant?${params}`);
        const data = await res.json();

        if (res.ok) {
            const files = Array.isArray(data) ? data : (data.files || []);
            return { success: true, files };
        }
        return { success: false, error: data.error || 'Error listando archivos' };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Subir un archivo (File object o Buffer implícito vía FormData)
 * @param {File} file - Objeto File del navegador
 * @param {Object} credentials 
 */
export const uploadFile = async (credentials, file) => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        const params = getParams(credentials, 'files');
        const res = await fetch(`/api/assistant?${params}`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (res.ok) {
            return { success: true, data };
        }
        return { success: false, error: data.error, details: data.details };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Eliminar un archivo por ID
 */
export const deleteFile = async (credentials, fileId) => {
    try {
        const params = getParams(credentials, 'files', { fileId });
        const res = await fetch(`/api/assistant?${params}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            return { success: true };
        }
        const data = await res.json();
        return { success: false, error: data.error };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Obtener historial de chat de un candidato (para exportar)
 */
export const getChatHistory = async (candidateId) => {
    try {
        const res = await fetch(`/api/chat?candidateId=${candidateId}`);
        const data = await res.json();
        if (data.success) {
            return { success: true, messages: data.messages };
        }
        return { success: false, error: 'Error cargando chat' };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
