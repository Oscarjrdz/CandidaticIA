/**
 * Chat Export Service
 * Handles exporting chat histories to .txt files and uploading to Knowledge Base
 */

/**
 * Helper to convert text to Title Case
 * @param {string} str - Text to convert
 * @returns {string} Formatted text
 */
const toTitleCase = (str) => {
    if (!str) return '-';
    // Split by spaces, capitalize first letter of each word, lowercase the rest
    return str.toLowerCase().replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
};

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

    // Calculate age with debugging
    const calculatedAge = calculateAge(candidate.fechaNacimiento);
    console.log(`[ChatExport] Calculating age for ${candidate.whatsapp}. DOB: ${candidate.fechaNacimiento}, Result: ${calculatedAge}`);

    let header = `HISTORIAL DE CONVERSACIÓN\n`;
    header += `----------------------------------------\n`;
    header += `WhatsApp: ${candidate.whatsapp}\n`;
    header += `Nombre Real: ${toTitleCase(candidate.nombreReal)}\n`;
    header += `Nombre (WhatsApp): ${toTitleCase(candidate.nombre)}\n`;
    header += `Fecha Nacimiento: ${candidate.fechaNacimiento || '-'}\n`;
    header += `Edad: ${calculatedAge}\n`;
    header += `Municipio: ${toTitleCase(candidate.municipio)}\n`;
    header += `Categoría: ${toTitleCase(candidate.categoria)}\n`;
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

            // Detect sender correctly
            let sender = 'Bot';
            if (msg.from === 'candidate' || msg.from === 'user' || msg.incoming === true) {
                sender = candidate.whatsapp || 'Candidato';
            } else if (msg.from === 'me') {
                sender = 'Agente';
            }

            const messageText = msg.content || msg.body || msg.text || '';
            const paddedIndex = (index + 1).toString().padStart(3, '0');

            return `[${time}] ${sender}: ${messageText}`;
        })
        .join('\n');

    return header + messages;
};

export const exportChatToFile = async (candidate, credentials) => {
    // Cloud upload disabled for now.
    // This function can be used for local processing or future cloud features.
    console.log('📤 Cloud export disabled');
    return { success: false, error: 'Cloud export no disponible' };
};

export const deleteOldChatFile = async (fileId, credentials) => {
    // Cloud delete from BuilderBot removed.
    return true;
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
