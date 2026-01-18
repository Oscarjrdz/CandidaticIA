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

    const now = new Date();
    const formattedDate = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const formattedTime = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    let header = `HISTORIAL DE CONVERSACIÓN\n`;
    header += `----------------------------------------\n`;
    header += `WhatsApp: ${candidate.whatsapp}\n`;
    header += `Nombre Real: ${candidate.nombreReal || '-'}\n`;
    header += `Nombre (WhatsApp): ${candidate.nombre || '-'}\n`;
    header += `Fecha Nacimiento: ${candidate.fechaNacimiento || '-'}\n`;
    header += `Edad: ${calculateAge(candidate.fechaNacimiento)}\n`;
    header += `Municipio: ${candidate.municipio || '-'}\n`;
    header += `Categoría: ${candidate.categoria || '-'}\n`;
    header += `Fecha de exportación: ${formattedDate} a las ${formattedTime}\n`;
    header += `----------------------------------------\n\n`;

    const messages = candidate.messages
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((msg, index) => {
            const time = new Date(msg.timestamp).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });

            // Detect sender correctly based on 'from' property or 'incoming' flag fallback
            const isCandidate = msg.from === 'candidate' || msg.from === 'user' || msg.incoming === true;
            const sender = isCandidate ? (candidate.whatsapp || 'Desconocido') : 'Bot';

            const messageText = msg.content || msg.body || msg.text || '';
            const paddedIndex = (index + 1).toString().padStart(3, '0');

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

/**
 * Calculate age from date of birth
 * @param {string} dob - Date of birth string
 * @returns {string} Age in years or '-'
 */
const calculateAge = (dob) => {
    if (!dob) return '-';
    let birthDate = new Date(dob);

    // Intentar parsear si la fecha estándar falló
    if (isNaN(birthDate.getTime())) {
        const cleanDob = dob.toLowerCase().trim();

        // 1. Formato "19 de 05 de 1983" o "19 de mayo de 1983"
        const deRegex = /(\d{1,2})\s+de\s+([a-z0-9áéíóú]+)\s+de\s+(\d{4})/;
        const match = cleanDob.match(deRegex);

        if (match) {
            const day = parseInt(match[1]);
            let month = match[2];
            const year = parseInt(match[3]);
            let monthIndex = -1;

            // Si mes es número
            if (!isNaN(month)) {
                monthIndex = parseInt(month) - 1;
            } else {
                // Si mes es texto
                const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                // Buscar coincidencia parcial (ej. "sep" o "septiembre")
                monthIndex = months.findIndex(m => m.startsWith(month.slice(0, 3)));
            }

            if (monthIndex >= 0) {
                birthDate = new Date(year, monthIndex, day);
            }
        } else {
            // 2. Fallback a DD/MM/YYYY o DD-MM-YYYY
            const parts = dob.split(/[/-]/);
            if (parts.length === 3) {
                birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            }
        }
    }

    if (isNaN(birthDate.getTime())) return '-';

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return isNaN(age) ? '-' : `${age} años`;
};
