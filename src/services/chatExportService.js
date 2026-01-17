/**
 * Chat Export Service
 * Handles exporting chat histories to .txt files and uploading to Knowledge Base
 */

/**
 * Generate formatted chat history text
 * @param {Object} candidate - Candidate object with messages
 * @returns {string} Formatted chat history
 */
export const generateChatHistoryText = (candidate) => {
    if (!candidate || !candidate.messages || candidate.messages.length === 0) {
        return `Conversación con: ${candidate?.whatsapp || 'Desconocido'}\nFecha: ${new Date().toLocaleDateString('es-MX')}\n\nNo hay mensajes en el historial.`;
    }

    const header = `Conversación con: ${candidate.whatsapp}\nFecha: ${new Date().toLocaleDateString('es-MX')}\n\n`;

    const messages = candidate.messages
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map(msg => {
            const time = new Date(msg.timestamp).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const sender = msg.incoming ? 'Candidato' : 'Bot';
            const messageText = msg.content || msg.body || msg.text || '';
            return `[${time}] ${sender}: ${messageText}`;
        })
        .join('\n');

    return header + messages;
};

/**
 * Export chat history to file and upload to Knowledge Base
 * @param {Object} candidate - Candidate object
 * @param {Object} credentials - BuilderBot credentials
 * @returns {Promise<Object>} Upload result with file ID
 */
export const exportChatToFile = async (candidate, credentials) => {
    if (!credentials || !credentials.botId || !credentials.answerId || !credentials.apiKey) {
        throw new Error('Credenciales no configuradas');
    }

    // Generate text content
    const textContent = generateChatHistoryText(candidate);

    // Create blob
    const blob = new Blob([textContent], { type: 'text/plain' });
    const filename = `${candidate.whatsapp}.txt`;

    // Create FormData
    const formData = new FormData();
    formData.append('file', blob, filename);

    // Upload to Knowledge Base
    const params = new URLSearchParams({
        botId: credentials.botId,
        answerId: credentials.answerId,
        apiKey: credentials.apiKey,
        type: 'files'
    });

    const response = await fetch(`/api/assistant?${params}`, {
        method: 'POST',
        body: formData
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Error al subir archivo');
    }

    return {
        success: true,
        fileId: data.id || data.file_id,
        filename
    };
};

/**
 * Delete chat file from Knowledge Base
 * @param {string} fileId - File ID to delete
 * @param {Object} credentials - BuilderBot credentials
 * @returns {Promise<boolean>} Success status
 */
export const deleteOldChatFile = async (fileId, credentials) => {
    if (!fileId || !credentials) {
        return false;
    }

    try {
        const params = new URLSearchParams({
            botId: credentials.botId,
            answerId: credentials.answerId,
            apiKey: credentials.apiKey,
            type: 'files',
            fileId
        });

        const response = await fetch(`/api/assistant?${params}`, {
            method: 'DELETE'
        });

        return response.ok;
    } catch (error) {
        console.error('Error deleting old chat file:', error);
        return false;
    }
};

/**
 * Download chat history as .txt file locally
 * @param {Object} candidate - Candidate object
 */
export const downloadChatHistory = (candidate) => {
    const textContent = generateChatHistoryText(candidate);
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${candidate.whatsapp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
