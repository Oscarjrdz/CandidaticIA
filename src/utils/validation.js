/**
 * Utilidades para validación de datos
 */

/**
 * Valida si el Bot ID tiene formato UUID válido
 */
export const validateBotId = (id) => {
    if (!id || typeof id !== 'string') {
        return { valid: false, error: 'El Bot ID es requerido' };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(id)) {
        return { valid: false, error: 'El Bot ID debe tener formato UUID válido' };
    }

    return { valid: true };
};

/**
 * Valida si el Answer ID tiene formato UUID válido
 */
export const validateAnswerId = (id) => {
    if (!id || typeof id !== 'string') {
        return { valid: false, error: 'El Answer ID es requerido' };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(id)) {
        return { valid: false, error: 'El Answer ID debe tener formato UUID válido' };
    }

    return { valid: true };
};

/**
 * Valida si la API Key tiene el formato correcto
 */
export const validateApiKey = (key) => {
    if (!key || typeof key !== 'string') {
        return { valid: false, error: 'La API Key es requerida' };
    }

    if (!key.startsWith('bb-')) {
        return { valid: false, error: 'La API Key debe empezar con "bb-"' };
    }

    if (key.length < 10) {
        return { valid: false, error: 'La API Key parece ser demasiado corta' };
    }

    return { valid: true };
};

/**
 * Valida si la URL del webhook es HTTPS válida
 */
export const validateWebhookUrl = (url) => {
    if (!url || typeof url !== 'string') {
        return { valid: false, error: 'La URL del webhook es requerida' };
    }

    try {
        const urlObj = new URL(url);

        if (urlObj.protocol !== 'https:') {
            return { valid: false, error: 'La URL debe usar protocolo HTTPS' };
        }

        return { valid: true };
    } catch (error) {
        return { valid: false, error: 'La URL no es válida' };
    }
};

/**
 * Valida número de teléfono (formato básico)
 */
export const validatePhoneNumber = (number) => {
    if (!number || typeof number !== 'string') {
        return { valid: false, error: 'El número de teléfono es requerido' };
    }

    // Remover espacios y caracteres especiales
    const cleaned = number.replace(/[\s\-\(\)]/g, '');

    // Debe contener solo dígitos y opcionalmente un + al inicio
    const phoneRegex = /^\+?\d{10,15}$/;

    if (!phoneRegex.test(cleaned)) {
        return { valid: false, error: 'Número de teléfono inválido (debe tener 10-15 dígitos)' };
    }

    return { valid: true, cleaned };
};
