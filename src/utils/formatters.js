/**
 * Utility for professional data formatting - Shared across Candidatic
 */

/**
 * Formats a phone number for professional display (Mexico focus)
 * @param {string} phone 
 * @returns {string}
 */
export const formatPhone = (phone) => {
    if (!phone) return '-';
    // Remove non-numeric characters for processing if needed, 
    // but usually candidates come with digits already
    const clean = phone.replace(/\D/g, '');

    if (clean.startsWith('52')) {
        return `+${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
    }
    return phone;
};

/**
 * Returns a relative time string (e.g., "Hace 2h")
 * @param {string|Date} dateString 
 * @returns {string}
 */
export const formatRelativeDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes}m`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 30) return `Hace ${days}d`;
    if (months < 12) return `Hace ${months} mes${months !== 1 ? 'es' : ''}`;
    return `Hace ${years} año${years !== 1 ? 's' : ''}`;
};

/**
 * Formats full date and time professionally
 * @param {string|Date} dateString 
 * @returns {string}
 */
export const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';

    const dateStr = date.toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });

    const timeStr = date.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    return `${dateStr}, ${timeStr}`;
};

/**
 * Calculates age from birth date with advanced parsing
 * @param {string} dob 
 * @param {number|string} storedAge 
 * @returns {string}
 */
export const calculateAge = (dob, storedAge) => {
    if (storedAge && storedAge !== '-' && storedAge !== 'INVALID') {
        return `${storedAge} años`;
    }

    if (!dob) return '-';
    let birthDate = new Date(dob);

    if (isNaN(birthDate.getTime())) {
        const cleanDob = dob.toLowerCase().trim();
        const dateRegex = /(\d{1,2})[\s/-]+(?:de\s+)?([a-z0-9áéíóú]+)[\s/-]+(?:de\s+)?(\d{4})/;
        const match = cleanDob.match(dateRegex);

        if (match) {
            const day = parseInt(match[1]);
            let month = match[2];
            const year = parseInt(match[3]);
            let monthIndex = -1;

            if (!isNaN(month)) {
                monthIndex = parseInt(month) - 1;
            } else {
                const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                monthIndex = months.findIndex(m => m.startsWith(month.slice(0, 3)));
            }
            if (monthIndex >= 0) birthDate = new Date(year, monthIndex, day);
        }

        if (isNaN(birthDate.getTime())) {
            const parts = dob.split(/[/-]/);
            if (parts.length === 3) {
                const d = parseInt(parts[0]);
                const m = parseInt(parts[1]) - 1;
                const y = parseInt(parts[2]);
                if (!isNaN(d) && !isNaN(m) && !isNaN(y)) birthDate = new Date(y, m, d);
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

/**
 * Ensures values are clean for UI display, replacing "No proporcionado" with a dash
 * @param {any} val 
 * @returns {string}
 */
export const formatValue = (val) => {
    if (val === null || val === undefined || val === '') return '-';

    const str = String(val).trim();
    const lower = str.toLowerCase();

    // List of common bot-generated placeholders that look bad in columns
    if (
        lower === 'no proporcionado' ||
        lower === 'no proporcionada' ||
        lower === 'desconocido' ||
        lower === 'consulta general' ||
        lower === 'n/a' ||
        lower === 'invalid' ||
        lower === 'null' ||
        lower === 'undefined'
    ) {
        return '-';
    }

    return str;
};
